// Procedural textures generated once at start-up (no image assets needed).

import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three/webgpu';
import { hash2, lerp, Rng, TAU } from '../core/math';
import { FLOW_NX, FLOW_NZ, type GeoGrid, NX, NZ } from '../sim/geography';

const toHalf = DataUtils.toHalfFloat;

// --- periodic value noise ---------------------------------------------------------------------

function pnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wrap = (v: number) => ((v % period) + period) % period;
  const a = hash2(wrap(ix), wrap(iy), seed);
  const b = hash2(wrap(ix + 1), wrap(iy), seed);
  const c = hash2(wrap(ix), wrap(iy + 1), seed);
  const d = hash2(wrap(ix + 1), wrap(iy + 1), seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function pfbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * p, v * p, p, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Periodic Worley F1 distance. */
function pworley(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 77);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
}

function makeTex(data: Uint8Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Tileable noise atlas used by clouds, foam and sparkle (half-float so cloud shading derivatives
 * are free of 8-bit banding).
 *  R: billowy fbm (clouds)   G: mid fbm   B: worley bubbles (1 = cell centre)   A: fine fbm
 */
export function makeNoiseTexture(size = 256): DataTexture {
  const data = new Uint16Array(size * size * 4);
  const stretch = (v: number, gain: number) => Math.max(0, Math.min(1, (v - 0.5) * gain + 0.5));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const r = pfbm(u, v, 4, 5, 1);
      const g = pfbm(u, v, 8, 4, 7);
      const b = 1 - pworley(u, v, 14, 3);
      const a = pfbm(u, v, 16, 3, 11);
      const i = (y * size + x) * 4;
      data[i] = toHalf(stretch(r, 2.1));
      data[i + 1] = toHalf(stretch(g, 2.1));
      data[i + 2] = toHalf(b);
      data[i + 3] = toHalf(stretch(a, 2.0));
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, HalfFloatType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Tileable ripple normal map (xy packed in rg, height in b). Exactly periodic via integer frequencies. */
export function makeRippleNormalTexture(size = 512): DataTexture {
  const rng = new Rng(2024);
  const waves: { fx: number; fy: number; a: number; ph: number; ridge: number }[] = [];
  for (let i = 0; i < 34; i++) {
    const f = 3 + Math.floor(rng.next() ** 1.6 * 40);
    const ang = rng.range(0, TAU);
    const fx = Math.round(Math.cos(ang) * f) || 1;
    const fy = Math.round(Math.sin(ang) * f) || 1;
    const len = Math.hypot(fx, fy);
    waves.push({ fx, fy, a: 1 / len ** 1.05, ph: rng.range(0, TAU), ridge: rng.next() < 0.45 ? 1 : 0 });
  }
  const data = new Uint8Array(size * size * 4);
  const k = TAU / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let gx = 0;
      let gy = 0;
      let h = 0;
      for (const w of waves) {
        const th = (w.fx * x + w.fy * y) * k + w.ph;
        const s = Math.sin(th);
        const c = Math.cos(th);
        if (w.ridge) {
          // ridged: crisp crests => painterly "stroke" ripples
          const sg = s >= 0 ? 1 : -1;
          h += w.a * (1 - Math.abs(s)) * 0.6;
          const d = -sg * c * w.a * 0.6 * k;
          gx += d * w.fx;
          gy += d * w.fy;
        } else {
          h += w.a * s * 0.5;
          gx += w.a * c * 0.5 * k * w.fx;
          gy += w.a * c * 0.5 * k * w.fy;
        }
      }
      const sc = 22;
      let nx = -gx * sc;
      let ny = -gy * sc;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = Math.max(0, Math.min(255, (h * 1.4 + 0.5) * 255));
      data[i + 3] = 255;
    }
  }
  return makeTex(data, size);
}

// --- data textures baked from the geography ------------------------------------------------------

function halfTex(data: Uint16Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** RGBA16F: R height (m), G swell exposure, B haystack mask, A floor kind. */
export function makeGeoTexture(geo: GeoGrid): DataTexture {
  const d = new Uint16Array(NX * NZ * 4);
  for (let i = 0; i < NX * NZ; i++) {
    d[i * 4] = toHalf(geo.height[i] as number);
    d[i * 4 + 1] = toHalf(geo.swell[i] as number);
    d[i * 4 + 2] = toHalf(geo.hay[i] as number);
    d[i * 4 + 3] = toHalf(geo.kind[i] as number);
  }
  return halfTex(d, NX, NZ);
}

/** RGBA16F: RG unit tidal flow (ebb positive). */
export function makeFlowTexture(geo: GeoGrid): DataTexture {
  const d = new Uint16Array(FLOW_NX * FLOW_NZ * 4);
  for (let i = 0; i < FLOW_NX * FLOW_NZ; i++) {
    d[i * 4] = toHalf(geo.flowX[i] as number);
    d[i * 4 + 1] = toHalf(geo.flowZ[i] as number);
    d[i * 4 + 3] = toHalf(1);
  }
  return halfTex(d, FLOW_NX, FLOW_NZ);
}
