// Shared atmosphere: uniforms + TSL functions for sky colour, clouds, stars and aerial perspective.
// The sky dome, the water reflections and the scene-wide haze all call the same functions so the
// horizon blends seamlessly.

import {
  cameraPosition,
  clamp,
  dot,
  exp,
  Fn,
  float,
  length,
  max,
  mix,
  normalize,
  output,
  positionWorld,
  pow,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Color, type DataTexture } from 'three/webgpu';
import { shared } from './shared';
import { toonQ } from './toon';
import type { WeatherState } from './weatherState';

type N = any;

export class Atmosphere {
  readonly sunDir = shared.sunDir;
  readonly sunColor = shared.sunColor;
  readonly skyHorizon = uniform(new Color());
  readonly skyMid = uniform(new Color());
  readonly skyZenith = uniform(new Color());
  readonly hazeColor = uniform(new Color());
  readonly cloudLit = uniform(new Color());
  readonly cloudShade = uniform(new Color());
  readonly cloudCover = uniform(0.5);
  readonly cloudStorm = uniform(0);
  readonly haze = uniform(0.0002);
  readonly night = shared.night;
  readonly lightning = uniform(0);
  readonly time = shared.time;
  /** Wind (towards) for cloud drift. */
  readonly wind = shared.wind;

  private readonly noiseTex: DataTexture;

  /** Sky colour for a view direction (no clouds, no sun disc). */
  readonly skyGradient: (dir: N) => N;
  /** Banded (cel-shaded) sky colour for the dome. */
  readonly skyToon: (dir: N) => N;
  /** Soft sun halo (and moon halo). */
  readonly sunGlow: (dir: N) => N;
  /** Sun / moon disc (HDR). */
  readonly sunDisc: (dir: N) => N;
  /** Cloud layer: rgb + alpha. */
  readonly clouds: (dir: N) => N;
  readonly stars: (dir: N) => N;
  /** Scene-wide aerial perspective; assign to scene.fogNode. */
  readonly fogNode: N;

  constructor(noiseTex: DataTexture) {
    this.noiseTex = noiseTex;
    const noise = texture(noiseTex);

    this.skyGradient = Fn(([dir]: N[]) => {
      const h = dir.y;
      const t1 = smoothstep(-0.02, 0.34, h).pow(0.85);
      const t2 = smoothstep(0.08, 0.92, h);
      const col = mix(this.skyHorizon, this.skyMid, t1).toVar();
      col.assign(mix(col, this.skyZenith, t2));
      // darker band below the horizon so the reflected sky never shows the hard seam
      col.mulAssign(
        float(1)
          .sub(smoothstep(-0.25, 0.0, h))
          .mul(-0.18)
          .add(1.0),
      );
      return col;
    }) as (dir: N) => N;

    // The dome's banded sky: the same gradient, stepped into flat colour bands like a cel painting.
    this.skyToon = Fn(([dir]: N[]) => {
      const h = dir.y;
      const t1 = toonQ(smoothstep(-0.02, 0.34, h).pow(0.85), float(4.0), float(0.2));
      const t2 = toonQ(smoothstep(0.08, 0.92, h), float(5.0), float(0.2));
      const col = mix(this.skyHorizon, this.skyMid, t1).toVar();
      col.assign(mix(col, this.skyZenith, t2));
      col.mulAssign(
        float(1)
          .sub(smoothstep(-0.25, 0.0, h))
          .mul(-0.18)
          .add(1.0),
      );
      return col;
    }) as (dir: N) => N;

    this.sunGlow = Fn(([dir]: N[]) => {
      const sd = max(dot(dir, this.sunDir), 0.0);
      const h = dir.y.max(0.0);
      // warm horizon band, widest in the sun's azimuth
      const band = exp(h.mul(h).mul(-16.0)).mul(pow(sd.mul(0.5).add(0.5), 3.0));
      const halo = pow(sd, 5.0).mul(0.2).add(pow(sd, 40.0).mul(0.55));
      return this.sunColor.mul(band.mul(0.34).add(halo));
    }) as (dir: N) => N;

    this.sunDisc = Fn(([dir]: N[]) => {
      const sd = dot(dir, this.sunDir);
      const d = smoothstep(0.9982, 0.9985, sd);
      return this.sunColor.mul(d.mul(7.0));
    }) as (dir: N) => N;

    this.stars = Fn(([dir]: N[]) => {
      const h = dir.y.max(0.0);
      const p = dir.xz.div(h.add(0.35)).mul(2.6);
      const s = noise.sample(p.mul(0.9)).b;
      const tw = noise.sample(p.mul(0.23).add(vec2(0.31, 0.77))).g;
      const star = smoothstep(0.935, 0.985, s)
        .mul(smoothstep(0.42, 0.75, tw))
        .mul(smoothstep(0.02, 0.3, h));
      return vec3(0.85, 0.9, 1.0).mul(star).mul(this.night).mul(2.2);
    }) as (dir: N) => N;

    this.clouds = Fn(([dir]: N[]) => {
      const h = dir.y.max(0.0);
      const p = dir.xz.div(h.add(0.15));
      const drift = this.wind.mul(this.time).mul(0.0006);
      const uv = p.mul(0.26).add(drift);
      const dens = (uvA: N) => {
        const warp = noise
          .sample(uvA.mul(0.5).add(vec2(0.13, 0.61)))
          .g.sub(0.5)
          .mul(0.1);
        const w = uvA.add(vec2(warp, warp.mul(-0.7)));
        const a = noise.sample(w).r.mul(0.72);
        const b = noise.sample(w.mul(2.1).add(vec2(0.37, 0.11))).g.mul(0.22);
        const c = noise.sample(w.mul(4.3).add(vec2(0.81, 0.53))).r.mul(0.03);
        return a.add(b).add(c);
      };
      const thr = mix(float(0.72), float(0.3), this.cloudCover);
      const soft = float(0.05);
      const base = dens(uv);
      // hard-edged puffs
      const d = smoothstep(thr, thr.add(soft), base);
      // optical depth toward the sun: 3 taps marching along the sun's ground direction
      const sdirN = normalize(this.sunDir.xz.add(vec2(0.0001, 0.0)));
      const stepLen = float(0.022).mul(clamp(float(1).div(this.sunDir.y.add(0.2)), 1.0, 3.5));
      const sm = float(0.14);
      const o1 = smoothstep(thr, thr.add(sm), dens(uv.add(sdirN.mul(stepLen))));
      const o2 = smoothstep(thr, thr.add(sm), dens(uv.add(sdirN.mul(stepLen.mul(2.0)))));
      const o3 = smoothstep(thr, thr.add(sm), dens(uv.add(sdirN.mul(stepLen.mul(3.2)))));
      const od = o1.add(o2.mul(0.8)).add(o3.mul(0.6)).div(2.4);
      const lit = clamp(float(1.1).sub(od.mul(1.25)).add(float(1).sub(d).mul(0.4)), 0.0, 1.0);
      const sd = max(dot(dir, this.sunDir), 0.0);
      // three flat tones: shade, mid, lit
      const col = mix(this.cloudShade, this.cloudLit, toonQ(lit, float(3.0), float(0.08))).toVar();
      // a lighter lip on the sunward edge
      col.addAssign(
        this.sunColor.mul(
          float(1)
            .sub(smoothstep(thr.add(soft), thr.add(soft.mul(4.0)), base))
            .mul(pow(sd, 3.0))
            .mul(0.28),
        ),
      );
      // storm: charcoal
      col.assign(mix(col, vec3(0.2, 0.22, 0.3).mul(col.add(0.4)), this.cloudStorm.mul(0.6)));
      // lightning flash lights the cloud deck from inside
      col.addAssign(vec3(0.7, 0.75, 1.0).mul(this.lightning).mul(d.mul(0.9).add(0.1)));
      // soft ink line just outside the puff
      const ring = smoothstep(thr.sub(0.03), thr.sub(0.012), base).mul(float(1).sub(d));
      col.assign(mix(this.cloudShade.mul(0.55), col, d));
      // blend toward the haze at the horizon
      const hf = smoothstep(0.0, 0.3, dir.y);
      col.assign(mix(this.hazeColor, col, hf.mul(0.85).add(0.15)));
      const alpha = max(d, ring.mul(0.5)).mul(smoothstep(0.005, 0.12, dir.y));
      return vec4(col, alpha);
    }) as (dir: N) => N;

    // Aerial perspective: distance haze tinted by the sky (with warm forward scattering).
    this.fogNode = Fn(() => {
      const view = positionWorld.sub(cameraPosition);
      const dist = length(view);
      const dir = view.div(dist.max(0.001));
      const f = float(1)
        .sub(exp(this.haze.mul(dist).negate()))
        .clamp(0.0, 1.0);
      const skyDir = normalize(vec3(dir.x, dir.y.mul(0.3), dir.z));
      const fogCol = this.skyGradient(skyDir).add(this.sunGlow(skyDir).mul(0.55)).toVar();
      fogCol.assign(mix(fogCol, this.hazeColor, 0.55));
      // lightning illuminates the haze
      fogCol.addAssign(vec3(0.5, 0.55, 0.8).mul(this.lightning).mul(0.5));
      return vec4(mix(output.rgb, fogCol, f), output.a);
    })();
  }

  /** Push the blended weather into uniforms. */
  sync(w: WeatherState, wind: { x: number; z: number }, time: number): void {
    this.sunDir.value.copy(w.sunDir);
    this.sunColor.value.copy(w.sunColor);
    this.skyHorizon.value.copy(w.skyHorizon);
    this.skyMid.value.copy(w.skyMid);
    this.skyZenith.value.copy(w.skyZenith);
    this.hazeColor.value.copy(w.hazeColor);
    this.cloudLit.value.copy(w.cloudLit);
    this.cloudShade.value.copy(w.cloudShade);
    this.cloudCover.value = w.cloudCover;
    this.cloudStorm.value = w.cloudStorm;
    this.haze.value = w.haze;
    this.night.value = w.night;
    this.wind.value.set(wind.x, wind.z);
    shared.windSpeed.value = Math.hypot(wind.x, wind.z);
    this.time.value = time;
  }

  /** Noise atlas, shared with the water shader. */
  get noise(): DataTexture {
    return this.noiseTex;
  }
}
