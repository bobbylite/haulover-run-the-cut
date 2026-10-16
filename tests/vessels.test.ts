// The fleet must not feel like five reskins: each hull answers the wind and the tide in its own way, and
// the sloop is the hardest boat to drive.
import { describe, expect, it } from 'vitest';
import { BOATS, boatById } from '../src/data/boats';
import { Boat } from '../src/sim/boat';
import { SKILL_LABELS } from '../src/sim/boatSpec';
import { calmEnv } from './helpers';

const DEG = 180 / Math.PI;
const DT = 1 / 60;

/** Idle for a while in a 10 m/s wind blowing across the beam (from port to starboard). */
function beamWind(id: string) {
  const env = calmEnv();
  env.windAt = (_x, _z, out) => {
    out.x = 0;
    out.z = 10;
  };
  const b = new Boat(boatById(id));
  b.reset(0, 0, 0);
  b.sailUp = false;
  for (let i = 0; i < 46 / DT; i++) {
    env.time += DT;
    b.update(DT, env);
  }
  // heading < 0: the bow has come up into the wind (weathercock); > 0: it has been blown off
  return { drift: b.vel.z, heading: b.heading * DEG };
}

/** Motor into a 2.5 m/s current at 70% throttle; returns ground speed. */
function againstTide(id: string): number {
  const env = calmEnv();
  env.currentAt = (_x, _z, out) => {
    out.x = 2.5;
    out.z = 0;
  };
  const b = new Boat(boatById(id));
  b.reset(0, 0, Math.PI);
  b.sailUp = false;
  b.setInput({ throttle: 0.7, steer: 0, sheet: 0.5, pump: false });
  for (let i = 0; i < 40 / DT; i++) {
    env.time += DT;
    b.update(DT, env);
  }
  return -b.vel.x;
}

/** Cross a band where the current ramps from nothing to 3 m/s over 30 m (the throat of the Cut). */
function crossShear(id: string): number {
  const env = calmEnv();
  env.currentAt = (x, _z, out) => {
    const t = Math.max(0, Math.min(1, (x - 100) / 30));
    out.x = 3 * t;
    out.z = 0.8 * t;
  };
  const spec = boatById(id);
  const b = new Boat(spec);
  b.reset(40, 0, 0);
  b.sailUp = false;
  let swing = 0;
  for (let i = 0; i < 40 / DT; i++) {
    env.time += DT;
    const want = Math.min(8, spec.topSpeed * 0.6);
    b.setInput({
      throttle: Math.max(0, Math.min(1, 0.5 + 0.12 * (want - b.speed))),
      steer: 0,
      sheet: 0.5,
      pump: false,
    });
    b.update(DT, env);
    if (b.pos.x > 90 && b.pos.x < 200) swing = Math.max(swing, Math.abs(b.heading) * DEG);
  }
  return swing;
}

describe('wind: every hull has its own windage and its own weathervane', () => {
  const w = Object.fromEntries(BOATS.map((b) => [b.id, beamWind(b.id)]));

  it('the pontoon is a sail: it skates downwind far faster than anything else', () => {
    for (const id of ['console', 'gofast', 'cruiser', 'sloop'])
      expect(w.pontoon?.drift, id).toBeGreaterThan(1.5 * (w[id]?.drift ?? 0));
  });

  it('the low go-fast and the keel boat barely drift', () => {
    expect(w.gofast?.drift).toBeLessThan(0.6);
    expect(w.sloop?.drift).toBeLessThan(0.6);
  });

  it('light boats with windage aft weathercock: the bow comes up into the wind', () => {
    for (const id of ['console', 'gofast', 'pontoon']) expect(w[id]?.heading, id).toBeLessThan(-30);
  });

  it('the flybridge cruiser does the opposite: its bow blows off', () => {
    expect(w.cruiser?.heading).toBeGreaterThan(20);
  });

  it('the keel holds the sloop on its heading', () => {
    expect(Math.abs(w.sloop?.heading ?? 99)).toBeLessThan(15);
  });
});

describe('tide: the same ebb sets each hull differently', () => {
  it('a fast boat shrugs off a 2.5 m/s ebb, a slow one is held back', () => {
    const g = Object.fromEntries(BOATS.map((b) => [b.id, againstTide(b.id)]));
    expect(g.gofast).toBeGreaterThan(g.console as number);
    expect(g.console).toBeGreaterThan(g.cruiser as number);
    expect(g.cruiser).toBeGreaterThan(g.pontoon as number);
    expect(g.pontoon).toBeGreaterThan(g.sloop as number);
    // the sloop's little motor can barely stem it
    expect(g.sloop).toBeLessThan(1.8);
    expect(g.console).toBeGreaterThan(10);
  }, 60000);

  it('a long hull in the throat is slewed by the shear; a short fast one is not', () => {
    expect(crossShear('console')).toBeLessThan(2);
    expect(crossShear('cruiser')).toBeGreaterThan(2 * crossShear('console'));
    expect(crossShear('sloop')).toBeGreaterThan(3 * crossShear('console'));
  }, 60000);
});

describe('the fleet ladder', () => {
  it('the sloop is the hardest boat to drive, and pays the most for it', () => {
    const sloop = boatById('sloop');
    expect(sloop.skill).toBe(5);
    for (const b of BOATS) {
      if (b.id === 'sloop') continue;
      expect(sloop.skill, b.id).toBeGreaterThan(b.skill);
      expect(sloop.scoreMult, b.id).toBeGreaterThan(b.scoreMult);
    }
    expect(SKILL_LABELS[sloop.skill]).toBe('Expert');
  });

  it('every boat has a rating, a multiplier and a tide stat', () => {
    for (const b of BOATS) {
      expect(b.skill, b.id).toBeGreaterThanOrEqual(1);
      expect(b.skill, b.id).toBeLessThanOrEqual(5);
      expect(b.scoreMult, b.id).toBeGreaterThan(0.5);
      expect(b.stats.tide, b.id).toBeGreaterThanOrEqual(0);
      expect(b.stats.tide, b.id).toBeLessThanOrEqual(1);
    }
    // the stat bars agree with the physics: the sloop is the most tide-bound, the go-fast the least
    expect(boatById('sloop').stats.tide).toBe(Math.max(...BOATS.map((b) => b.stats.tide)));
    expect(boatById('gofast').stats.tide).toBe(Math.min(...BOATS.map((b) => b.stats.tide)));
  });
});
