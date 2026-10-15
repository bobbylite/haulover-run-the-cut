// The docking challenge: park in the marked slip, slowly and squarely, without touching pilings,
// piers or the boats that are circulating in the basin.

import { clamp, wrapAngle } from '../core/math';
import type { Boat, BoatEnv } from '../sim/boat';
import { SLIP } from '../sim/geography';

/** Everything the HUD and the audio need to know about the docking attempt. */
export interface DockStatus {
  timeLeft: number;
  /** Metres from the boat's centre to its berth. */
  dist: number;
  speedKn: number;
  alignDeg: number;
  speedOk: boolean;
  alignOk: boolean;
  posOk: boolean;
  hold: number;
  need: number;
  /** Open water between the hull and the nearest obstacle (m). */
  clearance: number;
  berthX: number;
  berthZ: number;
  slow: number;
}

const MAX_SPEED = 0.9; // m/s over the ground
const MAX_ALIGN = 0.38; // rad (22 degrees), bow-in or stern-in
const HOLD = 1.8;

export class Docking {
  active = false;
  t = 0;
  hold = 0;
  touches = 0;
  limit = 120;
  readonly status: DockStatus = {
    timeLeft: 0,
    dist: 0,
    speedKn: 0,
    alignDeg: 0,
    speedOk: false,
    alignOk: false,
    posOk: false,
    hold: 0,
    need: HOLD,
    clearance: 99,
    berthX: SLIP.x1,
    berthZ: SLIP.z,
    slow: MAX_SPEED,
  };

  reset(): void {
    this.active = false;
    this.t = 0;
    this.hold = 0;
    this.touches = 0;
  }

  start(limit: number): void {
    this.active = true;
    this.t = 0;
    this.hold = 0;
    this.touches = 0;
    this.limit = limit;
  }

  /** Where the centre of a boat of this length should end up. */
  berthX(length: number): number {
    return SLIP.x1 - (length * 0.5 + 1.1);
  }

  /** Advance the attempt. Returns 'docked' when the boat has been parked long enough. */
  update(dt: number, boat: Boat, env: BoatEnv): 'docked' | 'timeout' | null {
    const spec = boat.spec;
    const st = this.status;
    this.t += dt;
    st.berthX = this.berthX(spec.length);
    st.berthZ = SLIP.z;
    const dx = boat.pos.x - st.berthX;
    const dz = boat.pos.z - st.berthZ;
    st.dist = Math.hypot(dx, dz);
    st.speedKn = boat.sog * 1.94384;
    const h = wrapAngle(boat.heading);
    const err = Math.min(Math.abs(h), Math.abs(wrapAngle(h - Math.PI)));
    st.alignDeg = (err * 180) / Math.PI;
    st.posOk = Math.abs(dx) < 3.0 + spec.length * 0.08 && Math.abs(dz) < 3.4;
    st.alignOk = err < MAX_ALIGN;
    st.speedOk = boat.sog < MAX_SPEED;
    st.timeLeft = Math.max(0, this.limit - this.t);
    // a gentle speed limit that tightens as the berth gets closer
    st.slow = clamp(0.9 + (st.dist - 8) * 0.12, 0.9, 5);
    // parking-sensor clearance: bow, stern and centre
    const f = boat.fwd;
    const half = spec.length * 0.5;
    st.clearance =
      Math.min(
        env.hardAt(boat.pos.x + f.x * half, boat.pos.z + f.z * half),
        env.hardAt(boat.pos.x - f.x * half, boat.pos.z - f.z * half),
        env.hardAt(boat.pos.x, boat.pos.z),
      ) -
      spec.beam * 0.5;

    if (st.posOk && st.alignOk && st.speedOk) this.hold += dt;
    else this.hold = Math.max(0, this.hold - dt * 1.5);
    st.hold = this.hold;
    if (this.hold >= HOLD) return 'docked';
    if (this.t >= this.limit) return 'timeout';
    return null;
  }
}
