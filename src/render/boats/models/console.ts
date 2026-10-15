// "Sea Hornet 24": the classic Haulover center-console. White hull, mint sheer stripe, coral boot-top,
// aqua T-top, one big outboard.

import { Group, Mesh } from 'three/webgpu';
import { sheerAt } from '../../../data/boats';
import type { BoatSpec } from '../../../sim/boatSpec';
import { hullMeshes, hullOpts, type ModelParts, makeFlag, makeHullShape, navLights } from '../common';
import { gunwaleLine, hullStrip } from '../loft';
import { canvas, gel, glass, matte, metal, teak } from '../materials';
import { PartBuilder } from '../parts';

export interface ConsolePaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  inner: string;
  canvas: string;
  cushion: string;
}
export const CONSOLE_PAINT: ConsolePaint = {
  top: '#fcfbf6',
  stripe: '#6fe6cc',
  boot: '#ff8f7a',
  bottom: '#33b3c6',
  inner: '#f4efe4',
  canvas: '#84e8dd',
  cushion: '#8be9df',
};

export function buildConsole(spec: BoatSpec, paint: ConsolePaint = CONSOLE_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: paint.inner },
    { stripeFrom: 0.28, stripeTo: 0.4 },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel(paint.top);
  const mint = gel(paint.stripe, 0.34);
  const aqua = canvas(paint.canvas);
  const dark = gel('#2b3341', 0.38);
  const cushion = matte(paint.cushion, 0.8);
  const pb = new PartBuilder();

  // foredeck + teak sole
  const deck = new Mesh(
    hullStrip(shape, {
      s0: 0.62,
      s1: 0.992,
      y: (s) => sheerAt(o, s) - 0.06,
      camber: 0.07,
      inset: 0.0,
      steps: 18,
    }),
    white,
  );
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);
  const sole = new Mesh(hullStrip(shape, { s0: 0.035, s1: 0.64, y: 0.12, inset: 0.11, steps: 16 }), teak());
  sole.receiveShadow = true;
  root.add(sole);

  // gunwale rub-rails
  for (const side of [-1, 1] as const) {
    pb.tube(mint, gunwaleLine(shape, side, 0.0, 0.985, 30, 0.02), 0.038);
  }

  // console
  pb.box(white, 1.0, 0.95, 0.92, { pos: [0.4, 0.6, 0] }, 0.14);
  pb.box(dark, 0.5, 0.18, 0.86, { pos: [0.62, 1.12, 0], rot: [0, 0, -0.32] }, 0.05);
  pb.box(glass(), 0.05, 0.56, 0.84, { pos: [0.86, 1.5, 0], rot: [0, 0, -0.34] }, 0.02);
  pb.rod(metal(), [0.8, 1.2, -0.43], [0.93, 1.78, -0.43], 0.016);
  pb.rod(metal(), [0.8, 1.2, 0.43], [0.93, 1.78, 0.43], 0.016);
  pb.rod(metal(), [0.93, 1.78, -0.43], [0.93, 1.78, 0.43], 0.016);
  // leaning post + seat
  pb.box(white, 0.55, 0.88, 1.0, { pos: [-0.75, 0.56, 0] }, 0.1);
  pb.box(cushion, 0.5, 0.14, 0.92, { pos: [-0.75, 1.08, 0] }, 0.05);
  // fore seat / cooler
  pb.box(white, 0.9, 0.5, 1.25, { pos: [1.95, 0.37, 0] }, 0.1);
  pb.box(cushion, 0.82, 0.1, 1.15, { pos: [1.95, 0.66, 0] }, 0.04);
  // T-top
  for (const x of [1.15, -0.75]) {
    for (const z of [-0.93, 0.93]) pb.rod(metal('#f2f5f8'), [x, 0.5, z], [x, 2.26, z], 0.026, 8);
  }
  pb.box(white, 2.1, 0.07, 2.25, { pos: [0.2, 2.3, 0] }, 0.03);
  pb.box(aqua, 1.96, 0.05, 2.1, { pos: [0.2, 2.35, 0] }, 0.02);
  for (let i = 0; i < 5; i++) {
    const z = -0.84 + i * 0.42;
    pb.rod(metal(), [-0.9, 2.28, z], [-1.15, 2.72, z], 0.018);
  }
  pb.rod(metal(), [-0.6, 2.3, 0.6], [-0.7, 3.5, 0.6], 0.011);
  // transom bracket
  pb.box(dark, 0.22, 0.55, 0.5, { pos: [-3.86, 0.34, 0] }, 0.05);
  // bow cleats + pulpit
  pb.box(metal(), 0.22, 0.03, 0.05, { pos: [3.0, 0.97, 0] });
  // nav lights
  navLights(
    pb,
    [2.7, sheerAt(o, 0.88) + 0.04, -0.62],
    [2.7, sheerAt(o, 0.88) + 0.04, 0.62],
    [-0.7, 3.5, 0.6],
  );

  root.add(pb.build());

  // steering wheel
  const wheel = new Group();
  const wpb = new PartBuilder();
  wpb.torus(dark, 0.13, 0.018, { rot: [0, Math.PI / 2, 0] });
  wpb.cyl(metal(), 0.02, 0.02, 0.14, { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    wpb.rod(metal(), [0, 0, 0], [0, Math.cos(a) * 0.13, Math.sin(a) * 0.13], 0.01);
  }
  wheel.add(wpb.build(false));
  wheel.position.set(0.68, 1.3, 0);
  root.add(wheel);

  // outboard
  const eng = new Group();
  const epb = new PartBuilder();
  epb.box(dark, 0.58, 0.82, 0.44, { pos: [0.05, 0.62, 0] }, 0.12);
  epb.box(mint, 0.4, 0.05, 0.452, { pos: [0.05, 0.7, 0] }, 0.02);
  epb.cyl(dark, 0.1, 0.12, 0.95, { pos: [0.1, -0.15, 0] });
  epb.capsule(dark, 0.1, 0.34, { pos: [0.12, -0.7, 0], rot: [0, 0, Math.PI / 2] });
  epb.cyl(metal(), 0.2, 0.2, 0.02, { pos: [-0.2, -0.7, 0], rot: [0, 0, Math.PI / 2] });
  eng.add(epb.build());
  eng.position.set(-3.9, 0, 0);
  root.add(eng);

  // pennant on the antenna
  const flag = makeFlag(0.55, 0.28, paint.boot, paint.top, 2);
  flag.position.set(-0.7, 3.35, 0.6);
  root.add(flag);

  return { group: root, engines: [eng], flags: [flag], wheel };
}
