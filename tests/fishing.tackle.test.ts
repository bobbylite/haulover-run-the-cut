// Trolling: the speed window, where lures trail, tangles from turning, backing down, and strikes.
import { describe, expect, it } from 'vitest';
import { KNOTS, Rng } from '../src/core/math';
import { SPECIES } from '../src/sim/fishing/species';
import { speedWindow, Tackle, type TrollInput } from '../src/sim/fishing/tackle';
import type { SchoolTuna } from '../src/sim/fishing/world';
import { KBoat, type Sea } from './fishHarness';

const CALM: Sea = { cx: 0, cz: 0, wx: 0, wz: 0, slams: 0 };

interface Drive {
  boat: KBoat;
  tackle: Tackle;
  rng: Rng;
  t: number;
  sea: Sea;
  events: string[];
}

function start(speedKn: number, sea: Sea = CALM): Drive {
  const boat = new KBoat();
  boat.u = speedKn / KNOTS;
  boat.throttle = boat.u / boat.top;
  const tackle = new Tackle();
  const fx = Math.cos(boat.heading);
  const fz = Math.sin(boat.heading);
  tackle.prime(boat.sx, boat.sz, fx, fz);
  return { boat, tackle, rng: new Rng(5), t: 0, sea, events: [] };
}

function run(
  d: Drive,
  secs: number,
  steer = 0,
  tuna: (x: number, z: number, r: number) => SchoolTuna[] = () => [],
): void {
  const dt = 1 / 30;
  const b = d.boat;
  const target = b.u;
  for (let i = 0; i < secs / dt; i++) {
    b.steer = steer;
    b.throttle = target / b.top;
    const yaw0 = b.heading;
    b.step(dt, d.sea);
    const inp: TrollInput = {
      sx: b.sx,
      sz: b.sz,
      fx: Math.cos(b.heading),
      fz: Math.sin(b.heading),
      stw: b.u,
      yawRate: (b.heading - yaw0) / dt,
      cx: d.sea.cx,
      cz: d.sea.cz,
    };
    d.tackle.update(dt, inp, tuna, d.rng);
    for (const e of d.tackle.drain()) d.events.push(e.kind);
    d.t += dt;
  }
}

describe('the speed window', () => {
  it('is zero when too slow or too fast, and best around six knots', () => {
    expect(speedWindow(0.8)).toBe(0);
    expect(speedWindow(11)).toBe(0);
    expect(speedWindow(6.1)).toBeGreaterThan(0.95);
    expect(speedWindow(3)).toBeLessThan(speedWindow(5));
    expect(speedWindow(9)).toBeLessThan(0.45);
    expect(speedWindow(9)).toBeLessThan(speedWindow(7));
  });
});

describe('the spread', () => {
  it('lines go out one after another and lure positions lie straight astern when you hold course', () => {
    const d = start(6);
    expect(d.tackle.setLines(6)).toBe(true);
    run(d, 3);
    expect(d.tackle.rods.some((r) => r.state === 'setting')).toBe(true);
    run(d, 14);
    expect(d.tackle.fishing).toBe(4);
    const b = d.boat;
    for (const r of d.tackle.rods) {
      const behind = (b.sx - r.x) * Math.cos(b.heading) + (b.sz - r.z) * Math.sin(b.heading);
      const lat = (r.x - b.sx) * -Math.sin(b.heading) + (r.z - b.sz) * Math.cos(b.heading);
      expect(behind).toBeGreaterThan(r.spec.out - 4);
      expect(behind).toBeLessThan(r.spec.out + 4);
      expect(lat).toBeCloseTo(r.spec.lureLat, 0);
    }
  });

  it('the crew will not set lines at speed', () => {
    const d = start(12);
    expect(d.tackle.setLines(12)).toBe(false);
  });

  it('the tide alone does not bend the spread (boat and lures share the water) but leeway does', () => {
    const lat = (sea: Sea) => {
      const d = start(6, sea);
      d.tackle.setLines(6);
      run(d, 30);
      const far = d.tackle.rods.find((r) => r.spec.id === 3)!;
      return (
        (far.x - d.boat.sx) * -Math.sin(d.boat.heading) +
        (far.z - d.boat.sz) * Math.cos(d.boat.heading) -
        far.spec.lureLat
      );
    };
    expect(Math.abs(lat({ cx: 0, cz: 1.4, wx: 0, wz: 0, slams: 0 }))).toBeLessThan(2);
    // a beam wind slides the boat to starboard through the water: the lures are left to port of her
    expect(lat({ cx: 0, cz: 0, wx: 0, wz: 0.8, slams: 0 })).toBeLessThan(-6);
  });
});

describe('tangles', () => {
  const trollAndTurn = (steer: number, secs: number) => {
    const d = start(6);
    d.tackle.setLines(6);
    run(d, 14);
    expect(d.tackle.fishing).toBe(4);
    run(d, secs, steer);
    return d;
  };

  it('gentle corrections do not cross the lines', () => {
    const d = trollAndTurn(0.03, 8);
    expect(d.events).not.toContain('tangle');
  });

  it('a hard turn crosses them', () => {
    const d = trollAndTurn(1, 8);
    expect(d.events).toContain('tangle');
    expect(d.tackle.tangled).toBeGreaterThanOrEqual(2);
  });

  it('a tangled rod does not fish, and a calm straight run clears it', () => {
    const d = trollAndTurn(1, 8);
    const before = d.tackle.tangled;
    expect(before).toBeGreaterThan(0);
    run(d, 3);
    expect(d.tackle.tangled).toBeGreaterThan(0);
    run(d, 14, 0);
    expect(d.tackle.tangled).toBe(0);
    expect(d.events).toContain('cleared');
    // and once they are back out they fish again without crossing straight away
    run(d, 14, 0);
    expect(d.tackle.fishing).toBe(4);
  });

  it('backing down with lines out wraps the prop', () => {
    const d = start(6);
    d.tackle.setLines(6);
    run(d, 14);
    d.boat.u = -1.5;
    const dt = 1 / 30;
    for (let i = 0; i < 90; i++) {
      d.boat.step(dt, CALM);
      d.tackle.update(
        dt,
        {
          sx: d.boat.sx,
          sz: d.boat.sz,
          fx: Math.cos(d.boat.heading),
          fz: Math.sin(d.boat.heading),
          stw: -1.5,
          yawRate: 0,
          cx: 0,
          cz: 0,
        },
        () => [],
        d.rng,
      );
      for (const e of d.tackle.drain()) d.events.push(e.kind);
    }
    expect(d.events).toContain('foul');
  });
});

describe('strikes', () => {
  const tunaBehind = (d: Drive, rodId: number, depth: number): SchoolTuna => {
    const rod = d.tackle.rods[rodId]!;
    const sp = SPECIES.yellowfin;
    return {
      id: 1,
      species: sp,
      kg: 50,
      ang: 0,
      rad: 0,
      spd: 0,
      depth,
      hunger: 1,
      appetite: 1,
      x: rod.x,
      z: rod.z,
      gone: false,
    };
  };

  /** Fraction of 40 seeded short trolls past a hungry tuna that end in a strike. */
  const strikeRate = (kn: number, secs = 4): number => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const d = start(kn);
      d.rng = new Rng(seed);
      d.tackle.setLines(kn);
      run(d, 14);
      const f = tunaBehind(d, 2, d.tackle.rods[2]!.depth);
      let got = false;
      const dt = 1 / 30;
      for (let i = 0; i < secs / dt && !got; i++) {
        // the tuna keeps station on the lure (a school the boat is trolling through)
        const r = d.tackle.rods[2]!;
        f.x = r.x;
        f.z = r.z;
        f.depth = r.depth;
        d.boat.step(dt, CALM);
        d.tackle.update(
          dt,
          { sx: d.boat.sx, sz: d.boat.sz, fx: 1, fz: 0, stw: d.boat.u, yawRate: 0, cx: 0, cz: 0 },
          () => [f],
          d.rng,
        );
        got = d.tackle.drain().some((e) => e.kind === 'strike');
      }
      if (got) hits++;
    }
    return hits / 40;
  };

  it('hungry tuna take a lure at troll speed, rarely too slow, never when it is skipping', () => {
    const good = strikeRate(6);
    expect(good).toBeGreaterThan(0.8);
    expect(strikeRate(2.5)).toBeLessThan(good * 0.6);
    expect(strikeRate(12)).toBe(0);
  });

  it('a lure at the wrong depth is ignored', () => {
    const d = start(6);
    d.tackle.setLines(6);
    run(d, 14);
    const f = tunaBehind(d, 2, 55);
    let got = false;
    for (let i = 0; i < 30 * 30 && !got; i++) {
      const r = d.tackle.rods[2]!;
      f.x = r.x;
      f.z = r.z;
      d.boat.step(1 / 30, CALM);
      d.tackle.update(
        1 / 30,
        { sx: d.boat.sx, sz: d.boat.sz, fx: 1, fz: 0, stw: d.boat.u, yawRate: 0, cx: 0, cz: 0 },
        () => [f],
        d.rng,
      );
      got = d.tackle.drain().some((e) => e.kind === 'strike');
    }
    expect(got).toBe(false);
  });

  it('hooking a fish brings the other lines in and frees the rod afterwards', () => {
    const d = start(6);
    d.tackle.setLines(6);
    run(d, 14);
    d.tackle.hook(d.tackle.rods[1]!);
    expect(d.tackle.hooked).toBe(d.tackle.rods[1]);
    run(d, 8);
    expect(d.tackle.rods.filter((r) => r.state === 'stowed')).toHaveLength(3);
    d.tackle.release();
    expect(d.tackle.rods.every((r) => r.state === 'stowed')).toBe(true);
  });
});
