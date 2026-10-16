// A harbour pilot for the berthing game: the scripted captain that proves every level can be done. It takes a
// vessel along the berth's approach road, slows on a braking-distance speed profile, squares the hull up to
// the berth (twin screws, thrusters and, for a ship, tugs when it needs them) and holds station on the mark.
// Also the template for any AI that wants to play: it reads the boat and the berth, and writes the controls.

import { clamp, wrapAngle } from '../core/math';
import type { Berth } from '../locations/types';
import type { Boat, BoatEnv } from '../sim/boat';
import type { TugCall, TugCrew } from '../sim/tugs';
import { type BerthPose, berthAxis, berthTarget } from './berthing';

export interface PilotControls {
  throttle: number;
  steer: number;
  bow: number;
  stern: number;
}

export interface Waypoint {
  x: number;
  z: number;
}

export interface PilotOptions {
  /** Cruise speed as a fraction of the vessel's top speed while running the approach. */
  cruise?: number;
  /** A tug budget the pilot may spend when a ship drifts off the line. */
  tugs?: TugCrew | null;
}

/** The road to a berth for a vessel of this size: the berth's approach, then a vessel-sized final run. */
export function pilotPath(
  b: Berth,
  v: { length: number; beam: number },
): { pts: Waypoint[]; target: BerthPose } {
  const base = b.approach.map(([x, z]) => ({ x, z }));
  const target = berthTarget(b, v);
  const L = v.length;
  if (b.kind === 'slip') {
    const ux = Math.cos(b.dir);
    const uz = Math.sin(b.dir);
    return {
      pts: [
        ...base,
        { x: target.x - ux * 30, z: target.z - uz * 30 },
        { x: target.x - ux * 9, z: target.z - uz * 9 },
        target,
      ],
      target,
    };
  }
  if (b.kind === 'alongside') {
    const nx = Math.cos(b.dir);
    const nz = Math.sin(b.dir);
    // travel along the quay in the direction the approach road arrives on
    const last = base[base.length - 1] as Waypoint;
    let tx = -nz;
    let tz = nx;
    if (b.travel !== undefined) {
      tx = Math.cos(b.travel);
      tz = Math.sin(b.travel);
    } else if ((target.x - last.x) * tx + (target.z - last.z) * tz < 0) {
      tx = -tx;
      tz = -tz;
    }
    const at = (along: number, across: number): Waypoint => ({
      x: target.x + tx * along + nx * across,
      z: target.z + tz * along + nz * across,
    });
    // the vessel's own run-in: only the stretches that are closer to the berth than where the road ended
    const lastAlong = (last.x - target.x) * tx + (last.z - target.z) * tz;
    // a shallow diagonal from the road's end onto the berth, then parallel for the last quarter-length
    const run: [number, number][] = [[-(0.25 * L + 4), 0.8]];
    const pts = [...base];
    for (const [a, c] of run) if (a > lastAlong + 6) pts.push(at(a, c));
    pts.push({ x: target.x, z: target.z });
    return { pts, target: { ...target, heading: Math.atan2(tz, tx) } };
  }
  // mooring: the bow has to reach the ball, so the middle of the hull finishes half a length short of it
  const last = base[base.length - 1] as Waypoint;
  const ex = b.x - last.x;
  const ez = b.z - last.z;
  const el = Math.hypot(ex, ez) || 1;
  const ux = ex / el;
  const uz = ez / el;
  const cx = b.x - ux * (L * 0.5 - 1);
  const cz = b.z - uz * (L * 0.5 - 1);
  return {
    pts: [...base, { x: cx - ux * 28, z: cz - uz * 28 }, { x: cx, z: cz }],
    target: { x: cx, z: cz, heading: Math.atan2(uz, ux) },
  };
}

export class HarborPilot {
  readonly path: Waypoint[];
  readonly target: BerthPose;
  private thrI = 0;
  private lastTug = -99;
  private t = 0;
  /** What the pilot did last: for debugging and the agent demo. */
  note = '';

  constructor(
    readonly berth: Berth,
    spec: { length: number; beam: number },
    private readonly opts: PilotOptions = {},
  ) {
    const p = pilotPath(berth, spec);
    this.path = p.pts;
    this.target = p.target;
  }

  /** The segment of the path we are on (path[seg] -> path[seg + 1]) and how far along it, 0..1. */
  private seg = 0;
  private segT = 0;

  private project(i: number, x: number, z: number): { t: number; d: number } {
    const a = this.path[i] as Waypoint;
    const b = this.path[i + 1] as Waypoint;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    return { t, d: Math.hypot(a.x + dx * t - x, a.z + dz * t - z) };
  }

  /** Find where we are on the path (the nearest of this segment and the next two, never going backwards). */
  private advance(x: number, z: number): void {
    const last = this.path.length - 2;
    let best = Infinity;
    let bi = this.seg;
    let bt = this.segT;
    for (let k = 0; k < 3 && this.seg + k <= last; k++) {
      const p = this.project(this.seg + k, x, z);
      if (p.d < best - 1e-6) {
        best = p.d;
        bi = this.seg + k;
        bt = p.t;
      }
    }
    this.seg = bi;
    this.segT = bt;
  }

  /** The point `ahead` metres further along the path from where we are. */
  private carrotAt(ahead: number): Waypoint {
    let i = this.seg;
    let t = this.segT;
    for (;;) {
      const a = this.path[i] as Waypoint;
      const b = this.path[i + 1] as Waypoint;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const room = (1 - t) * len;
      if (ahead <= room || i >= this.path.length - 2) {
        const tt = clamp(t + ahead / len, 0, 1);
        return { x: a.x + (b.x - a.x) * tt, z: a.z + (b.z - a.z) * tt };
      }
      ahead -= room;
      i++;
      t = 0;
    }
  }

  /** The heading of the path `ahead` metres further on. */
  private dirAt(ahead: number): number {
    let i = this.seg;
    let t = this.segT;
    for (;;) {
      const a = this.path[i] as Waypoint;
      const b = this.path[i + 1] as Waypoint;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const room = (1 - t) * len;
      if (ahead <= room || i >= this.path.length - 2) return Math.atan2(b.z - a.z, b.x - a.x);
      ahead -= room;
      i++;
      t = 0;
    }
  }

  /** Path length still to run from here. */
  private remaining(): number {
    const p = this.path;
    const a = p[this.seg] as Waypoint;
    const b = p[this.seg + 1] as Waypoint;
    let d = (1 - this.segT) * Math.hypot(b.x - a.x, b.z - a.z);
    for (let i = this.seg + 1; i < p.length - 1; i++) {
      const c = p[i] as Waypoint;
      const e = p[i + 1] as Waypoint;
      d += Math.hypot(e.x - c.x, e.z - c.z);
    }
    return d;
  }

  update(boat: Boat, env: BoatEnv, out: PilotControls, dt = 1 / 30): void {
    void env;
    this.t += dt;
    const spec = boat.spec;
    const L = spec.length;
    const ship = !!spec.thrusters;
    const heavy = clamp(L / 116, 0, 1);
    this.advance(boat.pos.x, boat.pos.z);
    const tg = this.target;
    const mooring = this.berth.kind === 'mooring';
    const axis = berthAxis(this.berth);

    // ---- the speed profile: never go faster than full astern can stop us before the mark ----
    const aB = Math.max(0.03, (spec.engine.thrust * spec.engine.reverse) / spec.mass);
    // a harbour pilot never runs faster than about eight knots, and never expects more than half a metre per
    // second squared of braking, whatever the engine could do on paper
    const aD = Math.min(0.6 * aB, 0.5);
    const D = this.remaining();
    const toT = Math.hypot(tg.x - boat.pos.x, tg.z - boat.pos.z);
    const vCruise = Math.min(spec.topSpeed * (this.opts.cruise ?? 0.7), L < 30 ? 5.4 : 4.2);
    const vEnd = 0.22;
    // ...and never carrying more way than a precise berth allows: 0.5 m/s at the mark, rising with distance
    let vT = Math.min(vCruise, Math.sqrt(2 * aD * Math.max(0, D - 1.5)) + vEnd, 0.45 + 0.022 * D);
    // ...and easing off for a bend coming up (a hull cannot swing at speed): the sharper, the slower
    const bend = Math.max(
      Math.abs(wrapAngle(this.dirAt(45 + 1.5 * L) - this.dirAt(0))),
      Math.abs(wrapAngle(this.dirAt(25 + 0.8 * L) - this.dirAt(0))),
    );
    vT = Math.min(vT, Math.max(0.9 + 0.8 * (1 - heavy), vCruise * clamp(1.15 - 1.3 * bend, 0.25, 1)));
    // ground-speed along the hull
    const f = boat.fwd;
    const vAlong = boat.vel.x * f.x + boat.vel.z * f.z;
    const vSide = boat.vel.x * boat.right.x + boat.vel.z * boat.right.z;

    // ---- where to point: pure pursuit on the path, then the berth's axis for the last stretch ----
    const look = clamp(Math.abs(boat.sog) * 3 + L * 0.5 + 8, 12, 90);
    const carrot = this.carrotAt(look);
    let desired = Math.atan2(carrot.z - boat.pos.z, carrot.x - boat.pos.x);
    const finalStretch = toT < 0.8 * L + 28;
    if (finalStretch) {
      // line of sight onto the berth's own line: the line's heading, leaned into whatever the tide has pushed
      // us off it by (the cross-track error over a look-ahead as long as the hull)
      let line = tg.heading;
      if (!mooring) {
        const eA = wrapAngle(tg.heading - boat.heading);
        const eB = wrapAngle(tg.heading + Math.PI - boat.heading);
        line = Math.abs(eA) <= Math.abs(eB) ? tg.heading : tg.heading + Math.PI;
        if (this.berth.kind === 'slip' && this.berth.ends === 'bow') line = axis;
      }
      const lx = Math.cos(line);
      const lz = Math.sin(line);
      const cross = (boat.pos.x - tg.x) * -lz + (boat.pos.z - tg.z) * lx;
      desired = line - clamp(Math.atan(cross / Math.max(6 + 0.7 * L, 0.6 * toT)), -0.6, 0.6);
    }
    const cog = boat.sog > 1.2 ? Math.atan2(boat.vel.z, boat.vel.x) : boat.heading;
    const blend = finalStretch ? 0 : 0.6;
    const err = wrapAngle(desired - (blend * cog + (1 - blend) * boat.heading));
    const yawRate = -boat.angVel.y;
    // heavier hulls turn slowly, so they get more derivative and less proportional action
    const kp = 1.7 * (1 - 0.55 * heavy);
    const kd = 0.7 + 9 * heavy + (ship ? 2 : 0);
    out.steer = clamp(kp * err - kd * yawRate, -0.85, 0.85);

    // ---- surge: a PI on the along-hull speed against the profile; astern does the braking ----
    // overshot the mark with the hull square to it: back down onto it rather than going round again
    const eFwdT = (tg.x - boat.pos.x) * f.x + (tg.z - boat.pos.z) * f.z;
    const behind = toT < 45 && eFwdT < -3;
    const vTs = behind ? -Math.min(vT, 0.8) : vT;
    const eV = vTs - vAlong;
    // gains scale with how much speed a unit of throttle buys: a light, powerful boat gets a light touch
    const g = spec.engine.thrust / spec.mass;
    const kP = clamp(0.4 / g, 0.1, 5);
    this.thrI = clamp(this.thrI + clamp(0.04 / g, 0.012, 0.5) * eV * dt, -0.3, 0.6);
    const slowTurn = 1 - 0.5 * Math.min(1, Math.abs(err) / 0.6);
    const thr = this.thrI + kP * eV;
    // a tight turn holds the power back, but never the braking
    out.throttle = clamp(thr > 0 ? thr * slowTurn : thr, -0.6, 0.8);
    if (toT < 3 && Math.abs(vAlong) < 0.25) out.throttle = clamp(out.throttle, -0.1, 0.1);
    // an outboard or a rudder only steers with the prop turning: a touch of power to swing the head round
    if (!ship && Math.abs(err) > 0.16 && boat.sog < 0.7 && !behind)
      out.throttle = Math.max(out.throttle, 0.09);

    // ---- thrusters: sway onto the line and square up, once close enough to matter ----
    out.bow = 0;
    out.stern = 0;
    if (ship) {
      const near = toT < 1.6 * L + 70;
      if (near) {
        // the target in the hull's own axes
        const ex = tg.x - boat.pos.x;
        const ez = tg.z - boat.pos.z;
        const eFwd = ex * f.x + ez * f.z;
        const eSide = ex * boat.right.x + ez * boat.right.z;
        // sideways: close the lateral gap at a speed the hull can stop (about the same profile as surge)
        const sideCap = clamp(0.1 + 0.07 * Math.abs(eSide), 0.08, 0.7);
        const vSideT = clamp(0.12 * eSide, -sideCap, sideCap);
        const swayCmd = clamp(2.2 * (vSideT - vSide), -1, 1);
        // yaw: bring the heading to the axis and stop the swing
        const yEnd = wrapAngle(desired - boat.heading);
        const rMax = clamp(0.2 - 0.0016 * L, 0.025, 0.2);
        const rT = clamp(0.5 * yEnd, -rMax, rMax);
        const yawCmd = clamp(14 * (rT - yawRate), -1, 1);
        // bow pushes starboard (+) to turn to starboard; the stern pushing the same way turns the bow to port
        out.bow = clamp(swayCmd + yawCmd, -1, 1);
        out.stern = clamp(swayCmd - yawCmd, -1, 1);
        void eFwd;
        this.note = `sway ${swayCmd.toFixed(2)} yaw ${yawCmd.toFixed(2)}`;
      }
    }

    // ---- tugs: a ship that is going to miss the berth, or will not stop in time, calls for help ----
    const tugs = this.opts.tugs;
    if (tugs && tugs.callsLeft > 0 && this.t - this.lastTug > 14) {
      const f2 = boat.fwd;
      const sink = boat.vel.x * f2.x + boat.vel.z * f2.z;
      const stopDist = (sink * sink) / (2 * aB);
      let call: TugCall | null = null;
      if (toT < 120 && stopDist > toT * 1.2 && sink > 0.5 && tugs.used < 2) call = 'hold';
      else if (toT < 90) {
        const ex = tg.x - boat.pos.x;
        const ez = tg.z - boat.pos.z;
        const eSide = ex * boat.right.x + ez * boat.right.z;
        // a big sideways gap that the thrusters have not closed: push the bow (and then the stern) across
        if (Math.abs(eSide) > 14 && Math.abs(vSide) < 0.15) call = eSide > 0 ? 'bow-stbd' : 'bow-port';
      }
      if (call && tugs.request(call)) this.lastTug = this.t;
    }
  }
}
