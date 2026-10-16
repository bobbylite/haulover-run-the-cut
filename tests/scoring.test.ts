import { describe, expect, it } from 'vitest';
import { computeScore, parTime } from '../src/game/scoring';

describe('scoring', () => {
  const base = {
    time: 100,
    par: 120,
    peakFrac: 0.1,
    offsets: [0, 0.2, -0.4, null],
    collisions: 0,
    difficultyMult: 1,
  };

  it('rewards speed, dryness and clean gates', () => {
    const a = computeScore(base);
    const slower = computeScore({ ...base, time: 160 });
    const wetter = computeScore({ ...base, peakFrac: 0.9 });
    const crashed = computeScore({ ...base, collisions: 3 });
    expect(a.score).toBeGreaterThan(slower.score);
    expect(a.score).toBeGreaterThan(wetter.score);
    expect(a.score).toBeGreaterThan(crashed.score);
    expect(a.stars).toBe(3);
  });

  it('scales with difficulty and never goes negative', () => {
    expect(computeScore({ ...base, difficultyMult: 2 }).score).toBeGreaterThan(computeScore(base).score);
    expect(computeScore({ ...base, collisions: 99, time: 999, peakFrac: 1 }).score).toBe(0);
  });

  it('a sound hull and a well-ridden sea are worth points', () => {
    const sound = computeScore({ ...base, hull: 1 });
    const battered = computeScore({ ...base, hull: 0.3 });
    expect(sound.score).toBeGreaterThan(battered.score);
    expect(sound.parts.hull).toBeGreaterThan(battered.parts.hull);

    const rider = computeScore({ ...base, ride: 400 });
    expect(rider.score).toBe(computeScore(base).score + 400);
    expect(rider.parts.ride).toBe(400);
  });

  it('caps the streak bonus so it cannot swamp the run', () => {
    expect(computeScore({ ...base, ride: 99999 }).parts.ride).toBe(900);
    expect(computeScore({ ...base, ride: -50 }).parts.ride).toBe(0);
  });

  it('par time grows with course length and shrinks with boat speed', () => {
    expect(parTime(2000, 10)).toBeGreaterThan(parTime(2000, 20));
    expect(parTime(3000, 10)).toBeGreaterThan(parTime(2000, 10));
  });
});
