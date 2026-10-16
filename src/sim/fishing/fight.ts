// The fight. A tuna on a line is a physical tether between two moving bodies, not a minigame on a bar:
//
//   * the FISH has a position, a depth and a velocity in the water. It swims with force (its mood decides
//     where and how hard), the water drags on it, and the line pulls it towards the boat;
//   * the LINE has a length paid out, a little stretch, and a drag that slips when the tension passes its
//     setting. Tension is how far the line is stretched. The crew reels, but only well when the fish is in
//     the stern cone and the line is not at the limit;
//   * the BOAT is whatever the caller says it is (in the game: the real boat, pushed by wind, tide and sea).
//
// So everything a captain does shows up in the tension: motoring away from the fish stretches the line,
// running it down when it runs slackens it, the wind and the tide open the gap while you sit still, a fish
// forward of the beam loads the rail and chafes the line, and a wave slam is a spike. Tuna that are tired
// come in; ones that are angry, deep or off the quarter do not.
//
// Frame: +x east, +z south. All angles in radians. Tension is in units of the line's breaking strength.

import { clamp, KNOTS, Rng, smoothstep } from '../../core/math';
import { type Species, sizeFrac } from './species';
import type { FishTier } from './tiers';

export type Mood = 'run' | 'sulk' | 'thrash' | 'circle' | 'dash' | 'tired';

export type FightEnd =
  | { kind: 'landed' }
  | { kind: 'snapped'; why: string }
  | { kind: 'pulled'; why: string }
  | { kind: 'cut'; why: string };

export interface FightInput {
  /** The rod tip (stern) in the world and the boat's forward unit vector. */
  sx: number;
  sz: number;
  fx: number;
  fz: number;
  /** Boat velocity relative to the water (the fish drifts with the tide too) and the boat's length (m). */
  vx: number;
  vz: number;
  boatLen: number;
  /** Hull slam this frame (the host's m/s-ish measure) and how rough the sea is for this hull, 0..1. */
  slam: number;
  rough: number;
  /** How far the stern is above its mean height (m): the sea lifting and dropping the rod tip. */
  heave?: number;
  /** Water depth at a point and the current there. */
  floor(x: number, z: number): number;
  current(x: number, z: number, out: { x: number; z: number }): void;
  /** The drag lever, 0 (ease) .. 1 (tight), and the pump button. */
  drag: number;
  pump: boolean;
}

// ---- tuning --------------------------------------------------------------------------------------------

/** Spool capacity (m). */
export const LINE_MAX = 320;
/** The sweet zone of tension: tires the fish without risking the line. */
export const SWEET: readonly [number, number] = [0.3, 0.85];
/** Water drag on the fish (1/m): terminal speed = sqrt(thrust / K_WATER). */
const K_WATER = 0.35;
/** Pull of a fully loaded line on a fish of unit mass (m/s^2). */
const A_LINE = 12;
/** The stern cone inside which the crew reels at full speed (half angle; the HUD draws 30 so it reads as the sweet part). */
const CONE = (42 * Math.PI) / 180;
/** Height of the rod tip above the water (m), for the slant of the line. */
const TIP = 2;
const GAFF_TIME = 2;

interface Plan {
  mood: Mood;
  /** Heading of a run (world), the sign of a circle. */
  dir: number;
  dur: number;
}

/**
 * How hard each mood pushes, as a share of a full run's thrust. A fish can hold the line at a tension
 * (thrust / pull): healthy circling 0.4, sulking and thrashing ~0.75, running more than any drag can take.
 */
const THRUST: Record<Mood, number> = {
  run: 1,
  sulk: 0.4,
  thrash: 0.42,
  circle: 0.36,
  dash: 0.6,
  tired: 0.004,
};

export class Fight {
  readonly species: Species;
  readonly kg: number;
  /** How strong this fish is, 1 = an average yellowfin on the Mate tier. */
  readonly mass: number;
  readonly vRun: number;
  readonly endurance: number;

  // the fish
  x: number;
  z: number;
  depth: number;
  /** Velocity through the water. */
  ux = 0;
  uz = 0;
  stam = 1;
  mood: Mood = 'run';
  moodT = 5;
  /** The next mood, once decided (it is announced to the captain shortly before it starts). */
  plan: Plan | null = null;
  /** The fish has made its last dash at the boat. */
  dashed = false;

  // the line
  L: number;
  /** Tension now (including spikes), the drag setting actually in force, and the part that is a spike. */
  T = 0;
  td = 0.5;
  spike = 0;
  slip = 0;
  /** Reel speed and the fraction of the stern cone the fish is in (0 = far outside). */
  reel = 0;
  cone = 1;
  /** Fish bearing from dead astern, signed (+ starboard), and distance. */
  theta = 0;
  dist = 0;
  /** Crew. */
  fatigue = 0;
  resting = 0;

  // risks and bookkeeping
  chafe = 0;
  snapMeter = 0;
  slackMeter = 0;
  /** Tension averaged over about a second and a half. */
  tAvg = 0;
  gaffT = 0;
  time = 0;
  sweetT = 0;
  peakT = 0;
  /** Seconds the line has been paying out, for the HUD. */
  payoutRate = 0;
  hint = '';
  cause: 'run' | 'boat' | 'wave' | 'spool' | 'angle' = 'run';
  end: FightEnd | null = null;
  /** One-shot flags the host reads each frame (and clears). */
  events: ('run' | 'thrash' | 'sulk' | 'dash' | 'rest' | 'slam')[] = [];

  private readonly rng: Rng;
  private readonly cur = { x: 0, z: 0 };
  /** The mood in force; a run's heading is chosen on the first step, when the geometry is known. */
  private active: Plan = { mood: 'run', dir: Number.NaN, dur: 4.2 };
  private readonly crew: number;
  private readonly slipGain: number;
  private warned = false;
  private tiredAt = 0;
  private shake = 0;
  private jitter = 0;

  constructor(
    species: Species,
    kg: number,
    readonly tier: FishTier,
    seed: number,
    start: { x: number; z: number; depth: number; line: number },
  ) {
    this.species = species;
    this.kg = kg;
    this.rng = new Rng(seed);
    const sf = sizeFrac(species, kg);
    this.mass = species.power * (0.75 + 0.5 * sf) * tier.fishPower;
    this.vRun = Math.min(9.5, species.speed * (0.85 + 0.3 * sf) * (0.9 + 0.1 * tier.fishPower));
    this.endurance = 40 * species.endurance * (0.8 + 0.6 * sf) * tier.fishPower ** 0.6;
    this.crew = tier.crew;
    this.slipGain = tier.slipGain;
    this.x = start.x;
    this.z = start.z;
    this.depth = start.depth;
    this.L = start.line;
    this.dist = start.line;
    this.moodT = 4.2;
  }

  private push(e: Fight['events'][number]): void {
    if (!this.events.includes(e)) this.events.push(e);
  }

  // ---- per frame -----------------------------------------------------------------------------------

  step(dt: number, inp: FightInput): void {
    if (this.end) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / n;
    for (let i = 0; i < n && !this.end; i++) this.sub(h, inp);
    this.hint = this.makeHint();
  }

  private sub(h: number, inp: FightInput): void {
    this.time += h;
    const rng = this.rng;

    // ---- geometry
    const dx = this.x - inp.sx;
    const dz = this.z - inp.sz;
    const d = Math.max(0.5, Math.hypot(dx, dz));
    const ux = dx / d;
    const uz = dz / d;
    const heave = inp.heave ?? 0;
    const slant = Math.hypot(d, this.depth + TIP + heave);
    const ax = -inp.fx;
    const az = -inp.fz;
    const cos = clamp(ux * ax + uz * az, -1, 1);
    // signed bearing from dead astern: + is to starboard (right-hand = (-fz, fx))
    const side = ux * -inp.fz + uz * inp.fx;
    const theta = Math.acos(cos) * (side >= 0 ? 1 : -1);
    const ath = Math.abs(theta);
    this.theta = theta;
    this.dist = d;

    // ---- the fish's mood
    this.moodT -= h;
    if (!this.plan && this.moodT < 1.6 && this.stam > 0.2) this.makePlan(ux, uz, inp);
    if (this.plan && !this.warned && this.moodT < 1.6) this.warned = true;
    if (this.moodT <= 0) this.nextMood(ux, uz, inp);

    // ---- the fish swims
    this.sampleCurrent(inp);
    const stamFactor = 0.25 + 0.75 * this.stam ** 0.8;
    let desX = 0;
    let desZ = 0;
    // a hooked tuna takes a moment to realise it: the first seconds are the captain's to throttle back in
    let push = THRUST[this.mood] * stamFactor * (0.4 + 0.6 * smoothstep(0, 3, this.time));
    const plan = this.active;
    if (Number.isNaN(plan.dir)) plan.dir = this.runDir(ux, uz, inp, true);
    switch (this.mood) {
      case 'run': {
        desX = Math.cos(plan.dir);
        desZ = Math.sin(plan.dir);
        // a run starts hard and fades as the fish spends itself
        const elapsed = clamp(plan.dur - this.moodT, 0, plan.dur);
        push *= (1 - 0.3 * (elapsed / Math.max(1, plan.dur))) * smoothstep(0, 0.8, elapsed + 0.05);
        break;
      }
      case 'sulk':
        desX = Math.cos(plan.dir);
        desZ = Math.sin(plan.dir);
        break;
      case 'thrash': {
        this.jitter -= h;
        if (this.jitter <= 0) {
          this.jitter = rng.range(0.25, 0.5);
          plan.dir += rng.range(-1.9, 1.9);
          if (rng.next() < 0.3) plan.dir = Math.atan2(-uz, -ux) + rng.range(-0.5, 0.5);
        }
        desX = Math.cos(plan.dir);
        desZ = Math.sin(plan.dir);
        this.shake -= h;
        if (this.shake <= 0) {
          this.shake = rng.range(0.45, 0.95);
          this.spike += rng.range(0.14, 0.32) * this.mass ** 0.5;
          this.push('thrash');
        }
        break;
      }
      case 'circle': {
        // tangent to the boat, nudged to keep its radius
        const s = plan.dir;
        desX = -uz * s + ux * 0.12 * clamp((24 - d) / 24, -1, 1);
        desZ = ux * s + uz * 0.12 * clamp((24 - d) / 24, -1, 1);
        break;
      }
      case 'dash':
        desX = ux;
        desZ = uz;
        break;
      case 'tired':
        // goes with the line, rolling on its side
        desX = -ux * 0.4;
        desZ = -uz * 0.4;
        break;
    }
    const dl = Math.hypot(desX, desZ) || 1;
    desX /= dl;
    desZ /= dl;
    const thrust = K_WATER * this.vRun * this.vRun * push;
    // force balance per unit mass: thrust - water drag - the line's pull towards the boat
    const aLine = (A_LINE / this.mass) * this.T * (d / slant);
    const us = Math.hypot(this.ux, this.uz);
    const axw = desX * thrust - K_WATER * us * this.ux - ux * aLine;
    const azw = desZ * thrust - K_WATER * us * this.uz - uz * aLine;
    this.ux += axw * h;
    this.uz += azw * h;
    this.x += (this.ux + this.cur.x) * h;
    this.z += (this.uz + this.cur.z) * h;
    // never onto the beach
    const floor = inp.floor(this.x, this.z);
    if (floor < 3) {
      this.x -= (this.ux + this.cur.x) * h;
      this.z -= (this.uz + this.cur.z) * h;
      this.ux *= -0.4;
      this.uz *= -0.4;
    }

    // ---- depth
    let want = 3;
    if (this.mood === 'sulk')
      want = Math.min(Math.max(22, floor - 4), 26 + 70 * sizeFrac(this.species, this.kg) + 20);
    else if (this.mood === 'run') want = 8;
    else if (this.mood === 'tired') want = 0.6;
    else if (this.mood === 'dash') want = 2;
    const pullUp = 2.6 * this.T * (this.depth / Math.max(1, slant));
    const w = clamp((want - this.depth) * 0.3, -1.4, 1.3) - pullUp;
    this.depth = clamp(this.depth + w * h, 0.4, Math.max(1, floor - 2.5));

    // ---- line and tension
    const d2 = Math.hypot(this.x - inp.sx, this.z - inp.sz);
    const slant2 = Math.hypot(d2, this.depth + TIP + heave);
    // rail load: a fish off the quarter or forward of the beam bends the line over the gunwale
    const near = smoothstep(4, 16, d2);
    const rail = 1 + 0.7 * smoothstep(0.9, 2.0, ath) * near;
    const lever = 0.14 + 0.64 * clamp(inp.drag, 0, 1);
    const ramp = 0.3 + 0.7 * smoothstep(0, 4, this.time);
    const spool = 1 + 0.45 * (this.L / LINE_MAX) ** 2;
    this.td = lever * spool * rail * (inp.pump && this.resting <= 0 ? 1.18 : 1) * ramp;

    // the crew
    this.cone = 1 - smoothstep(CONE, 1.9, ath) * 0.65 - smoothstep(2.0, 2.6, ath) * 0.3;
    const sb = 2.4 + 0.022 * this.L;
    let T = Math.max(0, slant2 - this.L) / sb;
    const gate = 1 - smoothstep(0.62 * this.td, 0.97 * this.td, T);
    const slackBoost = T < 0.1 ? 1.35 : 1;
    // in a steep sea the crew is thrown about: slower reeling, and they tire sooner
    const crewSpeed = 1.9 * this.crew * (1 - 0.45 * this.fatigue) * (1 - 0.32 * inp.rough);
    let reel = 0;
    if (this.resting > 0) {
      this.resting -= h;
      this.fatigue = Math.max(0.45, this.fatigue - 0.22 * h);
    } else if (this.mood !== 'dash') {
      reel = crewSpeed * gate * slackBoost * this.cone * (inp.pump ? 1.8 : 1);
      if (reel > 0.1) this.fatigue += h * (0.014 + 0.012 * (inp.pump ? 3.4 : 0)) * (1 + 0.9 * inp.rough);
      else this.fatigue = Math.max(0, this.fatigue - 0.05 * h);
      if (this.fatigue >= 1) {
        this.resting = 3.6;
        this.push('rest');
      }
    }
    this.reel = reel;
    this.L = Math.max(2, this.L - reel * h);

    this.spike *= Math.exp(-h / 0.28);
    if (inp.slam > 1.2) {
      const s = clamp(inp.slam / 9, 0, 1) * (0.1 + 0.5 * this.T + 0.1 * inp.rough);
      if (s > this.spike) this.spike = s;
      this.push('slam');
    }
    T = Math.max(0, slant2 - this.L) / sb;
    let Tt = T + this.spike;
    // the drag lets line go when the tension passes its setting
    this.slip = 0;
    if (Tt > this.td && this.L < LINE_MAX - 0.5) {
      this.slip = this.slipGain * (Tt - this.td);
      this.L = Math.min(LINE_MAX, this.L + this.slip * h);
      T = Math.max(0, slant2 - this.L) / sb;
      Tt = T + this.spike;
    }
    this.payoutRate = this.slip;
    this.T = Tt;
    this.peakT = Math.max(this.peakT, Tt);

    // ---- stamina: tension tires the fish
    const effort = { run: 1.5, sulk: 0.6, thrash: 1.3, circle: 0.9, dash: 1.6, tired: 0.3 }[this.mood];
    if (this.T < 0.1) this.stam = Math.min(1, this.stam + 0.007 * h);
    else
      this.stam = Math.max(
        0,
        this.stam - ((0.25 * effort + 1.7 * Math.min(1.1, this.T)) * h) / this.endurance,
      );
    if (this.T >= SWEET[0] && this.T <= SWEET[1]) this.sweetT += h;
    if (this.stam <= 0.2 && this.mood !== 'tired' && this.mood !== 'dash') this.tiredNow();
    if (this.mood === 'tired') this.tiredAt += h;

    // ---- losing the fish
    // 1. the line parts: a spike over the limit, or tension held above it
    const boatAway = -(inp.vx * ux + inp.vz * uz);
    const fishAway = (this.ux + this.cur.x) * ux + (this.uz + this.cur.z) * uz;
    if (Tt >= 1.5) {
      this.snap(boatAway, fishAway);
      return;
    }
    if (Tt > 1) this.snapMeter += (Tt - 1) * 4 * h;
    else this.snapMeter = Math.max(0, this.snapMeter - 1.1 * h);
    if (this.snapMeter >= 1) {
      this.snap(boatAway, fishAway);
      return;
    }
    // 2. the hook pulls: slack too long, faster if the fish is thrashing
    // judged on the average load, not an instant: the sea rocks the rod tip and the tension with it
    this.tAvg += (this.T - this.tAvg) * (1 - Math.exp(-h / 1.4));
    if (this.tAvg < 0.09 && this.time > 4 && this.mood !== 'tired') {
      this.slackMeter += h * (this.mood === 'thrash' ? 0.95 : this.mood === 'dash' ? 0.65 : 0.25);
    } else this.slackMeter = Math.max(0, this.slackMeter - 1.0 * h);
    if (this.slackMeter >= 3) {
      this.end = {
        kind: 'pulled',
        why: 'The line went slack and the hook pulled. Keep tension on a thrashing fish.',
      };
      return;
    }
    // 3. chafe: a fish straight under the boat saws the line on the hull, and one ahead of the bow along
    //    the hull does the same. (Chasing bow-first is fine: it is the line being *held* there that cuts.)
    const under = d < 9 && this.depth > 5;
    const along = ath > 2.5 && d < 30 && this.T > 0.4;
    if (under || along) {
      this.chafe += h * (under ? 0.3 : 0.16) * (0.7 + this.T);
    } else this.chafe = Math.max(0, this.chafe - 0.12 * h);
    if (this.chafe >= 1) {
      this.end = {
        kind: 'cut',
        why: under
          ? 'The fish went under the boat and the line sawed through on the hull.'
          : 'The line was held along the hull with the fish ahead of the bow and chafed through.',
      };
      return;
    }

    // ---- the last dash, then the gaff
    if (!this.dashed && this.mood !== 'dash' && d2 < 24 && this.stam < 0.42) {
      this.dashed = true;
      this.setMood('dash', 2.6, theta);
      this.push('dash');
    }
    const sog = Math.hypot(inp.vx, inp.vz);
    // the gaff: the fish alongside, spent, and the boat quiet. Best with the fish astern, still possible if it
    // is off the quarter (the crew swings it round), not at all with it ahead of the beam
    const rate = ath < 0.85 ? 1 : ath < 1.5 ? 0.45 : 0;
    const ok =
      d2 < 9 + inp.boatLen * 0.35 && this.stam <= 0.25 && this.mood !== 'dash' && sog < 2.1 && rate > 0;
    if (ok) {
      this.gaffT += h * rate;
      if (this.gaffT >= GAFF_TIME) this.end = { kind: 'landed' };
    } else this.gaffT = Math.max(0, this.gaffT - 1.5 * h);
  }

  // ---- moods ---------------------------------------------------------------------------------------

  private sampleCurrent(inp: FightInput): void {
    inp.current(this.x, this.z, this.cur);
  }

  /**
   * A run heads away from the boat, bent towards the way the tide is setting (fish like to go with it, so a
   * captain ends up chasing into the rips). The strike run is almost straight away.
   */
  private runDir(ux: number, uz: number, inp: FightInput, first = false): number {
    this.sampleCurrent(inp);
    const cl = Math.hypot(this.cur.x, this.cur.z) || 1;
    const away = Math.atan2(uz, ux);
    const rng = this.rng;
    const wAway = first ? 1.2 : 0.85;
    const wTide = first ? 0.3 : 0.5;
    const rx = Math.cos(away) * wAway + (this.cur.x / cl) * wTide + (first ? 0 : 0.12) + rng.range(-0.4, 0.4);
    const rz = Math.sin(away) * wAway + (this.cur.z / cl) * wTide + rng.range(-0.45, 0.45);
    return Math.atan2(rz, rx);
  }

  private setMood(mood: Mood, dur: number, dirOrSign: number): void {
    this.mood = mood;
    this.moodT = dur;
    this.active = { mood, dir: dirOrSign, dur };
    this.plan = null;
    this.warned = false;
    if (mood === 'run') this.push('run');
    if (mood === 'sulk') this.push('sulk');
    this.jitter = 0;
  }

  private tiredNow(): void {
    this.mood = 'tired';
    this.moodT = 9999;
    this.active = { mood: 'tired', dir: 0, dur: 9999 };
    this.plan = null;
  }

  /** Decide what comes next, in time to warn the captain about it. */
  private makePlan(ux: number, uz: number, inp: FightInput): void {
    const rng = this.rng;
    const s = this.stam;
    const bias = this.species.sulk;
    const w: [Mood, number][] =
      s > 0.7
        ? [
            ['run', 38],
            ['sulk', 22 * (0.5 + bias * 1.6)],
            ['thrash', 18],
            ['circle', 22],
          ]
        : s > 0.45
          ? [
              ['run', 25],
              ['sulk', 28 * (0.5 + bias * 1.6)],
              ['thrash', 17],
              ['circle', 30],
            ]
          : [
              ['run', 15],
              ['sulk', 25 * (0.5 + bias * 1.6)],
              ['thrash', 15],
              ['circle', 45],
            ];
    const choices = w.filter(([m]) => m !== this.mood || m === 'circle');
    let r = rng.next() * choices.reduce((a, [, v]) => a + v, 0);
    let mood: Mood = 'run';
    for (const [m, v] of choices) {
      r -= v;
      if (r <= 0) {
        mood = m;
        break;
      }
    }
    const power = clamp(this.mass, 0.6, 1.8);
    let dir = 0;
    let dur = 6;
    if (mood === 'run') {
      dir = this.runDir(ux, uz, inp);
      dur = rng.range(5.5, 9) * (0.85 + 0.2 * power);
    } else if (mood === 'sulk') {
      // it sounds and holds, leaning away from the boat (never swimming back at it)
      dir = Math.atan2(uz, ux) + rng.range(-1.2, 1.2);
      dur = rng.range(8, 14);
    } else if (mood === 'thrash') {
      dir = Math.atan2(-uz, -ux);
      dur = rng.range(3, 5.5);
    } else {
      dir = rng.next() < 0.5 ? -1 : 1;
      dur = rng.range(9, 14);
    }
    this.plan = { mood, dir, dur };
  }

  private nextMood(ux: number, uz: number, inp: FightInput): void {
    if (this.stam <= 0.2) {
      this.tiredNow();
      return;
    }
    if (!this.plan) this.makePlan(ux, uz, inp);
    const p = this.plan as Plan;
    this.setMood(p.mood, p.dur, p.dir);
  }

  // ---- failure -------------------------------------------------------------------------------------

  private snap(boatAway: number, fishAway: number): void {
    let why = 'The line parted. The fish ran and the boat was not with it: chase a running fish.';
    if (this.spike > 0.3)
      why = 'A wave slam snapped the line. Ease the drag in a steep sea and take them at 45°.';
    else if (this.L > LINE_MAX * 0.9)
      why = 'The spool ran out. When a tuna runs, drive after it and keep line on the reel.';
    else if (Math.abs(this.theta) > 1.1)
      why = 'The line parted over the rail. Keep the fish inside the stern cone.';
    else if (boatAway > Math.max(1.5, fishAway * 0.6))
      why = 'The line parted because the boat powered away from the fish. Throttle back on the strike.';
    else if (this.mood === 'sulk')
      why = 'The line parted on a sounding fish. Ease the drag and pump it up, do not horse it.';
    this.end = { kind: 'snapped', why };
  }

  // ---- read-outs -----------------------------------------------------------------------------------

  /** The mood the HUD should warn about, if one is coming. */
  get warning(): { mood: Mood; dir: number } | null {
    if (this.plan && this.moodT < 1.6 && this.stam > 0.2) return { mood: this.plan.mood, dir: this.plan.dir };
    if (!this.dashed && this.dist < 30 && this.stam < 0.5 && this.mood !== 'dash')
      return { mood: 'dash', dir: 0 };
    return null;
  }

  private makeHint(): string {
    const ath = Math.abs(this.theta);
    if (this.snapMeter > 0.25 || this.T > 0.95)
      return 'Tension is too high. Ease the drag (Q) and chase the fish!';
    if (this.chafe > 0.3)
      return ath > 2.4
        ? 'Line is chafing along the hull. Steer clear of it!'
        : 'Fish under the boat. Ease away!';
    if (this.slackMeter > 0.6) return 'Slack line! Slow down, back to it, keep tension on.';
    if (this.L > LINE_MAX * 0.72) return 'Running out of line. Chase it!';
    const w = this.warning;
    if (w?.mood === 'run') return 'It is about to run. Point the bow after it!';
    if (w?.mood === 'dash') return 'It has seen the boat. Hold steady, here comes a last run.';
    if (ath > 1.9) return 'Fish is forward of the beam. Swing the stern to it!';
    if (ath > 0.9) return 'Fish is off the quarter. Bring the stern round.';
    if (this.mood === 'sulk') return 'Sounding. Hold steady and pump it up (Z).';
    if (this.mood === 'run') return this.dist > 60 ? 'Running! Run it down.' : 'Running.';
    if (this.mood === 'circle') return 'Circling. Turn with it and keep your stern to it.';
    if (this.mood === 'thrash') return 'Thrashing. Keep the line tight!';
    if (this.mood === 'tired') return this.gaffT > 0 ? 'Gaffing!' : 'Almost there. Slow down for the gaff.';
    return '';
  }

  /** Percent of the fight spent in the sweet zone. */
  get cleanPct(): number {
    return this.time > 0 ? Math.round((100 * this.sweetT) / this.time) : 0;
  }

  /** Speed of the fish over the ground in knots (for the HUD). */
  get speedKn(): number {
    return Math.hypot(this.ux + this.cur.x, this.uz + this.cur.z) * KNOTS;
  }

  drain(): Fight['events'] {
    const e = this.events.slice();
    this.events.length = 0;
    return e;
  }
}
