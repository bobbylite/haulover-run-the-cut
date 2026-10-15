// The fleet. Each boat is described by a planform + a handful of physical numbers; the generator
// below turns that into the buoyancy-sample cloud, weirs (gunwale overflow points) and bumpers.

import { smoothstep } from '../core/math';
import {
  type BoatSpec,
  type Bumper,
  type EngineSpec,
  type HullSample,
  RHO_W,
  type SailSpec,
  type Weir,
} from '../sim/boatSpec';
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
}

export const sheerAt = (o: HullOpts, s: number): number =>
  o.freeboard + o.sheerBow * s ** 2.2 + o.sheerStern * (1 - s) ** 3;

function buildHull(o: HullOpts) {
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
  addB(1, 0, 0.35);
  addB(0.88, -1, 0.5);
  addB(0.88, 1, 0.5);
  addB(0.5, -1, 0.5);
  addB(0.5, 1, 0.5);
  addB(0.12, -1, 0.5);
  addB(0.12, 1, 0.5);
  addB(0, 0, 0.5);

  const cgX = xCob + o.trimBias;
  return { samples, weirs, bumpers, cgX };
}

/** Visual builders read the planform etc. from here. */
export const HULL_OPTS = new Map<string, HullOpts>();

const inertia = (L: number, B: number, m: number): [number, number, number] => [
  m * (0.4 * B) ** 2, // roll
  m * (0.27 * L) ** 2, // yaw
  m * (0.26 * L) ** 2, // pitch
];

// ------------------------------------------------------------------------------------------------

function makeConsole(): BoatSpec {
  const o: HullOpts = {
    length: 7.4,
    beam: 2.5,
    xAft: -3.75,
    mass: 2400,
    draft: 0.4,
    planform: (s) => (s < 0.5 ? 1 - (0.5 - s) * 0.12 : (1 - ((s - 0.5) / 0.5) ** 1.8) ** 0.72),
    lateral: [-0.8, -0.3, 0.3, 0.8],
    nx: 9,
    rocker: 0.38,
    rockerStart: 0.4,
    freeboard: 0.82,
    sheerBow: 0.34,
    sheerStern: -0.1,
    cgY: 0.18,
    trimBias: -0.15,
    dragX: 42.5,
    dragZ: 260,
    hump: { speed: 5.5, width: 2.6, gain: 0.9 },
    cpS: 0.42,
    weirScale: 1,
    heaveZeta: 0.38,
    flare: 1.0,
  };
  const h = buildHull(o);
  HULL_OPTS.set('console', o);
  const engine: EngineSpec = {
    x: -3.95,
    y: -0.9,
    thrust: 9800,
    zeroThrustSpeed: 33,
    reverse: 0.35,
    steerMax: 0.5,
    steerRate: 1.6,
    rudder: 60,
    sound: 'outboard',
    washSteer: 0.8,
  };
  return {
    id: 'console',
    name: 'Sea Hornet 24',
    short: 'Hornet',
    tagline: 'Center-console classic',
    blurb: 'The boat you see running Haulover every weekend. Quick, nimble, self-bailing cockpit.',
    length: o.length,
    beam: o.beam,
    mass: o.mass,
    draft: o.draft,
    cg: [h.cgX, o.cgY, 0],
    inertia: inertia(o.length, o.beam, o.mass),
    samples: h.samples,
    weirs: h.weirs,
    bumpers: h.bumpers,
    engine,
    cockpit: { x0: -3.3, x1: 0.9, halfWidth: 0.95, soleY: 0.12, scupper: 0.028, scupperX: -3.3 },
    wind: { front: 3.4, side: 7.5, cdFront: 0.8, cdSide: 1.0, ceX: h.cgX - o.trimBias - 0.45, ceY: 1.7 },
    keel: 1,
    flare: o.flare,
    keelDepth: 0.55,
    angDamp: [1800, 2600, 3800],
    capacity: 1100,
    waterMassScale: 3.2,
    pump: 5.5,
    planing: { speed: 12, fraction: 0.88, aoa: 0.07 },
    hump: o.hump,
    trim: { plane: 0.06, hump: 0.1, gain: 900 },
    topSpeed: 22,
    camera: { distance: 17, height: 6.2, look: 5, helm: [-0.05, 1.75, 0] },
    stats: { speed: 0.62, handling: 0.82, stability: 0.55, dryness: 0.6, windage: 0.5, tide: 0.35 },
    strength: 6.2,
    skill: 2,
    scoreMult: 1,
  };
}

function makeGoFast(): BoatSpec {
  const o: HullOpts = {
    length: 10.2,
    beam: 2.35,
    xAft: -5.0,
    mass: 3700,
    draft: 0.5,
    planform: (s) => (s < 0.38 ? 1 - (0.38 - s) * 0.1 : (1 - ((s - 0.38) / 0.62) ** 1.55) ** 0.8),
    lateral: [-0.8, -0.3, 0.3, 0.8],
    nx: 11,
    rocker: 0.5,
    rockerStart: 0.38,
    freeboard: 0.62,
    sheerBow: 0.3,
    sheerStern: -0.04,
    cgY: 0.1,
    trimBias: -0.1,
    dragX: 77.3,
    dragZ: 340,
    hump: { speed: 7, width: 3, gain: 0.55 },
    cpS: 0.26,
    weirScale: 0.85,
    heaveZeta: 0.36,
    flare: 1.4,
  };
  const h = buildHull(o);
  HULL_OPTS.set('gofast', o);
  return {
    id: 'gofast',
    name: 'Miami Vice 33',
    short: 'Vice',
    tagline: 'Offshore go-fast',
    blurb: 'Pink, teal and insanely quick. Deep-V hull slams hard in the haystacks: throttle with respect.',
    length: o.length,
    beam: o.beam,
    mass: o.mass,
    draft: o.draft,
    cg: [h.cgX, o.cgY, 0],
    inertia: inertia(o.length, o.beam, o.mass),
    samples: h.samples,
    weirs: h.weirs,
    bumpers: h.bumpers,
    engine: {
      x: -4.9,
      y: -1.0,
      thrust: 21000,
      zeroThrustSpeed: 49,
      reverse: 0.25,
      steerMax: 0.34,
      steerRate: 1.2,
      rudder: 185,
      sound: 'v8',
      washSteer: 0.6,
    },
    cockpit: { x0: -4.5, x1: -0.2, halfWidth: 0.8, soleY: 0.1, scupper: 0.016, scupperX: -4.5 },
    wind: { front: 2.4, side: 5.8, cdFront: 0.55, cdSide: 0.9, ceX: h.cgX - o.trimBias - 0.5, ceY: 1.0 },
    keel: 1.1,
    flare: o.flare,
    keelDepth: 0.6,
    angDamp: [2200, 4200, 6800],
    capacity: 800,
    waterMassScale: 3.6,
    pump: 4.5,
    planing: { speed: 17, fraction: 0.9, aoa: 0.06 },
    hump: o.hump,
    trim: { plane: 0.085, hump: 0.12, gain: 1500 },
    topSpeed: 32,
    camera: { distance: 21, height: 6.8, look: 6.5, helm: [-1.9, 1.25, 0] },
    stats: { speed: 1, handling: 0.7, stability: 0.4, dryness: 0.38, windage: 0.3, tide: 0.15 },
    strength: 7.0,
    skill: 4,
    scoreMult: 1.2,
  };
}

function makeCruiser(): BoatSpec {
  const o: HullOpts = {
    length: 13.0,
    beam: 4.2,
    xAft: -6.3,
    mass: 15500,
    draft: 0.95,
    planform: (s) => (s < 0.55 ? 1 - (0.55 - s) * 0.1 : (1 - ((s - 0.55) / 0.45) ** 1.9) ** 0.7),
    lateral: [-0.85, -0.5, -0.17, 0.17, 0.5, 0.85],
    nx: 10,
    rocker: 0.5,
    rockerStart: 0.55,
    freeboard: 1.15,
    sheerBow: 0.55,
    sheerStern: -0.12,
    cgY: 0.45,
    trimBias: -0.1,
    dragX: 893,
    dragZ: 1100,
    hump: { speed: 5, width: 2.6, gain: 0.25 },
    cpS: 0.34,
    weirScale: 1,
    heaveZeta: 0.42,
    flare: 0.9,
  };
  const h = buildHull(o);
  HULL_OPTS.set('cruiser', o);
  return {
    id: 'cruiser',
    name: 'Sunset 42',
    short: 'Sunset',
    tagline: 'Flybridge sport yacht',
    blurb: 'Big, heavy and forgiving. Rides over chop but the tall deck catches every gust.',
    length: o.length,
    beam: o.beam,
    mass: o.mass,
    draft: o.draft,
    cg: [h.cgX, o.cgY, 0],
    inertia: inertia(o.length, o.beam, o.mass),
    samples: h.samples,
    weirs: h.weirs,
    bumpers: h.bumpers,
    engine: {
      x: -5.6,
      y: -1.25,
      thrust: 52000,
      zeroThrustSpeed: 24,
      reverse: 0.4,
      steerMax: 0.45,
      steerRate: 0.7,
      rudder: 1400,
      sound: 'diesel',
      washSteer: 0.5,
    },
    cockpit: { x0: -5.9, x1: -3.6, halfWidth: 1.7, soleY: 0.5, scupper: 0.04, scupperX: -5.9 },
    wind: { front: 13, side: 34, cdFront: 0.9, cdSide: 1.1, ceX: h.cgX - o.trimBias + 1.3, ceY: 2.9 },
    keel: 1.3,
    flare: o.flare,
    keelDepth: 1.0,
    angDamp: [26000, 70000, 90000],
    capacity: 2800,
    waterMassScale: 2.4,
    pump: 11,
    planing: { speed: 8.8, fraction: 0.55, aoa: 0.05 },
    hump: o.hump,
    trim: { plane: 0.035, hump: 0.05, gain: 12000 },
    topSpeed: 13.5,
    camera: { distance: 28, height: 10, look: 8, helm: [0.6, 3.9, 0] },
    stats: { speed: 0.5, handling: 0.4, stability: 0.9, dryness: 0.92, windage: 0.9, tide: 0.4 },
    strength: 7.9,
    skill: 2,
    scoreMult: 0.95,
  };
}

function makeSloop(): BoatSpec {
  const o: HullOpts = {
    length: 9.4,
    beam: 3.0,
    xAft: -4.5,
    mass: 4600,
    draft: 0.55,
    planform: (s) => Math.max(0.04, (1 - (2 * s - 1.0) ** 4) ** 0.65 * (s > 0.45 ? 1 : 0.9 + s * 0.22)),
    lateral: [-0.8, -0.3, 0.3, 0.8],
    nx: 9,
    rocker: 0.3,
    rockerStart: 0.7,
    freeboard: 0.95,
    sheerBow: 0.3,
    sheerStern: 0.0,
    cgY: -0.35,
    trimBias: -0.1,
    dragX: 60.2,
    dragZ: 360,
    hump: { speed: 3.4, width: 1.4, gain: 0.5 },
    cpS: 0.4,
    weirScale: 1,
    heaveZeta: 0.42,
    flare: 0.8,
  };
  const h = buildHull(o);
  HULL_OPTS.set('sloop', o);
  const sail: SailSpec = { area: 34, x: -0.2, y: 4.8, mastX: 0.9, mastHeight: 12.5 };
  return {
    id: 'sloop',
    name: 'Pelican 30',
    short: 'Pelican',
    tagline: 'Cruising sloop',
    blurb: 'Hoist the main and let the easterly do the work... or motor through the Cut. Deep keel, low CG.',
    length: o.length,
    beam: o.beam,
    mass: o.mass,
    draft: o.draft,
    cg: [h.cgX, o.cgY, 0],
    inertia: inertia(o.length, o.beam, o.mass),
    samples: h.samples,
    weirs: h.weirs,
    bumpers: h.bumpers,
    engine: {
      x: -4.3,
      y: -0.9,
      thrust: 3300,
      zeroThrustSpeed: 6.2,
      reverse: 0.55,
      steerMax: 0.6,
      steerRate: 0.9,
      rudder: 2200,
      sound: 'sail',
      washSteer: 0.7,
    },
    sail,
    cockpit: { x0: -4.2, x1: -2.2, halfWidth: 0.9, soleY: 0.25, scupper: 0.018, scupperX: -4.2 },
    wind: { front: 2.2, side: 5.4, cdFront: 0.7, cdSide: 1.0, ceX: h.cgX - o.trimBias + 0.3, ceY: 2.2 },
    keel: 3.0,
    flare: o.flare,
    keelDepth: 1.7,
    angDamp: [9000, 14000, 16000],
    capacity: 1500,
    waterMassScale: 2.6,
    pump: 4.0,
    planing: { speed: 99, fraction: 0, aoa: 0.05 },
    // a 9 m keelboat cannot be driven much past 9 knots, however hard it is pushed
    hullSpeed: 4.6,
    hump: o.hump,
    trim: { plane: 0, hump: 0, gain: 0 },
    topSpeed: 5.2,
    camera: { distance: 22, height: 7.5, look: 6, helm: [-3.4, 1.95, 0] },
    stats: { speed: 0.28, handling: 0.3, stability: 0.8, dryness: 0.7, windage: 0.5, tide: 0.95 },
    strength: 9.5,
    skill: 5,
    scoreMult: 1.6,
  };
}

function makePontoon(): BoatSpec {
  const o: HullOpts = {
    length: 7.3,
    beam: 2.6,
    xAft: -3.6,
    mass: 1900,
    draft: 0.3,
    planform: (s) => (s < 0.8 ? 1 : (1 - ((s - 0.8) / 0.2) ** 2) ** 0.5),
    lateral: [-0.78, 0.78],
    nx: 8,
    rocker: 0.28,
    rockerStart: 0.72,
    freeboard: 0.6,
    sheerBow: 0.1,
    sheerStern: 0.0,
    cgY: 0.55,
    trimBias: -0.1,
    dragX: 12.4,
    dragZ: 120,
    hump: { speed: 4.0, width: 2.0, gain: 0.5 },
    cpS: 0.35,
    weirScale: 0.9,
    heaveZeta: 0.3,
    flare: 0.3,
  };
  const h = buildHull(o);
  HULL_OPTS.set('pontoon', o);
  return {
    id: 'pontoon',
    name: 'Tiki Barge 24',
    short: 'Tiki',
    tagline: 'Sandbar party pontoon',
    blurb: 'Flat, floaty and ridiculously windy. Gorgeous in calm water, a handful in a chop.',
    length: o.length,
    beam: o.beam,
    mass: o.mass,
    draft: o.draft,
    cg: [h.cgX, o.cgY, 0],
    inertia: inertia(o.length, o.beam, o.mass),
    samples: h.samples,
    weirs: h.weirs,
    bumpers: h.bumpers,
    engine: {
      x: -3.7,
      y: -0.7,
      thrust: 4800,
      zeroThrustSpeed: 11.5,
      reverse: 0.5,
      steerMax: 0.5,
      steerRate: 1.2,
      rudder: 80,
      sound: 'outboard',
      washSteer: 0.9,
    },
    cockpit: { x0: -3.2, x1: 2.4, halfWidth: 1.1, soleY: 0.42, scupper: 0.02, scupperX: -3.2 },
    wind: { front: 5, side: 13, cdFront: 1.0, cdSide: 1.15, ceX: h.cgX - o.trimBias - 1.1, ceY: 1.6 },
    keel: 0.5,
    flare: o.flare,
    keelDepth: 0.4,
    angDamp: [1600, 2200, 2800],
    capacity: 900,
    waterMassScale: 2.6,
    pump: 3.0,
    planing: { speed: 99, fraction: 0.2, aoa: 0.04 },
    hump: o.hump,
    trim: { plane: 0.012, hump: 0.03, gain: 700 },
    topSpeed: 8.8,
    camera: { distance: 17, height: 6.2, look: 4.5, helm: [2.1, 1.95, 0.7] },
    stats: { speed: 0.3, handling: 0.6, stability: 0.45, dryness: 0.3, windage: 1, tide: 0.7 },
    strength: 6.2,
    skill: 3,
    scoreMult: 1.05,
  };
}

export const BOATS: readonly BoatSpec[] = [
  makeConsole(),
  makeGoFast(),
  makeCruiser(),
  makeSloop(),
  makePontoon(),
];

export const boatById = (id: string): BoatSpec => BOATS.find((b) => b.id === id) ?? (BOATS[0] as BoatSpec);

export { RHO_W };
