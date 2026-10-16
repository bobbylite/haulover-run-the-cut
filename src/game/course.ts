// Courses: ordered gates (buoy pairs), a centre-line path for progress, and a finish, plus the helpers that
// score a boat against one. A location builds its own routes (see locations/haulover/course.ts); a course
// that comes home can end with a docking challenge.

import type { SlipBerth } from '../locations/types';

export type Route = 'full' | 'outbound' | 'inbound';

export interface Gate {
  index: number;
  x: number;
  z: number;
  /** Unit direction of travel through the gate. */
  nx: number;
  nz: number;
  half: number;
  label: string;
  kind: 'gate' | 'bridge' | 'finish' | 'turn' | 'dock';
}

/** The docking challenge at the end of the run. */
export interface DockPlan {
  slip: SlipBerth;
  approach: readonly (readonly [number, number])[];
  /** Index of the gate that starts the docking phase (the Marina Entrance). */
  startGate: number;
}

export interface Course {
  route: Route;
  gates: Gate[];
  start: { x: number; z: number; heading: number };
  length: number;
  path: { x: number; z: number; s: number }[];
  dock?: DockPlan;
  title: string;
}

export interface GateCrossing {
  gate: Gate;
  /** -1..1 lateral offset across the gate (0 = dead centre). */
  offset: number;
}

/** Did the segment p0 -> p1 cross this gate line within its width? */
export function crossedGate(
  g: Gate,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  margin = 6,
): GateCrossing | null {
  const d0 = (x0 - g.x) * g.nx + (z0 - g.z) * g.nz;
  const d1 = (x1 - g.x) * g.nx + (z1 - g.z) * g.nz;
  if (!(d0 < 0 && d1 >= 0)) return null;
  const t = d0 / (d0 - d1);
  const px = x0 + (x1 - x0) * t;
  const pz = z0 + (z1 - z0) * t;
  // lateral axis = perpendicular (pointing south/right of travel for east-bound gates)
  const lat = (px - g.x) * -g.nz + (pz - g.z) * g.nx;
  if (Math.abs(lat) > g.half + margin) return null;
  return { gate: g, offset: lat / g.half };
}

/** Progress along the centre line (0..1), by nearest path segment. */
export function pathProgress(
  c: Course,
  x: number,
  z: number,
  hint = 0,
): { s: number; frac: number; lateral: number; idx: number } {
  const p = c.path;
  let best = Infinity;
  let bestS = 0;
  let bestIdx = hint;
  let lateral = 0;
  const from = Math.max(0, hint - 8);
  const to = Math.min(p.length - 1, hint + 40);
  for (let i = from; i < to; i++) {
    const a = p[i] as (typeof p)[number];
    const b = p[i + 1] as (typeof p)[number];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2));
    const qx = a.x + abx * t;
    const qz = a.z + abz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best) {
      best = d;
      bestS = a.s + (b.s - a.s) * t;
      bestIdx = i;
      lateral = ((x - qx) * -abz + (z - qz) * abx) / Math.sqrt(l2);
    }
  }
  return { s: bestS, frac: bestS / c.length, lateral, idx: bestIdx };
}
