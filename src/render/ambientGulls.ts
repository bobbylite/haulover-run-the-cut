// Ambient gulls: a loose flock that wheels over the shore and drifts out to the boat. (The birds that *mean*
// something, working over bait, belong to the fishing game, not the place.) Shared by every location.

import { clamp, Rng } from '../core/math';
import type { WildlifeInput } from '../locations/types';
import { BirdFlock, GULL } from './birds';

interface Gull {
  cx: number;
  cz: number;
  r: number;
  ang: number;
  dir: number;
  alt: number;
  speed: number;
  seed: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  amp: number;
}

export class AmbientGulls {
  readonly flock: BirdFlock;
  private readonly gulls: Gull[] = [];
  private readonly rng = new Rng(4242);
  private t = 0;
  private placed = false;

  constructor(count = 18) {
    this.flock = new BirdFlock(GULL, count, 'gulls');
    for (let i = 0; i < count; i++) {
      this.gulls.push({
        cx: 0,
        cz: 0,
        r: 0,
        ang: this.rng.next() * 6.28,
        dir: this.rng.next() < 0.5 ? -1 : 1,
        alt: 0,
        speed: 0,
        seed: this.rng.next() * 100,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        bank: 0,
        amp: 0.1,
      });
    }
  }

  private place(g: Gull, px: number, pz: number): void {
    const r = this.rng;
    const a = r.next() * 6.283;
    const d = 120 + r.next() * 700;
    g.cx = px + Math.cos(a) * d;
    g.cz = pz + Math.sin(a) * d;
    g.r = 30 + r.next() * 90;
    g.alt = 12 + r.next() * 36;
    g.speed = 6 + r.next() * 3;
  }

  update(dt: number, inp: WildlifeInput): void {
    this.t += dt;
    const show = Math.ceil(this.gulls.length * inp.fair);
    for (const [i, g] of this.gulls.entries()) {
      if (!this.placed || Math.hypot(g.cx - inp.x, g.cz - inp.z) > 1100) this.place(g, inp.x, inp.z);
      g.ang += (g.speed / g.r) * g.dir * dt;
      const rr = g.r + Math.sin(this.t * 0.7 + g.seed) * g.r * 0.12;
      const nx = g.cx + Math.cos(g.ang) * rr;
      const nz = g.cz + Math.sin(g.ang) * rr;
      const ny = g.alt + Math.sin(this.t * 0.31 + g.seed * 1.3) * 3.5;
      if (g.y === 0) {
        g.x = nx;
        g.y = ny;
        g.z = nz;
      }
      const hx = nx - g.x;
      const hz = nz - g.z;
      if (hx * hx + hz * hz > 1e-8) g.heading = Math.atan2(hz, hx);
      g.bank +=
        (-g.dir * clamp((g.speed * g.speed) / (9.81 * Math.max(g.r, 6)), 0, 0.6) - g.bank) *
        Math.min(1, dt * 2);
      g.x = nx;
      g.y = ny;
      g.z = nz;
      const burst = clamp((Math.sin(this.t * 0.23 + g.seed * 3.1) - 0.35) * 2.2, 0, 1);
      g.amp += (0.12 + burst * 0.78 - g.amp) * Math.min(1, dt * 2);
      this.flock.set(i, g.x, g.y, g.z, g.heading, g.bank, 0, 0.85, g.seed, g.amp, 12);
    }
    this.placed = true;
    this.flock.commit(show);
  }
}
