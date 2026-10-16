// Procedural geography of Haulover Inlet (stylised, loosely to scale).
//
// Frame: +X = east (open Atlantic), -X = west (Biscayne Bay / Intracoastal),
//        +Z = south (Haulover Park, Bal Harbour), -Z = north (Sunny Isles), +Y up, sea level y = 0.
//
// Everything here is a pure function of (x, z) so that the CPU physics, the baked GPU data
// textures, the terrain mesh and the props all agree about where the water is.

import { clamp, distToSegment, fbm2, lerp, noise2, Rng, smoothstep } from '../../core/math';
import type { Dock, Moored, Piling, SlipBerth } from '../types';

export const WORLD = { x0: -2000, x1: 2000, z0: -1300, z1: 1300, cell: 4 } as const;
/** Cell size (m) of the baked tidal-flow grid. */
export const FLOW_CELL = 8;

// ----------------------------------------------------------------------------------------------
// Design data
// ----------------------------------------------------------------------------------------------

export const BRIDGE_X = -25;
export const JETTY_X0 = 138;
export const JETTY_X1 = 478;
export const JETTY_CREST = 2.4;
export const JETTY_HALF = 4.6;
export const SEA_WALL_TOP = 1.75;

/** The Haulover sandbar: a shallow turquoise lagoon just inside the bay. */
export const SANDBAR = { x: -565, z: 335, r: 88 } as const;

/** ICW (deep N-S channel) centre line x. */
export const ICW_X = -790;

export interface Islet {
  x: number;
  z: number;
  r: number;
  seed: number;
}
export const ISLETS: readonly Islet[] = [
  { x: -1010, z: -190, r: 74, seed: 1 },
  { x: -935, z: 150, r: 38, seed: 2 },
  { x: -1180, z: 330, r: 96, seed: 3 },
  { x: -705, z: -430, r: 48, seed: 4 },
  { x: -1330, z: -70, r: 64, seed: 5 },
  { x: -880, z: 560, r: 78, seed: 6 },
  { x: -1060, z: -520, r: 55, seed: 7 },
  { x: -690, z: 690, r: 60, seed: 8 },
];

// ----------------------------------------------------------------------------------------------
// Shorelines and the cut
// ----------------------------------------------------------------------------------------------

const zFade = (z: number): number => 1 - smoothstep(850, 1250, Math.abs(z));

/** Ocean-side shoreline: land is west of this x. */
export function beachX(z: number): number {
  return (
    165 +
    zFade(z) *
      (24 * Math.sin(z * 0.0043 + 0.6) + 11 * Math.sin(z * 0.0121 + 2.1) + 5 * Math.sin(z * 0.031 + 0.4))
  );
}

/** Bay-side shoreline of the barrier island: land is east of this x. */
export function bayX(z: number): number {
  return -420 + zFade(z) * (30 * Math.sin(z * 0.0049 + 1.3) + 13 * Math.sin(z * 0.0134 + 0.2));
}

/** Mainland shoreline on the far west of the bay: land is west of this x. */
export function mainX(z: number): number {
  return -1720 + zFade(z) * (45 * Math.sin(z * 0.0038 + 0.9) + 20 * Math.sin(z * 0.011));
}

/** Centre line of the cut. */
export function cutZ(x: number): number {
  return 14 * Math.sin((x + 160) / 190) * smoothstep(-600, -380, x) * (1 - smoothstep(180, 420, x));
}

/** Half width of the cut between the seawalls / jetties. */
export function cutHalfW(x: number): number {
  return 60 + 18 * smoothstep(150, 470, x) + 60 * smoothstep(-400, -540, x);
}

/** z of a jetty / seawall centre line. side = -1 north, +1 south. */
export function jettyZ(side: -1 | 1, x: number): number {
  return cutZ(x) + side * (cutHalfW(x) + JETTY_HALF);
}

/** Heading (radians, atan2(dz,dx)) of the cut at x. */
export function cutHeading(x: number): number {
  const e = 2;
  return Math.atan2(cutZ(x + e) - cutZ(x - e), 2 * e);
}

// ----------------------------------------------------------------------------------------------
// Signed distance fields
// ----------------------------------------------------------------------------------------------

function isletSDF(x: number, z: number): number {
  let d = 1e9;
  for (const it of ISLETS) {
    const dx = x - it.x;
    const dz = z - it.z;
    if (Math.abs(dx) > it.r * 1.9 || Math.abs(dz) > it.r * 1.9) continue;
    const a = Math.atan2(dz, dx);
    const wob =
      0.78 + 0.5 * noise2(Math.cos(a) * 1.6 + it.seed * 7, Math.sin(a) * 1.6 + it.seed * 3, it.seed);
    d = Math.min(d, Math.hypot(dx, dz) - it.r * wob);
  }
  return d;
}

/** Signed distance to any dry land (negative inside). Not exact, good enough for masks. */
export function landSDF(x: number, z: number): number {
  const island = Math.max(x - beachX(z), bayX(z) - x);
  const cut = Math.abs(z - cutZ(x)) - cutHalfW(x);
  const carved = Math.max(island, -cut);
  const main = x - mainX(z);
  return Math.min(carved, main, isletSDF(x, z));
}

/** Distance to the jetty crest line of one side (flat end cap). */
function jettySDF(side: -1 | 1, x: number, z: number): number {
  const jz = jettyZ(side, clamp(x, JETTY_X0, JETTY_X1));
  const dz = z - jz;
  const ex = x < JETTY_X0 ? JETTY_X0 - x : x > JETTY_X1 ? x - JETTY_X1 : 0;
  return Math.hypot(ex, dz) - JETTY_HALF;
}

/** Marina finger piers (rects in world space, set after the bay shoreline is known). */
export const DOCKS: Dock[] = [];
(function buildMarina() {
  // finger piers jutting west from the south shore of the bay mouth
  const zs = [98, 122, 146, 170, 194, 218];
  for (const z of zs) {
    const sx = bayX(z) + 6;
    DOCKS.push({ x: sx - 30, z, hx: 33, hz: 1.1 });
  }
  // main spine pier along the shore
  const z0 = 98;
  const z1 = 218;
  DOCKS.push({ x: bayX((z0 + z1) / 2) - 3, z: (z0 + z1) / 2, hx: 1.6, hz: (z1 - z0) / 2 + 4 });
})();

/** Round hard obstacles: old timber pilings and the hulls of moored boats. */
export const PILINGS: Piling[] = [];

/** The slip the docking challenge asks you to park in (between the 3rd and 4th finger piers). */
export const SLIP = { z: 158, x0: -440, x1: -390, half: 10.8 } as const;

/** The same slip as a `SlipBerth`, for the docking game. */
export const SLIP_BERTH: SlipBerth = { id: 'slip3', label: 'Slip 3', ...SLIP };

/**
 * The line through the old piling field to the slip. Waypoints (x, z): the Marina Entrance gate is
 * on the first leg, the slip mouth is the sixth point.
 */
export const DOCK_APPROACH: readonly (readonly [number, number])[] = [
  [-530, 24],
  [-512, 52],
  [-526, 84],
  [-506, 112],
  [-486, 136],
  [-470, 152],
  [-450, 158],
  [-420, 158],
];

/** The open fairway south of the piling field where harbour traffic circulates (an oval racetrack). */
export const BASIN_LOOP = { x: -494, z: 192, rx: 30, rz: 36 } as const;

/** Boats tied up in the slips (the target slip is left free). */
export const MOORED: Moored[] = [];

const KIND: Record<'console' | 'gofast' | 'cruiser', { length: number; beam: number }> = {
  console: { length: 7.4, beam: 2.5 },
  gofast: { length: 10.2, beam: 2.35 },
  cruiser: { length: 13, beam: 4.2 },
};

(function buildMooredAndPilings() {
  const rng = new Rng(555);
  const piers = DOCKS.filter((d) => d.hx > 10).sort((a, b) => a.z - b.z);
  let pal = 0;
  for (let i = 0; i < piers.length - 1; i++) {
    const a = piers[i] as Dock;
    const b = piers[i + 1] as Dock;
    const zc = (a.z + b.z) / 2;
    if (Math.abs(zc - SLIP.z) < 1) continue;
    // two berths per slip, counted from the slip head
    let x = SLIP.x1 - 2;
    for (let berth = 0; berth < 2; berth++) {
      if (rng.next() < 0.1) {
        x -= 14;
        continue;
      }
      const roll = rng.next();
      const kind: 'console' | 'gofast' | 'cruiser' =
        roll < 0.16 && berth === 0 ? 'cruiser' : roll < 0.34 ? 'gofast' : 'console';
      const k = KIND[kind];
      const cx = x - k.length / 2;
      const yaw = rng.next() < 0.5 ? 0 : Math.PI;
      const m: Moored = {
        x: cx,
        z: zc + (rng.next() - 0.5) * 1.6,
        yaw,
        kind,
        length: k.length,
        beam: k.beam,
        pal: pal++,
      };
      MOORED.push(m);
      const r = k.beam / 2 + 0.35;
      const half = Math.max(0, k.length / 2 - r);
      for (const f of [-1, 0, 1]) PILINGS.push({ x: cx + f * half, z: m.z, r });
      x -= k.length + 3;
    }
  }

  // the old piling field the approach has to thread: a jittered grid with a winding corridor left open
  const pts = DOCK_APPROACH;
  const distToApproach = (x: number, z: number): number => {
    let d = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i] as readonly [number, number];
      const p1 = pts[i + 1] as readonly [number, number];
      d = Math.min(d, distToSegment(x, z, p0[0], p0[1], p1[0], p1[1]));
    }
    return d;
  };
  const prng = new Rng(909);
  for (let gx = -562; gx <= -462; gx += 11) {
    for (let gz = 34; gz <= 150; gz += 11) {
      const x = gx + (prng.next() - 0.5) * 5;
      const z = gz + (prng.next() - 0.5) * 5;
      if (prng.next() < 0.08) continue;
      if (distToApproach(x, z) < 7.2) continue;
      // keep clear of the pier tips so the slips themselves stay open
      let nearPier = false;
      for (const d of piers) {
        if (Math.abs(x - d.x) < d.hx + 7 && Math.abs(z - d.z) < d.hz + 6) nearPier = true;
      }
      if (nearPier) continue;
      PILINGS.push({ x, z, r: 0.46 });
    }
  }
})();

/** Signed distance to "hard" obstacles that hurt: seawalls, jetties, docks, pilings. Negative inside. */
export function hardSDF(x: number, z: number): number {
  let d = 1e9;
  // seawall of the cut (only where the cut is actually carved through the island)
  const bx = bayX(z);
  const ex = beachX(z);
  if (x > bx - 2 && x < ex + 6) {
    const wall = cutHalfW(x) - Math.abs(z - cutZ(x));
    // fade out the wall far to the north / south of the cut (land there is just beach)
    if (Math.abs(z - cutZ(x)) < cutHalfW(x) + 25) d = Math.min(d, wall);
  }
  if (x > JETTY_X0 - 30) {
    d = Math.min(d, jettySDF(-1, x, z), jettySDF(1, x, z));
  }
  for (const k of DOCKS) {
    const dx = Math.abs(x - k.x) - k.hx;
    const dz = Math.abs(z - k.z) - k.hz;
    d = Math.min(d, Math.max(dx, dz));
  }
  for (const p of PILINGS) {
    const dx = x - p.x;
    if (dx > 40 || dx < -40) continue;
    d = Math.min(d, Math.hypot(dx, z - p.z) - p.r);
  }
  return d;
}

/** Outward gradient of hardSDF (finite differences). */
export function hardNormal(x: number, z: number, out: { x: number; z: number }): void {
  const e = 0.6;
  const gx = hardSDF(x + e, z) - hardSDF(x - e, z);
  const gz = hardSDF(x, z + e) - hardSDF(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  out.x = gx / l;
  out.z = gz / l;
}

// ----------------------------------------------------------------------------------------------
// Bathymetry / topography
// ----------------------------------------------------------------------------------------------

const gauss = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

/** Depth (positive) of the dredged channel centre line at x. */
function channelDepth(x: number): number {
  return (
    8.0 +
    1.1 * gauss(x, -100, 160) -
    2.6 * gauss(x, 545, 95) +
    2.4 * smoothstep(650, 1150, x) -
    3.2 * smoothstep(-430, -650, x) -
    0.0 * x
  );
}

function dredgeHalfW(x: number): number {
  return cutHalfW(x) + 10 + 20 * smoothstep(-500, -780, x);
}

/** Natural (un-dredged) water depth. Positive below sea level. */
function naturalDepth(x: number, z: number): number {
  const bx = beachX(z);
  if (x >= bx) {
    // open Atlantic shelf with two bars
    const s = x - bx;
    let d = 30 * (1 - Math.exp(-((s / 650) ** 1.4)));
    const barVar = 0.75 + 0.5 * noise2(z * 0.006, 3.1, 11);
    d -= 5.0 * barVar * gauss(s, 285, 52);
    d -= 2.1 * gauss(s, 70, 28) * barVar;
    // ebb-tidal-delta shoals flanking the channel mouth (localised around the inlet)
    const dzc = z - cutZ(Math.min(x, 480));
    d -= 2.6 * gauss(s, 340, 160) * smoothstep(60, 200, Math.abs(dzc)) * Math.exp(-((dzc / 430) ** 2));
    return Math.max(0.0, d);
  }
  const by = bayX(z);
  if (x <= by) {
    // Biscayne Bay: pale shallow flats with a deeper basin to the west
    const mx = mainX(z);
    const dShore = Math.min(by - x, x - mx);
    let d = lerp(0.95, 3.6, smoothstep(-470, -1150, x));
    d += 0.9 * (fbm2(x * 0.004, z * 0.004, 3, 5) - 0.5);
    d *= 0.12 + 0.88 * smoothstep(0, 46, dShore);
    // ICW channel
    d = Math.max(d, 5.6 * gauss(x, ICW_X, 52) * (0.85 + 0.15 * noise2(z * 0.01, 1, 3)));
    // sandbar lagoon
    const sdx = x - SANDBAR.x;
    const sdz = z - SANDBAR.z;
    const sm = Math.exp(-((Math.hypot(sdx, sdz) / SANDBAR.r) ** 3));
    const sandDepth = 0.42 + 0.33 * (fbm2(x * 0.03, z * 0.03, 3, 9) - 0.5) - 0.5 * sm ** 5;
    d = lerp(d, sandDepth, sm);
    // the marina basin is dredged deep enough for every hull in the game
    const bdx = Math.max(-596 - x, x + 372, 0);
    const bdz = Math.max(60 - z, z - 244, 0);
    const bw = 1 - smoothstep(0, 26, Math.hypot(bdx, bdz));
    d = Math.max(d, 3.4 * bw);
    return d;
  }
  return 2.0;
}

/** Height of the dry land (positive). Only meaningful where landSDF < 0. */
function landHeight(x: number, z: number): number {
  const dOcean = beachX(z) - x;
  const dBay = x - bayX(z);
  const dMain = mainX(z) - x;
  let h: number;
  if (x > -700) {
    const n = fbm2(x * 0.012, z * 0.012, 3, 21);
    const berm = 1.55 * smoothstep(0, 30, dOcean);
    const dunes = 2.1 * smoothstep(34, 95, dOcean) * (0.4 + 0.6 * n) * (1 - smoothstep(150, 290, dOcean));
    const flat = 2.15 * smoothstep(70, 150, dOcean);
    h = Math.max(berm, flat) + dunes * 0.75;
    h = lerp(0.45, h, smoothstep(0, 26, dBay));
    // flatten next to the cut walls to make a promenade
    const cd = Math.abs(z - cutZ(x)) - cutHalfW(x);
    if (cd < 90 && x < beachX(z) + 40) h = lerp(SEA_WALL_TOP, h, smoothstep(8, 70, cd));
  } else {
    // mainland / islets: low mangrove flats
    const dd = Math.max(0, -landSDF(x, z));
    h =
      0.35 +
      0.9 * smoothstep(0, 30, Math.min(dd, dMain > 0 ? dMain : dd)) +
      0.5 * (fbm2(x * 0.02, z * 0.02, 2, 31) - 0.5);
  }
  return h;
}

/** Terrain height used for the land mesh (continuous with the sea floor near the shore). */
export function seabedHeight(x: number, z: number): number {
  const sdf = landSDF(x, z);
  let h: number;
  if (sdf < 0) {
    h = landHeight(x, z);
    // dry sandbar island in the lagoon
  } else {
    let depth = naturalDepth(x, z);
    // dredged channel
    const cz = cutZ(x);
    const r = Math.abs(z - cz) / dredgeHalfW(x);
    if (r < 1.2 && x > -900 && x < 1500) {
      const prof = 1 - smoothstep(0.6, 1.06, r);
      depth = Math.max(depth, channelDepth(x) * prof);
    }
    h = -depth;
  }
  // jetty rubble mound
  if (x > JETTY_X0 - 14) {
    for (const side of [-1, 1] as const) {
      const d = jettySDF(side, x, z) + JETTY_HALF;
      if (d < 12) {
        const mound = JETTY_CREST - Math.max(0, d - JETTY_HALF * 0.8) * 0.95;
        h = Math.max(h, mound);
      }
    }
  }
  // sandbar sliver of dry sand
  return h;
}

/** 0 = sand, 1 = seagrass, 2 = rock (for the water shader's visible sea floor). */
export function floorKind(x: number, z: number, h: number): number {
  // rock rubble hugging the seawalls and jetties (not the timber docks)
  if (x > -450 && h < 1.0) {
    const wallD = Math.abs(z - cutZ(x)) - cutHalfW(x);
    const nearWall = x < beachX(z) + 6 && Math.abs(wallD) < 5;
    const nearJetty = x > JETTY_X0 - 30 && Math.min(jettySDF(-1, x, z), jettySDF(1, x, z)) < 6;
    if (nearWall || nearJetty) return 2;
  }
  if (x < bayX(z) && h < -0.5 && h > -3.4) {
    const sdx = x - SANDBAR.x;
    const sdz = z - SANDBAR.z;
    if (Math.hypot(sdx, sdz) > SANDBAR.r * 1.15) {
      const g = fbm2(x * 0.011, z * 0.011, 3, 41);
      const r = Math.abs(z - cutZ(x)) / dredgeHalfW(x);
      if (g > 0.56 && r > 1.15 && Math.abs(x - ICW_X) > 90) return 1;
    }
  }
  return 0;
}

// ----------------------------------------------------------------------------------------------
// Sea state modulation (static parts)
// ----------------------------------------------------------------------------------------------

/** How exposed the point is to open-ocean swell (0 sheltered .. 1 open). */
export function swellExposure(x: number, z: number): number {
  const sOcean = smoothstep(beachX(z) - 40, beachX(z) + 40, x);
  const hw = cutHalfW(x) + 8;
  const corr = 1 - smoothstep(0.85, 1.7, Math.abs(z - cutZ(x)) / hw);
  let s = sOcean * (1 - corr * (1 - lerp(0.55, 1.0, smoothstep(150, 480, x))));
  s += corr * (1 - sOcean) * 0.55 * Math.exp(-Math.max(0, 150 - x) / 170);
  return clamp(Math.max(s, 0.035), 0, 1);
}

/** Strength of ebb-tide "haystack" standing waves (0..1) in the throat and at the bar. */
export function hayMask(x: number, z: number): number {
  const dz = Math.abs(z - cutZ(Math.min(x, 480)));
  const hw = cutHalfW(Math.min(x, 480));
  const inner = 0.4 * gauss(x, -10, 170) * (1 - smoothstep(0.8, 1.15, dz / hw));
  const mouth = 1.0 * gauss(x, 420, 150) * Math.exp(-((dz / (hw + 36)) ** 2));
  return clamp(inner + mouth, 0, 1);
}

// ----------------------------------------------------------------------------------------------
// Tidal current (unit field: 1.0 == peak speed in the throat; sign follows tide)
// ----------------------------------------------------------------------------------------------

/** Writes the ebb-tide flow direction scaled so the throat has magnitude ~1. */
export function currentUnit(x: number, z: number, out: { x: number; z: number }): void {
  const cz = cutZ(x);
  const hw = cutHalfW(x);
  const dz = z - cz;
  const r = dz / hw;
  const e = 2;
  const slope = (cutZ(x + e) - cutZ(x - e)) / (2 * e);
  const tl = Math.hypot(1, slope);
  const tx = 1 / tl;
  const tz = slope / tl;

  // along-channel speed profile
  const lc =
    x < -250
      ? lerp(0.5, 1.0, smoothstep(-520, -250, x))
      : x < 150
        ? 1.0
        : lerp(1.0, 0.8, smoothstep(150, 470, x));
  const ar = Math.abs(r);
  const prof = ar < 1 ? 0.3 + 0.7 * (1 - ar * ar) ** 0.8 : 0.3 * Math.exp(-(((ar - 1) * 4) ** 2));
  const side = 1 - smoothstep(0.95, 1.4, ar);
  let ux = tx * lc * prof * (x > -430 ? 1 : side);
  let uz = tz * lc * prof * (x > -430 ? 1 : side);

  // bay: radial sink flow towards the mouth of the cut
  const wb = smoothstep(-420, -540, x);
  if (wb > 0) {
    const mx = -450;
    const mz = cutZ(mx);
    const bx = mx - x;
    const bz = mz - z;
    const rb = Math.hypot(bx, bz) || 1;
    const mag = 0.6 * Math.min(1, (hw * 0.9) / rb) ** 0.85 * (1 - smoothstep(280, 780, rb));
    ux = lerp(ux, (bx / rb) * mag, wb);
    uz = lerp(uz, (bz / rb) * mag, wb);
  }

  // ocean: jet spreading out of the jetties
  const wj = smoothstep(430, 520, x);
  if (wj > 0) {
    const sx = Math.max(0, x - 470);
    const sig = 85 + 0.3 * sx;
    const mag = 0.8 * Math.exp(-sx / 560) * Math.exp(-((dz / sig) ** 2));
    ux = lerp(ux, mag, wj);
    uz = lerp(uz, 0, wj);
  }

  // faint N-S flow along the ICW
  uz += 0.1 * gauss(x, ICW_X, 80);

  // nothing flows on dry land
  if (landSDF(x, z) < -2) {
    ux = 0;
    uz = 0;
  }
  out.x = ux;
  out.z = uz;
}
