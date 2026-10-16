// Shared bird meshes: a low-poly bird with a vertex-shader wing flap, drawn instanced. Haulover's gulls and
// pelicans and Montauk's working terns and gannets are all built from this.

import {
  abs,
  float,
  instancedDynamicBufferAttribute,
  positionGeometry,
  positionLocal,
  pow,
  sin,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { shared } from './shared';
import { ToonMaterial } from './toon';

type N = any;

// ---------------------------------------------------------------------------------------------------
// bird geometry
// ---------------------------------------------------------------------------------------------------

export interface BirdStyle {
  bodyLen: number;
  body: string;
  head: string;
  beak: string;
  beakLen: number;
  wing: string;
  tip: string;
  span: number;
  chord: number;
}

export const GULL: BirdStyle = {
  bodyLen: 0.95,
  body: '#fbfbf8',
  head: '#ffffff',
  beak: '#ffc25c',
  beakLen: 0.12,
  wing: '#c4cde0',
  tip: '#2f3347',
  span: 1.05,
  chord: 0.3,
};

export const PELICAN: BirdStyle = {
  bodyLen: 1.35,
  body: '#8f8279',
  head: '#f6efe0',
  beak: '#ffb27a',
  beakLen: 0.55,
  wing: '#6d6560',
  tip: '#2e2b2b',
  span: 1.55,
  chord: 0.42,
};

/** A low-poly bird: +x forward, +y up, wings along ±z. Colours are baked as vertex colours. */
export function buildBird(s: BirdStyle): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: number[], ca: Color, b: number[], cb: Color, c: number[], cc: Color) => {
    for (const [p, k] of [
      [a, ca],
      [b, cb],
      [c, cc],
    ] as [number[], Color][]) {
      pos.push(p[0] as number, p[1] as number, p[2] as number);
      col.push(k.r, k.g, k.b);
    }
  };
  const body = new Color(s.body);
  const head = new Color(s.head);
  const beak = new Color(s.beak);
  const wing = new Color(s.wing);
  const tip = new Color(s.tip);
  const L = s.bodyLen;
  // spindle body
  const nose = [L * 0.5, 0.02, 0];
  const tail = [-L * 0.5, 0.0, 0];
  const top = [L * 0.1, L * 0.12, 0];
  const bot = [L * 0.05, -L * 0.1, 0];
  const lf = [L * 0.05, 0.0, -L * 0.1];
  const rt = [L * 0.05, 0.0, L * 0.1];
  for (const [a, b, ca, cb] of [
    [lf, top, body, body],
    [top, rt, body, body],
    [rt, bot, body, body],
    [bot, lf, body, body],
  ] as [number[], number[], Color, Color][]) {
    tri(nose, head, a, ca, b, cb);
    tri(tail, body, b, cb, a, ca);
  }
  // beak
  const bk = L * 0.5 + s.beakLen;
  tri([L * 0.46, 0.05, -0.05], head, [L * 0.46, 0.05, 0.05], head, [bk, 0.0, 0], beak);
  tri([L * 0.46, 0.05, -0.05], beak, [bk, 0.0, 0], beak, [L * 0.46, -0.03, 0], beak);
  // tail fan
  tri([-L * 0.45, 0.01, 0], body, [-L * 0.72, 0.0, -0.17], body, [-L * 0.72, 0.0, 0.17], body);
  // wings: two panels per side, the outer one swept back and dark-tipped
  const c = s.chord;
  for (const sd of [-1, 1]) {
    const r0f = [L * 0.12, 0.03, 0.06 * sd];
    const r0b = [-L * 0.2, 0.0, 0.06 * sd];
    const m1f = [L * 0.08, 0.04, s.span * 0.52 * sd];
    const m1b = [-L * 0.1 - c * 0.4, 0.0, s.span * 0.5 * sd];
    const tipF = [-L * 0.02, 0.05, s.span * 1.0 * sd];
    const tipB = [-L * 0.3 - c * 0.5, 0.02, s.span * 0.96 * sd];
    const flip = sd < 0;
    const quad = (
      a: number[],
      ca: Color,
      b: number[],
      cb: Color,
      d: number[],
      cd: Color,
      e: number[],
      ce: Color,
    ) => {
      if (flip) {
        tri(a, ca, d, cd, b, cb);
        tri(b, cb, d, cd, e, ce);
      } else {
        tri(a, ca, b, cb, d, cd);
        tri(b, cb, e, ce, d, cd);
      }
    };
    quad(r0f, wing, r0b, wing, m1f, wing, m1b, wing);
    quad(m1f, wing, m1b, wing, tipF, tip, tipB, tip);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

export function flapMaterial(flap: InstancedBufferAttribute): ToonMaterial {
  const m = new ToonMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: DoubleSide,
  });
  const fl: N = instancedDynamicBufferAttribute(flap);
  // fl = (phase, flap amplitude 0..1, rate rad/s, instance scale)
  const z: N = abs(positionGeometry.z as N);
  const wave: N = sin((shared.time as N).mul(fl.z).add(fl.x));
  const lift: N = wave.mul(pow(z, 1.35)).mul(fl.y).mul(fl.w).mul(0.55);
  // gliding wings arch gently upward; flapping ones follow the stroke
  const arch: N = z
    .mul(z)
    .mul(fl.w)
    .mul(0.08)
    .mul(float(1).sub((fl.y as N).mul(0.7)));
  m.positionNode = (positionLocal as N).add(vec3(0.0, lift.add(arch), 0.0)) as N;
  return m;
}

/** A tern: small, bright white, black-tipped, quick. */
export const TERN: BirdStyle = {
  bodyLen: 0.62,
  body: '#fdfdfb',
  head: '#ffffff',
  beak: '#ff9a6b',
  beakLen: 0.1,
  wing: '#e3e9f4',
  tip: '#30354e',
  span: 0.78,
  chord: 0.2,
};

/** A gannet: big, white, with a buttery head and black wingtips; it folds and plunges. */
export const GANNET: BirdStyle = {
  bodyLen: 1.5,
  body: '#fffefa',
  head: '#ffe6a0',
  beak: '#b9c2d6',
  beakLen: 0.32,
  wing: '#f3f4f9',
  tip: '#262a3e',
  span: 1.8,
  chord: 0.34,
};

const TMP = {
  q: new Quaternion(),
  e: new Euler(0, 0, 0, 'YXZ'),
  m: new Matrix4(),
  p: new Vector3(),
  s: new Vector3(),
};

/** Pose bird `i` of an instanced flock. `phase`, `amp` and `rate` drive the wing flap in the shader. */
export function writeBird(
  mesh: InstancedMesh,
  flap: InstancedBufferAttribute,
  i: number,
  x: number,
  y: number,
  z: number,
  heading: number,
  bank: number,
  pitch: number,
  scale: number,
  phase: number,
  amp: number,
  rate: number,
): void {
  TMP.e.set(bank, -heading, pitch, 'YXZ');
  TMP.q.setFromEuler(TMP.e);
  TMP.p.set(x, y, z);
  TMP.s.setScalar(scale);
  mesh.setMatrixAt(i, TMP.m.compose(TMP.p, TMP.q, TMP.s));
  flap.setXYZW(i, phase, amp, rate, scale);
}

/** One instanced flock: `count` birds sharing a mesh, a style and a flap attribute. */
export class BirdFlock {
  readonly mesh: InstancedMesh;
  readonly flap: InstancedBufferAttribute;

  constructor(style: BirdStyle, capacity: number, name: string) {
    this.flap = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.flap.setUsage(DynamicDrawUsage);
    const geo = buildBird(style);
    geo.setAttribute('aFlap', this.flap);
    this.mesh = new InstancedMesh(geo, flapMaterial(this.flap), capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = name;
  }

  set(
    i: number,
    x: number,
    y: number,
    z: number,
    heading: number,
    bank: number,
    pitch: number,
    scale: number,
    phase: number,
    amp: number,
    rate: number,
  ): void {
    writeBird(this.mesh, this.flap, i, x, y, z, heading, bank, pitch, scale, phase, amp, rate);
  }

  commit(count: number): void {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}
