// Balance harness (not a regression test): runs the autopilot through the course for many combos.
// Run with: SWEEP=1 BOATS=console WEATHERS=breeze,squall CRUISES=0.4,0.7 npx vitest run tests/sweep.test.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { difficultyById } from '../src/data/difficulty';
import { weatherById } from '../src/data/weather';
import { Autopilot } from '../src/game/autopilot';
import { HAULOVER } from '../src/locations/haulover';
import { makeCourse } from '../src/locations/haulover/course';
import { SLIP_BERTH } from '../src/locations/haulover/geography';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';

const list = (v: string | undefined, d: string[]) => (v ? v.split(',') : d);

describe('balance sweep', () => {
  it.skipIf(!process.env.SWEEP)(
    'sweeps',
    () => {
      const boats = list(process.env.BOATS, ['console']);
      const weathers = list(process.env.WEATHERS, ['golden', 'breeze', 'dawn', 'squall', 'noreaster']);
      const cruises = list(process.env.CRUISES, ['0.4', '0.7']).map(Number);
      const tides = list(process.env.TIDES, ['ebb']) as ('ebb' | 'flood' | 'slack')[];
      const base = difficultyById(process.env.DIFF ?? 'weekender');
      // optional overrides for exploring the difficulty space: WS (waves), CS (current), WN (wind), CAP, LEAK
      const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
      const diff = {
        ...base,
        waveScale: num('WS', base.waveScale),
        currentScale: num('CS', base.currentScale),
        windScale: num('WN', base.windScale),
        capacity: num('CAP', base.capacity),
        leakScale: num('LEAK', base.leakScale),
      };
      const rows: string[] = [
        'boat       weather    tide  cruise | outcome   time  peakL  cap  %cap  maxPitch maxHeel  hullHits  minSpeed',
      ];
      for (const bid of boats)
        for (const wid of weathers)
          for (const tide of tides)
            for (const cruise of cruises) {
              const env = new Environment(HAULOVER);
              env.setConditions(weatherById(wid), tide, diff, true);
              const benv = makeBoatEnv(env);
              const route = (process.env.ROUTE ?? 'outbound') as 'outbound' | 'inbound';
              const course = makeCourse(route, diff.gateScale);
              const spec = boatById(bid);
              const boat = new Boat(spec);
              boat.reset(course.start.x, course.start.z, course.start.heading, benv);
              boat.capacityLimit = spec.capacity * diff.capacity;
              boat.water.autoBilge = diff.autoBilge;
              const ap = new Autopilot(course.path, cruise);
              ap.dock = route === 'inbound';
              ap.berth = SLIP_BERTH;
              const ctl = { throttle: 0, steer: 0, sheet: 0.5, pump: false };
              const DT = 1 / 30;
              let t = 0;
              let outcome = 'timeout';
              let maxPitch = 0;
              let maxHeel = 0;
              let hits = 0;
              let minSpeed = 99;
              const limit = 30 * Math.max(150, course.length / (0.25 * spec.topSpeed) + 40);
              for (let i = 0; i < limit; i++) {
                env.time += DT;
                t += DT;
                ap.update(boat, ctl);
                boat.setInput(ctl);
                boat.update(DT, benv);
                hits += boat.impacts.filter((m) => m.hard && m.speed > 2.2).length;
                boat.impacts.length = 0;
                maxPitch = Math.max(maxPitch, Math.abs(boat.pitch * 57.3));
                maxHeel = Math.max(maxHeel, Math.abs(boat.heelDeg));
                if (t > 20 && boat.pos.x > -450 && boat.pos.x < 1000)
                  minSpeed = Math.min(minSpeed, boat.speed);
                if (boat.sinking) {
                  outcome = 'SWAMPED';
                  break;
                }
                if (boat.capsized) {
                  outcome = 'CAPSIZE';
                  break;
                }
                if (route === 'outbound' ? boat.pos.x > 1010 : boat.pos.x < -515) {
                  outcome = 'finish';
                  break;
                }
                if (!Number.isFinite(boat.pos.x)) {
                  outcome = 'NaN';
                  break;
                }
              }
              const cap = boat.capacityLimit ?? 1;
              rows.push(
                `${bid.padEnd(10)} ${wid.padEnd(10)} ${tide.padEnd(5)} ${cruise.toFixed(2)}   | ${outcome.padEnd(9)} ${t.toFixed(0).padStart(4)}  ${boat.water.peakVolume.toFixed(0).padStart(5)} ${cap.toFixed(0).padStart(4)} ${((boat.water.peakVolume / cap) * 100).toFixed(0).padStart(4)}%  ${maxPitch.toFixed(0).padStart(6)}  ${maxHeel.toFixed(0).padStart(6)}    ${String(hits).padStart(3)}      ${minSpeed.toFixed(1)}`,
              );
            }
      const dir = join(tmpdir(), 'haulover-sweep');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'sweep.txt'), rows.join('\n'));
      console.log(rows.join('\n'));
    },
    900000,
  );
});
