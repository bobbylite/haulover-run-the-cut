// Montauk as a place: the Point, the shelf and the edge, the reef, the rips and the tide, plus the promise
// every Montauk sky makes (the wind blows against the ebb, which stands the rips up).
import { describe, expect, it } from 'vitest';
import { difficultyById } from '../src/data/difficulty';
import { WEATHER, weatherById, weatherFor } from '../src/data/weather';
import { MONTAUK } from '../src/locations/montauk';
import {
  currentUnit,
  FISH_ZONES,
  hayMask,
  LIGHTHOUSE,
  landSDF,
  RANGE,
  REEF,
  ROCKS,
  START,
  seabedHeight,
  WORLD,
} from '../src/locations/montauk/geography';
import { Environment } from '../src/sim/environment';
import { GeoGrid } from '../src/sim/geoGrid';
import { makeWaveSample } from '../src/sim/waves';

const depth = (x: number, z: number) => -seabedHeight(x, z);

describe('the Montauk shoreline and sea floor', () => {
  it('bakes on its own world grid', () => {
    const g = GeoGrid.bake(MONTAUK);
    expect(g.nx).toBe((WORLD.x1 - WORLD.x0) / WORLD.cell);
    expect(g.nz).toBe((WORLD.z1 - WORLD.z0) / WORLD.cell);
    for (const v of [g.height[0], g.height[g.height.length - 1], g.hay[1234], g.swell[4321]])
      expect(Number.isFinite(v)).toBe(true);
  });

  it('the lighthouse stands on a hill and the start is in open water', () => {
    expect(landSDF(LIGHTHOUSE.x, LIGHTHOUSE.z)).toBeLessThan(-30);
    expect(seabedHeight(LIGHTHOUSE.x, LIGHTHOUSE.z)).toBeGreaterThan(12);
    expect(depth(START.x, START.z)).toBeGreaterThan(8);
    expect(landSDF(START.x, START.z)).toBeGreaterThan(150);
  });

  it('the Point is a headland: land runs far east at its tip and the coast falls back either side', () => {
    expect(landSDF(-400, 40)).toBeLessThan(0);
    expect(landSDF(-100, 40)).toBeGreaterThan(0);
    expect(landSDF(-400, 800)).toBeGreaterThan(0);
    expect(landSDF(-400, -800)).toBeGreaterThan(0);
  });

  it('the shelf slopes away to the edge and then drops off', () => {
    expect(depth(-150, 40)).toBeLessThan(depth(300, 40) + 3);
    expect(depth(1000, 40)).toBeGreaterThan(8);
    expect(depth(3000, 0)).toBeGreaterThan(70);
    expect(depth(1000, 1200)).toBeLessThan(depth(3000, 1200));
  });

  it('the reef comes up close under the surface', () => {
    expect(depth(REEF.x, REEF.z)).toBeLessThan(6);
    expect(depth(REEF.x, REEF.z)).toBeGreaterThan(1.5);
  });

  it('boulders are all in the water, none in the start area', () => {
    expect(ROCKS.length).toBeGreaterThan(15);
    for (const r of ROCKS) {
      expect(landSDF(r.x, r.z)).toBeGreaterThan(0);
      expect(Math.hypot(r.x - START.x, r.z - START.z)).toBeGreaterThan(120);
    }
  });
});

describe('the Montauk tide', () => {
  const u = { x: 0, z: 0 };

  it('the ebb sets east, out to sea, and runs hardest in the rip', () => {
    currentUnit(900, 150, u);
    const rip = u.x;
    currentUnit(2800, -900, u);
    const deep = u.x;
    expect(rip).toBeGreaterThan(0.55);
    expect(deep).toBeGreaterThan(0.1);
    expect(rip).toBeGreaterThan(deep * 1.8);
  });

  it('nothing flows on dry land, and a back-eddy runs the other way along the south beach', () => {
    currentUnit(LIGHTHOUSE.x, LIGHTHOUSE.z, u);
    expect(Math.hypot(u.x, u.z)).toBe(0);
    let sawEddy = false;
    for (let z = 300; z < 800 && !sawEddy; z += 20)
      for (let s = 20; s < 200; s += 20) {
        const x = -1100 + (z - 300) * 0.9 + s;
        if (landSDF(x, z) <= 0) continue;
        currentUnit(x, z, u);
        if (u.x < 0) sawEddy = true;
      }
    expect(sawEddy).toBe(true);
  });

  it('the rips and the reef stand the waves up; the open sea does not', () => {
    expect(hayMask(900, 160)).toBeGreaterThan(0.5);
    expect(hayMask(REEF.x, REEF.z)).toBeGreaterThan(0.7);
    expect(hayMask(2800, -900)).toBeLessThan(0.05);
    expect(hayMask(LIGHTHOUSE.x, LIGHTHOUSE.z)).toBeLessThan(0.05);
  });
});

describe('the fishing grounds', () => {
  it('every zone is deep, wet water inside the range', () => {
    for (const z of FISH_ZONES) {
      expect(depth(z.x, z.z), z.label).toBeGreaterThan(10);
      expect(Math.abs(z.x)).toBeLessThan(RANGE.x);
      expect(Math.abs(z.z)).toBeLessThan(RANGE.z);
    }
  });
});

describe('Montauk skies', () => {
  const montauk = WEATHER.filter((w) => w.exclusive === 'montauk');

  it('has pastel skies of its own that other games do not list', () => {
    expect(montauk.length).toBeGreaterThanOrEqual(4);
    expect(weatherFor('haulover').some((w) => w.exclusive)).toBe(false);
    expect(weatherFor('montauk')).toEqual(montauk);
  });

  it('every one blows an onshore easterly against the east-going ebb, and most are harder than a Haulover breeze', () => {
    for (const w of montauk) {
      // wind FROM the east half of the compass blows towards the west, against an ebb that sets east
      expect(w.windFrom, w.id).toBeGreaterThan(30);
      expect(w.windFrom, w.id).toBeLessThan(120);
      expect(w.windSpeed, w.id).toBeGreaterThan(6.5);
    }
    const harder = montauk.filter((w) => w.windSpeed > weatherById('breeze').windSpeed);
    expect(harder.length).toBeGreaterThanOrEqual(3);
  });

  it('wind against the ebb stands the rip up far higher than the same sky on a flood', () => {
    const range = (tide: 'ebb' | 'flood') => {
      const env = new Environment(MONTAUK);
      env.setConditions(weatherById('m-dawn'), tide, difficultyById('captain'), true);
      const s = makeWaveSample();
      let lo = 1e9;
      let hi = -1e9;
      for (let x = 820; x < 1000; x += 4)
        for (let t = 0; t < 14; t += 0.25) {
          env.waves.sample(x, 160, t, s);
          lo = Math.min(lo, s.h);
          hi = Math.max(hi, s.h);
        }
      return hi - lo;
    };
    expect(range('ebb')).toBeGreaterThan(range('flood') * 1.25);
  });

  it('the wind and tide gains build the sea through the day and leave gain 1 alone', () => {
    const env = new Environment(MONTAUK);
    env.setConditions(weatherById('m-dawn'), 'ebb', difficultyById('captain'), true);
    const v = { x: 0, z: 0 };
    env.currentAt(900, 150, v);
    const before = Math.hypot(v.x, v.z);
    const wind0 = env.wind.speed;
    env.tideGain = 1.5;
    env.windGain = 1.4;
    for (let i = 0; i < 600; i++) env.blend(1 / 30);
    env.currentAt(900, 150, v);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(before * 1.4);
    expect(env.wind.speed).toBeGreaterThan(wind0 * 1.3);
    // and with gain 1 nothing drifts
    const calm = new Environment(MONTAUK);
    calm.setConditions(weatherById('m-dawn'), 'ebb', difficultyById('captain'), true);
    const w1 = calm.wind.speed;
    const t1 = calm.tideSpeed;
    for (let i = 0; i < 300; i++) calm.blend(1 / 30);
    expect(calm.wind.speed).toBeCloseTo(w1, 6);
    expect(calm.tideSpeed).toBeCloseTo(t1, 6);
  });
});
