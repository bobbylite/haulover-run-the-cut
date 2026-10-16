// The berth rules (Nantucket): where a vessel has to finish for a berth, how close counts, and a session that
// watches one attempt. Pure: numbers in, numbers out, so the test pilot and the unit tests drive it on a bare
// `Boat` with no renderer.
//
// A berth's geometry is vessel-independent (see `Berth` in locations/types.ts); `berthTarget` turns it into the
// pose a particular hull has to end up in, and `berthRules` into how forgiving the finish is. Everything is
// measured in the berth's own frame: `along` runs with the quay or down the slip, `across` is the other way.

import { clamp, wrapAngle } from '../core/math';
import type { Berth } from '../locations/types';
import type { Boat, BoatEnv } from '../sim/boat';

export interface VesselSize {
  length: number;
  beam: number;
}

/** Where the middle of a vessel should be, and which way it should point (bow end), for a berth. */
export interface BerthPose {
  x: number;
  z: number;
  heading: number;
}

/** The finish line of one berth for one hull. */
export interface BerthRules {
  /** Allowed error along the berth and across it (m) between the vessel's middle and the target. */
  along: number;
  across: number;
  /** Allowed heading error (rad), measured to the nearest acceptable end. */
  align: number;
  /** Ground speed (m/s) under which the vessel counts as stopped. */
  speed: number;
  /** Seconds the finish must be held. */
  hold: number;
  /** Mooring only: the bow has to be within this of the ball (m). */
  reach: number;
}

/** Heading of the axis the vessel lies along at this berth (the bow end for an `ends: 'bow'` slip). */
export function berthAxis(b: Berth): number {
  return b.kind === 'alongside' ? b.dir + Math.PI / 2 : b.dir;
}

/** The pose a vessel of this size has to finish in. For a mooring it is the ball with the bow on it. */
export function berthTarget(b: Berth, v: VesselSize): BerthPose {
  if (b.kind === 'slip') {
    // the middle of the hull sits a half-length and a fender short of the closed end
    const back = v.length * 0.5 + 1.1;
    return { x: b.x - Math.cos(b.dir) * back, z: b.z - Math.sin(b.dir) * back, heading: b.dir };
  }
  if (b.kind === 'alongside') {
    // lying against the face, a fender's width off it
    const off = v.beam * 0.5 + 0.6;
    return { x: b.x + Math.cos(b.dir) * off, z: b.z + Math.sin(b.dir) * off, heading: berthAxis(b) };
  }
  return { x: b.x, z: b.z, heading: b.dir };
}

/** How forgiving the finish is: bigger hulls get more slack in metres but less in degrees. */
export function berthRules(b: Berth, v: VesselSize): BerthRules {
  const big = clamp((v.length - 10) / 106, 0, 1); // 0 for a boat, 1 for the liner
  if (b.kind === 'mooring') {
    return { along: 99, across: 99, align: Math.PI, speed: 0.55, hold: 2, reach: b.width };
  }
  if (b.kind === 'slip') {
    return {
      along: 2.2 + 0.07 * v.length,
      across: Math.min(3.2, Math.max(1.2, b.width / 2 - v.beam / 2 - 0.5)),
      align: 0.3,
      speed: 0.9,
      hold: 1.8,
      reach: 0,
    };
  }
  // alongside: the ends must lie within ~5 m of the line of the quay, however long the hull
  return {
    along: 3.5 + 0.08 * v.length,
    across: 2.0 + 0.8 * big,
    align: clamp(Math.atan(5 / (v.length * 0.5)), 0.07, 0.3),
    speed: 0.8 - 0.3 * big,
    hold: 2 + 1.2 * big,
    reach: 0,
  };
}

/** Everything the HUD, the radar and the audio need to know about the attempt. */
export interface BerthStatus {
  kind: Berth['kind'];
  label: string;
  timeLeft: number;
  /** Metres from the vessel's middle to its target (a mooring: from the bow to the ball). */
  dist: number;
  /** The error in the berth's own frame (m): + along the berth's axis; across + is starboard in a slip, out from the quay at a wharf. */
  along: number;
  across: number;
  speedKn: number;
  alignDeg: number;
  speedOk: boolean;
  alignOk: boolean;
  posOk: boolean;
  hold: number;
  need: number;
  /** Open water between the hull and the nearest obstacle (m). */
  clearance: number;
  /** Where the middle of the vessel should be, and its heading. */
  target: BerthPose;
  /** Metres the vessel needs to stop from its present speed with full astern. */
  stopDist: number;
  /** A comfortable speed limit for this distance from the berth (m/s). */
  slow: number;
  touches: number;
}

const FOOT = [-0.5, -0.25, 0, 0.25, 0.5];

export class BerthSession {
  readonly rules: BerthRules;
  readonly status: BerthStatus;
  active = false;
  t = 0;
  hold = 0;
  touches = 0;
  limit = 240;
  /** The error at the instant the finish was held long enough (for scoring). */
  finish: { along: number; across: number; align: number; speed: number } | null = null;

  constructor(
    readonly berth: Berth,
    readonly vessel: VesselSize,
  ) {
    this.rules = berthRules(berth, vessel);
    const target = berthTarget(berth, vessel);
    this.status = {
      kind: berth.kind,
      label: berth.label,
      timeLeft: 0,
      dist: 0,
      along: 0,
      across: 0,
      speedKn: 0,
      alignDeg: 0,
      speedOk: false,
      alignOk: false,
      posOk: false,
      hold: 0,
      need: this.rules.hold,
      clearance: 99,
      target,
      stopDist: 0,
      slow: this.rules.speed,
      touches: 0,
    };
  }

  reset(): void {
    this.active = false;
    this.t = 0;
    this.hold = 0;
    this.touches = 0;
    this.finish = null;
  }

  start(limit: number): void {
    this.reset();
    this.active = true;
    this.limit = limit;
  }

  /** Advance the attempt. Returns 'docked' once the finish has been held long enough, 'timeout' at the limit. */
  update(dt: number, boat: Boat, env: BoatEnv): 'docked' | 'timeout' | null {
    const b = this.berth;
    const spec = boat.spec;
    const st = this.status;
    const r = this.rules;
    this.t += dt;
    const tg = st.target;
    const f = boat.fwd;
    const half = spec.length * 0.5;

    // error in the berth's frame
    const axis = berthAxis(b);
    const ax = Math.cos(axis);
    const az = Math.sin(axis);
    let dx = boat.pos.x - tg.x;
    let dz = boat.pos.z - tg.z;
    if (b.kind === 'mooring') {
      // the bow is what has to reach the ball
      dx = boat.pos.x + f.x * (half - 1) - b.x;
      dz = boat.pos.z + f.z * (half - 1) - b.z;
    }
    st.along = dx * ax + dz * az;
    // across: to starboard of a slip's axis, but towards the water for a wharf (so + always means "out from the quay")
    st.across = (b.kind === 'alongside' ? -1 : 1) * (-dx * az + dz * ax);
    st.dist = Math.hypot(dx, dz);
    st.speedKn = boat.sog * 1.94384;
    st.speedOk = boat.sog < r.speed;

    // heading error to the nearest acceptable end of the berth's axis
    const h = boat.heading;
    const eBow = Math.abs(wrapAngle(h - axis));
    const eStern = Math.abs(wrapAngle(h - axis - Math.PI));
    let err = Math.min(eBow, eStern);
    if (b.kind === 'slip' && b.ends === 'bow') err = eBow;
    if (b.kind === 'slip' && b.ends === 'stern') err = eStern;
    if (b.kind === 'mooring') err = 0;
    st.alignDeg = (err * 180) / Math.PI;
    st.alignOk = err < r.align;
    st.posOk =
      b.kind === 'mooring'
        ? st.dist < r.reach
        : Math.abs(st.along) < r.along && Math.abs(st.across) < r.across;
    st.timeLeft = Math.max(0, this.limit - this.t);

    // how far full astern needs to stop us, and a speed limit that tightens as the berth gets closer
    const aBrake = Math.max(0.02, (spec.engine.thrust * spec.engine.reverse) / spec.mass);
    st.stopDist = (boat.sog * boat.sog) / (2 * aBrake);
    st.slow = clamp(0.35 + st.dist * 0.05, r.speed, 4.5);

    // parking sensors: the nearest hard thing to the hull, sampled down both sides and at both ends
    let clear = 99;
    const sx = boat.right.x;
    const sz = boat.right.z;
    for (const k of FOOT) {
      const px = boat.pos.x + f.x * spec.length * k;
      const pz = boat.pos.z + f.z * spec.length * k;
      clear = Math.min(clear, env.hardAt(px + sx * spec.beam * 0.5, pz + sz * spec.beam * 0.5));
      clear = Math.min(clear, env.hardAt(px - sx * spec.beam * 0.5, pz - sz * spec.beam * 0.5));
    }
    clear = Math.min(clear, env.hardAt(boat.pos.x + f.x * half, boat.pos.z + f.z * half));
    clear = Math.min(clear, env.hardAt(boat.pos.x - f.x * half, boat.pos.z - f.z * half));
    st.clearance = clear;
    st.touches = this.touches;

    if (st.posOk && st.alignOk && st.speedOk) this.hold += dt;
    else this.hold = Math.max(0, this.hold - dt * 1.5);
    st.hold = this.hold;
    if (this.hold >= r.hold) {
      this.finish = { along: st.along, across: st.across, align: err, speed: boat.sog };
      return 'docked';
    }
    if (this.t >= this.limit) return 'timeout';
    return null;
  }
}
