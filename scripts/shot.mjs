#!/usr/bin/env node
// Dev tool: drive the system Chrome (WebGPU) and capture screenshots + console output.
//   node scripts/shot.mjs --url http://127.0.0.1:5391/ --out shot.png --wait 3000
//   node scripts/shot.mjs --steps '[{"eval":"window.__game?.start()"},{"wait":1500},{"key":"w","hold":800},{"shot":"a.png"}]'
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);

// hard watchdog so a misbehaving page can never hang the tool
const watchdog = setTimeout(() => {
  console.error('shot.mjs watchdog: aborting after', args.timeout ?? 75000, 'ms');
  process.exit(2);
}, Number(args.timeout ?? 75000));
watchdog.unref?.();

const url = args.url ?? 'http://127.0.0.1:5391/';
const out = args.out ?? 'shot.png';
const w = Number(args.w ?? 1600);
const h = Number(args.h ?? 900);
const dpr = Number(args.dpr ?? 1);
const wait = Number(args.wait ?? 3000);
const steps = args.steps ? JSON.parse(args.steps) : [];
const headed = args.headed === 'true';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !headed,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=WebGPU,Vulkan',
    '--ignore-gpu-blocklist',
    '--use-angle=metal',
    '--enable-gpu-rasterization',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  const t = m.type();
  if (args.verbose === 'true' || t === 'error' || t === 'warning' || m.text().startsWith('[')) logs.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);

for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined) logs.push(`[eval] ${JSON.stringify(r)}`);
  }
  if (s.click) await page.click(s.click);
  if (s.key) {
    await page.keyboard.down(s.key);
    await page.waitForTimeout(s.hold ?? 100);
    await page.keyboard.up(s.key);
  }
  if (s.keys) for (const k of s.keys) { await page.keyboard.press(k); await page.waitForTimeout(80); }
  if (s.shot) {
    mkdirSync(dirname(s.shot), { recursive: true });
    await page.screenshot({ path: s.shot });
    logs.push(`[shot] ${s.shot}`);
  }
}

mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
const gpu = await page.evaluate(async () => {
  const hasGpu = 'gpu' in navigator;
  let adapter = null;
  try { const a = await navigator.gpu?.requestAdapter(); adapter = a ? (a.info?.description || a.info?.vendor || 'ok') : null; } catch (e) { adapter = String(e); }
  return { hasGpu, adapter };
});
console.log(`screenshot -> ${out}`);
console.log('gpu:', JSON.stringify(gpu));
for (const l of logs) console.log(l);
await browser.close();
process.exit(0);
