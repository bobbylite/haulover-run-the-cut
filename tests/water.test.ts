// "There is always water in the boat": it must not be. A boat is dry in calm water, only a real sea puts
// water aboard, seam leaks live in a bilge the scuppers cannot reach, and the pump clears them.
import { describe, expect, it } from 'vitest';
import { BOATS, boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { Autopilot } from '../src/game/autopilot';
import { makeCourse } from '../src/game/course';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { BoatWater, SPRAY_CHOP_MIN } from '../src/sim/boatWater';
import { Environment } from '../src/sim/environment';
import { calmEnv } from './helpers';

const DT = 1 / 30;
const dry = [0, 0, 0, 0, 0, 0, 0, 0]; // every weir clear of the sea

describe('the model of water in the hull', () => {
  it('a fast boat in glassy chop ships no spray at all', () => {
    const w = new BoatWater(boatById('console'));
    for (let i = 0; i < 600; i++)
      w.update(
        DT,
        dry.map(() => -1),
        20,
        SPRAY_CHOP_MIN * 0.9,
        0,
        0,
        0,
        0.2,
      );
    expect(w.litres).toBe(0);
    expect(w.totalIntake).toBe(0);
  });

  it('chop above the threshold does throw spray aboard, and it saturates with speed', () => {
    const rate = (speed: number) => {
      const w = new BoatWater(boatById('console'));
      w.update(
        DT,
        dry.map(() => -1),
        speed,
        0.6,
        0,
        0,
        0,
        -0.2,
      );
      return w.intakeRate;
    };
    expect(rate(14)).toBeGreaterThan(0);
    expect(rate(14)).toBeGreaterThan(rate(6));
    // a planing hull deflects spray outboard: going from 14 to 30 m/s adds nothing
    expect(rate(30)).toBeCloseTo(rate(14), 5);
  });

  it('the scupper flaps stop the sea running back in', () => {
    const w = new BoatWater(boatById('console'));
    // the sea stands 15 cm above the sole, but the boat is dry: nothing may flow aboard
    for (let i = 0; i < 300; i++)
      w.update(
        DT,
        dry.map(() => -1),
        0,
        0,
        0,
        0,
        0,
        -0.15,
      );
    expect(w.litres).toBe(0);
    expect(w.by.scupper).toBe(0);
  });

  it('the scuppers drain cockpit water but cannot reach the bilge', () => {
    const w = new BoatWater(boatById('console'));
    w.volume = 0.2; // 200 L standing in the cockpit
    w.leak = 3; // and a seam leak
    for (let i = 0; i < 30 * 20; i++)
      w.update(
        DT,
        dry.map(() => -1),
        0,
        0,
        0,
        0,
        0,
        0.3,
      );
    expect(w.volume).toBeLessThan(0.001); // the cockpit has drained
    expect(w.bilge * 1000).toBeGreaterThan(40); // the leak is still aboard
    expect(w.litres).toBeGreaterThan(40);
  });

  it('leaks fill the bilge first, and a full bilge rises into the cockpit', () => {
    const spec = boatById('console');
    const w = new BoatWater(spec);
    w.leak = 9;
    for (let i = 0; i < 30 * 30; i++)
      w.update(
        DT,
        dry.map(() => -1),
        0,
        0,
        0,
        0,
        0,
        -0.1,
      ); // sole awash: no drain
    const bilgeCap = spec.capacity * 0.14;
    expect(w.bilge * 1000).toBeCloseTo(bilgeCap, 0);
    expect(w.volume).toBeGreaterThan(0);
    expect(w.litres).toBeCloseTo((w.volume + w.bilge) * 1000, 6);
  });

  it('the pump clears the bilge', () => {
    const w = new BoatWater(boatById('console'));
    w.bilge = 0.1;
    w.pumping = true;
    for (let i = 0; i < 30 * 40; i++)
      w.update(
        DT,
        dry.map(() => -1),
        0,
        0,
        0,
        0,
        0,
        0.3,
      );
    expect(w.litres).toBeLessThan(1);
  });

  it('a burst of green water is added in one go and counted', () => {
    const w = new BoatWater(boatById('console'));
    w.addBurst(60);
    expect(w.litres).toBeCloseTo(60);
    expect(w.peakVolume).toBeCloseTo(60);
    expect(w.burst).toBeCloseTo(60);
  });
});

describe('boats stay dry where the water is calm', () => {
  it('no hull takes on more than a splash in flat water, whatever the throttle', () => {
    for (const spec of BOATS) {
      const env = calmEnv();
      const boat = new Boat(spec);
      boat.reset(0, 0, 0);
      boat.sailUp = false;
      let peak = 0;
      for (let i = 0; i < 70 * 60; i++) {
        const t = i / 60;
        boat.setInput({ throttle: t < 5 ? 0 : t < 35 ? 1 : 0.3, steer: 0, sheet: 0.5, pump: false });
        env.time += 1 / 60;
        boat.update(1 / 60, env);
        peak = Math.max(peak, boat.water.litres);
      }
      expect(peak, spec.id).toBeLessThan(6);
      expect(boat.water.litres, spec.id).toBe(0);
    }
  }, 60000);

  it('on a golden-hour run through the Cut every hull finishes dry', () => {
    const diff = difficultyById('weekender');
    for (const spec of BOATS) {
      if (spec.id === 'cruiser' || spec.id === 'sloop') continue; // too slow to cover the course in a unit test
      const env = new Environment();
      env.setConditions(weatherById('golden'), 'ebb', diff, true);
      const benv = makeBoatEnv(env);
      const course = makeCourse('outbound', diff.gateScale);
      const boat = new Boat(spec);
      boat.reset(course.start.x, course.start.z, course.start.heading, benv);
      boat.capacityLimit = 1e9;
      boat.sailUp = false;
      const ap = new Autopilot(course.path, 0.6);
      const ctl = { throttle: 0, steer: 0, sheet: 0.5, pump: false };
      let litreSeconds = 0;
      for (let i = 0; i < 30 * 200 && boat.pos.x < 1005; i++) {
        env.time += DT;
        ap.update(boat, ctl, DT);
        ctl.pump = false;
        boat.setInput(ctl);
        boat.update(DT, benv);
        boat.impacts.length = 0;
        litreSeconds += boat.water.litres * DT;
      }
      // less than a litre of water, on average, over the whole run
      expect(litreSeconds / 100, spec.id).toBeLessThan(1);
      expect(boat.water.litres, spec.id).toBeLessThan(5);
      expect(boat.hull, spec.id).toBe(1);
    }
  }, 120000);
});

describe('hull damage', () => {
  it('every bit of lost hull opens a seam, scaled by the difficulty, and a broken hull sinks', () => {
    const b = new Boat(boatById('console'));
    b.reset(0, 0, 0);
    expect(b.hull).toBe(1);
    b.leakScale = 1;
    b.damage(0.2);
    expect(b.hull).toBeCloseTo(0.8);
    const leak1 = b.water.leak;
    expect(leak1).toBeGreaterThan(0);

    const tough = new Boat(boatById('console'));
    tough.reset(0, 0, 0);
    tough.leakScale = 2.4;
    tough.damage(0.2);
    expect(tough.water.leak).toBeCloseTo(2.4 * leak1, 5);

    b.damage(5);
    expect(b.hull).toBe(0);
    expect(b.wrecked).toBe(true);
    expect(b.sinking).toBe(true);
    expect(b.water.leak).toBeLessThanOrEqual(9);
  });

  it('ambient traffic is never worn down', () => {
    const b = new Boat(boatById('console'));
    b.reset(0, 0, 0);
    b.indestructible = true;
    b.damage(0.9);
    expect(b.hull).toBe(1);
    expect(b.water.leak).toBe(0);
  });

  it('a fresh start (and a respawn) is a sound, dry boat', () => {
    const b = new Boat(boatById('console'));
    b.reset(0, 0, 0);
    b.damage(0.6);
    b.water.addBurst(50);
    b.reset(0, 0, 0);
    expect(b.hull).toBe(1);
    expect(b.wrecked).toBe(false);
    expect(b.water.litres).toBe(0);
    expect(b.water.leak).toBe(0);
  });

  it('damage from a seam turns up as water the scuppers cannot clear', () => {
    const env = calmEnv();
    const b = new Boat(boatById('console'));
    b.reset(0, 0, 0);
    b.leakScale = 1.4;
    b.damage(0.4);
    for (let i = 0; i < 60 * 40; i++) {
      env.time += 1 / 60;
      b.update(1 / 60, env);
    }
    expect(b.water.bilge * 1000).toBeGreaterThan(20);
    // and the pump gets it out again
    b.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: true });
    b.water.leak = 0;
    for (let i = 0; i < 60 * 60; i++) {
      env.time += 1 / 60;
      b.update(1 / 60, env);
    }
    expect(b.water.litres).toBeLessThan(1);
  });
});
