#!/usr/bin/env node
// Example agent loop over `window.__agent` (see src/dev/agentApi.ts): observe -> decide -> act -> step.
// It is deliberately small, a template for a real agent (or an LLM tool wrapper), not a good player.
//   node scripts/agent-demo.mjs --game haulover
//   node scripts/agent-demo.mjs --game montauk --seed 4 --difficulty dockside
//   node scripts/agent-demo.mjs --game nantucket --level hornet-moor    (picks up a mooring; a slip or a wharf needs a better policy)
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const game = args.game ?? 'haulover';
const url = `${args.url ?? 'http://127.0.0.1:5392/'}?game=${game}&agent&noui&quality=low&seed=${args.seed ?? 1}`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__agent && window.__game.phase !== 'loading', null, { timeout: 60000 });

// The whole policy runs inside the page so a step costs no round trip; an external agent would instead
// call `page.evaluate(() => window.__agent.step(0.25))` per decision.
const out = await page.evaluate(
  ({ game, difficulty, maxS, level }) => {
    const A = window.__agent;
    const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
    const bearing = (o, x, z) => (Math.atan2(x - o.boat.x, -(z - o.boat.z)) * 180) / Math.PI;
    let o = A.start({
      difficulty,
      ...(game === 'montauk' ? { weather: 'm-dawn' } : game === 'nantucket' ? { level, tide: 'slack' } : { route: 'outbound' }),
    });
    const log = [];
    let last = '';
    for (let t = 0; t < maxS && o.phase === 'playing'; t += 0.25) {
      if (game === 'haulover') {
        const g = o.mode.nextGate;
        if (g) {
          const err = wrap(bearing(o, g.x, g.z) - o.boat.headingDeg);
          // steer at the gate, and slow for a sharp turn
          A.act({ steer: Math.max(-1, Math.min(1, err / 22)), throttle: Math.abs(err) > 40 ? 0.3 : 0.5, bilge: o.boat.bilgeFrac > 0.45 });
        }
      } else if (game === 'nantucket') {
        // Nantucket: the target pose is on the water, so a player may read it. Come in along the berth's axis from
        // whichever end we are on (leaning back onto the line when the tide pushes us off it), slowing with distance.
        const tg = o.mode.target;
        if (o.mode.berth.kind === 'mooring') {
          // a mooring is the easy one: put the bow on the ball and ease off as it comes up
          const dm = Math.hypot(tg.x - o.boat.x, tg.z - o.boat.z);
          const e = wrap(bearing(o, tg.x, tg.z) - o.boat.headingDeg);
          A.act({ steer: Math.max(-1, Math.min(1, e / 20)), throttle: Math.max(-0.25, Math.min(0.5, 0.1 * (Math.max(0.8, Math.min(7, 0.12 * dm)) - o.boat.sogKn))) });
          o = A.step(0.25);
          continue;
        }
        const ax = (tg.headingDeg * Math.PI) / 180;
        const toward = { x: Math.sin(ax), z: -Math.cos(ax) };
        const d = Math.hypot(tg.x - o.boat.x, tg.z - o.boat.z);
        const side = (o.boat.x - tg.x) * toward.x + (o.boat.z - tg.z) * toward.z < 0 ? 1 : -1;
        const dx = side * toward.x;
        const dz = side * toward.z;
        const lineDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
        // cross-track: how far to the right of the line we are, and so how far to lean left
        const cross = (o.boat.x - tg.x) * -dz + (o.boat.z - tg.z) * dx;
        const lean = Math.max(-40, Math.min(40, (Math.atan(cross / (10 + 0.5 * d)) * 180) / Math.PI));
        const err = wrap(lineDeg - lean - o.boat.headingDeg);
        // speed in knots, falling with the distance: about 2 kn at 35 m and a crawl at the mark
        const want = Math.max(0.5, Math.min(8, 0.06 * d));
        A.act({ steer: Math.max(-1, Math.min(1, err / 25)), throttle: Math.max(-0.2, Math.min(0.6, 0.1 * (want - o.boat.sogKn))) });
      } else {
        // Montauk: cheat to find the nearest tuna school, run out, slow down, set the spread, troll through it
        const s = (A.observe({ cheat: true }).mode.schools ?? []).filter((q) => q.tuna.length).sort(
          (a, b) => Math.hypot(a.x - o.boat.x, a.z - o.boat.z) - Math.hypot(b.x - o.boat.x, b.z - o.boat.z),
        )[0];
        if (s && o.mode.stage !== 'fight') {
          const d = Math.hypot(s.x - o.boat.x, s.z - o.boat.z);
          const err = wrap(bearing(o, s.x, s.z) - o.boat.headingDeg);
          A.act({ steer: Math.max(-0.12, Math.min(0.12, err / 40)), throttle: d > 700 ? 0.45 : o.boat.speedKn > 6.2 ? 0.1 : 0.22 });
          if (d < 450) A.act({ mode: { lines: 'out' } });
        }
        if (o.mode.stage === 'fight') A.act({ throttle: 0, mode: { drag: 0.15 } });
      }
      o = A.step(0.25);
      const tag =
        game === 'haulover'
          ? `gate ${o.mode.gatesPassed}/${o.mode.gates}`
          : game === 'nantucket'
            ? `${Math.round((o.mode.status?.distM ?? 999) / 25) * 25} m to the berth`
            : `${o.mode.stage}, strikes ${o.mode.strikes}`;
      if (tag !== last) {
        last = tag;
        log.push(`${o.clock.toFixed(0)}s  ${tag}  (${o.boat.speedKn} kn, hull ${o.boat.hullPct}%)`);
      }
    }
    return { log, phase: o.phase, result: o.result, toasts: o.toasts, last: o.mode.status };
  },
  { game, difficulty: args.difficulty ?? 'weekender', maxS: Number(args.max ?? 240), level: args.level ?? 'hornet-moor' },
);
console.log(out.log.join('\n'));
console.log(JSON.stringify({ phase: out.phase, result: out.result, lastToasts: out.toasts, ...(out.last ? { lastStatus: out.last } : {}) }));
await browser.close();
