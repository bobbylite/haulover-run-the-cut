// Small kit for assembling boats from primitives, merged per material for few draw calls.

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three/webgpu';

export type V3 = [number, number, number];

export interface Xform {
  pos?: V3;
  /** Euler XYZ in radians. */
  rot?: V3;
  scale?: V3 | number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export function matrixOf(x: Xform = {}): Matrix4 {
  _p.set(...(x.pos ?? [0, 0, 0]));
  _e.set(...(x.rot ?? [0, 0, 0]));
  _q.setFromEuler(_e);
  const sc = x.scale ?? 1;
  if (typeof sc === 'number') _s.set(sc, sc, sc);
  else _s.set(...sc);
  return _m.compose(_p, _q, _s);
}

export class PartBuilder {
  private readonly buckets = new Map<Material, BufferGeometry[]>();

  add(geo: BufferGeometry, mat: Material, x: Xform = {}): this {
    const g = geo.clone();
    g.applyMatrix4(matrixOf(x));
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(g);
    return this;
  }

  /** Rounded box (the staple of the toy-like pastel look). */
  box(
    mat: Material,
    w: number,
    h: number,
    d: number,
    x: Xform = {},
    radius = Math.min(w, h, d) * 0.22,
  ): this {
    return this.add(new RoundedBoxGeometry(w, h, d, 3, Math.max(0.004, radius)), mat, x);
  }

  cyl(mat: Material, rTop: number, rBot: number, h: number, x: Xform = {}, seg = 14): this {
    return this.add(new CylinderGeometry(rTop, rBot, h, seg, 1), mat, x);
  }

  cone(mat: Material, r: number, h: number, x: Xform = {}, seg = 16): this {
    return this.add(new ConeGeometry(r, h, seg, 1, true), mat, x);
  }

  sphere(mat: Material, r: number, x: Xform = {}, seg = 16): this {
    return this.add(new SphereGeometry(r, seg, Math.max(6, seg >> 1)), mat, x);
  }

  capsule(mat: Material, r: number, len: number, x: Xform = {}): this {
    return this.add(new CapsuleGeometry(r, len, 5, 12), mat, x);
  }

  torus(mat: Material, r: number, tube: number, x: Xform = {}, arc = Math.PI * 2): this {
    return this.add(new TorusGeometry(r, tube, 8, 22, arc), mat, x);
  }

  /** Tube along a smooth path. */
  tube(mat: Material, pts: V3[], radius: number, closed = false, seg?: number): this {
    const curve = new CatmullRomCurve3(
      pts.map((p) => new Vector3(...p)),
      closed,
      'catmullrom',
      0.35,
    );
    const g = new TubeGeometry(curve, seg ?? Math.max(8, pts.length * 4), radius, 6, closed);
    return this.add(g, mat);
  }

  /** Straight rod between two points. */
  rod(mat: Material, a: V3, b: V3, radius: number, seg = 8): this {
    const va = new Vector3(...a);
    const vb = new Vector3(...b);
    const len = va.distanceTo(vb);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const g = new CylinderGeometry(radius, radius, len, seg, 1);
    g.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(g);
    return this;
  }

  /** Build one Mesh per material. */
  build(shadows = true): Group {
    const group = new Group();
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos.map(normaliseForMerge), false);
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
    }
    return group;
  }
}

function normaliseForMerge(g: BufferGeometry): BufferGeometry {
  // geometries built by us always carry position/normal/uv; keep only those and ensure index presence
  const out = g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.index) {
    const n = out.attributes.position!.count;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    out.setIndex(idx);
  }
  return out;
}
