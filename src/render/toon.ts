// The cartoon material kit: cel-shaded (stepped) sun light, a soft rim, an optional hard "gloss"
// highlight, and flat ambient. Every solid thing in the world uses this so the whole scene reads as
// one hand-painted cartoon; the ink outlines are added in the post pipeline.

import {
  cameraPosition,
  dot,
  Fn,
  float,
  floor,
  fract,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  reflect,
  saturate,
  smoothstep,
  vec3,
} from 'three/tsl';
import { DataTexture, MeshToonNodeMaterial, NearestFilter, RedFormat, UnsignedByteType } from 'three/webgpu';
import { shared } from './shared';

type N = any;

/** Four light bands (shadow, shade, light, bright) indexed by N·L. */
let gradient: DataTexture | null = null;
function gradientMap(): DataTexture {
  if (!gradient) {
    gradient = new DataTexture(new Uint8Array([22, 92, 168, 222]), 4, 1, RedFormat, UnsignedByteType);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export interface ToonParams {
  color?: ConstructorParameters<typeof MeshToonNodeMaterial>[0] extends infer P
    ? P extends { color?: infer C }
      ? C
      : never
    : never;
  vertexColors?: boolean;
  side?: number;
  transparent?: boolean;
  opacity?: number;
  /** 0 = matte, 1 = glossy: adds a hard white highlight where the sun reflects. */
  gloss?: number;
  /** Strength of the sky-coloured edge glow (default 0.22). */
  rim?: number;
  // accepted (and ignored) so PBR-style call sites keep working
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  [k: string]: unknown;
}

export class ToonMaterial extends MeshToonNodeMaterial {
  declare emissiveNode: N;

  constructor(p: ToonParams = {}) {
    const { roughness, metalness, flatShading, gloss, rim, ...rest } = p;
    super(rest as N);
    this.gradientMap = gradientMap();
    const g = gloss ?? (roughness !== undefined ? clampGloss(roughness, metalness ?? 0) : 0);
    const r = rim ?? 0.22;
    const V: N = normalize((cameraPosition as N).sub(positionWorld as N));
    const Nw: N = normalize(normalWorld as N);
    const nv: N = saturate(dot(Nw, V));
    // soft rim, strongest on the sunward side, in the sky/sun tint
    const rimTerm: N = pow(float(1).sub(nv), 2.6).mul(smoothstep(-0.3, 0.7, dot(Nw, shared.sunDir as N)));
    let e: N = (shared.sunColor as N).mul(0.6).add(0.4).mul(rimTerm).mul(r);
    if (g > 0) {
      // hard cartoon glint
      const R: N = reflect((shared.sunDir as N).negate(), Nw);
      const spec: N = smoothstep(0.972, 0.982, saturate(dot(R, V)));
      e = e.add(vec3(1.0).mul(spec).mul(g));
    }
    this.emissiveNode = e;
    void flatShading;
  }
}

function clampGloss(roughness: number, metalness: number): number {
  const g = (1 - Math.min(1, roughness * 1.6)) * (0.55 + 0.45 * metalness);
  return Math.max(0, Math.min(1, g));
}

/** Soft-edged quantiser: `n` flat levels joined by narrow smooth steps of half-width `w` (0..0.5). */
export const toonQ: (x: N, n: N, w: N) => N = Fn(([x, n, w]: N[]) => {
  const sx = x.mul(n);
  return floor(sx)
    .add(smoothstep(float(0.5).sub(w), float(0.5).add(w), fract(sx)))
    .div(n);
}) as (x: N, n: N, w: N) => N;
