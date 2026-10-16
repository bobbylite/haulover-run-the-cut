#!/usr/bin/env node
// Dev tool: flag hex colours that sit outside the game's pastel envelope (see .claude/skills/pastel-art-style).
// Informational, not a gate: night skies and ink are allowed to be dark, a lure may be vivid. Look at each hit
// and decide.
//   node scripts/palette-check.mjs --changed        # only files changed vs HEAD (and untracked)
//   node scripts/palette-check.mjs src/games/montauk # a path
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const changed = args.includes('--changed');
const roots = args.filter((a) => !a.startsWith('--'));

/** sRGB hex -> OKLCH (L 0..1, C, h degrees). */
function oklch(hex) {
  const n = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = Number.parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** The 2D interface is allowed crisp white strokes and edges (that is the glass system); the 3D world is not. */
const isUi = (f) => /src\/(ui|shell)\/|style\.css|\/(ui|map|sonar|minimap|dockRadar)\.ts$/.test(f);

function judge(hex, file) {
  const { L, C } = oklch(hex);
  const h = hex.toLowerCase();
  if (h === '#000' || h === '#000000') return 'pure black: use the ink violet or a deep pastel';
  if ((h === '#fff' || h === '#ffffff') && !isUi(file)) return 'pure white in the world: use a warm cream (#fdf8f2)';
  if (h === '#fff' || h === '#ffffff') return null;
  if (C < 0.02 && L > 0.15 && L < 0.8) return `neutral grey (L ${L.toFixed(2)}): tint it lavender or warm`;
  if (L < 0.3) return `very dark (L ${L.toFixed(2)}): fine for night/ink, otherwise lift it`;
  if (C > 0.2) return `very saturated (C ${C.toFixed(2)}): ok for a tiny accent only`;
  return null;
}

function files() {
  if (changed) {
    const sh = (c) => execSync(c, { encoding: 'utf8' }).split('\n').filter(Boolean);
    return [...new Set([...sh('git diff --name-only HEAD'), ...sh('git ls-files --others --exclude-standard')])].filter(
      (f) => /\.(ts|css|html)$/.test(f),
    );
  }
  const out = [];
  const walk = (p) => {
    for (const e of readdirSync(p)) {
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else if (/\.(ts|css|html)$/.test(q)) out.push(q);
    }
  };
  for (const r of roots.length ? roots : ['src']) walk(r);
  return out;
}

let hits = 0;
for (const f of files()) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
      const why = judge(m[0], f);
      if (why) {
        hits++;
        console.log(`${f}:${i + 1}  ${m[0]}  ${why}`);
      }
    }
  });
}
console.log(hits ? `\n${hits} colour(s) to look at.` : 'All hex colours are inside the pastel envelope.');
