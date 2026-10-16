#!/usr/bin/env node
// Dev tool: run a Nantucket berthing challenge headlessly in the real page (the harbour pilot at the helm, time
// fast-forwarded) and print how it went. Used to balance the levels.
//   node scripts/dock-run.mjs --level liner-east --weather n-fog --tide ebb --difficulty captain
//   node scripts/dock-run.mjs --all            (every level, in its own conditions)
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const LEVELS = [
  'tiki-slip', 'hornet-moor', 'sunset-quay', 'pelican-moor', 'sunset-oldnorth', 'lady-straight',
  'tug-slip', 'tug-steamship', 'ferry-west', 'ferry-east', 'liner-east', 'liner-fog',
];
const levels = args.all ? LEVELS : String(args.level ?? 'tiki-slip').split(',');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
for (const level of levels) {
  const q = new URLSearchParams({ game: 'nantucket', auto: '1', go: '1', noui: '1', quality: 'low', level, cruise: args.cruise ?? '0.7' });
  for (const k of ['weather', 'tide', 'difficulty']) if (args[k]) q.set(k, args[k]);
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${args.url ?? 'http://127.0.0.1:5392/'}?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.phase !== 'loading', null, { timeout: 60000 });
  const res = await page.evaluate(({ maxSecs }) => {
    const g = window.__game;
    let n = 0;
    while (g.phase !== 'finished' && g.phase !== 'failed' && n < 30 * maxSecs) {
      g.update(1 / 30);
      n++;
    }
    const r = g.result;
    const m = g.mode;
    return {
      level: m.level.id,
      boat: g.player.spec.id,
      phase: g.phase,
      simSeconds: Math.round(n / 30),
      outcome: r?.outcome ?? 'running',
      score: r?.score,
      stars: r?.stars,
      bumps: m.session.touches,
      tugs: m.tugs.used,
      hullPct: r?.hullPct,
      left: Math.round(m.session.status.dist),
    };
  }, { maxSecs: Number(args.max ?? 900) });
  console.log(JSON.stringify(res));
  await page.close();
}
await browser.close();
