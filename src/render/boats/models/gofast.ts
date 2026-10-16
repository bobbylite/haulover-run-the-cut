// "Miami Vice 33": long, low, hot pink with aqua graphics, swept windscreen, twin outboards.

import { Group, Mesh } from 'three/webgpu';
import { sheerAt } from '../../../data/boats';
import type { BoatSpec } from '../../../sim/boatSpec';
import { addEnsign, hullMeshes, hullOpts, type ModelParts, makeHullShape, navLights } from '../common';
import { gunwaleLine, hullStrip } from '../loft';
import { gel, glass, matte, metal, teak } from '../materials';
import { PartBuilder } from '../parts';

export interface GoFastPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
}
export const GOFAST_PAINT: GoFastPaint = {
  top: '#ff86b4',
  stripe: '#fffdf8',
  boot: '#4fdfe6',
  bottom: '#1f9bb5',
};

export function buildGoFast(spec: BoatSpec, paint: GoFastPaint = GOFAST_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#fff1f6' },
    {
      stripeFrom: 0.22,
      stripeTo: 0.3,
      deadrise: [0.36, 0.78],
      chine: [0.8, 0.3],
      keelFactor: 1.35,
      rake: 0.5,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel('#fffaf6');
  const pink = gel(paint.top, 0.28);
  const aqua = gel(paint.boot, 0.3);
  const dark = gel('#252c3a', 0.35);
  const seat = matte('#fffaf6', 0.7);
  const pb = new PartBuilder();

  const foredeck = new Mesh(
    hullStrip(shape, {
      s0: 0.46,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.04,
      camber: 0.1,
      inset: 0.0,
      steps: 22,
    }),
    white,
  );
  const reardeck = new Mesh(
    hullStrip(shape, {
      s0: 0.0,
      s1: 0.06,
      y: (s) => sheerAt(o, s) - 0.05,
      camber: 0.04,
      inset: 0.0,
      steps: 4,
    }),
    white,
  );
  const sole = new Mesh(
    hullStrip(shape, { s0: 0.06, s1: 0.47, y: 0.1, inset: 0.1, steps: 14 }),
    teak('#e4b07a', '#cf9560'),
  );
  for (const m of [foredeck, reardeck]) {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }
  sole.receiveShadow = true;
  root.add(sole);

  for (const side of [-1, 1] as const) pb.tube(aqua, gunwaleLine(shape, side, 0.0, 0.99, 34, 0.02), 0.032);

  // pink racing stripe + engine hatch on the foredeck
  pb.box(pink, 3.7, 0.014, 0.42, { pos: [2.4, sheerAt(o, 0.75) + 0.07, 0] }, 0.005);
  pb.box(aqua, 3.6, 0.012, 0.1, { pos: [2.4, sheerAt(o, 0.75) + 0.075, 0] }, 0.004);
  // windscreen (swept) + dash
  pb.box(glass(), 0.05, 0.5, 1.85, { pos: [-0.45, 0.88, 0], rot: [0, 0, -0.78] }, 0.02);
  pb.box(dark, 0.55, 0.28, 1.5, { pos: [-0.95, 0.5, 0] }, 0.08);
  pb.box(white, 0.5, 0.1, 1.62, { pos: [-0.3, 0.62, 0] }, 0.03);
  // bucket seats
  for (const z of [-0.45, 0.45]) {
    pb.box(seat, 0.5, 0.18, 0.5, { pos: [-2.3, 0.28, z] }, 0.07);
    pb.box(seat, 0.1, 0.6, 0.5, { pos: [-2.55, 0.58, z], rot: [0, 0, 0.2] }, 0.05);
  }
  pb.box(pink, 0.45, 0.2, 1.7, { pos: [-3.6, 0.28, 0] }, 0.07);
  // engine cover
  pb.box(pink, 0.8, 0.12, 1.5, { pos: [-4.4, 0.55, 0] }, 0.04);
  pb.rod(metal(), [-0.62, 1.12, -0.88], [-0.28, 0.66, -0.88], 0.014);
  pb.rod(metal(), [-0.62, 1.12, 0.88], [-0.28, 0.66, 0.88], 0.014);
  navLights(pb, [3.6, sheerAt(o, 0.88) + 0.04, -0.4], [3.6, sheerAt(o, 0.88) + 0.04, 0.4], [-4.7, 0.9, 0]);
  pb.rod(metal(), [-4.7, 0.55, 0], [-4.7, 0.95, 0], 0.012);
  root.add(pb.build());

  // twin outboards
  const engines: Group[] = [];
  for (const z of [-0.58, 0.58]) {
    const eng = new Group();
    const epb = new PartBuilder();
    epb.box(dark, 0.62, 0.8, 0.46, { pos: [0.08, 0.6, 0] }, 0.13);
    epb.box(pink, 0.42, 0.06, 0.47, { pos: [0.08, 0.7, 0] }, 0.02);
    epb.box(aqua, 0.5, 0.05, 0.47, { pos: [0.08, 0.5, 0] }, 0.02);
    epb.cyl(dark, 0.1, 0.12, 1.0, { pos: [0.12, -0.2, 0] });
    epb.capsule(dark, 0.1, 0.38, { pos: [0.14, -0.78, 0], rot: [0, 0, Math.PI / 2] });
    epb.cyl(metal(), 0.22, 0.22, 0.02, { pos: [-0.2, -0.78, 0], rot: [0, 0, Math.PI / 2] });
    eng.add(epb.build());
    eng.position.set(-5.0, 0, z);
    root.add(eng);
    engines.push(eng);
  }

  // national ensign on a stern staff between the outboards
  const spb = new PartBuilder();
  const ensign = addEnsign(spb, [-4.82, 0.5, 0], 1.15, 0.78);
  root.add(spb.build(), ensign);

  return { group: root, engines, flags: [ensign] };
}
