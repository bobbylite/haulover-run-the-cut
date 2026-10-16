// Parametric hull lofting. A hull is a stack of cross-sections ("stations") from transom to stem.
// Each section is a quadratic Bezier from the keel through the chine to the gunwale, so a handful of
// functions (beam, sheer, rocker, deadrise) give a smooth, stylised, flared hull. Livery bands are
// written as vertex colours, so a single mesh carries stripes, boot-top and bottom paint.

import { BufferAttribute, BufferGeometry, Color } from 'three';
import { smoothstep } from '../../core/math';

export interface Livery {
  top: Color;
  /** Stripe near the sheer. */
  stripe: Color;
  stripeFrom: number; // height below sheer where the stripe starts (m)
  stripeTo: number;
  /** Thin boot stripe at the waterline. */
  boot: Color;
  bootFrom: number; // y range (m)
  bootTo: number;
  bottom: Color;
  /** Colour of the inside of the shell (visible on open boats). */
  inner: Color;
}

export interface HullShape {
  length: number;
  beam: number;
  xAft: number;
  draft: number;
  planform: (s: number) => number;
  sheer: (s: number) => number;
  rocker: (s: number) => number;
  deadrise: (s: number) => number;
  chineRatio: (s: number) => number;
  keelFactor: number;
  rake: number;
  livery: Livery;
  stations?: number;
  points?: number;
}

const _c = new Color();

/** Cross-section of one station: points from the keel (t = 0) to the gunwale (t = 1), z >= 0. */
export function section(
  h: HullShape,
  s: number,
  n: number,
): { z: Float32Array; y: Float32Array; hb: number; sheerY: number } {
  const hb = h.planform(s) * (h.beam / 2);
  const sheerY = h.sheer(s);
  const keelY = -h.draft * h.keelFactor + h.rocker(s) * h.keelFactor;
  const cz = hb * h.chineRatio(s);
  const cy = keelY + Math.max(0.02, cz * Math.tan(h.deadrise(s)));
  const z = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    z[i] = b * cz + c * hb;
    y[i] = a * keelY + b * cy + c * sheerY;
  }
  return { z, y, hb, sheerY };
}

/** Half width of the hull at height y for station s (interpolating the section). */
export function widthAtY(h: HullShape, s: number, y: number): number {
  const n = 40;
  const sec = section(h, s, n);
  if (y >= (sec.y[n - 1] as number)) return sec.z[n - 1] as number;
  for (let i = 1; i < n; i++) {
    const y0 = sec.y[i - 1] as number;
    const y1 = sec.y[i] as number;
    if (y <= y1) {
      const t = (y - y0) / Math.max(1e-6, y1 - y0);
      return (sec.z[i - 1] as number) * (1 - t) + (sec.z[i] as number) * t;
    }
  }
  return sec.z[n - 1] as number;
}

function liveryColor(h: HullShape, y: number, sheerY: number, out: Color): Color {
  const L = h.livery;
  if (y < L.bootFrom) return out.copy(L.bottom);
  if (y < L.bootTo) return out.copy(L.boot);
  if (y > sheerY - L.stripeTo && y < sheerY - L.stripeFrom) return out.copy(L.stripe);
  return out.copy(L.top);
}

export function stationParam(i: number, n: number): number {
  const u = i / (n - 1);
  return 1 - (1 - u) ** 1.6;
}

/** The outer shell as an indexed BufferGeometry with vertex colours. */
export function loftShell(h: HullShape): BufferGeometry {
  const NS = h.stations ?? 44;
  const NP = h.points ?? 34;
  const verts = NS * (NP * 2 - 1);
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const row = NP * 2 - 1;
  for (let i = 0; i < NS; i++) {
    const s = stationParam(i, NS);
    const sec = section(h, s, NP);
    const x0 = h.xAft + s * h.length;
    for (let j = 0; j < row; j++) {
      // j = 0..NP-1 is port (negative z) from gunwale down to keel, then starboard keel up to gunwale
      const side = j < NP ? -1 : 1;
      const k = j < NP ? NP - 1 - j : j - (NP - 1);
      const t = k / (NP - 1);
      const zz = (sec.z[k] as number) * side;
      const yy = sec.y[k] as number;
      const rake = h.rake * smoothstep(0.78, 1.0, s) ** 2 * t ** 1.4;
      const v = i * row + j;
      pos[v * 3] = x0 + rake;
      pos[v * 3 + 1] = yy;
      pos[v * 3 + 2] = zz;
      liveryColor(h, yy, sec.sheerY, _c);
      col[v * 3] = _c.r;
      col[v * 3 + 1] = _c.g;
      col[v * 3 + 2] = _c.b;
      uv[v * 2] = s;
      uv[v * 2 + 1] = (side * t + 1) / 2;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NS - 1; i++) {
    for (let j = 0; j < row - 1; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // outward-facing triangles: counter-clockwise seen from outside the hull, so the livery (front
      // faces) paints the OUTSIDE and the plain liner tint (back faces) the inside
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat transom closing the stern. */
export function loftTransom(h: HullShape): BufferGeometry {
  const NP = h.points ?? 34;
  const sec = section(h, 0, NP);
  const pts: [number, number][] = [];
  for (let k = NP - 1; k >= 0; k--) pts.push([-(sec.z[k] as number), sec.y[k] as number]);
  for (let k = 1; k < NP; k++) pts.push([sec.z[k] as number, sec.y[k] as number]);
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const col: number[] = [];
  const x = h.xAft - 0.002;
  pos.push(x, cy, 0);
  nor.push(-1, 0, 0);
  uvs.push(0.5, 0.5);
  liveryColor(h, cy, sec.sheerY, _c);
  col.push(_c.r, _c.g, _c.b);
  for (const [z, y] of pts) {
    pos.push(x, y, z);
    nor.push(-1, 0, 0);
    uvs.push(0.5 + z / h.beam, 0.5 + y);
    liveryColor(h, y, sec.sheerY, _c);
    col.push(_c.r, _c.g, _c.b);
  }
  const idx: number[] = [];
  for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
  // close the fan across the top edge, or the upper wedge of the transom is a hole you can see the sea through
  idx.push(0, pts.length, 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  return g;
}

export interface StripOpts {
  s0: number;
  s1: number;
  /** Height of the surface (a constant or per-station function). */
  y: number | ((s: number) => number);
  /** Inset from the hull side (m). */
  inset?: number;
  /** Camber: raise the centreline by this many metres. */
  camber?: number;
  /** Height at which the hull width is measured (default = surface height). */
  widthY?: number | ((s: number) => number);
  steps?: number;
  /** Optional lateral window: only [-limit, +limit] around the centreline. */
  limit?: number;
}

/** A horizontal-ish surface (deck / cockpit sole) following the hull width, facing up. */
export function hullStrip(h: HullShape, o: StripOpts): BufferGeometry {
  const steps = o.steps ?? 28;
  const inset = o.inset ?? 0.05;
  const camber = o.camber ?? 0;
  const lat = 5;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = o.s0 + ((o.s1 - o.s0) * i) / steps;
    const y = typeof o.y === 'function' ? o.y(s) : o.y;
    const wy = o.widthY === undefined ? y : typeof o.widthY === 'function' ? o.widthY(s) : o.widthY;
    let w = widthAtY(h, s, wy) - inset;
    if (o.limit !== undefined) w = Math.min(w, o.limit);
    w = Math.max(0.001, w);
    const x = h.xAft + s * h.length + h.rake * smoothstep(0.78, 1.0, s) ** 2 * 0.5;
    for (let k = 0; k <= lat; k++) {
      const f = (k / lat) * 2 - 1;
      pos.push(x, y + camber * (1 - f * f), f * w);
      uvs.push(s * h.length, f * w);
    }
  }
  const row = lat + 1;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < lat; k++) {
      const a = i * row + k;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // counter-clockwise seen from above, so the surface faces UP (it is lit and drawn from above)
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points along the gunwale (port = -1 / starboard = +1) for rails and rub strakes. */
export function gunwaleLine(
  h: HullShape,
  side: -1 | 1,
  s0 = 0,
  s1 = 1,
  n = 40,
  yOff = 0,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const sec = section(h, s, 12);
    const rake = h.rake * smoothstep(0.78, 1.0, s) ** 2;
    out.push([h.xAft + s * h.length + rake, sec.sheerY + yOff, side * (sec.z[11] as number)]);
  }
  return out;
}
