// Owns the WebGPU renderer, scene graph, lights, shadows and the post pipeline.

import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import type { Environment } from '../sim/environment';
import { Atmosphere } from './atmosphere';
import { Lightning } from './fx/lightning';
import { Rain } from './fx/rain';
import { SprayFX } from './fx/spray';
import { PerfGovernor } from './perf';
import { PostPipeline } from './pipeline';
import { Sky } from './sky';
import { buildTerrain } from './terrain';
import { makeFlowTexture, makeGeoTexture, makeNoiseTexture, makeRippleNormalTexture } from './textures';
import { type WakeBoat, WakeMap } from './wake';
import { Water } from './water';
import { WeatherState } from './weatherState';
import { WorldProps } from './world/world';

export type Quality = 'low' | 'medium' | 'high';

export interface RenderOptions {
  quality: Quality;
  forceWebGL?: boolean;
}

export class RenderWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(58, 1, 0.3, 20000);
  readonly world = new Group();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly hemi = new HemisphereLight(0xffffff, 0x88aacc, 1);
  atmos!: Atmosphere;
  sky!: Sky;
  water!: Water;
  post!: PostPipeline;
  weather!: WeatherState;
  props!: WorldProps;
  wake!: WakeMap;
  spray!: SprayFX;
  rain!: Rain;
  lightning!: Lightning;
  perf!: PerfGovernor;
  private basePixelRatio = 1;
  backend: 'WebGPU' | 'WebGL2' = 'WebGPU';

  private shadowFocus = new Vector3();
  private readonly tmpColor = new Color();
  private readonly white = new Color(1, 1, 1);

  private constructor(
    readonly renderer: WebGPURenderer,
    readonly env: Environment,
    readonly quality: Quality,
  ) {}

  static async create(parent: HTMLElement, env: Environment, opts: RenderOptions): Promise<RenderWorld> {
    const q = opts.quality;
    const renderer = new WebGPURenderer({
      antialias: false,
      powerPreference: 'high-performance',
      forceWebGL: opts.forceWebGL,
    });
    const rwPR = Math.min(devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    renderer.setPixelRatio(rwPR);
    renderer.setSize(parent.clientWidth || innerWidth, parent.clientHeight || innerHeight);
    await renderer.init();
    parent.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const rw = new RenderWorld(renderer, env, q);
    rw.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    rw.basePixelRatio = rwPR;
    rw.build();
    return rw;
  }

  private build(): void {
    const { renderer, scene, env } = this;
    renderer.shadowMap.enabled = this.quality !== 'low';
    renderer.shadowMap.type = PCFShadowMap;

    this.weather = new WeatherState(env.weather);

    // procedural textures + baked data
    const noise = makeNoiseTexture(256);
    const ripple = makeRippleNormalTexture(512);
    const geoTex = makeGeoTexture(env.geo);
    const flowTex = makeFlowTexture(env.geo);

    this.atmos = new Atmosphere(noise);
    scene.fogNode = this.atmos.fogNode;

    this.sky = new Sky(this.atmos);
    scene.add(this.sky.mesh);

    this.wake = new WakeMap(renderer, flowTex, this.quality === 'low' ? 512 : 1024);
    this.water = new Water({ geo: geoTex, flow: flowTex, ripple, noise }, this.atmos, this.wake.texture);
    scene.add(this.water.mesh);
    this.water.uWakeSize.value = this.wake.size;

    scene.add(buildTerrain(env.geo, noise));
    this.props = new WorldProps(this.quality);
    scene.add(this.props.group);
    scene.add(this.world);
    this.spray = new SprayFX();
    scene.add(this.spray.mesh);
    this.rain = new Rain(this.quality === 'low' ? 4000 : 9000);
    scene.add(this.rain.mesh);
    this.lightning = new Lightning();
    scene.add(this.lightning.mesh);

    // lights
    const s = this.sun;
    s.castShadow = this.quality !== 'low';
    const size = this.quality === 'high' ? 4096 : 2048;
    s.shadow.mapSize.set(size, size);
    const cam = s.shadow.camera;
    cam.left = -110;
    cam.right = 110;
    cam.top = 110;
    cam.bottom = -110;
    cam.near = 10;
    cam.far = 900;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.12;
    scene.add(s, s.target, this.hemi);

    this.post = new PostPipeline(
      renderer,
      scene,
      this.camera,
      this.quality === 'low' ? 0 : this.quality === 'medium' ? 2 : 4,
    );
    this.perf = new PerfGovernor((scale) => {
      this.renderer.setPixelRatio(this.basePixelRatio * scale);
      this.resize(innerWidth, innerHeight);
    });
    this.resize(innerWidth, innerHeight);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Advance visuals. `focus` is the point the shadow cascade follows. */
  update(dt: number, focus: Vector3, boats: WakeBoat[] = []): void {
    const { env, weather, atmos } = this;
    weather.update(dt);
    this.wake.update(dt, focus.x, focus.z, env.tideSpeed, boats);
    this.water.setWakeTexture(this.wake.texture);
    this.water.uWakeCenter.value.copy(this.wake.center);
    atmos.sync(weather, { x: env.wind.dirX * env.wind.speed, z: env.wind.dirZ * env.wind.speed }, env.time);
    this.sky.update(this.camera);
    this.water.update(this.camera, env, weather);
    this.post.update(weather);
    this.props.update(dt, env.time, env);
    const pl = boats[0];
    const px = pl?.x ?? focus.x;
    const pz = pl?.z ?? focus.z;
    const fair = (1 - Math.min(1, weather.cloudStorm * 1.1 + weather.rain)) * (1 - weather.night);
    this.props.wildlife.update(dt, {
      x: px,
      z: pz,
      vx: pl ? Math.cos(pl.heading) * pl.speed : 0,
      vz: pl ? Math.sin(pl.heading) * pl.speed : 0,
      fair: Math.max(0, fair),
      windX: env.wind.dirX * env.wind.speed,
      windZ: env.wind.dirZ * env.wind.speed,
      windSpeed: env.wind.speed,
      waveHeight: (x, z) => env.waves.height(x, z, env.time),
    });
    this.spray.update(dt, env);
    this.rain.intensity.value = weather.rain;
    const flash = this.lightning.update(dt, weather.lightning, this.camera);
    atmos.lightning.value = flash;
    this.post.overlay.value.set(0.85, 0.9, 1.0, flash * 0.1);

    // sun + hemisphere light follow the blended weather
    const sunUp = Math.max(0, Math.min(1, (weather.sunElevation + 2) / 12));
    // a whiter sun keeps the cel-shaded whites clean (the sky and sea keep the true tint)
    this.sun.color.copy(weather.sunColor).lerp(this.white, 0.5);
    this.sun.intensity = weather.sunIntensity * (0.25 + 0.75 * sunUp);
    // snap the shadow focus to texel size so shadows don't shimmer
    const texel = 220 / this.sun.shadow.mapSize.x;
    this.shadowFocus.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
    this.sun.target.position.copy(this.shadowFocus);
    this.sun.position.copy(this.shadowFocus).addScaledVector(weather.sunDir, 380);
    this.sun.target.updateMatrixWorld();

    // cool, bluish sky ambient against the warm sun => colour contrast between lit and shaded sides
    this.tmpColor.copy(weather.skyZenith).lerp(weather.skyMid, 0.3).lerp(this.white, 0.32);
    this.hemi.color.copy(this.tmpColor);
    this.hemi.groundColor.copy(weather.waterShallow).lerp(weather.sunColor, 0.2).multiplyScalar(0.6);
    this.hemi.intensity = 1.05 + 0.35 * (1 - sunUp) + weather.night * 0.3 + flash * 2.4;
  }

  render(): void {
    this.post.render();
  }
}
