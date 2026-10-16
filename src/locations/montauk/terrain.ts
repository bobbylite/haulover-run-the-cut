// Montauk's land: cream beaches, peach and rose clay bluffs, heathery moor and sea-green dune grass, in
// the same pastel vertex-colour style as the rest of the game.

import { positionWorld, texture, vec2, vec3 } from 'three/tsl';
import { Color, type DataTexture, Group, Mesh } from 'three/webgpu';
import { clamp, fbm2, smoothstep } from '../../core/math';
import { buildTerrainBlock, type TerrainBlock } from '../../render/terrainMesh';
import { ToonMaterial } from '../../render/toon';
import type { GeoGrid } from '../../sim/geoGrid';
import { coastX, landSDF, seabedHeight, WORLD } from './geography';

const C = {
  sandDry: new Color('#f7e8c9'),
  sandWet: new Color('#dcc59f'),
  dune: new Color('#b6cf8a'),
  duneDark: new Color('#9bc182'),
  clayPeach: new Color('#f0bda2'),
  clayRose: new Color('#dca6ac'),
  clayCream: new Color('#f4dfbc'),
  moor: new Color('#b8a2cb'),
  moorOlive: new Color('#aebf80'),
  lawn: new Color('#9fd286'),
  scrub: new Color('#6fb88c'),
  road: new Color('#c9c4d4'),
};

const tmp = new Color();

function height(x: number, z: number): number {
  return seabedHeight(x, z);
}

/** Colour of a land vertex. */
export function terrainColor(x: number, z: number, h: number, out: Color): void {
  const di = -landSDF(x, z);
  const e = 5;
  const gx = (height(x + e, z) - height(x - e, z)) / (2 * e);
  const gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  const slope = Math.hypot(gx, gz);
  const n1 = fbm2(x * 0.02, z * 0.02, 3, 61);
  const n2 = fbm2(x * 0.09 + 11, z * 0.09, 2, 63);

  // inland: moor, lawn and scrub
  out.copy(C.lawn).lerp(C.moorOlive, clamp(n1 * 1.5 - 0.2, 0, 1));
  out.lerp(C.moor, smoothstep(0.45, 0.85, n2) * 0.7 * smoothstep(120, 400, di));
  out.lerp(C.scrub, smoothstep(0.55, 0.85, fbm2(x * 0.03, z * 0.03, 2, 67)) * 0.55);
  // dune grass on the way up from the beach
  const dune = smoothstep(10, 40, di) * (1 - smoothstep(60, 180, di));
  out.lerp(C.dune, dune * 0.9).lerp(C.duneDark, dune * n2 * 0.4);
  // banded clay where the bluff is steep
  const band = 0.5 + 0.5 * Math.sin(h * 1.9 + n1 * 6);
  const clay = tmp
    .copy(C.clayPeach)
    .lerp(C.clayRose, band)
    .lerp(C.clayCream, smoothstep(0.7, 1, n2) * 0.5);
  out.lerp(clay, smoothstep(0.32, 0.62, slope) * 0.95);
  // the beach and the wet sand at the waterline
  out.lerp(C.sandDry, 1 - smoothstep(14, 34, di));
  out.lerp(C.sandWet, (1 - smoothstep(0.1, 0.8, h)) * 0.9);
}

/** The land is built from a fine core around the Point and coarse continuations to the horizon. */
export function buildTerrain(geo: GeoGrid, noiseTex?: DataTexture): Group {
  const group = new Group();
  group.name = 'terrain';
  const mat = new ToonMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  if (noiseTex) {
    const nz = texture(noiseTex);
    const p = vec2(positionWorld.x, positionWorld.z);
    const a = nz.sample(p.mul(0.012)).r;
    const b = nz.sample(p.mul(0.07).add(0.31)).g;
    const c = nz.sample(p.mul(0.42).add(0.77)).a;
    const d = a.mul(0.5).add(b.mul(0.32)).add(c.mul(0.18));
    const tint = vec3(0.8, 0.8, 0.76).add(vec3(0.3, 0.28, 0.34).mul(d));
    mat.colorNode = tint as unknown as typeof mat.colorNode;
  }
  const common = { minH: -1.4, height, color: terrainColor, skirt: C.sandWet };
  const blocks: TerrainBlock[] = [
    // the bluffs and the Point
    {
      ...common,
      x0: WORLD.x0,
      x1: WORLD.x1 * 0.2,
      z0: WORLD.z0,
      z1: WORLD.z1,
      step: 12,
      prefilter: (x, z) => (x > coastX(z) + 60 ? -9 : geo.heightAt(x, z)),
    },
    // the long coast north and south, then the whole of Long Island behind
    { ...common, x0: -2800, x1: -1500, z0: WORLD.z1 - 8, z1: 6000, step: 40 },
    { ...common, x0: -2800, x1: -1500, z0: -6000, z1: WORLD.z0 + 8, step: 40 },
    { ...common, x0: -8000, x1: WORLD.x0 + 8, z0: -6000, z1: 6000, step: 90 },
  ];
  for (const b of blocks) {
    const g = buildTerrainBlock(b);
    if (!g) continue;
    const m = new Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}
