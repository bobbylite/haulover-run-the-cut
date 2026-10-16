// The waterfront: the stone bulkhead along the town, the four wharves, the comb of finger piers in Easy
// Street Boat Basin, and their furniture (pilings, bollards, fenders, lamps, the Steamship terminal).
// Every pier here is a rectangle the physics treats as hard, so what you see is what you can hit.

import { Group } from 'three/webgpu';
import { makeFlag } from '../../../render/boats/common';
import { bulb, gel, matte, metal, teak } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { DOCKS, NOTCH, QUAY_TOP, TOWN_Z } from '../geography';

const STONE = '#c9c2d8';
const STONE_DARK = '#a9a2c0';

export class Wharves {
  readonly group = new Group();
  /** Pennants on the terminal and the wharf heads; they stream with the wind on their own. */
  readonly flags: Group[] = [];

  constructor() {
    this.group.name = 'wharves';
    const planks = teak('#dca56a', '#c28553', 3);
    const cap = gel('#f6efe6', 0.6);
    const stone = matte(STONE, 0.9);
    const stoneDark = matte(STONE_DARK, 0.9);
    const piling = matte('#7b6150', 0.9);
    const iron = metal('#6b6580', 0.4);
    const fender = matte('#4b4560', 0.95);
    const wood = new PartBuilder();
    const pb = new PartBuilder();

    // ---- the bulkhead: a stone face with a timber cap, in runs between the wharves -----------------
    const wall = (x0: number, x1: number, z: number, nz: -1 | 1) => {
      const len = x1 - x0;
      if (len < 1) return;
      const cx = (x0 + x1) / 2;
      // the face stands a hair proud of the hard line so the terrain's shoulder never shows
      pb.box(stone, len, 5.2, 1.2, { pos: [cx, QUAY_TOP - 2.55, z + nz * -0.05] }, 0.05);
      wood.box(planks, len, 0.22, 1.5, { pos: [cx, QUAY_TOP + 0.02, z - nz * 0.15] }, 0.04);
      for (let x = x0 + 6; x < x1 - 3; x += 12) {
        pb.cyl(iron, 0.2, 0.26, 0.55, { pos: [x, QUAY_TOP + 0.35, z + nz * 1.2] }, 8);
        pb.sphere(iron, 0.27, { pos: [x, QUAY_TOP + 0.66, z + nz * 1.2] }, 8);
        pb.box(fender, 0.7, 0.9, 0.22, { pos: [x + 6, 0.35, z + nz * -0.5] }, 0.08);
      }
    };
    // runs of the south bulkhead between the wharves (skipping each wharf's width) and round the basin
    const piers = DOCKS.filter((d) => d.hx > 2).sort((a, b) => a.x - b.x);
    let x = -600;
    for (const d of piers) {
      wall(x, d.x - d.hx, TOWN_Z, -1);
      x = d.x + d.hx;
    }
    wall(x, NOTCH.x0, TOWN_Z, -1);
    wall(NOTCH.x1, 412, TOWN_Z, -1);
    // the basin: three walls (the closed end and both sides)
    pb.box(
      stone,
      NOTCH.x1 - NOTCH.x0 + 2,
      5.2,
      1.2,
      { pos: [(NOTCH.x0 + NOTCH.x1) / 2, QUAY_TOP - 2.55, NOTCH.z1 + 0.05] },
      0.05,
    );
    for (const sx of [NOTCH.x0 - 0.05, NOTCH.x1 + 0.05]) {
      pb.box(
        stone,
        1.2,
        5.2,
        NOTCH.z1 - NOTCH.z0,
        { pos: [sx, QUAY_TOP - 2.55, (NOTCH.z0 + NOTCH.z1) / 2] },
        0.05,
      );
    }
    wood.box(
      planks,
      NOTCH.x1 - NOTCH.x0,
      0.2,
      1.4,
      { pos: [(NOTCH.x0 + NOTCH.x1) / 2, QUAY_TOP + 0.02, NOTCH.z1 + 0.2] },
      0.04,
    );
    // west quay of the cove: a wall closing the harbour's south-west corner
    pb.box(stoneDark, 1.2, 5.2, 40, { pos: [-599.95, QUAY_TOP - 2.55, TOWN_Z - 20] }, 0.05);

    // ---- the wharves ------------------------------------------------------------------------------
    for (const d of DOCKS) {
      if (d.hx < 2) {
        // a floating finger pier: a narrow white float with a teak top, and cleats
        const top = 0.55;
        wood.box(planks, d.hx * 2, 0.12, d.hz * 2, { pos: [d.x, top, d.z] }, 0.03);
        pb.box(cap, d.hx * 2 + 0.2, 0.34, d.hz * 2 + 0.1, { pos: [d.x, top - 0.28, d.z] }, 0.08);
        for (let z = d.z - d.hz + 6; z < d.z + d.hz - 2; z += 9) {
          pb.cyl(iron, 0.05, 0.05, 0.18, { pos: [d.x, top + 0.14, z] }, 6);
        }
        // the piles that hold it
        for (const z of [d.z - d.hz + 1, d.z + d.hz - 1]) {
          pb.cyl(piling, 0.16, 0.19, 4.2, { pos: [d.x, -0.5, z] }, 8);
        }
        continue;
      }
      const y = QUAY_TOP;
      wood.box(planks, d.hx * 2, 0.5, d.hz * 2, { pos: [d.x, y - 0.26, d.z] }, 0.04);
      // the edge beams
      pb.box(cap, d.hx * 2 + 0.3, 0.34, 0.34, { pos: [d.x, y + 0.1, d.z - d.hz] }, 0.06);
      pb.box(cap, d.hx * 2 + 0.3, 0.34, 0.34, { pos: [d.x, y + 0.1, d.z + d.hz] }, 0.06);
      pb.box(cap, 0.34, 0.34, d.hz * 2, { pos: [d.x - d.hx, y + 0.1, d.z] }, 0.06);
      pb.box(cap, 0.34, 0.34, d.hz * 2, { pos: [d.x + d.hx, y + 0.1, d.z] }, 0.06);
      // pilings under the deck, outside the rail
      const nx = Math.max(2, Math.round((d.hx * 2) / 9));
      const nz = Math.max(2, Math.round((d.hz * 2) / 9));
      for (let i = 0; i <= nz; i++) {
        const z = d.z - d.hz + (d.hz * 2 * i) / nz;
        for (const sx of [-1, 1])
          pb.cyl(piling, 0.24, 0.3, 5.4, { pos: [d.x + sx * (d.hx + 0.1), -0.3, z] }, 8);
      }
      for (let i = 0; i <= nx; i++) {
        const xx = d.x - d.hx + (d.hx * 2 * i) / nx;
        pb.cyl(piling, 0.24, 0.3, 5.4, { pos: [xx, -0.3, d.z - d.hz - 0.1] }, 8);
      }
      // bollards and fenders along both long faces, lamps along the middle
      for (let z = d.z - d.hz + 7; z < d.z + d.hz - 3; z += 14) {
        for (const sx of [-1, 1]) {
          pb.cyl(iron, 0.22, 0.28, 0.6, { pos: [d.x + sx * (d.hx - 0.7), y + 0.35, z] }, 8);
          pb.sphere(iron, 0.3, { pos: [d.x + sx * (d.hx - 0.7), y + 0.7, z] }, 8);
          pb.box(fender, 0.26, 0.9, 0.9, { pos: [d.x + sx * (d.hx + 0.28), 0.25, z + 7] }, 0.1);
        }
      }
      for (let z = d.z - d.hz + 12; z < d.z + d.hz - 6; z += 30) {
        pb.cyl(iron, 0.07, 0.09, 4.2, { pos: [d.x, y + 2.1, z] }, 6);
        pb.sphere(bulb('#fff2c8', 8), 0.24, { pos: [d.x, y + 4.3, z] }, 8);
      }
      // the wharf head's pennant
      pb.cyl(metal('#eef2f6', 0.3), 0.04, 0.04, 6, { pos: [d.x, y + 3, d.z - d.hz + 3] }, 6);
      const f = makeFlag(1.8, 0.9, '#ff9a84', '#fff8ee', 3);
      f.position.set(d.x, y + 5.6, d.z - d.hz + 3);
      this.group.add(f);
      this.flags.push(f);
    }
    this.group.add(wood.build(), pb.build());

    // ---- the Steamship terminal on its wharf --------------------------------------------------------
    const bld = new PartBuilder();
    const white = gel('#fffaf3', 0.7);
    const coral = gel('#ff9f8a', 0.5);
    const glassy = gel('#2b3d56', 0.2);
    const steam = DOCKS[0]!;
    const sx = steam.x;
    const sz = steam.z + 30;
    bld.box(white, 70, 6.5, 22, { pos: [sx, QUAY_TOP + 3.4, sz] }, 0.5);
    bld.box(coral, 74, 1.0, 26, { pos: [sx, QUAY_TOP + 7.0, sz] }, 0.3);
    bld.box(gel('#8f8aa6', 0.5), 72, 0.4, 24, { pos: [sx, QUAY_TOP + 7.6, sz] }, 0.1);
    for (let i = -3; i <= 3; i++)
      bld.box(glassy, 7, 3, 0.14, { pos: [sx + i * 9.4, QUAY_TOP + 3.0, sz - 11.05] }, 0.04);
    bld.box(gel('#6fe6cc', 0.5), 70.2, 0.9, 22.2, { pos: [sx, QUAY_TOP + 1.2, sz] }, 0.2);
    // a clock tower on the terminal
    bld.box(white, 5, 11, 5, { pos: [sx + 24, QUAY_TOP + 12.5, sz] }, 0.3);
    bld.box(coral, 6, 1, 6, { pos: [sx + 24, QUAY_TOP + 18.4, sz] }, 0.2);
    bld.sphere(
      gel('#fff2c8', 0.4),
      1.6,
      { pos: [sx + 24, QUAY_TOP + 14.6, sz - 2.55], scale: [1, 1, 0.12] },
      12,
    );
    this.group.add(bld.build());

    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }
}
