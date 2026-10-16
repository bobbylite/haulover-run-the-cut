// Shared material kit for boats and props: pastel gelcoat, teak, canvas, glass, chrome, lights.

import {
  abs,
  atan,
  cos,
  float,
  floor,
  fract,
  frontFacing,
  length,
  mix,
  positionLocal,
  pow,
  select,
  sin,
  smoothstep,
  step,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import { Color, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import { shared } from '../shared';
import { ToonMaterial } from '../toon';

type N = any;

const cache = new Map<string, ToonMaterial>();

function memo(key: string, make: () => ToonMaterial): ToonMaterial {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Glossy fibreglass. */
export const gel = (hex: string, roughness = 0.3): ToonMaterial =>
  memo(
    `gel:${hex}:${roughness}`,
    () => new ToonMaterial({ color: new Color(hex), roughness, metalness: 0.0 }),
  );

export const matte = (hex: string, roughness = 0.85): ToonMaterial =>
  memo(
    `matte:${hex}:${roughness}`,
    () => new ToonMaterial({ color: new Color(hex), roughness, metalness: 0.0 }),
  );

export const metal = (hex = '#d7dde6', roughness = 0.22): ToonMaterial =>
  memo(
    `metal:${hex}:${roughness}`,
    () => new ToonMaterial({ color: new Color(hex), roughness, metalness: 1.0 }),
  );

export const glass = (hex = '#1b3552'): ToonMaterial =>
  memo(`glass:${hex}`, () => new ToonMaterial({ color: new Color(hex), roughness: 0.05, metalness: 0.45 }));

export const canvas = (hex: string): ToonMaterial =>
  memo(
    `canvas:${hex}`,
    () =>
      new ToonMaterial({
        color: new Color(hex),
        roughness: 0.95,
        metalness: 0,
        side: DoubleSide,
      }),
  );

/** Teak planks (UV.y runs across the boat). */
export function teak(hexA = '#d49a5e', hexB = '#b9794a', planks = 6): ToonMaterial {
  return memo(`teak:${hexA}:${hexB}:${planks}`, () => {
    const m = new ToonMaterial({ roughness: 0.78, metalness: 0 });
    const a = new Color(hexA);
    const b = new Color(hexB);
    const coord = uv().y.mul(planks).add(uv().x.mul(0.0));
    const id = floor(coord);
    const f = fract(coord);
    const tone = fract(sin(id.mul(12.9898).add(4.1)).mul(43758.5453));
    const groove = float(1)
      .sub(smoothstep(0.0, 0.07, f))
      .add(smoothstep(0.93, 1.0, f))
      .clamp(0, 1);
    const base = mix(vec3(a.r, a.g, a.b), vec3(b.r, b.g, b.b), tone.mul(0.85));
    m.colorNode = mix(base, vec3(0.2, 0.12, 0.07), groove.mul(0.55)) as N;
    return m;
  });
}

/**
 * Hull shell: the vertex-colour livery on the outside (front faces) and a plain liner on the inside. The liner
 * is a warm cream that falls into lavender shade towards the bilge, so a dry cockpit reads as painted fibreglass
 * and never as a pool of white water.
 */
export function hullMaterial(inner: Color): ToonMaterial {
  const m = new ToonMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide });
  const vc = vertexColor() as N;
  const shade: N = mix(vec3(0.78, 0.76, 0.9), vec3(0.97, 0.95, 0.94), smoothstep(0.02, 0.8, positionLocal.y));
  const liner: N = vec3(inner.r, inner.g, inner.b).mul(shade);
  m.colorNode = select(frontFacing, vc.rgb, liner) as N;
  return m;
}

/**
 * A band of windows for a ship's side or a wheelhouse: `n` panes along the long axis of a plain box (uv.x runs
 * along it), pale frames between them, glowing at night. Unlit, so the narrow strip stays crisp at distance.
 */
export function windowBand(
  n: number,
  frame = '#f4f1ee',
  glassHex = '#2c4666',
  lit = '#ffe9b0',
): MeshBasicNodeMaterial {
  const key = `win:${n}:${frame}:${glassHex}:${lit}`;
  const hit = bandCache.get(key);
  if (hit) return hit;
  const m = new MeshBasicNodeMaterial();
  const f = new Color(frame);
  const g = new Color(glassHex);
  const l = new Color(lit);
  const u: N = fract(uv().x.mul(n));
  const v: N = uv().y;
  const pane: N = smoothstep(0.1, 0.16, u)
    .mul(float(1).sub(smoothstep(0.84, 0.9, u)))
    .mul(smoothstep(0.16, 0.26, v))
    .mul(float(1).sub(smoothstep(0.74, 0.84, v)));
  const glassCol: N = mix(vec3(g.r, g.g, g.b), vec3(l.r, l.g, l.b), shared.night.mul(0.85));
  m.colorNode = mix(vec3(f.r, f.g, f.b), glassCol, pane) as N;
  bandCache.set(key, m);
  return m;
}
const bandCache = new Map<string, MeshBasicNodeMaterial>();

/** Self-lit running / string lights: dim by day, bright at night. */
export function bulb(hex: string, nightBoost = 6): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  const c = new Color(hex);
  m.colorNode = vec3(c.r, c.g, c.b).mul(shared.night.mul(nightBoost).add(0.55)) as N;
  return m;
}

/** Navigation beacon: a short bright flash every `period` seconds, steady glow at night. */
export function flashBulb(hex: string, period = 4, phase = 0): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  const c = new Color(hex);
  const t = shared.time.div(period).add(phase);
  const flash = sin(fract(t).mul(Math.PI)).pow(14.0);
  mat.colorNode = vec3(c.r, c.g, c.b).mul(flash.mul(9.0).add(shared.night.mul(2.0)).add(0.5)) as N;
  return mat;
}

/** Vertex flutter driven by the wind, anchored at the pole edge (local x = 0). */
function flutter(m: ToonMaterial): void {
  const px = positionLocal.x.max(0.0);
  const amp = px.mul(float(0.06).add(shared.windSpeed.mul(0.014))).min(0.5);
  const wave = sin(
    px
      .mul(9.0)
      .sub(shared.time.mul(float(5.5).add(shared.windSpeed.mul(0.9))))
      .add(positionLocal.y.mul(2.2)),
  );
  m.positionNode = positionLocal.add(vec3(0.0, 0.0, wave.mul(amp))) as N;
}

/** Flapping cloth: vertex flutter driven by wind, anchored at the pole edge (local x = 0). */
export function flagMaterial(c1: string, c2: string, bands = 3): ToonMaterial {
  const m = new ToonMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide });
  const a = new Color(c1);
  const b = new Color(c2);
  const stripe = floor(uv().y.mul(bands)).mod(2);
  m.colorNode = mix(vec3(a.r, a.g, a.b), vec3(b.r, b.g, b.b), stripe) as N;
  flutter(m);
  return m;
}

/**
 * The Stars and Stripes, drawn in the shader: thirteen stripes (red on top and bottom), a blue canton over
 * the top seven, and fifty stars in nine alternating rows of six and five. UV (0,0) is the bottom-left,
 * hoist on the left, so the canton sits top-left like a real ensign.
 */
export function usFlagMaterial(): ToonMaterial {
  return memo('usflag', () => {
    const m = new ToonMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide });
    const red = new Color('#e0404d');
    const white = new Color('#fffaf3');
    const blue = new Color('#2f4fa3');
    const u = uv().x;
    const v = uv().y;
    // stripes: index 0 is the top one, and even ones are red
    const stripe = floor(float(1).sub(v).mul(12.999)).mod(2.0);
    const stripeCol = mix(vec3(red.r, red.g, red.b), vec3(white.r, white.g, white.b), stripe);
    // canton: left 40% of the width, top 7 of 13 stripes
    const cantonH = 7 / 13;
    const inCanton = float(1)
      .sub(step(0.4, u))
      .mul(step(1 - cantonH, v));
    const cu = u.div(0.4);
    const cv = v.sub(1 - cantonH).div(cantonH);
    // 11 columns x 9 rows; a star sits where column + row is even (6 in even rows, 5 in odd rows)
    const colx = cu.mul(11.0);
    const rowy = cv.mul(9.0);
    const parity = floor(colx).add(floor(rowy)).mod(2.0);
    const p = vec2(fract(colx).sub(0.5).mul(1.15), fract(rowy).sub(0.5));
    const ang = atan(p.y, p.x);
    // five-pointed star: radius swells to the points
    const lobes = abs(cos(ang.sub(Math.PI / 2).mul(2.5)));
    const radius = float(0.1).add(pow(lobes, 2.0).mul(0.21));
    const star = step(length(p), radius).mul(float(1).sub(parity));
    const cantonCol = mix(vec3(blue.r, blue.g, blue.b), vec3(white.r, white.g, white.b), star);
    m.colorNode = mix(stripeCol, cantonCol, inCanton) as N;
    flutter(m);
    return m;
  });
}
