// Wake simulation. A camera-following render target (ping-pong) stores
//   R = foam density, G = (reserved ripples), B = boat shadow.
// Each frame the old map is advected by the tidal flow field, decayed and blurred (so trails widen
// into a V-shaped wake and drift with the current), then every boat stamps hull-side foam, bow wave,
// prop wash and a soft shadow. The water shader samples the result.

import {
  abs,
  clamp,
  Fn,
  float,
  length,
  max,
  smoothstep,
  texture,
  uniform,
  uv,
  varyingProperty,
  vec2,
  vec4,
} from 'three/tsl';
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DoubleSide,
  type Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  QuadMesh,
  RenderTarget,
  RGBAFormat,
  Scene,
  type Texture,
  Vector2,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import type { WorldExtents } from '../locations/types';

type N = any;

export interface WakeBoat {
  x: number;
  z: number;
  heading: number;
  length: number;
  beam: number;
  speed: number;
  thrust01: number;
  planing01: number;
  /** Local-frame offset of the shadow (m). */
  shadowU: number;
  shadowV: number;
  /** 0..1 how strongly the sun casts a shadow. */
  sun: number;
  /** The hull's planform, so the sea can be cut out of it (absent for hulls that are open to the water). */
  hull?: { halfLen: number; halfBeam: number; shift: number };
}

const MAX_STAMPS = 10;

export class WakeMap {
  readonly size = 240;
  readonly res: number;
  readonly center = new Vector2();
  private readonly rt: RenderTarget[];
  private readonly stampRT: RenderTarget;
  private cur = 0;
  private readonly quad: QuadMesh;
  private readonly prevNode: ReturnType<typeof texture>;
  private readonly uShift = uniform(new Vector2());
  private readonly uDecay = uniform(0.98);
  private readonly uDt = uniform(0.016);
  private readonly uTide = uniform(0);
  private readonly uCenter = uniform(new Vector2());
  private readonly stampScene = new Scene();
  private readonly stampCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly stamps: {
    mesh: Mesh;
    pos: ReturnType<typeof uniform>;
    dir: ReturnType<typeof uniform>;
    dims: ReturnType<typeof uniform>;
    dyn: ReturnType<typeof uniform>;
    shade: ReturnType<typeof uniform>;
  }[] = [];
  private initialised = false;
  private readonly snapped = new Vector2();

  constructor(
    private readonly renderer: WebGPURenderer,
    flowTex: Texture,
    WORLD: WorldExtents,
    res = 1024,
  ) {
    this.res = res;
    const make = () => {
      const t = new RenderTarget(res, res, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false });
      t.texture.minFilter = LinearFilter;
      t.texture.magFilter = LinearFilter;
      t.texture.wrapS = t.texture.wrapT = ClampToEdgeWrapping;
      return t;
    };
    this.rt = [make(), make()];
    this.stampRT = make();

    // ---- advect / decay / diffuse pass ------------------------------------------------------------------
    this.prevNode = texture(this.rt[0]!.texture);
    const stampNode = texture(this.stampRT.texture);
    const flowNode = texture(flowTex);
    const prev = this.prevNode;
    const gW = WORLD.x1 - WORLD.x0;
    const gH = WORLD.z1 - WORLD.z0;
    const mat = new NodeMaterial();
    mat.fragmentNode = Fn(() => {
      const t = uv() as N;
      const world = this.uCenter.add(t.sub(0.5).mul(this.size)) as N;
      const gUV = vec2(world.x.sub(WORLD.x0).div(gW), world.y.sub(WORLD.z0).div(gH));
      const flow = flowNode.sample(gUV).rg.mul(this.uTide);
      const disp = flow.mul(this.uDt).div(this.size);
      const base = t.add(this.uShift).sub(disp) as N;
      const px = float(1.3 / this.res);
      const smp = (c: N): N => (prev as N).sample(c);
      const c: N = smp(base).mul(0.52);
      const s: N = smp(base.add(vec2(px, 0)))
        .add(smp(base.sub(vec2(px, 0))))
        .add(smp(base.add(vec2(0, px))))
        .add(smp(base.sub(vec2(0, px))))
        .mul(0.12);
      const sum: N = c.add(s);
      // out of the window => nothing
      const inside = smoothstep(0.0, 0.02, base.x)
        .mul(smoothstep(1.0, 0.98, base.x))
        .mul(smoothstep(0.0, 0.02, base.y))
        .mul(smoothstep(1.0, 0.98, base.y));
      const st: N = (stampNode as N).sample(t);
      // max-composite: old foam fades, fresh stamps set the floor
      return vec4(max(sum.r.mul(this.uDecay).mul(inside), st.r), 0.0, st.b, 1.0);
    })();
    this.quad = new QuadMesh(mat);

    // ---- stamps ------------------------------------------------------------------------------------------------
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_STAMPS; i++) {
      const pos = uniform(new Vector2());
      const dir = uniform(new Vector2(1, 0));
      const dims = uniform(new Vector4(7, 2.5, 0, 0)); // L, B, speed, thrust
      const dyn = uniform(new Vector4(0, 0, 0, 0)); // planing, sun, shadowU, shadowV
      const shade = uniform(new Vector2());
      const m = new NodeMaterial();
      m.transparent = true;
      m.depthTest = false;
      m.depthWrite = false;
      m.blending = AdditiveBlending;
      // the y flip into NDC reverses the winding, so don't cull
      m.side = DoubleSide;
      const vLocal = varyingProperty('vec2');
      m.vertexNode = Fn(() => {
        const L = dims.x as N;
        const B = dims.y as N;
        const fwdExt = L.mul(0.5).add(5.5);
        const backExt = L.mul(0.5).add(22.0);
        const latExt = B.mul(0.5).add(9.0);
        const t = uv() as N;
        const lu = backExt.negate().add(t.x.mul(fwdExt.add(backExt)));
        const lv = t.y.sub(0.5).mul(latExt.mul(2.0));
        vLocal.assign(vec2(lu, lv));
        const d = dir as N;
        const wx = (pos as N).x.add(d.x.mul(lu)).sub(d.y.mul(lv));
        const wz = (pos as N).y.add(d.y.mul(lu)).add(d.x.mul(lv));
        const nx = wx.sub(this.uCenter.x).div(this.size).mul(2.0);
        const nz = wz.sub(this.uCenter.y).div(this.size).mul(2.0);
        return vec4(nx, nz.negate(), 0.0, 1.0);
      })();
      m.fragmentNode = Fn(() => {
        const L = dims.x as N;
        const B = dims.y as N;
        const speed = dims.z as N;
        const thrust = dims.w as N;
        const planing = (dyn as N).x;
        const sun = (dyn as N).y;
        const lu = (vLocal as N).x;
        const lv = (vLocal as N).y;
        const half = B.mul(0.5);
        const sp = smoothstep(0.3, 6.0, speed);
        const sp2 = smoothstep(1.5, 14.0, speed);
        // hull-side foam band
        const frontT = clamp(lu.div(L.mul(0.5)), -1.0, 1.0);
        const hb = half.mul(float(1).sub(smoothstep(0.25, 1.0, frontT).pow(1.3)));
        const dHull = abs(lv).sub(hb);
        const band = smoothstep(-0.4, 0.05, dHull).mul(float(1).sub(smoothstep(0.2, 1.7, dHull)));
        const along = smoothstep(L.mul(-0.5), L.mul(0.15), lu).mul(
          float(1).sub(smoothstep(L.mul(0.48), L.mul(0.62), lu)),
        );
        const hull = band.mul(along).mul(sp.mul(0.85).add(0.12));
        // bow wave
        const bowU = lu.sub(L.mul(0.5));
        const bowR = length(vec2(bowU.mul(0.8), lv.mul(0.95)));
        const bow = float(1)
          .sub(smoothstep(0.0, 4.6, bowR))
          .mul(sp2.mul(0.9));
        // prop wash behind the transom
        const behind = lu.add(L.mul(0.5)).negate();
        const spread = half.mul(0.7).add(behind.max(0.0).mul(0.2)).add(0.3);
        const wash = float(1)
          .sub(abs(lv).div(spread))
          .max(0.0)
          .pow(0.8)
          .mul(smoothstep(-0.6, 0.8, behind))
          .mul(float(1).sub(smoothstep(2.0, 20.0, behind)));
        const washAmt = wash.mul(thrust.mul(0.7).add(planing.mul(0.35)).add(0.08));
        // turbulence under a planing hull
        const under = smoothstep(L.mul(-0.55), L.mul(-0.2), lu)
          .mul(float(1).sub(smoothstep(L.mul(-0.1), L.mul(0.25), lu)))
          .mul(float(1).sub(smoothstep(half.mul(0.9), half.mul(1.3), abs(lv))))
          .mul(planing)
          .mul(0.5);
        const foam = max(max(hull, bow), max(washAmt, under)).mul(0.9);
        // soft contact shadow (offset away from the sun)
        const su = (dyn as N).z;
        const sv = (dyn as N).w;
        const e = length(vec2(lu.sub(su).div(L.mul(0.55)), lv.sub(sv).div(B.mul(0.85).add(0.4))));
        const shadow = float(1)
          .sub(smoothstep(0.5, 1.15, e))
          .mul(sun)
          .mul(0.85);
        return vec4(foam as N, 0.0, shadow as N, 1.0);
      })();
      const mesh = new Mesh(geo, m);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.stampScene.add(mesh);
      this.stamps.push({ mesh, pos, dir, dims, dyn, shade });
    }
  }

  get texture(): Texture {
    return this.rt[this.cur]!.texture;
  }

  /** Advance one frame. `focus` is the point the window follows (the player). */
  update(dt: number, focusX: number, focusZ: number, tide: number, boats: WakeBoat[]): void {
    const texel = this.size / this.res;
    const nx = Math.round(focusX / texel) * texel;
    const nz = Math.round(focusZ / texel) * texel;
    if (!this.initialised) {
      this.snapped.set(nx, nz);
      for (const r of this.rt) {
        this.renderer.setRenderTarget(r);
        this.renderer.clear();
      }
      this.renderer.setRenderTarget(null);
      this.initialised = true;
    }
    const dx = nx - this.snapped.x;
    const dz = nz - this.snapped.y;
    this.snapped.set(nx, nz);
    this.center.set(nx, nz);
    this.uCenter.value.set(nx, nz);
    this.uShift.value.set(dx / this.size, dz / this.size);
    this.uDt.value = dt;
    this.uTide.value = tide;
    // foam lingers ~7 s; lighter in strong current (it's carried away)
    this.uDecay.value = Math.exp(-dt / 6.5);

    const src = this.rt[this.cur]!;
    const dst = this.rt[1 - this.cur]!;
    this.prevNode.value = src.texture;

    const r = this.renderer;
    const prevAuto = r.autoClear;
    // 1) this frame's stamps -> their own cleared target
    let n = 0;
    for (const b of boats) {
      if (n >= MAX_STAMPS) break;
      const st = this.stamps[n++]!;
      (st.pos.value as Vector2).set(b.x, b.z);
      (st.dir.value as Vector2).set(Math.cos(b.heading), Math.sin(b.heading));
      (st.dims.value as Vector4).set(b.length, b.beam, b.speed, b.thrust01);
      (st.dyn.value as Vector4).set(b.planing01, b.sun, b.shadowU, b.shadowV);
      st.mesh.visible = true;
    }
    for (let i = n; i < MAX_STAMPS; i++) this.stamps[i]!.mesh.visible = false;
    r.setRenderTarget(this.stampRT);
    r.autoClear = true;
    r.render(this.stampScene, this.stampCam);
    // 2) advect + decay + composite into the destination
    r.setRenderTarget(dst);
    r.autoClear = true;
    this.quad.render(r);
    r.autoClear = prevAuto;
    r.setRenderTarget(null);
    this.cur = 1 - this.cur;
  }
}

export type { Group };
