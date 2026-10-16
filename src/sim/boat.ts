// Rigid-body boat. Buoyancy is sampled at a cloud of hull points against the *same* wave surface the
// shader draws; forces include hull drag + lateral lift, planing lift, prop thrust (with ventilation),
// rudder & prop-wash steering, wind (hull + a lift/drag sail model with apparent wind), tidal current
// (through relative water velocity), seabed grounding and hard obstacles.

import { Quaternion, Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { type BoatSpec, RHO_A } from './boatSpec';
import { BoatWater } from './boatWater';
import { boomLimit, drawing, sailCoeffs } from './sail';
import { gradeLanding, WaveRide } from './waveRide';
import { GRAVITY, makeWaveAxis, makeWaveSample, type WaveAxis, type WaveSample } from './waves';

export interface BoatEnv {
  time: number;
  waveAt(x: number, z: number, out: WaveSample): void;
  currentAt(x: number, z: number, out: { x: number; z: number }): void;
  windAt(x: number, z: number, out: { x: number; z: number }): void;
  seabedAt(x: number, z: number): number;
  hardAt(x: number, z: number): number;
  hardNormal(x: number, z: number, out: { x: number; z: number }): void;
  /** Local short-wave energy (m) used for spray. */
  chopAt(x: number, z: number): number;
  /** Dominant wave axis and height at a point (for the wave-attack rules); absent = flat sea. */
  axisAt?(x: number, z: number, out: WaveAxis): void;
}

export interface BoatInput {
  throttle: number;
  steer: number;
  sheet: number;
  pump: boolean;
  /** Bow / stern tunnel thrusters, -1 (to port) .. +1 (to starboard). Ignored by hulls without them. */
  bow?: number;
  stern?: number;
}

/** A tug (or any outside hand) pushing on the hull: where it is made fast and the force along the hull's axes. */
export interface TugPush {
  /** Attachment point in the boat's spec frame (x forward, z to starboard). */
  x: number;
  z: number;
  /** Force along the bow (fx) and to starboard (fz), in newtons. */
  fx: number;
  fz: number;
}

export interface Impact {
  speed: number;
  x: number;
  z: number;
  hard: boolean;
}

const SUB_DT = 1 / 120;
const LIN_X = 70;

/** The sail crossing the boat: through the wind (tack) or with the wind astern (gybe). */
export interface SailEvent {
  kind: 'tack' | 'gybe';
  /** 0..1.5, how violently (apparent wind squared x how far out the boom was let). */
  strength: number;
}

/** Leak (L/s) opened per unit of hull integrity lost, before the difficulty's leak scale. */
export const LEAK_PER_DAMAGE = 6;
/** Wave-impact damage gain: hull fraction lost per (m/s over the hull's tolerance)^1.4. */
export const WAVE_DAMAGE_GAIN = 0.003;

/** A wave impact that hurt the hull (consumed by the game for toasts and shake). */
export interface WaveHit {
  /** 'slam' = bow / hull meeting a face; 'slap' = a set wave broadside. */
  kind: 'slam' | 'slap';
  /** Closing speed (m/s). */
  speed: number;
  /** Hull fraction lost. */
  damage: number;
  /** How wrong the line was, 0..1. */
  bad: number;
}

export class Boat {
  readonly water: BoatWater;
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  readonly vel = new Vector3();
  readonly angVel = new Vector3();

  // inputs (slewed)
  throttle = 0;
  steer = 0;
  sheet = 0.5;
  sailUp = true;
  private throttleCmd = 0;
  private steerCmd = 0;
  private sheetCmd = 0.5;
  /** Tunnel thrusters: commanded and actual (they spool up and down), -1..1. */
  private bowCmd = 0;
  private sternCmd = 0;
  bowThr = 0;
  sternThr = 0;
  /** Outside pushes (tugs) applied every step; the game fills and clears this list. */
  readonly tugs: TugPush[] = [];
  private readonly linX: number;

  // read-outs
  heading = 0;
  pitch = 0;
  roll = 0;
  /** Speed through the water along the hull (m/s). */
  speed = 0;
  /** Ground speed (m/s). */
  sog = 0;
  rpm = 0.2;
  thrustN = 0;
  propSubmerge = 1;
  /** Seconds of reduced thrust left after fouling the prop (crab-pot line, weed). */
  foulT = 0;
  boomAngle = 0.3;
  /** +1 boom to starboard, -1 to port. */
  boomSide = 1;
  /** 0 = sail drawing, 1 = fully luffing. */
  sailLuff = 0;
  sailPower = 0;
  /** Apparent wind speed (m/s) and angle off the bow (radians, + = from starboard, - = from port). */
  appWind = 0;
  awa = 0;
  /** Angle of attack of the sail on the apparent wind (radians): ~0.2 is ideal, ~0 luffs, > 0.3 stalls. */
  sailAlpha = 0;
  /** Tacks and gybes since the game last looked. */
  readonly sailEvents: SailEvent[] = [];
  private boomInit = false;
  /** Seconds before another tack / gybe counts as an event (the boom can only crash across so often). */
  private sailCool = 0;
  heelDeg = 0;
  /** 0..1 how hard the keel is dragging on the bottom. */
  grounded = 0;
  sinkT = 0;
  sinking = false;
  capsizeT = 0;
  capsized = false;
  readonly impacts: Impact[] = [];
  /** Hull integrity, 1 = sound, 0 = broken up. Worn down by wave impacts and collisions. */
  hull = 1;
  /** True once the hull has been pounded to pieces. */
  wrecked = false;
  /** Ambient traffic is not worn down by the sea; only the player's hull is. */
  indestructible = false;
  /** Multiplier on the leak a hull strike opens (from the difficulty). */
  leakScale = 1;
  /** Wave-attack read-outs and the Wave Rider streak. */
  readonly ride = new WaveRide();
  /** Wave impacts that damaged the hull since the game last looked. */
  readonly hits: WaveHit[] = [];
  /** Seconds the whole hull has been clear of the water. */
  airT = 0;
  /** Peak height gained over the sea during the current jump (m). */
  airPeak = 0;
  /** World position of the bow (for spray). */
  readonly bowWorld = new Vector3();
  readonly fwd = new Vector3(1, 0, 0);
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(0, 0, 1);
  /** Surface height under the CG (for camera/visual helpers). */
  seaLevel = 0;

  private readonly ws = makeWaveSample();
  private readonly ws2 = makeWaveSample();
  private readonly cur = { x: 0, z: 0 };
  /** Tidal current at the bow and stern: in the throat the flow changes along a hull, which yaws it. */
  private readonly curBow = { x: 0, z: 0 };
  private readonly curStern = { x: 0, z: 0 };
  private readonly xBow: number;
  private readonly xStern: number;
  private readonly wnd = { x: 0, z: 0 };
  private readonly nrm = { x: 0, z: 0 };
  private readonly com = { x: 0, y: 0, z: 0 };
  private readonly latLift: Float64Array;
  private readonly bowIdx: number;
  private bowImmPrev = 0;
  private slamImpact = 0;
  private hitImpact = 0;
  /** Worst wave impact of the last frame (m/s). */
  private frameImpact = 0;
  private wetMin = 99;
  private readonly prevImm: Float64Array;
  private readonly axis = makeWaveAxis();
  // individual wave tracking at the CG (for broadside slaps)
  private vyPrev = 0;
  private troughH = 0;
  private slapCool = 0;
  private readonly toughness: number;
  private readonly weirOver: number[];
  private readonly accel = new Vector3();
  private readonly prevVel = new Vector3();
  private acc = 0;
  // force accumulators
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private readonly inertia: [number, number, number];
  private readonly angDamp: [number, number, number];
  private readonly liftK: number;
  private readonly backstop: { rollFrom: number; rollTo: number; arm: number };
  private readonly kTotal: number;
  private contactStrength = 0;
  private lastGood = new Vector3();

  constructor(readonly spec: BoatSpec) {
    this.water = new BoatWater(spec);
    this.linX = spec.linDrag ?? LIN_X;
    this.humpGain = spec.hump.gain;
    this.humpSpeed = spec.hump.speed;
    this.humpWidth = spec.hump.width;
    let kTotal = 0;
    for (const s of spec.samples) kTotal += s.k;
    this.kTotal = kTotal;
    const latTotal = 0.28 * spec.mass * spec.keel;
    this.latLift = Float64Array.from(spec.samples, (s) => (latTotal * s.k) / kTotal);
    let best = 0;
    for (let i = 0; i < spec.samples.length; i++)
      if ((spec.samples[i]?.x ?? 0) > (spec.samples[best]?.x ?? 0)) best = i;
    this.bowIdx = best;
    this.prevImm = new Float64Array(spec.samples.length);
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const smp of spec.samples) {
      xMin = Math.min(xMin, smp.x);
      xMax = Math.max(xMax, smp.x);
    }
    this.xStern = xMin - spec.cg[0];
    this.xBow = xMax - spec.cg[0];
    // the impact speed a hull shrugs off: bigger, heavier-built boats are made for it
    this.toughness = spec.strength;
    this.weirOver = new Array(spec.weirs.length).fill(-1);
    // a long hull carries many bumpers, so each one is softer: the whole side is as stiff as a small boat's
    this.bumperScale = Math.min(1, 8 / Math.max(1, spec.bumpers.length));
    this.inertia = [spec.inertia[0], spec.inertia[1], spec.inertia[2]];
    // Hydrodynamic damping isn't modelled per point, so floor the angular damping from the hull's
    // own stiffness: roughly 20% of critical in roll, 30% in pitch (kills porpoising).
    let kPitch = 0;
    let kRoll = 0;
    for (const s of spec.samples) {
      const dx = s.x - spec.cg[0];
      const dz = s.z - spec.cg[2];
      kPitch += s.k * dx * dx;
      kRoll += s.k * dz * dz;
    }
    kRoll = Math.max(0.2 * kRoll, kRoll - spec.mass * GRAVITY * Math.max(0, spec.cg[1] + 0.5 * spec.draft));
    this.angDamp = [
      Math.max(spec.angDamp[0], 2 * 0.2 * Math.sqrt(kRoll * this.inertia[0])),
      spec.angDamp[1],
      Math.max(spec.angDamp[2], 2 * 0.3 * Math.sqrt(kPitch * this.inertia[2])),
    ];
    // sailboats legitimately heel further under sail
    this.backstop = spec.sail
      ? { rollFrom: 0.85, rollTo: 1.35, arm: 0.9 }
      : { rollFrom: 0.6, rollTo: 1.3, arm: 1.1 };
    const p = spec.planing;
    this.liftK = p.fraction > 0 ? (p.fraction * spec.mass * GRAVITY) / (p.speed * p.speed * p.aoa) : 0;
  }

  /** Place the boat floating level on the water at (x, z) with the given heading (atan2(z, x)). */
  reset(x: number, z: number, heading: number, env?: BoatEnv): void {
    this.quat.setFromAxisAngle(new Vector3(0, 1, 0), -heading);
    this.pos.set(x, 0, z);
    if (env) {
      env.waveAt(x, z, this.ws);
      this.pos.y = this.ws.h + this.spec.cg[1];
    } else {
      this.pos.y = this.spec.cg[1];
    }
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.throttle = this.throttleCmd = 0;
    this.steer = this.steerCmd = 0;
    this.bowThr = this.bowCmd = this.sternThr = this.sternCmd = 0;
    this.tugs.length = 0;
    this.sinkT = 0;
    this.sinking = false;
    this.capsizeT = 0;
    this.capsized = false;
    this.grounded = 0;
    this.foulT = 0;
    this.hull = 1;
    this.wrecked = false;
    this.boomInit = false;
    this.sailCool = 0;
    this.sailEvents.length = 0;
    this.ride.reset();
    this.hits.length = 0;
    this.airT = this.airPeak = 0;
    this.hitImpact = this.slamImpact = this.frameImpact = 0;
    this.vyPrev = this.troughH = this.slapCool = 0;
    this.prevImm.fill(0);
    this.water.reset();
    this.impacts.length = 0;
    this.lastGood.copy(this.pos);
    this.prevVel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
  }

  setInput(i: BoatInput): void {
    this.throttleCmd = clamp(i.throttle, -1, 1);
    this.steerCmd = clamp(i.steer, -1, 1);
    this.sheetCmd = clamp(i.sheet, 0, 1);
    this.water.pumping = i.pump;
    this.bowCmd = clamp(i.bow ?? 0, -1, 1);
    this.sternCmd = clamp(i.stern ?? 0, -1, 1);
  }

  /** Advance the boat by `dt` seconds (internally sub-stepped). */
  update(dt: number, env: BoatEnv): void {
    // control slew
    const uAbs = Math.abs(this.speed);
    const rate = this.throttleCmd > this.throttle ? 0.95 : 1.8;
    this.throttle += clamp(this.throttleCmd - this.throttle, -rate * dt, rate * dt);
    const e = this.spec.engine;
    const steerScale = 1 / (1 + (uAbs / (this.spec.topSpeed * 0.55)) ** 2);
    const target = this.steerCmd * e.steerMax * (0.35 + 0.65 * steerScale);
    this.steer += clamp(target - this.steer, -e.steerRate * dt, e.steerRate * dt);
    this.sheet += clamp(this.sheetCmd - this.sheet, -0.5 * dt, 0.5 * dt);
    // tunnel thrusters spool up in about a second
    this.bowThr += clamp(this.bowCmd - this.bowThr, -1.4 * dt, 1.4 * dt);
    this.sternThr += clamp(this.sternCmd - this.sternThr, -1.4 * dt, 1.4 * dt);

    const n = Math.min(6, Math.max(1, Math.ceil(dt / SUB_DT)));
    const h = dt / n;
    this.wetMin = 99;
    this.sailCool = Math.max(0, this.sailCool - dt);
    for (let i = 0; i < n; i++) this.step(h, env);
    this.updateWater(dt, env);
    this.updateReadouts(env);
    this.updateRide(dt, env);
    // sinking & capsize
    if (this.water.litres >= (this.capacityLimit ?? 1e9)) this.sinking = true;
    if (this.sinking) this.sinkT = Math.min(1, this.sinkT + dt / 5);
    if (this.up.y < 0.25) this.capsizeT += dt;
    else this.capsizeT = Math.max(0, this.capsizeT - dt * 2);
    if (this.capsizeT > 1.8) this.capsized = true;
    // sanity
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z)) {
      this.pos.copy(this.lastGood);
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
      this.quat.identity();
    } else if (this.acc++ % 30 === 0) this.lastGood.copy(this.pos);
  }

  /** Set by the game from difficulty: litres of water at which the boat sinks. */
  capacityLimit: number | null = null;

  // ------------------------------------------------------------------------------------------------

  private addF(Fx: number, Fy: number, Fz: number, rx: number, ry: number, rz: number): void {
    this.fx += Fx;
    this.fy += Fy;
    this.fz += Fz;
    this.tx += ry * Fz - rz * Fy;
    this.ty += rz * Fx - rx * Fz;
    this.tz += rx * Fy - ry * Fx;
  }

  private step(dt: number, env: BoatEnv): void {
    const spec = this.spec;
    const q = this.quat;
    const pos = this.pos;
    const vel = this.vel;
    const om = this.angVel;
    const ws = this.ws;
    const cur = this.cur;

    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    const r00 = 1 - 2 * (yy + zz);
    const r01 = 2 * (xy - wz);
    const r02 = 2 * (xz + wy);
    const r10 = 2 * (xy + wz);
    const r11 = 1 - 2 * (xx + zz);
    const r12 = 2 * (yz - wx);
    const r20 = 2 * (xz - wy);
    const r21 = 2 * (yz + wx);
    const r22 = 1 - 2 * (xx + yy);

    this.fx = this.fy = this.fz = this.tx = this.ty = this.tz = 0;
    const cgx = spec.cg[0];
    const cgy = spec.cg[1];
    const cgz = spec.cg[2];
    const sinkScale = 1 - this.sinkT * 0.97;

    env.currentAt(pos.x, pos.z, cur);
    env.currentAt(pos.x + r00 * this.xBow, pos.z + r20 * this.xBow, this.curBow);
    env.currentAt(pos.x + r00 * this.xStern, pos.z + r20 * this.xStern, this.curStern);
    const curSpan = Math.max(0.5, this.xBow - this.xStern);
    // forward speed through the water (CG), used for hump drag / lift / thrust curve
    const rvx0 = vel.x - cur.x;
    const rvz0 = vel.z - cur.z;
    const uf = r00 * rvx0 + r10 * vel.y + r20 * rvz0;
    // displacement hulls hit a wave-making wall past their hull speed
    const wall = spec.hullSpeed ? 1 + 12 * Math.max(0, Math.abs(uf) / spec.hullSpeed - 1) ** 1.5 : 1;
    const hf =
      (1 + this.humpGain * Math.exp(-(((Math.abs(uf) - this.humpSpeed) / this.humpWidth) ** 2))) * wall;
    const pitch = Math.asin(clamp(r10, -1, 1));
    const aoaEff = clamp(pitch + 0.035, 0.0, 0.26);
    const ufPos = Math.max(0, uf);
    // deterministic drop in wetted area once up on the plane (avoids a stall/bistability around the hump)
    const planeFrac =
      smoothstep(spec.hump.speed, spec.planing.speed * 0.9, ufPos) * Math.min(1, spec.planing.fraction / 0.5);
    const heaveDampBoost =
      3.2 * smoothstep(0, spec.planing.speed, ufPos) * Math.min(1, spec.planing.fraction * 1.5);

    // ---- hull samples ------------------------------------------------------------------------
    const samples = spec.samples;
    let groundTouch = 0;
    let wetCount = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const lx = s.x - cgx;
      const ly = s.y - cgy;
      const lz = s.z - cgz;
      const rx = r00 * lx + r01 * ly + r02 * lz;
      const ry = r10 * lx + r11 * ly + r12 * lz;
      const rz = r20 * lx + r21 * ly + r22 * lz;
      const px = pos.x + rx;
      const py = pos.y + ry;
      const pz = pos.z + rz;
      const vpx = vel.x + om.y * rz - om.z * ry;
      const vpy = vel.y + om.z * rx - om.x * rz;
      const vpz = vel.z + om.x * ry - om.y * rx;
      env.waveAt(px, pz, ws);
      const imm = ws.h - py;
      const prevImm = this.prevImm[i] as number;
      this.prevImm[i] = imm > 0 ? imm : 0;

      // seabed contact at the sample bottoms
      const bed = env.seabedAt(px, pz);
      if (py < bed) groundTouch += this.contactAt(px, py, pz, bed, rx, ry, rz, vpx, vpy, vpz, env, true);

      if (imm <= 0) {
        if (i === this.bowIdx) this.bowImmPrev = 0;
        continue;
      }
      wetCount++;
      // the current this part of the hull sits in: bow and stern can be in different flow
      const tc = (s.x - cgx - this.xStern) / curSpan;
      const wvx = lerp(this.curStern.x, this.curBow.x, tc) + ws.vx;
      const wvy = ws.vy;
      const wvz = lerp(this.curStern.z, this.curBow.z, tc) + ws.vz;
      const rvx = vpx - wvx;
      const rvy = vpy - wvy;
      const rvz = vpz - wvz;
      const ub = r00 * rvx + r10 * rvy + r20 * rvz;
      const wb = r02 * rvx + r12 * rvy + r22 * rvz;

      if (i === this.bowIdx) {
        if (this.bowImmPrev < 0.02 && imm > 0.04 && rvy < -1.2)
          this.slamImpact = Math.max(this.slamImpact, -rvy);
        this.bowImmPrev = imm;
      }
      // any sample meeting the water: closing speed normal to the wave face (bow stuffing, side slaps)
      if (prevImm < 0.02 && imm > 0.04) {
        const closing = -(rvx * ws.nx + rvy * ws.ny + rvz * ws.nz);
        if (closing > 0) {
          const share = (s.x - spec.cg[0]) / spec.length;
          const wgt = share > 0.2 ? 1 : share > -0.15 ? 0.8 : 0.55;
          this.hitImpact = Math.max(this.hitImpact, closing * wgt);
        }
      }

      const sc = imm < s.cell ? imm : s.cell;
      let fyb = s.k * sinkScale * sc * (1 + spec.flare * sc);
      // planing lift is a stiff spring, so damp heave in proportion to it (kills the 'bouncing ball')
      fyb -= s.c * (1 + heaveDampBoost) * rvy * Math.min(1, imm / 0.1);
      if (fyb < 0) fyb = 0;

      const wetImm = Math.min(1, imm / (s.cell * 0.35));
      const wet = Math.max(0.5, wetImm) * (1 - 0.62 * planeFrac);
      const fdx = -(s.dragX * hf * Math.abs(ub) + (this.linX * s.k) / this.kTotal) * ub * wet;
      // lateral lift stays effective on the planing strip: it saturates with very little immersion
      const wetLat = Math.min(1, imm / 0.12);
      const fdz = -(this.latLift[i]! * Math.abs(ub) + s.dragZ * spec.keel * Math.abs(wb)) * wb * wetLat;
      // lift grows with immersion (wetted planing strip): the deeper chine lifts more => roll/heave stiffness
      const lift = this.liftK * s.lift * ufPos * ufPos * aoaEff * Math.min(1.8, imm / 0.1) * 0.78 * sinkScale;

      const Fx = fdx * r00 + fdz * r02 + lift * r01;
      const Fy = fyb + fdx * r10 + fdz * r12 + lift * r11;
      const Fz = fdx * r20 + fdz * r22 + lift * r21;
      // forces on a submerged column act at its centroid (mid-immersion), not at the hull bottom
      const hy = 0.5 * sc;
      this.addF(Fx, Fy, Fz, rx + r01 * hy, ry + r11 * hy, rz + r21 * hy);
    }

    this.wetMin = Math.min(this.wetMin, wetCount);

    // keel / skeg ground contact (deep-keeled boats touch first)
    {
      const kx = -cgx;
      const ky = -spec.keelDepth - cgy;
      const rx = r00 * kx + r01 * ky;
      const ry = r10 * kx + r11 * ky;
      const rz = r20 * kx + r21 * ky;
      const px = pos.x + rx;
      const py = pos.y + ry;
      const pz = pos.z + rz;
      const bed = env.seabedAt(px, pz);
      if (py < bed) {
        const vpx = vel.x + om.y * rz - om.z * ry;
        const vpy = vel.y + om.z * rx - om.x * rz;
        const vpz = vel.z + om.x * ry - om.y * rx;
        groundTouch += this.contactAt(px, py, pz, bed, rx, ry, rz, vpx, vpy, vpz, env, true);
      }
    }
    this.contactStrength = groundTouch;

    // ---- gravity ---------------------------------------------------------------------------------
    const wm = this.water.effMass;
    this.fy -= spec.mass * GRAVITY;
    if (wm > 0) {
      this.water.comLocal(this.com);
      const lx = this.com.x - cgx;
      const ly = this.com.y - cgy;
      const lz = this.com.z - cgz;
      const rx = r00 * lx + r01 * ly + r02 * lz;
      const ry = r10 * lx + r11 * ly + r12 * lz;
      const rz = r20 * lx + r21 * ly + r22 * lz;
      this.addF(0, -wm * GRAVITY, 0, rx, ry, rz);
    }

    // ---- propulsion ----------------------------------------------------------------------------------
    const eng = spec.engine;
    {
      const lx = eng.x - cgx;
      const ly = eng.y - cgy;
      const lz = -cgz;
      const rx = r00 * lx + r01 * ly + r02 * lz;
      const ry = r10 * lx + r11 * ly + r12 * lz;
      const rz = r20 * lx + r21 * ly + r22 * lz;
      const px = pos.x + rx;
      const py = pos.y + ry;
      const pz = pos.z + rz;
      env.waveAt(px, pz, this.ws2);
      const sub = clamp((this.ws2.h - py + 0.05) / 0.22, 0, 1);
      this.propSubmerge += (sub - this.propSubmerge) * Math.min(1, dt * 14);
      const vent = 0.1 + 0.9 * this.propSubmerge;
      let T = 0;
      if (this.throttle >= 0) {
        T = eng.thrust * this.throttle * Math.max(0, 1 - (ufPos / eng.zeroThrustSpeed) ** 1.35);
      } else {
        const ur = Math.max(0, -uf);
        T =
          -eng.thrust *
          eng.reverse *
          -this.throttle *
          Math.max(0, 1 - (ur / (eng.zeroThrustSpeed * 0.35)) ** 1.35);
      }
      T *= vent;
      if (this.foulT > 0) {
        // a rope round the prop: it barely bites, and chatters
        T *= 0.08 + 0.1 * Math.max(0, Math.sin(this.foulT * 23));
        this.foulT = Math.max(0, this.foulT - dt);
      }
      this.thrustN = T;
      const d = this.steer * eng.washSteer;
      const tlx = T * Math.cos(d);
      const tlz = -T * Math.sin(d);
      // rudder: flow = boat speed + prop wash
      const flow = Math.sign(uf) * uf * uf + 0.0008 * Math.max(0, T);
      const rud = -eng.rudder * flow * this.steer * (0.35 + 0.65 * this.propSubmerge);
      const lz2 = tlz + rud;
      this.addF(r00 * tlx + r02 * lz2, r10 * tlx + r12 * lz2, r20 * tlx + r22 * lz2, rx, ry, rz);
      // twin screws / azimuth drives: a pure yaw couple about the hull's vertical axis (steer > 0 turns to starboard)
      if (eng.pivot) {
        const tq =
          -eng.pivot * (this.steer / Math.max(0.01, eng.steerMax)) * (0.35 + 0.65 * this.propSubmerge);
        this.tx += tq * r01;
        this.ty += tq * r11;
        this.tz += tq * r21;
      }
    }

    // ---- tunnel thrusters and tug pushes (side forces at the waterline) ---------------------------------------
    {
      const th = spec.thrusters;
      if (th) {
        // a tunnel thruster loses its bite once the ship is moving through the water
        const fade = 1 / (1 + (uf / 2.4) ** 2);
        const side = (t: { x: number; force: number } | undefined, cmd: number): void => {
          if (!t || Math.abs(cmd) < 1e-3) return;
          const F = t.force * cmd * fade;
          const lx = t.x - cgx;
          const ly = -cgy;
          const lz = -cgz;
          const rx = r00 * lx + r01 * ly + r02 * lz;
          const ry = r10 * lx + r11 * ly + r12 * lz;
          const rz = r20 * lx + r21 * ly + r22 * lz;
          this.addF(F * r02, F * r12, F * r22, rx, ry, rz);
        };
        side(th.bow, this.bowThr);
        side(th.stern, this.sternThr);
      }
      for (const t of this.tugs) {
        const lx = t.x - cgx;
        const ly = -cgy;
        const lz = t.z - cgz;
        const rx = r00 * lx + r01 * ly + r02 * lz;
        const ry = r10 * lx + r11 * ly + r12 * lz;
        const rz = r20 * lx + r21 * ly + r22 * lz;
        this.addF(r00 * t.fx + r02 * t.fz, r10 * t.fx + r12 * t.fz, r20 * t.fx + r22 * t.fz, rx, ry, rz);
      }
    }

    // ---- running trim (bow-up when planing / climbing the hump) --------------------------------------
    if (spec.trim.gain > 0 && ufPos > 1) {
      const pl = smoothstep(0.25, 0.9, ufPos / spec.planing.speed);
      const hump = Math.exp(-(((ufPos - spec.hump.speed) / (spec.hump.width * 1.2)) ** 2));
      const target = spec.trim.plane * pl + spec.trim.hump * hump * (1 - pl * 0.6);
      const tq = spec.trim.gain * ufPos * ufPos * (target - pitch) * this.propSubmerge;
      this.tx += tq * r02;
      this.ty += tq * r12;
      this.tz += tq * r22;
    }

    // ---- wind on hull and rig -----------------------------------------------------------------------------
    {
      env.windAt(pos.x, pos.z, this.wnd);
      const ax = this.wnd.x - vel.x;
      const az = this.wnd.z - vel.z;
      const ua = r00 * ax + r20 * az;
      const wa = r02 * ax + r22 * az;
      this.appWind = Math.hypot(ua, wa);
      this.awa = (wa < 0 ? 1 : -1) * Math.atan2(Math.abs(wa), -ua);
      const k = 0.5 * RHO_A;
      const wd = spec.wind;
      const Fxb = k * wd.cdFront * wd.front * ua * Math.abs(ua);
      const Fzb = k * wd.cdSide * wd.side * wa * Math.abs(wa);
      const lx = wd.ceX - cgx;
      const ly = wd.ceY - cgy;
      const lz = -cgz;
      const rx = r00 * lx + r01 * ly + r02 * lz;
      const ry = r10 * lx + r11 * ly + r12 * lz;
      const rz = r20 * lx + r21 * ly + r22 * lz;
      this.addF(Fxb * r00 + Fzb * r02, Fxb * r10 + Fzb * r12, Fxb * r20 + Fzb * r22, rx, ry, rz);

      // sail: a foil with stall. The boom is held by the sheet; lift is perpendicular to the apparent wind
      // and always points to the lee side of the sail, drag runs with the wind.
      const sail = spec.sail;
      if (sail && this.sailUp) {
        const vapp = this.appWind;
        if (vapp > 0.2) {
          const dx = ua / vapp;
          const dz = wa / vapp;
          const gamma = Math.abs(this.awa);
          // the boom changes sides only once the wind is clearly on the other side (no flicker dead astern)
          const want = wa >= 0 ? 1 : -1;
          if (!this.boomInit) {
            this.boomSide = want;
            this.boomInit = true;
          } else if (want !== this.boomSide && Math.abs(wa) > 0.12 * vapp) {
            this.boomSide = want;
            const strength = clamp((vapp * vapp * (0.35 + boomLimit(this.sheet) / 1.4)) / 100, 0, 1.5);
            this.sailEvents.push({ kind: gamma > 1.9 ? 'gybe' : 'tack', strength });
            if (gamma > 1.9) {
              // a crash gybe: the boom slams across and the boat lurches over to the new lee side
              this.angVel.x += this.fwd.x * want * 0.5 * strength;
              this.angVel.y += this.fwd.y * want * 0.5 * strength;
              this.angVel.z += this.fwd.z * want * 0.5 * strength;
              if (strength > 0.8) this.damage(0.02 * strength);
            }
          }
          const thetaB = Math.min(boomLimit(this.sheet), gamma);
          this.boomAngle = thetaB;
          const alpha = gamma - thetaB;
          this.sailAlpha = alpha;
          const luff = drawing(alpha);
          this.sailLuff = 1 - luff;
          const { cl, cd } = sailCoeffs(alpha);
          const qA = 0.5 * RHO_A * vapp * vapp * sail.area;
          const sgn = -this.boomSide;
          const px = -dz * sgn;
          const pz = dx * sgn;
          const Fbx = qA * (cl * luff * px + cd * dx);
          const Fbz = qA * (cl * luff * pz + cd * dz);
          this.sailPower = Math.hypot(Fbx, Fbz);
          const lx2 = sail.x - cgx;
          const ly2 = sail.y - cgy;
          const rx2 = r00 * lx2 + r01 * ly2 + r02 * -cgz;
          const ry2 = r10 * lx2 + r11 * ly2 + r12 * -cgz;
          const rz2 = r20 * lx2 + r21 * ly2 + r22 * -cgz;
          this.addF(Fbx * r00 + Fbz * r02, Fbx * r10 + Fbz * r12, Fbx * r20 + Fbz * r22, rx2, ry2, rz2);
        } else {
          this.sailPower = 0;
          this.sailLuff = 1;
        }
      } else this.sailPower = 0;
    }

    // ---- hard obstacles (seawall, jetties, docks, pilings) ----------------------------------------------------
    for (const b of spec.bumpers) {
      const lx = b.x - cgx;
      const ly = b.y - cgy;
      const lz = b.z - cgz;
      const rx = r00 * lx + r01 * ly + r02 * lz;
      const ry = r10 * lx + r11 * ly + r12 * lz;
      const rz = r20 * lx + r21 * ly + r22 * lz;
      const px = pos.x + rx;
      const pz = pos.z + rz;
      const d = env.hardAt(px, pz) - b.r;
      if (d >= 0) continue;
      env.hardNormal(px, pz, this.nrm);
      const nx = this.nrm.x;
      const nz = this.nrm.z;
      const vpx = vel.x + om.y * rz - om.z * ry;
      const vpz = vel.z + om.x * ry - om.y * rx;
      const vn = vpx * nx + vpz * nz; // negative = moving into the obstacle
      const pen = Math.min(-d, 2.2);
      const kC = ((spec.mass * 38) / 3) * this.bumperScale;
      const cC = 2 * 0.55 * Math.sqrt(kC * (spec.mass / 4));
      let fn = kC * pen - (vn < 0 ? cC * vn : 0);
      if (fn < 0) fn = 0;
      // tangential friction
      const tx = vpx - vn * nx;
      const tz = vpz - vn * nz;
      const tl = Math.hypot(tx, tz) || 1;
      const ff = Math.min(0.25 * fn, tl * spec.mass * 0.5);
      this.addF(nx * fn - (tx / tl) * ff, 0, nz * fn - (tz / tl) * ff, rx, ry, rz);
      if (vn < -this.impactMin && this.impactCool <= 0) {
        this.impacts.push({ speed: -vn, x: px, z: pz, hard: true });
        this.impactCool = 0.35;
      }
    }
    this.impactCool -= dt;

    // ---- reserve-buoyancy backstop ----------------------------------------------------------------------------
    // The point-buoyancy model has no topside reserve volume, so past ~35 deg a progressive righting moment
    // stands in for it (rolling a boat over should be an extreme event, not the default result of speed).
    {
      const heel = Math.asin(clamp(-r12, -1, 1));
      const hAbs = Math.abs(heel);
      const rb = smoothstep(this.backstop.rollFrom, this.backstop.rollTo, hAbs);
      if (rb > 0) {
        const tq = -Math.sign(heel) * rb * spec.mass * GRAVITY * this.backstop.arm;
        this.tx += tq * r00;
        this.ty += tq * r10;
        this.tz += tq * r20;
      }
      const pAbs = Math.abs(pitch);
      const pb = smoothstep(0.55, 1.2, pAbs);
      if (pb > 0) {
        const tq = -Math.sign(pitch) * pb * spec.mass * GRAVITY * 1.3;
        this.tx += tq * r02;
        this.ty += tq * r12;
        this.tz += tq * r22;
      }
    }

    // ---- integrate ---------------------------------------------------------------------------------------------
    const mTot = spec.mass + wm;
    vel.x += (this.fx / mTot) * dt;
    vel.y += (this.fy / mTot) * dt;
    vel.z += (this.fz / mTot) * dt;
    const vmag = vel.length();
    if (vmag > 70) vel.multiplyScalar(70 / vmag);
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    // angular: body-frame Euler equations
    const wk = 1 + (wm / spec.mass) * 0.7;
    const Ix = this.inertia[0] * wk;
    const Iy = this.inertia[1] * wk;
    const Iz = this.inertia[2] * wk;
    const tbx = r00 * this.tx + r10 * this.ty + r20 * this.tz;
    const tby = r01 * this.tx + r11 * this.ty + r21 * this.tz;
    const tbz = r02 * this.tx + r12 * this.ty + r22 * this.tz;
    let wbx = r00 * om.x + r10 * om.y + r20 * om.z;
    let wby = r01 * om.x + r11 * om.y + r21 * om.z;
    let wbz = r02 * om.x + r12 * om.y + r22 * om.z;
    const dmp = this.angDamp;
    const tx2 = tbx - dmp[0] * wbx;
    const ty2 = tby - dmp[1] * wby;
    const tz2 = tbz - dmp[2] * wbz;
    const ax = (tx2 - (Iz - Iy) * wby * wbz) / Ix;
    const ay = (ty2 - (Ix - Iz) * wbz * wbx) / Iy;
    const az = (tz2 - (Iy - Ix) * wbx * wby) / Iz;
    wbx += ax * dt;
    wby += ay * dt;
    wbz += az * dt;
    om.x = r00 * wbx + r01 * wby + r02 * wbz;
    om.y = r10 * wbx + r11 * wby + r12 * wbz;
    om.z = r20 * wbx + r21 * wby + r22 * wbz;
    const wmag = om.length();
    if (wmag > 7) om.multiplyScalar(7 / wmag);

    const hdt = 0.5 * dt;
    const a = om.x;
    const b = om.y;
    const c = om.z;
    q.set(
      x + hdt * (a * w + b * z - c * y),
      y + hdt * (-a * z + b * w + c * x),
      z + hdt * (a * y - b * x + c * w),
      w + hdt * (-a * x - b * y - c * z),
    ).normalize();
  }

  private impactCool = 0;
  /** Closing speed (m/s) at which a hard contact is reported; a docking game lowers it to hear every bump. */
  impactMin = 1.0;
  private bumperScale = 1;
  private readonly humpGain: number;
  private readonly humpSpeed: number;
  private readonly humpWidth: number;

  /** Spring-damper + friction against the seabed. Returns a 0..1-ish intensity. */
  private contactAt(
    px: number,
    py: number,
    pz: number,
    bed: number,
    rx: number,
    ry: number,
    rz: number,
    vpx: number,
    vpy: number,
    vpz: number,
    _env: BoatEnv,
    _soft: boolean,
  ): number {
    const spec = this.spec;
    const pen = Math.min(bed - py, 0.9);
    if (pen <= 0) return 0;
    const n = spec.samples.length + 1;
    const kG = (spec.mass * GRAVITY * 7) / n;
    const cG = 2 * 0.5 * Math.sqrt((kG * spec.mass) / n);
    let fy = kG * pen - (vpy < 0 ? cG * vpy : 0);
    if (fy < 0) fy = 0;
    const sp = Math.hypot(vpx, vpz);
    const mu = 0.55;
    const ff = sp > 0.02 ? Math.min(mu * fy, sp * spec.mass * 0.6) : 0;
    const fx = sp > 0 ? (-vpx / sp) * ff : 0;
    const fz = sp > 0 ? (-vpz / sp) * ff : 0;
    this.addF(fx, fy, fz, rx, ry, rz);
    if (vpy < -1.4 && this.impactCool <= 0 && bed < 0.4) {
      this.impacts.push({ speed: -vpy, x: px, z: pz, hard: false });
      this.impactCool = 0.5;
    }
    void pz;
    return Math.min(1, pen * 2);
  }

  // ------------------------------------------------------------------------------------------------

  private updateWater(dt: number, env: BoatEnv): void {
    const spec = this.spec;
    const q = this.quat;
    const pos = this.pos;
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    const r00 = 1 - 2 * (yy + zz);
    const r01 = 2 * (xy - wz);
    const r02 = 2 * (xz + wy);
    const r10 = 2 * (xy + wz);
    const r11 = 1 - 2 * (xx + zz);
    const r12 = 2 * (yz - wx);
    const r20 = 2 * (xz - wy);
    const r21 = 2 * (yz + wx);
    const r22 = 1 - 2 * (xx + yy);
    const cg = spec.cg;
    const ws = this.ws2;

    for (let i = 0; i < spec.weirs.length; i++) {
      const wr = spec.weirs[i]!;
      const lx = wr.x - cg[0];
      const ly = wr.y - cg[1];
      const lz = wr.z - cg[2];
      const px = pos.x + r00 * lx + r01 * ly + r02 * lz;
      const py = pos.y + r10 * lx + r11 * ly + r12 * lz;
      const pz = pos.z + r20 * lx + r21 * ly + r22 * lz;
      env.waveAt(px, pz, ws);
      this.weirOver[i] = ws.h - py;
      if (i === 0) this.bowWorld.set(px, py, pz);
    }

    // scupper head
    const co = spec.cockpit;
    const sl = { x: co.scupperX - cg[0], y: co.soleY - cg[1], z: -cg[2] };
    const spx = pos.x + r00 * sl.x + r01 * sl.y + r02 * sl.z;
    const spy = pos.y + r10 * sl.x + r11 * sl.y + r12 * sl.z;
    const spz = pos.z + r20 * sl.x + r21 * sl.y + r22 * sl.z;
    env.waveAt(spx, spz, ws);
    const inside = spy + this.water.depth;
    const head = inside - ws.h;

    // effective gravity tilt (for slosh)
    const a = this.accel;
    a.copy(this.vel)
      .sub(this.prevVel)
      .multiplyScalar(1 / Math.max(dt, 1e-3));
    this.prevVel.copy(this.vel);
    this.accelF.lerp(a, Math.min(1, dt * 6));
    const gx = -this.accelF.x;
    const gy = -GRAVITY - this.accelF.y;
    const gz = -this.accelF.z;
    const bx = r00 * gx + r10 * gy + r20 * gz;
    const by = r01 * gx + r11 * gy + r21 * gz;
    const bz = r02 * gx + r12 * gy + r22 * gz;
    const tiltRoll = Math.atan2(bz, -by);
    const tiltPitch = Math.atan2(bx, -by);

    env.waveAt(pos.x, pos.z, this.ws);
    this.seaLevel = this.ws.h;
    const bowSpeed = Math.max(0, this.speed);
    const chop = env.chopAt(pos.x, pos.z);
    this.water.update(
      dt,
      this.weirOver,
      bowSpeed,
      chop,
      this.slamImpact,
      tiltRoll,
      tiltPitch,
      head,
      this.ride.water,
    );
    this.frameImpact = Math.max(this.slamImpact, 0.9 * this.hitImpact);
    this.waveImpacts(this.frameImpact);
    this.slamImpact = 0;
    this.hitImpact = 0;
  }

  /** Turn a frame's worst wave impact into hull damage, scaled by how well the sea was met. */
  private waveImpacts(impact: number): void {
    const f = this.ride.damage;
    if (f <= 0 || this.wrecked) return;
    const over = impact - this.toughness;
    if (over <= 0) return;
    const dmg = WAVE_DAMAGE_GAIN * over ** 1.4 * f;
    if (dmg < 0.0005) return;
    this.damage(dmg);
    this.hits.push({ kind: 'slam', speed: impact, damage: dmg, bad: this.ride.bad });
    if (this.hits.length > 8) this.hits.shift();
    if (dmg > 0.006) this.ride.breakStreak('hit');
  }

  /** Wear the hull down; every bit of lost integrity opens a seam that leaks. */
  damage(amount: number): void {
    if (amount <= 0 || this.wrecked || this.indestructible) return;
    this.hull = Math.max(0, this.hull - amount);
    this.water.leak = Math.min(9, this.water.leak + amount * LEAK_PER_DAMAGE * this.leakScale);
    if (this.hull <= 0) {
      this.wrecked = true;
      this.sinking = true;
    }
  }

  /**
   * Set waves: when a crest noticeably bigger than the average wave passes while the hull lies broadside
   * to the sea in rough water, it slaps the side: water aboard, a roll away from the wave, a shove and
   * some damage. A clean 45 degree line (or head-on, where the bow takes it instead) never gets this.
   */
  private broadside(dt: number): void {
    this.slapCool = Math.max(0, this.slapCool - dt);
    const vy = this.ws.vy;
    const h = this.seaLevel;
    let crest = false;
    if (this.vyPrev < 0 && vy >= 0) this.troughH = h;
    else if (this.vyPrev > 0 && vy <= 0) crest = true;
    this.vyPrev = vy;
    const r = this.ride;
    if (!crest || this.slapCool > 0 || this.wrecked) return;
    if (r.beam < 0.3 || r.rough < 0.12 || Math.abs(this.speed) < 2.5) return;
    const height = h - this.troughH;
    if (height < 0.5 * this.axis.hs) return;
    const m = clamp(height / Math.max(0.3, this.axis.hs), 0.6, 1.6) * r.beam * (0.35 + r.rough);
    this.slapCool = 2.6;
    const spec = this.spec;
    this.water.addBurst(110 * m * Math.min(1.3, 7.4 / spec.length));
    // the wave comes from `travel`; it shoves the hull along it and rolls the deck away from it
    const tx = Math.cos(this.axis.travel);
    const tz = Math.sin(this.axis.travel);
    const side = Math.sign(tx * this.right.x + tz * this.right.z) || 1;
    const light = clamp(Math.sqrt(2400 / spec.mass), 0.35, 1.2);
    this.angVel.x += this.fwd.x * side * 0.6 * m * light;
    this.angVel.y += this.fwd.y * side * 0.6 * m * light;
    this.angVel.z += this.fwd.z * side * 0.6 * m * light;
    this.vel.x += tx * 0.5 * m * light;
    this.vel.z += tz * 0.5 * m * light;
    const dmg = 0.04 * m * r.damage;
    this.damage(dmg);
    this.hits.push({ kind: 'slap', speed: 4 + 4 * m, damage: dmg, bad: r.bad });
    if (this.hits.length > 8) this.hits.shift();
    r.breakStreak('hit');
  }

  /** Wave-attack read-outs, the Wave Rider streak and jump (air time) bookkeeping. */
  private updateRide(dt: number, env: BoatEnv): void {
    const ax = this.axis;
    if (env.axisAt) env.axisAt(this.pos.x, this.pos.z, ax);
    else {
      ax.angle = 0;
      ax.hs = 0;
      ax.coherence = 0;
    }
    this.ride.update(
      dt,
      this.heading,
      this.speed,
      this.spec.topSpeed,
      ax.hs,
      ax.angle,
      ax.coherence,
      this.spec.length,
    );

    this.broadside(dt);

    // jumps: the whole hull clear of the sea for a moment
    const lift = this.pos.y - this.seaLevel - this.spec.cg[1];
    if (this.wetMin === 0) {
      this.airT += dt;
      this.airPeak = Math.max(this.airPeak, lift);
    } else if (this.airT > 0) {
      if (this.airT > 0.55 && lift < 1.2) {
        const w = this.ws;
        const slope = Math.atan(-(w.nx * this.fwd.x + w.nz * this.fwd.z) / Math.max(0.2, w.ny));
        const impact = this.frameImpact;
        this.ride.events.push({
          kind: 'air',
          time: this.airT,
          grade: gradeLanding(this.pitch - slope, impact),
          impact,
        });
      }
      this.airT = 0;
      this.airPeak = 0;
    }
  }

  private readonly accelF = new Vector3();

  private updateReadouts(env: BoatEnv): void {
    const q = this.quat;
    this.fwd.set(1, 0, 0).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.right.set(0, 0, 1).applyQuaternion(q);
    this.heading = Math.atan2(this.fwd.z, this.fwd.x);
    this.pitch = Math.asin(clamp(this.fwd.y, -1, 1));
    this.roll = Math.asin(clamp(-this.right.y, -1, 1));
    this.heelDeg = (this.roll * 180) / Math.PI;
    env.currentAt(this.pos.x, this.pos.z, this.cur);
    const rvx = this.vel.x - this.cur.x;
    const rvz = this.vel.z - this.cur.z;
    this.speed = this.fwd.x * rvx + this.fwd.z * rvz + this.fwd.y * this.vel.y;
    this.sog = Math.hypot(this.vel.x, this.vel.z);
    const load = Math.abs(this.thrustN) / Math.max(1, this.spec.engine.thrust);
    this.rpm = clamp(0.16 + 0.62 * Math.abs(this.throttle) + 0.22 * load, 0, 1);
    this.grounded = clamp(this.contactStrength, 0, 1);
  }
}
