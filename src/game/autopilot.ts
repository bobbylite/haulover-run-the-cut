// Path-following helm used for testing, AI traffic and the attract mode.

import { clamp, wrapAngle } from '../core/math';
import type { Boat } from '../sim/boat';
import { SLIP } from '../sim/geography';
import { idealSheet } from '../sim/sail';
import type { Controls } from './input';

export interface Waypoint {
  x: number;
  z: number;
}

export class Autopilot {
  private idx = 0;
  private thrI = 0;
  /** When set, the pilot slows for the marina and parks in the target slip. */
  dock = false;

  constructor(
    private path: Waypoint[],
    /** Cruise speed as a fraction of the boat's top speed. */
    public cruise = 0.7,
    /** Closed circuit: wrap round to the first waypoint instead of ending. */
    private readonly loop = false,
  ) {}

  /** True once the boat has reached the last few waypoints. */
  done(boat: Boat): boolean {
    this.advance(boat.pos.x, boat.pos.z);
    return this.idx >= this.path.length - 3;
  }

  setPath(p: Waypoint[]): void {
    this.path = p;
    this.idx = 0;
  }

  /** Index of the closest path point (monotonic; wraps on a loop). */
  private advance(x: number, z: number): void {
    const p = this.path;
    const n = p.length;
    let best = Infinity;
    let bi = this.idx;
    for (let k = 0; k < 30; k++) {
      const i = this.idx + k;
      if (!this.loop && i >= n) break;
      const q = p[i % n] as Waypoint;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < best) {
        best = d;
        bi = i % n;
      }
    }
    this.idx = bi;
  }

  update(boat: Boat, out: Controls, dt = 1 / 60): void {
    this.advance(boat.pos.x, boat.pos.z);
    // docking: speed falls away with distance to the berth and the last metres are flown by hand
    let berthDist = Infinity;
    const bx = SLIP.x1 - (boat.spec.length * 0.5 + 1.1);
    if (this.dock) berthDist = Math.hypot(boat.pos.x - bx, boat.pos.z - SLIP.z);
    const docking = berthDist < 270;
    const look = docking ? clamp(boat.sog * 3 + 10, 12, 40) : clamp(boat.sog * 2.4, 22, 130);
    let acc = 0;
    let ti = this.idx;
    const n = this.path.length;
    while (acc < look && (this.loop || ti < n - 1)) {
      const a = this.path[ti % n] as Waypoint;
      const b = this.path[(ti + 1) % n] as Waypoint;
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      ti++;
    }
    let tx = (this.path[ti % n] as Waypoint).x;
    let tz = (this.path[ti % n] as Waypoint).z;
    if (docking && berthDist < 28) {
      // straight down the slip to the berth
      tx = bx + 40;
      tz = SLIP.z;
    }
    const desired = Math.atan2(tz - boat.pos.z, tx - boat.pos.x);
    // steer against course-over-ground so the tide's set doesn't push us off the line
    const cog = boat.sog > 1.5 ? Math.atan2(boat.vel.z, boat.vel.x) : boat.heading;
    const err = wrapAngle(desired - (0.6 * cog + 0.4 * boat.heading));
    const yawRate = -boat.angVel.y;
    out.steer = clamp(1.7 * err - 0.7 * yawRate, -0.85, 0.85);
    if (docking) {
      // track a speed profile with a PI loop; reverse thrust does the braking
      const vT = clamp(0.032 * berthDist + 0.4, 0.3, boat.spec.topSpeed * this.cruise);
      const e = vT - boat.sog;
      this.thrI = clamp(this.thrI + 0.22 * e * dt, -0.15, 0.7);
      const slowTurn = 1 - 0.5 * Math.min(1, Math.abs(err) / 0.5);
      out.throttle = clamp((this.thrI + 0.16 * e) * slowTurn, -0.4, 0.8);
      if (berthDist < 3.5 && boat.sog < 0.6) out.throttle = 0;
    } else {
      // slow for tight turns
      const turn = Math.min(1, Math.abs(err) / 0.6);
      out.throttle = clamp(this.cruise * (1 - 0.35 * turn), 0, 1);
    }
    // a sloop under sail trims to the ideal angle of attack
    // (running deep it keeps the boom sheeted well in, like a preventer, so a wobble cannot gybe it)
    out.sheet = 0.5;
    if (boat.spec.sail && boat.sailUp) {
      const gamma = Math.abs(boat.awa);
      out.sheet = gamma > 2.5 ? Math.min(0.4, idealSheet(gamma)) : idealSheet(gamma);
    }
    out.pump = boat.water.litres > 0.45 * (boat.capacityLimit ?? 1e9);
  }
}
