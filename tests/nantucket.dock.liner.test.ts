// The cruise ship: 116 m, seven thousand tonnes of momentum. The pilot has to berth it in both its levels, it has to
// be clearly the hardest berth in the game, and the tugs have to be there to help without being mandatory.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/games/nantucket/levels';
import { runLevelCached as runLevel } from './nantHarness';

const liners = LEVELS.filter((l) => l.boat === 'liner');

describe('the pilot berths the cruise ship', () => {
  it.each(liners)(
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

  it('is the hardest berth: no better than the ferry for stars, and slower', () => {
    const ferry = runLevel('ferry-east');
    const liner = runLevel('liner-east');
    expect(liner.stars).toBeLessThanOrEqual(ferry.stars);
    expect(liner.t).toBeGreaterThan(ferry.t);
  }, 240000);

  it('without the tugs the pilot may fail the ship, but it never wrecks it', () => {
    const r = runLevel('liner-east', { tugs: false });
    expect(['docked', 'timeout']).toContain(r.outcome);
    expect(r.hull).toBeGreaterThan(0.5);
  }, 240000);
});
