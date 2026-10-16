// The old timber pilings of the marina basin: chunky weathered posts with rope wraps, a white cap and
// a caution band, leaning every which way. Instanced from the same list the physics collides with.

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
import { Rng } from '../../../core/math';
import { ToonMaterial } from '../../../render/toon';
import { PILINGS } from '../geography';

function merged(parts: { g: BufferGeometry; c: Color }[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const { g, c } of parts) {
    const p = g.attributes.position as BufferAttribute;
    const n = g.attributes.normal as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    const ix = g.index as BufferAttribute;
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

export class PilingField {
  readonly group = new Group();

  constructor() {
    this.group.name = 'pilings';
    // unit piling: base at y = -1.8, top at y = +2.6 (scaled per instance)
    const post = new CylinderGeometry(0.46, 0.5, 4.4, 10).translate(0, 0.4, 0);
    const wrapA = new CylinderGeometry(0.5, 0.5, 0.16, 10).translate(0, 1.5, 0);
    const wrapB = new CylinderGeometry(0.5, 0.5, 0.16, 10).translate(0, 1.15, 0);
    const band = new CylinderGeometry(0.505, 0.505, 0.32, 10).translate(0, 0.35, 0);
    const cap = new SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.6, 0);
    const geo = merged([
      { g: post, c: new Color('#9a7752') },
      { g: wrapA, c: new Color('#e8d8b4') },
      { g: wrapB, c: new Color('#e8d8b4') },
      { g: band, c: new Color('#ffcf3a') },
      { g: cap, c: new Color('#5a4332') },
    ]);
    const list = PILINGS.filter((p) => p.r < 1);
    const mesh = new InstancedMesh(
      geo,
      new ToonMaterial({ vertexColors: true, gloss: 0.15 }),
      Math.max(1, list.length),
    );
    const rng = new Rng(4242);
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3();
    for (const [i, pl] of list.entries()) {
      p.set(pl.x, 0, pl.z);
      e.set(rng.range(-0.05, 0.05), rng.range(0, 6.28), rng.range(-0.05, 0.05));
      q.setFromEuler(e);
      const h = rng.range(0.72, 1.12);
      s.set(1, h, 1);
      // keep the waterline fixed: the post is longer than it is tall, so lift by its base shortfall
      p.y = (1 - h) * 1.8 * -1;
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
}
