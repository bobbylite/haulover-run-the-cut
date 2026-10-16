// A block of land mesh sampled from a height function, with per-vertex pastel colours. Locations compose
// a few blocks of different resolution (a detailed core, coarse continuations) into their terrain.

import { BufferAttribute, BufferGeometry, Color } from 'three/webgpu';

export interface TerrainBlock {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  step: number;
  /** Skip cells whose highest corner is below this (the sea floor is the water shader's job). */
  minH: number;
  /** Terrain height at a point; underwater values are clamped to `floor`. */
  height(x: number, z: number): number;
  /** Colour of a vertex at height h (writes into `out`). */
  color(x: number, z: number, h: number, out: Color): void;
  /** Cheap pre-test: return a height below `-4` to skip the expensive height function. */
  prefilter?(x: number, z: number): number | null;
  /** Cells to leave out (something else is built there). */
  skip?(x: number, z: number): boolean;
  /** Colour for underwater skirt vertices. */
  skirt: Color;
}

const tmp = new Color();

export function buildTerrainBlock(o: TerrainBlock): BufferGeometry | null {
  const nx = Math.ceil((o.x1 - o.x0) / o.step) + 1;
  const nz = Math.ceil((o.z1 - o.z0) / o.step) + 1;
  const hs = new Float32Array(nx * nz);
  const cellVisible = new Uint8Array((nx - 1) * (nz - 1));
  for (let j = 0; j < nz; j++) {
    const z = o.z0 + j * o.step;
    for (let i = 0; i < nx; i++) {
      const x = o.x0 + i * o.step;
      const pre = o.prefilter?.(x, z);
      if (pre !== undefined && pre !== null && pre < -4) {
        hs[j * nx + i] = -4;
        continue;
      }
      hs[j * nx + i] = Math.max(-3, o.height(x, z));
    }
  }
  let cells = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = hs[j * nx + i] as number;
      const b = hs[j * nx + i + 1] as number;
      const c = hs[(j + 1) * nx + i] as number;
      const d = hs[(j + 1) * nx + i + 1] as number;
      if (Math.max(a, b, c, d) > o.minH) {
        if (o.skip?.(o.x0 + (i + 0.5) * o.step, o.z0 + (j + 0.5) * o.step)) continue;
        cellVisible[j * (nx - 1) + i] = 1;
        cells++;
      }
    }
  }
  if (cells === 0) return null;

  const vid = new Int32Array(nx * nz).fill(-1);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const getV = (i: number, j: number): number => {
    const k = j * nx + i;
    let v = vid[k] as number;
    if (v >= 0) return v;
    v = pos.length / 3;
    vid[k] = v;
    const x = o.x0 + i * o.step;
    const z = o.z0 + j * o.step;
    const h = hs[k] as number;
    pos.push(x, h, z);
    if (h > -0.2) o.color(x, z, h, tmp);
    else tmp.copy(o.skirt);
    col.push(tmp.r, tmp.g, tmp.b);
    return v;
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (!cellVisible[j * (nx - 1) + i]) continue;
      const v00 = getV(i, j);
      const v10 = getV(i + 1, j);
      const v01 = getV(i, j + 1);
      const v11 = getV(i + 1, j + 1);
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  g.computeVertexNormals();
  return g;
}
