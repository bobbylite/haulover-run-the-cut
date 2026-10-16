// "Muskeget 64": a harbour work tug. Coral hull, cream deckhouse and a lavender stack, rubber fenders all
// round, a push knee on the bow and a towing arch aft.

import { Group, Mesh } from 'three/webgpu';
import { sheerAt } from '../../../data/boats';
import type { BoatSpec } from '../../../sim/boatSpec';
import {
  addEnsign,
  hullMeshes,
  hullOpts,
  type ModelParts,
  makeFlag,
  makeHullShape,
  navLights,
} from '../common';
import { gunwaleLine, hullStrip } from '../loft';
import { gel, matte, metal } from '../materials';
import { PartBuilder } from '../parts';
import { deckHouse, funnel, mast } from './shipParts';

export interface TugPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  house: string;
  stack: string;
}
export const TUG_PAINT: TugPaint = {
  top: '#ff9a84',
  stripe: '#fff6e8',
  boot: '#fff6e8',
  bottom: '#6a5aa8',
  house: '#fff6ea',
  stack: '#c7b8ff',
};

export function buildTug(spec: BoatSpec, paint: TugPaint = TUG_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#f7f1e8' },
    {
      stripeFrom: 0.3,
      stripeTo: 0.44,
      deadrise: [0.1, 0.26],
      chine: [0.92, 0.6],
      keelFactor: 1.0,
      rake: 0.9,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const house = gel(paint.house, 0.6);
  const coral = gel(paint.top, 0.45);
  const stack = gel(paint.stack, 0.5);
  const rail = metal('#e8edf2', 0.18);
  const fender = matte('#4b4560', 0.95);
  const iron = metal('#6b6580', 0.4);
  const pb = new PartBuilder();
  const sAt = (x: number) => (x - o.xAft) / o.length;
  const deckAt = (x: number) => sheerAt(o, sAt(x)) - 0.1;

  const deck = new Mesh(
    hullStrip(shape, {
      s0: 0.02,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.1,
      camber: 0.06,
      inset: 0.0,
      steps: 22,
    }),
    gel('#d9d3e6', 0.7),
  );
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);

  // fenders: a rubber rubbing strake all round the sheer, and the push knee on the bow
  for (const side of [-1, 1] as const) {
    pb.tube(fender, gunwaleLine(shape, side, 0.0, 0.99, 30, 0.0), 0.2);
    pb.tube(rail, gunwaleLine(shape, side, 0.04, 0.97, 24, 0.55), 0.04);
  }
  pb.box(
    fender,
    0.9,
    1.3,
    3.4,
    { pos: [o.xAft + o.length - 0.5, deckAt(o.xAft + o.length - 0.5) - 0.2, 0] },
    0.3,
  );

  // deckhouse and wheelhouse
  const base = deckAt(-5.5) - 0.12;
  deckHouse(pb, house, {
    x0: -6.4,
    x1: 1.6,
    y0: base,
    y1: base + 2.5,
    width: 4.9,
    density: 0.5,
    trim: coral,
    band: 0.42,
    glass: '#2c4666',
  });
  deckHouse(pb, house, {
    x0: -3.6,
    x1: 0.7,
    y0: base + 2.5,
    y1: base + 4.4,
    width: 3.9,
    density: 0.9,
    trim: coral,
    band: 0.62,
    roundness: 0.2,
  });
  funnel(pb, [-4.9, base + 2.5, 0], 2.7, 0.95, 0.72, stack, coral);
  mast(pb, [-1.4, base + 4.4, 0], 3.2, 0.9);
  // foredeck: a towing winch, bollards and a samson post
  pb.cyl(iron, 0.55, 0.55, 0.7, { pos: [3.6, deckAt(3.6) + 0.35, 0], rot: [0, 0, Math.PI / 2] }, 12);
  for (const z of [-1.9, 1.9]) pb.cyl(iron, 0.17, 0.2, 0.55, { pos: [5.4, deckAt(5.4) + 0.3, z] }, 8);
  // aft: the towing arch and bitts
  for (const z of [-1.9, 1.9]) pb.rod(rail, [-7.4, deckAt(-7.4), z], [-7.4, deckAt(-7.4) + 2.4, z], 0.07, 6);
  pb.rod(rail, [-7.4, deckAt(-7.4) + 2.4, -1.9], [-7.4, deckAt(-7.4) + 2.4, 1.9], 0.07, 6);
  pb.cyl(iron, 0.22, 0.28, 0.6, { pos: [-6.7, deckAt(-6.7) + 0.3, 0] }, 8);
  navLights(pb, [0.45, base + 3.1, -2.0], [0.45, base + 3.1, 2.0], [-3.6, base + 4.5, 0]);
  root.add(pb.build());

  const spb = new PartBuilder();
  const f1 = addEnsign(spb, [o.xAft + 0.5, deckAt(o.xAft + 0.5), 1.5], 2.2, 1.0);
  const f2 = makeFlag(0.7, 0.35, paint.top, paint.stripe, 2);
  f2.position.set(-1.4, base + 7.7, 0);
  root.add(spb.build(), f1, f2);
  return { group: root, engines: [], flags: [f1, f2] };
}
