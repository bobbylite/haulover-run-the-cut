// The sea. A camera-centred polar mesh whose vertex shader evaluates the same Gerstner wave sum as
// sim/waves.ts, and whose fragment shader paints a stylised, depth-aware, pastel ocean:
//   turquoise shallows over visible sand/seagrass/rock, deep-blue channel, sun glitter, crest glow,
//   foam (crest, surf, shoreline, wake) and tidal-flow-advected ripples.

import {
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  Fn,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  texture,
  textureLevel,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Mesh,
  NodeMaterial,
  type PerspectiveCamera,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu';
import type { Environment } from '../sim/environment';
import { WORLD } from '../sim/geography';
import { CHOP_COUNT, NUM_WAVES, SWELL_COUNT } from '../sim/waves';
import type { Atmosphere } from './atmosphere';
import { toonQ } from './toon';
import type { WeatherState } from './weatherState';

type N = any;

const GX0 = WORLD.x0;
const GZ0 = WORLD.z0;
const GW = WORLD.x1 - WORLD.x0;
const GH = WORLD.z1 - WORLD.z0;

// Nominal wavelengths of the short components (for distance fading), matched to sim/waves.ts
const FADE_LEN: number[] = [0, 0, 0, 24, 16, 10.5, 7, 4.6, 16, 12, 9.2, 7];

export interface WaterTextures {
  geo: Texture;
  flow: Texture;
  ripple: Texture;
  noise: Texture;
}

/** Camera-centred polar grid: dense near the camera, crack-free by construction. */
export function makePolarGeometry(rings = 330, segs = 256, r0 = 0.9, r1 = 9500): BufferGeometry {
  const verts = rings * segs + 1;
  const pos = new Float32Array(verts * 3);
  const ratio = (r1 / r0) ** (1 / (rings - 1));
  let p = 3;
  for (let j = 0; j < rings; j++) {
    const r = r0 * ratio ** j;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos[p++] = Math.cos(a) * r;
      pos[p++] = 0;
      pos[p++] = Math.sin(a) * r;
    }
  }
  const idx = new Uint32Array(segs * 3 + (rings - 1) * segs * 6);
  let q = 0;
  for (let i = 0; i < segs; i++) {
    idx[q++] = 0;
    idx[q++] = 1 + ((i + 1) % segs);
    idx[q++] = 1 + i;
  }
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = 1 + j * segs + i;
      const b = 1 + j * segs + ((i + 1) % segs);
      const c = a + segs;
      const d = b + segs;
      idx[q++] = a;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = d;
      idx[q++] = c;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

function blackTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

export class Water {
  readonly mesh: Mesh;
  readonly material: NodeMaterial;

  // uniforms
  readonly uTime = uniform(0);
  readonly uCenter = uniform(new Vector2());
  readonly uTide = uniform(0);
  readonly uHMax = uniform(new Vector3(1, 1, 0));
  readonly uWind = uniform(new Vector2());
  readonly uDeep = uniform(new Color());
  readonly uShallow = uniform(new Color());
  readonly uGlow = uniform(new Color());
  readonly uSand = uniform(new Color('#f3e1bb'));
  readonly uGrass = uniform(new Color('#3d8f78'));
  readonly uRock = uniform(new Color('#7e8fa3'));
  readonly uFoam = uniform(1);
  readonly uDetail = uniform(0.6);
  readonly uCrestScale = uniform(1);
  readonly uClarity = uniform(1);
  readonly uGustAmt = uniform(0.3);
  readonly uWindDirSpeed = uniform(new Vector3(-1, 0, 5)); // dirX, dirZ, speed
  readonly uRain = uniform(0);
  /** 0 = open sun .. 1 = heavy overcast: dims the self-lit body, glow, glitter and foam. */
  readonly uOvercast = uniform(0);
  readonly uWakeCenter = uniform(new Vector2());
  readonly uWakeSize = uniform(256);
  /** Dev: 1 paints the raw wake map (rgb) over the water. */
  readonly uDebug = uniform(0);
  /** Replaced by the wake simulation once it exists. */
  private wakeNode!: ReturnType<typeof texture>;
  private wakeTexture: Texture = blackTexture();

  private readonly waveA: ReturnType<typeof uniform>[] = [];
  private readonly waveB: ReturnType<typeof uniform>[] = [];

  constructor(
    private readonly tex: WaterTextures,
    private readonly atmos: Atmosphere,
    wakeTexture?: Texture,
  ) {
    if (wakeTexture) this.wakeTexture = wakeTexture;
    for (let i = 0; i < NUM_WAVES; i++) {
      this.waveA.push(uniform(new Vector4()));
      this.waveB.push(uniform(new Vector4()));
    }
    this.material = this.buildMaterial();
    this.mesh = new Mesh(makePolarGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5; // first of the transparents: before spray, rain and cockpit water
    this.mesh.name = 'water';
  }

  // ---------------------------------------------------------------------------------------------

  private buildMaterial(): NodeMaterial {
    const mat = new NodeMaterial();
    mat.side = DoubleSide;
    mat.lights = false;
    // The sea is drawn after the solids and never writes depth: boats and shores get ink outlines against
    // it, while wave crests (which would otherwise read as silhouettes) stay line-free.
    mat.transparent = true;
    mat.depthWrite = false;

    const geoVertex = (uv: N) => textureLevel(this.tex.geo, uv, float(0));
    const geoNode = texture(this.tex.geo);
    const flowNode = texture(this.tex.flow);
    const rippleNode = texture(this.tex.ripple);
    const noiseNode = texture(this.tex.noise);
    const wakeNode = texture(this.wakeTexture);
    this.wakeNode = wakeNode;
    const atmos = this.atmos;

    // varyings assigned in the vertex stage
    const vNormal = varyingProperty('vec3');
    const vInfo = varyingProperty('vec3'); // x = height, y = jacobian, z = (unused)

    mat.positionNode = Fn(() => {
      const base = vec2(positionGeometry.x, positionGeometry.z).add(this.uCenter).toVar();
      const gUV = vec2(base.x.sub(GX0).div(GW), base.y.sub(GZ0).div(GH));
      const geo = geoVertex(gUV);
      const depth = geo.r.negate().max(0.0);
      const swellExp = geo.g;
      const bfS = clamp(depth.add(0.15).div(this.uHMax.x.mul(0.9).add(0.2)), 0.0, 1.0);
      const bfC = clamp(depth.add(0.15).div(this.uHMax.y.mul(0.9).add(0.2)), 0.0, 1.0);
      const mS = swellExp.mul(bfS);
      const mC = swellExp.mul(0.55).add(0.45).mul(bfC);
      const mH = geo.b.mul(this.uHMax.z);
      const camD = length(base.sub(vec2(cameraPosition.x, cameraPosition.z)));

      const h = float(0).toVar();
      const dx = float(0).toVar();
      const dz = float(0).toVar();
      const gx = float(0).toVar();
      const gz = float(0).toVar();
      const mxx = float(0).toVar();
      const mzz = float(0).toVar();
      const mxz = float(0).toVar();

      for (let i = 0; i < NUM_WAVES; i++) {
        const a = this.waveA[i] as N;
        const b = this.waveB[i] as N;
        const ddx = a.x;
        const ddz = a.y;
        const k = a.z;
        const amp = a.w;
        let g: N = i < SWELL_COUNT ? mS : i < SWELL_COUNT + CHOP_COUNT ? mC : mH;
        const lam = FADE_LEN[i] as number;
        if (lam > 0) {
          // short waves fade out with distance so the mesh never aliases
          g = g.mul(smoothstep(lam * 4.5, lam * 11.0, camD).oneMinus());
        }
        const th = k
          .mul(ddx.mul(base.x).add(ddz.mul(base.y)))
          .sub(b.y.mul(this.uTime))
          .add(b.z);
        const s = sin(th);
        const c = cos(th);
        h.addAssign(amp.mul(g).mul(s));
        const st = b.x.mul(g);
        const f = st.div(k).mul(c);
        dx.addAssign(f.mul(ddx));
        dz.addAssign(f.mul(ddz));
        const gk = amp.mul(g).mul(k).mul(c);
        gx.addAssign(gk.mul(ddx));
        gz.addAssign(gk.mul(ddz));
        const ss = st.mul(s);
        mxx.addAssign(ss.mul(ddx).mul(ddx));
        mzz.addAssign(ss.mul(ddz).mul(ddz));
        mxz.addAssign(ss.mul(ddx).mul(ddz));
      }
      const jac = float(1).sub(mxx).mul(float(1).sub(mzz)).sub(mxz.mul(mxz));
      const det = max(0.12, jac);
      const ngx = float(1).sub(mzz).mul(gx).add(mxz.mul(gz)).div(det);
      const ngz = mxz.mul(gx).add(float(1).sub(mxx).mul(gz)).div(det);
      vNormal.assign(normalize(vec3(ngx.negate(), 1.0, ngz.negate())));
      vInfo.assign(vec3(h, jac, 0.0));
      return vec3(base.x.add(dx), h, base.y.add(dz));
    })();

    // -------------------------------------------------------------------------------------------
    // caustics: iso-lines of the difference of two drifting noise fields
    const caustics = Fn(([p]: N[]) => {
      const t = this.uTime;
      const a = noiseNode.sample(p.mul(0.16).add(vec2(t.mul(0.021), t.mul(0.013)))).r;
      const b = noiseNode.sample(
        p
          .mul(0.2)
          .add(vec2(t.mul(-0.017), t.mul(0.024)))
          .add(0.37),
      ).r;
      const c = abs(a.sub(b));
      const lines = float(1).sub(smoothstep(0.0, 0.085, c));
      const a2 = noiseNode.sample(
        p
          .mul(0.33)
          .add(vec2(t.mul(0.03), t.mul(-0.02)))
          .add(0.61),
      ).g;
      const b2 = noiseNode.sample(
        p
          .mul(0.37)
          .add(vec2(t.mul(-0.026), t.mul(-0.018)))
          .add(0.13),
      ).g;
      const lines2 = float(1).sub(smoothstep(0.0, 0.07, abs(a2.sub(b2))));
      return lines.mul(0.7).add(lines2.mul(0.5));
    });

    mat.colorNode = Fn(() => {
      const wp = positionWorld;
      const toCam = cameraPosition.sub(wp);
      const dist = length(toCam);
      const V = toCam.div(dist.max(0.0001));
      const L = atmos.sunDir;
      const xz = vec2(wp.x, wp.z);

      const gUV = vec2(wp.x.sub(GX0).div(GW), wp.z.sub(GZ0).div(GH));
      const geo = geoNode.sample(gUV);
      const depth = geo.r.negate().max(0.0);
      const kind = geo.a;
      const swellExp = geo.g;
      const flow = flowNode.sample(gUV).rg.mul(this.uTide);

      // --- broad wave normal plus a whisper of current-advected detail (kept calm: cartoon seas are smooth)
      const T = 4.0;
      const p0 = fract(this.uTime.div(T));
      const p1 = fract(this.uTime.div(T).add(0.5));
      const wA = float(1).sub(abs(p0.mul(2).sub(1)));
      const wB = float(1).sub(wA);
      const windV = vec2(this.uWindDirSpeed.x, this.uWindDirSpeed.y).mul(this.uWindDirSpeed.z);
      const scA = 0.21;
      const baseA = xz.mul(scA).add(windV.mul(this.uTime).mul(0.011 * scA * 4.0));
      const sA0 = rippleNode.sample(baseA.sub(flow.mul(p0).mul(T * scA))).rg;
      const sA1 = rippleNode.sample(baseA.sub(flow.mul(p1).mul(T * scA))).rg;
      const nA = sA0.mul(wA).add(sA1.mul(wB)).mul(2).sub(1);
      const baseB = xz.mul(0.052).add(windV.mul(this.uTime).mul(0.0064)).add(vec2(0.37, 0.11));
      const nB = rippleNode.sample(baseB).rg.mul(2).sub(1);
      const near = float(1).sub(smoothstep(30.0, 300.0, dist));
      const detailAmt = this.uDetail.mul(near.mul(0.8).add(0.2));
      const dn = nA.mul(0.45).add(nB.mul(0.55)).mul(detailAmt);
      const N = normalize(vec3(vNormal.x.add(dn.x), vNormal.y, vNormal.z.add(dn.y))).toVar();
      const Nb = normalize(vec3(vNormal.x.add(dn.x.mul(0.35)), vNormal.y, vNormal.z.add(dn.y.mul(0.35))));

      // --- body colour: flat depth bands, visible sea floor in the shallows -------------------------
      const deepMix = float(1)
        .sub(exp(depth.div(-6.5)))
        .pow(0.8);
      const scatter = mix(this.uShallow, this.uDeep, toonQ(deepMix, float(5.0), float(0.1)));

      const grassW = clamp(float(1).sub(abs(kind.sub(1.0)).mul(2.0)), 0.0, 1.0);
      const rockW = smoothstep(1.35, 1.95, kind);
      const sandFleck = noiseNode.sample(xz.mul(0.09)).g.mul(0.12).add(0.94);
      const floorCol = mix(this.uSand.mul(sandFleck), this.uGrass, grassW).toVar();
      floorCol.assign(mix(floorCol, this.uRock, rockW));
      const caus = caustics(xz).mul(float(1).sub(smoothstep(0.3, 6.0, depth)));
      const sunUp = clamp(L.y.mul(1.6), 0.0, 1.0);
      const floorLight = float(0.6)
        .add(sunUp.mul(0.4))
        .mul(float(0.88).add(smoothstep(0.55, 0.75, caus).mul(0.3).mul(sunUp)));
      const trans = exp(depth.mul(vec3(0.62, 0.17, 0.1)).negate());
      const aqua = mix(vec3(1.0), vec3(0.66, 1.0, 0.94), clamp(depth.mul(1.4).add(0.3), 0.0, 1.0));
      const floorVis = toonQ(exp(depth.mul(-0.4)).mul(this.uClarity), float(4.0), float(0.12));
      const floorSeen = floorCol
        .mul(floorLight)
        .mul(trans)
        .mul(aqua)
        .add(scatter.mul(float(1).sub(trans.y)).mul(0.5));
      const body = mix(scatter, floorSeen, floorVis).toVar();

      // --- cel lighting by wave slope: three bands from shade to sunlit --------------------------------
      // wave slopes are shallow, so exaggerate them for the cel bands (the geometry itself stays true)
      const Ns = normalize(vec3(vNormal.x.mul(3.4), vNormal.y, vNormal.z.mul(3.4)));
      const diff = dot(Ns, L);
      const lightBand = toonQ(clamp(diff.mul(0.5).add(0.5), 0.0, 1.0), float(3.0), float(0.09));
      const direct = float(1).sub(this.uOvercast.mul(0.5));
      const lightLevel = float(0.66).add(sunUp.mul(0.34)).mul(direct);
      const lightCol = mix(vec3(1.0), atmos.sunColor.mul(0.8).add(0.2), 0.3).mul(lightLevel);
      body.mulAssign(lightCol);
      body.mulAssign(mix(float(0.82), float(1.1), lightBand));
      // swell height reads as flat tonal bands too: dark troughs, bright shoulders
      const heightBand = toonQ(
        smoothstep(-0.55, 0.65, vInfo.x.mul(this.uCrestScale)),
        float(4.0),
        float(0.1),
      );
      body.mulAssign(mix(float(0.84), float(1.1), heightBand));
      // storm seas are steelier: pull the body a little toward grey-blue
      const bodyLuma = dot(body, vec3(0.2126, 0.7152, 0.0722));
      body.assign(mix(body, vec3(bodyLuma).mul(vec3(0.86, 0.97, 1.06)), this.uOvercast.mul(0.32)));

      // crests glow a lighter, brighter turquoise (two flat steps)
      const hN = vInfo.x.mul(this.uCrestScale);
      const crest = toonQ(smoothstep(0.1, 0.92, hN), float(3.0), float(0.1));
      body.assign(
        mix(
          body,
          this.uGlow.mul(float(1.0).sub(this.uOvercast.mul(0.4))).mul(1.08),
          crest.mul(0.5).mul(float(1).sub(atmos.night.mul(0.7))),
        ),
      );

      // --- gust "cat's paws": darker patches sweeping over the water ------------------------------------
      const wd = vec2(this.uWindDirSpeed.x, this.uWindDirSpeed.y);
      const u1 = dot(xz, wd);
      const v1 = xz.x.mul(wd.y.negate()).add(xz.y.mul(wd.x));
      const a1 = u1
        .sub(this.uWindDirSpeed.z.mul(0.6).mul(this.uTime))
        .mul((Math.PI * 2) / 310)
        .add(sin(v1.mul((Math.PI * 2) / 520)).mul(1.7));
      const a2 = u1
        .sub(this.uWindDirSpeed.z.mul(0.45).mul(this.uTime))
        .mul((Math.PI * 2) / 137)
        .add(1.9)
        .add(sin(v1.mul((Math.PI * 2) / 211).add(0.7)).mul(1.3));
      const gustSig = sin(a1).mul(0.62).add(sin(a2).mul(0.38));
      const gust = smoothstep(0.3, 0.42, gustSig).mul(this.uGustAmt);
      body.mulAssign(float(1).sub(gust.mul(0.16)));

      // --- hand-drawn wave dashes: short crest-aligned strokes that twinkle in and out ----------------------------
      const dashCell = xz.div(5.5);
      const dId = floor(dashCell);
      const dF = fract(dashCell).sub(0.5);
      const dr1 = fract(sin(dId.x.mul(127.1).add(dId.y.mul(311.7))).mul(43758.5453));
      const dr2 = fract(sin(dId.x.mul(269.5).add(dId.y.mul(183.3))).mul(43758.5453));
      const dr3 = fract(sin(dId.x.mul(419.2).add(dId.y.mul(371.9))).mul(43758.5453));
      const wdir = normalize(windV.add(vec2(0.0001, 0.0)));
      const perp = vec2(wdir.y.negate(), wdir.x);
      const dq = dF.sub(vec2(dr1.sub(0.5), dr2.sub(0.5)).mul(0.5));
      const along = dot(dq, perp);
      const across = dot(dq, wdir);
      const dashLen = dr3.mul(0.1).add(0.1);
      const dash = float(1)
        .sub(smoothstep(0.012, 0.028, abs(across)))
        .mul(float(1).sub(smoothstep(dashLen.sub(0.03), dashLen, abs(along))))
        .mul(step(0.42, dr3))
        .mul(
          sin(this.uTime.mul(0.9).add(dr1.mul(6.283)))
            .mul(0.5)
            .add(0.5)
            .pow(1.5),
        );
      const strokeFade = smoothstep(14.0, 40.0, dist).mul(float(1).sub(smoothstep(40.0, 180.0, dist)));
      const strokeCol = vec3(0.86, 0.99, 1.0);
      body.assign(
        mix(
          body,
          strokeCol.mul(lightLevel),
          dash
            .mul(strokeFade)
            .mul(0.6)
            .mul(float(1).sub(atmos.night.mul(0.6))),
        ),
      );

      // --- sky reflection: a few flat Fresnel bands toward the horizon ----------------------------------------
      const R = reflect(V.negate(), N).toVar();
      R.y.assign(max(R.y, 0.02));
      const sky = atmos.skyGradient(R).add(atmos.sunGlow(R)).toVar();
      sky.addAssign(atmos.stars(R));
      const cl = atmos.clouds(R);
      sky.assign(mix(sky, cl.rgb, cl.a.mul(0.6)));
      const ndv = max(dot(Nb, V), 0.0);
      const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndv), 4.6)));
      const col = mix(body, sky, toonQ(fres.mul(0.92), float(5.0), float(0.14))).toVar();

      // --- sun path: chunky stylised glints instead of a noisy glitter -------------------------------------------
      const H = normalize(L.add(V));
      const ndh = max(dot(Nb, H), 0.0);
      const glint = smoothstep(0.9965, 0.9978, ndh).add(smoothstep(0.988, 0.992, ndh).mul(0.32));
      const sunVis = smoothstep(-0.02, 0.06, L.y);
      const glitter = atmos.sunColor
        .mul(glint)
        .mul(sunVis)
        .mul(float(1).sub(cl.a.mul(0.9)))
        .mul(float(1).sub(this.uOvercast.mul(0.75)));

      // --- foam: crisp white shapes with a light-aqua rim --------------------------------------------------------
      const nz1 = noiseNode.sample(xz.mul(0.33).add(windV.mul(this.uTime).mul(0.0035))).b;
      const nz2 = noiseNode.sample(xz.mul(1.1).sub(windV.mul(this.uTime).mul(0.006)).add(0.5)).a;
      const nz3 = noiseNode.sample(xz.mul(0.09).add(0.2)).g;
      const fn = nz1.mul(0.5).add(nz2.mul(0.38)).add(nz3.mul(0.12));

      const jac = vInfo.y;
      const crestFoam = float(1)
        .sub(smoothstep(0.02, 0.5, jac))
        .mul(this.uFoam);
      // white caps ride the tallest crests once there is some wind
      const capEnable = smoothstep(3.5, 10.0, this.uWindDirSpeed.z);
      const cap = smoothstep(0.74, 0.8, hN.add(fn.sub(0.5).mul(0.22))).mul(capEnable);
      const breakDepth = this.uHMax.x.mul(0.9).add(0.2);
      const breakAmt = float(1)
        .sub(smoothstep(0.2, 1.15, depth.div(breakDepth)))
        .mul(swellExp)
        .mul(smoothstep(0.15, 0.6, this.uHMax.x));
      const surf = breakAmt.mul(smoothstep(0.05, 0.55, nz3.add(breakAmt.mul(0.5)))).mul(0.95);
      // thin waterline lace + swell-driven wash lines (only where swell can reach)
      const edge = float(1).sub(smoothstep(0.0, 0.3, depth));
      const washBand = smoothstep(0.1, 0.5, depth).mul(float(1).sub(smoothstep(0.6, 1.8, depth)));
      const wash = sin(depth.mul(9.0).sub(this.uTime.mul(1.4)).add(nz3.mul(7.0)))
        .mul(0.5)
        .add(0.5);
      const washAmt = swellExp.mul(smoothstep(0.12, 0.7, this.uHMax.x));
      const shore = max(
        edge.mul(wash.mul(0.4).add(0.6)),
        washBand.mul(smoothstep(0.5, 0.85, wash)).mul(washAmt),
      ).mul(0.95);
      const wuv = xz.sub(vec2(this.uWakeCenter.x, this.uWakeCenter.y)).div(this.uWakeSize).add(0.5);
      const inWake = smoothstep(0.0, 0.03, wuv.x)
        .mul(smoothstep(1.0, 0.97, wuv.x))
        .mul(smoothstep(0.0, 0.03, wuv.y))
        .mul(float(1).sub(smoothstep(0.97, 1.0, wuv.y)));
      const wake = wakeNode.sample(wuv).rgb.mul(inWake);
      const foamAmt = clamp(max(max(crestFoam, cap), max(max(surf, shore), wake.r.mul(1.15))), 0.0, 1.0);
      const fval = fn.mul(0.8).add(0.12);
      const thr = float(1).sub(foamAmt);
      const foamMask = smoothstep(thr, thr.add(0.045), fval);
      const foamRim = smoothstep(thr.sub(0.08), thr, fval).sub(foamMask).max(0.0);
      const foamLight = float(1)
        .sub(atmos.night.mul(0.7))
        .mul(float(1).sub(this.uOvercast.mul(0.22)));
      const foamCol = mix(vec3(0.94, 0.99, 1.0), vec3(1.0, 0.99, 0.97), fn).mul(
        float(0.93).add(lightBand.mul(0.1)),
      );
      col.assign(mix(col, mix(col, vec3(0.78, 0.97, 1.0).mul(lightLevel), 0.7), foamRim.mul(0.85)));
      col.assign(mix(col, foamCol.mul(foamLight), foamMask));
      col.addAssign(glitter.mul(float(1).sub(foamMask)));

      // rain: two layers of small expanding ring ripples from jittered cells
      const ripples = (cell: number, speed: number, seedOff: number): N => {
        const rp: N = xz.div(cell).add(seedOff);
        const cid: N = floor(rp);
        const cf: N = fract(rp).sub(0.5);
        const rh: N = fract(sin(cid.x.mul(127.1).add(cid.y.mul(311.7))).mul(43758.5453));
        const rh2: N = fract(sin(cid.x.mul(269.5).add(cid.y.mul(183.3))).mul(43758.5453));
        const tt: N = fract(this.uTime.mul(speed).add(rh));
        const dd: N = length(cf.sub(vec2(rh2.sub(0.5), rh.sub(0.5)).mul(0.6)));
        const r0: N = tt.mul(0.34);
        return float(1)
          .sub(smoothstep(0.0, 0.035, abs(dd.sub(r0))))
          .mul(float(1).sub(tt).pow(1.5))
          .mul(step(rh2, this.uRain.mul(0.9)));
      };
      const ring: N = ripples(0.95, 1.7, 0.0).add(ripples(1.45, 1.1, 7.3));
      col.addAssign(
        vec3(0.85, 0.93, 1.0)
          .mul(ring)
          .mul(0.3)
          .mul(float(1).sub(smoothstep(25.0, 110.0, dist))),
      );

      // shadows of boats are stamped into the wake map's blue channel
      col.mulAssign(float(1).sub(wake.b.mul(0.38)));

      col.assign(mix(col, vec3(wake.r, wake.g, wake.b).mul(1.0), this.uDebug.mul(inWake.max(0.0).max(0.25))));
      return vec4(col, 1.0);
    })();

    return mat;
  }

  /** Point the foam / shadow lookups at the wake simulation's render target. */
  setWakeTexture(t: Texture): void {
    this.wakeTexture = t;
    this.wakeNode.value = t;
  }

  // ---------------------------------------------------------------------------------------------

  /** Upload per-frame state. */
  update(camera: PerspectiveCamera, env: Environment, weather: WeatherState): void {
    const w = env.waves;
    this.uTime.value = env.time;
    this.uCenter.value.set(camera.position.x, camera.position.z);
    for (let i = 0; i < NUM_WAVES; i++) {
      (this.waveA[i]!.value as Vector4).set(w.dirX[i]!, w.dirZ[i]!, w.k[i]!, w.amp[i]!);
      (this.waveB[i]!.value as Vector4).set(w.steep[i]!, w.omega[i]!, w.phase[i]!, 0);
    }
    this.uHMax.value.set(w.hMaxSwell, w.hMaxChop, w.hayStrength);
    this.uTide.value = env.tideSpeed;
    this.uWind.value.set(env.wind.dirX * env.wind.speed, env.wind.dirZ * env.wind.speed);
    this.uWindDirSpeed.value.set(env.wind.dirX, env.wind.dirZ, env.wind.speed);
    this.uGustAmt.value = env.wind.gust;
    this.uDeep.value.copy(weather.waterDeep);
    this.uShallow.value.copy(weather.waterShallow);
    this.uGlow.value.copy(weather.waterGlow);
    this.uFoam.value = weather.foam;
    this.uRain.value = weather.rain;
    this.uOvercast.value = Math.min(
      1,
      Math.max(0, weather.cloudCover - 0.45) * 1.2 + weather.cloudStorm * 0.6,
    );
    this.uDetail.value = Math.min(0.62, 0.2 + env.wind.speed * 0.022);
    this.uClarity.value = 1 - weather.cloudStorm * 0.35;
    const s = env.sea;
    this.uCrestScale.value = 1 / Math.max(0.4, 0.5 * s.swellHeight + 0.55 * s.chopHeight + 0.2);
  }
}
