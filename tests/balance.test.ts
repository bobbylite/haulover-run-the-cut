// Gameplay balance regressions: the autopilot runs the real course through the real sea, and the
// difficulty ladder (Dockside < Weekender < Captain < Legend) and weather ladder (calm < breeze < squall)
// must hold. These use the sea alone (no hazards or traffic), so they are deterministic.
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { Autopilot } from '../src/game/autopilot';
import { makeCourse } from '../src/game/course';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';

interface Result {
  outcome: 'finish' | 'swamped' | 'capsized' | 'timeout';
  peakFrac: number;
}

function run(boatId: string, weather: string, cruise: number, diffId: string): Result {
  const diff = difficultyById(diffId);
  const env = new Environment();
  env.setConditions(weatherById(weather), 'ebb', diff, true);
  const benv = makeBoatEnv(env);
  const course = makeCourse('outbound', diff.gateScale);
  const spec = boatById(boatId);
  const boat = new Boat(spec);
  boat.reset(course.start.x, course.start.z, course.start.heading, benv);
  boat.capacityLimit = spec.capacity * diff.capacity;
  boat.water.autoBilge = diff.autoBilge;
  const ap = new Autopilot(course.path, cruise);
  const ctl = { throttle: 0, steer: 0, sheet: 0.5, pump: false };
  const dt = 1 / 30;
  const limit = 30 * Math.max(150, course.length / (0.25 * spec.topSpeed) + 40);
  let outcome: Result['outcome'] = 'timeout';
  for (let i = 0; i < limit; i++) {
    env.time += dt;
    ap.update(boat, ctl, dt);
    boat.setInput(ctl);
    boat.update(dt, benv);
    boat.impacts.length = 0;
    if (boat.sinking) outcome = 'swamped';
    else if (boat.capsized) outcome = 'capsized';
    else if (boat.pos.x > 1010) outcome = 'finish';
    if (outcome !== 'timeout') break;
  }
  return { outcome, peakFrac: boat.water.peakVolume / (boat.capacityLimit ?? 1) };
}

describe('balance (autopilot through the Cut, ebb tide)', () => {
  it('a golden hour is dry for everyone on Dockside', () => {
    for (const id of ['console', 'cruiser', 'pontoon']) {
      const r = run(id, 'golden', 0.5, 'dockside');
      expect(r.outcome, id).toBe('finish');
      expect(r.peakFrac, id).toBeLessThan(0.06);
    }
  }, 60000);

  it('a breeze on Weekender wets the open boat hard but is survivable at speed', () => {
    const r = run('console', 'breeze', 0.7, 'weekender');
    expect(r.outcome).toBe('finish');
    expect(r.peakFrac).toBeGreaterThan(0.12);
    expect(r.peakFrac).toBeLessThan(0.7);
  }, 60000);

  it('the Tropical Squall sinks the open boat on Weekender', () => {
    expect(run('console', 'squall', 0.7, 'weekender').outcome).toBe('swamped');
  }, 60000);

  it('the flat pontoon swamps in a breeze on Weekender', () => {
    expect(run('pontoon', 'breeze', 0.7, 'weekender').outcome).toBe('swamped');
  }, 60000);

  it('each difficulty tier leaves less margin than the last', () => {
    const peaks = ['dockside', 'weekender', 'captain', 'legend'].map(
      (d) => run('console', 'breeze', 0.7, d).peakFrac,
    );
    for (let i = 1; i < peaks.length; i++)
      expect(peaks[i] as number, `tier ${i}`).toBeGreaterThan((peaks[i - 1] as number) * 1.2);
  }, 90000);

  it('the cruiser shrugs off a squall until Legend', () => {
    const wk = run('cruiser', 'squall', 0.7, 'weekender');
    expect(wk.outcome).toBe('finish');
    expect(wk.peakFrac).toBeLessThan(0.15);
    const lg = run('cruiser', 'squall', 0.7, 'legend');
    expect(lg.peakFrac).toBeGreaterThan(0.3);
  }, 90000);
});
