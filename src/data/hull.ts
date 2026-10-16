// The hull generator shared by every vessel: a planform plus a handful of physical numbers becomes the
// buoyancy-sample cloud, the weirs (gunwale overflow points) and the bumpers the physics runs on.

import { smoothstep } from '../core/math';
import type { Bumper, HullSample, Weir } from '../sim/boatSpec';
import { GRAVITY } from '../sim/waves';

export interface HullOpts {
  length: number;
  beam: number;
  /** local x of the transom. */
  xAft: number;
  mass: number;
  draft: number;
  planform: (s: number) => number;
  lateral: number[];
  nx: number;
  rocker: number;
  rockerStart: number;
  freeboard: number;
  sheerBow: number;
  sheerStern: number;
  cgY: number;
  /** shifts CG aft(-)/fwd(+) of the centre of buoyancy (m). */
  trimBias: number;
  dragX: number;
  dragZ: number;
  hump: { speed: number; width: number; gain: number };
  /** s of the planing centre of pressure (0 = transom). */
  cpS: number;
  weirScale: number;
  heaveZeta: number;
  flare: number;
  /** Long hulls: bumpers per side along the length (default: the small-boat set of five stations). */
  bumperCount?: number;
  /** Radius of each bumper (m); default 0.5. */
  bumperR?: number;
}

export const sheerAt = (o: HullOpts, s: number): number =>
  o.freeboard + o.sheerBow * s ** 2.2 + o.sheerStern * (1 - s) ** 3;

export function buildHull(o: HullOpts) {
  const nx = o.nx;
  const raw: { x: number; z: number; a: number; yBot: number; s: number }[] = [];
  for (let i = 0; i < nx; i++) {
    const s = (i + 0.5) / nx;
    const x = o.xAft + s * o.length;
    const hb = o.planform(s) * (o.beam / 2);
    const dx = o.length / nx;
    for (const lat of o.lateral) {
      const z = lat * hb;
      const a = dx * ((2 * hb) / o.lateral.length);
      const yBot = -o.draft + o.rocker * smoothstep(o.rockerStart, 1.0, s) ** 1.6;
      raw.push({ x, z, a, yBot, s });
    }
  }
  // stiffness: sum(k_i * immersion_i) = m g at the design waterline (y = 0)
  let wetSum = 0;
  let momentSum = 0;
  for (const r of raw) {
    const imm = Math.max(0, -r.yBot);
    const eff = imm * (1 + o.flare * imm);
    wetSum += r.a * eff;
    momentSum += r.a * eff * r.x;
  }
  const kScale = (o.mass * GRAVITY) / wetSum;
  const xCob = momentSum / wetSum;
  let kTotal = 0;
  for (const r of raw) kTotal += kScale * r.a;
  const cTotal = 2 * o.heaveZeta * Math.sqrt(kTotal * o.mass);

  // planing lift weights (aft biased) and drag shares
  let liftNorm = 0;
  const liftW = raw.map((r) => {
    const w = Math.exp(-(((r.s - o.cpS) / 0.3) ** 2));
    liftNorm += w;
    return w;
  });
  let areaSum = 0;
  for (const r of raw) areaSum += r.a;

  const samples: HullSample[] = raw.map((r, i) => {
    const k = kScale * r.a;
    return {
      x: r.x,
      y: r.yBot,
      z: r.z,
      k,
      c: (cTotal * k) / kTotal,
      cell: Math.max(0.2, sheerAt(o, r.s) - r.yBot),
      lift: (liftW[i] as number) / liftNorm,
      dragX: (o.dragX * r.a) / areaSum,
      dragZ: (o.dragZ * r.a) / areaSum,
    };
  });

  // gunwale overflow points
  const hbAt = (s: number) => o.planform(s) * (o.beam / 2);
  const ws = o.weirScale;
  const W = (s: number, side: number, width: number, bow = false, yOff = 0): Weir => ({
    x: o.xAft + s * o.length,
    y: sheerAt(o, s) + yOff,
    z: side * hbAt(s) * 0.96,
    width: width * ws,
    bow,
  });
  const weirs: Weir[] = [
    W(0.97, 0, 1.0, true),
    W(0.86, -1, 1.7, true),
    W(0.86, 1, 1.7, true),
    W(0.58, -1, 2.6),
    W(0.58, 1, 2.6),
    W(0.2, -1, 2.2),
    W(0.2, 1, 2.2),
    { x: o.xAft, y: Math.max(0.15, sheerAt(o, 0) - 0.18), z: 0, width: o.beam * 0.55 * ws, bow: false },
  ];

  const bumpers: Bumper[] = [];
  const addB = (s: number, side: number, r: number) =>
    bumpers.push({ x: o.xAft + s * o.length, y: 0.1, z: side * hbAt(s) * 0.98, r });
  if (o.bumperCount) {
    // a ship: a fender every few metres down both sides, so no wharf corner can slip between them
    const r = o.bumperR ?? 0.5;
    addB(1, 0, r * 0.7);
    addB(0, 0, r);
    for (let i = 0; i < o.bumperCount; i++) {
      const s = 0.04 + (0.9 * i) / Math.max(1, o.bumperCount - 1);
      addB(s, -1, r);
      addB(s, 1, r);
    }
  } else {
    addB(1, 0, 0.35);
    addB(0.88, -1, 0.5);
    addB(0.88, 1, 0.5);
    addB(0.5, -1, 0.5);
    addB(0.5, 1, 0.5);
    addB(0.12, -1, 0.5);
    addB(0.12, 1, 0.5);
    addB(0, 0, 0.5);
  }

  const cgX = xCob + o.trimBias;
  return { samples, weirs, bumpers, cgX };
}

/** Visual builders read the planform etc. from here. */
export const HULL_OPTS = new Map<string, HullOpts>();

export const inertia = (L: number, B: number, m: number): [number, number, number] => [
  m * (0.4 * B) ** 2, // roll
  m * (0.27 * L) ** 2, // yaw
  m * (0.26 * L) ** 2, // pitch
];
