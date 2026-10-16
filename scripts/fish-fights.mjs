#!/usr/bin/env node
// Dev tool: fight many fish on the real boat and sea, back to back, with the scripted captain at the helm.
// Each trial puts the boat on the grounds, hooks a tuna at the stern and plays it out. Prints land rates.
//   node scripts/fish-fights.mjs --difficulty weekender --species yellowfin --kg 55 --n 12 --skill captain
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const tiers = String(args.difficulty ?? 'weekender').split(',');
for (const tier of tiers) {
  const url = `${args.url ?? 'http://127.0.0.1:5392/'}?game=montauk&auto&noui&boat=${args.boat ?? 'console'}&weather=${args.weather ?? 'm-dawn'}&difficulty=${tier}&tide=${args.tide ?? 'ebb'}&skill=${args.skill ?? 'captain'}&quality=low`;
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.phase !== 'loading', null, { timeout: 60000 });
  const res = await page.evaluate(({ n, species, kg, x, z, trace }) => {
    const g = window.__game;
    const m = g.mode;
    const ends = {};
    const times = [];
    const logs = [];
    for (let i = 0; i < n; i++) {
      g.startRun();
      for (let k = 0; k < 130; k++) g.update(1 / 30);
      // on the grounds, trolling east
      const b = g.player;
      b.reset(x, z, 0.1, g.benv);
      b.throttle = 0.2;
      for (let k = 0; k < 60; k++) g.update(1 / 30);
      m.debugStrike(species, kg);
      let t = 0;
      const lg = [];
      while (m.fight && g.phase === 'playing' && t < 420) {
        g.update(1 / 30);
        t += 1 / 30;
        if (trace && i === 0 && Math.round(t * 30) % (30 * trace) === 0 && m.fight) {
          const f = m.fight;
          lg.push(`${t.toFixed(0)}s ${f.mood} T=${f.T.toFixed(2)} L=${f.L.toFixed(0)} d=${f.dist.toFixed(0)} th=${((f.theta * 180) / Math.PI).toFixed(0)} stam=${f.stam.toFixed(2)} stw=${(b.speed * 1.944).toFixed(1)} thr=${b.throttle.toFixed(2)}`);
        }
      }
      if (i === 0) logs.push(...lg);
      const end = g.phase === 'finished' ? 'landed' : m.lastEndKind ?? (m.fight ? 'timeout' : g.result?.outcome ?? 'unknown');
      ends[end] = (ends[end] ?? 0) + 1;
      if (end === 'landed') times.push(t);
    }
    return { ends, meanT: times.length ? times.reduce((a, c) => a + c, 0) / times.length : 0, logs };
  }, { n: Number(args.n ?? 10), species: args.species ?? 'yellowfin', kg: Number(args.kg ?? 55), x: Number(args.x ?? 600), z: Number(args.z ?? 250), trace: Number(args.trace ?? 0) });
  const land = res.ends.landed ?? 0;
  console.log(JSON.stringify({ tier, skill: args.skill ?? 'captain', species: args.species ?? 'yellowfin', n: Number(args.n ?? 10), landRate: +(land / Number(args.n ?? 10)).toFixed(2), meanSec: +res.meanT.toFixed(0), ends: res.ends }));
  if (res.logs.length) console.log(res.logs.join('\n'));
  await page.context().close();
}
await browser.close();
