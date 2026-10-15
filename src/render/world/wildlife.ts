// Life over the water: gulls that circle and shadow the player's boat, strings of pelicans gliding low
// over the chop, and the kites that Haulover Beach Park is famous for. Birds are instanced with a
// vertex-shader wing flap; everything is simulated on the CPU (a few dozen actors).

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
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Line,
  LineBasicNodeMaterial,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { clamp, Rng } from '../../core/math';
import { bayX, beachX, landSDF, seabedHeight } from '../../sim/geography';
import { shared } from '../shared';
import { ToonMaterial } from '../toon';

type N = any;

// ---------------------------------------------------------------------------------------------------
// bird geometry
// ---------------------------------------------------------------------------------------------------

interface BirdStyle {
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

const GULL: BirdStyle = {
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

const PELICAN: BirdStyle = {
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
function buildBird(s: BirdStyle): BufferGeometry {
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

function flapMaterial(flap: InstancedBufferAttribute): ToonMaterial {
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

// ---------------------------------------------------------------------------------------------------
// actors
// ---------------------------------------------------------------------------------------------------

interface Gull {
  escort: boolean;
  cx: number;
  cz: number;
  r: number;
  ang: number;
  dir: number;
  alt: number;
  speed: number;
  seed: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  pitch: number;
  amp: number;
  rate: number;
}

interface Pelican {
  /** Formation: leader index and local offset. */
  lead: number;
  ox: number;
  oz: number;
  seed: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  pitch: number;
  amp: number;
}

interface PelicanGroup {
  x: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  seed: number;
}

interface Kite {
  ax: number;
  az: number;
  ay: number;
  len: number;
  el: number;
  azJit: number;
  seed: number;
  size: number;
  group: Group;
  tail: Mesh;
  tailPos: Float32Array;
  line: Line;
  linePos: Float32Array;
}

const TMP = {
  q: new Quaternion(),
  e: new Euler(0, 0, 0, 'YXZ'),
  m: new Matrix4(),
  p: new Vector3(),
  s: new Vector3(),
};

export interface WildlifeInput {
  /** Player boat. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Visibility of birdlife (0 in storms / at night). */
  fair: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  waveHeight: (x: number, z: number) => number;
}

export class Wildlife {
  readonly group = new Group();
  private readonly rng = new Rng(2121);
  private readonly gulls: Gull[] = [];
  private readonly pelicans: Pelican[] = [];
  private readonly groups: PelicanGroup[] = [];
  private readonly kites: Kite[] = [];
  private readonly gullMesh: InstancedMesh;
  private readonly pelMesh: InstancedMesh;
  private readonly gullFlap: InstancedBufferAttribute;
  private readonly pelFlap: InstancedBufferAttribute;
  private t = 0;
  private placed = false;

  constructor(quality: 'low' | 'medium' | 'high' = 'high') {
    this.group.name = 'wildlife';
    const k = quality === 'low' ? 0.5 : 1;
    const nGull = Math.round(26 * k);
    const nPelGroups = quality === 'low' ? 1 : 2;

    this.gullFlap = new InstancedBufferAttribute(new Float32Array(nGull * 4), 4);
    this.gullFlap.setUsage(DynamicDrawUsage);
    const gg = buildBird(GULL);
    gg.setAttribute('aFlap', this.gullFlap);
    this.gullMesh = new InstancedMesh(gg, flapMaterial(this.gullFlap), nGull);
    this.gullMesh.frustumCulled = false;
    this.gullMesh.count = 0;
    this.gullMesh.name = 'gulls';

    const nPel = nPelGroups * 5;
    this.pelFlap = new InstancedBufferAttribute(new Float32Array(nPel * 4), 4);
    this.pelFlap.setUsage(DynamicDrawUsage);
    const pg = buildBird(PELICAN);
    pg.setAttribute('aFlap', this.pelFlap);
    this.pelMesh = new InstancedMesh(pg, flapMaterial(this.pelFlap), nPel);
    this.pelMesh.frustumCulled = false;
    this.pelMesh.count = 0;
    this.pelMesh.name = 'pelicans';
    this.group.add(this.gullMesh, this.pelMesh);

    const r = this.rng;
    for (let i = 0; i < nGull; i++) {
      this.gulls.push({
        escort: i < Math.round(8 * k),
        cx: 0,
        cz: 0,
        r: 0,
        ang: r.next() * 6.283,
        dir: r.next() < 0.5 ? -1 : 1,
        alt: 0,
        speed: 0,
        seed: r.next() * 100,
        x: 0,
        y: 0,
        z: 0,
        heading: 0,
        bank: 0,
        pitch: 0,
        amp: 0.1,
        rate: 11 + r.next() * 3,
      });
    }
    for (let g = 0; g < nPelGroups; g++) {
      this.groups.push({ x: 0, z: 0, heading: 0, speed: 9 + r.next() * 3, turn: 0, seed: r.next() * 50 });
      // a staggered V: leader plus two pairs trailing
      const offs = [
        [0, 0],
        [-3.2, -2.6],
        [-3.2, 2.6],
        [-6.4, -5.2],
        [-6.4, 5.2],
      ] as const;
      for (const [ox, oz] of offs) {
        this.pelicans.push({
          lead: g,
          ox,
          oz,
          seed: r.next() * 10,
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
          bank: 0,
          pitch: 0,
          amp: 0,
        });
      }
    }
    this.buildKites(quality);
  }

  // ------------------------------------------------------------------------------------------------
  // kites
  // ------------------------------------------------------------------------------------------------

  private buildKites(quality: 'low' | 'medium' | 'high'): void {
    const n = quality === 'low' ? 5 : 11;
    const r = new Rng(5150);
    const palette = ['#ff8fa8', '#ffd36e', '#7fe3d0', '#9fb4ff', '#ffa56e', '#c59bff', '#ff7f7f', '#8be0ff'];
    // diamond kite, plane normal along +z
    const kg = new BufferGeometry();
    kg.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          0, 1.1, 0, -0.62, 0.2, 0, 0, -0.9, 0, 0.62, 0.2, 0, 0, 1.1, 0, 0.62, 0.2, 0, 0, -0.9, 0, -0.62, 0.2,
          0,
        ]),
        3,
      ),
    );
    kg.setIndex([0, 1, 2, 0, 2, 3]);
    kg.computeVertexNormals();
    let tries = 0;
    while (this.kites.length < n && tries++ < 500) {
      const z = 150 + r.next() * 700;
      const x = bayX(z) + 40 + r.next() * Math.max(10, beachX(z) - bayX(z) - 120);
      if (landSDF(x, z) > -30 || seabedHeight(x, z) < 0.7) continue;
      const c = palette[this.kites.length % palette.length] as string;
      const mat = new MeshBasicNodeMaterial({ color: new Color(c), side: DoubleSide });
      const body = new Mesh(kg, mat);
      // cross-spar accent
      const spar = new Mesh(
        kg,
        new MeshBasicNodeMaterial({
          color: new Color('#ffffff'),
          side: DoubleSide,
          opacity: 0.55,
          transparent: true,
        }),
      );
      spar.scale.set(0.34, 0.34, 1);
      spar.position.z = 0.01;
      const group = new Group();
      group.add(body, spar);
      const size = 4.2 + r.next() * 2.4;
      group.scale.setScalar(size);
      // ribbon tail: 12 nodes, 2 verts each, rainbow vertex colours
      const nodes = 12;
      const tailPos = new Float32Array(nodes * 2 * 3);
      const tailCol = new Float32Array(nodes * 2 * 3);
      const idx: number[] = [];
      for (let i = 0; i < nodes; i++) {
        const k = new Color(palette[(i + this.kites.length) % palette.length] as string);
        for (let s = 0; s < 2; s++) tailCol.set([k.r, k.g, k.b], (i * 2 + s) * 3);
        if (i < nodes - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const tg = new BufferGeometry();
      const tp = new BufferAttribute(tailPos, 3);
      tp.setUsage(DynamicDrawUsage);
      tg.setAttribute('position', tp);
      tg.setAttribute('color', new BufferAttribute(tailCol, 3));
      tg.setIndex(idx);
      const tail = new Mesh(tg, new MeshBasicNodeMaterial({ vertexColors: true, side: DoubleSide }));
      tail.frustumCulled = false;
      // string
      const segs = 14;
      const linePos = new Float32Array((segs + 1) * 3);
      const lg = new BufferGeometry();
      const lp = new BufferAttribute(linePos, 3);
      lp.setUsage(DynamicDrawUsage);
      lg.setAttribute('position', lp);
      const lm = new LineBasicNodeMaterial({ color: new Color('#ffffff'), transparent: true, opacity: 0.55 });
      lm.depthWrite = false;
      const line = new Line(lg, lm);
      line.frustumCulled = false;
      group.frustumCulled = false;
      body.frustumCulled = false;
      spar.frustumCulled = false;
      this.group.add(group, tail, line);
      this.kites.push({
        ax: x,
        az: z,
        ay: seabedHeight(x, z) + 1.6,
        len: 90 + r.next() * 70,
        el: 0.95 + r.next() * 0.3,
        azJit: 0.18 + r.next() * 0.2,
        seed: r.next() * 100,
        size,
        group,
        tail,
        tailPos,
        line,
        linePos,
      });
    }
  }

  private updateKites(wx: number, wz: number, ws: number): void {
    const t = this.t;
    const len = Math.hypot(wx, wz) || 1;
    const dx = wx / len;
    const dz = wz / len;
    const strong = clamp(ws / 8, 0.3, 1.3);
    const side = new Vector3();
    const up = new Vector3();
    const s = new Vector3();
    const a = new Vector3();
    const k3 = new Vector3();
    const basis = new Matrix4();
    for (const k of this.kites) {
      // kites ride downwind of their holder, darting a little
      const az =
        Math.atan2(dz, dx) + Math.sin(t * 0.4 + k.seed) * k.azJit + Math.sin(t * 1.3 + k.seed * 2) * 0.05;
      const el = clamp(k.el + Math.sin(t * 0.33 + k.seed * 1.7) * 0.07 - (strong - 1) * 0.12, 0.55, 1.35);
      const L = k.len;
      a.set(k.ax, k.ay, k.az);
      k3.set(
        a.x + Math.cos(az) * Math.cos(el) * L,
        a.y + Math.sin(el) * L,
        a.z + Math.sin(az) * Math.cos(el) * L,
      );
      s.copy(k3).sub(a).normalize();
      // basis: z = toward the holder (kite plane normal), y = up projected off z
      const nrm = s.clone().negate();
      up.set(0, 1, 0).addScaledVector(nrm, -nrm.y).normalize();
      // wobble roll
      const roll = Math.sin(t * 1.7 + k.seed) * 0.28;
      side.crossVectors(up, nrm).normalize();
      up.applyAxisAngle(nrm, roll);
      side.crossVectors(up, nrm).normalize();
      basis.makeBasis(side, up, nrm);
      k.group.quaternion.setFromRotationMatrix(basis);
      k.group.position.copy(k3);
      // tail streams downwind and below
      const tp = k.tailPos;
      const hw = 0.22 * k.size * 0.5;
      const base = k3.clone().addScaledVector(up, -0.9 * k.size);
      for (let i = 0; i < 12; i++) {
        const f = i / 11;
        const drop = i * 0.55 * k.size * 0.5;
        const wave = Math.sin(t * 5 + i * 0.9 + k.seed) * (0.15 + f * 0.9) * (0.4 + strong * 0.4);
        const wave2 = Math.cos(t * 4.2 + i * 0.8 + k.seed) * (0.1 + f * 0.6);
        const x = base.x + dx * i * 0.42 * strong + side.x * wave + up.x * -drop * 0.7;
        const y = base.y - drop * 0.85 + wave2 * 0.3;
        const z = base.z + dz * i * 0.42 * strong + side.z * wave + up.z * -drop * 0.7;
        const o = i * 6;
        tp[o] = x - side.x * hw;
        tp[o + 1] = y;
        tp[o + 2] = z - side.z * hw;
        tp[o + 3] = x + side.x * hw;
        tp[o + 4] = y;
        tp[o + 5] = z + side.z * hw;
      }
      (k.tail.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      // string with a gentle sag
      const lp = k.linePos;
      for (let i = 0; i <= 14; i++) {
        const f = i / 14;
        const sag = Math.sin(f * Math.PI) * L * 0.012;
        lp[i * 3] = a.x + (k3.x - a.x) * f;
        lp[i * 3 + 1] = a.y + (k3.y - a.y) * f - sag;
        lp[i * 3 + 2] = a.z + (k3.z - a.z) * f;
      }
      (k.line.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------------------------------------
  // birds
  // ------------------------------------------------------------------------------------------------

  private placeGull(g: Gull, px: number, pz: number, vx: number, vz: number): void {
    const r = this.rng;
    const sp = Math.hypot(vx, vz);
    if (g.escort) {
      // ahead of the boat, so they swing in as you approach
      const a = (sp > 1 ? Math.atan2(vz, vx) : r.next() * 6.283) + (r.next() - 0.5) * 1.2;
      const d = 90 + r.next() * 260;
      g.cx = px + Math.cos(a) * d;
      g.cz = pz + Math.sin(a) * d;
      g.r = 9 + r.next() * 20;
      g.alt = 7 + r.next() * 16;
      g.speed = 7 + r.next() * 3;
    } else {
      const a = r.next() * 6.283;
      const d = 150 + r.next() * 650;
      g.cx = px + Math.cos(a) * d;
      g.cz = pz + Math.sin(a) * d;
      g.r = 35 + r.next() * 110;
      g.alt = 14 + r.next() * 38;
      g.speed = 6 + r.next() * 3;
    }
    g.ang = r.next() * 6.283;
  }

  private updateGulls(dt: number, inp: WildlifeInput): void {
    const t = this.t;
    const cnt = Math.ceil(this.gulls.length * inp.fair);
    this.gullMesh.count = cnt;
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i] as Gull;
      if (!this.placed) this.placeGull(g, inp.x, inp.z, inp.vx, inp.vz);
      // escorts drift their circle toward the boat (but can't keep up with a fast one)
      if (g.escort) {
        const tx = inp.x + inp.vx * 0.8;
        const tz = inp.z + inp.vz * 0.8;
        const dx = tx - g.cx;
        const dz = tz - g.cz;
        const dist = Math.hypot(dx, dz);
        const maxStep = 13 * dt;
        const k = dist > 1e-3 ? Math.min(maxStep, dist * 0.6 * dt) / dist : 0;
        g.cx += dx * k;
        g.cz += dz * k;
        if (dist > 520) this.placeGull(g, inp.x, inp.z, inp.vx, inp.vz);
      } else if (Math.hypot(g.cx - inp.x, g.cz - inp.z) > 900)
        this.placeGull(g, inp.x, inp.z, inp.vx, inp.vz);
      const om = (g.speed / g.r) * g.dir;
      g.ang += om * dt;
      const wob = Math.sin(t * 0.7 + g.seed) * g.r * 0.12;
      const rr = g.r + wob;
      const nx = g.cx + Math.cos(g.ang) * rr;
      const nz = g.cz + Math.sin(g.ang) * rr;
      const ny = g.alt + Math.sin(t * 0.31 + g.seed * 1.3) * 3.5 + Math.sin(t * 1.9 + g.seed) * 0.4;
      if (g.y === 0) {
        g.x = nx;
        g.y = ny;
        g.z = nz;
      }
      const hx = nx - g.x;
      const hz = nz - g.z;
      if (hx * hx + hz * hz > 1e-8) g.heading = Math.atan2(hz, hx);
      const climb = (ny - g.y) / Math.max(dt, 1e-3);
      g.pitch += (clamp(climb / Math.max(g.speed, 1), -0.5, 0.5) - g.pitch) * Math.min(1, dt * 3);
      g.bank +=
        (-g.dir * clamp((g.speed * g.speed) / (9.81 * Math.max(g.r, 6)), 0, 0.6) - g.bank) *
        Math.min(1, dt * 2);
      g.x = nx;
      g.y = ny;
      g.z = nz;
      // soar mostly, with bursts of flapping
      const burst = clamp((Math.sin(t * 0.23 + g.seed * 3.1) - 0.35) * 2.2, 0, 1);
      g.amp += (0.12 + burst * 0.78 - g.amp) * Math.min(1, dt * 2);
      const scale = g.escort ? 0.85 : 0.8;
      this.writeBird(
        this.gullMesh,
        this.gullFlap,
        i,
        g.x,
        g.y,
        g.z,
        g.heading,
        g.bank,
        g.pitch,
        scale,
        g.seed,
        g.amp,
        g.rate,
      );
    }
    this.gullMesh.instanceMatrix.needsUpdate = true;
    this.gullFlap.needsUpdate = true;
  }

  private writeBird(
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

  private placeGroup(gr: PelicanGroup, inp: WildlifeInput): void {
    const r = this.rng;
    const a = r.next() * 6.283;
    const d = 380 + r.next() * 260;
    gr.x = inp.x + Math.cos(a) * d;
    gr.z = inp.z + Math.sin(a) * d;
    // cross the player's neighbourhood with some offset so they pass in view
    const tx = inp.x + (r.next() - 0.5) * 260;
    const tz = inp.z + (r.next() - 0.5) * 260;
    gr.heading = Math.atan2(tz - gr.z, tx - gr.x);
    gr.speed = 9 + r.next() * 3;
  }

  private updatePelicans(dt: number, inp: WildlifeInput): void {
    const t = this.t;
    const show = Math.ceil(this.pelicans.length * inp.fair);
    this.pelMesh.count = show;
    for (const [gi, gr] of this.groups.entries()) {
      if (!this.placed || Math.hypot(gr.x - inp.x, gr.z - inp.z) > 800) this.placeGroup(gr, inp);
      gr.turn += (Math.sin(t * 0.13 + gr.seed) * 0.05 - gr.turn) * Math.min(1, dt);
      gr.heading += gr.turn * dt;
      gr.x += Math.cos(gr.heading) * gr.speed * dt;
      gr.z += Math.sin(gr.heading) * gr.speed * dt;
      const ch = Math.cos(gr.heading);
      const sh = Math.sin(gr.heading);
      for (let j = 0; j < 5; j++) {
        const i = gi * 5 + j;
        const p = this.pelicans[i] as Pelican;
        const wx = gr.x + ch * p.ox - sh * p.oz;
        const wz = gr.z + sh * p.ox + ch * p.oz;
        // ground effect: skim 1.8–3.2 m above the chop
        const target = inp.waveHeight(wx, wz) + 2.4 + Math.sin(t * 0.5 + p.seed) * 0.7;
        if (p.y === 0) p.y = target;
        p.y += (target - p.y) * Math.min(1, dt * 2.5);
        const climb = (target - p.y) * 2;
        p.pitch += (clamp(climb / 9, -0.3, 0.3) - p.pitch) * Math.min(1, dt * 3);
        p.bank += (-gr.turn * 6 - p.bank) * Math.min(1, dt * 2);
        p.x = wx;
        p.z = wz;
        p.heading = gr.heading;
        // flap-flap-glide cycles, staggered down the line
        const cyc = Math.sin(t * 0.55 - j * 0.7 + p.seed);
        p.amp += (clamp((cyc + 0.15) * 1.6, 0, 1) * 0.85 - p.amp) * Math.min(1, dt * 4);
        this.writeBird(
          this.pelMesh,
          this.pelFlap,
          i,
          p.x,
          p.y,
          p.z,
          p.heading,
          p.bank,
          p.pitch,
          1.15,
          p.seed * 2.0,
          p.amp,
          6.2,
        );
      }
    }
    this.pelMesh.instanceMatrix.needsUpdate = true;
    this.pelFlap.needsUpdate = true;
  }

  update(dt: number, inp: WildlifeInput): void {
    this.t += dt;
    this.updateGulls(dt, inp);
    this.updatePelicans(dt, inp);
    this.updateKites(inp.windX, inp.windZ, inp.windSpeed);
    this.placed = true;
    // kites are tiny at night / in storms: hide them when it is dark or wild
    const showKites = inp.fair > 0.5;
    for (const k of this.kites) {
      k.group.visible = k.tail.visible = k.line.visible = showKites;
    }
  }
}
