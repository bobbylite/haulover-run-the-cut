// The fish world: where bait forms, how it drifts, what a captain can read, and what spooks it.
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/math';
import { tierById } from '../src/sim/fishing/tiers';
import { cueSeen, FishWorld, visibilityRange, type Waters, type Zone } from '../src/sim/fishing/world';

const waters: Waters = {
  depthAt: () => 40,
  currentAt: (_x, _z, o) => {
    o.x = 0.5;
    o.z = 0;
  },
};
const zones: Zone[] = [
  { x: 800, z: 0, r: 300, weight: 1 },
  { x: 1500, z: -400, r: 300, weight: 1 },
  { x: 2200, z: 500, r: 300, weight: 1 },
  { x: 2800, z: -200, r: 300, weight: 1 },
  { x: 1200, z: 900, r: 300, weight: 1 },
  { x: 2000, z: -1000, r: 300, weight: 1 },
];
const make = (tier = 'weekender', seed = 7) => {
  const w = new FishWorld(waters, zones, { x: 3300, z: 1950 }, tierById(tier), seed);
  w.reset(seed, tierById(tier), { x: 0, z: 0 });
  return w;
};

describe('the fish world', () => {
  it('starts stocked for the tier, with a tuna school a run from the boat', () => {
    for (const t of ['dockside', 'weekender', 'captain', 'legend']) {
      const w = make(t);
      expect(w.schools.length).toBe(tierById(t).schools);
      const near = w.schools.find(
        (s) => s.tuna.length > 0 && Math.hypot(s.x, s.z) > 800 && Math.hypot(s.x, s.z) < 2000,
      );
      expect(near, t).toBeDefined();
    }
  });

  it('is deterministic: the same seed gives the same sea', () => {
    const a = make('captain', 11);
    const b = make('captain', 11);
    for (let i = 0; i < 600; i++) {
      a.step(0.25, { x: 100, z: 50, sog: 3 });
      b.step(0.25, { x: 100, z: 50, sog: 3 });
    }
    expect(a.schools.map((s) => [s.id, Math.round(s.x), Math.round(s.z), s.tuna.length])).toEqual(
      b.schools.map((s) => [s.id, Math.round(s.x), Math.round(s.z), s.tuna.length]),
    );
    expect(make('captain', 12).schools[0]?.x).not.toBe(make('captain', 11).schools[0]?.x);
  });

  it('schools drift with the tide', () => {
    const w = make();
    const s = w.schools[0]!;
    const x0 = s.x;
    for (let i = 0; i < 240; i++) w.step(0.25, { x: -3000, z: 0, sog: 0 });
    expect(s.x - x0).toBeGreaterThan(60 * 0.5 * 0.5 - 40);
  });

  it('a boat charging a school is spooked off it; a slow troll is not', () => {
    const w = make();
    const s = w.schools.find((q) => q.tuna.length > 0)!;
    s.age = 60;
    const fast = { x: s.x - 60, z: s.z, sog: 7 };
    for (let i = 0; i < 20; i++) w.step(0.25, fast);
    expect(s.spooked).toBeGreaterThan(0);
    expect(w.events.some((e) => e.kind === 'spooked' && e.school === s)).toBe(true);
    const w2 = make();
    const q = w2.schools.find((z) => z.tuna.length > 0)!;
    q.age = 60;
    for (let i = 0; i < 200; i++) w2.step(0.25, { x: q.x - 60, z: q.z, sog: 3 });
    expect(q.spooked).toBe(0);
  });

  it('a spooked school goes quiet: no birds, no boils, no bites, thin on the sonar', () => {
    const w = make();
    const s = w.schools.find((q) => q.tuna.length > 0 && q.surface) ?? w.schools[0]!;
    s.surface = true;
    s.age = 120;
    s.phase = Math.PI / 2 - (s.age / s.period) * Math.PI * 2; // peak of a feeding pulse
    for (let i = 0; i < 80; i++) w.step(0.25, { x: -3000, z: 0, sog: 0 });
    const loud = w
      .cues()
      .filter((c) => c.school === s)
      .map((c) => c.kind);
    expect(loud).toContain('birds');
    w.spook(s, 60);
    for (let i = 0; i < 80; i++) w.step(0.25, { x: -3000, z: 0, sog: 0 });
    const quiet = w
      .cues()
      .filter((c) => c.school === s)
      .map((c) => c.kind);
    expect(quiet).not.toContain('birds');
    expect(quiet).not.toContain('boil');
    for (const f of s.tuna) expect(f.appetite).toBeLessThan(0.05);
  });

  it('boils mean tuna; decoys give birds but never boils', () => {
    const w = make('dockside', 3);
    for (const s of w.schools) {
      s.surface = true;
      s.age = 120;
      s.feeding = 1;
    }
    const cues = w.cues();
    for (const c of cues) {
      if (c.kind === 'boil') expect(c.school.tuna.some((f) => !f.gone)).toBe(true);
    }
    const decoy = w.schools.find((s) => s.tuna.length === 0);
    if (decoy) expect(cues.some((c) => c.school === decoy && c.kind === 'boil')).toBe(false);
  });

  it('the fish finder sees a school only from right above it, and tuna as marks under the bait', () => {
    const w = make();
    const s = w.schools.find((q) => q.tuna.length > 0)!;
    s.age = 100;
    s.density = 0.9;
    const f = s.tuna[0]!;
    const over = w.echo(f.x, f.z);
    expect(over.bait).not.toBeNull();
    expect(over.marks.length).toBeGreaterThan(0);
    expect(over.marks[0]!.depth).toBeGreaterThan(over.bait!.depth);
    const far = w.echo(s.x + s.radius + 80, s.z);
    expect(far.bait).toBeNull();
    expect(far.marks).toHaveLength(0);
  });

  it('keeps the sea stocked as schools dissolve', () => {
    const w = make('weekender', 5);
    const n = w.schools.length;
    const first = w.schools[0]!;
    first.age = first.life + 1;
    for (let i = 0; i < 400; i++) w.step(0.25, { x: 0, z: 0, sog: 2 });
    expect(w.schools.length).toBe(n);
    expect(w.schools.includes(first)).toBe(false);
  });

  it('visibility shrinks in haze and doubles in binoculars; far cues are not seen', () => {
    expect(visibilityRange(0.0007, false)).toBeGreaterThan(visibilityRange(0.0023, false));
    expect(visibilityRange(0.0023, true)).toBeCloseTo(visibilityRange(0.0023, false) * 2);
    const w = make();
    const c = {
      school: w.schools[0]!,
      kind: 'birds' as const,
      x: 1000,
      z: 0,
      strength: 1,
      reach: 0.9,
    };
    expect(cueSeen(c, 0, 0, 0, 1, 3000).seen).toBe(true);
    expect(cueSeen(c, 0, 0, Math.PI, 1, 3000).seen).toBe(false);
    expect(cueSeen(c, -2500, 0, 0, 1, 3000).seen).toBe(false);
    void Rng;
  });
});
