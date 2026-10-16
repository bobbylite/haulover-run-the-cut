// Gerstner wave field. The GPU water shader (render/water.ts) evaluates the *same* maths from the
// same parameters, so a boat's buoyancy samples sit exactly on the surface the player sees.

import { clamp } from '../core/math';
import type { GeoGrid } from './geoGrid';

export const SWELL_COUNT = 3;
export const CHOP_COUNT = 5;
export const HAY_COUNT = 4;
export const NUM_WAVES = SWELL_COUNT + CHOP_COUNT + HAY_COUNT;
export const GRAVITY = 9.81;

export interface SeaState {
  /** Significant height of the open-ocean swell (m). */
  swellHeight: number;
  /** Direction swell travels *towards* (radians, atan2(z, x)). */
  swellDir: number;
  /** Multiplier on swell wavelength (long, slow period > 1). */
  swellLength: number;
  /** Wind-chop height scale (m). */
  chopHeight: number;
  /** Direction the wind-chop travels towards. */
  chopDir: number;
  /** Standing-wave ("haystack") amplitude in the inlet throat / bar (0..~1.3). */
  hay: number;
  /** Direction the tidal current runs in the throat (radians). Haystacks run against it. */
  currentDir: number;
  /** Extra crest sharpening (1 = nominal). */
  sharpness: number;
}

export interface WaveSample {
  /** Surface elevation (m). */
  h: number;
  /** Surface point velocity (orbital): horizontal x/z and vertical y. */
  vx: number;
  vy: number;
  vz: number;
  /** Surface normal (world). */
  nx: number;
  ny: number;
  nz: number;
  /** Folding measure: <0.3 means breaking crest. */
  jac: number;
}

/** Dominant wave axis at a point (see `WaveField.axisAt`). */
export interface WaveAxis {
  /** Direction of the wave axis, radians in atan2(z, x) convention, modulo pi. */
  angle: number;
  /** Significant wave height proxy (m). */
  hs: number;
  /** 0..1: how aligned the wave trains are. */
  coherence: number;
  /** Direction the strongest wave train travels *towards* (atan2(z, x)); `angle` is this modulo pi. */
  travel: number;
}

export const makeWaveAxis = (): WaveAxis => ({ angle: 0, hs: 0, coherence: 0, travel: 0 });

export const makeWaveSample = (): WaveSample => ({ h: 0, vx: 0, vy: 0, vz: 0, nx: 0, ny: 1, nz: 0, jac: 1 });

const SWELL_LEN = [78, 52, 34];
const SWELL_W = [0.3, 0.2, 0.12];
const SWELL_ANG = [0, 0.2, -0.28];
const CHOP_LEN = [24, 16, 10.5, 7, 4.6];
const CHOP_W = [0.27, 0.22, 0.17, 0.11, 0.07];
const CHOP_ANG = [0, 0.34, -0.4, 0.7, -0.66];
const HAY_LEN = [16, 12, 9.2, 7];
const HAY_W = [0.38, 0.32, 0.26, 0.2];
const HAY_ANG = [0.45, -0.45, 0.18, -0.18];

const PHASES = [0.4, 2.1, 4.3, 1.1, 3.7, 5.2, 0.9, 2.8, 4.9, 1.6, 3.3, 5.8];

const TWO_PI = Math.PI * 2;

export class WaveField {
  readonly dirX = new Float32Array(NUM_WAVES);
  readonly dirZ = new Float32Array(NUM_WAVES);
  readonly k = new Float32Array(NUM_WAVES);
  readonly amp = new Float32Array(NUM_WAVES);
  readonly steep = new Float32Array(NUM_WAVES);
  readonly omega = new Float32Array(NUM_WAVES);
  readonly phase = new Float32Array(NUM_WAVES);

  hMaxSwell = 1;
  hMaxChop = 1;
  hayStrength = 0;
  state: SeaState = {
    swellHeight: 0.5,
    swellDir: Math.PI,
    swellLength: 1,
    chopHeight: 0.2,
    chopDir: Math.PI,
    hay: 0,
    currentDir: 0,
    sharpness: 1,
  };

  constructor(readonly geo: GeoGrid) {
    this.configure(this.state);
  }

  configure(s: SeaState): void {
    this.state = { ...s };
    let i = 0;
    let sumSwell = 0;
    let sumChop = 0;
    // swell
    for (let n = 0; n < SWELL_COUNT; n++, i++) {
      const lam = (SWELL_LEN[n] as number) * s.swellLength;
      const k = TWO_PI / lam;
      const a = s.swellHeight * (SWELL_W[n] as number);
      const ang = s.swellDir + (SWELL_ANG[n] as number);
      this.set(i, ang, k, a, 2.4 * s.sharpness, Math.sqrt(GRAVITY * k));
      sumSwell += a;
    }
    // wind chop
    for (let n = 0; n < CHOP_COUNT; n++, i++) {
      const k = TWO_PI / (CHOP_LEN[n] as number);
      const a = s.chopHeight * (CHOP_W[n] as number);
      const ang = s.chopDir + (CHOP_ANG[n] as number);
      this.set(i, ang, k, a, 2.1 * s.sharpness, Math.sqrt(GRAVITY * k));
      sumChop += a;
    }
    // standing waves running against the current
    for (let n = 0; n < HAY_COUNT; n++, i++) {
      const k = TWO_PI / (HAY_LEN[n] as number);
      const a = 1.0 * (HAY_W[n] as number);
      const ang = s.currentDir + Math.PI + (HAY_ANG[n] as number);
      this.set(i, ang, k, a, 1.3 * s.sharpness, 0.18 * Math.sqrt(GRAVITY * k));
    }
    this.hMaxSwell = sumSwell * 1.7 + 0.1;
    this.hMaxChop = sumChop * 1.7 + 0.1;
    this.hayStrength = s.hay;
    for (let n = 0; n < NUM_WAVES; n++) this.phase[n] = PHASES[n] as number;
  }

  private set(i: number, ang: number, k: number, a: number, q: number, w: number): void {
    this.dirX[i] = Math.cos(ang);
    this.dirZ[i] = Math.sin(ang);
    this.k[i] = k;
    this.amp[i] = a;
    // steepness S = Q*A*k, clamped so isolated waves never loop on their own
    this.steep[i] = Math.min(0.9, q * k * a);
    this.omega[i] = w;
  }

  /** Modulation weights (swell, chop, haystack) at a world position. */
  modulation(x: number, z: number, out: { s: number; c: number; h: number }): void {
    const geo = this.geo;
    const depth = Math.max(0, -geo.heightAt(x, z));
    const exp = geo.swellAt(x, z);
    const bfS = clamp((depth + 0.15) / (this.hMaxSwell * 0.9 + 0.2), 0, 1);
    const bfC = clamp((depth + 0.15) / (this.hMaxChop * 0.9 + 0.2), 0, 1);
    out.s = exp * bfS;
    out.c = (0.45 + 0.55 * exp) * bfC;
    out.h = geo.hayAt(x, z) * this.hayStrength;
  }

  private readonly mod = { s: 1, c: 1, h: 0 };

  /** Evaluate the surface at world (x, z) and time t. */
  sample(x: number, z: number, t: number, o: WaveSample): void {
    const m = this.mod;
    this.modulation(x, z, m);
    const ms = m.s;
    const mc = m.c;
    const mh = m.h;
    const dx = this.dirX;
    const dz = this.dirZ;
    const K = this.k;
    const A = this.amp;
    const S = this.steep;
    const W = this.omega;
    const P = this.phase;

    // invert the horizontal Gerstner displacement (fixed point, 3 iterations)
    let px = x;
    let pz = z;
    for (let it = 0; it < 3; it++) {
      let ox = 0;
      let oz = 0;
      for (let i = 0; i < NUM_WAVES; i++) {
        const g = i < SWELL_COUNT ? ms : i < SWELL_COUNT + CHOP_COUNT ? mc : mh;
        const th =
          (K[i] as number) * ((dx[i] as number) * px + (dz[i] as number) * pz) -
          (W[i] as number) * t +
          (P[i] as number);
        const f = ((S[i] as number) * g * Math.cos(th)) / (K[i] as number);
        ox += f * (dx[i] as number);
        oz += f * (dz[i] as number);
      }
      px = x - ox;
      pz = z - oz;
    }

    let h = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let gx = 0;
    let gz = 0;
    let mxx = 0;
    let mzz = 0;
    let mxz = 0;
    for (let i = 0; i < NUM_WAVES; i++) {
      const g = i < SWELL_COUNT ? ms : i < SWELL_COUNT + CHOP_COUNT ? mc : mh;
      const ddx = dx[i] as number;
      const ddz = dz[i] as number;
      const k = K[i] as number;
      const w = W[i] as number;
      const th = k * (ddx * px + ddz * pz) - w * t + (P[i] as number);
      const s = Math.sin(th);
      const c = Math.cos(th);
      const a = (A[i] as number) * g;
      const st = (S[i] as number) * g;
      h += a * s;
      vy += -a * w * c;
      const hv = (st / k) * w * s;
      vx += hv * ddx;
      vz += hv * ddz;
      const gk = a * k * c;
      gx += gk * ddx;
      gz += gk * ddz;
      const ss = st * s;
      mxx += ss * ddx * ddx;
      mzz += ss * ddz * ddz;
      mxz += ss * ddx * ddz;
    }
    const det = Math.max(0.12, (1 - mxx) * (1 - mzz) - mxz * mxz);
    const ngx = ((1 - mzz) * gx + mxz * gz) / det;
    const ngz = (mxz * gx + (1 - mxx) * gz) / det;
    const inv = 1 / Math.hypot(ngx, 1, ngz);
    o.h = h;
    o.vx = vx;
    o.vy = vy;
    o.vz = vz;
    o.nx = -ngx * inv;
    o.ny = inv;
    o.nz = -ngz * inv;
    o.jac = (1 - mxx) * (1 - mzz) - mxz * mxz;
  }

  /**
   * The dominant wave *axis* at a point (the line the wave trains travel along, modulo 180 degrees), a
   * significant-height proxy, and how coherent the sea is. Components are weighted by their orbital speed
   * and summed as double angles so opposed trains (swell vs. a standing haystack) reinforce one axis
   * instead of cancelling.
   */
  axisAt(x: number, z: number, out: WaveAxis): void {
    const m = this.mod;
    this.modulation(x, z, m);
    let c2 = 0;
    let s2 = 0;
    let wSum = 0;
    let a2 = 0;
    let wBest = 0;
    let thBest = 0;
    for (let i = 0; i < NUM_WAVES; i++) {
      const g = i < SWELL_COUNT ? m.s : i < SWELL_COUNT + CHOP_COUNT ? m.c : m.h;
      const a = (this.amp[i] as number) * g;
      if (a <= 1e-4) continue;
      const w = a * Math.sqrt(GRAVITY * (this.k[i] as number));
      const th = Math.atan2(this.dirZ[i] as number, this.dirX[i] as number);
      if (w > wBest) {
        wBest = w;
        thBest = th;
      }
      c2 += w * Math.cos(2 * th);
      s2 += w * Math.sin(2 * th);
      wSum += w;
      a2 += a * a;
    }
    out.angle = wSum > 1e-6 ? 0.5 * Math.atan2(s2, c2) : 0;
    out.coherence = wSum > 1e-6 ? Math.hypot(c2, s2) / wSum : 0;
    out.travel = thBest;
    // Hs = 4 sigma, with sigma^2 = sum(a^2)/2 for a sum of sinusoids
    out.hs = 2.83 * Math.sqrt(a2);
  }

  /** Just the height (cheaper; used by camera / buoys). */
  height(x: number, z: number, t: number): number {
    this.sample(x, z, t, this.tmp);
    return this.tmp.h;
  }
  private readonly tmp = makeWaveSample();
}
