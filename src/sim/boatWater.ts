// Water inside the hull: green-water overflow over the gunwales (weir equation), slam spray,
// scupper drain / back-flow, bilge pump, leaks, and a free-surface slosh model that shifts the
// water's centre of mass (the classic "free surface effect") and feeds back into the rigid body.

import { clamp } from '../core/math';
import { type BoatSpec, RHO_W } from './boatSpec';
import { GRAVITY } from './waves';

/** Game-tuning gain for gunwale overflow (weir) and slam spray. */
export const WEIR_GAIN = 0.34;
export const SLAM_GAIN = 0.006;
export const SPRAY_GAIN = 0.0009;
/** Wind chop (m) below which a moving bow throws no water aboard: a glassy bay keeps the boat dry. */
export const SPRAY_CHOP_MIN = 0.25;

/** Share of the hull's flooding capacity that fits in the bilge below the cockpit sole. */
const BILGE_SHARE = 0.14;

export class BoatWater {
  /** Water standing in the cockpit above the sole (m^3): the scuppers drain it. */
  volume = 0;
  /**
   * Water collected below the sole (m^3). Seam leaks from damage run in here, where the scuppers cannot
   * reach them, so only the bilge pump clears it; once it is full it rises into the cockpit.
   */
  bilge = 0;
  /** Steady leak from damage (L/s). */
  leak = 0;
  pumping = false;
  autoBilge = 0;

  // slosh state: COM offsets (m) of the pooled water relative to the cockpit centre
  rollOff = 0;
  rollVel = 0;
  pitchOff = 0;
  pitchVel = 0;
  /** Smoothed tilt of the water surface relative to the hull (rad) for rendering. */
  tiltRoll = 0;
  tiltPitch = 0;

  // accounting / telemetry
  intakeRate = 0; // L/s
  drainRate = 0; // L/s
  /** Intake minus drain (L/s): what the bilge is actually doing. */
  netRate = 0;
  totalIntake = 0; // L
  peakVolume = 0; // L
  /** Cumulative intake by source (L): green water over the rail, slam spray, bow spray, scupper back-flow, leaks. */
  by = { weir: 0, slam: 0, spray: 0, scupper: 0, leak: 0 };
  /** Last slam impact speed; consumed by FX. */
  slam = 0;
  /** Last green-water inflow flagged for UI toasts (L). */
  burst = 0;

  private readonly cockpitArea: number;
  private readonly cockpitCx: number;
  private readonly cockpitLen: number;
  private readonly cockpitWid: number;

  constructor(readonly spec: BoatSpec) {
    const c = spec.cockpit;
    this.cockpitLen = c.x1 - c.x0;
    this.cockpitWid = c.halfWidth * 2;
    this.cockpitArea = this.cockpitLen * this.cockpitWid * 0.92;
    this.cockpitCx = (c.x0 + c.x1) / 2;
  }

  /** Added (virtual) mass of the water for the rigid body (kg). */
  get effMass(): number {
    return (this.volume + this.bilge) * RHO_W * this.spec.waterMassScale;
  }
  /** Everything aboard, cockpit and bilge (L). */
  get litres(): number {
    return (this.volume + this.bilge) * 1000;
  }
  /** Depth of the pooled water over the sole (m). */
  get depth(): number {
    return this.volume / this.cockpitArea;
  }

  /** Local-space centre of the pooled water (for the weight force). */
  comLocal(out: { x: number; y: number; z: number }): void {
    const h = this.depth;
    out.x = this.cockpitCx + this.pitchOff;
    out.y = this.spec.cockpit.soleY + Math.min(h, 1.2) * 0.5;
    out.z = this.rollOff;
  }

  /** A lump of water thrown aboard in one go (a broadside slap): litres. */
  addBurst(litres: number): void {
    if (litres <= 0) return;
    this.volume = clamp(this.volume + litres / 1000, 0, (this.spec.capacity / 1000) * 1.3);
    this.burst = Math.max(this.burst, litres);
    this.by.slam += litres;
    this.totalIntake += litres;
    this.peakVolume = Math.max(this.peakVolume, this.litres);
  }

  reset(): void {
    this.volume = 0;
    this.bilge = 0;
    this.leak = 0;
    this.rollOff = this.rollVel = this.pitchOff = this.pitchVel = 0;
    this.tiltRoll = this.tiltPitch = 0;
    this.intakeRate = this.drainRate = this.netRate = this.totalIntake = this.peakVolume = 0;
    this.by = { weir: 0, slam: 0, spray: 0, scupper: 0, leak: 0 };
    this.slam = this.burst = 0;
  }

  /**
   * Advance one frame.
   * @param weirOver per-weir height of sea surface above gunwale (m, <=0 means dry)
   * @param bowSpeed speed of the bow through the water (m/s)
   * @param chopLevel local short-wave energy (m) for spray
   * @param sloshTilt (roll, pitch) tilt of effective gravity in the body frame (rad)
   * @param scupperHead inside-minus-outside head at the scuppers (m)
   * @param waveFactor multiplier on every source of water from the wave-attack rules (see waveRide.ts)
   */
  update(
    dt: number,
    weirOver: readonly number[],
    bowSpeed: number,
    chopLevel: number,
    slamImpact: number,
    sloshRoll: number,
    sloshPitch: number,
    scupperHead: number,
    waveFactor = 1,
  ): void {
    const spec = this.spec;
    let inflow = 0; // m^3/s

    // green water over the gunwales (weir: Q ~ C * b * h^1.5)
    for (let i = 0; i < spec.weirs.length; i++) {
      const over = Math.min(0.55, weirOver[i] as number);
      if (over > 0) {
        const q = WEIR_GAIN * (spec.weirs[i]?.width ?? 1) * over ** 1.5 * waveFactor;
        inflow += q;
        this.by.weir += q * dt * 1000;
      }
    }
    // slam burst + continuous spray
    let slamIn = 0;
    if (slamImpact > 1.8) {
      this.slam = slamImpact;
      slamIn = SLAM_GAIN * (Math.min(slamImpact, 9) - 1.2) ** 1.4 * waveFactor;
    }
    // bow spray saturates: a planing hull deflects it outboard, so a faster boat is not a wetter one
    const spray =
      SPRAY_GAIN * clamp(bowSpeed - 5, 0, 9) ** 1.5 * Math.max(0, chopLevel - SPRAY_CHOP_MIN) * waveFactor;
    const leakIn = this.leak / 1000; // L/s -> m^3/s, into the bilge

    // scuppers drain the cockpit only: positive head drains, and flap valves stop it flooding back
    let drain = 0;
    const sc = spec.cockpit.scupper;
    if (sc > 0) {
      const q = 0.6 * sc * Math.sqrt(2 * GRAVITY * Math.abs(scupperHead));
      if (scupperHead > 0 && this.volume > 0) drain += Math.min(q, this.volume / dt);
      else if (scupperHead < 0 && this.volume > (spec.capacity / 1000) * 0.3) {
        // the flaps hold until the boat is so heavy that the sea stands above the sole
        inflow += q * 0.8;
        this.by.scupper += q * 0.8 * dt * 1000;
      }
    }
    // bilge pump: clears the bilge first, then the cockpit
    let pumped = 0;
    const pumpFrac = this.pumping ? 1 : this.autoBilge;
    const aboard = this.volume + this.bilge;
    if (pumpFrac > 0 && aboard > 0) pumped = Math.min((spec.pump * pumpFrac) / 1000, aboard / dt);

    this.by.slam += slamIn * 1000;
    this.by.spray += spray * dt * 1000;
    this.by.leak += leakIn * dt * 1000;
    const fromBilge = Math.min(this.bilge + leakIn * dt, pumped * dt);
    this.bilge += leakIn * dt - fromBilge;
    const fromDeck = pumped * dt - fromBilge;
    if (inflow * dt + slamIn > 0.012) this.burst = (inflow * dt + slamIn) * 1000;
    const hullCap = (spec.capacity / 1000) * 1.3;
    this.volume = clamp(this.volume + (inflow + spray - drain) * dt + slamIn - fromDeck, 0, hullCap);
    // a full bilge rises over the sole into the cockpit; a hull can never hold more than its flooded volume
    const bilgeCap = (spec.capacity / 1000) * BILGE_SHARE;
    if (this.bilge > bilgeCap) {
      this.volume += this.bilge - bilgeCap;
      this.bilge = bilgeCap;
    }
    this.volume = clamp(this.volume, 0, Math.max(0, hullCap - this.bilge));
    drain += pumped;
    this.intakeRate = (inflow + spray + leakIn) * 1000 + (slamIn * 1000) / Math.max(dt, 1e-3);
    this.drainRate = drain * 1000;
    this.netRate = this.intakeRate - this.drainRate;
    this.totalIntake += (Math.max(0, inflow + spray + leakIn) * dt + slamIn) * 1000;
    this.peakVolume = Math.max(this.peakVolume, this.litres);

    // ---- slosh (rectangular tank, first sloshing mode) -----------------------------------------
    const h = Math.max(this.depth, 1e-4);
    this.tiltRoll += (sloshRoll - this.tiltRoll) * Math.min(1, dt * 7);
    this.tiltPitch += (sloshPitch - this.tiltPitch) * Math.min(1, dt * 7);
    if (this.volume > 1e-5) {
      const B = this.cockpitWid;
      const Lc = this.cockpitLen;
      const eRoll = clamp(((B * B) / (12 * h)) * Math.tan(clamp(sloshRoll, -1.2, 1.2)), -B / 3, B / 3);
      const ePitch = clamp(((Lc * Lc) / (12 * h)) * Math.tan(clamp(sloshPitch, -1.2, 1.2)), -Lc / 3, Lc / 3);
      const wRoll = Math.sqrt(((Math.PI * GRAVITY) / B) * Math.tanh((Math.PI * h) / B));
      const wPitch = Math.sqrt(((Math.PI * GRAVITY) / Lc) * Math.tanh((Math.PI * h) / Lc));
      const zeta = 0.22;
      this.rollVel += (wRoll * wRoll * (eRoll - this.rollOff) - 2 * zeta * wRoll * this.rollVel) * dt;
      this.rollOff += this.rollVel * dt;
      this.pitchVel += (wPitch * wPitch * (ePitch - this.pitchOff) - 2 * zeta * wPitch * this.pitchVel) * dt;
      this.pitchOff += this.pitchVel * dt;
    } else {
      this.rollOff *= 0.9;
      this.pitchOff *= 0.9;
      this.rollVel = this.pitchVel = 0;
    }
  }
}
