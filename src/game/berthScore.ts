// Pure scoring for a berthing attempt (unit-tested). A good finish is quick, gentle, square and exact; each
// bump, each call to the tugs and every bit of hull lost costs something.

import { clamp } from '../core/math';
import type { BerthRules } from './berthing';

export interface BerthScoreInput {
  docked: boolean;
  /** Fraction of the time limit still on the clock when the finish was held. */
  timeFrac: number;
  /** Error at the finish: metres along and across, radians of heading, m/s of ground speed. */
  along: number;
  across: number;
  align: number;
  speed: number;
  rules: BerthRules;
  touches: number;
  /** Hull integrity left, 0..1. */
  hull: number;
  /** Tug calls used, and how many came free with the level. */
  tugCalls: number;
  tugFree: number;
  /** Difficulty x vessel multiplier. */
  mult: number;
}

export interface BerthScore {
  score: number;
  stars: number;
  parts: {
    base: number;
    precision: number;
    time: number;
    gentle: number;
    hull: number;
    bumps: number;
    tugs: number;
  };
}

export function scoreBerth(i: BerthScoreInput): BerthScore {
  const r = i.rules;
  if (!i.docked) {
    return {
      score: 0,
      stars: 0,
      parts: { base: 0, precision: 0, time: 0, gentle: 0, hull: 0, bumps: 0, tugs: 0 },
    };
  }
  const base = 800;
  // how exact: 1 at dead centre, 0 at the edge of the tolerance
  const eAlong = r.along >= 99 ? 0 : clamp(Math.abs(i.along) / r.along, 0, 1);
  const eAcross = r.across >= 99 ? 0 : clamp(Math.abs(i.across) / r.across, 0, 1);
  const eAlign = r.align >= Math.PI ? 0 : clamp(i.align / r.align, 0, 1);
  const exact = 1 - (eAlong + eAcross + eAlign) / 3;
  const precision = 600 * exact;
  const time = 600 * clamp(i.timeFrac, 0, 1);
  const gentle = 250 * (1 - clamp(i.speed / r.speed, 0, 1));
  const hull = 300 * clamp(i.hull, 0, 1) ** 1.5;
  const bumps = -160 * i.touches;
  const tugs = -90 * Math.max(0, i.tugCalls - i.tugFree);
  const raw = Math.max(250, base + precision + time + gentle + hull + bumps + tugs);
  const score = Math.round(raw * i.mult);
  let stars = 1;
  if (i.touches <= 1 && i.hull >= 0.85 && i.tugCalls <= i.tugFree + 1) stars = 2;
  if (i.touches === 0 && i.hull >= 0.95 && exact > 0.45 && i.timeFrac > 0.25 && i.tugCalls <= i.tugFree)
    stars = 3;
  return { score, stars, parts: { base, precision, time, gentle, hull, bumps, tugs } };
}
