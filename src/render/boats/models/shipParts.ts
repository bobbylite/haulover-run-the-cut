// Pieces shared by the ship models: window bands, railings, lifeboats, funnels and masts.

import { BoxGeometry, CylinderGeometry } from 'three/webgpu';
import { gel, matte, metal, windowBand } from '../materials';
import type { PartBuilder, V3 } from '../parts';

/** A box with `n` windows along each long side (z faces) and the ends left plain. */
export function deckHouse(
  pb: PartBuilder,
  hull: ReturnType<typeof gel>,
  opts: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    /** Full width of the box (m). */
    width: number;
    /** Windows per metre along the side. */
    density?: number;
    trim?: ReturnType<typeof gel>;
    roundness?: number;
    /** Window band as a fraction of the box height, centred. */
    band?: number;
    frame?: string;
    glass?: string;
  },
): void {
  const L = opts.x1 - opts.x0;
  const H = opts.y1 - opts.y0;
  const cx = (opts.x0 + opts.x1) / 2;
  const cy = (opts.y0 + opts.y1) / 2;
  pb.box(hull, L, H, opts.width, { pos: [cx, cy, 0] }, opts.roundness ?? Math.min(0.5, H * 0.2));
  if (opts.trim) pb.box(opts.trim, L + 0.2, 0.3, opts.width + 0.2, { pos: [cx, opts.y1 - 0.15, 0] }, 0.1);
  const band = (opts.band ?? 0.5) * H;
  const n = Math.max(2, Math.round(L * (opts.density ?? 0.42)));
  const wm = windowBand(n, opts.frame, opts.glass);
  for (const sgn of [-1, 1]) {
    pb.add(new BoxGeometry(L - 1.2, band, 0.06), wm, {
      pos: [cx, cy + H * 0.04, sgn * (opts.width / 2 + 0.03)],
    });
  }
}

/** A rail along a polyline of points with stanchions every few metres. */
export function railing(
  pb: PartBuilder,
  rail: ReturnType<typeof metal>,
  pts: V3[],
  height: number,
  every = 3,
): void {
  const top = pts.map(([x, y, z]) => [x, y + height, z] as V3);
  pb.tube(rail, top, 0.03);
  for (let i = 0; i < pts.length; i += every) {
    const p = pts[i] as V3;
    pb.rod(rail, p, [p[0], p[1] + height, p[2]], 0.025, 5);
  }
}

/** A pair of orange lifeboats on davits, one each side, spaced along x. */
export function lifeboats(
  pb: PartBuilder,
  xs: number[],
  y: number,
  half: number,
  length = 7,
  r = 0.95,
): void {
  const orange = gel('#ffb36b', 0.45);
  const white = gel('#fffaf3', 0.6);
  for (const x of xs) {
    for (const sgn of [-1, 1]) {
      pb.capsule(orange, r, length - r * 2, { pos: [x, y, sgn * half], rot: [0, 0, Math.PI / 2] });
      pb.box(white, length * 0.7, 0.14, 0.4, { pos: [x, y + r - 0.05, sgn * half] }, 0.05);
    }
  }
}

/** A tall oval funnel with a coloured band and a dark cap, slightly raked. */
export function funnel(
  pb: PartBuilder,
  at: V3,
  height: number,
  rx: number,
  rz: number,
  body: ReturnType<typeof gel>,
  band: ReturnType<typeof gel>,
): void {
  const [x, y, z] = at;
  const rake = -0.1;
  pb.add(new CylinderGeometry(1, 1, height, 20, 1), body, {
    pos: [x, y + height / 2, z],
    rot: [0, 0, rake],
    scale: [rx, 1, rz],
  });
  pb.add(new CylinderGeometry(1.02, 1.02, height * 0.22, 20, 1), band, {
    pos: [x - height * 0.5 * 0.1 * 0.8, y + height * 0.62, z],
    rot: [0, 0, rake],
    scale: [rx, 1, rz],
  });
  pb.add(new CylinderGeometry(1.04, 1.04, height * 0.09, 20, 1), matte('#4b4560', 0.7), {
    pos: [x - height * 0.5 * 0.1 * 1.9, y + height * 0.96, z],
    rot: [0, 0, rake],
    scale: [rx, 1, rz],
  });
}

/** A mast with a yardarm, a radar bar and a masthead light. */
export function mast(pb: PartBuilder, at: V3, height: number, spread: number): void {
  const m = metal('#eef2f6', 0.3);
  const [x, y, z] = at;
  pb.rod(m, [x, y, z], [x, y + height, z], 0.07, 6);
  pb.rod(m, [x, y + height * 0.7, z - spread], [x, y + height * 0.7, z + spread], 0.045, 5);
  pb.box(gel('#fffaf3', 0.5), 0.5, 0.18, spread * 1.4, { pos: [x, y + height * 0.86, z] }, 0.05);
}
