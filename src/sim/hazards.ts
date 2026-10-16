// Floating hazards that make the Cut harder to read: crab-pot floats (foul the prop) and drift logs
// (hard hits). Placed deterministically along the course; logs drift with the tide.

import { Rng } from '../core/math';
import type { Location } from '../locations/types';
import type { DynamicObstacles } from './boatEnv';
import type { Environment } from './environment';

export interface Hazard {
  kind: 'pot' | 'log';
  x: number;
  z: number;
  /** Heading of a log (radians, atan2(dz, dx)). */
  yaw: number;
  /** Collision radius (m). */
  r: number;
  alive: boolean;
  phase: number;
  /** Visual scale / variation. */
  size: number;
}

export interface HazardPath {
  path: { x: number; z: number; s: number }[];
  length: number;
}

export class Hazards {
  readonly list: Hazard[] = [];

  constructor(private readonly loc: Location) {}

  /** Scatter hazards along the path. `perKm` is the density; the first and last stretches stay clear. */
  generate(course: HazardPath, perKm: number, seed = 1313): void {
    this.list.length = 0;
    const { seabedHeight, hardSDF } = this.loc.fields;
    const rng = new Rng(seed);
    const total = Math.round((course.length / 1000) * perKm);
    let tries = 0;
    while (this.list.length < total && tries++ < total * 40) {
      const s = rng.range(160, course.length - 220);
      // nearest path point (path is ordered by s)
      let i = 0;
      while (i < course.path.length - 1 && (course.path[i + 1] as { s: number }).s < s) i++;
      const a = course.path[i] as { x: number; z: number };
      const b = course.path[Math.min(i + 1, course.path.length - 1)] as { x: number; z: number };
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / l;
      const nz = (b.x - a.x) / l;
      const half = Math.max(14, Math.min(46, this.loc.corridorHalf(a.x) * 0.7));
      // clusters of pots (a trap line), singles for logs
      const kind: Hazard['kind'] = rng.next() < 0.7 ? 'pot' : 'log';
      const lat = (rng.next() + rng.next() - 1) * half;
      const x = a.x + nx * lat;
      const z = a.z + nz * lat;
      if (-seabedHeight(x, z) < 2.4 || hardSDF(x, z) < 8) continue;
      // the marina basin has its own obstacles
      if (this.loc.keepClear?.(x, z)) continue;
      const n = kind === 'pot' ? 1 + Math.floor(rng.next() * 3) : 1;
      for (let k = 0; k < n; k++) {
        const hx = x + (k === 0 ? 0 : rng.range(-9, 9));
        const hz = z + (k === 0 ? 0 : rng.range(-9, 9));
        this.list.push({
          kind,
          x: hx,
          z: hz,
          yaw: rng.range(0, Math.PI * 2),
          r: kind === 'pot' ? 0.5 : 0.7,
          alive: true,
          phase: rng.range(0, 6.28),
          size: kind === 'pot' ? rng.range(0.85, 1.2) : rng.range(0.8, 1.3),
        });
      }
    }
  }

  /** Drift the logs with the tide. */
  update(dt: number, env: Environment): void {
    const c = { x: 0, z: 0 };
    for (const h of this.list) {
      if (!h.alive || h.kind !== 'log') continue;
      env.currentAt(h.x, h.z, c);
      h.x += c.x * 0.85 * dt;
      h.z += c.z * 0.85 * dt;
    }
  }

  /** Logs are hard obstacles (three circles along their length); call after clearing `dyn`. */
  addObstacles(dyn: DynamicObstacles): void {
    for (const h of this.list) {
      if (!h.alive || h.kind !== 'log') continue;
      const dx = Math.cos(h.yaw) * 1.7 * h.size;
      const dz = Math.sin(h.yaw) * 1.7 * h.size;
      dyn.add(h.x, h.z, h.r * h.size);
      dyn.add(h.x + dx, h.z + dz, h.r * h.size);
      dyn.add(h.x - dx, h.z - dz, h.r * h.size);
    }
  }

  /**
   * Did the hull (a segment fore-aft through its centre) run over a crab-pot float? The float is
   * consumed and returned so the caller can foul the prop.
   */
  pots(x: number, z: number, fx: number, fz: number, length: number, beam: number): Hazard | null {
    for (const h of this.list) {
      if (!h.alive || h.kind !== 'pot') continue;
      const dx = h.x - x;
      const dz = h.z - z;
      if (dx * dx + dz * dz > (length + 4) ** 2) continue;
      const along = Math.max(-length * 0.5, Math.min(length * 0.5, dx * fx + dz * fz));
      const px = x + fx * along;
      const pz = z + fz * along;
      if (Math.hypot(h.x - px, h.z - pz) < h.r + beam * 0.45) {
        h.alive = false;
        return h;
      }
    }
    return null;
  }
}
