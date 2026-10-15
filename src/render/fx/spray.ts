// Spray: a CPU-simulated pool of soft white sprites (instanced billboards) driven by the boat's
// physics events: bow spray when ploughing through chop, big bursts on slams / green water, and a
// rooster tail behind a planing hull.

import { float, instancedDynamicBufferAttribute, mix, smoothstep, uv, vec2, vec3, vec4 } from 'three/tsl';
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  SpriteNodeMaterial,
} from 'three/webgpu';
import { Rng } from '../../core/math';
import type { Boat } from '../../sim/boat';
import type { Environment } from '../../sim/environment';
import { makeWaveSample } from '../../sim/waves';

type N = any;

const MAX = 1600;

export class SprayFX {
  readonly mesh: InstancedMesh;
  private readonly pos = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  private readonly size = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  private readonly alpha = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly s0 = new Float32Array(MAX);
  private count = 0;
  private readonly rng = new Rng(99);
  private readonly ws = makeWaveSample();
  private acc = 0;
  private accTail = 0;

  constructor() {
    this.pos.setUsage(DynamicDrawUsage);
    this.size.setUsage(DynamicDrawUsage);
    this.alpha.setUsage(DynamicDrawUsage);
    const m = new SpriteNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.positionNode = instancedDynamicBufferAttribute(this.pos) as N;
    m.scaleNode = vec2(
      instancedDynamicBufferAttribute(this.size) as N,
      instancedDynamicBufferAttribute(this.size) as N,
    );
    const a: N = instancedDynamicBufferAttribute(this.alpha);
    const r = (uv() as N).sub(0.5).length().mul(2.0);
    // crisp cartoon puffs with a pale-aqua rim
    const soft = float(1).sub(smoothstep(0.8, 0.88, r));
    const rim = smoothstep(0.7, 0.86, r).mul(0.5);
    m.colorNode = vec4(mix(vec3(1.0, 1.0, 1.0), vec3(0.82, 0.95, 1.0), rim) as N, soft.mul(a)) as N;
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), m, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'spray';
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
  ): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.pos.setXYZ(i, x, y, z);
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
  }

  /** Big burst (slam / green water). */
  burst(boat: Boat, strength: number): void {
    const r = this.rng;
    const b = boat.bowWorld;
    const n = Math.round(30 + strength * 90);
    const fx = boat.fwd.x;
    const fz = boat.fwd.z;
    const rx = boat.right.x;
    const rz = boat.right.z;
    for (let k = 0; k < n; k++) {
      const side = r.next() < 0.5 ? -1 : 1;
      const out = (1.5 + r.next() * 4.5) * side;
      const up = 2.5 + r.next() * (3 + strength * 5);
      const fwd = (r.next() - 0.35) * 4 + boat.speed * 0.45;
      this.spawn(
        b.x + rx * 0.3 * side,
        boat.seaLevel + 0.1,
        b.z + rz * 0.3 * side,
        rx * out + fx * fwd,
        up,
        rz * out + fz * fwd,
        0.5 + r.next() * 0.9 + strength * 0.5,
        0.7 + r.next() * 0.7,
      );
    }
  }

  /** Continuous emission from a moving boat. */
  emit(dt: number, boat: Boat, env: Environment): void {
    const sp = Math.max(0, boat.speed);
    const r = this.rng;
    const spec = boat.spec;
    // bow sheets: rate grows with speed and the local chop
    const chop = 0.35 + env.sea.chopHeight * 0.6;
    this.acc += Math.max(0, sp - 3.5) ** 1.35 * chop * 7 * dt;
    const halfB = spec.beam * 0.42;
    while (this.acc >= 1) {
      this.acc -= 1;
      const side = r.next() < 0.5 ? -1 : 1;
      const along = spec.length * (0.28 + r.next() * 0.16);
      const px = boat.pos.x + boat.fwd.x * along + boat.right.x * halfB * side;
      const pz = boat.pos.z + boat.fwd.z * along + boat.right.z * halfB * side;
      env.waves.sample(px, pz, env.time, this.ws);
      const out = (1.2 + r.next() * 2.2 + sp * 0.12) * side;
      const up = 1.6 + r.next() * 2.0 + sp * 0.12;
      this.spawn(
        px,
        this.ws.h + 0.1,
        pz,
        boat.right.x * out + boat.fwd.x * (sp * 0.3) + boat.vel.x * 0.25,
        up,
        boat.right.z * out + boat.fwd.z * (sp * 0.3) + boat.vel.z * 0.25,
        0.35 + r.next() * 0.5,
        0.45 + r.next() * 0.5,
      );
    }
    // rooster tail: planing hull with the engine pushing
    const t = Math.abs(boat.thrustN) / spec.engine.thrust;
    this.accTail += (sp > 6 ? t * (sp - 5) * 5 : 0) * dt * boat.propSubmerge;
    while (this.accTail >= 1) {
      this.accTail -= 1;
      const back = spec.length * 0.5 + 0.4;
      const px = boat.pos.x - boat.fwd.x * back + boat.right.x * (r.next() - 0.5) * 0.8;
      const pz = boat.pos.z - boat.fwd.z * back + boat.right.z * (r.next() - 0.5) * 0.8;
      env.waves.sample(px, pz, env.time, this.ws);
      this.spawn(
        px,
        this.ws.h + 0.15,
        pz,
        -boat.fwd.x * (2 + r.next() * 3) + boat.vel.x * 0.55 + (r.next() - 0.5) * 1.4,
        2.8 + r.next() * 3.4,
        -boat.fwd.z * (2 + r.next() * 3) + boat.vel.z * 0.55 + (r.next() - 0.5) * 1.4,
        0.3 + r.next() * 0.45,
        0.5 + r.next() * 0.55,
      );
    }
  }

  update(dt: number, env: Environment): void {
    const wx = env.wind.dirX * env.wind.speed * 0.35;
    const wz = env.wind.dirZ * env.wind.speed * 0.35;
    let i = 0;
    while (i < this.count) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        // swap-remove
        const last = this.count - 1;
        if (i !== last) {
          this.pos.setXYZ(i, this.pos.getX(last), this.pos.getY(last), this.pos.getZ(last));
          this.vel[i * 3] = this.vel[last * 3] as number;
          this.vel[i * 3 + 1] = this.vel[last * 3 + 1] as number;
          this.vel[i * 3 + 2] = this.vel[last * 3 + 2] as number;
          this.life[i] = this.life[last] as number;
          this.maxLife[i] = this.maxLife[last] as number;
          this.s0[i] = this.s0[last] as number;
        }
        this.count--;
        continue;
      }
      let vx = this.vel[i * 3] as number;
      let vy = this.vel[i * 3 + 1] as number;
      let vz = this.vel[i * 3 + 2] as number;
      vy -= 9.0 * dt;
      const drag = Math.exp(-0.9 * dt);
      vx = vx * drag + wx * dt;
      vz = vz * drag + wz * dt;
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = vy;
      this.vel[i * 3 + 2] = vz;
      this.pos.setXYZ(i, this.pos.getX(i) + vx * dt, this.pos.getY(i) + vy * dt, this.pos.getZ(i) + vz * dt);
      const t = 1 - (this.life[i] as number) / (this.maxLife[i] as number);
      this.size.setX(i, (this.s0[i] as number) * (0.75 + t * 0.9));
      this.alpha.setX(i, (1 - t) ** 0.55 * 0.95);
      i++;
    }
    this.mesh.count = this.count;
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
