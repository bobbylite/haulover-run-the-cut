// A live, smoothly-blended copy of the weather preset. Everything visual reads from this object so
// changing the weather in the menu cross-fades sun, sky, haze, grading and sea state together.

import { Color, Vector3 } from 'three/webgpu';
import { damp, lerp } from '../core/math';
import type { WeatherPreset } from '../data/weather';

const COLOR_KEYS = [
  'sunColor',
  'skyHorizon',
  'skyMid',
  'skyZenith',
  'cloudLit',
  'cloudShade',
  'hazeColor',
  'waterDeep',
  'waterShallow',
  'waterGlow',
] as const;

const NUM_KEYS = [
  'sunAzimuth',
  'sunElevation',
  'sunIntensity',
  'cloudCover',
  'cloudStorm',
  'haze',
  'foam',
  'rain',
  'lightning',
  'exposure',
  'saturation',
  'contrast',
  'bloom',
  'vignette',
  'warmth',
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
type NumKey = (typeof NUM_KEYS)[number];

export class WeatherState {
  sunAzimuth = 0;
  sunElevation = 0;
  sunIntensity = 0;
  cloudCover = 0;
  cloudStorm = 0;
  haze = 0;
  foam = 0;
  rain = 0;
  lightning = 0;
  exposure = 1;
  saturation = 1;
  contrast = 1;
  bloom = 0;
  vignette = 0;
  warmth = 0;
  /** 0 = day, 1 = night. */
  night = 0;

  readonly sunColor = new Color();
  readonly skyHorizon = new Color();
  readonly skyMid = new Color();
  readonly skyZenith = new Color();
  readonly cloudLit = new Color();
  readonly cloudShade = new Color();
  readonly hazeColor = new Color();
  readonly waterDeep = new Color();
  readonly waterShallow = new Color();
  readonly waterGlow = new Color();

  /** Unit vector from the scene towards the sun (or moon). */
  readonly sunDir = new Vector3(0, 1, 0);

  private readonly tmp = new Color();
  target!: WeatherPreset;

  constructor(preset: WeatherPreset) {
    this.snap(preset);
  }

  snap(p: WeatherPreset): void {
    this.target = p;
    for (const k of NUM_KEYS) this[k as NumKey] = p[k as NumKey] as number;
    for (const k of COLOR_KEYS) (this[k as ColorKey] as Color).set(p[k as ColorKey] as string);
    this.night = p.night ? 1 : 0;
    this.updateSun();
  }

  setTarget(p: WeatherPreset): void {
    this.target = p;
  }

  /** Exponential approach to the target preset. `rate` ~ 1.5 gives a ~2 s cross-fade. */
  update(dt: number, rate = 1.6): void {
    const a = damp(rate, dt);
    const p = this.target;
    for (const k of NUM_KEYS) {
      if (k === 'sunAzimuth') {
        // shortest-way angular interpolation
        let d = ((p.sunAzimuth - this.sunAzimuth + 540) % 360) - 180;
        d = Number.isFinite(d) ? d : 0;
        this.sunAzimuth += d * a;
      } else {
        this[k as NumKey] = lerp(this[k as NumKey], p[k as NumKey] as number, a);
      }
    }
    for (const k of COLOR_KEYS) {
      (this[k as ColorKey] as Color).lerp(this.tmp.set(p[k as ColorKey] as string), a);
    }
    this.night = lerp(this.night, p.night ? 1 : 0, damp(rate * 0.8, dt));
    this.updateSun();
  }

  private updateSun(): void {
    const az = (this.sunAzimuth * Math.PI) / 180;
    const el = (this.sunElevation * Math.PI) / 180;
    // N = -z, E = +x
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  }
}
