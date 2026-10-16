// A whole Montauk day, in the pure sims: the fish world, the tackle and the fight, with a scripted captain
// on a kinematic boat in the real Montauk tide. It cheats on finding the school (the real search is a
// matter of reading the water) but everything after that is the game: slow down, set the spread, troll
// straight through, hook up, play the fish. What it pins is the shape of a day on each tier.
import { describe, expect, it } from 'vitest';
import { KNOTS, Rng, wrapAngle } from '../src/core/math';
import { weatherById } from '../src/data/weather';
import { MONTAUK } from '../src/locations/montauk';
import { FISH_ZONES, RANGE, START } from '../src/locations/montauk/geography';
import { Environment } from '../src/sim/environment';
import { Fight } from '../src/sim/fishing/fight';
import { Tackle, type Tackle as TackleT } from '../src/sim/fishing/tackle';
import { seaFor, tierById } from '../src/sim/fishing/tiers';
import { FishWorld } from '../src/sim/fishing/world';
import { captain, KBoat, SEA } from './fishHarness';

type Style = 'captain' | 'idle' | 'noLines' | 'speeder';

interface Day {
  landed: boolean;
  kg: number;
  strikes: number;
  lost: number;
  secs: number;
  tangles: number;
  spooks: number;
}

function playDay(tierId: string, seed: number, style: Style = 'captain'): Day {
  const tier = tierById(tierId);
  const env = new Environment(MONTAUK);
  env.setConditions(weatherById('m-dawn'), 'ebb', seaFor(tierId), true);
  const waters = {
    depthAt: (x: number, z: number) => env.depthAt(x, z),
    currentAt: (x: number, z: number, o: { x: number; z: number }) => env.currentAt(x, z, o),
  };
  const world = new FishWorld(waters, FISH_ZONES, RANGE, tier, seed);
  world.reset(seed, tier, START);
  const tackle: TackleT = new Tackle();
  const boat = new KBoat(11, 11);
  boat.x = START.x;
  boat.z = START.z;
  boat.heading = START.heading;
  boat.u = 0;
  const rng = new Rng(seed * 13 + 5);
  const cur = { x: 0, z: 0 };
  const day: Day = { landed: false, kg: 0, strikes: 0, lost: 0, secs: 0, tangles: 0, spooks: 0 };
  let fight: Fight | null = null;
  let leg: 'approach' | 'pass' | 'turn' = 'approach';
  let legT = 0;
  let setAt = -99;
  let t = 0;
  let thrI = 0.3;
  const dtSearch = 0.1;
  while (t < tier.daylightS && !day.landed) {
    const dt = fight ? 1 / 30 : dtSearch;
    t += dt;
    env.time += dt;
    env.currentAt(boat.x, boat.z, cur);
    const sea = { ...SEA, cx: cur.x, cz: cur.z, wx: -0.7, wz: 0 };
    const sx = boat.sx;
    const sz = boat.sz;
    const fx = Math.cos(boat.heading);
    const fz = Math.sin(boat.heading);

    if (fight) {
      let c = { throttle: 0, steer: 0, drag: 0.5, pump: false };
      if (style === 'captain') c = captain(fight, boat, t);
      else if (style === 'speeder') c = { throttle: 0.6, steer: 0, drag: 0.5, pump: false };
      boat.throttle = c.throttle;
      boat.steer = c.steer;
      boat.step(dt, sea);
      fight.step(dt, {
        sx: boat.sx,
        sz: boat.sz,
        fx: Math.cos(boat.heading),
        fz: Math.sin(boat.heading),
        vx: boat.vx - cur.x,
        vz: boat.vz - cur.z,
        boatLen: boat.len,
        slam: 0,
        rough: 0.4,
        heave: 0.6 * Math.sin((t / 7.5) * Math.PI * 2),
        floor: (x, z) => env.depthAt(x, z),
        current: (x, z, o) => env.currentAt(x, z, o),
        drag: c.drag,
        pump: c.pump,
      });
      world.step(dt, { x: boat.x, z: boat.z, sog: Math.abs(boat.u) });
      if (fight.end) {
        if (fight.end.kind === 'landed') {
          day.landed = true;
          day.kg = fight.kg;
        } else {
          day.lost++;
          const sch = world.schools.find((s) => s.tuna.some((q) => q.gone && q.kg === fight?.kg));
          if (sch) world.spook(sch, 50);
          tackle.release();
        }
        fight = null;
      }
      continue;
    }

    // ---- search and troll
    const tuna = world.schools.filter((s) => s.tuna.some((q) => !q.gone));
    const sch = [...tuna].sort(
      (a, b) => Math.hypot(a.x - boat.x, a.z - boat.z) - Math.hypot(b.x - boat.x, b.z - boat.z),
    )[0];
    let desired = boat.heading;
    let want = 0;
    let dist = 99999;
    if (sch) {
      dist = Math.hypot(sch.x - boat.x, sch.z - boat.z);
      const lead = Math.min(dist / 5, 120);
      desired = Math.atan2(sch.z + sch.vz * lead - boat.z, sch.x + sch.vx * lead - boat.x);
    }
    const stwKn = Math.max(0, boat.u) * KNOTS;
    const linesOut = tackle.linesOut > 0 || tackle.tangled > 0;
    if (style === 'idle') {
      boat.throttle = 0;
      boat.steer = 0;
    } else if (!sch || dist > 900) {
      want = style === 'speeder' ? 16 : 17;
      boat.steer = Math.max(-0.9, Math.min(0.9, 1.7 * wrapAngle(desired - boat.heading)));
    } else if (dist > 450 && !linesOut) {
      want = style === 'speeder' ? 16 : 9;
      boat.steer = Math.max(-0.9, Math.min(0.9, 1.7 * wrapAngle(desired - boat.heading)));
    } else {
      want = linesOut ? 6.1 : 7;
      if (!linesOut && style !== 'noLines' && t - setAt > 4 && stwKn < 8.5) {
        tackle.setLines(stwKn);
        setAt = t;
      }
      legT += dt;
      if (leg === 'approach') {
        boat.steer = Math.max(-0.1, Math.min(0.1, 1.1 * wrapAngle(desired - boat.heading)));
        if (dist < 45) {
          leg = 'pass';
          legT = 0;
        }
      } else if (leg === 'pass') {
        boat.steer = 0;
        if (legT > 55 || dist > 450) {
          leg = 'turn';
          legT = 0;
        }
      } else {
        boat.steer = wrapAngle(desired - boat.heading) > 0 ? 0.11 : -0.11;
        if (Math.abs(wrapAngle(desired - boat.heading)) < 0.3 || legT > 120) {
          leg = 'approach';
          legT = 0;
        }
      }
      if (tackle.tangled) {
        boat.steer = 0;
        want = 4.6;
      }
    }
    if (style !== 'idle') {
      const e = want / KNOTS - boat.u;
      thrI = Math.max(0, Math.min(0.95, thrI + 0.18 * e * dt));
      boat.throttle = Math.max(-0.3, Math.min(1, (thrI + 0.07 * e) / (boat.top / 12)));
    }
    const yaw0 = boat.heading;
    boat.step(dt, sea);
    world.step(dt, { x: boat.x, z: boat.z, sog: Math.abs(boat.u) });
    day.spooks += world.events.filter((e) => e.kind === 'spooked').length;
    world.events.length = 0;
    tackle.update(
      dt,
      { sx, sz, fx, fz, stw: boat.u, yawRate: wrapAngle(boat.heading - yaw0) / dt, cx: cur.x, cz: cur.z },
      (x, z, r) => world.tunaNear(x, z, r),
      rng,
      tier.bite,
    );
    for (const e of tackle.drain()) {
      if (e.kind === 'tangle') day.tangles++;
      if (e.kind === 'strike') {
        day.strikes++;
        e.tuna.gone = true;
        tackle.hook(e.rod);
        const line = Math.hypot(e.rod.x - boat.sx, e.rod.z - boat.sz) + 4;
        fight = new Fight(e.tuna.species, e.tuna.kg, tier, seed * 100 + day.strikes, {
          x: e.rod.x,
          z: e.rod.z,
          depth: Math.max(2, e.tuna.depth),
          line,
        });
      }
    }
  }
  day.secs = t;
  return day;
}

const days = (tier: string, style: Style, n = 16): Day[] =>
  Array.from({ length: n }, (_, i) => playDay(tier, i + 1, style));
const rate = (ds: Day[]): number => ds.filter((d) => d.landed).length / ds.length;

if (process.env.DAY_TABLE) {
  describe('day table', () => {
    it('prints', () => {
      const rows: string[] = [];
      for (const tier of ['dockside', 'weekender', 'captain', 'legend']) {
        for (const style of ['captain', 'speeder'] as Style[]) {
          const ds = days(tier, style, 30);
          const landed = ds.filter((d) => d.landed);
          rows.push(
            `${tier.padEnd(10)} ${style.padEnd(8)} land ${(rate(ds) * 100).toFixed(0).padStart(3)}%  strikes/day ${(ds.reduce((a, d) => a + d.strikes, 0) / ds.length).toFixed(1)}  lost/day ${(ds.reduce((a, d) => a + d.lost, 0) / ds.length).toFixed(1)}  tangles ${(ds.reduce((a, d) => a + d.tangles, 0) / ds.length).toFixed(1)}  spooks ${(ds.reduce((a, d) => a + d.spooks, 0) / ds.length).toFixed(1)}  meanLandedAt ${landed.length ? (landed.reduce((a, d) => a + d.secs, 0) / landed.length).toFixed(0) : '-'}s  kg ${landed.length ? (landed.reduce((a, d) => a + d.kg, 0) / landed.length).toFixed(0) : '-'}`,
          );
        }
      }
      console.log(rows.join('\n'));
    });
  });
}

describe('a day at Montauk (scripted captain, pure sims)', () => {
  it('is deterministic for a seed', () => {
    expect(playDay('weekender', 4)).toEqual(playDay('weekender', 4));
  });

  it('a good captain lands a tuna most days on the easier tiers, and some on the hardest', () => {
    expect(rate(days('dockside', 'captain'))).toBeGreaterThan(0.55);
    expect(rate(days('weekender', 'captain'))).toBeGreaterThan(0.4);
    expect(rate(days('legend', 'captain'))).toBeGreaterThan(0.08);
  });

  it('the days get harder up the ladder', () => {
    const [d, l] = [rate(days('dockside', 'captain')), rate(days('legend', 'captain'))];
    expect(d).toBeGreaterThan(l + 0.1);
  });

  it('a boat that sits still, never sets lines, or only ever speeds, lands nothing', () => {
    expect(rate(days('dockside', 'idle', 8))).toBe(0);
    expect(rate(days('dockside', 'noLines', 8))).toBe(0);
    expect(rate(days('dockside', 'speeder', 8))).toBeLessThan(0.15);
  });

  it('the bait is real work: strikes are hard-won, not handed out', () => {
    const ds = days('weekender', 'captain');
    const mean = ds.reduce((a, d) => a + d.strikes, 0) / ds.length;
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(5);
  });
});
