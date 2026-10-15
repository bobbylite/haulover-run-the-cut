// Wind with travelling gust fronts. Mirrored in the water shader for "cat's-paw" darkening.

import { TAU } from '../core/math';

export class WindField {
  /** Mean wind speed (m/s). */
  speed = 5;
  /** Direction the wind blows towards, unit vector in (x, z). */
  dirX = -1;
  dirZ = 0;
  /** Gust strength 0..1 (fraction of mean speed). */
  gust = 0.3;

  setFromCompass(speed: number, fromDeg: number, gust: number): void {
    this.speed = speed;
    this.gust = gust;
    // compass bearing the wind comes FROM; N = -z, E = +x
    const a = (fromDeg * Math.PI) / 180;
    this.dirX = -Math.sin(a);
    this.dirZ = Math.cos(a);
  }

  /** Direction the wind blows towards as an angle (atan2(z, x)). */
  get dirAngle(): number {
    return Math.atan2(this.dirZ, this.dirX);
  }

  /** Gust signal in [-1, 1] at a point. */
  gustSignal(x: number, z: number, t: number): number {
    const c = this.dirX;
    const s = this.dirZ;
    const u = x * c + z * s;
    const v = -x * s + z * c;
    const a1 = (u - this.speed * 0.6 * t) * (TAU / 310) + Math.sin(v * (TAU / 520)) * 1.7;
    const a2 = (u - this.speed * 0.45 * t) * (TAU / 137) + 1.9 + Math.sin(v * (TAU / 211) + 0.7) * 1.3;
    return 0.62 * Math.sin(a1) + 0.38 * Math.sin(a2);
  }

  /** Local wind speed multiplier. */
  factor(x: number, z: number, t: number): number {
    return Math.max(0.2, 1 + this.gust * this.gustSignal(x, z, t));
  }

  /** Wind velocity vector (m/s) at a point. */
  sample(x: number, z: number, t: number, out: { x: number; z: number }): void {
    const sp = this.speed * this.factor(x, z, t);
    out.x = this.dirX * sp;
    out.z = this.dirZ * sp;
  }
}
