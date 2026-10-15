// The docking challenge must be possible: the autopilot (a crude skipper) has to be able to thread the
// piling field, reach the slip, and park there for every hull that can reasonably be asked to.
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { Autopilot } from '../src/game/autopilot';
import { crossedGate, makeCourse } from '../src/game/course';
import { Docking } from '../src/game/docking';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';
import { DOCK_APPROACH, GeoGrid, hardSDF, MOORED, PILINGS, SLIP } from '../src/sim/geography';

function dockRun(boatId: string, weather: string): 'docked' | 'timeout' | 'sunk' | 'capsized' | 'gaveup' {
  const diff = difficultyById('weekender');
  const env = new Environment();
  env.setConditions(weatherById(weather), 'flood', diff, true);
  const benv = makeBoatEnv(env);
  const course = makeCourse('inbound', diff.gateScale);
  const spec = boatById(boatId);
  const boat = new Boat(spec);
  boat.reset(course.start.x, course.start.z, course.start.heading, benv);
  boat.capacityLimit = spec.capacity * diff.capacity;
  boat.water.autoBilge = diff.autoBilge;
  const ap = new Autopilot(course.path, 0.5);
  ap.dock = true;
  const dock = new Docking();
  const ctl = { throttle: 0, steer: 0, sheet: 0.5, pump: false };
  const dt = 1 / 30;
  let gate = 0;
  let px = boat.pos.x;
  let pz = boat.pos.z;
  for (let i = 0; i < 30 * 600; i++) {
    env.time += dt;
    ap.update(boat, ctl, dt);
    boat.setInput(ctl);
    boat.update(dt, benv);
    boat.impacts.length = 0;
    while (
      gate < course.gates.length &&
      crossedGate(course.gates[gate]!, px, pz, boat.pos.x, boat.pos.z, 6)
    ) {
      if (course.gates[gate]!.kind === 'dock') dock.start(diff.dockTime);
      gate++;
    }
    px = boat.pos.x;
    pz = boat.pos.z;
    if (dock.active) {
      const r = dock.update(dt, boat, benv);
      if (r) return r;
    }
    if (boat.sinking) return 'sunk';
    if (boat.capsized) return 'capsized';
  }
  return 'gaveup';
}

describe('docking challenge', () => {
  it('the approach corridor, slip and berth are open water of sufficient depth', () => {
    const geo = GeoGrid.bake();
    for (const [x, z] of DOCK_APPROACH) {
      expect(-geo.heightAt(x, z), `depth ${x},${z}`).toBeGreaterThan(2.5);
      expect(hardSDF(x, z), `clearance ${x},${z}`).toBeGreaterThan(5);
    }
    expect(hardSDF((SLIP.x0 + SLIP.x1) / 2, SLIP.z)).toBeGreaterThan(SLIP.half - 1.5);
  });

  it('the target slip is free of moored boats and pilings', () => {
    for (const m of MOORED)
      expect(Math.abs(m.z - SLIP.z), `moored at ${m.x},${m.z}`).toBeGreaterThan(SLIP.half);
    for (const p of PILINGS) {
      if (p.x > SLIP.x0 && p.x < SLIP.x1) expect(Math.abs(p.z - SLIP.z)).toBeGreaterThan(SLIP.half - 1);
    }
  });

  it('there is a real piling field to evade', () => {
    expect(PILINGS.filter((p) => p.r < 1).length).toBeGreaterThan(50);
  });

  it('a console, a go-fast and a cruiser can all be parked by the autopilot', () => {
    for (const id of ['console', 'gofast', 'cruiser']) expect(dockRun(id, 'breeze'), id).toBe('docked');
  }, 120000);
});
