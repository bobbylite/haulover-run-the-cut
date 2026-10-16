// The docking challenges: twelve berths across five tiers, from a pontoon in a slip to a cruise ship against
// Steamship Wharf in the fog. Each level pairs a vessel with a berth, a start and a clock; a tier unlocks once
// you have earned a star on two of the previous tier's levels.

import type { Difficulty } from '../../data/difficulty';
import type { Pose } from '../../game/mode';
import type { GameConfig } from '../../game/state';
import type { Tide } from '../../sim/environment';

export interface Level {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  boat: GameConfig['boat'];
  /** Berth id (see locations/nantucket/geography.ts). */
  berth: string;
  start: Pose;
  blurb: string;
  /** The sky and tide the level suggests (the player may change both). */
  weather: string;
  tide: Tide;
  /** Seconds on the clock at the middle difficulty. */
  time: number;
  /** Tug calls on the clock for the run, and how many of them are free of a score penalty. */
  tugs: number;
  tugFree: number;
}

export const TIERS: { tier: 1 | 2 | 3 | 4 | 5; name: string; blurb: string }[] = [
  { tier: 1, name: 'Small craft', blurb: 'A slip, a quay and a mooring ball' },
  { tier: 2, name: 'Cruisers and sail', blurb: 'More boat, more wind, more tide' },
  { tier: 3, name: 'Work boats', blurb: 'The tug: twin screws and a lot of push' },
  { tier: 4, name: 'The ferry', blurb: 'Forty-six metres of windage' },
  { tier: 5, name: 'The ship', blurb: 'A 116 m cruise ship and a tug budget' },
];

const H = (x0: number, z0: number, x1: number, z1: number): number => Math.atan2(z1 - z0, x1 - x0);

export const LEVELS: readonly Level[] = [
  {
    id: 'tiki-slip',
    name: 'Easy Street',
    tier: 1,
    boat: 'pontoon',
    berth: 'easy-3',
    start: { x: 90, z: 60, heading: H(90, 60, 190, 200) },
    blurb: 'The Tiki Barge into a slip in Easy Street Boat Basin. Steer with the stern, not the bow.',
    weather: 'n-golden',
    tide: 'slack',
    time: 250,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'hornet-moor',
    name: 'The Mooring',
    tier: 1,
    boat: 'console',
    berth: 'moor-c',
    start: { x: 78, z: -220, heading: H(78, -220, 10, -90) },
    blurb:
      'Pick up Mooring C with the Hornet: the bow to the ball, slow enough for the crew to reach the pennant.',
    weather: 'n-golden',
    tide: 'ebb',
    time: 260,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'sunset-quay',
    name: 'Town Quay',
    tier: 1,
    boat: 'cruiser',
    berth: 'town-quay',
    start: { x: 10, z: -90, heading: H(10, -90, 40, 120) },
    blurb:
      'Lay the Sunset 42 alongside the stone quay, parallel to the wall, with the tide setting you along it.',
    weather: 'n-golden',
    tide: 'ebb',
    time: 270,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'pelican-moor',
    name: 'Under Sail',
    tier: 2,
    boat: 'sloop',
    berth: 'moor-b',
    start: { x: 103, z: -330, heading: H(103, -330, 78, -220) },
    blurb:
      'The Pelican to Mooring B in a fresh south-wester. Motor or sail, but she will not stop on a dime.',
    weather: 'n-breeze',
    tide: 'ebb',
    time: 400,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'sunset-oldnorth',
    name: 'Old North Wharf',
    tier: 2,
    boat: 'cruiser',
    berth: 'oldnorth-east',
    start: { x: 10, z: -90, heading: H(10, -90, -110, 60) },
    blurb: 'Fourteen tonnes of flybridge cruiser alongside a narrow wharf, with the breeze blowing her off.',
    weather: 'n-breeze',
    tide: 'ebb',
    time: 240,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'lady-straight',
    name: 'Straight Wharf',
    tier: 2,
    boat: 'charter',
    berth: 'straight-east',
    start: { x: 10, z: -90, heading: H(10, -90, 0, 80) },
    blurb:
      'The Montauk Lady along the east face of Straight Wharf: heavy, deep and set sideways by the flood.',
    weather: 'n-golden',
    tide: 'flood',
    time: 240,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'tug-slip',
    name: 'Tug in a Slip',
    tier: 3,
    boat: 'tug',
    berth: 'easy-6',
    start: { x: 90, z: 60, heading: H(90, 60, 190, 200) },
    blurb: 'A 20 m tug into a 16 m slip. Twin screws will spin her on the spot: use them.',
    weather: 'n-golden',
    tide: 'ebb',
    time: 300,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'tug-steamship',
    name: 'Round the Wharf',
    tier: 3,
    boat: 'tug',
    berth: 'steamship-west',
    start: { x: 10, z: -90, heading: H(10, -90, -110, 40) },
    blurb: 'Take the tug round the end of Steamship Wharf and lay her alongside the sheltered west face.',
    weather: 'n-breeze',
    tide: 'flood',
    time: 420,
    tugs: 0,
    tugFree: 0,
  },
  {
    id: 'ferry-west',
    name: 'The Ferry Berth',
    tier: 4,
    boat: 'ferry',
    berth: 'steamship-west',
    start: { x: 78, z: -220, heading: H(78, -220, 10, -90) },
    blurb: 'The Islander 150 against the west face of Steamship Wharf. The bow thruster is your friend.',
    weather: 'n-golden',
    tide: 'slack',
    time: 540,
    tugs: 2,
    tugFree: 1,
  },
  {
    id: 'ferry-east',
    name: 'Crosswind Ferry',
    tier: 4,
    boat: 'ferry',
    berth: 'steamship-east',
    start: { x: 78, z: -220, heading: H(78, -220, 10, -90) },
    blurb: 'The same ferry on the exposed east face, with the south-wester shoving her off the wharf.',
    weather: 'n-breeze',
    tide: 'ebb',
    time: 460,
    tugs: 2,
    tugFree: 1,
  },
  {
    id: 'liner-east',
    name: 'The Grey Lady',
    tier: 5,
    boat: 'liner',
    berth: 'steamship-east',
    start: { x: 78, z: -220, heading: H(78, -220, 10, -90) },
    blurb:
      'A 116 m cruise ship to Steamship Wharf. Slow down early, walk her in on the thrusters, call the tugs.',
    weather: 'n-golden',
    tide: 'slack',
    time: 640,
    tugs: 4,
    tugFree: 2,
  },
  {
    id: 'liner-fog',
    name: 'Fog on the Bowl',
    tier: 5,
    boat: 'liner',
    berth: 'steamship-east',
    start: { x: 78, z: -220, heading: H(78, -220, 10, -90) },
    blurb: 'The same ship in thick fog on the ebb. The glowing berth and the radar are all you can see.',
    weather: 'n-fog',
    tide: 'ebb',
    time: 700,
    tugs: 4,
    tugFree: 2,
  },
];

export const levelById = (id: string | null | undefined): Level =>
  LEVELS.find((l) => l.id === id) ?? (LEVELS[0] as Level);

/** Stars earned per level id (0 = not yet docked). */
export type StarBook = Record<string, number>;

/** A tier is open once two of the tier before it have a star (or all of them, if it has fewer than two). */
export function tierOpen(tier: number, stars: StarBook): boolean {
  if (tier <= 1) return true;
  const prev = LEVELS.filter((l) => l.tier === tier - 1);
  const done = prev.filter((l) => (stars[l.id] ?? 0) >= 1).length;
  return done >= Math.min(2, prev.length) && tierOpen(tier - 1, stars);
}

export const levelOpen = (l: Level, stars: StarBook): boolean => tierOpen(l.tier, stars);

/** This game's own sea scaling: gentler tides and shorter clocks than the open-water games. */
export const NANT_DIFFICULTIES: readonly (Difficulty & { timeScale: number })[] = [
  {
    id: 'dockside',
    name: 'Dockhand',
    blurb: 'A gentle tide, a light breeze and plenty of time.',
    capacity: 0.5,
    waveScale: 0.8,
    currentScale: 0.4,
    windScale: 0.7,
    leakScale: 1,
    autoBilge: 0.3,
    score: 0.8,
    gateScale: 1,
    missPenalty: 0,
    timeLimit: 1,
    timeScale: 1.5,
    traffic: 0.35,
    hazards: 0,
    dockTime: 0,
  },
  {
    id: 'weekender',
    name: 'Mate',
    blurb: 'A proper set and a proper breeze. Fair clock.',
    capacity: 0.4,
    waveScale: 1,
    currentScale: 0.7,
    windScale: 1,
    leakScale: 1.3,
    autoBilge: 0.1,
    score: 1,
    gateScale: 1,
    missPenalty: 0,
    timeLimit: 1,
    timeScale: 1,
    traffic: 0.8,
    hazards: 0,
    dockTime: 0,
  },
  {
    id: 'captain',
    name: 'Captain',
    blurb: 'A strong set, gusty wind, busy water and a short clock.',
    capacity: 0.3,
    waveScale: 1.2,
    currentScale: 1,
    windScale: 1.22,
    leakScale: 1.7,
    autoBilge: 0,
    score: 1.5,
    gateScale: 1,
    missPenalty: 0,
    timeLimit: 1,
    timeScale: 0.85,
    traffic: 1.25,
    hazards: 0,
    dockTime: 0,
  },
  {
    id: 'legend',
    name: 'Harbor Pilot',
    blurb: 'The tide runs like a river, the wind will not let up, and the harbourmaster is watching.',
    capacity: 0.2,
    waveScale: 1.4,
    currentScale: 1.35,
    windScale: 1.45,
    leakScale: 2.2,
    autoBilge: 0,
    score: 2.4,
    gateScale: 1,
    missPenalty: 0,
    timeLimit: 1,
    timeScale: 0.7,
    traffic: 1.6,
    hazards: 0,
    dockTime: 0,
  },
];

export const nantDifficulty = (id: string): Difficulty & { timeScale: number } =>
  NANT_DIFFICULTIES.find((d) => d.id === id) ?? (NANT_DIFFICULTIES[1] as Difficulty & { timeScale: number });
