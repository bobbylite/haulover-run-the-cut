// The south-shore marina inside the bay mouth: finger piers, pilings, a pastel marine-center and a
// fleet of moored boats in assorted paint jobs that bob on the live waves.

import { Group, Quaternion, Vector3 } from 'three/webgpu';
import { boatById } from '../../data/boats';
import type { Environment } from '../../sim/environment';
import { bayX, DOCKS, MOORED } from '../../sim/geography';
import { makeWaveSample } from '../../sim/waves';
import { bulb, gel, matte, metal, teak } from '../boats/materials';
import { buildConsole, type ConsolePaint } from '../boats/models/console';
import { buildCruiser, type CruiserPaint } from '../boats/models/cruiser';
import { buildGoFast, type GoFastPaint } from '../boats/models/gofast';
import { PartBuilder } from '../boats/parts';

interface Moored {
  g: Group;
  x: number;
  z: number;
  yaw: number;
  phase: number;
}

const PASTELS = [
  ['#fcfbf6', '#6fe6cc', '#ff8f7a', '#33b3c6', '#84e8dd', '#8be9df'],
  ['#fff4f0', '#ff9ccf', '#7ff0d0', '#3aa8c4', '#ffc9de', '#ffd1e4'],
  ['#f4f9ff', '#8fb8ff', '#ffd45e', '#2f86b8', '#bcd4ff', '#c8dcff'],
  ['#fffaf0', '#ffb497', '#6fe6cc', '#2f9bb0', '#ffd9b8', '#ffd9c4'],
  ['#f7f2ff', '#c7b8ff', '#ff9ccf', '#4a8fc0', '#ddd2ff', '#e4dcff'],
  ['#ffffff', '#ff7b88', '#ffe08a', '#2b8aa8', '#ffb3bb', '#ffd0d6'],
];

export class Marina {
  readonly group = new Group();
  private readonly boats: Moored[] = [];
  private readonly ws = makeWaveSample();
  private readonly q = new Quaternion();
  private readonly n = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'marina';
    const planks = teak('#dca56a', '#c28553', 3);
    const frame = gel('#f6efe6', 0.6);
    const piling = matte('#7b6150', 0.9);
    const pb = new PartBuilder();
    const wood = new PartBuilder();

    // docks
    for (const d of DOCKS) {
      wood.box(planks, d.hx * 2, 0.16, d.hz * 2, { pos: [d.x, 0.62, d.z] }, 0.03);
      pb.box(frame, d.hx * 2 + 0.2, 0.22, 0.22, { pos: [d.x, 0.45, d.z - d.hz] }, 0.04);
      pb.box(frame, d.hx * 2 + 0.2, 0.22, 0.22, { pos: [d.x, 0.45, d.z + d.hz] }, 0.04);
      const n = Math.max(2, Math.round((d.hx * 2) / 7));
      for (let i = 0; i <= n; i++) {
        const x = d.x - d.hx + (d.hx * 2 * i) / n;
        for (const side of [-1, 1]) {
          pb.cyl(piling, 0.16, 0.19, 4.2, { pos: [x, -0.5, d.z + side * (d.hz + 0.28)] }, 8);
          pb.sphere(piling, 0.19, { pos: [x, 1.62, d.z + side * (d.hz + 0.28)] }, 8);
        }
      }
      // cleats and dock lights
      if (d.hx > 5) pb.cyl(metal(), 0.03, 0.03, 1.2, { pos: [d.x - d.hx + 1, 1.3, d.z] }, 6);
      if (d.hx > 5) pb.sphere(bulb('#fff2c8', 8), 0.1, { pos: [d.x - d.hx + 1, 1.95, d.z] }, 6);
    }
    this.group.add(wood.build(), pb.build());

    // marine centre on the shore
    const shoreX = bayX(158) + 34;
    const bld = new PartBuilder();
    bld.box(gel('#fffaf3', 0.7), 22, 6, 12, { pos: [shoreX, 4.6, 158] }, 0.5);
    bld.box(gel('#ff9f8a', 0.5), 24, 0.9, 14, { pos: [shoreX, 7.9, 158] }, 0.3);
    bld.box(gel('#6fe6cc', 0.5), 22.2, 1.0, 12.2, { pos: [shoreX, 3.0, 158] }, 0.2);
    bld.box(gel('#2b3d56', 0.2), 10, 1.8, 0.1, { pos: [shoreX - 11.1, 4.2, 158] }, 0.03);
    bld.box(gel('#ff8f7a', 0.5), 7, 1.2, 0.3, { pos: [shoreX - 11.3, 6.1, 158] }, 0.1);
    for (let i = 0; i < 4; i++)
      bld.cyl(matte('#f2e6d4'), 0.18, 0.18, 4.5, { pos: [shoreX - 12.2, 3.8, 152 + i * 4] }, 8);
    this.group.add(bld.build());

    // moored fleet: the same layout the physics collides with (the target slip is left free)
    const consoleSpec = boatById('console');
    const cruiserSpec = boatById('cruiser');
    const gofastSpec = boatById('gofast');
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
        model = buildCruiser(cruiserSpec, paint).group;
      } else if (m.kind === 'gofast') {
        const paint: GoFastPaint = { top: pal[1]!, stripe: pal[0]!, boot: pal[2]!, bottom: pal[3]! };
        model = buildGoFast(gofastSpec, paint).group;
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
        model = buildConsole(consoleSpec, paint).group;
      }
      const wrap = new Group();
      wrap.add(model);
      wrap.position.set(m.x, 0, m.z);
      wrap.rotation.y = m.yaw;
      this.group.add(wrap);
      this.boats.push({ g: wrap, x: m.x, z: m.z, yaw: m.yaw, phase: (m.pal * 1.7) % 6 });
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
      // keep yaw, add a damped tilt
      b.g.quaternion.setFromAxisAngle(this.up, b.yaw).premultiply(this.q.slerp(new Quaternion(), 0.55));
    }
  }
}
