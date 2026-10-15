// HDR scene -> bloom -> AgX tone mapping -> pastel colour grading -> vignette + dither.

import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import {
  abs,
  dot,
  Fn,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  pass,
  rand,
  renderOutput,
  saturate,
  screenCoordinate,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  type Camera,
  Matrix4,
  NeutralToneMapping,
  NoToneMapping,
  RenderPipeline,
  type Scene,
  SRGBColorSpace,
  type ToneMapping,
  Vector4,
  type WebGPURenderer,
} from 'three/webgpu';
import type { WeatherState } from './weatherState';

type N = any;

export class PostPipeline {
  readonly pipeline: RenderPipeline;
  readonly exposure = uniform(1);
  readonly saturation = uniform(1.1);
  readonly contrast = uniform(1.04);
  readonly vignette = uniform(0.35);
  readonly warmth = uniform(0.3);
  /** Extra flash / damage tint (rgb, strength in a). */
  readonly overlay = uniform(new Vector4(0, 0, 0, 0));
  /** Rain curtain intensity 0..1 and slant. */
  readonly rain = uniform(0);
  /** Ink outline strength 0..1 (0 disables). */
  readonly ink = uniform(1);
  private readonly bloomNode: N;
  private readonly depthNode: N;
  /** The scene camera's matrices (the post pass renders with its own quad camera, so pass them in). */
  private readonly projInv = uniform(new Matrix4());
  private readonly camWorld = uniform(new Matrix4());
  private readonly camera: Camera;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera, samples = 4) {
    this.camera = camera;
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;

    const scenePass = pass(scene, camera, { samples });
    const sceneColor = scenePass.getTextureNode('output');
    this.depthNode = scenePass.getTextureNode('depth');
    this.bloomNode = bloom(sceneColor, 0.45, 0.85, 0.82);
    this.hdr = sceneColor.add(this.bloomNode).mul(this.exposure);
    this.buildOutput(NeutralToneMapping);
  }

  private readonly hdr: N;

  /** (Re)build the tone-map + grade chain. */
  buildOutput(tone: ToneMapping): void {
    const hdr = this.hdr;
    const graded = Fn(() => {
      // tone map + sRGB first, then grade in display space
      const ldr = renderOutput(hdr, tone, SRGBColorSpace) as N;
      const c: N = ldr.rgb.toVar();
      const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(vec3(luma), c, this.saturation.mul(1.14)));
      c.assign(c.sub(0.5).mul(this.contrast).add(0.5));
      // split toning: cool lavender shadows, warm highlights (or the reverse when warmth < 0)
      const sh = float(1).sub(smoothstep(0.0, 0.55, luma));
      const hi = smoothstep(0.45, 1.0, luma);
      c.addAssign(vec3(-0.012, 0.0, 0.03).mul(sh).mul(this.warmth.abs().add(0.5)));
      c.addAssign(vec3(0.03, 0.012, -0.02).mul(hi).mul(this.warmth));
      // ink outlines: second differences of inverse depth vanish on flat surfaces (at any angle) and spike
      // at silhouettes and creases, so this draws a clean line around every object, not on the water
      const px: N = vec2(1.0)
        .div(screenSize)
        .mul(max(1.0, screenSize.y.div(900.0)))
        .mul(1.15);
      const iz = (o: N): N => float(1).sub(this.depthNode.sample(screenUV.add(o)).r);
      const izc: N = iz(vec2(0.0));
      const lap: N = abs(
        iz(vec2(px.x, 0.0))
          .add(iz(vec2(px.x.negate(), 0.0)))
          .sub(izc.mul(2.0)),
      ).add(
        abs(
          iz(vec2(0.0, px.y))
            .add(iz(vec2(0.0, px.y.negate())))
            .sub(izc.mul(2.0)),
        ),
      );
      // no ink through the water: the sea does not write depth, so submerged hulls and pilings would
      // otherwise show their outlines below the surface
      const ndc: N = vec4(
        screenUV.x.mul(2.0).sub(1.0),
        float(1.0).sub(screenUV.y.mul(2.0)),
        float(1).sub(izc),
        1.0,
      );
      const vp: N = (this.projInv as N).mul(ndc);
      const wy: N = (this.camWorld as N).mul(vec4(vp.xyz.div(vp.w), 1.0)).y;
      const dry: N = smoothstep(-0.55, -0.15, wy);
      const near: N = smoothstep(0.0007, 0.006, izc).mul(dry); // lines fade out beyond ~300 m
      const edge: N = smoothstep(0.03, 0.09, lap.div(izc.max(1e-6)))
        .mul(step(1e-5, izc))
        .mul(near)
        .mul(this.ink);
      const inkCol: N = mix(c.mul(0.2), vec3(0.16, 0.1, 0.32), 0.55);
      c.assign(mix(c, inkCol, edge.mul(0.88)));
      // vignette
      const q = screenUV.sub(vec2(0.5, 0.5));
      const vig = float(1).sub(smoothstep(0.32, 0.95, length(q.mul(vec2(1.15, 1.0)))).mul(this.vignette));
      c.mulAssign(vig);
      // screen-space rain curtain (close streaks)
      const slantX = screenUV.x.mul(260.0).add(screenUV.y.mul(38.0));
      const colId: N = floor(slantX);
      const r1: N = fract(sin(colId.mul(12.9898)).mul(43758.5453));
      const r2: N = fract(sin(colId.mul(78.233)).mul(12543.123));
      const yy: N = fract(
        screenUV.y
          .mul(float(1.2).add(r1))
          .add(time.mul(float(2.0).add(r2.mul(2.0))))
          .add(r2.mul(13.0)),
      );
      const streak: N = smoothstep(0.0, 0.03, yy)
        .mul(float(1).sub(smoothstep(0.03, 0.16, yy)))
        .mul(step(r1, this.rain.mul(0.55)))
        .mul(smoothstep(0.18, 0.7, fract(slantX)).mul(float(1).sub(smoothstep(0.7, 0.95, fract(slantX)))));
      c.addAssign(vec3(0.7, 0.78, 0.9).mul(streak).mul(this.rain.mul(0.16)));
      // overlay flash (lightning / water-slap), then dither against banding
      c.assign(mix(c, this.overlay.rgb, this.overlay.a));
      c.addAssign(rand(screenCoordinate.xy).sub(0.5).div(255.0));
      return vec4(saturate(c) as N, float(1));
    })();
    this.pipeline.outputNode = graded;
    this.pipeline.needsUpdate = true;
  }

  setToneMapping(name: 'agx' | 'aces' | 'neutral' | 'none'): void {
    const m = {
      agx: AgXToneMapping,
      aces: ACESFilmicToneMapping,
      neutral: NeutralToneMapping,
      none: NoToneMapping,
    }[name];
    this.buildOutput(m);
  }

  update(w: WeatherState): void {
    this.projInv.value.copy(this.camera.projectionMatrixInverse);
    this.camWorld.value.copy(this.camera.matrixWorld);
    this.exposure.value = w.exposure;
    this.saturation.value = w.saturation;
    this.contrast.value = w.contrast;
    this.vignette.value = w.vignette;
    this.warmth.value = w.warmth;
    this.bloomNode.strength.value = w.bloom;
    this.rain.value = w.rain;
  }

  render(): void {
    this.pipeline.render();
  }
}
