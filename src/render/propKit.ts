// Scatter many small pastel props (bushes, boulders, cottages) as one merged, vertex-coloured mesh.

import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  Euler,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three/webgpu';

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Per-axis scale. */
  sx: number;
  sy: number;
  sz: number;
  /** Yaw (rotation about the vertical axis). */
  yaw: number;
  color: Color;
}

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const s = new Vector3();
const n = new Vector3();

/** Merge `geo` copied to every placement into one mesh, coloured per placement. */
export function scatterMesh(geo: BufferGeometry, items: readonly Placement[], material: Material): Mesh {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position as BufferAttribute;
  const per = pos.count;
  const P = new Float32Array(per * items.length * 3);
  const N = new Float32Array(per * items.length * 3);
  const C = new Float32Array(per * items.length * 3);
  let o = 0;
  for (const it of items) {
    e.set(0, it.yaw, 0);
    q.setFromEuler(e);
    m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
    for (let i = 0; i < per; i++) {
      n.fromBufferAttribute(pos, i).applyMatrix4(m);
      P[o] = n.x;
      P[o + 1] = n.y;
      P[o + 2] = n.z;
      C[o] = it.color.r;
      C[o + 1] = it.color.g;
      C[o + 2] = it.color.b;
      o += 3;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3));
  g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('color', new BufferAttribute(C, 3));
  g.computeVertexNormals();
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A gable roof of unit size: ridge along x, width across z, the base at y = -0.5 and the ridge at y = +0.5,
 * so a placement's scale gives it any footprint and pitch.
 */
export function gableGeometry(): BufferGeometry {
  const a = [-0.5, -0.5, -0.5];
  const b = [0.5, -0.5, -0.5];
  const c = [0.5, -0.5, 0.5];
  const d = [-0.5, -0.5, 0.5];
  const r0 = [-0.5, 0.5, 0];
  const r1 = [0.5, 0.5, 0];
  // two slopes and the two gable ends, wound counter-clockwise seen from outside
  const tris = [a, r0, r1, a, r1, b, d, c, r1, d, r1, r0, a, d, r0, b, r1, c];
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => {
    pos[i * 3] = v[0] as number;
    pos[i * 3 + 1] = v[1] as number;
    pos[i * 3 + 2] = v[2] as number;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  // PartBuilder merges position + normal + uv, so a prop that goes through it needs a (flat) uv too
  g.setAttribute('uv', new BufferAttribute(new Float32Array(tris.length * 2), 2));
  g.computeVertexNormals();
  return g;
}
