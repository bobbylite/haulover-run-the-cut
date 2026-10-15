// The sloop's sails must actually use the wind: drive forward on every point of sail except dead
// upwind, be fastest on a reach, heel with the wind, tack and gybe through events, and the trim the HUD
// recommends must be (close to) the best trim.
import { describe, expect, it } from 'vitest';
import { wrapAngle } from '../src/core/math';
import { boatById } from '../src/data/boats';
import { Boat } from '../src/sim/boat';
import {
  BOOM_MAX,
  BOOM_MIN,
  boomLimit,
  drawing,
  idealBoomAngle,
  idealSheet,
  NO_GO,
  STALL,
  sailCoeffs,
  TRIM_ALPHA,
} from '../src/sim/sail';
import { calmEnv } from './helpers';

const DEG = Math.PI / 180;
const DT = 1 / 30;

/**
 * A sloop alone under sail (no motor) holding heading 0 in a steady wind from `twa` degrees off the bow
 * (positive = from starboard). `sheet` of -1 means "trim to the ideal angle each step".
 */
function sail(twa: number, wind: number, sheet: number, secs = 45): Boat {
  const env = calmEnv();
  const a = twa * DEG;
  env.windAt = (_x, _z, out) => {
    out.x = -Math.cos(a) * wind;
    out.z = -Math.sin(a) * wind;
  };
  const boat = new Boat(boatById('sloop'));
  boat.reset(0, 0, 0);
  boat.sailUp = true;
  for (let i = 0; i < secs / DT; i++) {
    env.time += DT;
    const err = wrapAngle(0 - boat.heading);
    boat.setInput({
      throttle: 0,
      steer: Math.max(-1, Math.min(1, 2.5 * err + 1.5 * boat.angVel.y)),
      sheet: sheet < 0 ? idealSheet(Math.abs(boat.awa)) : sheet,
      pump: false,
    });
    boat.update(DT, env);
    boat.sailEvents.length = 0;
  }
  return boat;
}

describe('sail aerodynamics', () => {
  it('lift builds up to the stall and falls away after it', () => {
    expect(sailCoeffs(0).cl).toBeCloseTo(0);
    expect(sailCoeffs(0.15).cl).toBeGreaterThan(sailCoeffs(0.05).cl);
    expect(sailCoeffs(STALL).cl).toBeGreaterThan(sailCoeffs(STALL + 0.25).cl);
    // and drag climbs steeply once stalled
    expect(sailCoeffs(0.8).cd).toBeGreaterThan(4 * sailCoeffs(0.2).cd);
  });

  it('a sail at a tiny angle of attack is luffing, not drawing', () => {
    expect(drawing(0)).toBe(0);
    expect(drawing(0.05)).toBeGreaterThan(0);
    expect(drawing(0.05)).toBeLessThan(drawing(0.2));
    expect(drawing(0.3)).toBe(1);
  });

  it('the sheet limits the boom, and the ideal sheet puts the sail just short of the stall', () => {
    expect(boomLimit(0)).toBeCloseTo(BOOM_MIN);
    expect(boomLimit(1)).toBeCloseTo(BOOM_MAX);
    let prev = -1;
    for (let g = 0.2; g <= Math.PI; g += 0.1) {
      const s = idealSheet(g);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    // reaching: the boom sits `TRIM_ALPHA` inside the wind angle
    expect(idealBoomAngle(1.5)).toBeCloseTo(1.5 - TRIM_ALPHA, 5);
    expect(idealSheet(0.1)).toBe(0); // pinching: sheeted right in
    expect(idealSheet(3)).toBe(1); // running: let it right out
  });
});

describe('sloop under sail (8 m/s of wind, motor off)', () => {
  it('cannot sail into the wind: dead upwind it makes no way', () => {
    for (const twa of [0, 15, 25]) {
      const b = sail(twa, 8, -1);
      expect(b.speed, `${twa} deg`).toBeLessThan(0.4);
    }
    expect(NO_GO).toBeGreaterThan(0.4);
  }, 30000);

  it('drives forward on every other point of sail', () => {
    const want: Record<number, number> = { 50: 2, 60: 2.5, 90: 3, 120: 2.5, 150: 2.3, 180: 2 };
    for (const [twa, min] of Object.entries(want)) {
      const b = sail(Number(twa), 8, -1);
      expect(b.speed, `${twa} deg`).toBeGreaterThan(min);
    }
  }, 60000);

  it('is fastest on a beam reach and slower running dead downwind', () => {
    const reach = sail(90, 8, -1).speed;
    const close = sail(45, 8, -1).speed;
    const run = sail(180, 8, -1).speed;
    expect(reach).toBeGreaterThan(close);
    expect(reach).toBeGreaterThan(run);
  }, 30000);

  it('behaves the same on either tack, mirrored', () => {
    const stbd = sail(70, 8, -1);
    const port = sail(-70, 8, -1);
    expect(port.speed).toBeCloseTo(stbd.speed, 0);
    expect(Math.sign(port.heelDeg)).toBe(-Math.sign(stbd.heelDeg));
    expect(Math.sign(port.awa)).toBe(-Math.sign(stbd.awa));
  }, 30000);

  it('puts the boom out to leeward and heels the boat away from the wind', () => {
    const b = sail(70, 8, -1); // wind from starboard
    expect(b.boomSide).toBe(-1); // boom to port
    expect(b.heelDeg).not.toBe(0);
    const stbdHeel = b.heelDeg;
    const port = sail(-70, 8, -1);
    expect(port.boomSide).toBe(1);
    expect(port.heelDeg).toBeCloseTo(-stbdHeel, 0);
  }, 30000);

  it('heels harder in more wind, and is dead in the water with no wind or no sail', () => {
    const light = sail(90, 5, -1);
    const strong = sail(90, 11, -1);
    expect(Math.abs(strong.heelDeg)).toBeGreaterThan(1.5 * Math.abs(light.heelDeg));
    expect(strong.speed).toBeGreaterThan(light.speed);

    const calm = sail(90, 0.1, -1, 20);
    expect(Math.abs(calm.speed)).toBeLessThan(0.3);

    const env = calmEnv();
    env.windAt = (_x, _z, out) => {
      out.x = 0;
      out.z = -8;
    };
    const down = new Boat(boatById('sloop'));
    down.reset(0, 0, 0);
    down.sailUp = false;
    for (let i = 0; i < 40 / DT; i++) {
      env.time += DT;
      down.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
      down.update(DT, env);
    }
    expect(down.sailPower).toBe(0);
    expect(strong.speed).toBeGreaterThan(down.speed + 3);
  }, 60000);

  it('the recommended trim is within a few percent of the best trim', () => {
    for (const twa of [60, 90, 130]) {
      const best = Math.max(...[0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((s) => sail(twa, 8, s, 40).speed));
      const ideal = sail(twa, 8, -1, 40).speed;
      expect(ideal, `${twa} deg`).toBeGreaterThan(best * 0.92);
    }
  }, 120000);

  it('too much sheet luffs the sail and too little stalls it', () => {
    const eased = sail(70, 8, 1, 30); // boom right out: the cloth flaps
    const hard = sail(70, 8, 0, 30); // sheeted hard in on a reach: stalled
    const trimmed = sail(70, 8, -1, 30);
    expect(eased.sailLuff).toBeGreaterThan(0.5);
    expect(hard.sailAlpha).toBeGreaterThan(STALL);
    expect(trimmed.sailAlpha).toBeGreaterThan(0.1);
    expect(trimmed.sailAlpha).toBeLessThan(STALL + 0.1); // trimmed right at the edge of the stall
    expect(trimmed.speed).toBeGreaterThan(Math.max(eased.speed, hard.speed));
  }, 60000);
});

describe('tacking and gybing', () => {
  /** Turn from `h1` to `h2` (degrees from a wind coming from world angle 0) and collect sail events. */
  function turn(h1: number, h2: number) {
    const env = calmEnv();
    // wind comes FROM world angle 0 (+x), i.e. blows towards -x
    env.windAt = (_x, _z, out) => {
      out.x = -9;
      out.z = 0;
    };
    const boat = new Boat(boatById('sloop'));
    boat.reset(0, 0, h1 * DEG);
    boat.sailUp = true;
    const events: { kind: string; strength: number }[] = [];
    let target = h1 * DEG;
    for (let i = 0; i < 70 / DT; i++) {
      if (i * DT > 25) target = h2 * DEG;
      env.time += DT;
      const err = wrapAngle(target - boat.heading);
      boat.setInput({
        throttle: i * DT > 25 ? 0.6 : 0,
        steer: Math.max(-1, Math.min(1, 2.5 * err + 1.5 * boat.angVel.y)),
        sheet: 0.85,
        pump: false,
      });
      boat.update(DT, env);
      if (i * DT > 24) events.push(...boat.sailEvents);
      boat.sailEvents.length = 0;
    }
    return events;
  }

  it('a tack through the wind swings the boom across with a tack event', () => {
    // wind from +x: heading 130 has it on the starboard bow (close-hauled), heading -130 on the port bow
    const ev = turn(-50, 50);
    expect(ev.some((e) => e.kind === 'tack')).toBe(true);
    expect(ev.some((e) => e.kind === 'gybe')).toBe(false);
  }, 60000);

  it('running by the lee with the boom out is a crash gybe', () => {
    // wind from +x; heading 140 has it on the starboard quarter, heading -140 on the port quarter
    const ev = turn(140, -140);
    const gybe = ev.find((e) => e.kind === 'gybe');
    expect(gybe).toBeDefined();
    expect(gybe?.strength ?? 0).toBeGreaterThan(0.3);
  }, 60000);

  it('holding one tack never produces an event', () => {
    expect(turn(-50, -50)).toHaveLength(0);
  }, 60000);
});
