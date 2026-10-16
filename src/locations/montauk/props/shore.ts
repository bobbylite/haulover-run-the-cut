// Montauk's shoreline dressing: boulders in the surf (the ones the physics collides with), pastel scrub on
// the bluffs, and a few gray-shingle cottages.

import { Color, Group, IcosahedronGeometry } from 'three/webgpu';
import { Rng } from '../../../core/math';
import { gel, glass, matte } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { type Placement, scatterMesh } from '../../../render/propKit';
import type { Quality } from '../../../render/renderWorld';
import { ToonMaterial } from '../../../render/toon';
import { LIGHTHOUSE, landSDF, ROCKS, seabedHeight } from '../geography';

const ROCK = ['#a9a4bb', '#b8b0c4', '#9d9bb3', '#c4bccb', '#b0a8bd'].map((c) => new Color(c));
const BUSH = ['#79bd8f', '#8fcf8a', '#b8a6d6', '#e9aabb', '#9bc8a0', '#7fb89a'].map((c) => new Color(c));

export function buildShore(quality: Quality): Group {
  const group = new Group();
  group.name = 'shore';

  // boulders: a squashed icosphere per rock, half sunk in the sand
  const rng = new Rng(311);
  const rocks: Placement[] = ROCKS.map((r) => ({
    x: r.x,
    y: -r.r * 0.2,
    z: r.z,
    sx: r.r * (1 + rng.next() * 0.25),
    sy: r.r * (0.7 + rng.next() * 0.3),
    sz: r.r * (1 + rng.next() * 0.25),
    yaw: rng.next() * 6.28,
    color: ROCK[rng.int(0, ROCK.length - 1)] as Color,
  }));
  group.add(
    scatterMesh(
      new IcosahedronGeometry(1, 1),
      rocks,
      new ToonMaterial({ vertexColors: true, roughness: 0.9 }),
    ),
  );

  // scrub on the bluffs and moor: beach plum, bayberry and scrub oak, as soft pastel blobs
  const bushes: Placement[] = [];
  const want = quality === 'low' ? 260 : 700;
  let tries = 0;
  while (bushes.length < want && tries++ < want * 30) {
    const x = -1900 + rng.next() * 1750;
    const z = -820 + rng.next() * 1500;
    const di = -landSDF(x, z);
    if (di < 28) continue;
    if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 70) continue;
    const h = seabedHeight(x, z);
    if (h < 2.5) continue;
    // clump along the bluff tops and around hollows
    if (rng.next() > 0.25 + 0.75 * Math.exp(-di / 500)) continue;
    const s = 1.6 + rng.next() * 3.2;
    bushes.push({
      x,
      y: h + s * 0.25,
      z,
      sx: s * (1 + rng.next() * 0.4),
      sy: s * (0.7 + rng.next() * 0.3),
      sz: s * (1 + rng.next() * 0.4),
      yaw: rng.next() * 6.28,
      color: BUSH[rng.int(0, BUSH.length - 1)] as Color,
    });
  }
  group.add(
    scatterMesh(
      new IcosahedronGeometry(1, 0),
      bushes,
      new ToonMaterial({ vertexColors: true, roughness: 0.95 }),
    ),
  );

  // cottages inland of the north and south beaches
  const pb = new PartBuilder();
  const walls = ['#cfc8dc', '#d9d0c4', '#c8d6d4', '#e0c9cc', '#d6d8e8'];
  const roofs = ['#e58a92', '#8f8aa6', '#c9a86a', '#7aa6b8'];
  let placed = 0;
  let cTries = 0;
  while (placed < 10 && cTries++ < 600) {
    const x = -1500 + rng.next() * 900;
    const z = (rng.next() < 0.5 ? -1 : 1) * (320 + rng.next() * 380);
    const di = -landSDF(x, z);
    if (di < 120) continue;
    const h = seabedHeight(x, z);
    if (h < 3) continue;
    const w = 9 + rng.next() * 5;
    const d = 6 + rng.next() * 3;
    const yaw = rng.next() * 0.6 - 0.3;
    const wall = gel(walls[placed % walls.length] as string, 0.7);
    const roof = gel(roofs[placed % roofs.length] as string, 0.6);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (lx: number, ly: number, lz: number): [number, number, number] => [
      x + lx * c + lz * s,
      h + ly,
      z - lx * s + lz * c,
    ];
    pb.box(wall, w, 4.2, d, { pos: at(0, 2.1, 0), rot: [0, -yaw, 0] }, 0.2);
    pb.box(roof, w + 1, 0.4, d * 0.62, { pos: at(0, 5.0, -d * 0.2), rot: [0.55, -yaw, 0] }, 0.1);
    pb.box(roof, w + 1, 0.4, d * 0.62, { pos: at(0, 5.0, d * 0.2), rot: [-0.55, -yaw, 0] }, 0.1);
    pb.box(
      glass('#7a9dc0'),
      1.2,
      1.3,
      0.14,
      { pos: at(-w * 0.25, 2.4, d / 2 + 0.05), rot: [0, -yaw, 0] },
      0.04,
    );
    pb.box(
      glass('#7a9dc0'),
      1.2,
      1.3,
      0.14,
      { pos: at(w * 0.25, 2.4, d / 2 + 0.05), rot: [0, -yaw, 0] },
      0.04,
    );
    pb.box(matte('#fffaf2'), 1, 2, 0.12, { pos: at(0, 1.05, d / 2 + 0.05), rot: [0, -yaw, 0] }, 0.04);
    placed++;
  }
  group.add(pb.build());
  group.traverse((o) => {
    o.frustumCulled = false;
  });
  return group;
}
