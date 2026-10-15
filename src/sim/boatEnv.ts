// Adapter exposing the live Environment through the narrow interface the boat physics needs.

import type { BoatEnv } from './boat';
import type { Environment } from './environment';
import { hardNormal, hardSDF } from './geography';

/** Moving hard obstacles (other vessels) as circles; filled in by the traffic system each frame. */
export class DynamicObstacles {
  count = 0;
  readonly x = new Float64Array(64);
  readonly z = new Float64Array(64);
  readonly r = new Float64Array(64);

  clear(): void {
    this.count = 0;
  }

  add(x: number, z: number, r: number): void {
    if (this.count >= this.x.length) return;
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.r[this.count] = r;
    this.count++;
  }
}

export function makeBoatEnv(env: Environment, dyn?: DynamicObstacles): BoatEnv {
  const m = { s: 0, c: 0, h: 0 };
  return {
    get time() {
      return env.time;
    },
    waveAt: (x, z, out) => env.waves.sample(x, z, env.time, out),
    currentAt: (x, z, out) => env.currentAt(x, z, out),
    windAt: (x, z, out) => env.windAt(x, z, out),
    seabedAt: (x, z) => env.geo.heightAt(x, z),
    hardAt: dyn
      ? (x, z) => {
          let d = hardSDF(x, z);
          for (let i = 0; i < dyn.count; i++) {
            const dd = Math.hypot(x - (dyn.x[i] as number), z - (dyn.z[i] as number)) - (dyn.r[i] as number);
            if (dd < d) d = dd;
          }
          return d;
        }
      : hardSDF,
    hardNormal: dyn
      ? (x, z, out) => {
          // the nearest vessel wins if it is closer than the static geometry
          let best = hardSDF(x, z);
          let bi = -1;
          for (let i = 0; i < dyn.count; i++) {
            const dd = Math.hypot(x - (dyn.x[i] as number), z - (dyn.z[i] as number)) - (dyn.r[i] as number);
            if (dd < best) {
              best = dd;
              bi = i;
            }
          }
          if (bi < 0) {
            hardNormal(x, z, out);
            return;
          }
          const dx = x - (dyn.x[bi] as number);
          const dz = z - (dyn.z[bi] as number);
          const l = Math.hypot(dx, dz) || 1;
          out.x = dx / l;
          out.z = dz / l;
        }
      : hardNormal,
    chopAt: (x, z) => {
      env.waves.modulation(x, z, m);
      return m.c * env.sea.chopHeight + m.h * 0.7;
    },
    axisAt: (x, z, out) => env.waves.axisAt(x, z, out),
  };
}
