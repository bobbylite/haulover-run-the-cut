// "Montauk Lady 46": an old-school inboard sportfisher. Cream topsides with a periwinkle sheer stripe and a
// coral boot, a high flared bow, a low teak cockpit with a fighting chair, a deckhouse under an open
// flybridge, and a tuna tower with outriggers.

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
import { PartBuilder, type V3 } from '../parts';

export interface CharterPaint {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  cushion: string;
  canvas: string;
}
export const CHARTER_PAINT: CharterPaint = {
  top: '#fff8ee',
  stripe: '#98aef0',
  boot: '#ff9a84',
  bottom: '#5d74c6',
  cushion: '#b9c9ff',
  canvas: '#cdd8ff',
};

export function buildCharter(spec: BoatSpec, paint: CharterPaint = CHARTER_PAINT): ModelParts {
  const o = hullOpts(spec);
  const shape = makeHullShape(
    o,
    { top: paint.top, stripe: paint.stripe, boot: paint.boot, bottom: paint.bottom, inner: '#f7f1e8' },
    {
      stripeFrom: 0.3,
      stripeTo: 0.46,
      deadrise: [0.2, 0.52],
      chine: [0.9, 0.5],
      keelFactor: 1.1,
      rake: 0.9,
    },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel(paint.top);
  const stripe = gel(paint.stripe, 0.34);
  const smoke = glass('#25405b');
  const cushion = matte(paint.cushion, 0.8);
  const awning = canvas(paint.canvas);
  const rail = metal('#e8edf2', 0.18);
  const wood = matte('#d49a5e', 0.7);
  const pb = new PartBuilder();

  const sAt = (x: number) => (x - o.xAft) / o.length;
  const deckAt = (x: number) => sheerAt(o, sAt(x)) - 0.1;
  const sole = spec.cockpit.soleY;
  const bulkX = spec.cockpit.x1;

  // ---- decks -----------------------------------------------------------------------------------------
  const main = new Mesh(
    hullStrip(shape, {
      s0: sAt(bulkX) - 0.005,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.1,
      camber: 0.1,
      inset: 0.0,
      steps: 26,
    }),
    white,
  );
  const cockpit = new Mesh(
    hullStrip(shape, { s0: 0.004, s1: sAt(bulkX), y: sole, inset: 0.03, steps: 8 }),
    teak('#dca36a', '#c28553', 9),
  );
  for (const m of [main, cockpit]) {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  // ---- rails: a teak cap along the sheer, chrome guard rails forward, rod holders in the cockpit ------
  for (const side of [-1, 1] as const) {
    pb.tube(wood, gunwaleLine(shape, side, 0.0, 0.99, 40, 0.03), 0.05);
    pb.tube(stripe, gunwaleLine(shape, side, 0.0, 0.99, 36, -0.24), 0.03);
    const rails = gunwaleLine(shape, side, 0.3, 0.96, 20, 0.6).map(
      ([x, y, z]) => [x, y, z * 0.92] as [number, number, number],
    );
    pb.tube(rail, rails, 0.02);
    for (let i = 0; i < rails.length; i += 3) {
      const p = rails[i] as V3;
      pb.rod(rail, [p[0], p[1] - 0.6, p[2]], p, 0.015, 6);
    }
    // five rod holders along each cockpit gunwale, canted outboard
    const holders = gunwaleLine(shape, side, 0.04, sAt(bulkX) - 0.02, 4, 0.04);
    for (const [x, y, z] of holders) {
      pb.rod(rail, [x, y - 0.06, z * 0.97], [x, y + 0.26, z * 1.05], 0.038, 8);
    }
  }
  // bow pulpit
  {
    const sB = 0.965;
    const [bx, by] = gunwaleLine(shape, 1, sB, sB, 1, 0.6)[0] as V3;
    pb.rod(rail, [bx - 0.9, by - 0.05, -0.55], [bx + 0.25, by + 0.05, 0], 0.022, 6);
    pb.rod(rail, [bx - 0.9, by - 0.05, 0.55], [bx + 0.25, by + 0.05, 0], 0.022, 6);
    pb.cyl(rail, 0.045, 0.045, 0.55, { pos: [bx + 0.05, by - 0.28, 0], rot: [0, 0, Math.PI / 2] });
  }
  // foredeck hatch + a samson post
  pb.box(wood, 0.9, 0.06, 0.8, { pos: [4.6, deckAt(4.6) + 0.05, 0] }, 0.02);
  pb.cyl(rail, 0.07, 0.09, 0.35, { pos: [5.6, deckAt(5.6) + 0.18, 0] }, 10);

  // ---- cockpit ---------------------------------------------------------------------------------------
  // full-width bulkhead the deckhouse stands on, so the step up from the cockpit reads as solid
  {
    const h = deckAt(bulkX) - sole + 0.1;
    const w = shape.beam * shape.planform(sAt(bulkX)) - 0.1;
    pb.box(white, 0.14, h, w, { pos: [bulkX + 0.07, sole + h / 2 - 0.02, 0] }, 0.03);
  }
  // fighting chair on a pedestal
  const cx = -5.55;
  pb.cyl(rail, 0.38, 0.4, 0.05, { pos: [cx, sole + 0.03, 0] }, 20);
  pb.cyl(rail, 0.085, 0.1, 0.55, { pos: [cx, sole + 0.3, 0] }, 12);
  pb.box(cushion, 0.62, 0.14, 0.58, { pos: [cx, sole + 0.64, 0] }, 0.07);
  pb.box(cushion, 0.12, 0.62, 0.56, { pos: [cx - 0.3, sole + 0.98, 0], rot: [0, 0, -0.12] }, 0.05);
  for (const z of [-0.34, 0.34]) {
    pb.rod(rail, [cx - 0.28, sole + 0.9, z], [cx + 0.22, sole + 0.9, z], 0.022, 6);
    pb.rod(rail, [cx + 0.22, sole + 0.9, z], [cx + 0.26, sole + 0.64, z], 0.022, 6);
  }
  pb.rod(rail, [cx + 0.34, sole + 0.2, -0.3], [cx + 0.34, sole + 0.2, 0.3], 0.022, 6);
  pb.cyl(rail, 0.045, 0.045, 0.3, { pos: [cx + 0.02, sole + 0.9, 0.0], rot: [0, 0, 0] }, 8);
  // engine hatches, a bait-rigging station and a fish box
  pb.box(wood, 1.3, 0.04, 1.0, { pos: [-4.4, sole + 0.03, -0.95] }, 0.02);
  pb.box(wood, 1.3, 0.04, 1.0, { pos: [-4.4, sole + 0.03, 0.95] }, 0.02);
  pb.box(white, 0.7, 0.72, 1.0, { pos: [bulkX + 0.62, sole + 0.36, 1.1] }, 0.08);
  pb.box(wood, 0.74, 0.05, 1.04, { pos: [bulkX + 0.62, sole + 0.75, 1.1] }, 0.02);
  pb.box(white, 0.7, 0.5, 0.9, { pos: [bulkX + 0.62, sole + 0.25, -1.1] }, 0.08);
  // stern: boarding platform, ensign staff
  pb.box(white, 0.7, 0.1, 3.4, { pos: [o.xAft - 0.36, 0.22, 0] }, 0.04);
  pb.box(wood, 0.62, 0.04, 3.3, { pos: [o.xAft - 0.36, 0.29, 0] }, 0.015);

  // ---- deckhouse ---------------------------------------------------------------------------------------
  const hx0 = bulkX + 0.2;
  const hx1 = 2.3;
  const hL = hx1 - hx0;
  const hC = (hx0 + hx1) / 2;
  const hW = 3.5;
  const hBase = deckAt(hx0) - 0.12;
  const hH = 1.62;
  const roofY = hBase + hH;
  pb.box(white, hL, hH, hW, { pos: [hC, hBase + hH / 2, 0] }, 0.3);
  // overhanging roof
  pb.box(white, hL + 0.3, 0.09, hW + 0.3, { pos: [hC + 0.05, roofY, 0] }, 0.04);
  pb.box(stripe, hL - 0.1, 0.06, hW + 0.34, { pos: [hC + 0.05, roofY - 0.1, 0] }, 0.02);
  // side windows: a long smoked band with white mullions
  for (const z of [-hW / 2 - 0.005, hW / 2 + 0.005]) {
    pb.box(smoke, hL - 1.4, 0.52, 0.04, { pos: [hC - 0.05, hBase + 1.0, z] }, 0.02);
    for (let i = 0; i <= 4; i++) {
      pb.box(
        white,
        0.07,
        0.56,
        0.06,
        { pos: [hC - 0.05 - (hL - 1.4) / 2 + ((hL - 1.4) * i) / 4, hBase + 1.0, z] },
        0.02,
      );
    }
  }
  // raked windscreen across the front of the house
  pb.box(smoke, 0.05, 0.7, hW - 0.5, { pos: [hx1 - 0.02, hBase + 1.0, 0], rot: [0, 0, -0.22] }, 0.02);
  for (const z of [-1.2, -0.4, 0.4, 1.2]) {
    pb.box(white, 0.07, 0.74, 0.07, { pos: [hx1 - 0.015, hBase + 1.0, z], rot: [0, 0, -0.22] }, 0.02);
  }
  // sliding door into the saloon: teak frame with a smoked glass pane
  pb.box(wood, 0.05, 1.42, 1.12, { pos: [hx0 - 0.02, deckAt(bulkX) + 0.7, 0] }, 0.02);
  pb.box(smoke, 0.04, 1.2, 0.9, { pos: [hx0 - 0.055, deckAt(bulkX) + 0.74, 0] }, 0.02);
  // radar dome on the forward roof
  pb.cyl(white, 0.3, 0.32, 0.16, { pos: [hx1 - 0.9, roofY + 0.14, 0] }, 20);
  pb.sphere(white, 0.3, { pos: [hx1 - 0.9, roofY + 0.2, 0], scale: [1, 0.55, 1] }, 18);

  // ---- flybridge ---------------------------------------------------------------------------------------
  const fbY = roofY + 0.06;
  const fx0 = bulkX + 0.5;
  const fx1 = 1.15;
  const fC = (fx0 + fx1) / 2;
  const fL = fx1 - fx0;
  const fW = 3.1;
  pb.box(white, fL, 0.1, fW, { pos: [fC, fbY + 0.05, 0] }, 0.04);
  // chrome rail and a low front console
  for (const z of [-fW / 2 + 0.05, fW / 2 - 0.05]) {
    pb.rod(rail, [fx0, fbY + 0.95, z], [fx1, fbY + 0.95, z], 0.024, 6);
    for (const x of [fx0, fC, fx1]) pb.rod(rail, [x, fbY + 0.1, z], [x, fbY + 0.95, z], 0.018, 6);
  }
  pb.rod(rail, [fx0, fbY + 0.95, -fW / 2 + 0.05], [fx0, fbY + 0.95, fW / 2 - 0.05], 0.024, 6);
  pb.box(white, 0.7, 0.62, 1.6, { pos: [fx1 - 0.55, fbY + 0.4, 0] }, 0.12);
  pb.box(smoke, 0.05, 0.46, 1.2, { pos: [fx1 - 0.2, fbY + 0.5, 0], rot: [0, 0, -0.5] }, 0.02);
  // wheel
  pb.torus(rail, 0.2, 0.025, { pos: [fx1 - 0.82, fbY + 0.78, 0], rot: [0, Math.PI / 2, -0.5] });
  // helm bench aft of the console
  pb.box(cushion, 0.5, 0.26, 1.7, { pos: [fx0 + 0.55, fbY + 0.28, 0] }, 0.09);
  pb.box(cushion, 0.1, 0.4, 1.7, { pos: [fx0 + 0.3, fbY + 0.55, 0] }, 0.04);
  // clear windscreen frame
  pb.box(smoke, 0.03, 0.46, fW - 1.0, { pos: [fx1 - 0.02, fbY + 0.78, 0], rot: [0, 0, -0.4] }, 0.015);
  for (const z of [-(fW - 1.0) / 2, 0, (fW - 1.0) / 2]) {
    pb.rod(rail, [fx1 - 0.2, fbY + 0.55, z], [fx1 + 0.0, fbY + 1.0, z], 0.016, 6);
  }

  // ---- tuna tower ---------------------------------------------------------------------------------------
  const tH = 3.2;
  const top = fbY + tH;
  const legs: [number, number][] = [
    [fx0 + 0.15, 1.4],
    [fx1 - 0.7, 1.4],
  ];
  const topXs: [number, number] = [fC - 0.35, fC + 0.25];
  for (let i = 0; i < 2; i++) {
    const [bx] = legs[i] as [number, number];
    const tx = topXs[i] as number;
    for (const s of [-1, 1]) {
      pb.rod(rail, [bx, fbY + 0.1, s * 1.45], [tx, top, s * 0.75], 0.04, 8);
    }
  }
  // cross-bracing and the spreader the outriggers bolt to
  pb.rod(rail, [topXs[0], top, -0.75], [topXs[1], top, -0.75], 0.03, 6);
  pb.rod(rail, [topXs[0], top, 0.75], [topXs[1], top, 0.75], 0.03, 6);
  const spreadY = fbY + 1.75;
  const spreadX = fC - 0.15;
  pb.rod(rail, [spreadX, spreadY, -2.05], [spreadX, spreadY, 2.05], 0.045, 8);
  pb.rod(rail, [legs[0]![0], fbY + 0.6, -1.4], [topXs[1], spreadY + 0.2, 0.9], 0.02, 6);
  pb.rod(rail, [legs[0]![0], fbY + 0.6, 1.4], [topXs[1], spreadY + 0.2, -0.9], 0.02, 6);
  // upper platform, rail, console and seat
  const tcx = (topXs[0] + topXs[1]) / 2;
  pb.box(white, 1.5, 0.09, 1.7, { pos: [tcx, top + 0.05, 0] }, 0.04);
  pb.box(wood, 1.4, 0.03, 1.6, { pos: [tcx, top + 0.11, 0] }, 0.012);
  for (const z of [-0.8, 0.8]) pb.rod(rail, [tcx - 0.7, top + 0.8, z], [tcx + 0.7, top + 0.8, z], 0.022, 6);
  pb.rod(rail, [tcx - 0.7, top + 0.8, -0.8], [tcx - 0.7, top + 0.8, 0.8], 0.022, 6);
  for (const x of [tcx - 0.7, tcx + 0.7]) {
    for (const z of [-0.8, 0.8]) pb.rod(rail, [x, top + 0.1, z], [x, top + 0.8, z], 0.018, 6);
  }
  pb.box(white, 0.45, 0.5, 0.8, { pos: [tcx + 0.4, top + 0.38, 0] }, 0.08);
  pb.box(cushion, 0.4, 0.14, 0.6, { pos: [tcx - 0.2, top + 0.2, 0] }, 0.05);
  pb.box(awning, 1.7, 0.05, 1.9, { pos: [tcx, top + 1.85, 0] }, 0.02);
  for (const x of [tcx - 0.78, tcx + 0.78]) {
    for (const z of [-0.88, 0.88]) pb.rod(rail, [x, top + 0.1, z], [x, top + 1.85, z], 0.018, 6);
  }
  // whip antennas
  pb.rod(rail, [fx0 + 0.1, fbY + 0.1, -fW / 2 + 0.2], [fx0 - 0.5, fbY + 2.8, -fW / 2 + 0.3], 0.01, 5);
  pb.rod(rail, [fx0 + 0.1, fbY + 0.1, fW / 2 - 0.2], [fx0 - 0.4, fbY + 3.1, fW / 2 - 0.3], 0.01, 5);

  // ---- outriggers: tapered poles from the spreader, with a stay down to the tower top ---------------------
  for (const s of [-1, 1]) {
    const base: V3 = [spreadX, spreadY + 0.05, s * 2.0];
    const mid: V3 = [spreadX - 1.5, spreadY + 2.6, s * 4.6];
    const tip: V3 = [spreadX - 3.1, spreadY + 5.0, s * 7.0];
    pb.rod(rail, base, mid, 0.04, 8);
    pb.rod(rail, mid, tip, 0.022, 6);
    pb.sphere(rail, 0.04, { pos: tip }, 6);
    pb.rod(rail, [topXs[0], top - 0.1, s * 0.75], tip, 0.007, 4);
    pb.cyl(rail, 0.07, 0.07, 0.14, { pos: base, rot: [Math.PI / 2, 0, 0] }, 10);
  }

  // ---- lights ---------------------------------------------------------------------------------------------
  navLights(
    pb,
    [hx1 - 0.15, roofY - 0.25, -hW / 2 - 0.06],
    [hx1 - 0.15, roofY - 0.25, hW / 2 + 0.06],
    [tcx, top + 2.0, 0],
  );
  root.add(pb.build());

  // national ensign on a staff at the starboard quarter; a club burgee at the masthead of the tower
  const spb = new PartBuilder();
  const f1 = addEnsign(spb, [o.xAft + 0.05, sheerAt(o, 0.01) + 0.05, 1.5], 1.5, 1.0);
  spb.rod(rail, [tcx, top + 1.85, 0], [tcx, top + 2.7, 0], 0.012, 6);
  const f2 = makeFlag(0.6, 0.3, paint.stripe, paint.top, 2);
  f2.position.set(tcx, top + 2.7, 0);
  root.add(spb.build(), f1, f2);

  return { group: root, engines: [], flags: [f1, f2] };
}
