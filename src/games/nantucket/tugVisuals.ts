// The harbour tugs the player calls: a pair of tug models that nose in from the side, lean on the ship's bow
// or stern while a push lasts, and back away again. They are scenery with a wake: the force they apply comes
// from `TugCrew` through `Boat.tugs`, not from these models.

import { Vector3 } from 'three/webgpu';
import { smoothstep } from '../../core/math';
import { boatById } from '../../data/boats';
import type { Game } from '../../game/game';
import { BoatModel } from '../../render/boats/boatModel';
import type { WakeBoat } from '../../render/wake';
import { Boat } from '../../sim/boat';
import type { TugCall, TugEnd } from '../../sim/tugs';
import { makeWaveSample } from '../../sim/waves';
import type { NantMode } from './mode';

interface Slot {
  end: TugEnd;
  model: BoatModel;
  boat: Boat;
  shown: boolean;
}

export class TugVisuals {
  private readonly slots: Slot[] = [];
  private readonly wind = { x: 0, z: 0 };

  constructor(
    private readonly host: Game,
    private readonly mode: NantMode,
  ) {
    const spec = boatById('tug');
    for (const end of ['bow', 'stern'] as const) {
      const boat = new Boat(spec);
      boat.indestructible = true;
      const model = new BoatModel(spec, 0);
      model.root.visible = false;
      model.root.traverse((o) => {
        o.frustumCulled = false;
      });
      host.rw.world.add(model.root);
      this.slots.push({ end, model, boat, shown: false });
    }
  }

  reset(): void {
    for (const s of this.slots) {
      s.shown = false;
      s.model.root.visible = false;
    }
  }

  /** A call just went out: nothing to do yet (the tug appears as the envelope rises), kept for a sound hook. */
  onCall(): void {}

  private sideFor(call: TugCall, end: TugEnd): -1 | 1 {
    if (call === 'hold') return end === 'bow' ? 1 : -1;
    // pushing to port means the tug works from the starboard side
    return call.endsWith('port') ? 1 : -1;
  }

  update(dt: number): void {
    const h = this.host;
    const ship = h.player;
    const crew = this.mode.tugs;
    for (const slot of this.slots) {
      const call = crew.active.find((a) => a.call === 'hold' || a.call.startsWith(slot.end));
      if (!call) {
        slot.shown = false;
        slot.model.root.visible = false;
        continue;
      }
      const side = this.sideFor(call.call, slot.end);
      const at = crew.attach(slot.end, side);
      const spec = slot.boat.spec;
      // where the tug makes fast, in the world
      const lx = at.x - ship.spec.cg[0];
      const wx = ship.pos.x + ship.fwd.x * lx + ship.right.x * at.z;
      const wz = ship.pos.z + ship.fwd.z * lx + ship.right.z * at.z;
      // in from 30 m away, then out again at the end of the push
      const away = 34 * (1 - smoothstep(0, 2.4, call.t)) + 34 * smoothstep(call.dur - 2.4, call.dur, call.t);
      const off = ship.spec.beam * 0.5 * 0.58 + spec.length * 0.5 - 1.2 + away;
      const rx = ship.right.x * side;
      const rz = ship.right.z * side;
      const x = wx + rx * off;
      const z = wz + rz * off;
      // the tug points its bow at the hull
      const heading = Math.atan2(-rz, -rx);
      const b = slot.boat;
      const wasX = b.pos.x;
      const wasZ = b.pos.z;
      b.pos.set(x, 0, z);
      h.env.waveAt(x, z, this.ws);
      b.pos.y = this.ws.h + spec.cg[1];
      b.quat.setFromAxisAngle(this.up, -heading);
      b.heading = heading;
      b.fwd.set(Math.cos(heading), 0, Math.sin(heading));
      b.right.set(-Math.sin(heading), 0, Math.cos(heading));
      const v = slot.shown ? Math.hypot(x - wasX, z - wasZ) / Math.max(dt, 1e-3) : 0;
      slot.shown = true;
      b.speed = Math.min(v, 8);
      b.sog = b.speed;
      b.thrustN = spec.engine.thrust * (away > 0.5 ? 0.7 : 0.45);
      b.propSubmerge = 1;
      slot.model.root.visible = true;
      h.env.windAt(x, z, this.wind);
      slot.model.update(b, this.wind, h.env.time);
    }
  }

  private readonly ws = makeWaveSample();
  private readonly up = new Vector3(0, 1, 0);

  wakeBoats(entry: (b: Boat) => WakeBoat): WakeBoat[] {
    const out: WakeBoat[] = [];
    for (const s of this.slots) if (s.shown) out.push(entry(s.boat));
    return out;
  }
}
