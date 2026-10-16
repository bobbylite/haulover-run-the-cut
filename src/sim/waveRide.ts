// Wave-attack rules. In rough water the way you meet the sea decides what it does to you:
//   - head-on (0 deg to the wave axis) the bow stuffs into the face, slams and ships green water;
//   - beam-on (90 deg) the rail rolls under and the side takes the slap;
//   - on a clean ~45 deg line the hull slices across the crest and the sea barely touches you.
// Everything here is pure maths so the whole rule set can be unit tested; `Boat` feeds it and applies
// the results (water, damage), `Game` turns the streak into toasts and score.

import { clamp, lerp, smoothstep } from '../core/math';

/** The ideal angle between the heading and the wave axis. */
export const IDEAL_ATTACK = Math.PI / 4;

/** Seconds of continuous clean riding that earn one more combo level. */
export const CLEAN_PERIOD = 2.6;
export const MAX_COMBO = 9;

/** Angle between the heading and the wave axis, folded into 0..90 degrees (radians). */
export function attackAngle(heading: number, axis: number): number {
  return Math.acos(clamp(Math.abs(Math.cos(heading - axis)), 0, 1));
}

/**
 * How wrong the line is, 0..1: 0 anywhere on a clean 45 degree line (about 36..54), rising to 1 when
 * head-on (<10 deg) or beam-on (>80 deg).
 */
export function attackBad(alpha: number): number {
  return Math.max(headOn(alpha), beamOn(alpha));
}

/** 1 when meeting the waves head-on (under ~10 degrees), fading out by ~36. */
export function headOn(alpha: number): number {
  return 1 - smoothstep(0.17, 0.63, alpha);
}

/** 1 when broadside to the waves (over ~80 degrees), fading in from ~54. */
export function beamOn(alpha: number): number {
  return smoothstep(0.94, 1.4, alpha);
}

/**
 * How rough the sea is *for this hull*, 0..1. A 1.3 m sea is a pond to a 13 m yacht and a washing
 * machine to a 7 m centre console, so the significant height is taken relative to the length.
 */
export function seaRoughness(hs: number, length: number): number {
  return smoothstep(0.09, 0.36, hs / Math.max(2, length));
}

/**
 * Multiplier on every source of water (slam, spray, green water) for this line in this sea.
 * Calm water leaves the physics alone; in rough water a good line cuts it by two thirds and a bad
 * line makes it a third worse.
 */
export function waterFactor(bad: number, rough: number): number {
  return lerp(1 - 0.65 * rough, 1 + 0.6 * rough, bad);
}

/** Multiplier on wave-impact damage: nil in calm water, tiny on a good line, brutal on a bad one. */
export function damageFactor(bad: number, rough: number): number {
  return smoothstep(0.03, 0.2, rough) * lerp(0.1, 1.5, bad);
}

export type LandingGrade = 'smooth' | 'nose' | 'slap';

/**
 * Grade a touchdown after a jump. `relPitch` is the hull pitch relative to the wave face under it
 * (negative = bow down into the face), `impact` the vertical closing speed (m/s).
 */
export function gradeLanding(relPitch: number, impact: number): LandingGrade {
  if (relPitch < -0.17) return 'nose';
  if (Math.abs(relPitch) < 0.13 && impact < 6) return 'smooth';
  return 'slap';
}

export type RideEvent =
  | { kind: 'combo'; level: number }
  | { kind: 'broken'; level: number; why: 'hit' | 'angle' }
  | { kind: 'air'; time: number; grade: LandingGrade; impact: number };

/** Live wave-attack read-outs plus the "Wave Rider" streak. */
export class WaveRide {
  /** Heading vs the wave axis, 0..90 degrees (radians). */
  angle = IDEAL_ATTACK;
  /** Signed bearing of the wave axis from the bow, -90..90 degrees (radians), for the dial. */
  rel = 0;
  /** Significant wave height proxy at the boat (m). */
  hs = 0;
  /** 0..1 roughness for this hull. */
  rough = 0;
  /** 0..1, how wrong the line is (already softened in a confused sea). */
  bad = 0;
  /** 0..1, the broadside share of `bad` (drives set-wave slaps). */
  beam = 0;
  /** Multiplier on water intake (see `waterFactor`). */
  water = 1;
  /** Multiplier on wave-impact damage. */
  damage = 0;
  /** True while the line is clean and there is rough water worth riding. */
  clean = false;
  /** Seconds of the current clean spell. */
  cleanT = 0;
  /** Completed clean periods: the combo multiplier is 1 + combo. */
  combo = 0;
  /** Points banked by the streak this run. */
  bonus = 0;
  /** Seconds spent badly aligned in rough water (breaks the streak when it drags on). */
  badT = 0;
  /** Best streak this run. */
  bestCombo = 0;
  readonly events: RideEvent[] = [];

  reset(): void {
    this.angle = IDEAL_ATTACK;
    this.rel = 0;
    this.hs = 0;
    this.rough = this.bad = this.beam = this.damage = 0;
    this.water = 1;
    this.clean = false;
    this.cleanT = this.badT = 0;
    this.combo = this.bestCombo = this.bonus = 0;
    this.events.length = 0;
  }

  /**
   * @param heading hull heading (atan2(z, x))
   * @param speed speed through the water (m/s)
   * @param topSpeed the hull's nominal top speed (m/s)
   * @param hs significant wave height at the boat (m)
   * @param axis dominant wave axis (atan2(z, x), modulo pi)
   * @param coherence 0..1 how aligned the sea is
   * @param length hull length (m)
   */
  update(
    dt: number,
    heading: number,
    speed: number,
    topSpeed: number,
    hs: number,
    axis: number,
    coherence: number,
    length: number,
  ): void {
    this.hs = hs;
    this.angle = attackAngle(heading, axis);
    // signed bearing of the axis from the bow, folded to -90..90
    let r = axis - heading;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    if (r > Math.PI / 2) r -= Math.PI;
    else if (r < -Math.PI / 2) r += Math.PI;
    this.rel = r;
    this.rough = seaRoughness(hs, length);
    // a confused sea has no single line to take: soften the penalty
    const soften = 0.35 + 0.65 * clamp(coherence, 0, 1);
    this.bad = attackBad(this.angle) * soften;
    this.beam = beamOn(this.angle) * soften;
    this.water = waterFactor(this.bad, this.rough);
    this.damage = damageFactor(this.bad, this.rough);

    const moving = Math.abs(speed) > Math.max(4, 0.3 * topSpeed);
    this.clean = this.rough > 0.1 && moving && this.bad < 0.2;
    if (this.clean) {
      this.badT = 0;
      this.cleanT += dt;
      if (this.cleanT >= CLEAN_PERIOD) {
        this.cleanT -= CLEAN_PERIOD;
        const climbed = this.combo < MAX_COMBO;
        this.combo = Math.min(MAX_COMBO, this.combo + 1);
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.bonus += 4 * (1 + this.combo) * (0.5 + this.rough);
        // only announce a new level; holding the top streak just keeps banking points
        if (climbed) this.events.push({ kind: 'combo', level: this.combo });
      }
    } else {
      this.cleanT = Math.max(0, this.cleanT - dt * 2);
      if (this.rough > 0.1 && moving && this.bad > 0.65) {
        this.badT += dt;
        if (this.badT > 1.6) this.breakStreak('angle');
      } else this.badT = Math.max(0, this.badT - dt);
    }
  }

  /** A wave hit that did real damage ends the streak. */
  breakStreak(why: 'hit' | 'angle'): void {
    if (this.combo > 0) this.events.push({ kind: 'broken', level: this.combo, why });
    this.combo = 0;
    this.cleanT = 0;
    this.badT = 0;
  }

  /** Multiplier shown on the HUD. */
  get multiplier(): number {
    return 1 + this.combo;
  }
}
