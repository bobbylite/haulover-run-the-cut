// Sweep a 2D profile along a polyline to make walls, decks, roads and kerbs.
// Each profile segment gets its own vertices (hard edges) with an explicit outward normal; triangle
// winding is derived from the normal, so callers never have to think about orientation.

import { BufferAttribute, BufferGeometry } from 'three/webgpu';

export type P3 = [number, number, number];
export type P2 = [number, number];

export interface SweepOpts {
  /**
   * For an open profile, the normal of every segment is (dv, -du) rotated into the sweep frame;
   * `flip` reverses it. For `closed` profiles the normal is made to point away from the centroid.
   */
  flip?: boolean;
  closed?: boolean;
  /** u coordinate scale for texture along the profile, and v along the path (metres per repeat). */
  uvScale?: [number, number];
  /** Lateral vector of the frame: 'right' = cross(tangent, up) (default). */
  lateral?: 'right' | 'left';
}

export function sweep(path: P3[], profile: P2[], opts: SweepOpts = {}): BufferGeometry {
  const n = path.length;
  const segs = profile.length - (opts.closed ? 0 : 1);
  const [su, sv] = opts.uvScale ?? [1, 1];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // frames
  const T: P3[] = [];
  const L: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)] as P3;
    const b = path[Math.min(n - 1, i + 1)] as P3;
    let tx = b[0] - a[0];
    let tz = b[2] - a[2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    T.push([tx, 0, tz]);
    // cross(t, up) with up = (0,1,0): (tx,0,tz) x (0,1,0) = (0*0 - tz*1, tz*0 - tx*0, tx*1 - 0*0) = (-tz, 0, tx)
    const s = opts.lateral === 'left' ? -1 : 1;
    L.push([-tz * s, 0, tx * s]);
  }

  let cu = 0;
  let cv = 0;
  for (const [u, v] of profile) {
    cu += u;
    cv += v;
  }
  cu /= profile.length;
  cv /= profile.length;

  let accLen = 0;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    const a = path[i - 1] as P3;
    const b = path[i] as P3;
    accLen += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    along.push(accLen);
  }

  for (let s = 0; s < segs; s++) {
    const p0 = profile[s] as P2;
    const p1 = profile[(s + 1) % profile.length] as P2;
    const du = p1[0] - p0[0];
    const dv = p1[1] - p0[1];
    const len = Math.hypot(du, dv) || 1;
    let nu = dv / len;
    let nv = -du / len;
    if (opts.closed) {
      const mu = (p0[0] + p1[0]) / 2 - cu;
      const mv = (p0[1] + p1[1]) / 2 - cv;
      if (nu * mu + nv * mv < 0) {
        nu = -nu;
        nv = -nv;
      }
    } else if (opts.flip) {
      nu = -nu;
      nv = -nv;
    }
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const P = path[i] as P3;
      const l = L[i] as P3;
      for (const q of [p0, p1]) {
        pos.push(P[0] + l[0] * q[0], P[1] + q[1], P[2] + l[2] * q[0]);
        nor.push(l[0] * nu, nv, l[2] * nu);
        uvs.push((q === p0 ? 0 : len) / su, (along[i] as number) / sv);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // choose winding so the geometric normal agrees with the stored normal
      const ax = pos[a * 3] as number;
      const ay = pos[a * 3 + 1] as number;
      const az = pos[a * 3 + 2] as number;
      const e1x = (pos[b * 3] as number) - ax;
      const e1y = (pos[b * 3 + 1] as number) - ay;
      const e1z = (pos[b * 3 + 2] as number) - az;
      const e2x = (pos[c * 3] as number) - ax;
      const e2y = (pos[c * 3 + 1] as number) - ay;
      const e2z = (pos[c * 3 + 2] as number) - az;
      const gx = e1y * e2z - e1z * e2y;
      const gy = e1z * e2x - e1x * e2z;
      const gz = e1x * e2y - e1y * e2x;
      const dot =
        gx * (nor[a * 3] as number) + gy * (nor[a * 3 + 1] as number) + gz * (nor[a * 3 + 2] as number);
      if (dot >= 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  return g;
}
