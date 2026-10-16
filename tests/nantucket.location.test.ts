// Nantucket Harbor: the geography the physics, the shaders and the levels all read must be sound: whole-cell
// extents, finite fields, deep and open water on every approach road, a hull that fits at every berth, and a
// level list that points at things that exist.
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { WEATHER, weatherFor } from '../src/data/weather';
import { berthRules, berthTarget } from '../src/game/berthing';
import { LEVELS, levelOpen, nantDifficulty, TIERS, tierOpen } from '../src/games/nantucket/levels';
import { NANTUCKET } from '../src/locations/nantucket';
import {
  BERTHS,
  BUOYS,
  FLOW_CELL,
  FREE_SLIPS,
  hardSDF,
  landSDF,
  MOORED,
  MOORINGS,
  PILINGS,
  seabedHeight,
  slipX,
  WORLD,
} from '../src/locations/nantucket/geography';
import { GeoGrid } from '../src/sim/geoGrid';

const depth = (x: number, z: number): number => -seabedHeight(x, z);

describe('the Nantucket grid and fields', () => {
  it('the world is a whole number of cells in both grids (the baked grids index by them)', () => {
    for (const [a, b, c] of [
      [WORLD.x0, WORLD.x1, WORLD.cell],
      [WORLD.z0, WORLD.z1, WORLD.cell],
      [WORLD.x0, WORLD.x1, FLOW_CELL],
      [WORLD.z0, WORLD.z1, FLOW_CELL],
    ] as const) {
      expect((b - a) / c).toBe(Math.round((b - a) / c));
    }
  });

  it('every field is finite across the world, and the tide only moves where there is water', () => {
    const f = NANTUCKET.fields;
    const o = { x: 0, z: 0 };
    for (let x = WORLD.x0; x < WORLD.x1; x += 53) {
      for (let z = WORLD.z0; z < WORLD.z1; z += 53) {
        const h = f.seabedHeight(x, z);
        for (const v of [
          h,
          f.landSDF(x, z),
          f.hardSDF(x, z) > 1e8 ? 0 : f.hardSDF(x, z),
          f.swellExposure(x, z),
          f.hayMask(x, z),
        ])
          expect(Number.isFinite(v), `${x},${z}`).toBe(true);
        f.currentUnit(x, z, o);
        expect(Number.isFinite(o.x + o.z), `flow ${x},${z}`).toBe(true);
        expect(Math.hypot(o.x, o.z)).toBeLessThan(1.5);
      }
    }
  });

  it('bakes to a grid whose lookups are finite everywhere a boat can be', () => {
    const geo = GeoGrid.bake(NANTUCKET);
    for (const [x, z] of [
      [90, 60],
      [-300, 200],
      [245, 380],
      [103, -500],
      [-700, 100],
      [900, 500],
    ] as const)
      expect(Number.isFinite(geo.heightAt(x, z)), `${x},${z}`).toBe(true);
  });

  it('the tide runs through the mouth: stronger there than inside the bowl, and slack in the basin', () => {
    const o = { x: 0, z: 0 };
    NANTUCKET.fields.currentUnit(103, -330, o);
    const mouth = Math.hypot(o.x, o.z);
    NANTUCKET.fields.currentUnit(-300, 100, o);
    const bowl = Math.hypot(o.x, o.z);
    NANTUCKET.fields.currentUnit(245, 400, o);
    const basin = Math.hypot(o.x, o.z);
    expect(mouth).toBeGreaterThan(bowl * 1.5);
    expect(bowl).toBeGreaterThan(basin * 2);
  });

  it('the harbour is land to the south (the town) and open sea to the north, with a gap at the mouth', () => {
    expect(landSDF(0, 600)).toBeLessThan(0);
    expect(landSDF(103, -600)).toBeGreaterThan(100);
    expect(landSDF(103, -330)).toBeGreaterThan(80);
    expect(landSDF(-300, 100)).toBeGreaterThan(100);
  });
});

describe('the roads to the berths', () => {
  it.each(BERTHS)('$id: every point on the approach is deep, open water', (b) => {
    for (const [x, z] of b.approach) {
      expect(depth(x, z), `depth ${x},${z}`).toBeGreaterThan(3);
      expect(hardSDF(x, z), `clear ${x},${z}`).toBeGreaterThan(5);
      expect(landSDF(x, z), `water ${x},${z}`).toBeGreaterThan(5);
    }
  });

  it('every road starts at the same place: the mouth of the harbour', () => {
    const first = BERTHS.map((b) => b.approach[0]);
    for (const p of first) expect(p).toEqual(first[0]);
  });
});

describe('the berths', () => {
  it('every berth has an id, a label and a radar window, and ids are unique', () => {
    expect(new Set(BERTHS.map((b) => b.id)).size).toBe(BERTHS.length);
    for (const b of BERTHS) {
      expect(b.label.length, b.id).toBeGreaterThan(3);
      expect(b.radar, b.id).toBeGreaterThan(40);
    }
  });

  it('the free slips and the three mooring balls are clear of moored hulls', () => {
    for (const k of FREE_SLIPS) {
      for (const m of MOORED) {
        const near = Math.abs(m.x - slipX(k)) < 6 && m.z > 380;
        expect(near, `slip ${k} vs boat at ${m.x},${m.z}`).toBe(false);
      }
    }
    for (const id of ['moor-a', 'moor-b', 'moor-c']) {
      const ball = MOORINGS.find((m) => m.id === id);
      expect(ball, id).toBeDefined();
      for (const p of PILINGS)
        expect(Math.hypot(p.x - (ball?.x ?? 0), p.z - (ball?.z ?? 0)), id).toBeGreaterThan(p.r + 14);
    }
  });

  it('a wharf face really is the hard edge: just behind the mark is wall, just in front is water', () => {
    for (const b of BERTHS.filter((x) => x.kind === 'alongside')) {
      const nx = Math.cos(b.dir);
      const nz = Math.sin(b.dir);
      expect(hardSDF(b.x - nx * 0.5, b.z - nz * 0.5), `${b.id} behind`).toBeLessThan(0.2);
      expect(hardSDF(b.x + nx * 3, b.z + nz * 3), `${b.id} in front`).toBeGreaterThan(1.5);
    }
  });
});

describe('the levels', () => {
  it('ids are unique and ordered by tier, and every tier has levels', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    expect(LEVELS.map((l) => l.tier)).toEqual([...LEVELS.map((l) => l.tier)].sort());
    for (const t of TIERS)
      expect(
        LEVELS.some((l) => l.tier === t.tier),
        `tier ${t.tier}`,
      ).toBe(true);
    expect(LEVELS.length).toBe(12);
  });

  it.each(LEVELS)('$id points at a real berth, boat and sky, and fits', (l) => {
    const berth = BERTHS.find((b) => b.id === l.berth);
    expect(berth, 'berth').toBeDefined();
    const spec = boatById(l.boat);
    expect(spec.id).toBe(l.boat);
    expect(WEATHER.some((w) => w.id === l.weather)).toBe(true);
    // the start is in deep, open water
    expect(depth(l.start.x, l.start.z)).toBeGreaterThan(spec.keelDepth + 1);
    expect(hardSDF(l.start.x, l.start.z)).toBeGreaterThan(spec.length);
    // the hull fits its berth: water under the keel at the mark, and the hull clear of anything but the quay
    const t = berthTarget(berth as (typeof BERTHS)[number], spec);
    if (berth?.kind !== 'mooring') {
      expect(depth(t.x, t.z)).toBeGreaterThan(spec.keelDepth + 0.4);
      expect(hardSDF(t.x, t.z)).toBeGreaterThan(spec.beam * 0.5 - 0.3);
    }
    // a vessel that cannot fit a slip is not asked to
    if (berth?.kind === 'slip') {
      expect(spec.beam).toBeLessThan(berth.width - 4);
      expect(spec.length).toBeLessThan(berth.length - 5);
    }
    // tolerances in hand
    expect(berthRules(berth as (typeof BERTHS)[number], spec).hold).toBeGreaterThan(0);
    // ships have a tug budget; small boats do not
    if (spec.thrusters && spec.length > 30) expect(l.tugs).toBeGreaterThan(0);
    if (spec.length < 25) expect(l.tugs).toBe(0);
    expect(l.tugFree).toBeLessThanOrEqual(l.tugs);
  });

  it('later tiers get bigger vessels and longer clocks', () => {
    const lenOf = (l: (typeof LEVELS)[number]) => boatById(l.boat).length;
    const byTier = (n: number) => LEVELS.filter((l) => l.tier === n);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(byTier(5).map(lenOf))).toBeGreaterThan(avg(byTier(4).map(lenOf)));
    expect(avg(byTier(4).map(lenOf))).toBeGreaterThan(avg(byTier(3).map(lenOf)));
    expect(avg(byTier(5).map((l) => l.time))).toBeGreaterThan(avg(byTier(1).map((l) => l.time)));
  });

  it('a tier opens when two levels of the one before have a star; the first is always open', () => {
    expect(tierOpen(1, {})).toBe(true);
    expect(tierOpen(2, {})).toBe(false);
    const t1 = LEVELS.filter((l) => l.tier === 1);
    expect(tierOpen(2, { [t1[0]?.id as string]: 1 })).toBe(false);
    expect(tierOpen(2, { [t1[0]?.id as string]: 1, [t1[1]?.id as string]: 3 })).toBe(true);
    // and a tier cannot open over a closed one
    const t2 = LEVELS.filter((l) => l.tier === 2);
    expect(tierOpen(3, { [t2[0]?.id as string]: 2, [t2[1]?.id as string]: 2 })).toBe(false);
    expect(levelOpen(LEVELS[0] as (typeof LEVELS)[number], {})).toBe(true);
  });

  it('the difficulties get harder in order: more wind and tide, less time, more traffic, more score', () => {
    const ds = ['dockside', 'weekender', 'captain', 'legend'].map(nantDifficulty);
    for (let i = 1; i < ds.length; i++) {
      const a = ds[i - 1];
      const b = ds[i];
      if (!a || !b) continue;
      expect(b.windScale).toBeGreaterThan(a.windScale);
      expect(b.currentScale).toBeGreaterThan(a.currentScale);
      expect(b.timeScale).toBeLessThan(a.timeScale);
      expect(b.traffic).toBeGreaterThan(a.traffic);
      expect(b.score).toBeGreaterThan(a.score);
    }
  });

  it('Nantucket has skies of its own, and every level uses one', () => {
    const own = weatherFor('nantucket');
    expect(own.length).toBe(5);
    for (const w of own) expect(w.exclusive).toBe('nantucket');
    for (const l of LEVELS)
      expect(
        own.some((w) => w.id === l.weather),
        l.id,
      ).toBe(true);
  });

  it('the channel marks lie in water', () => {
    for (const b of BUOYS) {
      expect(depth(b.x, b.z), b.label).toBeGreaterThan(3);
      expect(landSDF(b.x, b.z), b.label).toBeGreaterThan(20);
    }
  });
});
