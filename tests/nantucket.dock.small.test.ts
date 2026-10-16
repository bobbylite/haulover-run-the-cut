// The docking challenge must be possible. The harbour pilot (a crude skipper: follow the approach, brake on a
// profile, square up, hold the mark) has to berth every small-craft, cruiser and tug level in the conditions
// the level suggests, and in the other tides too.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/games/nantucket/levels';
import { runLevel, runLevelCached } from './nantHarness';

const small = LEVELS.filter((l) => l.tier <= 3);

describe('the pilot berths the small craft, cruisers and tug', () => {
  it.each(small)(
    '$id docks in its own conditions, inside the clock, without wrecking anything',
    (l) => {
      const r = runLevelCached(l);
      expect(r.outcome, `${r.outcome} ended ${r.dist.toFixed(0)} m off`).toBe('docked');
      expect(r.t).toBeLessThan(l.time);
      expect(r.hull).toBeGreaterThan(0.8);
      expect(r.stars).toBeGreaterThanOrEqual(1);
    },
    120000,
  );

  it('and the same berths in the other tides, for the heavier and more tide-proof hulls', () => {
    for (const id of ['sunset-quay', 'lady-straight']) {
      const l = LEVELS.find((x) => x.id === id) as (typeof LEVELS)[number];
      for (const tide of ['slack', 'flood'] as const) {
        const r = runLevelCached(l, { tide, limit: l.time * 1.2 });
        expect(r.outcome, `${id} ${tide}: ${r.outcome} ${r.dist.toFixed(0)} m off`).toBe('docked');
      }
    }
  }, 300000);

  it('is deterministic: the same run twice ends the same way', () => {
    const l = LEVELS[0] as (typeof LEVELS)[number];
    const a = runLevel(l);
    const b = runLevel(l);
    expect(b).toEqual(a);
  }, 120000);
});
