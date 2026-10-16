// Procedural geography of Montauk Point, New York (stylised, loosely to scale).
//
// Frame: +X = east (the open Atlantic), -X = west (Long Island's South Fork), +Z = south, -Z = north
// (Block Island Sound), +Y up, sea level y = 0. The Point is a long arm of bluff pointing east at z ~ 40.
//
// Off the Point the shelf runs out for two miles and then drops away at "the edge". The ebb sets east, out to
// sea, over a sand tongue and the Shagwong reef: that is where the tide rips live, and where the bait and
// the tuna are. Every Montauk sky blows an easterly *against* that ebb, which stands the rips up.
//
// Everything is a pure function of (x, z), so the CPU physics, the baked GPU textures, the terrain mesh and
// the props all agree about where the water is.

import { clamp, distToSegment, fbm2, lerp, noise2, Rng, smoothstep } from '../../core/math';
import type { Piling } from '../types';

export const WORLD = { x0: -2800, x1: 3600, z0: -2200, z1: 2200, cell: 8 } as const;
/** Cell size (m) of the baked tidal-flow grid. */
export const FLOW_CELL = 16;

// ----------------------------------------------------------------------------------------------
// Design data
// ----------------------------------------------------------------------------------------------

/** Montauk Point Lighthouse, on its hill at the tip. */
export const LIGHTHOUSE = { x: -360, z: 52 } as const;

/** Where the day starts: in the lee, a quarter mile off the beach south of the Point. */
export const START = { x: -90, z: 330, heading: 0.12 } as const;

/** The edge of the playable grounds. Beyond it you are out of range and the day is over. */
export const RANGE = { x: 3300, z: 1950 } as const;

/** Sea mounts and shoals (centre, semi-axes along/across `rot`, rotation in radians). */
export const REEF = { x: 560, z: 430, a: 340, b: 105, rot: 0.32 } as const;
export const POINT_SHOAL = { x: 330, z: 90, a: 380, b: 210, rot: 0.1 } as const;
export const FRISBEE = { x: 1500, z: -760, r: 380 } as const;
export const FINGERS = { x: 2150, z: 900, r: 320 } as const;

/** Two navigation buoys: the whistle buoy on the Point rip and a can on the reef's southern edge. */
export const BUOYS = [
  { x: 960, z: 190, kind: 'nun', label: 'R "2"' },
  { x: 470, z: 640, kind: 'can', label: 'G "5"' },
] as const;

// ----------------------------------------------------------------------------------------------
// Shoreline
// ----------------------------------------------------------------------------------------------

const bump = (z: number): number => Math.exp(-(Math.abs((z - 40) / 560) ** 2.2));

/** The east-facing shoreline: land is west of this x. The Point is the bump around z = 40. */
export function coastX(z: number): number {
  const wob = 15 * Math.sin(z * 0.0113 + 0.4) + 8 * Math.sin(z * 0.029 + 2.0) + 4 * Math.sin(z * 0.071);
  return -1900 + 1650 * bump(z) + wob;
}

/** Signed distance to dry land (negative inside), made roughly Euclidean by the shore's slope. */
export function landSDF(x: number, z: number): number {
  const e = 6;
  const slope = (coastX(z + e) - coastX(z - e)) / (2 * e);
  return (x - coastX(z)) / Math.hypot(1, slope);
}

// ----------------------------------------------------------------------------------------------
// Bathymetry / topography
// ----------------------------------------------------------------------------------------------

/** 0..1 inside a rotated ellipse (1 at the centre, ~0 outside twice the radii). */
function ellipse(
  x: number,
  z: number,
  c: { x: number; z: number; a: number; b: number; rot: number },
): number {
  const dx = x - c.x;
  const dz = z - c.z;
  const cs = Math.cos(c.rot);
  const sn = Math.sin(c.rot);
  const u = (dx * cs + dz * sn) / c.a;
  const v = (-dx * sn + dz * cs) / c.b;
  return Math.exp(-((u * u + v * v) ** 1.25));
}

const hump = (x: number, z: number, c: { x: number; z: number; r: number }): number =>
  Math.exp(-((((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r)) ** 1.15));

/** Natural water depth, positive below sea level. */
function depthAt(x: number, z: number): number {
  const s = Math.max(0, landSDF(x, z));
  // the shelf: a gentle beach, ~20 m by half a mile, then the edge drops away to ~100 m
  let d = 24 * (1 - Math.exp(-s / 420));
  d += 78 * smoothstep(1900, 2800, x);
  d += 2.4 * (fbm2(x * 0.004, z * 0.004, 3, 17) - 0.5) * smoothstep(150, 900, s);
  // the sand tongue off the Point and the fingers of Frisbee's hump
  d = lerp(d, 6.5 + 1.6 * fbm2(x * 0.02, z * 0.02, 2, 5), ellipse(x, z, POINT_SHOAL) * smoothstep(0, 140, s));
  d = lerp(d, 13 + 2.5 * fbm2(x * 0.012, z * 0.012, 2, 9), hump(x, z, FRISBEE));
  d = lerp(d, 27 + 3 * fbm2(x * 0.012, z * 0.012, 2, 11), hump(x, z, FINGERS) * 0.9);
  // Shagwong reef: boulders and ledges close under the surface, the heart of the rip
  const reef = ellipse(x, z, REEF);
  d = lerp(d, 3.0 + 1.5 * fbm2(x * 0.03, z * 0.03, 3, 3), reef ** 0.8);
  return Math.max(0, d);
}

/** Height of the dry land (positive). */
function landHeight(x: number, z: number): number {
  const di = Math.max(0, -landSDF(x, z));
  const n = fbm2(x * 0.011, z * 0.011, 3, 21);
  const berm = 1.4 * smoothstep(0, 18, di);
  const rise = smoothstep(26, 120, di);
  // the bluff face climbs to 14-24 m, then rolls away inland as heathy moor
  const bluff = 9 + 13 * n + 4 * fbm2(x * 0.05, z * 0.05, 2, 25);
  const moor = 12 + 8 * fbm2(x * 0.004, z * 0.004, 3, 22);
  const top = lerp(bluff, moor, smoothstep(180, 700, di));
  let h = lerp(berm, top, rise);
  // the hill under the lighthouse
  const lx = x - LIGHTHOUSE.x;
  const lz = z - LIGHTHOUSE.z;
  h += 9 * Math.exp(-(lx * lx + lz * lz) / (2 * 120 * 120));
  return Math.max(0.2, h);
}

/** Terrain / sea-floor height used by the land mesh and the physics. */
export function seabedHeight(x: number, z: number): number {
  return landSDF(x, z) < 0 ? landHeight(x, z) : -depthAt(x, z);
}

/** 0 = sand, 1 = seagrass, 2 = rock. */
export function floorKind(x: number, z: number, h: number): number {
  if (ellipse(x, z, REEF) > 0.22 && h > -9) return 2;
  if (h > -3 && landSDF(x, z) < 70) return 2 * (noise2(x * 0.05, z * 0.05, 6) > 0.62 ? 1 : 0);
  if (h < -1.2 && h > -8 && z > 200 && landSDF(x, z) < 700) {
    if (fbm2(x * 0.011, z * 0.011, 3, 41) > 0.58) return 1;
  }
  return 0;
}

// ----------------------------------------------------------------------------------------------
// Rocks
// ----------------------------------------------------------------------------------------------

/** Boulders in the surf along the Point: hard obstacles that hurt. */
export const ROCKS: Piling[] = [];
(function buildRocks() {
  const rng = new Rng(77);
  for (let i = 0; i < 70; i++) {
    const z = -420 + rng.next() * 880;
    // the tip gets the most, thinning along both shores
    if (rng.next() > 0.35 + 0.65 * bump(z)) continue;
    const off = 5 + rng.next() * rng.next() * 90;
    const x = coastX(z) + off;
    const r = 2.4 + rng.next() * 5.5;
    if (landSDF(x, z) < r) continue;
    ROCKS.push({ x, z, r });
  }
})();

/** Signed distance to the nearest boulder. The shore itself is the seabed; rocks are what you can hit. */
export function hardSDF(x: number, z: number): number {
  if (x > coastX(z) + 160) return 1e9;
  let d = 1e9;
  for (const p of ROCKS) {
    const dx = x - p.x;
    if (dx > 80 || dx < -80) continue;
    d = Math.min(d, Math.hypot(dx, z - p.z) - p.r);
  }
  return d;
}

export function hardNormal(x: number, z: number, out: { x: number; z: number }): void {
  const e = 0.6;
  const gx = hardSDF(x + e, z) - hardSDF(x - e, z);
  const gz = hardSDF(x, z + e) - hardSDF(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  out.x = gx / l;
  out.z = gz / l;
}

// ----------------------------------------------------------------------------------------------
// Sea state modulation (static parts)
// ----------------------------------------------------------------------------------------------

/** How exposed the point is to open-ocean swell (0 sheltered .. 1 open). */
export function swellExposure(x: number, z: number): number {
  const open = smoothstep(-30, 360, landSDF(x, z));
  // the north shore is in the lee of the Point from an easterly swell
  const lee = 1 - 0.5 * smoothstep(-60, -480, z) * (1 - smoothstep(0, 1700, x));
  return clamp(Math.max(open * lee, 0.05), 0, 1);
}

/** Where the rip is: the line the ebb takes off the Point, running east-south-east. */
function ripLine(x: number): number {
  return 70 + 0.075 * (x + 200);
}

function ripStreak(x: number, z: number): number {
  const along = smoothstep(-80, 320, x) * (1 - smoothstep(1500, 2400, x));
  const w = 140 + 0.09 * Math.max(0, x);
  return along * Math.exp(-(((z - ripLine(x)) / w) ** 2));
}

/** Strength of ebb-tide standing waves (0..1): the rip off the Point, the reef, the humps. */
export function hayMask(x: number, z: number): number {
  const rip = 0.82 * ripStreak(x, z);
  const reef = 1.0 * ellipse(x, z, { ...REEF, a: REEF.a * 1.15, b: REEF.b * 1.7 });
  const shoal = 0.55 * ellipse(x, z, POINT_SHOAL);
  const frisbee = 0.5 * hump(x, z, { ...FRISBEE, r: FRISBEE.r * 0.7 });
  const near = smoothstep(0, 120, landSDF(x, z));
  return clamp((rip + reef + shoal + frisbee) * near, 0, 1);
}

// ----------------------------------------------------------------------------------------------
// Tidal current (unit field: 1.0 == the peak ebb speed; sign follows the tide)
// ----------------------------------------------------------------------------------------------

/**
 * The ebb sets east off the Point. Offshore it is a steady drift, in the rip and over the shoals it
 * accelerates to its peak, and close in along the south beach a back-eddy runs the other way.
 */
export function currentUnit(x: number, z: number, out: { x: number; z: number }): void {
  const sdf = landSDF(x, z);
  if (sdf < -2) {
    out.x = 0;
    out.z = 0;
    return;
  }
  // direction: east, leaning north of the Point and south of it as the water spreads out
  const lean = 0.2 * clamp((z - ripLine(x)) / 700, -1, 1);
  let mag = 0.26 + 0.1 * smoothstep(200, 1500, x);
  mag += 0.5 * ripStreak(x, z);
  mag += 0.22 * ellipse(x, z, POINT_SHOAL);
  mag += 0.28 * ellipse(x, z, { ...REEF, a: REEF.a * 1.3, b: REEF.b * 2.2 });
  mag += 0.12 * hump(x, z, FRISBEE);
  mag *= 0.35 + 0.65 * smoothstep(0, 220, sdf);
  let ux = Math.cos(lean) * mag;
  let uz = Math.sin(lean) * mag;
  // the back-eddy south of the Point, a gift to a captain who hugs the beach
  const eddy = Math.exp(-((sdf / 170) ** 2)) * Math.exp(-(((z - 520) / 380) ** 2));
  ux -= 0.2 * eddy;
  uz += 0.05 * eddy;
  out.x = ux;
  out.z = uz;
}

// ----------------------------------------------------------------------------------------------
// The grounds
// ----------------------------------------------------------------------------------------------

export interface FishZone {
  x: number;
  z: number;
  r: number;
  /** Relative odds that a school forms here. */
  weight: number;
  label: string;
}

/**
 * Where bait gathers: on the rips, along the edges of the shoals, and over the humps. Schools form inside
 * these, then drift with the tide.
 */
export const FISH_ZONES: readonly FishZone[] = [
  { x: 720, z: 190, r: 210, weight: 3, label: 'the Point rip' },
  { x: 1180, z: 270, r: 240, weight: 3, label: 'the long rip' },
  { x: 600, z: 640, r: 200, weight: 2, label: 'the Ruins' },
  { x: 1500, z: -700, r: 330, weight: 3, label: "Frisbee's hump" },
  { x: 2150, z: 800, r: 300, weight: 3, label: 'the Fingers' },
  { x: 2450, z: -350, r: 320, weight: 2, label: 'the edge' },
  { x: 2400, z: 450, r: 300, weight: 2, label: 'the edge' },
  { x: 1750, z: 120, r: 260, weight: 1, label: 'the deep rip' },
];

/** Distance from a point to the rip line (m); small = on the rip. */
export function ripDistance(x: number, z: number): number {
  return distToSegment(x, z, -200, ripLine(-200), 2400, ripLine(2400));
}
