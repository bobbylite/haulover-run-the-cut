// Nantucket's land: cream beaches and sage dune grass on Brant Point and Coatue, and behind the bulkhead the
// town: lavender cobbles along the waterfront, then lawns and gardens. Same pastel vertex-colour style as the
// rest of the game.

import { positionWorld, texture, vec2, vec3 } from 'three/tsl';
import { Color, type DataTexture, Group, Mesh } from 'three/webgpu';
import { clamp, fbm2, smoothstep } from '../../core/math';
import { buildTerrainBlock, type TerrainBlock } from '../../render/terrainMesh';
import { ToonMaterial } from '../../render/toon';
import type { GeoGrid } from '../../sim/geoGrid';
import { landSDF, seabedHeight, TOWN_Z, WORLD } from './geography';

const C = {
  sandDry: new Color('#f7e8c9'),
  sandWet: new Color('#dcc59f'),
  dune: new Color('#b6cf8a'),
  duneDark: new Color('#9bc182'),
  rose: new Color('#f0a9bd'),
  cobble: new Color('#cfc8da'),
  cobbleDark: new Color('#b9b1c9'),
  lawn: new Color('#a4d58c'),
  garden: new Color('#8fcf9a'),
  hydrangea: new Color('#b9b3ee'),
  path: new Color('#e9dcc6'),
};

const tmp = new Color();

const height = (x: number, z: number): number => seabedHeight(x, z);

/** The town: land behind the straight bulkhead. */
const inTown = (x: number, z: number): boolean => z > TOWN_Z - 4 && x > -620 && x < 420;

/** Colour of a land vertex. */
export function terrainColor(x: number, z: number, h: number, out: Color): void {
  const di = -landSDF(x, z);
  const n1 = fbm2(x * 0.02, z * 0.02, 3, 61);
  const n2 = fbm2(x * 0.09 + 11, z * 0.09, 2, 63);
  if (inTown(x, z)) {
    const back = z - TOWN_Z;
    // lawns and gardens behind the houses, cobbles on the waterfront street
    out.copy(C.lawn).lerp(C.garden, clamp(n1 * 1.6 - 0.3, 0, 1));
    out.lerp(C.hydrangea, smoothstep(0.66, 0.9, n2) * 0.55 * smoothstep(40, 120, back));
    // Easy Street's yard behind the basin, and the lanes between the rows of houses
    const lane = Math.abs(((z - TOWN_Z - 14) % 38) - 19) > 15.5 ? 1 : 0;
    out.lerp(C.path, lane * 0.55 * smoothstep(20, 70, back));
    const cob = 1 - smoothstep(8, 30, back);
    out.lerp(tmp.copy(C.cobble).lerp(C.cobbleDark, n2 * 0.7), cob);
    // the pier heads and the quay edge are paved right to the water
    out.lerp(C.cobbleDark, (1 - smoothstep(0, 3, di)) * 0.6);
    return;
  }
  // beaches, dune grass and beach rose
  out.copy(C.dune).lerp(C.duneDark, n1);
  out.lerp(C.rose, smoothstep(0.7, 0.92, n2) * 0.5 * smoothstep(20, 60, di));
  out.lerp(C.sandDry, 1 - smoothstep(18, 46, di));
  out.lerp(C.sandWet, (1 - smoothstep(0.1, 0.8, h)) * 0.9);
}

/** Fine terrain around the harbour, coarse continuations to the horizon. */
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
    const tint = vec3(0.8, 0.8, 0.78).add(vec3(0.3, 0.28, 0.32).mul(d));
    mat.colorNode = tint as unknown as typeof mat.colorNode;
  }
  const common = { minH: -1.2, height, color: terrainColor, skirt: C.sandWet };
  const blocks: TerrainBlock[] = [
    // the harbour's rim: Brant Point, Coatue and the town
    {
      ...common,
      x0: WORLD.x0,
      x1: WORLD.x1,
      z0: -520,
      z1: WORLD.z1,
      step: 9,
      prefilter: (x, z) => (landSDF(x, z) > 30 ? -9 : geo.heightAt(x, z)),
    },
    // the island behind the town and the long arms of Coatue
    { ...common, x0: WORLD.x0, x1: WORLD.x1, z0: WORLD.z1 - 8, z1: 4200, step: 42 },
    { ...common, x0: -4200, x1: WORLD.x0 + 8, z0: -520, z1: 4200, step: 48 },
    { ...common, x0: WORLD.x1 - 8, x1: 4200, z0: -520, z1: 4200, step: 48 },
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
