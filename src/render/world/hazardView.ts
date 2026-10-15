// Draws the floating hazards: bright crab-pot floats on a stick, and weathered drift logs.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import type { Environment } from '../../sim/environment';
import type { Hazard } from '../../sim/hazards';
import { ToonMaterial } from '../toon';

const PALETTE = ['#ff7a3c', '#ff5fa2', '#ffd23f', '#7fe34a', '#34c6ff'].map((c) => new Color(c));

function colour(geo: BufferGeometry, c: Color): void {
  const n = geo.attributes.position!.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new BufferAttribute(a, 3));
}

function merge(parts: { g: BufferGeometry; c: Color }[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const { g, c } of parts) {
    const p = g.attributes.position!;
    const n = g.attributes.normal!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    base += p.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  out.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  out.setIndex(idx);
  return out;
}

export class HazardView {
  readonly group = new Group();
  private readonly pots: InstancedMesh;
  private readonly logs: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(max = 96) {
    this.group.name = 'hazards';
    // float: ball + white band + a stick and a little flag
    const ball = new SphereGeometry(0.38, 12, 8).translate(0, 0.1, 0);
    const band = new CylinderGeometry(0.385, 0.385, 0.1, 12).translate(0, 0.1, 0);
    const stick = new CylinderGeometry(0.03, 0.03, 1.5, 6).translate(0, 1.0, 0);
    const flag = new BufferGeometry();
    flag.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 1.75, 0, 0.5, 1.6, 0, 0, 1.45, 0]), 3),
    );
    flag.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    flag.setIndex([0, 1, 2, 0, 2, 1]);
    const white = new Color('#fffaf0');
    const potGeo = merge([
      { g: ball, c: new Color('#ffffff') },
      { g: band, c: white },
      { g: stick, c: new Color('#e8dccb') },
      { g: flag, c: new Color('#ff3b3b') },
    ]);
    this.pots = new InstancedMesh(potGeo, new ToonMaterial({ vertexColors: true, gloss: 0.7, side: 2 }), max);
    // give every instance a colour up front so the material compiles with instance colours
    for (let i = 0; i < max; i++) this.pots.setColorAt(i, PALETTE[i % PALETTE.length] as Color);
    this.pots.count = 0;
    this.pots.frustumCulled = false;

    const body = new CylinderGeometry(0.34, 0.34, 5, 10).rotateZ(Math.PI / 2);
    const ringA = new CylinderGeometry(0.352, 0.352, 0.12, 10).rotateZ(Math.PI / 2).translate(2.2, 0, 0);
    const ringB = new CylinderGeometry(0.352, 0.352, 0.12, 10).rotateZ(Math.PI / 2).translate(-2.2, 0, 0);
    const stub = new CylinderGeometry(0.1, 0.1, 0.9, 6).translate(0.3, 0.3, 0.0);
    const logGeo = merge([
      { g: body, c: new Color('#8a6a4a') },
      { g: ringA, c: new Color('#d8b98c') },
      { g: ringB, c: new Color('#d8b98c') },
      { g: stub, c: new Color('#6e5238') },
    ]);
    this.logs = new InstancedMesh(logGeo, new ToonMaterial({ vertexColors: true }), max);
    this.logs.count = 0;
    this.logs.frustumCulled = false;
    this.group.add(this.pots, this.logs);
    void colour;
  }

  sync(list: readonly Hazard[], env: Environment, time: number): void {
    let np = 0;
    let nl = 0;
    for (const h of list) {
      if (!h.alive) continue;
      const wave = env.waves.height(h.x, h.z, env.time);
      if (h.kind === 'pot') {
        if (np >= this.pots.instanceMatrix.count) continue;
        const bob = Math.sin(time * 1.7 + h.phase) * 0.05;
        this.p.set(h.x, wave + 0.02 + bob, h.z);
        this.e.set(Math.sin(time * 1.3 + h.phase) * 0.12, h.yaw, Math.cos(time * 1.1 + h.phase) * 0.12);
        this.q.setFromEuler(this.e);
        this.s.setScalar(h.size);
        this.pots.setMatrixAt(np, this.m.compose(this.p, this.q, this.s));
        this.pots.setColorAt(np, PALETTE[(Math.floor(h.phase * 7) + np) % PALETTE.length] as Color);
        np++;
      } else {
        if (nl >= this.logs.instanceMatrix.count) continue;
        this.p.set(h.x, wave - 0.12 + Math.sin(time * 1.2 + h.phase) * 0.06, h.z);
        this.e.set(
          Math.sin(time * 0.9 + h.phase) * 0.14,
          -h.yaw,
          Math.cos(time * 0.8 + h.phase) * 0.1,
          'YXZ',
        );
        this.q.setFromEuler(this.e);
        this.s.set(h.size, h.size, h.size);
        this.logs.setMatrixAt(nl, this.m.compose(this.p, this.q, this.s));
        nl++;
      }
    }
    this.pots.count = np;
    this.logs.count = nl;
    this.pots.instanceMatrix.needsUpdate = true;
    this.logs.instanceMatrix.needsUpdate = true;
    if (this.pots.instanceColor) this.pots.instanceColor.needsUpdate = true;
  }
}
