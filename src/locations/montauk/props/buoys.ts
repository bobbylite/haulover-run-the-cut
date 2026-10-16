// Navigation buoys that ride the live waves: a red nun on the Point rip and a green can on the reef edge,
// each with a flashing light, so you can find your way back to the Point in the haze.

import { CylinderGeometry, Group, Quaternion, Vector3 } from 'three/webgpu';
import { flashBulb, gel, matte, metal } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import type { Environment } from '../../../sim/environment';
import { makeWaveSample } from '../../../sim/waves';
import { BUOYS } from '../geography';

interface Buoy {
  g: Group;
  x: number;
  z: number;
  phase: number;
}

export class Buoys {
  readonly group = new Group();
  private readonly list: Buoy[] = [];
  private readonly ws = makeWaveSample();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();

  constructor() {
    this.group.name = 'buoys';
    for (const [i, b] of BUOYS.entries()) {
      const nun = b.kind === 'nun';
      const body = nun ? gel('#ff7d86', 0.4) : gel('#62d9a8', 0.4);
      const pb = new PartBuilder();
      // float, collar, mast and light
      pb.add(new CylinderGeometry(nun ? 0.12 : 0.7, nun ? 1.0 : 0.7, 2.2, 14, 1), body, { pos: [0, 0.8, 0] });
      pb.cyl(matte('#fdf7ee'), 1.05, 1.05, 0.22, { pos: [0, -0.15, 0] }, 14);
      pb.cyl(metal('#cfd6e2'), 0.06, 0.06, 2.4, { pos: [0, 2.8, 0] }, 6);
      pb.box(matte('#fffaf0'), 0.9, 0.6, 0.06, { pos: [0, 1.0, 0.72] }, 0.02);
      pb.sphere(
        i === 0 ? flashBulb('#ff9aa2', 3.4, 0.3) : flashBulb('#8af0c4', 4.0, 0.0),
        0.28,
        { pos: [0, 4.1, 0] },
        8,
      );
      const g = new Group();
      g.add(pb.build());
      this.group.add(g);
      this.list.push({ g, x: b.x, z: b.z, phase: i * 1.9 });
    }
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  update(env: Environment, time: number): void {
    for (const b of this.list) {
      env.waves.sample(b.x, b.z, env.time, this.ws);
      b.g.position.set(b.x, this.ws.h - 0.35, b.z);
      this.n.set(this.ws.nx + Math.sin(time * 1.1 + b.phase) * 0.05, this.ws.ny, this.ws.nz).normalize();
      this.q.setFromUnitVectors(this.up, this.n);
      b.g.quaternion.copy(this.q);
    }
  }
}
