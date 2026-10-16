// The ships (tug, ferry, cruise ship) run on the same rigid-body physics as the small boats. They have to
// float level, reach the speed they are rated for, stop in a sensible distance, answer the twin screws and
// the thrusters, and report a touch against a wall.
import { describe, expect, it } from 'vitest';
import { ALL_BOATS, boatById, HULL_OPTS, SHIPS } from '../src/data/boats';
import { Boat, type BoatEnv } from '../src/sim/boat';
import { calmEnv } from './helpers';

const DT = 1 / 30;
const DEG = 180 / Math.PI;

function run(
  id: string,
  secs: number,
  input: (t: number, b: Boat) => { throttle?: number; steer?: number; bow?: number; stern?: number },
  env: BoatEnv = calmEnv(),
  setup?: (b: Boat) => void,
): Boat {
  const b = new Boat(boatById(id));
  b.reset(0, 0, 0, env);
  setup?.(b);
  for (let i = 0; i < secs / DT; i++) {
    b.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false, ...input(i * DT, b) });
    b.update(DT, env);
    env.time += DT;
  }
  return b;
}

describe('the ships exist and are registered', () => {
  it('three ships, after the small boats, with hull data for the models', () => {
    expect(SHIPS.map((s) => s.id)).toEqual(['tug', 'ferry', 'liner']);
    expect(ALL_BOATS.length).toBe(9);
    for (const s of SHIPS) {
      expect(HULL_OPTS.get(s.id), s.id).toBeDefined();
      expect(boatById(s.id).id).toBe(s.id);
      expect(s.thrusters, s.id).toBeDefined();
      expect(s.engine.pivot, s.id).toBeGreaterThan(0);
    }
  });

  it('they are heavier, longer and harder than the boats before them', () => {
    expect(SHIPS.map((s) => s.length)).toEqual([...SHIPS.map((s) => s.length)].sort((a, b) => a - b));
    expect(SHIPS.map((s) => s.scoreMult)).toEqual([...SHIPS.map((s) => s.scoreMult)].sort((a, b) => a - b));
    expect(SHIPS[2]?.mass as number).toBeGreaterThan(1e6);
  });
});

describe.each(SHIPS)('$id', (spec) => {
  it('floats level at its design waterline', () => {
    const b = run(spec.id, 30, () => ({}));
    expect(Math.abs(b.pos.y - spec.cg[1])).toBeLessThan(0.05);
    expect(Math.abs(b.pitch * DEG)).toBeLessThan(0.3);
    expect(Math.abs(b.heelDeg)).toBeLessThan(0.3);
  });

  it('reaches roughly the top speed it is rated for', () => {
    const b = run(spec.id, 420, () => ({ throttle: 1 }));
    expect(b.speed).toBeGreaterThan(spec.topSpeed * 0.9);
    expect(b.speed).toBeLessThan(spec.topSpeed * 1.1);
  }, 30000);

  it('stops from 4 m/s with full astern, a ship taking its time about it', () => {
    const e = calmEnv();
    const b = new Boat(spec);
    b.reset(0, 0, 0, e);
    b.vel.x = 4;
    let t = 0;
    do {
      b.setInput({ throttle: -1, steer: 0, sheet: 0.5, pump: false });
      b.update(DT, e);
      t += DT;
    } while (b.speed > 0.2 && t < 600);
    expect(t).toBeLessThan(150);
    // ... and never inside half a hull length, which would be a sports car
    expect(b.pos.x).toBeGreaterThan(spec.length * 0.2);
    expect(b.pos.x).toBeLessThan(spec.length * 3);
  });

  it('the twin screws turn it on the spot, and slowly in proportion to its size', () => {
    const b = run(spec.id, 30, () => ({ steer: 1 }));
    // to starboard: the heading goes up
    expect(b.heading).toBeGreaterThan(0.05);
    expect(b.sog).toBeLessThan(0.6);
  });

  it('the bow thruster swings the bow, and with a stern thruster too it slides sideways', () => {
    const turn = run(spec.id, 25, () => ({ bow: 1 }));
    expect(turn.heading).toBeGreaterThan(0.05);
    const th = spec.thrusters;
    if (th?.bow && th.stern) {
      // balance the pair so it does not swing
      const bow = Math.min(1, th.stern.force / th.bow.force);
      const stern = Math.min(1, th.bow.force / th.stern.force);
      const slide = run(spec.id, 25, () => ({ bow, stern }));
      expect(slide.vel.z).toBeGreaterThan(0.2);
      expect(Math.abs(slide.heading)).toBeLessThan(0.15);
    }
  });

  it('reports a touch against a wall and does not go through it', () => {
    const wall = calmEnv();
    wall.hardAt = (x) => 60 - x;
    wall.hardNormal = (_x, _z, out) => {
      out.x = -1;
      out.z = 0;
    };
    let seen = 0;
    const b = new Boat(spec);
    b.impactMin = 0.3;
    b.reset(60 - spec.length * 0.5 - 12, 0, 0, wall);
    b.vel.x = 0.8;
    let maxX = -1e9;
    for (let i = 0; i < 120 / DT; i++) {
      b.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
      b.update(DT, wall);
      for (const im of b.impacts) seen = Math.max(seen, im.speed);
      b.impacts.length = 0;
      maxX = Math.max(maxX, b.pos.x + spec.length * 0.5 - (spec.cg[0] - (spec.samples[0]?.x ?? 0)) * 0);
    }
    expect(seen).toBeGreaterThan(0.3);
    expect(maxX).toBeLessThan(60 + 3);
  });
});

describe('a ship leans on a beam wind', () => {
  it('and the liner, with the most windage, drifts fastest in a given blow', () => {
    const drift = (id: string) => {
      const env = calmEnv();
      env.windAt = (_x, _z, out) => {
        out.x = 0;
        out.z = 10;
      };
      return run(id, 120, () => ({}), env).vel.z;
    };
    const ferry = drift('ferry');
    const liner = drift('liner');
    expect(ferry).toBeGreaterThan(0.1);
    expect(liner).toBeGreaterThan(0.1);
    // more side area per tonne
    expect(ferry / liner).toBeGreaterThan(0.7);
  });
});
