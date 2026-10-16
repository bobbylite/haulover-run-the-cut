// Trolling. Four rods put four lures astern. Where a lure is, and whether it is fishing, is a function of
// how the boat has been *driven*, not just where it is:
//
//   * a lure trails along the boat's track through the WATER (the tide carries the trail with it), so
//     steering and the current decide where the spread lies;
//   * lure speed is speed through the water, and the lures only work inside a window (too slow and they sink
//     and sulk, too fast and they skip out and the lines blow back);
//   * turn too sharply and the lines swing across each other: a tangle, which takes a calm minute to clear;
//   * back down with lines out and they wrap the prop.
//
// A tuna strikes a lure that is in front of it at the right depth while it is hungry, which is when its
// school is feeding. Pure and deterministic: the caller supplies the random numbers.

import { clamp, KNOTS, type Rng, smoothstep } from '../../core/math';
import type { SchoolTuna } from './world';

export type RodKind = 'flat' | 'rigger' | 'diver' | 'deep';

export interface RodSpec {
  id: number;
  kind: RodKind;
  label: string;
  /** Lateral offset of the rod tip and of the lure's resting track (m, + = starboard). */
  tipLat: number;
  lureLat: number;
  /** Line paid out (m). */
  out: number;
  /** Depth the lure runs at troll speed (m). */
  depth: number;
}

/** The spread: far lines on the outriggers, the near ones inside, so a gentle turn does not cross them. */
export const SPREAD: readonly RodSpec[] = [
  { id: 0, kind: 'rigger', label: 'Port rigger', tipLat: -3.4, lureLat: -10, out: 40, depth: 1.5 },
  { id: 1, kind: 'flat', label: 'Port flat', tipLat: -1.1, lureLat: -3, out: 20, depth: 0.6 },
  { id: 2, kind: 'diver', label: 'Stbd diver', tipLat: 1.1, lureLat: 3.5, out: 30, depth: 9 },
  { id: 3, kind: 'deep', label: 'Stbd deep', tipLat: 3.4, lureLat: 11, out: 52, depth: 20 },
];

export type RodState = 'stowed' | 'setting' | 'fishing' | 'tangled' | 'hooked' | 'reeling';

export interface Rod {
  spec: RodSpec;
  state: RodState;
  /** 0..1: how much of the line is out while setting or reeling in. */
  prog: number;
  /** Seconds of calm still needed to clear a tangle. */
  tangleT: number;
  /** World position of the lure and the depth it is running. */
  x: number;
  z: number;
  depth: number;
  /** Delay before this rod starts to pay out (staggers the set). */
  delay: number;
  /** How long the lines have been crossed. */
  crossT: number;
}

export interface TrollInput {
  /** Stern in the world and the boat's forward unit vector. */
  sx: number;
  sz: number;
  fx: number;
  fz: number;
  /** Speed through the water along the boat (m/s, signed). */
  stw: number;
  /** Yaw rate (rad/s). */
  yawRate: number;
  /** Tidal current at the boat (m/s). */
  cx: number;
  cz: number;
}

export type TackleEvent =
  | { kind: 'tangle'; rods: number[]; cause: 'turn' | 'sea' }
  | { kind: 'foul' }
  | { kind: 'cleared' }
  | { kind: 'strike'; rod: Rod; tuna: SchoolTuna }
  | { kind: 'crossFight' };

const TRAIL_MAX = 150;
const STEP = 0.8;

/** How well the lures work at a given speed through the water (kn): 1 inside the window. */
export function speedWindow(kn: number): number {
  if (kn < 1.5) return 0;
  if (kn < 4.5) return smoothstep(1.5, 4.5, kn) * 0.9;
  if (kn <= 7.5) return 0.85 + 0.15 * (1 - Math.min(1, Math.abs(kn - 6.1) / 1.6));
  if (kn < 10.5) return 0.87 * (1 - smoothstep(7.5, 10.5, kn));
  return 0;
}

export class Tackle {
  readonly rods: Rod[] = SPREAD.map((spec) => ({
    spec,
    state: 'stowed' as RodState,
    prog: 0,
    tangleT: 0,
    x: 0,
    z: 0,
    depth: 0,
    delay: 0,
    crossT: 0,
  }));
  hooked: Rod | null = null;
  readonly events: TackleEvent[] = [];

  /** Rate (per second, per tuna in perfect reach) at which hungry tuna take a lure. */
  biteRate = 0.5;

  // the boat's track through the water, newest last (water frame: ground minus accumulated drift)
  private tx: number[] = [];
  private tz: number[] = [];
  private driftX = 0;
  private driftZ = 0;
  private lastX = 0;
  private lastZ = 0;
  private reverseT = 0;

  /** Lay the trail straight astern of the boat before any line is out. */
  prime(sx: number, sz: number, fx: number, fz: number): void {
    this.tx.length = 0;
    this.tz.length = 0;
    this.driftX = 0;
    this.driftZ = 0;
    const n = Math.ceil(TRAIL_MAX / STEP);
    for (let i = n; i >= 0; i--) {
      this.tx.push(sx - fx * i * STEP);
      this.tz.push(sz - fz * i * STEP);
    }
    this.lastX = sx;
    this.lastZ = sz;
    this.reverseT = 0;
    for (const r of this.rods) {
      if (r.state !== 'hooked') {
        r.state = 'stowed';
        r.prog = 0;
        r.tangleT = 0;
        r.crossT = 0;
      }
    }
    this.hooked = null;
  }

  // ---- control -------------------------------------------------------------------------------------

  /** Put the spread out. The crew will not do it at speed. */
  setLines(stwKn: number): boolean {
    if (stwKn > 10) return false;
    let k = 0;
    for (const r of this.rods) {
      if (r.state === 'stowed') {
        r.state = 'setting';
        r.prog = 0;
        r.delay = k++ * 1.3;
      }
    }
    return k > 0;
  }

  /** Bring them in. */
  retrieve(): void {
    for (const r of this.rods) {
      if (r.state === 'fishing' || r.state === 'setting' || r.state === 'tangled') {
        r.state = 'reeling';
        if (r.prog <= 0) r.prog = 1;
      }
    }
  }

  get linesOut(): number {
    return this.rods.filter((r) => r.state === 'fishing' || r.state === 'setting').length;
  }

  get fishing(): number {
    return this.rods.filter((r) => r.state === 'fishing').length;
  }

  get tangled(): number {
    return this.rods.filter((r) => r.state === 'tangled').length;
  }

  /** A hook-up: the struck rod is on, the rest come in. */
  hook(rod: Rod): void {
    rod.state = 'hooked';
    this.hooked = rod;
    for (const r of this.rods) {
      if (r === rod) continue;
      if (r.state === 'fishing' || r.state === 'setting' || r.state === 'tangled') {
        r.state = 'reeling';
        if (r.prog <= 0) r.prog = 1;
      }
    }
  }

  /** The fish is off (or landed): the rod is free again and stowed. */
  release(): void {
    if (this.hooked) {
      this.hooked.state = 'stowed';
      this.hooked.prog = 0;
    }
    this.hooked = null;
  }

  /** A wave slap or a green-water roll flings the rod tips: sometimes the lines cross. */
  seaSlap(strength: number, rng: Rng): void {
    const live = this.rods.filter((r) => r.state === 'fishing');
    if (live.length < 2 || rng.next() > clamp(strength * 0.18, 0, 0.5)) return;
    const a = rng.pick(live);
    const b = rng.pick(live.filter((r) => r !== a));
    this.tangle([a, b], 'sea');
  }

  private tangle(rods: Rod[], cause: 'turn' | 'sea'): void {
    for (const r of rods) {
      r.state = 'tangled';
      r.tangleT = 8;
      r.crossT = 0;
    }
    this.events.push({ kind: 'tangle', rods: rods.map((r) => r.spec.id), cause });
  }

  // ---- per frame -----------------------------------------------------------------------------------

  /** Where a point `s` metres back along the trail is (water frame). Clamps to the oldest point. */
  private trailAt(s: number, out: { x: number; z: number }): void {
    const n = this.tx.length;
    let acc = 0;
    let i = n - 1;
    while (i > 0) {
      const dx = (this.tx[i] as number) - (this.tx[i - 1] as number);
      const dz = (this.tz[i] as number) - (this.tz[i - 1] as number);
      const seg = Math.hypot(dx, dz);
      if (acc + seg >= s) {
        const k = seg > 1e-6 ? (s - acc) / seg : 0;
        out.x = (this.tx[i] as number) - dx * k;
        out.z = (this.tz[i] as number) - dz * k;
        return;
      }
      acc += seg;
      i--;
    }
    out.x = this.tx[0] as number;
    out.z = this.tz[0] as number;
  }

  /** Local right-hand direction of the trail at arc length `s` (water frame, unit). */
  private rightAt(s: number, out: { x: number; z: number }): void {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    this.trailAt(Math.max(0, s - 2), a);
    this.trailAt(s + 2, b);
    // forward = from the older point (b) to the newer (a)
    const fx = a.x - b.x;
    const fz = a.z - b.z;
    const l = Math.hypot(fx, fz) || 1;
    out.x = -fz / l;
    out.z = fx / l;
  }

  update(
    dt: number,
    inp: TrollInput,
    tunaNear: (x: number, z: number, r: number) => SchoolTuna[],
    rng: Rng,
    biteGain = 1,
  ): void {
    // the water frame: drift moves with the current, the track is stored without it
    this.driftX += inp.cx * dt;
    this.driftZ += inp.cz * dt;
    const wx = inp.sx - this.driftX;
    const wz = inp.sz - this.driftZ;
    let virtualHead = false;
    if (Math.hypot(wx - this.lastX, wz - this.lastZ) >= STEP && inp.stw > 0.4) {
      this.tx.push(wx);
      this.tz.push(wz);
      this.lastX = wx;
      this.lastZ = wz;
      // drop the oldest points once the trail is longer than any line
      while (this.tx.length > Math.ceil(TRAIL_MAX / STEP) + 4) {
        this.tx.shift();
        this.tz.shift();
      }
    } else {
      // between steps the trail's head is the stern itself, so lures do not lag by up to a step
      this.tx.push(wx);
      this.tz.push(wz);
      virtualHead = true;
    }
    const kn = Math.max(0, inp.stw) * KNOTS;
    const rightX = -inp.fz;
    const rightZ = inp.fx;

    // lines pay out and come in
    for (const r of this.rods) {
      if (r.state === 'setting') {
        r.delay -= dt;
        if (r.delay <= 0) {
          r.prog = Math.min(1, r.prog + dt / 5.5);
          if (r.prog >= 1) r.state = 'fishing';
        }
      } else if (r.state === 'reeling') {
        r.prog = Math.max(0, r.prog - dt / 4.5);
        if (r.prog <= 0) r.state = 'stowed';
      }
    }

    // backing down with lines out wraps the prop
    const wet = this.rods.some((r) => r.state === 'fishing' || r.state === 'setting');
    if (inp.stw < -0.4 && wet) {
      this.reverseT += dt;
      if (this.reverseT > 1.1) {
        this.tangle(
          this.rods.filter((r) => r.state === 'fishing' || r.state === 'setting'),
          'turn',
        );
        this.events.push({ kind: 'foul' });
        this.reverseT = 0;
      }
    } else this.reverseT = Math.max(0, this.reverseT - dt);

    // where the lures are
    const depthK = clamp(1 + (6.4 - kn) * 0.12, 0.45, 1.4);
    const p = { x: 0, z: 0 };
    const rg = { x: 0, z: 0 };
    for (const r of this.rods) {
      if (r.state === 'stowed' || r.state === 'hooked') continue;
      const out = r.spec.out * (r.state === 'tangled' ? 1 : Math.max(0.05, r.prog));
      this.trailAt(out, p);
      this.rightAt(out, rg);
      r.x = p.x + rg.x * r.spec.lureLat * Math.min(1, r.prog * 1.5) + this.driftX;
      r.z = p.z + rg.z * r.spec.lureLat * Math.min(1, r.prog * 1.5) + this.driftZ;
      r.depth = r.spec.depth * depthK;
    }

    if (virtualHead) {
      this.tx.pop();
      this.tz.pop();
    }

    // crossed lines: the order of the lures across the stern no longer matches the order of the rod tips
    const fishing = this.rods.filter((r) => r.state === 'fishing' && r.prog > 0.95);
    if (kn > 1.2) {
      const lat = (r: Rod) => (r.x - inp.sx) * rightX + (r.z - inp.sz) * rightZ;
      const crossed = new Set<Rod>();
      for (let i = 0; i < fishing.length; i++) {
        for (let j = i + 1; j < fishing.length; j++) {
          const a = fishing[i] as Rod;
          const b = fishing[j] as Rod;
          const dt1 = a.spec.tipLat - b.spec.tipLat;
          const dl = lat(a) - lat(b);
          if (dt1 * dl < 0 && Math.abs(dl) > 2) {
            crossed.add(a);
            crossed.add(b);
          }
        }
      }
      for (const r of fishing) r.crossT = crossed.has(r) ? r.crossT + dt : Math.max(0, r.crossT - dt * 2);
      const bad = fishing.filter((r) => r.crossT > 1);
      if (bad.length >= 2) this.tangle(bad, 'turn');
    }

    // a calm, steady stretch clears a tangle
    const calm = inp.stw > 0.8 && inp.stw < 3.7 && Math.abs(inp.yawRate) < 0.1;
    let k = 0;
    for (const r of this.rods) {
      if (r.state !== 'tangled') continue;
      if (calm) r.tangleT -= dt;
      if (r.tangleT <= 0) {
        // the crew has it sorted: the lines go back out from scratch, lying along the (now straight) trail
        r.state = 'setting';
        r.prog = 0;
        r.delay = k++ * 1.3;
        r.crossT = 0;
        this.events.push({ kind: 'cleared' });
      }
    }

    // the other rods are still coming in: a hard turn then crosses the line you are fighting
    if (this.hooked && this.rods.some((r) => r.state === 'reeling') && Math.abs(inp.yawRate) > 0.22) {
      this.events.push({ kind: 'crossFight' });
    }

    // the strike
    if (!this.hooked) {
      const window = speedWindow(kn) * (1 - 0.5 * clamp(Math.abs(inp.yawRate) / 0.35, 0, 1));
      if (window > 0.05) {
        for (const r of fishing) {
          for (const f of tunaNear(r.x, r.z, 34)) {
            const d = Math.hypot(r.x - f.x, r.z - f.z);
            const dd = (r.depth - f.depth) / 8;
            const rate =
              this.biteRate *
              biteGain *
              window *
              f.appetite *
              Math.exp(-((d / 17) ** 2)) *
              Math.exp(-(dd * dd));
            if (rng.next() < 1 - Math.exp(-rate * dt)) {
              this.events.push({ kind: 'strike', rod: r, tuna: f });
              return;
            }
          }
        }
      }
    }
  }

  /** Drain the events accumulated since the last call. */
  drain(): TackleEvent[] {
    const e = this.events.slice();
    this.events.length = 0;
    return e;
  }
}
