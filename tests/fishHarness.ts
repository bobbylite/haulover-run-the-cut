// A kinematic stand-in for the boat, and scripted captains, so the fight can be balanced in milliseconds.
// (The full-physics run lives in montauk.mode.test.ts.)

import { Rng } from '../src/core/math';
import { Fight, type FightInput } from '../src/sim/fishing/fight';
import { SPECIES, type SpeciesId } from '../src/sim/fishing/species';
import { tierById } from '../src/sim/fishing/tiers';

export interface Sea {
  /** Tidal current (m/s) and the leeway the wind gives the boat (m/s). */
  cx: number;
  cz: number;
  wx: number;
  wz: number;
  /** Mean slam rate (per second) and size, to mimic steep seas. */
  slams: number;
}

export const SEA: Sea = { cx: 1.0, cz: 0.1, wx: -0.8, wz: 0, slams: 0 };

export class KBoat {
  x = 0;
  z = 0;
  heading = 0;
  /** Speed through the water along the heading. */
  u = 3.3;
  throttle = 0.3;
  steer = 0;
  vx = 0;
  vz = 0;
  constructor(
    public len = 11,
    public top = 12,
  ) {}

  step(dt: number, sea: Sea): void {
    const target = this.throttle >= 0 ? this.throttle * this.top : this.throttle * 5.5;
    this.u += ((target - this.u) / (target > this.u ? 2.4 : 1.6)) * dt;
    this.heading +=
      this.steer * 0.55 * Math.min(1, Math.abs(this.u) / 3 + 0.35) * dt * (this.u < -0.2 ? -1 : 1);
    this.vx = Math.cos(this.heading) * this.u + sea.cx + sea.wx;
    this.vz = Math.sin(this.heading) * this.u + sea.cz + sea.wz;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  get sx(): number {
    return this.x - Math.cos(this.heading) * this.len * 0.5;
  }
  get sz(): number {
    return this.z - Math.sin(this.heading) * this.len * 0.5;
  }
}

/** Decide the controls for this frame. */
export type Pilot = (
  f: Fight,
  b: KBoat,
  t: number,
) => { throttle: number; steer: number; drag: number; pump: boolean };

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const steerTo = (b: KBoat, target: number): number =>
  Math.max(-1, Math.min(1, wrap(target - b.heading) * 2.2));

/**
 * A competent captain. On a run: let it take line, then chase it bow-first. Otherwise: stern to the fish,
 * hold the gap steady by feel for tension, and creep in only once it is tired.
 */
export const captain: Pilot = (f, b) => {
  const dx = f.x - b.sx;
  const dz = f.z - b.sz;
  const d = Math.max(1, Math.hypot(dx, dz));
  const bearing = Math.atan2(dz, dx);
  const fvx = f.ux + SEA.cx;
  const fvz = f.uz + SEA.cz;
  const away = (fvx * dx + fvz * dz) / d;
  const boatToward = (b.vx * dx + b.vz * dz) / d;
  const w = f.warning;
  const runningSoon = f.mood === 'run' || w?.mood === 'run' || w?.mood === 'dash' || f.mood === 'dash';
  // give line on a run, hold it otherwise
  let drag = 0.5;
  if (runningSoon) drag = 0.04;
  else if (f.T > 0.8) drag = 0.32;
  else if (f.T < 0.28 && f.stam < 0.7 && f.mood !== 'thrash') drag = 0.6;
  const spoolFrac = f.L / 320;
  const chase = (f.mood === 'run' || f.mood === 'dash' || away > 2.4 || f.slip > 1.5) && d > 10;
  if (chase) {
    const off = Math.abs(wrap(bearing - b.heading));
    if (off > 0.8 && spoolFrac < 0.4) return { throttle: 0.1, steer: steerTo(b, bearing), drag, pump: false };
    // match the speed the line is going out at
    const want = Math.max(1.2, f.slip * 0.9, away * 0.8);
    const throttle = Math.min(0.95, Math.max(0.1, 0.2 + 0.1 * (want - boatToward)));
    return { throttle, steer: steerTo(b, bearing), drag, pump: false };
  }
  // stern to the fish: heading points away from it
  const awayHdg = wrap(bearing + Math.PI);
  const off = Math.abs(wrap(awayHdg - b.heading));
  let throttle = 0;
  if (off > 0.45 && d > 12) throttle = f.T < 0.15 && boatToward > 0.4 ? -0.2 : 0;
  else {
    // keep the tension around 0.4 by easing away (forward, since the stern is to the fish) or in (astern)
    throttle = Math.max(-0.3, Math.min(0.3, 0.7 * (0.4 - f.T)));
    if (f.stam < 0.3 && d > 14) throttle = Math.min(throttle, -0.12); // it is spent: back down on it
    if (d < 12 && f.depth > 5) throttle = 0.25; // it is under the boat: ease away
  }
  return {
    throttle,
    steer: steerTo(b, awayHdg),
    drag,
    pump: (f.mood === 'sulk' || f.stam < 0.5) && f.T < 0.55 && Math.abs(f.theta) < 0.6,
  };
};

/** Out of gear, wheel amidships, hands off. */
export const idle: Pilot = () => ({ throttle: 0, steer: 0, drag: 0.5, pump: false });

/** Keeps trolling speed on after the strike. */
export const keepGoing: Pilot = () => ({ throttle: 0.35, steer: 0, drag: 0.5, pump: false });

/** Drives away from the fish at speed whatever it does. */
export const powerAway: Pilot = () => ({ throttle: 0.7, steer: 0, drag: 0.5, pump: false });

/** Yanks the drag to the stops and sits still. */
export const lockedDrag: Pilot = () => ({ throttle: 0, steer: 0, drag: 1, pump: true });

export interface Result {
  end: string;
  t: number;
  clean: number;
  peak: number;
  stam: number;
}

export function fightOnce(
  tier: string,
  species: SpeciesId,
  kg: number,
  seed: number,
  pilot: Pilot,
  sea: Sea = SEA,
  maxT = 420,
): Result {
  const b = new KBoat();
  const rng = new Rng(seed * 7 + 1);
  const dt = 1 / 30;
  // hooked 30 m astern, lines out 36 m, 6 m down, boat trolling east
  const f = new Fight(SPECIES[species], kg, tierById(tier), seed, {
    x: b.sx - 30,
    z: b.sz,
    depth: 6,
    line: 36,
  });
  for (let t = 0; t < maxT; t += dt) {
    const c = pilot(f, b, t);
    b.throttle = c.throttle;
    b.steer = c.steer;
    b.step(dt, sea);
    const slam = sea.slams > 0 && rng.next() < sea.slams * dt ? rng.range(2, 8) : 0;
    const inp: FightInput = {
      sx: b.sx,
      sz: b.sz,
      fx: Math.cos(b.heading),
      fz: Math.sin(b.heading),
      vx: b.vx - sea.cx,
      vz: b.vz - sea.cz,
      boatLen: b.len,
      slam,
      rough: sea.slams > 0 ? 0.7 : 0.2,
      heave: (sea.slams > 0 ? 1.1 : 0.15) * Math.sin((t / 7.5) * Math.PI * 2),
      floor: () => 40,
      current: (_x, _z, out) => {
        out.x = sea.cx;
        out.z = sea.cz;
      },
      drag: c.drag,
      pump: c.pump,
    };
    f.step(dt, inp);
    if (f.end) return { end: f.end.kind, t, clean: f.cleanPct, peak: f.peakT, stam: f.stam };
  }
  return { end: 'timeout', t: maxT, clean: f.cleanPct, peak: f.peakT, stam: f.stam };
}

export function landRate(
  tier: string,
  species: SpeciesId,
  kg: number,
  pilot: Pilot,
  n = 24,
  sea: Sea = SEA,
): { rate: number; ends: Record<string, number>; meanT: number } {
  const ends: Record<string, number> = {};
  let land = 0;
  let tt = 0;
  for (let s = 1; s <= n; s++) {
    const r = fightOnce(tier, species, kg, s, pilot, sea);
    ends[r.end] = (ends[r.end] ?? 0) + 1;
    if (r.end === 'landed') {
      land++;
      tt += r.t;
    }
  }
  return { rate: land / n, ends, meanT: land ? tt / land : 0 };
}
