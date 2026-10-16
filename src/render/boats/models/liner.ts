// "Grey Lady 380": a stylised cruise ship. White hull with a periwinkle sheer band and a coral boot, five tiers
// of cabin decks stepping in towards the bridge, bands of balconies in pastel, orange lifeboats, a big oval
// funnel and a pool deck on top.

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

export interface LinerPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  balcony: string[];
  funnel: string;
  band: string;
}
export const LINER_PAINT: LinerPaint = {
  top: '#fffdf8',
  stripe: '#a9b8f0',
  boot: '#ff8f7a',
  bottom: '#5d74c6',
  balcony: ['#ffb8a6', '#8fe0d6', '#c7b8ff'],
  funnel: '#fff6ea',
  band: '#ff8f7a',
};

export function buildLiner(spec: BoatSpec, paint: LinerPaint = LINER_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#f7f1e8' },
    {
      stripeFrom: 1.1,
      stripeTo: 2.6,
      deadrise: [0.06, 0.18],
      chine: [0.96, 0.7],
      keelFactor: 1.0,
      rake: 3.4,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel(paint.top, 0.6);
  const slate = gel('#d8d2e6', 0.6);
  const coral = gel(paint.band, 0.45);
  const body = gel(paint.funnel, 0.55);
  const rail = metal('#e8edf2', 0.18);
  const iron = metal('#6b6580', 0.4);
  const pool = gel('#6fe6d4', 0.25);
  const deckWood = gel('#e9c89a', 0.7);
  const sAt = (x: number) => (x - o.xAft) / o.length;
  const deckAt = (x: number) => sheerAt(o, sAt(x)) - 0.1;
  const pb = new PartBuilder();

  const deck = new Mesh(
    hullStrip(shape, {
      s0: 0.02,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.1,
      camber: 0.1,
      inset: 0.0,
      steps: 34,
    }),
    gel('#dcd6e8', 0.7),
  );
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);

  // rails and the rubbing strake along the sheer
  for (const side of [-1, 1] as const) {
    pb.tube(slate, gunwaleLine(shape, side, 0.0, 0.99, 36, -0.05), 0.2);
    railing(
      pb,
      rail,
      gunwaleLine(shape, side, 0.02, 0.97, 32, 0.0).map(
        ([x, y, z]) => [x, y, z * 0.97] as [number, number, number],
      ),
      1.1,
      2,
    );
  }

  // the cabin decks: each one shorter and narrower than the one below it
  const y0 = deckAt(-30) - 0.1;
  const tiers: { x0: number; x1: number; w: number; h: number }[] = [
    { x0: -40, x1: 46, w: 21.2, h: 3.0 },
    { x0: -36, x1: 42, w: 20.4, h: 3.0 },
    { x0: -32, x1: 38, w: 19.4, h: 3.0 },
    { x0: -28, x1: 33, w: 18.4, h: 3.0 },
  ];
  let y = y0;
  for (const [i, t] of tiers.entries()) {
    deckHouse(pb, white, {
      x0: t.x0,
      x1: t.x1,
      y0: y,
      y1: y + t.h,
      width: t.w,
      density: 0.4,
      trim: gel(paint.balcony[i % paint.balcony.length] as string, 0.5),
      band: 0.42,
      roundness: 0.5,
    });
    y += t.h;
  }
  // the bridge steps forward and out to the wings
  const yb = y;
  deckHouse(pb, white, {
    x0: 14,
    x1: 30,
    y0: yb - 3.0,
    y1: yb + 0.6,
    width: 20.6,
    density: 0.5,
    trim: coral,
    band: 0.6,
    roundness: 0.5,
  });
  // the sun deck: a pool, loungers and a windscreen, aft of the bridge
  deckHouse(pb, white, {
    x0: -22,
    x1: 12,
    y0: yb,
    y1: yb + 2.2,
    width: 15.6,
    density: 0.4,
    trim: gel(paint.balcony[2] as string, 0.5),
    band: 0.45,
    roundness: 0.4,
  });
  pb.box(deckWood, 30, 0.12, 13.6, { pos: [-5, yb + 2.26, 0] }, 0.05);
  pb.box(pool, 9, 0.16, 5.2, { pos: [-9, yb + 2.34, 0] }, 0.1);
  for (let i = 0; i < 6; i++) {
    for (const z of [-5.2, 5.2]) pb.box(coral, 1.8, 0.2, 0.7, { pos: [-18 + i * 2.6, yb + 2.5, z] }, 0.06);
  }
  funnel(pb, [-4, yb + 2.2, 0], 8.6, 4.6, 3.1, body, coral);
  mast(pb, [24, yb + 0.6, 0], 7, 3);
  lifeboats(pb, [-22, -12, -2, 8, 18, 28], y0 + 3.6, 9.4, 7.6, 1.0);
  // balcony stripes along the sides of the middle decks
  for (const [i, t] of tiers.entries()) {
    const c = gel(paint.balcony[i % paint.balcony.length] as string, 0.5);
    for (const sgn of [-1, 1]) {
      pb.box(
        c,
        t.x1 - t.x0 - 2,
        0.16,
        0.3,
        { pos: [(t.x0 + t.x1) / 2, y0 + i * 3.0 + 0.55, sgn * (t.w / 2 + 0.2)] },
        0.05,
      );
    }
  }
  // the foredeck: anchor winch, bollards and a mast for the flag; aft: mooring winches
  const fx = o.xAft + o.length - 8;
  pb.cyl(iron, 1.0, 1.0, 1.6, { pos: [fx, deckAt(fx) + 0.8, 0], rot: [0, 0, Math.PI / 2] }, 14);
  for (const z of [-6.5, 6.5]) {
    pb.cyl(iron, 0.34, 0.42, 1.0, { pos: [fx + 4, deckAt(fx + 4) + 0.5, z] }, 8);
    pb.cyl(iron, 0.34, 0.42, 1.0, { pos: [-50, deckAt(-50) + 0.5, z] }, 8);
  }
  navLights(pb, [29.5, yb + 0.4, -10.4], [29.5, yb + 0.4, 10.4], [24, yb + 7.8, 0]);
  root.add(pb.build());

  const spb = new PartBuilder();
  const f1 = addEnsign(spb, [o.xAft + 1.0, deckAt(o.xAft + 1.0) + 0.1, 5.5], 5, 2.4);
  const f2 = makeFlag(1.2, 0.6, paint.band, paint.top, 2);
  f2.position.set(24, yb + 7.9, 0);
  root.add(spb.build(), f1, f2);
  void matte;
  return { group: root, engines: [], flags: [f1, f2] };
}
