// "Sunset 42": flybridge sport yacht. White hull, peach stripe, smoked glass, peach bimini, teak aft deck.

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
import { canvas, gel, glass, matte, metal, teak } from '../materials';
import { PartBuilder } from '../parts';

export interface CruiserPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  bimini: string;
  cushion: string;
}
export const CRUISER_PAINT: CruiserPaint = {
  top: '#fffaf3',
  stripe: '#ffb497',
  boot: '#3b9fb5',
  bottom: '#2b7f96',
  bimini: '#ffcdb2',
  cushion: '#ffd9c4',
};

export function buildCruiser(spec: BoatSpec, paint: CruiserPaint = CRUISER_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#f7f1e8' },
    {
      stripeFrom: 0.28,
      stripeTo: 0.5,
      deadrise: [0.22, 0.5],
      chine: [0.9, 0.5],
      keelFactor: 1.12,
      rake: 0.55,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel(paint.top);
  const peach = gel(paint.stripe, 0.34);
  const smoke = glass('#25405b');
  const bimini = canvas(paint.bimini);
  const cushion = matte(paint.cushion, 0.8);
  const rail = metal('#e8edf2', 0.18);
  const wood = matte('#d49a5e', 0.7);
  const pb = new PartBuilder();

  // decks
  const main = new Mesh(
    hullStrip(shape, {
      s0: 0.21,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.1,
      camber: 0.1,
      inset: 0.0,
      steps: 26,
    }),
    white,
  );
  const aft = new Mesh(
    hullStrip(shape, { s0: 0.03, s1: 0.215, y: 0.5, inset: 0.12, steps: 8 }),
    teak('#dca36a', '#c28553', 8),
  );
  for (const m of [main, aft]) {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  // hull rail + stripe along the gunwale
  for (const side of [-1, 1] as const) {
    pb.tube(peach, gunwaleLine(shape, side, 0.0, 0.99, 36, 0.02), 0.05);
    // stainless guard rail with stanchions on the side decks
    const pts = gunwaleLine(shape, side, 0.24, 0.97, 22, 0.7).map(
      ([x, y, z]) => [x, y, z * 0.9] as [number, number, number],
    );
    pb.tube(rail, pts, 0.022);
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i]!;
      pb.rod(rail, [p[0], p[1] - 0.7, p[2]], p, 0.016, 6);
    }
  }

  // main cabin
  const deckY = sheerAt(o, 0.5) - 0.1;
  pb.box(white, 7.0, 1.4, 3.2, { pos: [-0.1, deckY + 0.7, 0] }, 0.34);
  // dark glass windows, both sides + windscreen
  for (const z of [-1.61, 1.61]) pb.box(smoke, 5.4, 0.44, 0.04, { pos: [-0.2, deckY + 0.85, z] }, 0.02);
  pb.box(smoke, 0.05, 0.62, 2.6, { pos: [3.4, deckY + 1.15, 0], rot: [0, 0, -0.55] }, 0.02);
  pb.box(peach, 6.8, 0.07, 3.24, { pos: [-0.1, deckY + 0.3, 0] }, 0.02);
  // flybridge
  const fbY = deckY + 1.42;
  pb.box(white, 3.4, 0.9, 2.9, { pos: [0.5, fbY + 0.45, 0] }, 0.26);
  pb.box(smoke, 0.05, 0.6, 2.6, { pos: [2.2, fbY + 1.15, 0], rot: [0, 0, -0.32] }, 0.02);
  pb.box(cushion, 0.7, 0.3, 1.0, { pos: [0.6, fbY + 1.0, 0] }, 0.08);
  for (const x of [2.1, -1.2]) {
    for (const z of [-1.4, 1.4]) pb.rod(rail, [x, fbY + 0.9, z], [x, fbY + 2.5, z], 0.03, 8);
  }
  pb.box(bimini, 3.8, 0.07, 3.3, { pos: [0.45, fbY + 2.52, 0] }, 0.03);
  pb.box(white, 3.9, 0.05, 3.4, { pos: [0.45, fbY + 2.47, 0] }, 0.02);
  // radar arch
  for (const z of [-1.2, 1.2]) pb.rod(rail, [-2.0, fbY + 0.6, z], [-2.0, fbY + 3.0, z], 0.04, 8);
  pb.rod(rail, [-2.0, fbY + 3.0, -1.2], [-2.0, fbY + 3.0, 1.2], 0.04, 8);
  pb.cyl(white, 0.34, 0.3, 0.2, { pos: [-2.0, fbY + 3.15, 0] }, 18);
  pb.rod(rail, [-2.0, fbY + 3.25, 0], [-2.0, fbY + 4.1, 0], 0.012);
  // aft cockpit furniture
  pb.box(cushion, 0.6, 0.32, 2.4, { pos: [-5.6, 0.7, 0] }, 0.1);
  pb.box(white, 0.55, 0.32, 0.5, { pos: [-4.0, 0.64, -1.3] }, 0.08);
  pb.box(white, 0.55, 0.32, 0.5, { pos: [-4.0, 0.64, 1.3] }, 0.08);
  // swim platform + transom
  pb.box(white, 1.1, 0.12, 3.5, { pos: [-6.8, 0.2, 0] }, 0.05);
  pb.box(wood, 1.0, 0.04, 3.4, { pos: [-6.8, 0.27, 0] }, 0.015);
  // anchor roller + bow hardware
  pb.cyl(rail, 0.05, 0.05, 0.5, { pos: [6.1, deckY + 0.25, 0], rot: [0, 0, Math.PI / 2] });
  navLights(
    pb,
    [4.5, sheerAt(o, 0.85) + 0.05, -1.0],
    [4.5, sheerAt(o, 0.85) + 0.05, 1.0],
    [-2.0, fbY + 4.1, 0],
  );
  root.add(pb.build());

  // national ensign on a stern staff over the swim platform; a club burgee on the radar arch
  const spb = new PartBuilder();
  const f1 = addEnsign(spb, [-6.75, 1.0, 0.0], 1.45, 1.0);
  const f2 = makeFlag(0.5, 0.26, '#3b9fb5', '#fffaf3', 2);
  f2.position.set(-2.0, fbY + 4.1, 0);
  root.add(spb.build(), f1, f2);

  return { group: root, engines: [], flags: [f1, f2] };
}
