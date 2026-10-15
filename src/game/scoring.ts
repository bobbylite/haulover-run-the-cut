// Pure scoring rules (unit-tested).

import { clamp } from '../core/math';

export interface ScoreInput {
  time: number;
  par: number;
  /** Peak water as a fraction of the allowed capacity (0..1). */
  peakFrac: number;
  /** Lateral offsets (-1..1) per gate, null when the gate was missed. */
  offsets: (number | null)[];
  collisions: number;
  difficultyMult: number;
  /** Hull integrity left, 0..1 (defaults to pristine). */
  hull?: number;
  /** Points banked by the Wave Rider streak and clean jumps. */
  ride?: number;
  /** Docking result, when the course ends in the marina. */
  dock?: { docked: boolean; timeFrac: number; speed: number; alignErr: number; touches: number };
}

export interface ScoreResult {
  score: number;
  stars: number;
  parts: {
    base: number;
    time: number;
    dry: number;
    gates: number;
    crash: number;
    dock: number;
    hull: number;
    ride: number;
  };
}

/** A fair par time for a run of `length` metres in a boat that tops out at `topSpeed`. */
export const parTime = (length: number, topSpeed: number): number => length / (0.62 * topSpeed) + 10;

export function computeScore(i: ScoreInput): ScoreResult {
  const base = 1000;
  const time = clamp((i.par - i.time) * 18, 0, 1500);
  const dry = 1500 * (1 - clamp(i.peakFrac, 0, 1)) ** 1.2;
  let gates = 0;
  for (const o of i.offsets) if (o !== null) gates += 120 * (1 - 0.6 * Math.min(1, Math.abs(o)));
  const crash = i.collisions * 150;
  // a sound hull and a well-ridden sea are worth points; the streak bonus is capped
  const hull = 300 * clamp(i.hull ?? 1, 0, 1) ** 1.5;
  const ride = clamp(i.ride ?? 0, 0, 900);
  // docking: a clean, quick, gentle, square berth is worth a big bonus
  let dock = 0;
  if (i.dock?.docked) {
    const d = i.dock;
    dock =
      700 +
      500 * clamp(d.timeFrac, 0, 1) +
      250 * (1 - clamp(d.speed / 0.9, 0, 1)) +
      150 * (1 - clamp(d.alignErr / 0.38, 0, 1)) -
      140 * d.touches;
    dock = Math.max(150, dock);
  }
  const raw = base + time + dry + gates - crash + dock + hull + ride;
  const score = Math.max(0, Math.round(raw * i.difficultyMult));
  let stars = 1;
  if (i.peakFrac < 0.6 && i.collisions <= 1) stars = 2;
  if (i.peakFrac < 0.35 && i.collisions === 0 && i.time <= i.par * 1.15 && (!i.dock || i.dock.touches === 0))
    stars = 3;
  return { score, stars, parts: { base, time, dry, gates, crash, dock, hull, ride } };
}
