#!/usr/bin/env node
// Dev tool: run a whole Montauk day headlessly in the real page (the scripted captain at the helm, time
// fast-forwarded) and print how it went. Used to balance the fishing.
//   node scripts/fish-run.mjs --seed 3 --difficulty weekender --skill captain --boat console --weather m-dawn
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
const seeds = String(args.seed ?? '1').split(',');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
for (const seed of seeds) {
  const url = `${args.url ?? 'http://127.0.0.1:5392/'}?game=montauk&auto&go&noui&seed=${seed}&boat=${args.boat ?? 'console'}&weather=${args.weather ?? 'm-dawn'}&difficulty=${args.difficulty ?? 'weekender'}&tide=${args.tide ?? 'ebb'}&skill=${args.skill ?? 'captain'}&cruise=${args.cruise ?? 0.55}&quality=low`;
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.phase !== 'loading', null, { timeout: 60000 });
  const res = await page.evaluate(({ maxSecs, trace }) => {
    const g = window.__game;
    const m = g.mode;
    let n = 0;
    const t0 = performance.now();
    const log = [];
    let lastFight = null;
    while (g.phase !== 'finished' && g.phase !== 'failed' && n < 30 * maxSecs) {
      g.update(1 / 30);
      n++;
      if (trace && n % (30 * trace) === 0) {
        const f = m.fight;
        const b = g.player;
        const sc = m.nearestSchool(b.pos.x, b.pos.z, true);
        const sd = sc ? Math.hypot(sc.x - b.pos.x, sc.z - b.pos.z) : -1;
        log.push(
          `${(n / 30).toFixed(0)}s ${m.phaseName} sch=${sc ? sc.id + '@' + sd.toFixed(0) + 'm r' + sc.radius.toFixed(0) + ' d' + sc.depth.toFixed(0) + ' f' + sc.feeding.toFixed(2) + ' sp' + sc.spooked.toFixed(0) + ' fr' + sc.fright.toFixed(2) + ' ap' + (sc.tuna[0] ? sc.tuna[0].appetite.toFixed(2) : '-') : 'none'} leg=${window.__bot.leg} pos=(${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)}) stw=${(b.speed * 1.944).toFixed(1)}kn lines=${m.tackle.fishing}/${m.tackle.tangled}t strikes=${m.strikes}` +
            (f ? ` | ${f.mood} T=${f.T.toFixed(2)} L=${f.L.toFixed(0)} d=${f.dist.toFixed(0)} th=${((f.theta * 180) / Math.PI).toFixed(0)} stam=${f.stam.toFixed(2)}` : ''),
        );
      }
      if (m.fight) lastFight = m.fight;
    }
    const r = g.result;
    return {
      phase: g.phase,
      simSeconds: +(n / 30).toFixed(0),
      wallSeconds: +((performance.now() - t0) / 1000).toFixed(1),
      outcome: r?.outcome ?? 'running',
      title: r?.title,
      score: r?.score,
      stars: r?.stars,
      fish: r?.fish ? { kg: r.fish.kg, sp: r.fish.species, fight: Math.round(r.fish.fightS), clean: r.fish.cleanPct, strikes: r.fish.strikes, lost: r.fish.lost, why: r.fish.reason } : null,
      hull: r?.hullPct,
      maxKn: r?.maxSpeedKn,
      tunaSchools: m.world.schools.filter((s) => s.tuna.length).length,
      log,
      lastFight: lastFight ? { mood: lastFight.mood, end: lastFight.end?.kind } : null,
    };
  }, { maxSecs: Number(args.max ?? 1200), trace: Number(args.trace ?? 0) });
  const { log, ...rest } = res;
  console.log(JSON.stringify({ seed, diff: args.difficulty ?? 'weekender', skill: args.skill ?? 'captain', boat: args.boat ?? 'console', ...rest }));
  if (log.length) console.log(log.join('\n'));
  await page.context().close();
}
await browser.close();
