// Runtime wrapper: builds a boat's meshes and drives them from the physics state each frame.

import { Group, type Mesh } from 'three/webgpu';
import { clamp } from '../../core/math';
import type { Boat } from '../../sim/boat';
import type { BoatSpec } from '../../sim/boatSpec';
import { type ModelParts, makeCockpitWater } from './common';
import { buildConsole, CONSOLE_PAINT } from './models/console';
import { buildCruiser, CRUISER_PAINT } from './models/cruiser';
import { buildGoFast, GOFAST_PAINT } from './models/gofast';
import { buildPontoon } from './models/pontoon';
import { buildSloop } from './models/sloop';

const BUILDERS: Record<BoatSpec['id'], (s: BoatSpec, paint?: any) => ModelParts> = {
  console: buildConsole,
  gofast: buildGoFast,
  cruiser: buildCruiser,
  sloop: buildSloop,
  pontoon: buildPontoon,
};

/** Alternate liveries so the traffic on the water isn't a row of clones. Variant 0 is the hero paint. */
const PAINTS: Partial<Record<BoatSpec['id'], object[]>> = {
  console: [
    CONSOLE_PAINT,
    {
      top: '#fff4e0',
      stripe: '#ffc36e',
      boot: '#6e8bff',
      bottom: '#4f65c9',
      inner: '#f6efe2',
      canvas: '#ffb87a',
      cushion: '#ffd9a8',
    },
    {
      top: '#e9f7ff',
      stripe: '#9ab6ff',
      boot: '#ff7aa8',
      bottom: '#c94f86',
      inner: '#f4efe4',
      canvas: '#c5a2ff',
      cushion: '#e1caff',
    },
  ],
  gofast: [
    GOFAST_PAINT,
    { top: '#6fe6cc', stripe: '#fffdf8', boot: '#ff8f7a', bottom: '#1f9bb5' },
    { top: '#ffd36e', stripe: '#fffdf8', boot: '#9a7bff', bottom: '#5b3fd1' },
    { top: '#9ab6ff', stripe: '#fffdf8', boot: '#ff86b4', bottom: '#3f52c9' },
  ],
  cruiser: [
    CRUISER_PAINT,
    {
      top: '#f3fbff',
      stripe: '#8fe0d6',
      boot: '#d9577a',
      bottom: '#a8405f',
      bimini: '#b8f0e8',
      cushion: '#d4f7f1',
    },
    {
      top: '#fff6e8',
      stripe: '#ffd36e',
      boot: '#4a7bd1',
      bottom: '#34569a',
      bimini: '#ffe7b0',
      cushion: '#fff0cc',
    },
  ],
};

export class BoatModel {
  /** Posed by physics (origin = centre of gravity). */
  readonly root = new Group();
  private readonly inner = new Group();
  readonly parts: ModelParts;
  private readonly cockpitWater: Mesh;
  // smoothed sail state, so the boom swings across and the cloth fills over a moment instead of snapping
  private boomA = 0;
  private billow = 0.1;
  private lastT = 0;

  constructor(
    readonly spec: BoatSpec,
    variant = 0,
  ) {
    const paints = PAINTS[spec.id];
    this.parts = BUILDERS[spec.id](spec, paints ? paints[variant % paints.length] : undefined);
    this.cockpitWater = makeCockpitWater(spec);
    this.inner.add(this.parts.group, this.cockpitWater);
    this.inner.position.set(-spec.cg[0], -spec.cg[1], -spec.cg[2]);
    this.root.add(this.inner);
    this.root.name = `boat:${spec.id}`;
  }

  update(boat: Boat, wind: { x: number; z: number }, time: number): void {
    const r = this.root;
    r.position.copy(boat.pos);
    r.quaternion.copy(boat.quat);

    const dt = clamp(time - this.lastT, 0, 0.1);
    this.lastT = time;
    const p = this.parts;
    for (const e of p.engines) e.rotation.y = boat.steer * 1.3;
    if (p.wheel) p.wheel.rotation.x = boat.steer * 6;

    // flags stream along the apparent wind: the true wind less the boat's own motion, so on a fast boat
    // they lie straight back and on a sloop the burgee shows what the sail feels
    const h = boat.heading;
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    const awx = wind.x - boat.vel.x;
    const awz = wind.z - boat.vel.z;
    const spd = Math.hypot(awx, awz) || 1;
    const dx = awx / spd;
    const dz = awz / spd;
    const lx = dx * ch + dz * sh;
    const lz = -dx * sh + dz * ch;
    const base = Math.atan2(-lz, lx);
    p.flags.forEach((f, i) => {
      f.rotation.y = base + Math.sin(time * 2.3 + i * 1.7) * 0.1;
    });

    // water in the cockpit
    const w = boat.water;
    const depth = w.depth;
    const cw = this.cockpitWater;
    cw.visible = depth > 0.006;
    if (cw.visible) {
      const co = this.spec.cockpit;
      cw.position.y = co.soleY + Math.min(depth, 1.0) + 0.005;
      cw.rotation.set(-w.tiltRoll * 0.9, 0, w.tiltPitch * 0.9);
      cw.position.z = w.rollOff * 0.6;
    }

    // sails
    if (p.sail) {
      const s = p.sail;
      const vis = boat.sailUp;
      s.boom.visible = vis;
      s.jib.visible = vis;
      // the boom swings through the centreline on a tack or gybe; the cloth's belly flips with it
      const target = boat.boomSide * boat.boomAngle;
      this.boomA += (target - this.boomA) * Math.min(1, dt * 7);
      const side = clamp(this.boomA / 0.22, -1, 1);
      const fill = clamp(boat.sailPower / 3600, 0, 1) * 0.9 + 0.1;
      this.billow += (fill - this.billow) * Math.min(1, dt * 4);
      s.uSide.value = side;
      s.uBillow.value = this.billow;
      s.uLuff.value = boat.sailLuff;
      s.boom.rotation.y = this.boomA;
      s.jib.rotation.y = Math.sign(this.boomA) * clamp(Math.abs(this.boomA) * 0.82 + 0.04, 0, 1.3);
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
