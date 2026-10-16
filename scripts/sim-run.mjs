#!/usr/bin/env node
// Dev tool: run a whole game headlessly inside the real page (autopilot at the helm, time fast-forwarded)
// and print the outcome. Used to balance difficulty.
//   node scripts/sim-run.mjs --boat console --weather breeze --difficulty weekender --route full --cruise 0.55
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const url = `${args.url ?? 'http://127.0.0.1:5391/'}?auto&go&noui&boat=${args.boat ?? 'console'}&weather=${args.weather ?? 'breeze'}&difficulty=${args.difficulty ?? 'weekender'}&route=${args.route ?? 'full'}&tide=${args.tide ?? 'ebb'}&cruise=${args.cruise ?? 0.55}&quality=low`;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.phase !== 'loading', null, { timeout: 60000 });
const res = await page.evaluate(({ maxSecs, base, k, floor }) => {
  const g = window.__game;
  const ap = window.__ap;
  let n = 0;
  const t0 = performance.now();
  while (g.phase !== 'finished' && g.phase !== 'failed' && n < 30 * maxSecs) {
    // optional skill model: carry speed in the bay, ease off in steep water
    if (k > 0 && !g.mode.docking.active) {
      const chop = g.benv.chopAt(g.player.pos.x, g.player.pos.z);
      ap.cruise = base * Math.min(1, Math.max(floor, 1.55 - chop * k));
    }
    g.update(1 / 30);
    n++;
  }
  const r = g.result;
  return {
    phase: g.phase,
    simSeconds: +(n / 30).toFixed(0),
    wallSeconds: +((performance.now() - t0) / 1000).toFixed(1),
    outcome: r?.outcome ?? 'running',
    score: r?.score,
    time: r && +r.time.toFixed(0),
    penalty: r?.penalty,
    dryPct: r?.dryPct,
    peakL: r?.peakL,
    cap: r?.capacityL,
    collisions: r?.collisions,
    dock: r?.dock,
    gates: g.mode.nextGate + '/' + g.mode.course.gates.length,
    limit: Math.round(g.mode.runLimit?.() ?? 0),
    hazards: g.mode.hazards.list.length,
    vessels: g.mode.traffic.vessels.length,
  };
}, { maxSecs: Number(args.max ?? 900), base: Number(args.cruise ?? 0.55), k: Number(args.skill ?? 0), floor: Number(args.floor ?? 0.4) });
console.log(JSON.stringify({ boat: args.boat, weather: args.weather, diff: args.difficulty, route: args.route, ...res }));
await browser.close();
