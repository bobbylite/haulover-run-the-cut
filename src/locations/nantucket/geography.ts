// Procedural geography of Nantucket Harbor, Massachusetts (stylised, a little squarer and wider than life
// so a 116 m ship fits).
//
// Frame: +X = east, +Z = south, -Z = north (Nantucket Sound, the open water), +Y up, sea level y = 0.
//
// The harbour is a bowl about 1.2 km across with the town on its south shore. Brant Point (a spit with the
// little lighthouse) closes the west side of the entrance, and the long sand arm of Coatue the east side,
// leaving a 220 m gap at x ~ 103. Inside, the wharves jut north from a straight bulkhead: Steamship Wharf
// (the big one: ferries and ships), Old North, Straight and Old South, then Easy Street Boat Basin, a notch
// cut into the shore with a comb of finger piers. A mooring field fills the middle of the harbour and the
// flats off Coatue are too shallow to be anything but a trap.
//
// The tide runs through the entrance: the ebb sets out to the north, the flood sets in, and inside the bowl
// it stays strong enough to push a ship around. Everything is a pure function of (x, z), so the CPU physics,
// the baked GPU textures, the terrain mesh and the props all agree about where the water is.

import { clamp, distToSegment, fbm2, lerp, noise2, Rng, smoothstep } from '../../core/math';
import type { Berth, Dock, Moored, Piling } from '../types';

// the extents must be whole multiples of both cell sizes (the baked grids index by them)
export const WORLD = { x0: -1400, x1: 1400, z0: -1000, z1: 800, cell: 8 } as const;
/** Cell size (m) of the baked tidal-flow grid. */
export const FLOW_CELL = 10;

// ----------------------------------------------------------------------------------------------
// Design data
// ----------------------------------------------------------------------------------------------

/** The town bulkhead: land is south of this z. */
export const TOWN_Z = 330;
/** Height of the quay tops above the sea (m). */
export const QUAY_TOP = 1.6;

/** Brant Point Light at the tip of the spit. */
export const LIGHT = { x: -62, z: -302 } as const;

/** The middle of the harbour mouth; the tide funnels through it. */
export const ENTRANCE = { x: 103, z: -330 } as const;

/** Easy Street Boat Basin: a notch cut into the south shore. */
export const NOTCH = { x0: 190, x1: 370, z0: TOWN_Z, z1: 430 } as const;

/**
 * The dredged fairway from open water to the Steamship Wharf berth pocket (deep enough for the ship, which
 * draws 5.2 m): in through the entrance, across the bowl, and down along the wharf's east face.
 */
export const FAIRWAY: readonly (readonly [number, number])[] = [
  [103, -760],
  [103, -420],
  [103, -330],
  [78, -220],
  [10, -90],
  [-110, -20],
  [-240, 25],
  [-262, 70],
  [-255, 150],
  [-250, 235],
];

// ----------------------------------------------------------------------------------------------
// Shoreline
// ----------------------------------------------------------------------------------------------

const capsule = (x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): number =>
  distToSegment(x, z, ax, az, bx, bz) - r;

/** Signed distance to dry land (negative inside). */
export function landSDF(x: number, z: number): number {
  // the town is three blocks of land around Easy Street basin (west of it, east of it, and behind it), so that
  // inside the basin the nearest "land" is really its walls and not a phantom edge across its mouth
  let d = Math.min(Math.max(x - NOTCH.x0, TOWN_Z - z), Math.max(NOTCH.x1 - x, TOWN_Z - z), NOTCH.z1 - z);
  // the west shore with Brant Point, and Coatue on the east side
  d = Math.min(d, capsule(x, z, -760, -250, -760, 900, 160));
  d = Math.min(d, capsule(x, z, -640, -236, -45, -305, 38));
  d = Math.min(d, capsule(x, z, 770, -60, 770, 900, 170));
  d = Math.min(d, capsule(x, z, 640, -80, 265, -330, 52));
  return d;
}

/** Where the shore is a vertical bulkhead you can hit, rather than a sand beach you ground on. */
function bulkhead(x: number, z: number): boolean {
  return z > TOWN_Z - 40 && x > -612 && x < 412;
}

// ----------------------------------------------------------------------------------------------
// Bathymetry / topography
// ----------------------------------------------------------------------------------------------

function fairwayDist(x: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < FAIRWAY.length - 1; i++) {
    const a = FAIRWAY[i] as readonly [number, number];
    const b = FAIRWAY[i + 1] as readonly [number, number];
    d = Math.min(d, distToSegment(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

/** Natural water depth, positive below sea level. */
function depthAt(x: number, z: number): number {
  const s = Math.max(0, landSDF(x, z));
  // the bowl is 5 m deep, with a little texture
  let d = 5.2 + 1.2 * (fbm2(x * 0.006, z * 0.006, 3, 11) - 0.5);
  // the sound outside: deeper
  d = lerp(d, 8.5, smoothstep(-300, -520, z));
  // the dredged fairway and the turning basin off Steamship Wharf
  d = Math.max(d, 9.6 * (1 - smoothstep(34, 125, fairwayDist(x, z))));
  const bx = (x + 330) / 280;
  const bz = (z - 205) / 190;
  d = Math.max(d, 8.6 * Math.exp(-((bx * bx + bz * bz) ** 1.6)));
  // the flats off Coatue and inside Brant Point: shallows that ground a keel
  const flats =
    smoothstep(330, 470, x) * (1 - smoothstep(60, 250, z)) * smoothstep(-300, -120, z) +
    0.8 * smoothstep(-130, -300, x) * (1 - smoothstep(-360, -230, z)) * smoothstep(-320, -250, z);
  d = lerp(d, 0.7 + 0.6 * fbm2(x * 0.03, z * 0.03, 2, 3), clamp(flats, 0, 1));
  // the basin is a uniform 3.6 m
  if (z > TOWN_Z - 2) d = 3.6;
  // beaches shelve gently; a bulkhead drops straight to depth
  const slope = bulkhead(x, z) ? 1.2 : 38;
  const edge = clamp(s / slope, 0, 1);
  return Math.max(0, d * edge ** 0.85 + 0.15 * (1 - edge));
}

/** Height of the dry land (positive). */
function landHeight(x: number, z: number): number {
  const di = Math.max(0, -landSDF(x, z));
  const n = fbm2(x * 0.012, z * 0.012, 3, 21);
  if (bulkhead(x, z)) {
    // the town: a flat quay, then the ground rises into the island behind it
    const back = Math.max(0, z - TOWN_Z);
    return QUAY_TOP + 0.5 * smoothstep(0, 20, di) + 3.5 * smoothstep(60, 420, back) + 1.0 * n;
  }
  // dunes on Coatue and the west shore; Brant Point is a low spit
  const berm = 1.0 * smoothstep(0, 14, di);
  const dune = 2.6 + 4.4 * n + 1.4 * fbm2(x * 0.06, z * 0.06, 2, 25);
  const spit = x > -640 && x < -20 && z < -150 ? 0.45 : 1;
  return Math.max(0.35, lerp(berm, dune * spit, smoothstep(14, 130, di)));
}

/** Terrain / sea-floor height used by the land mesh and the physics. */
export function seabedHeight(x: number, z: number): number {
  return landSDF(x, z) < 0 ? landHeight(x, z) : -depthAt(x, z);
}

/** 0 = sand, 1 = seagrass, 2 = rock. */
export function floorKind(x: number, z: number, h: number): number {
  if (h < -0.4 && h > -2.8 && x > 300 && fbm2(x * 0.02, z * 0.02, 2, 41) > 0.42) return 1;
  if (h < -1 && h > -4 && z < -200 && x < 0 && fbm2(x * 0.025, z * 0.025, 2, 47) > 0.55) return 1;
  return 0;
}

// ----------------------------------------------------------------------------------------------
// Piers, fingers, moored boats and the moorings
// ----------------------------------------------------------------------------------------------

/** The town's wharves and the fingers of Easy Street (rectangles in world space). */
export const DOCKS: Dock[] = [
  // Steamship Wharf: the big commercial pier (east face x = -300, west face x = -420)
  { x: -360, z: 225, hx: 60, hz: 105 },
  // Old North Wharf, Straight Wharf and Old South Wharf
  { x: -217.5, z: 280, hx: 12.5, hz: 50 },
  { x: -90, z: 260, hx: 20, hz: 70 },
  { x: 1, z: 290, hx: 11, hz: 40 },
];

/** Finger piers of Easy Street Boat Basin: ten of them, 18 m apart, leaving nine slips. */
export const FINGER_X: number[] = Array.from({ length: 10 }, (_, k) => 200 + 18 * k);
for (const x of FINGER_X) DOCKS.push({ x, z: 392.5, hx: 0.9, hz: 37.5 });

/** Round hard obstacles: moored hulls and the pilings between them. */
export const PILINGS: Piling[] = [];

/** Boats tied up in the slips and lying to the moorings. */
export const MOORED: Moored[] = [];

export interface Mooring {
  id: string;
  x: number;
  z: number;
}

/** The mooring balls. A third of them are free for the docking challenge. */
export const MOORINGS: Mooring[] = [];

const KIND: Record<Exclude<Moored['kind'], 'pontoon'>, { length: number; beam: number; r: number }> = {
  console: { length: 7.4, beam: 2.5, r: 1.55 },
  gofast: { length: 10.2, beam: 2.35, r: 1.45 },
  cruiser: { length: 13, beam: 4.2, r: 2.4 },
  charter: { length: 14.8, beam: 4.7, r: 2.6 },
  sloop: { length: 9.4, beam: 3.0, r: 1.8 },
};
type MooredKind = keyof typeof KIND;
const KINDS: MooredKind[] = ['console', 'gofast', 'cruiser', 'charter', 'sloop'];

/** Free slips and the balls the levels use; everything else gets a boat. */
export const FREE_SLIPS = [2, 5];
export const FREE_MOORINGS = ['moor-a', 'moor-b', 'moor-c'];

/** Slip k lies between finger k and finger k + 1: its centreline x and the closed end's z. */
export const slipX = (k: number): number => 200 + 18 * k + 9;
export const SLIP_HEAD = NOTCH.z1 - 2;

/** The three balls the docking levels use (the rest of the field is occupied). */
export const FIXED_MOORINGS: Mooring[] = [
  { id: 'moor-a', x: 70, z: 70 },
  { id: 'moor-b', x: 205, z: 30 },
  { id: 'moor-c', x: 290, z: 150 },
];

// ----------------------------------------------------------------------------------------------
// Berths
// ----------------------------------------------------------------------------------------------

const PI = Math.PI;
const mouth = (x: number, z: number): readonly [number, number] => [x, z];

/** The route from the entrance to the fairway's inner end, shared by every approach. */
const TO_BASIN: readonly (readonly [number, number])[] = [
  [103, -420],
  [103, -330],
  [78, -220],
  [10, -90],
];

/**
 * The point where a run along a quay begins: `along` metres behind the berth's mark (against the direction of
 * travel) and `out` metres off the face. Every approach to a wharf ends here, and the last stretch is straight.
 */
function mouthOf(
  b: { x: number; z: number; dir: number; travel: number },
  along: number,
  out: number,
): readonly [number, number] {
  const ux = Math.cos(b.travel);
  const uz = Math.sin(b.travel);
  return [b.x - ux * along + Math.cos(b.dir) * out, b.z - uz * along + Math.sin(b.dir) * out];
}

const wharf = (
  id: string,
  label: string,
  x: number,
  z: number,
  dir: number,
  travel: number,
  length: number,
  radar: number,
  via: readonly (readonly [number, number])[],
  along = 200,
  out = 34,
): Berth => ({
  id,
  label,
  kind: 'alongside',
  x,
  z,
  dir,
  width: 0,
  length,
  ends: 'either',
  travel,
  radar,
  approach: [...TO_BASIN, ...via, mouthOf({ x, z, dir, travel }, along, out)],
});

/** Everything the player can be asked to park at. */
export const BERTHS: readonly Berth[] = [
  // Steamship Wharf: a long face for ships on the east, a ferry berth on the west
  wharf('steamship-east', 'Steamship Wharf, east face', -300, 225, 0, PI / 2, 190, 150, [[-110, -20]]),
  wharf(
    'steamship-west',
    'Steamship Wharf, west face',
    -420,
    225,
    PI,
    PI / 2,
    190,
    110,
    [[-250, -10]],
    200,
    36,
  ),
  // the narrow wharves and the town quay
  wharf('oldnorth-east', 'Old North Wharf', -205, 285, 0, PI / 2, 90, 90, [[-110, 30]], 110, 28),
  wharf('straight-east', 'Straight Wharf, east face', -70, 270, 0, PI / 2, 120, 90, [[-30, 20]], 110, 28),
  wharf('straight-west', 'Straight Wharf, west face', -110, 270, PI, PI / 2, 120, 90, [[-60, 20]], 110, 28),
  wharf('town-quay', 'Town quay', 95, TOWN_Z, -PI / 2, PI, 150, 110, [[100, 100]], 110, 28),
  // Easy Street Boat Basin: nine slips, a free one to aim at
  ...FREE_SLIPS.map(
    (k): Berth => ({
      id: `easy-${k + 1}`,
      label: `Easy Street slip ${k + 1}`,
      kind: 'slip',
      x: slipX(k),
      z: SLIP_HEAD,
      dir: PI / 2,
      width: 18 - 1.8,
      length: 75,
      ends: 'either',
      radar: 70,
      approach: [...TO_BASIN, [90, 60], [190, 200], [slipX(k), 290], mouth(slipX(k), 345)],
    }),
  ),
  // the mooring field
  ...['moor-a', 'moor-b', 'moor-c'].map((id, i): Berth => {
    const m = FIXED_MOORINGS.find((b) => b.id === id) as Mooring;
    return {
      id,
      label: `Mooring ${'ABC'[i]}`,
      kind: 'mooring',
      x: m.x,
      z: m.z,
      dir: 0,
      width: 2.6,
      length: 0,
      ends: 'bow',
      radar: 60,
      approach: [...TO_BASIN, mouth(m.x - 30, m.z - 60)],
    };
  }),
];

export const berthById = (id: string): Berth => BERTHS.find((b) => b.id === id) ?? (BERTHS[0] as Berth);

(function buildMoored() {
  const rng = new Rng(4471);
  let pal = 0;
  // the slips of Easy Street: a boat in most of them, stern to the wall
  for (let k = 0; k < FINGER_X.length - 1; k++) {
    if (FREE_SLIPS.includes(k) || rng.next() < 0.12) continue;
    const kind = KINDS[rng.int(0, 2)] as MooredKind; // the small and mid-size ones fit a slip
    const kd = KIND[kind];
    const x = slipX(k) + (rng.next() - 0.5) * 1.2;
    const z = SLIP_HEAD - kd.length / 2 - 0.8;
    MOORED.push({
      x,
      z,
      yaw: rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
      kind,
      length: kd.length,
      beam: kd.beam,
      pal: pal++,
    });
    const half = Math.max(0, kd.length / 2 - kd.r);
    for (const f of [-1, 0, 1]) PILINGS.push({ x, z: z + f * half, r: kd.r * 0.85 });
  }

  // the mooring field: a jittered grid of balls in the middle of the harbour, ~50 m apart
  const balls: Mooring[] = [];
  const named = FIXED_MOORINGS.map((m) => m.id);
  const fixed = FIXED_MOORINGS;
  balls.push(...fixed);
  // keep every approach road clear of hulls: the corridor is 24 m either side
  const corridor = (x: number, z: number): number => {
    let d = 1e9;
    for (const br of BERTHS) {
      for (let i = 0; i < br.approach.length - 1; i++) {
        const p0 = br.approach[i] as readonly [number, number];
        const p1 = br.approach[i + 1] as readonly [number, number];
        d = Math.min(d, distToSegment(x, z, p0[0], p0[1], p1[0], p1[1]));
      }
    }
    return d;
  };
  for (let gx = 20; gx <= 330; gx += 52) {
    for (let gz = -90; gz <= 200; gz += 50) {
      const x = gx + (rng.next() - 0.5) * 20;
      const z = gz + (rng.next() - 0.5) * 20;
      if (fixed.some((f) => Math.hypot(f.x - x, f.z - z) < 44)) continue;
      if (fairwayDist(x, z) < 70 || corridor(x, z) < 26) continue;
      balls.push({ id: `m${balls.length}`, x, z });
    }
  }
  MOORINGS.push(...balls);
  for (const b of balls) {
    if (named.includes(b.id)) continue;
    if (rng.next() < 0.1 || corridor(b.x, b.z) < 26) continue;
    const kind = KINDS[rng.int(0, KINDS.length - 1)] as MooredKind;
    const kd = KIND[kind];
    // a boat lies head to the tide: bow towards the harbour mouth, swinging a little
    const toMouth = Math.atan2(ENTRANCE.z - b.z, ENTRANCE.x - b.x);
    const yaw = toMouth + (rng.next() - 0.5) * 0.9;
    const bowX = b.x - Math.cos(yaw) * (kd.length * 0.5 - 0.6);
    const bowZ = b.z - Math.sin(yaw) * (kd.length * 0.5 - 0.6);
    MOORED.push({ x: bowX, z: bowZ, yaw, kind, length: kd.length, beam: kd.beam, pal: pal++ });
    const half = Math.max(0, kd.length / 2 - kd.r);
    for (const f of [-1, 0, 1])
      PILINGS.push({
        x: bowX + Math.cos(yaw) * f * half,
        z: bowZ + Math.sin(yaw) * f * half,
        r: kd.r * 0.85,
      });
  }
})();

// ----------------------------------------------------------------------------------------------
// Marks
// ----------------------------------------------------------------------------------------------

/** Channel marks: red nuns to starboard going in, green cans to port, and one at the end of the fairway. */
export const BUOYS = [
  { x: 168, z: -690, kind: 'nun', label: 'R "2"' },
  { x: 38, z: -690, kind: 'can', label: 'G "1"' },
  { x: 165, z: -520, kind: 'nun', label: 'R "4"' },
  { x: 41, z: -520, kind: 'can', label: 'G "3"' },
  { x: 160, z: -390, kind: 'nun', label: 'R "6"' },
  { x: 48, z: -390, kind: 'can', label: 'G "5"' },
  { x: 120, z: -150, kind: 'nun', label: 'R "8"' },
  { x: -40, z: -60, kind: 'can', label: 'G "7"' },
] as const;

// ----------------------------------------------------------------------------------------------
// Obstacles
// ----------------------------------------------------------------------------------------------

/** Signed distance to "hard" obstacles that hurt: the bulkhead, the piers and the moored hulls. */
export function hardSDF(x: number, z: number): number {
  let d = 1e9;
  if (bulkhead(x, z)) d = Math.min(d, landSDF(x, z));
  for (const k of DOCKS) {
    const dx = Math.abs(x - k.x) - k.hx;
    const dz = Math.abs(z - k.z) - k.hz;
    if (dx > 60 || dz > 60) continue;
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
// Sea state modulation (static parts)
// ----------------------------------------------------------------------------------------------

/** How exposed the harbour is to open-sound swell: the bowl is sheltered, the entrance and the sound are not. */
export function swellExposure(x: number, z: number): number {
  const open = smoothstep(-260, -560, z);
  const mouth = Math.exp(-((((x - ENTRANCE.x) / 260) ** 2 + ((z - ENTRANCE.z) / 330) ** 2) ** 1));
  return clamp(0.05 + 0.95 * open + 0.2 * mouth, 0, 1);
}

/** Standing waves where the ebb pours out through the entrance. */
export function hayMask(x: number, z: number): number {
  const m = Math.exp(-((((x - ENTRANCE.x) / 95) ** 2 + ((z - (ENTRANCE.z - 40)) / 150) ** 2) ** 1));
  return clamp(0.55 * m * smoothstep(0, 40, landSDF(x, z)), 0, 1);
}

// ----------------------------------------------------------------------------------------------
// Tidal current (unit field: 1.0 == the peak ebb speed; sign follows the tide)
// ----------------------------------------------------------------------------------------------

/**
 * The ebb drains the bowl out through the entrance: inside it is a broad set towards the mouth that
 * quickens in the throat; along the town bulkhead an eddy sets it across the wharves; in the basin
 * and the slips it is nearly slack.
 */
export function currentUnit(x: number, z: number, out: { x: number; z: number }): void {
  const sdf = landSDF(x, z);
  if (sdf < -2) {
    out.x = 0;
    out.z = 0;
    return;
  }
  const dx = ENTRANCE.x - x;
  const dz = ENTRANCE.z - z;
  const dist = Math.hypot(dx, dz) || 1;
  // direction: towards the mouth, bent a little east-west along the waterfront (the eddy that sets across the wharf faces)
  const near = 1 - smoothstep(30, 190, TOWN_Z - z);
  let ang = Math.atan2(dz, dx) + 0.5 * near * (x > -150 ? -1 : 1) * smoothstep(-500, 0, x) * 0.6;
  // in the sound outside the flow just runs north
  const north = smoothstep(-330, -520, z);
  ang = lerp(ang, -PI / 2, north);
  let mag = 0.1 + 0.9 * Math.exp(-((dist / 230) ** 2));
  mag *= lerp(1, 0.55, north);
  // hug the bulkhead and slow down: the lee of the piers and the basin
  mag *= 0.45 + 0.55 * smoothstep(0, 60, sdf);
  if (z > TOWN_Z - 2) mag *= 0.15;
  out.x = Math.cos(ang) * mag;
  out.z = Math.sin(ang) * mag;
}

// ----------------------------------------------------------------------------------------------
// The town
// ----------------------------------------------------------------------------------------------

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  yaw: number;
  /** 0 shingle cottage, 1 clapboard store, 2 church, 3 hotel */
  kind: number;
}

/** The waterfront: rows of grey-shingled houses behind the quay, bigger at the wharf heads. */
export const BUILDINGS: Building[] = [];
(function buildTown() {
  const rng = new Rng(8123);
  // two rows along the bulkhead, with a gap at each wharf head and a plaza by Straight Wharf
  for (let row = 0; row < 3; row++) {
    const z = TOWN_Z + 26 + row * 38;
    let x = -600;
    while (x < 400) {
      const w = 11 + rng.next() * 12;
      const d = 9 + rng.next() * 7;
      const inNotch = x + w > NOTCH.x0 - 10 && x < NOTCH.x1 + 10 && z < NOTCH.z1 + 20;
      const plaza = row === 0 && x > -140 && x < -40;
      if (!inNotch && !plaza && rng.next() > 0.12) {
        const kind = rng.next() < 0.1 ? 1 : 0;
        BUILDINGS.push({
          x: x + w / 2,
          z: z + (rng.next() - 0.5) * 6,
          w,
          d,
          h: 4.5 + rng.next() * 3.4 + (kind === 1 ? 1.6 : 0),
          yaw: (rng.next() - 0.5) * 0.08,
          kind,
        });
      }
      x += w + 2 + rng.next() * 9;
    }
  }
  // the landmarks: a church with its tower behind the town and a hotel by the Steamship terminal
  BUILDINGS.push({ x: -30, z: TOWN_Z + 150, w: 16, d: 22, h: 12, yaw: 0, kind: 2 });
  BUILDINGS.push({ x: -300, z: TOWN_Z + 28, w: 46, d: 22, h: 10, yaw: 0, kind: 3 });
})();

/** Tree clumps (elms along the streets) as x, z pairs. */
export const TREES: [number, number, number][] = [];
(function trees() {
  const rng = new Rng(2999);
  for (let i = 0; i < 160; i++) {
    const x = -620 + rng.next() * 1040;
    const z = TOWN_Z + 70 + rng.next() * 380;
    if (BUILDINGS.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3)) continue;
    if (x > NOTCH.x0 - 20 && x < NOTCH.x1 + 20 && z < NOTCH.z1 + 25) continue;
    TREES.push([x, z, 3.5 + rng.next() * 3]);
  }
})();

/** The noise the world props use to keep the land from looking striped. */
export const grain = (x: number, z: number): number => noise2(x * 0.05, z * 0.05, 9);
