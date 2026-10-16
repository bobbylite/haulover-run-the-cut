// Flat-water calibration: each boat must float level, reach its intended top speed, turn, and settle.
import { describe, expect, it } from 'vitest';
import { BOATS } from '../src/data/boats';
import { Boat } from '../src/sim/boat';
import { calmEnv } from './helpers';

const DT = 1 / 60;
const RAD = 180 / Math.PI;

/** Intended flat-water, motor-only top speeds (m/s). */
const TOP: Record<string, number> = { console: 22, gofast: 32, cruiser: 13.5, sloop: 3.9, pontoon: 8.6 };

function settle(boat: Boat, env: ReturnType<typeof calmEnv>, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) {
    env.time += DT;
    boat.update(DT, env);
  }
}

describe('boat calibration (flat water)', () => {
  for (const spec of BOATS) {
    describe(spec.id, () => {
      const env = calmEnv();
      const boat = new Boat(spec);
      boat.reset(0, 0, 0);
      boat.sailUp = false;

      it('floats level and still at rest', () => {
        settle(boat, env, 6);
        expect(Math.abs(boat.pos.y - spec.cg[1])).toBeLessThan(0.06);
        expect(Math.abs(boat.pitch * RAD)).toBeLessThan(1.5);
        expect(Math.abs(boat.heelDeg)).toBeLessThan(0.5);
        expect(Math.abs(boat.vel.y)).toBeLessThan(0.01);
      });

      it('reaches its intended top speed without porpoising', () => {
        boat.setInput({ throttle: 1, steer: 0, sheet: 0.5, pump: false });
        let maxPitch = 0;
        for (let i = 0; i < 40 / DT; i++) {
          env.time += DT;
          boat.update(DT, env);
          maxPitch = Math.max(maxPitch, Math.abs(boat.pitch * RAD));
        }
        const target = TOP[spec.id] as number;
        expect(boat.speed).toBeGreaterThan(target * 0.93);
        expect(boat.speed).toBeLessThan(target * 1.07);
        expect(maxPitch).toBeLessThan(8);
      }, 30000);

      it('turns without rolling over', () => {
        boat.setInput({ throttle: 0.7, steer: 0, sheet: 0.5, pump: false });
        settle(boat, env, 12);
        boat.setInput({ throttle: 0.7, steer: 1, sheet: 0.5, pump: false });
        const start = boat.heading;
        let last = start;
        let swept = 0;
        let maxHeel = 0;
        for (let i = 0; i < 10 / DT; i++) {
          env.time += DT;
          boat.update(DT, env);
          let d = boat.heading - last;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          swept += d;
          last = boat.heading;
          maxHeel = Math.max(maxHeel, Math.abs(boat.heelDeg));
        }
        expect((Math.abs(swept) / 10) * RAD).toBeGreaterThan(8);
        expect(maxHeel).toBeLessThan(30);
        expect(boat.capsized).toBe(false);
      }, 30000);

      it('slows to a drift when the throttle is cut', () => {
        boat.setInput({ throttle: 0, steer: 0, sheet: 0.5, pump: false });
        settle(boat, env, 20);
        expect(boat.speed).toBeLessThan(4);
        expect(Number.isFinite(boat.pos.x)).toBe(true);
      });

      it('has believable heave and roll dynamics', () => {
        const b = new Boat(spec);
        b.reset(0, 0, 0);
        b.sailUp = false;
        const e = calmEnv();
        settle(b, e, 5);
        b.vel.y = -0.8;
        let crossings = 0;
        let prev = b.vel.y;
        let t1 = 0;
        let t3 = 0;
        for (let i = 0; i < 6 / DT; i++) {
          e.time += DT;
          b.update(DT, e);
          if (prev < 0 && b.vel.y >= 0) {
            crossings++;
            if (crossings === 1) t1 = i * DT;
            if (crossings === 3) t3 = i * DT;
          }
          prev = b.vel.y;
        }
        // heave settles with a 0.7–2.5 s period (or is over-damped)
        if (t3 > t1) expect((t3 - t1) / 2).toBeGreaterThan(0.7);
        if (t3 > t1) expect((t3 - t1) / 2).toBeLessThan(2.5);
        expect(Math.abs(b.vel.y)).toBeLessThan(0.3);
      });
    });
  }
});
