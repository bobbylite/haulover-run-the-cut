// The berth rules: where each kind of berth wants a hull, how forgiving the finish is, how a session watches an
// attempt, how it scores, and how the tugs lean on a ship. All pure: no renderer.
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { BerthSession, berthAxis, berthRules, berthTarget } from '../src/game/berthing';
import { scoreBerth } from '../src/game/berthScore';
import { BERTHS, berthById, FREE_SLIPS, SLIP_HEAD, slipX } from '../src/locations/nantucket/geography';
import { Boat } from '../src/sim/boat';
import { PUSH_S, TugCrew, tugForce } from '../src/sim/tugs';
import { calmEnv } from './helpers';

const small = { length: 7.4, beam: 2.5 };
const liner = { length: 116, beam: 22.5 };

describe('where a hull has to finish', () => {
  it('a slip: the middle of the hull a half-length and a fender short of the closed end, on the axis', () => {
    const b = berthById('easy-3');
    const t = berthTarget(b, small);
    expect(t.x).toBeCloseTo(slipX(FREE_SLIPS[0] as number), 3);
    expect(t.z).toBeCloseTo(SLIP_HEAD - (small.length / 2 + 1.1), 3);
    expect(t.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it('a wharf: lying against the face a fender off it, along the quay', () => {
    const b = berthById('steamship-east');
    const t = berthTarget(b, liner);
    // the face is x = -300 and the water is to the east
    expect(t.x).toBeCloseTo(-300 + liner.beam / 2 + 0.6, 3);
    expect(t.z).toBeCloseTo(225, 3);
    expect(Math.abs(Math.sin(t.heading))).toBeCloseTo(1, 5);
    expect(Math.abs(Math.sin(berthAxis(b)))).toBeCloseTo(1, 5);
  });

  it('a bigger hull sits further out from the face', () => {
    const b = berthById('steamship-east');
    expect(berthTarget(b, liner).x).toBeGreaterThan(berthTarget(b, small).x);
  });

  it('a mooring is the ball itself', () => {
    const b = berthById('moor-b');
    const t = berthTarget(b, small);
    expect(t.x).toBe(b.x);
    expect(t.z).toBe(b.z);
  });
});

describe('how forgiving the finish is', () => {
  it('a ship gets more slack in metres across and along, but less in degrees, and a lower speed limit', () => {
    const b = berthById('steamship-east');
    const a = berthRules(b, small);
    const c = berthRules(b, liner);
    expect(c.along).toBeGreaterThan(a.along);
    expect(c.across).toBeGreaterThan(a.across);
    expect(c.align).toBeLessThan(a.align);
    expect(c.speed).toBeLessThan(a.speed);
    expect(c.hold).toBeGreaterThan(a.hold);
  });

  it('every berth has sane tolerances for every hull', () => {
    for (const b of BERTHS) {
      for (const v of [small, liner]) {
        const r = berthRules(b, v);
        expect(r.speed, b.id).toBeGreaterThan(0.3);
        expect(r.speed, b.id).toBeLessThan(1.1);
        expect(r.hold, b.id).toBeGreaterThan(1);
      }
    }
  });
});

/** Put a boat exactly where and how a test wants it. */
function placed(id: string, x: number, z: number, heading: number, sog = 0): Boat {
  const spec = boatById(id);
  const b = new Boat(spec);
  const env = calmEnv();
  b.reset(x, z, heading, env);
  b.vel.set(Math.cos(heading) * sog, 0, Math.sin(heading) * sog);
  b.update(1 / 60, env);
  return b;
}

function hold(b: Boat, s: BerthSession, seconds: number): 'docked' | 'timeout' | null {
  const env = calmEnv();
  let r: 'docked' | 'timeout' | null = null;
  for (let t = 0; t < seconds && !r; t += 1 / 30) {
    // park the boat on the mark: pin it, as a test of the rules and not of the physics
    r = s.update(1 / 30, b, env);
  }
  return r;
}

describe('a berth session', () => {
  it('docks a boat that is on the mark, square and still, after the hold time', () => {
    const berth = berthById('easy-3');
    const spec = boatById('console');
    const s = new BerthSession(berth, spec);
    s.start(120);
    const t = berthTarget(berth, spec);
    const b = placed('console', t.x, t.z, t.heading);
    expect(hold(b, s, 20)).toBe('docked');
    expect(s.finish).not.toBeNull();
  });

  it('accepts either end of a slip: stern-in is as good as bow-in', () => {
    const berth = berthById('easy-3');
    const spec = boatById('console');
    const s = new BerthSession(berth, spec);
    s.start(120);
    const t = berthTarget(berth, spec);
    const b = placed('console', t.x, t.z, t.heading + Math.PI);
    expect(hold(b, s, 20)).toBe('docked');
  });

  it('does not dock a boat that is too fast, crooked, or off the mark', () => {
    const berth = berthById('easy-3');
    const spec = boatById('console');
    const t = berthTarget(berth, spec);
    const cases: [string, Boat][] = [
      ['fast', placed('console', t.x, t.z, t.heading, 3)],
      ['crooked', placed('console', t.x, t.z, t.heading + 0.7)],
      ['off along', placed('console', t.x, t.z - 12, t.heading)],
      ['off across', placed('console', t.x + 7, t.z, t.heading)],
    ];
    for (const [name, b] of cases) {
      const s = new BerthSession(berth, spec);
      s.start(120);
      expect(hold(b, s, 3), name).toBeNull();
      expect(s.hold, name).toBe(0);
    }
  });

  it('times out when the clock runs down', () => {
    const berth = berthById('easy-3');
    const spec = boatById('console');
    const s = new BerthSession(berth, spec);
    s.start(5);
    const b = placed('console', 0, 0, 0);
    expect(hold(b, s, 10)).toBe('timeout');
  });

  it('a mooring is picked up with the bow, not the middle of the hull', () => {
    const berth = berthById('moor-b');
    const spec = boatById('console');
    const s = new BerthSession(berth, spec);
    s.start(60);
    // bow on the ball, heading east: the middle is a half-length (less a metre) short
    const b = placed('console', berth.x - (spec.length * 0.5 - 1), berth.z, 0);
    expect(hold(b, s, 10)).toBe('docked');
    const s2 = new BerthSession(berth, spec);
    s2.start(60);
    // the middle on the ball is a bow-length too far: the bow is well past it
    const c = placed('console', berth.x, berth.z, 0);
    expect(hold(c, s2, 5)).toBeNull();
  });

  it('measures the error in the berth frame: along the wharf, and out from it', () => {
    const berth = berthById('steamship-east');
    const spec = boatById('liner');
    const s = new BerthSession(berth, spec);
    s.start(60);
    const t = berthTarget(berth, spec);
    // 10 m out from the target, 20 m along the quay
    const b = placed('liner', t.x + 10, t.z + 20, Math.PI / 2);
    s.update(1 / 30, b, calmEnv());
    expect(s.status.across).toBeGreaterThan(8);
    expect(Math.abs(s.status.along)).toBeGreaterThan(15);
    expect(s.status.posOk).toBe(false);
  });

  it('tells a ship how far full astern needs to stop it', () => {
    const berth = berthById('steamship-east');
    const spec = boatById('liner');
    const s = new BerthSession(berth, spec);
    s.start(60);
    const b = placed('liner', -150, 100, Math.PI / 2, 3);
    s.update(1 / 30, b, calmEnv());
    expect(s.status.stopDist).toBeGreaterThan(60);
    expect(s.status.stopDist).toBeLessThan(400);
  });
});

describe('scoring a berth', () => {
  const rules = berthRules(berthById('easy-3'), small);
  const base = {
    docked: true,
    timeFrac: 0.6,
    along: 0.3,
    across: 0.2,
    align: 0.03,
    speed: 0.1,
    rules,
    touches: 0,
    hull: 1,
    tugCalls: 0,
    tugFree: 0,
    mult: 1,
  };

  it('scores nothing and no stars if you did not dock', () => {
    const r = scoreBerth({ ...base, docked: false });
    expect(r.score).toBe(0);
    expect(r.stars).toBe(0);
  });

  it('a clean, quick, exact berth is three stars; bumps, tugs and a damaged hull cost stars and points', () => {
    const clean = scoreBerth(base);
    expect(clean.stars).toBe(3);
    const bumped = scoreBerth({ ...base, touches: 2 });
    expect(bumped.score).toBeLessThan(clean.score);
    expect(bumped.stars).toBeLessThan(3);
    const tugged = scoreBerth({ ...base, tugCalls: 3 });
    expect(tugged.score).toBeLessThan(clean.score);
    const sloppy = scoreBerth({
      ...base,
      along: rules.along * 0.9,
      across: rules.across * 0.9,
      align: rules.align * 0.9,
    });
    expect(sloppy.score).toBeLessThan(clean.score);
    expect(scoreBerth({ ...base, hull: 0.6 }).stars).toBeLessThan(3);
    expect(scoreBerth({ ...base, timeFrac: 0.05 }).stars).toBeLessThan(3);
  });

  it('free tug calls cost nothing, and the multiplier scales the score', () => {
    expect(scoreBerth({ ...base, tugCalls: 2, tugFree: 2 }).stars).toBe(3);
    expect(Math.abs(scoreBerth({ ...base, mult: 2 }).score - scoreBerth(base).score * 2)).toBeLessThanOrEqual(
      1,
    );
  });

  it('a berth, however bad, is always at least one star', () => {
    expect(scoreBerth({ ...base, touches: 9, hull: 0.1, timeFrac: 0, tugCalls: 9 }).stars).toBe(1);
  });
});

describe('the tugs', () => {
  const spec = boatById('liner');

  it('a bow push to starboard shoves the bow over, and the call comes out of the budget', () => {
    const env = calmEnv();
    const b = new Boat(spec);
    b.reset(0, 0, 0, env);
    const crew = new TugCrew(spec, 3);
    expect(crew.request('bow-stbd')).toBe(true);
    expect(crew.callsLeft).toBe(2);
    for (let t = 0; t < PUSH_S + 2; t += 1 / 30) {
      crew.update(1 / 30, b);
      b.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
      b.update(1 / 30, env);
    }
    // sideways to starboard, and the bow swung round to starboard (heading up)
    expect(b.vel.z).toBeGreaterThan(0.1);
    expect(b.heading).toBeGreaterThan(0.01);
  });

  it('a stern push to port turns the bow to starboard but shoves the stern to port', () => {
    const env = calmEnv();
    const b = new Boat(spec);
    b.reset(0, 0, 0, env);
    const crew = new TugCrew(spec, 3);
    crew.request('stern-port');
    for (let t = 0; t < PUSH_S + 2; t += 1 / 30) {
      crew.update(1 / 30, b);
      b.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
      b.update(1 / 30, env);
    }
    expect(b.vel.z).toBeLessThan(-0.05);
    expect(b.heading).toBeGreaterThan(0.01);
  });

  it('there is a budget: no calls left, no push', () => {
    const crew = new TugCrew(spec, 1);
    expect(crew.request('hold')).toBe(true);
    expect(crew.request('bow-port')).toBe(false);
    expect(crew.used).toBe(1);
  });

  it('hold brakes a moving ship much faster than coasting', () => {
    const env = calmEnv();
    const a = new Boat(spec);
    a.reset(0, 0, 0, env);
    a.vel.x = 2;
    const b = new Boat(spec);
    b.reset(0, 0, 0, env);
    b.vel.x = 2;
    const crew = new TugCrew(spec, 2);
    crew.request('hold');
    for (let t = 0; t < 14; t += 1 / 30) {
      crew.update(1 / 30, b);
      for (const x of [a, b]) {
        x.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
        x.update(1 / 30, env);
      }
    }
    expect(b.sog).toBeLessThan(a.sog * 0.8);
  });

  it('the push is a few hundredths of a g on the ship, so a bigger ship gets a bigger tug', () => {
    expect(tugForce(boatById('liner'))).toBeGreaterThan(tugForce(boatById('ferry')));
    expect(tugForce(boatById('ferry')) / boatById('ferry').mass).toBeCloseTo(0.055, 3);
  });
});
