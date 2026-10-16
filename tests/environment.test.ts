import { describe, expect, it } from 'vitest';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { HAULOVER } from '../src/locations/haulover';
import { Environment } from '../src/sim/environment';
import { makeWaveSample } from '../src/sim/waves';

const make = (weather: string, tide: 'ebb' | 'flood' | 'slack') => {
  const env = new Environment(HAULOVER);
  env.setConditions(weatherById(weather), tide, difficultyById('weekender'), true);
  return env;
};

describe('environment', () => {
  it('ebb sets out to sea (east) and flood comes in, strongest in the throat', () => {
    const ebb = make('breeze', 'ebb');
    const flood = make('breeze', 'flood');
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    // the throat of the cut, between the bridge and the jetties
    ebb.currentAt(60, 0, a);
    flood.currentAt(60, 0, b);
    expect(a.x).toBeGreaterThan(1);
    expect(b.x).toBeLessThan(-1);
    // open ocean has almost no tidal current
    ebb.currentAt(1700, 0, a);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(0.6);
  });

  it('is deterministic: same time and place gives the same wave', () => {
    const env = make('squall', 'ebb');
    const s1 = env.waveAt(310, 12);
    const s2 = env.waveAt(310, 12, makeWaveSample());
    expect(s1.h).toBe(s2.h);
    expect(Number.isFinite(s1.h)).toBe(true);
  });

  it('wind against the ebb stands the waves up at the mouth', () => {
    // squall (wind from the east) against a strong ebb produces much bigger water than a calm morning
    const rough = make('squall', 'ebb');
    const calm = make('golden', 'ebb');
    const range = (env: Environment) => {
      let lo = 1e9;
      let hi = -1e9;
      const s = makeWaveSample();
      for (let x = 300; x < 460; x += 3) {
        for (let t = 0; t < 12; t += 0.25) {
          env.waves.sample(x, 0, t, s);
          lo = Math.min(lo, s.h);
          hi = Math.max(hi, s.h);
        }
      }
      return hi - lo;
    };
    expect(range(rough)).toBeGreaterThan(range(calm) * 1.8);
  });

  it('the seabed is land outside the cut and deep water offshore', () => {
    const env = make('golden', 'slack');
    expect(env.depthAt(1500, 0)).toBeGreaterThan(5);
    expect(env.depthAt(60, 400)).toBeLessThan(1);
  });
});
