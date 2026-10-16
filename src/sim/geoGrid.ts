// The baked sea-floor / exposure / tide grid shared by the CPU physics and the GPU shaders. It is built
// from a `Location`'s analytic fields once, so what the boat feels and what the shaders draw agree.

import { clamp } from '../core/math';
import type { Location, WorldExtents } from '../locations/types';

export class GeoGrid {
  readonly world: WorldExtents;
  /** Height-grid size (cells). */
  readonly nx: number;
  readonly nz: number;
  /** Cell size (m) and size (cells) of the tidal-flow grid. */
  readonly flowCell: number;
  readonly flowNx: number;
  readonly flowNz: number;

  /** Terrain/sea-floor height in metres (negative = underwater). */
  readonly height: Float32Array;
  /** Swell exposure 0..1. */
  readonly swell: Float32Array;
  /** Haystack (tide-rip standing wave) mask 0..1. */
  readonly hay: Float32Array;
  /** Floor kind: 0 sand, 1 seagrass, 2 rock. */
  readonly kind: Float32Array;
  /** Unit tidal flow (ebb positive). */
  readonly flowX: Float32Array;
  readonly flowZ: Float32Array;

  private constructor(loc: Location) {
    const w = loc.world;
    this.world = w;
    this.nx = (w.x1 - w.x0) / w.cell;
    this.nz = (w.z1 - w.z0) / w.cell;
    this.flowCell = loc.flowCell;
    this.flowNx = (w.x1 - w.x0) / loc.flowCell;
    this.flowNz = (w.z1 - w.z0) / loc.flowCell;
    this.height = new Float32Array(this.nx * this.nz);
    this.swell = new Float32Array(this.nx * this.nz);
    this.hay = new Float32Array(this.nx * this.nz);
    this.kind = new Float32Array(this.nx * this.nz);
    this.flowX = new Float32Array(this.flowNx * this.flowNz);
    this.flowZ = new Float32Array(this.flowNx * this.flowNz);
  }

  /** Bake a location's fields into grids. The result is read-only, so it is cached per location. */
  static bake(loc: Location): GeoGrid {
    const hit = cache.get(loc.id);
    if (hit) return hit;
    const g = new GeoGrid(loc);
    const f = loc.fields;
    const w = loc.world;
    const o = { x: 0, z: 0 };
    for (let j = 0; j < g.nz; j++) {
      const z = w.z0 + (j + 0.5) * w.cell;
      for (let i = 0; i < g.nx; i++) {
        const x = w.x0 + (i + 0.5) * w.cell;
        const idx = j * g.nx + i;
        const h = f.seabedHeight(x, z);
        g.height[idx] = h;
        g.swell[idx] = f.swellExposure(x, z);
        g.hay[idx] = f.hayMask(x, z);
        g.kind[idx] = f.floorKind(x, z, h);
      }
    }
    for (let j = 0; j < g.flowNz; j++) {
      const z = w.z0 + (j + 0.5) * g.flowCell;
      for (let i = 0; i < g.flowNx; i++) {
        const x = w.x0 + (i + 0.5) * g.flowCell;
        f.currentUnit(x, z, o);
        g.flowX[j * g.flowNx + i] = o.x;
        g.flowZ[j * g.flowNx + i] = o.z;
      }
    }
    cache.set(loc.id, g);
    return g;
  }

  private bilinear(a: Float32Array, nx: number, nz: number, cell: number, x: number, z: number): number {
    const fx = clamp((x - this.world.x0) / cell - 0.5, 0, nx - 1.001);
    const fz = clamp((z - this.world.z0) / cell - 0.5, 0, nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const i0 = iz * nx + ix;
    const a00 = a[i0] as number;
    const a10 = a[i0 + 1] as number;
    const a01 = a[i0 + nx] as number;
    const a11 = a[i0 + nx + 1] as number;
    return (a00 * (1 - tx) + a10 * tx) * (1 - tz) + (a01 * (1 - tx) + a11 * tx) * tz;
  }

  heightAt(x: number, z: number): number {
    return this.bilinear(this.height, this.nx, this.nz, this.world.cell, x, z);
  }
  swellAt(x: number, z: number): number {
    return this.bilinear(this.swell, this.nx, this.nz, this.world.cell, x, z);
  }
  hayAt(x: number, z: number): number {
    return this.bilinear(this.hay, this.nx, this.nz, this.world.cell, x, z);
  }
  kindAt(x: number, z: number): number {
    return this.bilinear(this.kind, this.nx, this.nz, this.world.cell, x, z);
  }
  flowAt(x: number, z: number, out: { x: number; z: number }): void {
    out.x = this.bilinear(this.flowX, this.flowNx, this.flowNz, this.flowCell, x, z);
    out.z = this.bilinear(this.flowZ, this.flowNx, this.flowNz, this.flowCell, x, z);
  }
}

const cache = new Map<string, GeoGrid>();
