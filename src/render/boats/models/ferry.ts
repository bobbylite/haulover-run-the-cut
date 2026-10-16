// "Islander 150": the island ferry. Cream hull with an aqua band and a coral boot, a long saloon deck under
// a shorter upper deck, a wide wheelhouse, a tall funnel and a bow door.

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
import { deckHouse, funnel, lifeboats, mast, railing } from './shipParts';

export interface FerryPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  funnel: string;
  band: string;
}
export const FERRY_PAINT: FerryPaint = {
  top: '#fff8ee',
  stripe: '#8fd0e6',
  boot: '#ff9a84',
  bottom: '#3d6fb0',
  funnel: '#fff8ee',
  band: '#ff9a84',
};

export function buildFerry(spec: BoatSpec, paint: FerryPaint = FERRY_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#f7f1e8' },
    {
      stripeFrom: 0.5,
      stripeTo: 0.95,
      deadrise: [0.08, 0.22],
      chine: [0.95, 0.65],
      keelFactor: 1.0,
      rake: 2.2,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel(paint.top, 0.6);
  const accent = gel(paint.stripe, 0.5);
  const coral = gel(paint.band, 0.45);
  const body = gel(paint.funnel, 0.55);
  const rail = metal('#e8edf2', 0.18);
  const iron = metal('#6b6580', 0.4);
  const dark = matte('#4b4560', 0.9);
  const sAt = (x: number) => (x - o.xAft) / o.length;
  const deckAt = (x: number) => sheerAt(o, sAt(x)) - 0.1;
  const pb = new PartBuilder();

  const deck = new Mesh(
    hullStrip(shape, {
      s0: 0.02,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.1,
      camber: 0.08,
      inset: 0.0,
      steps: 26,
    }),
    gel('#dcd6e8', 0.7),
  );
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);

  // rails along the weather deck and a rubbing strake
  for (const side of [-1, 1] as const) {
    pb.tube(dark, gunwaleLine(shape, side, 0.0, 0.99, 34, -0.1), 0.17);
    railing(
      pb,
      rail,
      gunwaleLine(shape, side, 0.02, 0.97, 30, 0.0).map(
        ([x, y, z]) => [x, y, z * 0.97] as [number, number, number],
      ),
      1.0,
      2,
    );
  }

  // passenger saloon, upper deck and wheelhouse
  const base = deckAt(-14) - 0.15;
  deckHouse(pb, white, {
    x0: -15,
    x1: 14,
    y0: base,
    y1: base + 3.2,
    width: 9.6,
    density: 0.55,
    trim: accent,
    band: 0.5,
  });
  deckHouse(pb, white, {
    x0: -11,
    x1: 8,
    y0: base + 3.2,
    y1: base + 5.8,
    width: 8.6,
    density: 0.55,
    trim: accent,
    band: 0.5,
  });
  deckHouse(pb, white, {
    x0: 0.5,
    x1: 8,
    y0: base + 5.8,
    y1: base + 7.8,
    width: 9.8,
    density: 0.9,
    trim: coral,
    band: 0.62,
    roundness: 0.3,
  });
  funnel(pb, [-4.6, base + 5.8, 0], 5.2, 2.1, 1.6, body, coral);
  mast(pb, [4.6, base + 7.8, 0], 5, 1.6);
  lifeboats(pb, [-8, -1], base + 4.2, 4.6, 6, 0.8);
  // bow door and foredeck gear
  pb.box(
    gel('#f2ece3', 0.6),
    0.5,
    3.2,
    7.4,
    { pos: [o.xAft + o.length - 4.2, deckAt(o.xAft + o.length - 4.2) + 1.6, 0] },
    0.2,
  );
  for (const z of [-4, 4]) pb.cyl(iron, 0.28, 0.34, 0.8, { pos: [17.5, deckAt(17.5) + 0.4, z] }, 8);
  pb.cyl(iron, 0.7, 0.7, 1.0, { pos: [20, deckAt(20) + 0.5, 0], rot: [0, 0, Math.PI / 2] }, 12);
  navLights(pb, [8.1, base + 6.3, -4.9], [8.1, base + 6.3, 4.9], [4.6, base + 13.0, 0]);
  root.add(pb.build());

  const spb = new PartBuilder();
  const f1 = addEnsign(spb, [o.xAft + 0.6, deckAt(o.xAft + 0.6) + 0.1, 3.2], 3.4, 1.6);
  const f2 = makeFlag(0.9, 0.45, paint.band, paint.top, 2);
  f2.position.set(4.6, base + 13.2, 0);
  root.add(spb.build(), f1, f2);
  return { group: root, engines: [], flags: [f1, f2] };
}
