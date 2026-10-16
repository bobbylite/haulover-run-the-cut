// The island ferry: 46 m of windage with twin screws and a bow thruster. The pilot has to berth it on both
// faces of Steamship Wharf, inside the clock.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/games/nantucket/levels';
import { runLevelCached as runLevel } from './nantHarness';

describe('the pilot berths the ferry', () => {
  it.each(LEVELS.filter((l) => l.boat === 'ferry'))(
    '$id docks, inside the clock, with the hull in one piece',
    (l) => {
      const r = runLevel(l);
      expect(r.outcome, `${r.outcome} ended ${r.dist.toFixed(0)} m off`).toBe('docked');
      expect(r.t).toBeLessThan(l.time);
      expect(r.hull).toBeGreaterThan(0.7);
      expect(r.tugs).toBeLessThanOrEqual(l.tugs);
    },
    180000,
  );
});
