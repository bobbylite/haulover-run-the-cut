// The "live" sea: bakes geography once, then binds weather + tide + difficulty into the wave, wind
// and current fields that both the physics and the shaders read.

import { clamp, damp, lerp, wrapAngle } from '../core/math';
import type { Difficulty } from '../data/difficulty';
import type { WeatherPreset } from '../data/weather';
import { GeoGrid } from './geography';
import { makeWaveSample, type SeaState, WaveField, type WaveSample } from './waves';
import { WindField } from './wind';

export type Tide = 'ebb' | 'flood' | 'slack';

/** Peak current in the throat (m/s) per tide state, before difficulty scaling. */
export const TIDE_SPEED: Record<Tide, number> = { ebb: 2.7, flood: -2.3, slack: 0.12 };

/** Unit vector pointing *towards* a compass bearing (N = -z, E = +x). */
export function compassVec(deg: number): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

export class Environment {
  readonly geo: GeoGrid;
  readonly waves: WaveField;
  readonly wind = new WindField();

  /** Game clock in seconds. Drives waves, gusts and the water shader. */
  time = 0;
  tide: Tide = 'ebb';
  /** Signed throat current in m/s (+ flows east / out to sea). */
  tideSpeed = 2.7;
  weather!: WeatherPreset;
  difficulty!: Difficulty;
  /** Current sea-state parameters (post difficulty scaling). */
  sea!: SeaState;

  private readonly flow = { x: 0, z: 0 };
  private target: {
    sea: SeaState;
    wind: { speed: number; from: number; gust: number };
    tide: number;
  } | null = null;
  private windFrom = 90;

  constructor(geo?: GeoGrid) {
    this.geo = geo ?? GeoGrid.bake();
    this.waves = new WaveField(this.geo);
  }

  /**
   * Configure conditions. With `instant` the sea snaps; otherwise `update()` cross-fades the waves,
   * wind and tide so menu weather changes look smooth.
   */
  setConditions(weather: WeatherPreset, tide: Tide, difficulty: Difficulty, instant = true): void {
    this.weather = weather;
    this.tide = tide;
    this.difficulty = difficulty;
    const tideSpeed = TIDE_SPEED[tide] * difficulty.currentScale;

    const sw = compassVec(weather.swellFrom);
    const swellTravel = Math.atan2(-sw.z, -sw.x);
    // wind blows towards (from + 180)
    const wa = (weather.windFrom * Math.PI) / 180;
    const windTravel = Math.atan2(Math.cos(wa), -Math.sin(wa));
    const currentDir = tideSpeed >= 0 ? 0 : Math.PI;

    // Waves running against the ebb stand up into haystacks; a following flood just surfs them in.
    const cur = { x: Math.cos(currentDir), z: Math.sin(currentDir) };
    const opposition = Math.max(0, -(Math.cos(swellTravel) * cur.x + Math.sin(swellTravel) * cur.z));
    const ebbFactor = tideSpeed > 0 ? tideSpeed / 2.7 : 0;
    // standing waves need both a running ebb and something to stand up: swell and wind energy
    const energy = clamp(
      0.12 + weather.swellHeight * 0.3 + weather.windSpeed * weather.windSpeed * 0.0035,
      0,
      0.95,
    );
    const hay = ebbFactor * (0.25 + 0.75 * opposition) * energy;

    const ws = difficulty.waveScale;
    const sea: SeaState = {
      swellHeight: weather.swellHeight * ws,
      swellDir: swellTravel,
      swellLength: weather.swellLength,
      chopHeight: weather.chopHeight * ws,
      chopDir: windTravel,
      hay: hay * ws,
      currentDir,
      sharpness: 1 + weather.windSpeed * 0.012,
    };
    this.target = {
      sea,
      wind: {
        speed: weather.windSpeed * difficulty.windScale,
        from: weather.windFrom,
        gust: Math.min(0.95, weather.gust * (0.75 + 0.5 * difficulty.windScale)),
      },
      tide: tideSpeed,
    };
    if (instant || !this.sea) {
      this.sea = { ...sea };
      this.tideSpeed = tideSpeed;
      this.windFrom = weather.windFrom;
      this.wind.setFromCompass(this.target.wind.speed, weather.windFrom, this.target.wind.gust);
      this.waves.configure(this.sea);
    }
  }

  /** Cross-fade towards the target conditions. Returns true while still blending. */
  blend(dt: number, rate = 1.1): boolean {
    const t = this.target;
    if (!t) return false;
    const a = damp(rate, dt);
    const s = this.sea;
    const g = t.sea;
    let moving = false;
    const mix = (cur: number, tgt: number): number => {
      const v = lerp(cur, tgt, a);
      if (Math.abs(v - tgt) > 1e-3) moving = true;
      return Math.abs(v - tgt) < 1e-4 ? tgt : v;
    };
    s.swellHeight = mix(s.swellHeight, g.swellHeight);
    s.swellLength = mix(s.swellLength, g.swellLength);
    s.chopHeight = mix(s.chopHeight, g.chopHeight);
    s.hay = mix(s.hay, g.hay);
    s.sharpness = mix(s.sharpness, g.sharpness);
    s.swellDir += wrapAngle(g.swellDir - s.swellDir) * a;
    s.chopDir += wrapAngle(g.chopDir - s.chopDir) * a;
    s.currentDir = g.currentDir;
    if (
      Math.abs(wrapAngle(g.swellDir - s.swellDir)) > 1e-3 ||
      Math.abs(wrapAngle(g.chopDir - s.chopDir)) > 1e-3
    )
      moving = true;
    this.tideSpeed = mix(this.tideSpeed, t.tide);
    this.windFrom += (((t.wind.from - this.windFrom + 540) % 360) - 180) * a;
    this.wind.setFromCompass(
      mix(this.wind.speed, t.wind.speed),
      this.windFrom,
      mix(this.wind.gust, t.wind.gust),
    );
    if (moving) this.waves.configure(s);
    return moving;
  }

  waveAt(x: number, z: number, out: WaveSample = makeWaveSample()): WaveSample {
    this.waves.sample(x, z, this.time, out);
    return out;
  }

  /** Total water velocity (tidal current only, no orbital motion). */
  currentAt(x: number, z: number, out: { x: number; z: number }): void {
    this.geo.flowAt(x, z, out);
    out.x *= this.tideSpeed;
    out.z *= this.tideSpeed;
  }

  windAt(x: number, z: number, out: { x: number; z: number }): void {
    this.wind.sample(x, z, this.time, out);
  }

  depthAt(x: number, z: number): number {
    return -this.geo.heightAt(x, z);
  }

  currentSpeedAt(x: number, z: number): number {
    this.currentAt(x, z, this.flow);
    return Math.hypot(this.flow.x, this.flow.z);
  }
}
