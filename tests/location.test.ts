// The engine must not assume Haulover: a second, tiny location with a different world size, no land, no
// harbour and no obstacles has to bake, drive the physics and place hazards.
import { Group } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { HAULOVER } from '../src/locations/haulover';
import type { Location } from '../src/locations/types';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';
import { GeoGrid } from '../src/sim/geoGrid';
import { Hazards } from '../src/sim/hazards';

/** 800 x 600 m of open water, 30 m deep, with a gentle flow towards +x. A different size and cell. */
const FLAT: Location = {
  id: 'flat-test',
  name: 'Flat test sea',
  world: { x0: -400, x1: 400, z0: -300, z1: 300, cell: 5 },
  flowCell: 10,
  fields: {
    seabedHeight: () => -30,
    landSDF: () => 1e6,
    hardSDF: () => 1e6,
    hardNormal: (_x, _z, out) => {
      out.x = 1;
      out.z = 0;
    },
    floorKind: () => 0,
    swellExposure: () => 1,
    hayMask: () => 0,
    currentUnit: (_x, _z, out) => {
      out.x = 0.5;
      out.z = 0;
    },
  },
  map: {},
  corridorHalf: () => 120,
  buildTerrain: () => new Group(),
  buildProps: () => {
    throw new Error('not rendered in tests');
  },
};

describe('a second location', () => {
  it('bakes grids sized from its own world, not Haulover', () => {
    const g = GeoGrid.bake(FLAT);
    expect(g.world).toBe(FLAT.world);
    expect(g.nx).toBe(160);
    expect(g.nz).toBe(120);
    expect(g.flowNx).toBe(80);
    expect(g.flowNz).toBe(60);
    expect(g.height).toHaveLength(160 * 120);
    expect(g.heightAt(0, 0)).toBeCloseTo(-30);
    expect(g.swellAt(100, -50)).toBeCloseTo(1);
    const flow = { x: 0, z: 0 };
    g.flowAt(0, 0, flow);
    expect(flow.x).toBeCloseTo(0.5);
    // and Haulover's grid is untouched by it
    const h = GeoGrid.bake(HAULOVER);
    expect(h.nx).toBe(1000);
    expect(h).not.toBe(g);
  });

  it('caches a bake per location, so repeated environments are cheap', () => {
    expect(GeoGrid.bake(FLAT)).toBe(GeoGrid.bake(FLAT));
    expect(GeoGrid.bake(HAULOVER)).toBe(GeoGrid.bake(HAULOVER));
  });

  it('drives the physics: waves, current, obstacles and a floating boat', () => {
    const env = new Environment(FLAT);
    env.setConditions(weatherById('breeze'), 'ebb', difficultyById('weekender'), true);
    expect(env.loc.id).toBe('flat-test');
    // open sea everywhere: full swell, none of Haulover's shelter or haystacks
    expect(env.geo.swellAt(-300, 200)).toBeCloseTo(1);
    const benv = makeBoatEnv(env);
    expect(benv.hardAt(0, 0)).toBeGreaterThan(1e5);
    expect(benv.seabedAt(10, 10)).toBe(-30);
    const boat = new Boat(boatById('console'));
    boat.reset(0, 0, 0, benv);
    for (let i = 0; i < 20 * 60; i++) {
      env.time += 1 / 60;
      boat.update(1 / 60, benv);
    }
    expect(Number.isFinite(boat.pos.x + boat.pos.y + boat.pos.z)).toBe(true);
    expect(boat.hull).toBe(1);
    // the ebb carries a drifting boat along +x
    expect(boat.pos.x).toBeGreaterThan(5);
  });

  it('places hazards using the location, with no marina exclusion needed', () => {
    const path = Array.from({ length: 40 }, (_, i) => ({ x: -350 + i * 18, z: 0, s: i * 18 }));
    const h = new Hazards(FLAT);
    h.generate({ path, length: 39 * 18 }, 10);
    expect(h.list.length).toBeGreaterThan(0);
    for (const hz of h.list) expect(Math.abs(hz.z)).toBeLessThan(80);
  });
});
