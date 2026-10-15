#!/usr/bin/env node
// Dev tool: tile several screenshots into one labelled contact sheet.
//   node scripts/sheet.mjs out.png cols a.png b.png c.png
import { chromium } from 'playwright-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const [out, colsArg, ...imgs] = process.argv.slice(2);
const cols = Number(colsArg);
const dir = mkdtempSync(join(tmpdir(), 'sheet-'));
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px">${imgs
  .map((p) => `<figure style="margin:0;position:relative"><img src="file://${p}" style="width:100%;display:block"><figcaption style="position:absolute;left:6px;top:4px;color:#fff;font:600 14px system-ui;text-shadow:0 1px 3px #000">${basename(p)}</figcaption></figure>`)
  .join('')}</body>`;
const file = join(dir, 'sheet.html');
writeFileSync(file, html);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${file}`);
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('sheet ->', out);
process.exit(0);
