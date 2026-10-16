// Montauk's four tiers. The shared difficulty ids are reused (so the sea, the bilge and the leaks scale as
// everywhere else), but here they also set how scarce the fish are, how hard they fight, how much help the
// crew gives, and how fast the wind and the tide build through the day.

import { type Difficulty, difficultyById } from '../../data/difficulty';

export type TierId = 'dockside' | 'weekender' | 'captain' | 'legend';

export interface FishTier {
  id: TierId;
  name: string;
  blurb: string;
  /** Seconds of daylight. When it is gone with no tuna on the deck, the day is lost. */
  daylightS: number;
  /** Bait schools alive at a time. */
  schools: number;
  /** Share of schools that hold tuna (the rest are decoys: bait and birds, no fish). */
  tunaOdds: number;
  /** Share of tuna schools that show surface signs (birds, boils); the rest only show on the sonar. */
  surfaceOdds: number;
  /** Multiplier on the odds of bigeye and bluefin. */
  bigBias: number;
  /** Multiplier on how readily the tuna bite. */
  bite: number;
  /** Multiplier on how hard and how long the fish fight. */
  fishPower: number;
  /** Crew reel speed and stamina, 1 = a good crew. */
  crew: number;
  /** Line out per unit of tension over the drag, m/s (higher = the drag lets go more easily). */
  slipGain: number;
  /** Wind and tide at the end of the day relative to the start (they build linearly). */
  windRamp: number;
  tideRamp: number;
  /** Speed through the water (kn) above which a school close by is spooked. */
  spookKn: number;
  /** Score multiplier. */
  score: number;
}

export const TIERS: readonly FishTier[] = [
  {
    id: 'dockside',
    name: 'Deckhand',
    blurb: 'Plenty of bait, a patient crew and fish that tire. The sea still leans on you.',
    daylightS: 900,
    schools: 6,
    tunaOdds: 0.6,
    surfaceOdds: 0.7,
    bigBias: 0.7,
    bite: 1.25,
    fishPower: 0.85,
    crew: 1.2,
    slipGain: 14,
    windRamp: 1.15,
    tideRamp: 1.15,
    spookKn: 11,
    score: 0.8,
  },
  {
    id: 'weekender',
    name: 'Mate',
    blurb: 'A fair fight. Real tuna, a rising breeze, and a crew that wants you on the line.',
    daylightS: 780,
    schools: 5,
    tunaOdds: 0.5,
    surfaceOdds: 0.55,
    bigBias: 1,
    bite: 1,
    fishPower: 1,
    crew: 1,
    slipGain: 12,
    windRamp: 1.3,
    tideRamp: 1.25,
    spookKn: 10,
    score: 1,
  },
  {
    id: 'captain',
    name: 'Captain',
    blurb: 'Scarcer tuna that sulk and run hard. The tide builds and the rips stand up.',
    daylightS: 660,
    schools: 4,
    tunaOdds: 0.42,
    surfaceOdds: 0.42,
    bigBias: 1.5,
    bite: 0.85,
    fishPower: 1.18,
    crew: 0.9,
    slipGain: 10.5,
    windRamp: 1.45,
    tideRamp: 1.4,
    spookKn: 9,
    score: 1.6,
  },
  {
    id: 'legend',
    name: 'Montauk Legend',
    blurb: 'Few fish, mostly bluefin, a tired crew, and an ebb that wants you in the rocks.',
    daylightS: 540,
    schools: 4,
    tunaOdds: 0.34,
    surfaceOdds: 0.3,
    bigBias: 2.4,
    bite: 0.7,
    fishPower: 1.38,
    crew: 0.78,
    slipGain: 9,
    windRamp: 1.6,
    tideRamp: 1.55,
    spookKn: 8,
    score: 2.5,
  },
];

export const tierById = (id: string): FishTier => TIERS.find((t) => t.id === id) ?? (TIERS[1] as FishTier);

/**
 * How rough the sea is allowed to be on each tier, and how much water the boat can take. The Montauk skies
 * are already steep and the boat spends the day sitting in the rips, so these are gentler than Haulover's
 * dashes through the Cut: the tide and the wind still lean on you, and build, but a day is survivable.
 */
const SEA: Record<TierId, Partial<Difficulty>> = {
  dockside: {
    capacity: 0.62,
    waveScale: 0.92,
    currentScale: 0.95,
    windScale: 0.95,
    leakScale: 1,
    autoBilge: 0.2,
  },
  weekender: {
    capacity: 0.44,
    waveScale: 1,
    currentScale: 1.08,
    windScale: 1.03,
    leakScale: 1.3,
    autoBilge: 0.08,
  },
  captain: {
    capacity: 0.34,
    waveScale: 1.1,
    currentScale: 1.22,
    windScale: 1.1,
    leakScale: 1.6,
    autoBilge: 0.02,
  },
  legend: { capacity: 0.26, waveScale: 1.2, currentScale: 1.38, windScale: 1.18, leakScale: 2, autoBilge: 0 },
};

/** The shared difficulty record with Montauk's sea scaling laid over it. */
export const seaFor = (id: string): Difficulty => {
  const t = tierById(id);
  return { ...difficultyById(t.id), ...SEA[t.id], name: t.name, blurb: t.blurb };
};
