// The two seawalls of the Cut: concrete face + promenade, lamp posts, channel daymarks, fishermen.

import { Color, Group, Mesh } from 'three/webgpu';
import { Rng } from '../../../core/math';
import { bulb, gel, matte, metal } from '../../../render/boats/materials';
import { PartBuilder, type V3 } from '../../../render/boats/parts';
import { type P3, sweep } from '../../../render/world/sweep';
import { bayX, beachX, cutHalfW, cutZ, SEA_WALL_TOP } from '../geography';

export const WALL_PROMENADE = 11;

/** x range over which the cut is a walled channel (per side). */
export function wallRange(side: -1 | 1): [number, number] {
  const z0 = side * 60;
  return [bayX(z0) - 3, beachX(z0) + 6];
}

export function buildSeawalls(): Group {
  const g = new Group();
  g.name = 'seawalls';
  const concrete = matte('#efe8dd', 0.92);
  const faceMat = matte('#e3dbd0', 0.95);
  const rng = new Rng(77);
  for (const side of [-1, 1] as const) {
    const [xs, xe] = wallRange(side);
    const path: P3[] = [];
    for (let x = xs; x <= xe; x += 4) path.push([x, 0, cutZ(x) + side * cutHalfW(x)]);
    // profile in (lateral u toward the land, v up). lateral = cross(t, up) = +z for +x travel.
    // For the north wall (side -1) land is toward -z => u negative; south wall: u positive.
    const s = side;
    const face = sweep(
      path,
      [
        [0, -1.6],
        [0, SEA_WALL_TOP],
      ],
      { flip: side === 1 },
    );
    const top = sweep(
      path,
      [
        [0, SEA_WALL_TOP + 0.03],
        [s * WALL_PROMENADE, SEA_WALL_TOP + 0.03],
      ],
      { flip: side === 1 },
    );
    const cap = sweep(
      path,
      [
        [-s * 0.25, SEA_WALL_TOP],
        [-s * 0.25, SEA_WALL_TOP + 0.34],
        [s * 0.35, SEA_WALL_TOP + 0.34],
        [s * 0.35, SEA_WALL_TOP],
      ],
      { closed: true },
    );
    for (const [geo, mat] of [
      [face, faceMat],
      [top, concrete],
      [cap, gel('#f7f2ea', 0.5)],
    ] as const) {
      const m = new Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = true;
      m.frustumCulled = false;
      g.add(m);
    }

    // lamp posts, bollards, daymarks, fishermen
    const pb = new PartBuilder();
    const pole = metal('#e9eef3', 0.35);
    const red = gel('#ff6f7d', 0.4);
    const green = gel('#37d6a0', 0.4);
    for (let x = xs + 30; x < xe - 20; x += 38) {
      const z = cutZ(x) + side * (cutHalfW(x) + 2.2);
      pb.cyl(pole, 0.05, 0.08, 4.6, { pos: [x, SEA_WALL_TOP + 2.3, z] }, 8);
      pb.rod(pole, [x, SEA_WALL_TOP + 4.5, z], [x, SEA_WALL_TOP + 4.5, z - side * 0.8], 0.04);
      pb.sphere(bulb('#fff2c8', 8), 0.17, { pos: [x, SEA_WALL_TOP + 4.45, z - side * 0.8] }, 8);
    }
    for (let x = xs + 12; x < xe - 12; x += 14) {
      const z = cutZ(x) + side * (cutHalfW(x) + 0.5);
      pb.cyl(matte('#3b4254'), 0.14, 0.16, 0.45, { pos: [x, SEA_WALL_TOP + 0.35, z] }, 8);
    }
    // channel daymarks every ~170 m (red triangles north, green squares south)
    for (let x = xs + 60; x < xe - 30; x += 170) {
      const z = cutZ(x) + side * (cutHalfW(x) + 1.1);
      pb.cyl(matte('#6a5b4b'), 0.16, 0.2, 6.2, { pos: [x, SEA_WALL_TOP + 3.1, z] }, 8);
      if (side === -1) pb.cone(red, 0.9, 1.5, { pos: [x, SEA_WALL_TOP + 6.9, z - 0.2], rot: [0, 0, 0] }, 3);
      else pb.box(green, 1.2, 1.2, 0.1, { pos: [x, SEA_WALL_TOP + 6.8, z + 0.2], rot: [0, 0.4, 0] }, 0.03);
      pb.sphere(bulb(side === -1 ? '#ff5a6a' : '#4dffb0', 9), 0.14, { pos: [x, SEA_WALL_TOP + 7.7, z] }, 8);
    }
    g.add(pb.build());

    // fishermen along the south wall (the sunny side)
    if (side === 1) {
      const shirts = ['#ff8f7a', '#7ff0d0', '#ffd45e', '#9fb8ff', '#ff9ccf', '#fffaf3'];
      const pp = new PartBuilder();
      for (let i = 0; i < 9; i++) {
        const x = xs + 40 + rng.next() * (xe - xs - 80);
        const z = cutZ(x) + cutHalfW(x) + 0.9;
        const col = new Color(shirts[i % shirts.length] as string);
        const shirt = matte(`#${col.getHexString()}`, 0.8);
        pp.capsule(shirt, 0.22, 0.5, { pos: [x, SEA_WALL_TOP + 0.75, z] });
        pp.sphere(matte('#f1c7a1'), 0.16, { pos: [x, SEA_WALL_TOP + 1.38, z] }, 8);
        pp.cyl(matte('#3b4254'), 0.2, 0.2, 0.06, { pos: [x, SEA_WALL_TOP + 1.58, z] }, 10);
        pp.rod(matte('#2b2b36'), [x, SEA_WALL_TOP + 1.2, z - 0.25], [x, SEA_WALL_TOP + 3.0, z - 2.6], 0.012);
        pp.rod(matte('#e8e8f0'), [x, SEA_WALL_TOP + 3.0, z - 2.6], [x, SEA_WALL_TOP + 0.6, z - 4.4], 0.004);
      }
      g.add(pp.build());
    }
  }
  return g;
}

export type { V3 };
