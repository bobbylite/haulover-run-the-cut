// Shared helpers for the headless boat simulations.

import type { BoatEnv } from '../src/sim/boat';
import type { WaveSample } from '../src/sim/waves';

/** Flat, current-free, wind-free, bottomless water. */
export function calmEnv(): BoatEnv {
  return {
    time: 0,
    waveAt(_x, _z, out: WaveSample) {
      out.h = 0;
      out.vx = out.vy = out.vz = 0;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.jac = 1;
    },
    currentAt(_x, _z, out) {
      out.x = out.z = 0;
    },
    windAt(_x, _z, out) {
      out.x = out.z = 0;
    },
    seabedAt: () => -100,
    hardAt: () => 1e9,
    hardNormal(_x, _z, out) {
      out.x = 1;
      out.z = 0;
    },
    chopAt: () => 0,
  };
}
