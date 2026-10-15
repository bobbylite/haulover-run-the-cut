// "Tiki Barge 24": sandbar party pontoon. Aqua tubes, white fence, thatched tiki hut, bunting.

import { Group } from 'three/webgpu';
import type { BoatSpec } from '../../../sim/boatSpec';
import { type ModelParts, makeFlag, navLights } from '../common';
import { bulb, canvas, flagMaterial, gel, matte, metal, teak } from '../materials';
import { PartBuilder, type V3 } from '../parts';

export function buildPontoon(spec: BoatSpec): ModelParts {
  const root = new Group();
  const tube = gel('#70e5e0', 0.28);
  const white = gel('#fffaf3');
  const dark = gel('#272f3d', 0.4);
  const bamboo = matte('#d9b57a', 0.7);
  const thatch = matte('#c99a55', 0.95);
  const cushion = matte('#ffd1c2', 0.8);
  const pb = new PartBuilder();

  // twin tubes with rounded noses
  for (const z of [-1.0, 1.0]) {
    pb.capsule(tube, 0.31, 5.7, { pos: [0.0, -0.02, z], rot: [0, 0, Math.PI / 2] });
    pb.cone(tube, 0.31, 0.7, { pos: [3.55, -0.02, z], rot: [0, 0, -Math.PI / 2] }, 18);
    pb.box(metal(), 0.16, 0.5, 0.06, { pos: [-0.5, 0.25, z * 1.0] });
  }
  // deck frame + planks
  pb.box(white, 7.2, 0.14, 2.7, { pos: [-0.1, 0.38, 0] }, 0.05);
  root.add(pb.build());

  const planks = new PartBuilder();
  planks.box(teak('#e3b27c', '#c9925e', 12), 7.0, 0.04, 2.5, { pos: [-0.1, 0.47, 0] }, 0.015);
  root.add(planks.build());

  const p2 = new PartBuilder();
  // fence rails
  const rl = (a: V3, b: V3) => p2.rod(white, a, b, 0.025, 8);
  const fy = 1.05;
  const x0 = -3.45;
  const x1 = 2.9;
  for (const z of [-1.28, 1.28]) {
    rl([x0, fy, z], [x1, fy, z]);
    rl([x0, 0.75, z], [x1, 0.75, z]);
    for (let x = x0; x <= x1 + 0.01; x += 0.64) rl([x, 0.47, z], [x, fy, z]);
  }
  rl([x0, fy, -1.28], [x0, fy, 1.28]);
  rl([x1, fy, -1.28], [x1, fy, 1.28]);
  rl([x1, 0.75, -1.28], [x1, 0.75, 1.28]);
  // bench seats
  for (const z of [-0.95, 0.95]) {
    p2.box(white, 3.2, 0.4, 0.5, { pos: [1.0, 0.66, z] }, 0.07);
    p2.box(cushion, 3.1, 0.1, 0.46, { pos: [1.0, 0.9, z] }, 0.04);
  }
  p2.box(white, 0.5, 0.4, 1.9, { pos: [-2.9, 0.66, 0] }, 0.07);
  p2.box(cushion, 0.45, 0.1, 1.85, { pos: [-2.9, 0.9, 0] }, 0.04);
  // helm console
  p2.box(white, 0.7, 0.8, 0.6, { pos: [2.3, 0.88, 0.7] }, 0.1);
  p2.box(dark, 0.4, 0.2, 0.55, { pos: [2.2, 1.34, 0.7], rot: [0, 0, -0.3] }, 0.04);
  p2.torus(dark, 0.11, 0.015, { pos: [2.1, 1.42, 0.7], rot: [0, Math.PI / 2, 0] });
  // tiki bar + hut
  p2.box(bamboo, 1.6, 0.8, 0.5, { pos: [-0.9, 0.9, -0.8] }, 0.07);
  p2.box(teak('#e3b27c', '#c9925e', 4), 1.7, 0.05, 0.6, { pos: [-0.9, 1.32, -0.8] }, 0.02);
  for (const [x, z] of [
    [-1.7, -1.1],
    [-1.7, 0.8],
    [0.0, -1.1],
    [0.0, 0.8],
  ] as const)
    p2.cyl(bamboo, 0.045, 0.05, 1.7, { pos: [x, 1.33, z] }, 8);
  p2.cone(thatch, 1.55, 1.1, { pos: [-0.85, 2.55, -0.15], rot: [0, 0.4, 0] }, 14);
  p2.cone(thatch, 1.2, 0.8, { pos: [-0.85, 3.05, -0.15] }, 14);
  p2.sphere(bamboo, 0.07, { pos: [-0.85, 3.5, -0.15] }, 8);
  // string lights under the hut
  const lights: V3[] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    lights.push([-1.7 + t * 1.7, 2.12 - Math.sin(t * Math.PI) * 0.1, -1.08]);
    lights.push([-1.7 + t * 1.7, 2.12 - Math.sin(t * Math.PI) * 0.1, 0.78]);
  }
  const palette = ['#ff8f7a', '#ffe08a', '#7ff0d0', '#ff9ccf'];
  for (const [i, p] of lights.entries()) p2.sphere(bulb(palette[i % 4]!, 7), 0.045, { pos: p }, 6);
  // outboard
  p2.box(dark, 0.5, 0.7, 0.4, { pos: [-3.95, 0.68, 0] }, 0.1);
  p2.cyl(dark, 0.08, 0.1, 0.8, { pos: [-3.95, 0.05, 0] });
  navLights(p2, [3.2, 0.8, -1.3], [3.2, 0.8, 1.3], [-3.95, 1.1, 0]);
  root.add(p2.build());

  // outboard lower unit steers
  const eng = new Group();
  const epb = new PartBuilder();
  epb.capsule(dark, 0.09, 0.3, { pos: [0.05, -0.6, 0], rot: [0, 0, Math.PI / 2] });
  epb.cyl(metal(), 0.18, 0.18, 0.02, { pos: [-0.2, -0.6, 0], rot: [0, 0, Math.PI / 2] });
  eng.add(epb.build());
  eng.position.set(-3.95, 0, 0);
  root.add(eng);

  // bunting string (flutters in the wind)
  const flags: Group[] = [];
  const cols = ['#ff8f7a', '#ffe08a', '#7ff0d0', '#ff9ccf', '#8fb8ff'];
  for (let i = 0; i < 5; i++) {
    const f = makeFlag(0.3, 0.26, cols[i]!, '#fffaf3', 1);
    f.position.set(1.2 + i * 0.45, 2.5 - Math.sin((i / 4) * Math.PI) * 0.12, 1.25);
    // bunting hangs on a line across the aft bench
    root.add(f);
    flags.push(f);
  }
  const pole = makeFlag(0.6, 0.35, '#ff8f7a', '#fffaf3', 3);
  pole.position.set(-0.85, 3.55, -0.15);
  root.add(pole);
  flags.push(pole);
  void flagMaterial;
  void canvas;
  return { group: root, engines: [eng], flags };
}
