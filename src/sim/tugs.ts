// Tug assist: the harbour's tugs lean on a big ship when the player calls them. Each call is a push at the
// bow or the stern (to port or to starboard) or a "hold" that brakes everything, lasts a few seconds, and
// comes out of a small budget per run. The tugs never steer; they only add force through `Boat.tugs`.

import { clamp, smoothstep } from '../core/math';
import type { Boat, TugPush } from './boat';
import type { BoatSpec } from './boatSpec';

export type TugCall = 'bow-port' | 'bow-stbd' | 'stern-port' | 'stern-stbd' | 'hold';
export type TugEnd = 'bow' | 'stern';

interface Active {
  call: TugCall;
  t: number;
  dur: number;
}

/** Seconds a push (or a hold) lasts. */
export const PUSH_S = 7;
export const HOLD_S = 10;

/** Side force of one tug (N): a few hundredths of a g on the whole ship. */
export const tugForce = (spec: Pick<BoatSpec, 'mass'>): number => spec.mass * 0.055;

export class TugCrew {
  callsLeft: number;
  used = 0;
  readonly active: Active[] = [];

  constructor(
    readonly spec: BoatSpec,
    readonly calls: number,
  ) {
    this.callsLeft = calls;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const s of spec.samples) {
      xMin = Math.min(xMin, s.x);
      xMax = Math.max(xMax, s.x);
    }
    this.xBow = xMax - 0.14 * spec.length;
    this.xStern = xMin + 0.14 * spec.length;
  }

  private readonly xBow: number;
  private readonly xStern: number;

  /** Where a tug at this end makes fast (spec frame) and which side of the hull it works from. */
  attach(end: TugEnd, side: -1 | 1): { x: number; z: number } {
    return { x: end === 'bow' ? this.xBow : this.xStern, z: side * this.spec.beam * 0.42 };
  }

  reset(): void {
    this.callsLeft = this.calls;
    this.used = 0;
    this.active.length = 0;
  }

  /** Call a tug. A fresh call at an end that is already busy takes over from it (and still costs a call). */
  request(call: TugCall): boolean {
    if (this.callsLeft <= 0) return false;
    const ends = (c: TugCall): TugEnd[] =>
      c === 'hold' ? ['bow', 'stern'] : c.startsWith('bow') ? ['bow'] : ['stern'];
    const mine = ends(call);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i] as Active;
      if (ends(a.call).some((e) => mine.includes(e))) this.active.splice(i, 1);
    }
    this.active.push({ call, t: 0, dur: call === 'hold' ? HOLD_S : PUSH_S });
    this.callsLeft--;
    this.used++;
    return true;
  }

  /** The pushes at this moment: how hard each active tug is working (0..1) and where. */
  envelope(a: Active): number {
    return smoothstep(0, 1.1, a.t) * (1 - smoothstep(a.dur - 1.6, a.dur, a.t));
  }

  /** Advance the tugs and hand their forces to the boat. */
  update(dt: number, boat: Boat): void {
    boat.tugs.length = 0;
    const F = tugForce(this.spec);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i] as Active;
      a.t += dt;
      if (a.t >= a.dur) {
        this.active.splice(i, 1);
        continue;
      }
      const e = this.envelope(a);
      if (a.call === 'hold') {
        // lean against whatever the ship is doing at both ends: surge, sway and the swing of the bow
        const f = boat.fwd;
        const r = boat.right;
        for (const x of [this.xBow, this.xStern]) {
          const lx = x - this.spec.cg[0];
          // the ship's speed along and across the hull, plus the swing of that end (+y spin is a turn to port,
          // which sends a forward point to port, i.e. the other way from starboard)
          const vf = boat.vel.x * f.x + boat.vel.z * f.z;
          const vSide = boat.vel.x * r.x + boat.vel.z * r.z - lx * boat.angVel.y;
          const k = F / 0.45;
          const push: TugPush = {
            x,
            z: 0,
            fx: clamp(-vf * k, -F, F) * e,
            fz: clamp(-vSide * k, -F, F) * e,
          };
          boat.tugs.push(push);
        }
      } else {
        const end: TugEnd = a.call.startsWith('bow') ? 'bow' : 'stern';
        const toPort = a.call.endsWith('port');
        // pushing to port means the tug is on the starboard side, and the force is -z (to port)
        const at = this.attach(end, toPort ? 1 : -1);
        boat.tugs.push({ x: at.x, z: at.z, fx: 0, fz: (toPort ? -1 : 1) * F * e });
      }
    }
  }

  /** What the HUD shows: which ends have a tug working, and which call each is on. */
  busy(): { end: TugEnd; call: TugCall; left: number }[] {
    const out: { end: TugEnd; call: TugCall; left: number }[] = [];
    for (const a of this.active) {
      const left = a.dur - a.t;
      if (a.call === 'hold') {
        out.push({ end: 'bow', call: a.call, left }, { end: 'stern', call: a.call, left });
      } else out.push({ end: a.call.startsWith('bow') ? 'bow' : 'stern', call: a.call, left });
    }
    return out;
  }
}
