// The wave-attack rules: take rough water at ~45 degrees to the wave axis. Pure maths first, then the
// headless physics proving the rules bite: a clean line stays dry and sound, head-on and beam-on do not.
import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../src/core/math';
import { boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';
import {
  attackAngle,
  attackBad,
  CLEAN_PERIOD,
  damageFactor,
  gradeLanding,
  IDEAL_ATTACK,
  seaRoughness,
  WaveRide,
  waterFactor,
} from '../src/sim/waveRide';
import { makeWaveAxis } from '../src/sim/waves';

const RAD = Math.PI / 180;

describe('wave attack rules', () => {
  it('folds the heading against the wave axis into 0..90 degrees', () => {
    expect(attackAngle(0, 0)).toBeCloseTo(0);
    expect(attackAngle(Math.PI, 0)).toBeCloseTo(0); // running with the sea is the same axis
    expect(attackAngle(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2);
    expect(attackAngle(45 * RAD, 0)).toBeCloseTo(IDEAL_ATTACK);
    expect(attackAngle(135 * RAD, 0)).toBeCloseTo(IDEAL_ATTACK); // a following quartering sea counts too
    expect(attackAngle(-45 * RAD, 0)).toBeCloseTo(IDEAL_ATTACK);
  });

  it('is clean at 45 degrees and bad head-on or beam-on', () => {
    expect(attackBad(45 * RAD)).toBe(0);
    expect(attackBad(38 * RAD)).toBeLessThan(0.05);
    expect(attackBad(52 * RAD)).toBeLessThan(0.15);
    expect(attackBad(0)).toBe(1);
    expect(attackBad(90 * RAD)).toBe(1);
    // and it rises monotonically towards both ends
    for (let d = 1; d < 36; d++) expect(attackBad((d - 1) * RAD)).toBeGreaterThanOrEqual(attackBad(d * RAD));
    for (let d = 55; d < 90; d++) expect(attackBad(d * RAD)).toBeGreaterThanOrEqual(attackBad((d - 1) * RAD));
  });

  it('judges the sea against the hull: the same swell is rougher on a small boat', () => {
    expect(seaRoughness(0.5, 7.4)).toBe(0);
    expect(seaRoughness(1.5, 7.4)).toBeGreaterThan(seaRoughness(1.5, 10.2));
    expect(seaRoughness(1.5, 10.2)).toBeGreaterThan(seaRoughness(1.5, 13));
    expect(seaRoughness(3, 7.4)).toBe(1);
  });

  it('leaves calm water alone and punishes a bad line in rough water', () => {
    // calm: no change to the water, no impact damage whatever the angle
    expect(waterFactor(0, 0)).toBe(1);
    expect(waterFactor(1, 0)).toBe(1);
    expect(damageFactor(1, 0)).toBe(0);
    // rough: a good line cuts the water, a bad one adds to it, and damage follows
    expect(waterFactor(0, 1)).toBeLessThan(0.5);
    expect(waterFactor(1, 1)).toBeGreaterThan(1.3);
    expect(damageFactor(1, 1)).toBeGreaterThan(10 * damageFactor(0, 1));
  });

  it('grades landings', () => {
    expect(gradeLanding(0.02, 3)).toBe('smooth');
    expect(gradeLanding(-0.3, 3)).toBe('nose');
    expect(gradeLanding(0.02, 9)).toBe('slap');
    expect(gradeLanding(0.3, 3)).toBe('slap');
  });
});

describe('wave field axis', () => {
  const env = new Environment();
  env.setConditions(weatherById('breeze'), 'slack', difficultyById('weekender'), true);
  const ax = makeWaveAxis();

  it('finds the swell axis and its travel direction in open water', () => {
    env.waves.axisAt(1400, 0, ax);
    // breeze: swell and chop both run from the east, so they travel towards -x (axis ~ 0 / 180 deg)
    expect(Math.abs(Math.sin(ax.angle))).toBeLessThan(0.3);
    expect(Math.cos(ax.travel)).toBeLessThan(-0.7);
    expect(ax.hs).toBeGreaterThan(1);
    expect(ax.coherence).toBeGreaterThan(0.5);
  });

  it('reports a flat sea in the sheltered bay and a bigger one in a squall', () => {
    env.waves.axisAt(-800, 0, ax);
    expect(ax.hs).toBeLessThan(0.5);
    const rough = new Environment();
    rough.setConditions(weatherById('squall'), 'slack', difficultyById('weekender'), true);
    const sq = makeWaveAxis();
    rough.waves.axisAt(1400, 0, sq);
    env.waves.axisAt(1400, 0, ax);
    expect(sq.hs).toBeGreaterThan(ax.hs);
  });
});

describe('Wave Rider streak', () => {
  const clean = (r: WaveRide, secs: number) => {
    for (let t = 0; t < secs; t += 0.1) r.update(0.1, 0, 14, 22, 2.0, 45 * RAD, 1, 7.4);
  };

  it('builds a combo only while riding a clean line in rough water', () => {
    const r = new WaveRide();
    clean(r, CLEAN_PERIOD * 3 + 0.5);
    expect(r.combo).toBe(3);
    expect(r.bonus).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.kind === 'combo')).toHaveLength(3);

    // calm water: nothing to ride
    const calm = new WaveRide();
    for (let t = 0; t < 20; t += 0.1) calm.update(0.1, 0, 14, 22, 0.4, 45 * RAD, 1, 7.4);
    expect(calm.combo).toBe(0);
  });

  it('announces each new level once, then just keeps banking points at the top', () => {
    const r = new WaveRide();
    clean(r, CLEAN_PERIOD * 14);
    expect(r.combo).toBe(9);
    expect(r.events.filter((e) => e.kind === 'combo')).toHaveLength(9);
    const banked = r.bonus;
    clean(r, CLEAN_PERIOD * 3);
    expect(r.events.filter((e) => e.kind === 'combo')).toHaveLength(9);
    expect(r.bonus).toBeGreaterThan(banked);
  });

  it('loses the streak after a damaging hit or after sitting on a bad angle', () => {
    const r = new WaveRide();
    clean(r, CLEAN_PERIOD * 2 + 0.2);
    expect(r.combo).toBe(2);
    r.breakStreak('hit');
    expect(r.combo).toBe(0);

    const r2 = new WaveRide();
    clean(r2, CLEAN_PERIOD * 2 + 0.2);
    for (let t = 0; t < 3; t += 0.1) r2.update(0.1, 0, 14, 22, 2.0, 0, 1, 7.4); // head-on for three seconds
    expect(r2.combo).toBe(0);
  });

  it('reports the bearing of the waves from the bow for the dial', () => {
    const r = new WaveRide();
    r.update(0.1, 0, 14, 22, 2, 45 * RAD, 1, 7.4);
    expect(r.rel).toBeCloseTo(45 * RAD);
    r.update(0.1, 0, 14, 22, 2, -45 * RAD, 1, 7.4);
    expect(r.rel).toBeCloseTo(-45 * RAD);
    r.update(0.1, 0, 14, 22, 2, 135 * RAD, 1, 7.4); // the same axis, seen from the other end
    expect(r.rel).toBeCloseTo(-45 * RAD);
  });
});

// ---------------------------------------------------------------------------------------------------
// physics: hold the boat at a fixed angle to the open sea and see what the sea does to it
// ---------------------------------------------------------------------------------------------------

interface Outcome {
  peakL: number;
  hull: number;
  hits: number;
  speed: number;
}

function hold(boatId: string, weather: string, deg: number, throttle: number, secs = 60): Outcome {
  const diff = difficultyById('weekender');
  const env = new Environment();
  env.setConditions(weatherById(weather), 'slack', diff, true);
  const benv = makeBoatEnv(env);
  const ax = makeWaveAxis();
  const spec = boatById(boatId);
  const boat = new Boat(spec);
  boat.capacityLimit = 1e9; // never sink: compare the raw numbers
  boat.leakScale = diff.leakScale;
  env.waves.axisAt(1400, 0, ax);
  const first = ax.angle + deg * RAD;
  boat.reset(1400, 0, first, benv);
  boat.sailUp = false;
  const dt = 1 / 30;
  let hits = 0;
  for (let i = 0; i < secs / dt; i++) {
    env.time += dt;
    env.waves.axisAt(boat.pos.x, boat.pos.z, ax);
    // keep the commanded heading at `deg` to the local wave axis, on the branch nearest the bow
    let tgt = ax.angle + deg * RAD;
    const alt = ax.angle + Math.PI + deg * RAD;
    if (Math.abs(wrapAngle(alt - first)) < Math.abs(wrapAngle(tgt - first))) tgt = alt;
    const err = wrapAngle(tgt - boat.heading);
    boat.setInput({
      throttle: Math.min(throttle, (i * dt) / 6),
      steer: Math.max(-1, Math.min(1, 2.5 * err + 1.5 * boat.angVel.y)),
      sheet: 0.5,
      pump: false,
    });
    boat.update(dt, benv);
    hits += boat.hits.length;
    boat.hits.length = 0;
    boat.ride.events.length = 0;
  }
  return { peakL: boat.water.peakVolume, hull: boat.hull, hits, speed: boat.speed };
}

describe('wave attack in the physics', () => {
  it('a 45 degree line is dry and sound, head-on wears the hull down (console, breeze, flat out)', () => {
    const clean = hold('console', 'breeze', 45, 1);
    const head = hold('console', 'breeze', 0, 1);
    expect(clean.hull).toBeGreaterThan(0.95);
    expect(head.hull).toBeLessThan(0.8);
    expect(head.hull).toBeLessThan(clean.hull - 0.2);
    expect(head.peakL).toBeGreaterThan(1.5 * clean.peakL);
  }, 60000);

  it('beam-on takes on water and damage that a 45 degree line does not (console, squall)', () => {
    const clean = hold('console', 'squall', 45, 0.45);
    const beam = hold('console', 'squall', 80, 0.45);
    expect(clean.hull).toBeGreaterThan(0.95);
    expect(beam.hull).toBeLessThan(clean.hull - 0.15);
    expect(beam.peakL).toBeGreaterThan(3 * Math.max(10, clean.peakL));
  }, 60000);

  it('the go-fast is pounded head-on and floods beam-on, but is sound and dry on a clean line', () => {
    const clean = hold('gofast', 'breeze', 45, 1);
    const head = hold('gofast', 'breeze', 0, 1);
    const beam = hold('gofast', 'breeze', 90, 1);
    expect(clean.hull).toBeGreaterThan(0.95);
    expect(head.hull).toBeLessThan(clean.hull - 0.15);
    expect(clean.peakL).toBeLessThan(200);
    expect(beam.peakL).toBeGreaterThan(3 * clean.peakL);
  }, 60000);

  it('the angle makes no difference, and nothing breaks, in a glassy bay', () => {
    for (const deg of [0, 45, 90]) {
      const r = hold('console', 'golden', deg, 0.6, 40);
      expect(r.hull, `${deg} deg`).toBe(1);
      expect(r.hits, `${deg} deg`).toBe(0);
      expect(r.peakL, `${deg} deg`).toBeLessThan(5);
    }
  }, 60000);

  it('the big yacht shrugs off a sea that punishes the open boat', () => {
    const yacht = hold('cruiser', 'breeze', 0, 0.8);
    const open = hold('console', 'breeze', 0, 0.8);
    expect(yacht.hull).toBeGreaterThan(open.hull);
    expect(yacht.hull).toBeGreaterThan(0.95);
  }, 60000);
});
