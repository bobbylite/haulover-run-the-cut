// Game cameras: smoothed chase, helm (first person), orbit (menus / results).

import { type PerspectiveCamera, Vector3 } from 'three/webgpu';
import { clamp, damp, smoothstep, wrapAngle } from '../core/math';
import type { Boat } from '../sim/boat';
import type { Environment } from '../sim/environment';
import type { Input } from './input';

export type CamMode = 'chase' | 'helm' | 'orbit';

export class GameCamera {
  mode: CamMode = 'chase';
  private yaw = 0;
  private readonly sm = new Vector3();
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private inited = false;
  private shake = 0;
  private fov = 58;
  private orbitAngle = 0.8;
  /** Horizontal frame offset (fraction of width) used so the menu panel doesn't cover the boat. */
  private viewShift = 0;
  private readonly tmp = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly env: Environment,
  ) {}

  addShake(a: number): void {
    this.shake = Math.min(1.2, Math.max(this.shake, a));
  }

  snap(boat: Boat): void {
    this.sm.copy(boat.pos);
    this.yaw = boat.heading;
    this.inited = false;
  }

  cycle(): void {
    this.mode = this.mode === 'chase' ? 'helm' : this.mode === 'helm' ? 'orbit' : 'chase';
  }

  /** Shift the rendered frustum sideways (menu layouts). */
  setViewShift(frac: number, dt: number): void {
    this.viewShift += (frac - this.viewShift) * damp(4, dt);
    const c = this.camera;
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    if (Math.abs(this.viewShift) < 0.001) {
      if (c.view?.enabled) c.clearViewOffset();
    } else {
      c.setViewOffset(w, h, -this.viewShift * w, 0, w, h);
    }
  }

  update(dt: number, boat: Boat, input: Input, time: number, forceMode?: CamMode): void {
    const cam = this.camera;
    const mode = forceMode ?? this.mode;
    const spec = boat.spec;
    const sp = boat.sog;
    if (!this.inited) {
      this.sm.copy(boat.pos);
      this.yaw = boat.heading;
      this.inited = true;
    }
    // smoothed target point (horizontal fast, vertical slow so the camera doesn't bob with waves)
    this.sm.x += (boat.pos.x - this.sm.x) * damp(9, dt);
    this.sm.z += (boat.pos.z - this.sm.z) * damp(9, dt);
    this.sm.y += (boat.pos.y - this.sm.y) * damp(3.2, dt);

    if (mode === 'helm') {
      const h = spec.camera.helm;
      this.tmp
        .set(h[0] - spec.cg[0], h[1] - spec.cg[1], h[2] - spec.cg[2])
        .applyQuaternion(boat.quat)
        .add(boat.pos);
      this.pos.lerp(this.tmp, 1 - Math.exp(-30 * dt));
      cam.position.copy(this.pos);
      const fwd = boat.fwd;
      this.look.set(this.pos.x + fwd.x * 40, this.pos.y + fwd.y * 40 - 0.5, this.pos.z + fwd.z * 40);
      cam.up.set(0, 1, 0).lerp(boat.up, 0.18).normalize();
      cam.lookAt(this.look);
      this.fov += (66 + 10 * smoothstep(0, spec.topSpeed, sp) - this.fov) * damp(3, dt);
      this.applyFov();
      return;
    }
    cam.up.set(0, 1, 0);

    if (mode === 'orbit') {
      this.orbitAngle += dt * 0.12 + input.orbitYaw * 0;
      const a = this.orbitAngle + input.orbitYaw;
      const d = spec.length * 1.9 * input.zoom;
      const hh = spec.length * 0.55 + input.orbitPitch * spec.length;
      this.tmp.set(this.sm.x + Math.cos(a) * d, this.sm.y + hh, this.sm.z + Math.sin(a) * d);
      this.pos.lerp(this.tmp, 1 - Math.exp(-3 * dt));
      cam.position.copy(this.pos);
      this.look.set(this.sm.x, this.sm.y + spec.length * 0.12, this.sm.z);
      cam.lookAt(this.look);
      this.fov += (48 - this.fov) * damp(3, dt);
      this.applyFov();
      this.clampToWater(time);
      return;
    }

    // ---- chase ------------------------------------------------------------------------------
    const vYaw = Math.atan2(boat.vel.z, boat.vel.x);
    const blend = smoothstep(2.5, 9, sp) * 0.5;
    const target = boat.heading + wrapAngle(vYaw - boat.heading) * blend;
    this.yaw += wrapAngle(target - this.yaw) * damp(2.6, dt);
    const a = this.yaw + input.orbitYaw;
    const speedK = smoothstep(0, spec.topSpeed, sp);
    const dist = spec.camera.distance * input.zoom * (1 + 0.1 * speedK);
    const pitch = input.orbitPitch;
    const height = spec.camera.height * (0.9 + input.zoom * 0.1) + dist * Math.sin(pitch) * 0.9;
    const horiz = dist * Math.cos(pitch * 0.6);
    this.tmp.set(this.sm.x - Math.cos(a) * horiz, this.sm.y + height, this.sm.z - Math.sin(a) * horiz);
    this.pos.lerp(this.tmp, this.inited ? 1 - Math.exp(-7 * dt) : 1);
    cam.position.copy(this.pos);
    const ahead = spec.camera.look * (1 + 0.4 * speedK);
    this.look.set(
      this.sm.x + Math.cos(this.yaw) * ahead,
      this.sm.y + 1.6,
      this.sm.z + Math.sin(this.yaw) * ahead,
    );
    cam.lookAt(this.look);
    // lean slightly into the boat's roll
    cam.rotateZ(clamp(-boat.roll * 0.2, -0.12, 0.12));
    this.fov += (56 + 16 * speedK - this.fov) * damp(2.5, dt);
    this.applyFov();
    this.applyShake(dt, time);
    this.clampToWater(time);
  }

  private applyShake(dt: number, time: number): void {
    if (this.shake < 0.01) return;
    const a = this.shake * 0.35;
    this.camera.position.x += Math.sin(time * 61) * a * 0.5;
    this.camera.position.y += Math.sin(time * 73 + 1) * a;
    this.camera.position.z += Math.cos(time * 53) * a * 0.5;
    this.shake *= Math.exp(-5 * dt);
  }

  private clampToWater(time: number): void {
    const c = this.camera.position;
    const w = this.env.waves.height(c.x, c.z, this.env.time);
    void time;
    if (c.y < w + 0.9) c.y = w + 0.9;
  }

  private applyFov(): void {
    const c = this.camera;
    if (Math.abs(c.fov - this.fov) > 0.03) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
  }
}
