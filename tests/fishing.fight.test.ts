// The fight, balanced with scripted captains on a kinematic boat (fast). The real boat on the real sea is
// covered in montauk.mode.test.ts. What this pins: a competent captain lands tuna, the wrong habits lose
// them for understandable reasons, and the tiers get harder.
import { describe, expect, it } from 'vitest';
import { Fight, type FightInput } from '../src/sim/fishing/fight';
import { SPECIES } from '../src/sim/fishing/species';
import { tierById } from '../src/sim/fishing/tiers';
import { captain, fightOnce, idle, keepGoing, landRate, lockedDrag, powerAway } from './fishHarness';

describe('the fight', () => {
  it('is deterministic for a seed', () => {
    const a = fightOnce('weekender', 'yellowfin', 55, 9, captain);
    const b = fightOnce('weekender', 'yellowfin', 55, 9, captain);
    expect(a).toEqual(b);
  });

  it('a competent captain lands most yellowfin on the easier tiers', () => {
    expect(landRate('dockside', 'yellowfin', 55, captain, 30).rate).toBeGreaterThan(0.6);
    expect(landRate('weekender', 'yellowfin', 55, captain, 30).rate).toBeGreaterThan(0.5);
  });

  it('and still lands some on the hardest, against a big bluefin', () => {
    const r = landRate('legend', 'bluefin', 160, captain, 30);
    expect(r.rate).toBeGreaterThan(0.08);
    expect(r.rate).toBeLessThan(0.6);
  });

  it('is harder on the harder tiers (bluefin, same captain)', () => {
    const rate = (t: string) => landRate(t, 'bluefin', 160, captain, 30).rate;
    const [d, m, c, l] = [rate('dockside'), rate('weekender'), rate('captain'), rate('legend')];
    expect(d).toBeGreaterThanOrEqual(m - 0.1);
    expect(m).toBeGreaterThanOrEqual(c - 0.1);
    expect(c).toBeGreaterThanOrEqual(l - 0.1);
    expect(d).toBeGreaterThan(l + 0.2);
  });

  it('a fight is a minute or two, not seconds and not forever', () => {
    const r = landRate('weekender', 'yellowfin', 55, captain, 30);
    expect(r.meanT).toBeGreaterThan(45);
    expect(r.meanT).toBeLessThan(170);
  });

  it('bad habits lose the fish', () => {
    // powering away from the fish parts the line, whatever else is right
    const away = landRate('weekender', 'yellowfin', 55, powerAway, 20);
    expect(away.rate).toBe(0);
    expect(away.ends.snapped).toBe(20);
    // carrying on at troll speed after the strike is no better
    expect(landRate('weekender', 'yellowfin', 55, keepGoing, 20).rate).toBe(0);
    // locking the drag down and sitting still
    expect(landRate('weekender', 'yellowfin', 55, lockedDrag, 20).rate).toBeLessThan(0.25);
  });

  it('doing nothing is a poor plan: far worse than captaining', () => {
    for (const tier of ['dockside', 'weekender', 'captain']) {
      const good = landRate(tier, 'yellowfin', 55, captain, 24).rate;
      const nothing = landRate(tier, 'yellowfin', 55, idle, 24).rate;
      expect(nothing, tier).toBeLessThan(0.25);
      expect(nothing, tier).toBeLessThan(good * 0.5);
    }
  });

  it('every loss has a reason the player can act on', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = fightOnce('captain', 'yellowfin', 55, seed, seed % 2 ? powerAway : idle);
      expect(['snapped', 'pulled', 'cut', 'landed', 'timeout']).toContain(r.end);
    }
  });

  it('a hull slam is a tension spike that is bigger on a loaded line', () => {
    const make = () =>
      new Fight(SPECIES.yellowfin, 55, tierById('weekender'), 3, { x: -30, z: 0, depth: 6, line: 36 });
    const inp = (slam: number): FightInput => ({
      sx: 0,
      sz: 0,
      fx: 1,
      fz: 0,
      vx: 0,
      vz: 0,
      boatLen: 11,
      slam,
      rough: 0.7,
      floor: () => 40,
      current: (_x, _z, o) => {
        o.x = 0;
        o.z = 0;
      },
      drag: 0.5,
      pump: false,
    });
    const spikeAfter = (preload: number) => {
      const f = make();
      f.T = preload;
      f.step(1 / 60, inp(8));
      return f.spike;
    };
    expect(spikeAfter(0.1)).toBeGreaterThan(0.08);
    expect(spikeAfter(0.7)).toBeGreaterThan(spikeAfter(0.1) + 0.2);
  });

  it('losing is decided on the average load: the sea rocking the tip does not hide a slack line', () => {
    const f = new Fight(SPECIES.yellowfin, 55, tierById('weekender'), 3, {
      x: -12,
      z: 0,
      depth: 6,
      line: 80,
    });
    f.mood = 'thrash';
    // slack line (80 m out, fish 12 m away) with the stern heaving a metre: tension flickers but stays low
    let t = 0;
    while (!f.end && t < 40) {
      f.step(1 / 30, {
        sx: 0,
        sz: 0,
        fx: 1,
        fz: 0,
        vx: 0,
        vz: 0,
        boatLen: 11,
        slam: 0,
        rough: 0.7,
        heave: 1.1 * Math.sin((t / 7.5) * Math.PI * 2),
        floor: () => 40,
        current: (_x, _z, o) => {
          o.x = 0;
          o.z = 0;
        },
        drag: 0.5,
        pump: false,
      });
      t += 1 / 30;
    }
    expect(f.end?.kind).toBe('pulled');
  });
});
