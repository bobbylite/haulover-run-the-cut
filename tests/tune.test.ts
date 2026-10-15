// Not a regression test: a calibration helper that finds the hull drag multiplier which gives each
// boat its intended flat-water top speed. Run with TUNE=1; results land in $TMPDIR/haulover-tune.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { BOATS } from '../src/data/boats';
import { Boat } from '../src/sim/boat';
import type { BoatSpec } from '../src/sim/boatSpec';
import { calmEnv } from './helpers';

const OUT = join(tmpdir(), 'haulover-tune');
const env = calmEnv();
const DT = 1 / 60;

function topSpeed(spec: BoatSpec, scale: number, extraMass = 0): number {
  const s = structuredClone(spec) as BoatSpec;
  for (const m of s.samples) m.dragX *= scale;
  const b = new Boat(s);
  b.reset(0, 0, 0);
  b.sailUp = false;
  if (extraMass > 0) b.water.volume = (extraMass * s.mass) / (1025 * s.waterMassScale);
  for (let i = 0; i < 360; i++) b.update(DT, env);
  b.setInput({ throttle: 1, steer: 0, sheet: 0.5, pump: false });
  for (let i = 0; i < 60 * 45; i++) {
    env.time += DT;
    b.update(DT, env);
  }
  return b.speed;
}

describe.skipIf(!process.env.TUNE)('tune', () => {
  it('finds drag scale per boat', () => {
    const targets: Record<string, number> = {
      console: 22,
      gofast: 32,
      cruiser: 13.5,
      sloop: 5.0,
      pontoon: 8.6,
    };
    const res: Record<string, unknown> = {};
    for (const spec of BOATS) {
      const target = targets[spec.id] as number;
      let lo = 0.3;
      let hi = 10;
      let best = 1;
      let bestV = 0;
      for (let it = 0; it < 9; it++) {
        const mid = Math.sqrt(lo * hi);
        const v = topSpeed(spec, mid);
        best = mid;
        bestV = v;
        if (v > target) lo = mid;
        else hi = mid;
      }
      res[spec.id] = {
        scale: +best.toFixed(3),
        speed: +bestV.toFixed(2),
        target,
        dragX: +(spec.samples.reduce((a, s) => a + s.dragX, 0) * best).toFixed(1),
        loaded25: +topSpeed(spec, best, 0.25).toFixed(1),
        loaded50: +topSpeed(spec, best, 0.5).toFixed(1),
        drag120: +topSpeed(spec, best * 1.2).toFixed(1),
        drag150: +topSpeed(spec, best * 1.5).toFixed(1),
      };
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'tune.json'), JSON.stringify(res, null, 1));
    }
  }, 600000);
});
