// Shared material kit for boats and props: pastel gelcoat, teak, canvas, glass, chrome, lights.

import {
  float,
  floor,
  fract,
  frontFacing,
  mix,
  positionLocal,
  select,
  sin,
  smoothstep,
  uv,
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

/** Hull shell: vertex-colour livery outside, plain tint inside. */
export function hullMaterial(inner: Color): ToonMaterial {
  const m = new ToonMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide });
  const vc = vertexColor() as N;
  m.colorNode = select(frontFacing, vc.rgb, vec3(inner.r, inner.g, inner.b)) as N;
  return m;
}

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

/** Flapping cloth: vertex flutter driven by wind, anchored at the pole edge (local x = 0). */
export function flagMaterial(c1: string, c2: string, bands = 3): ToonMaterial {
  const m = new ToonMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide });
  const a = new Color(c1);
  const b = new Color(c2);
  const stripe = floor(uv().y.mul(bands)).mod(2);
  m.colorNode = mix(vec3(a.r, a.g, a.b), vec3(b.r, b.g, b.b), stripe) as N;
  const px = positionLocal.x.max(0.0);
  const amp = px.mul(float(0.06).add(shared.windSpeed.mul(0.014))).min(0.5);
  const wave = sin(
    px
      .mul(9.0)
      .sub(shared.time.mul(float(5.5).add(shared.windSpeed.mul(0.9))))
      .add(positionLocal.y.mul(2.2)),
  );
  m.positionNode = positionLocal.add(vec3(0.0, 0.0, wave.mul(amp))) as N;
  return m;
}
