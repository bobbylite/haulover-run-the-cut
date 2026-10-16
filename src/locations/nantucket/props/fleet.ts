// The boats that live in the harbour: the ones in the slips of Easy Street and the ones lying to moorings,
// each in its own pastel paint job, bobbing on the live waves. They are the same hulls the physics collides
// with (see MOORED / PILINGS in geography.ts). Mooring balls and their pennants are drawn here too.

import { CylinderGeometry, Group, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import { boatById } from '../../../data/boats';
import { gel, matte } from '../../../render/boats/materials';
import { buildCharter, type CharterPaint } from '../../../render/boats/models/charter';
import { buildConsole, type ConsolePaint } from '../../../render/boats/models/console';
import { buildCruiser, type CruiserPaint } from '../../../render/boats/models/cruiser';
import { buildGoFast, type GoFastPaint } from '../../../render/boats/models/gofast';
import { buildSloop } from '../../../render/boats/models/sloop';
import { PartBuilder } from '../../../render/boats/parts';
import type { Environment } from '../../../sim/environment';
import { makeWaveSample } from '../../../sim/waves';
import { FIXED_MOORINGS, MOORED, MOORINGS } from '../geography';

interface Afloat {
  g: Group;
  x: number;
  z: number;
  yaw: number;
  phase: number;
  /** Boats on a mooring swing a little as the tide and wind work on them. */
  swing: boolean;
}

const PASTELS = [
  ['#fcfbf6', '#6fe6cc', '#ff8f7a', '#33b3c6', '#84e8dd', '#8be9df'],
  ['#fff4f0', '#ff9ccf', '#7ff0d0', '#3aa8c4', '#ffc9de', '#ffd1e4'],
  ['#f4f9ff', '#8fb8ff', '#ffd45e', '#2f86b8', '#bcd4ff', '#c8dcff'],
  ['#fffaf0', '#ffb497', '#6fe6cc', '#2f9bb0', '#ffd9b8', '#ffd9c4'],
  ['#f7f2ff', '#c7b8ff', '#ff9ccf', '#4a8fc0', '#ddd2ff', '#e4dcff'],
  ['#ffffff', '#ff7b88', '#ffe08a', '#2b8aa8', '#ffb3bb', '#ffd0d6'],
];

export class Fleet {
  readonly group = new Group();
  private readonly boats: Afloat[] = [];
  private readonly ws = makeWaveSample();
  private readonly q = new Quaternion();
  private readonly n = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly balls: { g: Group; x: number; z: number }[] = [];

  constructor() {
    this.group.name = 'fleet';
    const specs = {
      console: boatById('console'),
      gofast: boatById('gofast'),
      cruiser: boatById('cruiser'),
      charter: boatById('charter'),
      sloop: boatById('sloop'),
    };
    for (const m of MOORED) {
      const pal = PASTELS[m.pal % PASTELS.length] as string[];
      let model: Group;
      if (m.kind === 'cruiser') {
        const paint: CruiserPaint = {
          top: pal[0]!,
          stripe: pal[1]!,
          boot: pal[2]!,
          bottom: pal[3]!,
          bimini: pal[4]!,
          cushion: pal[5]!,
        };
        model = buildCruiser(specs.cruiser, paint).group;
      } else if (m.kind === 'charter') {
        const paint: CharterPaint = {
          top: pal[0]!,
          stripe: pal[1]!,
          boot: pal[2]!,
          bottom: pal[3]!,
          cushion: pal[5]!,
          canvas: pal[4]!,
        };
        model = buildCharter(specs.charter, paint).group;
      } else if (m.kind === 'gofast') {
        const paint: GoFastPaint = { top: pal[1]!, stripe: pal[0]!, boot: pal[2]!, bottom: pal[3]! };
        model = buildGoFast(specs.gofast, paint).group;
      } else if (m.kind === 'sloop') {
        const parts = buildSloop(specs.sloop);
        // sails furled on a mooring
        if (parts.sail) {
          parts.sail.boom.visible = false;
          parts.sail.jib.visible = false;
        }
        model = parts.group;
      } else {
        const paint: ConsolePaint = {
          top: pal[0]!,
          stripe: pal[1]!,
          boot: pal[2]!,
          bottom: pal[3]!,
          inner: '#f4efe4',
          canvas: pal[4]!,
          cushion: pal[5]!,
        };
        model = buildConsole(specs.console, paint).group;
      }
      // a model's origin is the middle of its hull, so the wrapper sits at the moored hull's centre
      const wrap = new Group();
      wrap.add(model);
      wrap.position.set(m.x, 0, m.z);
      wrap.rotation.y = -m.yaw;
      this.group.add(wrap);
      this.boats.push({
        g: wrap,
        x: m.x,
        z: m.z,
        yaw: -m.yaw,
        phase: (m.pal * 1.7) % 6,
        swing: Math.abs(Math.sin(m.yaw)) < 0.99,
      });
    }

    // mooring balls: a white float with a coral band and a pennant to the bow cleat
    const white = gel('#fdf7ee', 0.45);
    const coral = gel('#ff8f7a', 0.45);
    const rope = matte('#8b7a68', 0.9);
    for (const m of MOORINGS) {
      const target = FIXED_MOORINGS.some((f) => f.id === m.id);
      const g = new Group();
      const b = new PartBuilder();
      b.add(new SphereGeometry(target ? 0.62 : 0.5, 14, 10), white, { pos: [0, 0.1, 0], scale: [1, 0.9, 1] });
      b.add(new CylinderGeometry(0.64, 0.64, 0.14, 14, 1), target ? matte('#2fd6a2', 0.5) : coral, {
        pos: [0, 0.12, 0],
        scale: target ? [1, 1, 1] : [0.8, 1, 0.8],
      });
      b.rod(rope, [0, 0.55, 0], [0, 1.15, 0], 0.025, 5);
      b.torus(rope, 0.12, 0.03, { pos: [0, 1.2, 0], rot: [Math.PI / 2, 0, 0] });
      g.add(b.build());
      g.position.set(m.x, 0, m.z);
      this.group.add(g);
      this.balls.push({ g, x: m.x, z: m.z });
    }
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  update(env: Environment, time: number): void {
    for (const b of this.boats) {
      env.waves.sample(b.x, b.z, env.time, this.ws);
      b.g.position.y = this.ws.h - 0.05 + Math.sin(time * 1.1 + b.phase) * 0.012;
      this.n.set(this.ws.nx, this.ws.ny, this.ws.nz);
      this.q.setFromUnitVectors(this.up, this.n);
      const yaw = b.yaw + (b.swing ? Math.sin(time * 0.17 + b.phase) * 0.05 : 0);
      b.g.quaternion.setFromAxisAngle(this.up, yaw).premultiply(this.q.slerp(new Quaternion(), 0.55));
    }
    for (const b of this.balls) {
      env.waves.sample(b.x, b.z, env.time, this.ws);
      b.g.position.y = this.ws.h - 0.12;
    }
  }
}
