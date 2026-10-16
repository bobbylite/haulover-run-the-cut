// The tuna of the day: how big, how hard they pull, how long they last, how common they are.

import type { Rng } from '../../core/math';

export type SpeciesId = 'albacore' | 'yellowfin' | 'bigeye' | 'bluefin';

export interface Species {
  id: SpeciesId;
  name: string;
  kgMin: number;
  kgMax: number;
  /** Pull on the line relative to a yellowfin. */
  power: number;
  /** How long it can keep fighting, relative to a yellowfin. */
  endurance: number;
  /** Burst speed in a run (m/s) at power 1 and full stamina. */
  speed: number;
  /** Relative frequency in a school. */
  freq: number;
  /** Score per kilogram. */
  value: number;
  /** Bigeye sound hard and sulk; the rest run. 0..1 odds weight towards sulking. */
  sulk: number;
  /** Pastel livery for the model and the result card. */
  back: string;
  belly: string;
  finlet: string;
}

export const SPECIES: Record<SpeciesId, Species> = {
  albacore: {
    id: 'albacore',
    name: 'Albacore',
    kgMin: 10,
    kgMax: 28,
    power: 0.6,
    endurance: 0.7,
    speed: 6.4,
    freq: 3,
    value: 5,
    sulk: 0.1,
    back: '#4f7fc0',
    belly: '#f2f4fa',
    finlet: '#ffe27a',
  },
  yellowfin: {
    id: 'yellowfin',
    name: 'Yellowfin',
    kgMin: 25,
    kgMax: 90,
    power: 1,
    endurance: 1,
    speed: 8,
    freq: 4,
    value: 6,
    sulk: 0.25,
    back: '#3f6fb8',
    belly: '#f4f1e6',
    finlet: '#ffe45e',
  },
  bigeye: {
    id: 'bigeye',
    name: 'Bigeye',
    kgMin: 40,
    kgMax: 120,
    power: 1.12,
    endurance: 1.15,
    speed: 7.6,
    freq: 2,
    value: 8,
    sulk: 0.55,
    back: '#4a5fa8',
    belly: '#f1eef0',
    finlet: '#ffd96b',
  },
  bluefin: {
    id: 'bluefin',
    name: 'Bluefin',
    kgMin: 90,
    kgMax: 300,
    power: 1.5,
    endurance: 1.35,
    speed: 9.4,
    freq: 1,
    value: 12,
    sulk: 0.35,
    back: '#2f4a96',
    belly: '#e9ecf6',
    finlet: '#c9d3ff',
  },
};

const ORDER: SpeciesId[] = ['albacore', 'yellowfin', 'bigeye', 'bluefin'];

/** Pick a species. `bigBias` multiplies the odds of the heavyweights (bigeye, bluefin). */
export function rollSpecies(rng: Rng, bigBias = 1): Species {
  const w = ORDER.map((id) => SPECIES[id].freq * (id === 'bigeye' || id === 'bluefin' ? bigBias : 1));
  let r = rng.next() * w.reduce((a, b) => a + b, 0);
  for (const [i, id] of ORDER.entries()) {
    r -= w[i] as number;
    if (r <= 0) return SPECIES[id];
  }
  return SPECIES.yellowfin;
}

/** Weight in kg, skewed towards the smaller end of the range (big ones are rare). */
export function rollWeight(rng: Rng, s: Species): number {
  return Math.round(s.kgMin + (s.kgMax - s.kgMin) * rng.next() ** 1.7);
}

/** 0..1 where a fish sits in its species' size range. */
export const sizeFrac = (s: Species, kg: number): number =>
  Math.min(1, Math.max(0, (kg - s.kgMin) / Math.max(1, s.kgMax - s.kgMin)));
