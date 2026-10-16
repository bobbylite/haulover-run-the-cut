// The glowing target berth: the footprint of your vessel painted on the water at the pose it has to finish in
// (a rounded box for a slip or a wharf, a ring for a mooring), with a pale column above it so it still reads from
// a low camera. Warm orange until speed, angle and position are all right, then green.

import { abs, float, max, min, mix, smoothstep, sqrt, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { CylinderGeometry, DoubleSide, Group, Mesh, NodeMaterial, PlaneGeometry } from 'three/webgpu';
import { shared } from '../shared';

type N = any;

export interface MarkerPose {
  x: number;
  z: number;
  /** atan2(z, x) of the vessel's bow when it is parked. */
  heading: number;
  /** Footprint of the vessel (m). */
  length: number;
  beam: number;
  /** A mooring is a ring at the ball; everything else a hull outline. */
  ring: boolean;
}

export class BerthMarker {
  readonly group = new Group();
  private readonly plane: Mesh;
  private readonly column: Mesh;
  private readonly uOk = uniform(0);
  private readonly uHx = uniform(5);
  private readonly uHy = uniform(2);
  private readonly uSx = uniform(8);
  private readonly uSy = uniform(5);
  private readonly uRing = uniform(0);
  private readonly ok = { v: 0 };

  constructor() {
    this.group.name = 'berthMarker';
    const t = shared.time as N;
    const warm: N = vec3(1.0, 0.42, 0.12);
    const good: N = vec3(0.1, 0.92, 0.5);
    const colr: N = mix(warm, good, this.uOk);

    const mat = new NodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.fragmentNode = (() => {
      const c: N = uv();
      const p: N = vec2((c.x as N).sub(0.5).mul(this.uSx), (c.y as N).sub(0.5).mul(this.uSy));
      // a rounded box and a ring, picked by uRing
      const r: N = min(this.uHx, this.uHy).mul(0.35).min(1.4);
      const q: N = vec2(abs(p.x).sub(this.uHx.sub(r)), abs(p.y).sub(this.uHy.sub(r)));
      const box: N = sqrt(
        max(q.x, 0.0)
          .mul(max(q.x, 0.0))
          .add(max(q.y, 0.0).mul(max(q.y, 0.0))),
      )
        .add(min(max(q.x, q.y), 0.0))
        .sub(r);
      const ring: N = p.length().sub(this.uHx);
      const d: N = mix(box, ring, this.uRing);
      const pulse: N = (t as N).mul(4.0).sin().mul(0.5).add(0.5);
      const edge: N = float(1).sub(smoothstep(0.05, 0.34, abs(d)));
      const fill: N = float(1)
        .sub(smoothstep(-0.3, 0.1, d))
        .mul(float(0.1).add(pulse.mul(0.07)));
      // a dashed centreline along the vessel's length, to line the keel up on
      const dash: N = float(1)
        .sub(smoothstep(0.1, 0.2, abs(p.y)))
        .mul(float(1).sub(this.uRing))
        .mul(float(1).sub(smoothstep(-0.2, 0.0, d.add(0.5))))
        .mul(p.x.mul(0.45).add(t.mul(0.8)).fract().step(0.5));
      const a: N = max(edge.mul(0.95), max(fill, dash.mul(0.55)));
      return vec4(colr, a.clamp(0.0, 0.95));
    })() as N;
    this.plane = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.plane.position.y = 0.17;
    this.plane.renderOrder = 3;
    this.plane.frustumCulled = false;

    const cmat = new NodeMaterial();
    cmat.transparent = true;
    cmat.depthWrite = false;
    cmat.side = DoubleSide;
    cmat.fragmentNode = (() => {
      const v: N = uv().y as N;
      const fade: N = float(1).sub(v).pow(1.6);
      return vec4(colr, fade.mul(0.34));
    })() as N;
    this.column = new Mesh(new CylinderGeometry(1, 1, 1, 18, 1, true), cmat);
    this.column.renderOrder = 4;
    this.column.frustumCulled = false;
    this.group.add(this.plane, this.column);
    this.group.visible = false;
  }

  /** Place the marker, show or hide it, and colour it (ok = the vessel is parked right now). */
  update(dt: number, pose: MarkerPose | null, ok: boolean): void {
    this.group.visible = !!pose;
    if (!pose) return;
    this.ok.v += ((ok ? 1 : 0) - this.ok.v) * Math.min(1, dt * 8);
    this.uOk.value = this.ok.v;
    const hx = pose.ring ? pose.length : pose.length / 2;
    const hy = pose.ring ? pose.length : pose.beam / 2 + 0.4;
    this.uHx.value = hx;
    this.uHy.value = hy;
    this.uRing.value = pose.ring ? 1 : 0;
    const sx = hx * 2 + 2;
    const sy = hy * 2 + 2;
    this.uSx.value = sx;
    this.uSy.value = sy;
    this.plane.scale.set(sx, 1, sy);
    this.plane.position.set(pose.x, 0.17, pose.z);
    this.plane.rotation.y = -pose.heading;
    const h = Math.min(46, Math.max(12, pose.length * 0.55));
    const rad = pose.ring ? 1.1 : Math.max(0.8, Math.min(2.6, pose.beam * 0.22));
    this.column.scale.set(rad, h, rad);
    this.column.position.set(pose.x, h / 2, pose.z);
  }
}
