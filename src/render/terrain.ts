// Land mesh built from the analytic geography. Pastel vertex colours give the painterly look:
// warm sand and dunes on the Atlantic side, lush lawn in the park, mangrove greens on the bay side.

import { positionWorld, texture, vec2, vec3 } from 'three/tsl';
import { BufferAttribute, BufferGeometry, Color, type DataTexture, Group, Mesh } from 'three/webgpu';
import { clamp, fbm2, smoothstep } from '../core/math';
import {
  BRIDGE_X,
  bayX,
  beachX,
  cutHalfW,
  cutZ,
  type GeoGrid,
  landSDF,
  seabedHeight,
  WORLD,
} from '../sim/geography';
import { ToonMaterial } from './toon';
import { wallRange } from './world/seawall';

const C = {
  sandDry: new Color('#f5e3bd'),
  sandWet: new Color('#d9c196'),
  sandCool: new Color('#e9d6b2'),
  oats: new Color('#b6c27a'),
  lawnA: new Color('#9bd078'),
  lawnB: new Color('#84c46f'),
  lawnC: new Color('#c4dd86'),
  mangrove: new Color('#4aa872'),
  mangroveDark: new Color('#2f8a63'),
  hammock: new Color('#58b573'),
  promenade: new Color('#efe6d8'),
  asphalt: new Color('#a4a1b8'),
  concrete: new Color('#e4dccf'),
  urban: new Color('#cfd3c8'),
};

const tmp = new Color();

/** Writes the colour at a land vertex into `out`. */
export function terrainColor(x: number, z: number, h: number, out: Color): void {
  const n1 = fbm2(x * 0.02, z * 0.02, 3, 61);
  const n2 = fbm2(x * 0.09 + 11, z * 0.09, 2, 63);
  const dOcean = beachX(z) - x;
  const dBay = x - bayX(z);
  const cd = Math.abs(z - cutZ(x)) - cutHalfW(x);

  if (x < bayX(z) - 4 || x < -700) {
    // bay-side land: mangrove islets and mainland
    out.copy(C.mangrove).lerp(C.mangroveDark, clamp(n1 * 1.4 - 0.2 + n2 * 0.3, 0, 1));
    const shore = smoothstep(0.1, 0.9, h);
    out.lerp(C.sandCool, 1 - shore);
    return;
  }

  // sand on the beach / dunes
  const beach = 1 - smoothstep(26, 70, dOcean);
  out
    .copy(C.lawnA)
    .lerp(C.lawnB, n1)
    .lerp(C.lawnC, smoothstep(0.55, 0.9, n2) * 0.6);
  // sea-oats tint on dunes
  const dune = smoothstep(30, 60, dOcean) * (1 - smoothstep(130, 220, dOcean));
  out.lerp(C.oats, dune * (0.35 + 0.45 * n2));
  out.lerp(C.sandDry, beach);
  // wet sand near the waterline
  const wet = 1 - smoothstep(0.15, 0.7, h);
  out.lerp(C.sandWet, wet * 0.85);
  // bay shore: pale sand band
  const bayShore = 1 - smoothstep(2, 14, dBay);
  out.lerp(C.sandCool, bayShore * 0.8);
  // concrete promenade next to the seawall
  if (cd < 12 && x < beachX(z) + 30) out.lerp(C.promenade, 1 - smoothstep(4, 12, cd));
  // road corridor of A1A
  const road = 1 - smoothstep(7, 11, Math.abs(x - BRIDGE_X - 4 * Math.sin(z * 0.004)));
  if (road > 0 && cd > 6) out.lerp(C.asphalt, road * 0.95);
  // developed strip with the towers (north)
  if (z < -190 && x > -150 && x < 170) {
    const dev =
      smoothstep(-190, -260, z) * (1 - smoothstep(60, 110, dOcean - 90)) * smoothstep(0, 40, dOcean);
    out.lerp(C.urban, dev * 0.7);
  }
}

interface BlockOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  step: number;
  /** Skip cells whose max height is below this. */
  minH: number;
  useGrid?: GeoGrid;
  /** Skip cells under the seawall promenade. */
  walls?: boolean;
}

const WALL_X: [[number, number], [number, number]] = [wallRange(-1), wallRange(1)];
/** True where the seawall + promenade geometry replaces the terrain mesh. */
function underWall(x: number, z: number): boolean {
  for (const [xs, xe] of WALL_X) {
    if (x > xs && x < xe) {
      const cd = Math.abs(z - cutZ(x)) - cutHalfW(x);
      if (cd < 4.5) return true;
    }
  }
  return false;
}

function buildBlock(o: BlockOpts): BufferGeometry | null {
  const nx = Math.ceil((o.x1 - o.x0) / o.step) + 1;
  const nz = Math.ceil((o.z1 - o.z0) / o.step) + 1;
  const hs = new Float32Array(nx * nz);
  const cellVisible = new Uint8Array((nx - 1) * (nz - 1));
  for (let j = 0; j < nz; j++) {
    const z = o.z0 + j * o.step;
    for (let i = 0; i < nx; i++) {
      const x = o.x0 + i * o.step;
      // cheap prefilter against the baked grid when available
      if (o.useGrid && x > WORLD.x0 && x < WORLD.x1 && z > WORLD.z0 && z < WORLD.z1) {
        const gh = o.useGrid.heightAt(x, z);
        if (gh < -4) {
          hs[j * nx + i] = -4;
          continue;
        }
      }
      hs[j * nx + i] = Math.max(-3, seabedHeight(x, z));
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
        if (o.walls && underWall(o.x0 + (i + 0.5) * o.step, o.z0 + (j + 0.5) * o.step)) continue;
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
    // underwater skirt vertices get sandy colours (hidden by the water anyway)
    if (landSDF(x, z) < 0 || h > -0.2) terrainColor(x, z, h, tmp);
    else tmp.copy(C.sandWet);
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
      // consistent winding, normals up
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

export function buildTerrain(geo: GeoGrid, noiseTex?: DataTexture): Group {
  const group = new Group();
  group.name = 'terrain';
  const mat = new ToonMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  if (noiseTex) {
    // multi-scale value-noise detail so the lawns / dunes read as painted rather than flat
    const nz = texture(noiseTex);
    const p = vec2(positionWorld.x, positionWorld.z);
    const a = nz.sample(p.mul(0.012)).r;
    const b = nz.sample(p.mul(0.07).add(0.31)).g;
    const c = nz.sample(p.mul(0.42).add(0.77)).a;
    const d = a.mul(0.5).add(b.mul(0.32)).add(c.mul(0.18));
    const tint = vec3(0.78, 0.8, 0.72).add(vec3(0.34, 0.3, 0.38).mul(d));
    mat.colorNode = tint as unknown as typeof mat.colorNode;
  }

  const blocks: BlockOpts[] = [
    // detailed core
    {
      x0: WORLD.x0,
      x1: WORLD.x1,
      z0: WORLD.z0,
      z1: WORLD.z1,
      step: 6,
      minH: -1.4,
      useGrid: geo,
      walls: true,
    },
    // north / south continuation of the barrier island and mainland
    { x0: -2600, x1: 460, z0: WORLD.z1 - 6, z1: 5200, step: 26, minH: -1.4 },
    { x0: -2600, x1: 460, z0: -5200, z1: WORLD.z0 + 6, step: 26, minH: -1.4 },
    // far western mainland
    { x0: -7200, x1: WORLD.x0 + 6, z0: -5200, z1: 5200, step: 64, minH: -1.4 },
  ];
  for (const b of blocks) {
    const g = buildBlock(b);
    if (!g) continue;
    const m = new Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
