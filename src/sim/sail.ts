// Sail aerodynamics for the sloop: a thin foil with stall, driven by the apparent wind.
//
// Geometry (boat frame, +x bow, +z starboard): the apparent wind comes from `gamma` off the bow (0 = dead
// ahead, pi = dead astern). The boom swings out to leeward and is held by the sheet, so it can never
// open further than `boomLimit(sheet)`; left alone it weathervanes to the wind (a luffing, drawing
// nothing sail). The angle of attack is whatever is left between the wind angle and the boom.

import { clamp, lerp, smoothstep } from '../core/math';

/** Narrowest and widest boom angle from the centreline (radians): sheeted hard in / let right out. */
export const BOOM_MIN = 0.1;
export const BOOM_MAX = 1.42;
/** Angle of attack where the flow separates (about 17 degrees). */
export const STALL = 0.3;
/** Angle of attack to trim for: just short of the stall, where the sail pulls hardest. */
export const TRIM_ALPHA = 0.32;
/** Below this the sail is not a foil at all: it flutters. */
export const LUFF_FROM = 0.025;
export const LUFF_TO = 0.13;

/** The furthest the boom may swing out for a given sheet setting (0 = in, 1 = out). */
export const boomLimit = (sheet: number): number => lerp(BOOM_MIN, BOOM_MAX, clamp(sheet, 0, 1));

/** Lift and drag coefficients of the sail at angle of attack `alpha` (radians, >= 0). */
export function sailCoeffs(alpha: number): { cl: number; cd: number } {
  const a = Math.max(0, alpha);
  // pre-stall: lift slope of a low aspect ratio sail plus induced drag
  const clPre = 4.2 * Math.min(a, STALL + 0.1);
  const cdPre = 0.06 + 0.12 * clPre * clPre;
  // post-stall: a flat plate (peaks at 45 degrees)
  const s = Math.sin(a);
  const clPost = 1.2 * Math.sin(2 * a);
  const cdPost = 0.06 + 1.3 * s * s;
  const k = smoothstep(STALL, STALL + 0.25, a);
  return { cl: lerp(clPre, clPost, k), cd: lerp(cdPre, cdPost, k) };
}

/** 0 = a fully luffing sail, 1 = drawing. */
export const drawing = (alpha: number): number => smoothstep(LUFF_FROM, LUFF_TO, alpha);

/** The boom angle that gives the best angle of attack for an apparent wind `gamma` off the bow. */
export const idealBoomAngle = (gamma: number): number => clamp(gamma - TRIM_ALPHA, BOOM_MIN, BOOM_MAX);

/** The sheet setting (0..1) that holds `idealBoomAngle` for this apparent wind angle. */
export const idealSheet = (gamma: number): number =>
  clamp((idealBoomAngle(gamma) - BOOM_MIN) / (BOOM_MAX - BOOM_MIN), 0, 1);

/**
 * Closest the sail will sail to the wind (radians off the bow): below this the foil cannot hold an
 * angle of attack and the boat is "in irons".
 */
export const NO_GO = 0.55;
