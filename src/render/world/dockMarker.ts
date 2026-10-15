// The glowing target slip: a painted-on-the-water outline with chevrons marching toward the berth.
// It turns green when speed, angle and position are all right.

import {
  abs,
  float,
  fract,
  max,
  mix,
  positionLocal,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { DoubleSide, Mesh, NodeMaterial, PlaneGeometry } from 'three/webgpu';
import { SLIP } from '../../sim/geography';
import { shared } from '../shared';

type N = any;

export class DockMarker {
  readonly mesh: Mesh;
  private readonly uOk = uniform(0);
  private readonly uBerth = uniform(0.9);
  private readonly uBerthLen = uniform(0.2);
  private readonly ok = { v: 0 };

  constructor() {
    const L = SLIP.x1 - SLIP.x0 + 14;
    const Wd = SLIP.half * 2;
    const mat = new NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    const t = shared.time as N;
    mat.fragmentNode = (() => {
      const c: N = uv();
      const u: N = c.x; // west -> east along the slip
      const v: N = abs(c.y.sub(0.5)).mul(2.0); // 0 centre .. 1 edge
      const edgeV: N = smoothstep(0.93, 0.96, v).mul(float(1).sub(smoothstep(0.99, 1.0, v)));
      const edgeU: N = smoothstep(0.985, 0.99, u).mul(step(v, 0.99));
      const border: N = max(edgeV, edgeU);
      // chevrons pointing east, travelling toward the berth
      const chev: N = fract(
        u
          .mul(L / 9.0)
          .sub(v.mul(0.55))
          .sub(t.mul(0.9)),
      );
      const arrows: N = step(chev, 0.28)
        .mul(float(1).sub(smoothstep(0.55, 0.85, v)))
        .mul(smoothstep(0.02, 0.2, u));
      // the berth outline: a pulsing box at the head of the slip
      const bu: N = abs(u.sub(this.uBerth)).div(this.uBerthLen);
      const box: N = float(1)
        .sub(smoothstep(0.92, 1.0, max(bu, v.mul(0.5).div(0.18))))
        .mul(smoothstep(0.78, 0.86, max(bu, v.mul(0.5).div(0.18))));
      const pulse: N = (t as N).mul(4.0).sin().mul(0.5).add(0.5);
      const warm: N = vec3(1.0, 0.42, 0.12);
      const good: N = vec3(0.1, 0.92, 0.5);
      const colr: N = mix(warm, good, this.uOk);
      const a: N = max(border.mul(0.95), arrows.mul(0.7)).add(box.mul(float(0.6).add(pulse.mul(0.3))));
      return vec4(colr, a.clamp(0.0, 0.95));
    })() as N;
    this.mesh = new Mesh(new PlaneGeometry(L, Wd).rotateX(-Math.PI / 2), mat);
    this.mesh.position.set(SLIP.x0 + L / 2 - 6, 0.16, SLIP.z);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'dockMarker';
    void positionLocal;
  }

  /** Show / hide and colour (ok = 0..1 how "parked" the boat is), for a boat of the given length. */
  update(dt: number, visible: boolean, ok: boolean, berthX: number, boatLength: number): void {
    this.mesh.visible = visible;
    this.ok.v += ((ok ? 1 : 0) - this.ok.v) * Math.min(1, dt * 8);
    this.uOk.value = this.ok.v;
    const L = SLIP.x1 - SLIP.x0 + 14;
    const x0 = this.mesh.position.x - L / 2;
    this.uBerth.value = (berthX - x0) / L;
    this.uBerthLen.value = (boatLength * 0.5 + 0.6) / L;
  }
}
