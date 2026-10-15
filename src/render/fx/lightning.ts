// Lightning: a random strike scheduler with a double-pulse flash envelope, jagged branching bolts
// (additive lines, HDR so they bloom) and a thunder callback delayed by distance.

import { vec3 } from 'three/tsl';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  LineBasicNodeMaterial,
  LineSegments,
} from 'three/webgpu';
import { Rng } from '../../core/math';

type N = any;

export interface LightningOut {
  /** 0..1 flash envelope for sky / fog / overlay. */
  flash: number;
}

export class Lightning {
  readonly mesh: LineSegments;
  flash = 0;
  private t = 99;
  private next = 6;
  private readonly rng = new Rng(4040);
  private readonly pos: Float32Array;
  private readonly geo: BufferGeometry;
  private readonly maxSeg = 220;
  private visible = 0;
  onThunder?: (delay: number, loudness: number) => void;

  constructor() {
    this.pos = new Float32Array(this.maxSeg * 2 * 3);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setDrawRange(0, 0);
    const m = new LineBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.blending = AdditiveBlending;
    m.fog = false;
    m.colorNode = vec3(14.0, 16.0, 26.0) as N;
    this.mesh = new LineSegments(this.geo, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    this.mesh.name = 'lightning';
  }

  private strike(camera: Camera): void {
    const r = this.rng;
    const az = r.range(0, Math.PI * 2);
    const dist = r.range(900, 4200);
    const cx = camera.position.x + Math.cos(az) * dist;
    const cz = camera.position.z + Math.sin(az) * dist;
    let n = 0;
    const seg = (ax: number, ay: number, az2: number, bx: number, by: number, bz: number) => {
      if (n >= this.maxSeg) return;
      const o = n * 6;
      this.pos[o] = ax;
      this.pos[o + 1] = ay;
      this.pos[o + 2] = az2;
      this.pos[o + 3] = bx;
      this.pos[o + 4] = by;
      this.pos[o + 5] = bz;
      n++;
    };
    const bolt = (x: number, y: number, z: number, endY: number, depth: number) => {
      let px = x;
      let py = y;
      let pz = z;
      const steps = depth === 0 ? 34 : 12;
      const dy = (endY - y) / steps;
      for (let i = 0; i < steps; i++) {
        const j = (depth === 0 ? 40 : 30) * (1 - (i / steps) * 0.4) * (0.4 + dist / 4200);
        const nx = px + r.range(-j, j);
        const nz = pz + r.range(-j, j);
        const ny = py + dy;
        seg(px, py, pz, nx, ny, nz);
        if (depth < 2 && r.next() < 0.14) bolt(nx, ny, nz, ny - r.range(80, 260), depth + 1);
        px = nx;
        py = ny;
        pz = nz;
      }
    };
    bolt(cx, 900, cz, 0, 0);
    this.geo.setDrawRange(0, n * 2);
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    this.t = 0;
    this.mesh.visible = true;
    this.visible = 0.55;
    this.onThunder?.(dist / 340, 1 - dist / 5200);
  }

  /** `chance` is the weather's lightning level (0 = never). */
  update(dt: number, chance: number, camera: Camera): number {
    this.t += dt;
    if (chance > 0.02) {
      this.next -= dt * chance;
      if (this.next <= 0) {
        this.strike(camera);
        this.next = this.rng.range(3, 11);
      }
    }
    // double pulse envelope
    const t = this.t;
    let f = 0;
    if (t < 0.06) f = 1;
    else if (t < 0.11) f = 0.15;
    else if (t < 0.2) f = 0.85;
    else if (t < 1.2) f = Math.exp(-(t - 0.2) * 5.5) * 0.55;
    this.flash = f;
    if (this.visible > 0) {
      this.visible -= dt;
      this.mesh.visible = this.visible > 0 && t < 0.3 && ((t * 60) | 0) % 3 !== 2;
    }
    return this.flash;
  }
}
