// What Montauk puts on the water: terns and gannets working the bait, boils and slicks, the rods, the lines
// and the lures, the tuna on the end of the line, and the beacons over the spots you marked. Everything
// reads the mode's state each frame; nothing here decides anything.

import {
  float,
  instancedDynamicBufferAttribute,
  length,
  mix,
  normalView,
  positionLocal,
  smoothstep,
  step,
  uv,
  vec3,
} from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { clamp, KNOTS, lerp, Rng, smoothstep as sstep } from '../../core/math';
import type { Game } from '../../game/game';
import { BirdFlock, GANNET, TERN } from '../../render/birds';
import { gel, matte } from '../../render/boats/materials';
import { ToonMaterial } from '../../render/toon';
import type { Fight } from '../../sim/fishing/fight';
import type { Rod } from '../../sim/fishing/tackle';
import type { FishMode } from './mode';
import { rodPoints, transom } from './rig';

type N = any;

// ---------------------------------------------------------------------------------------------------
// foam rings, boils and slicks: flat decals on the water
// ---------------------------------------------------------------------------------------------------

const RING_MAX = 220;
const SLICK_SLOTS = 12;

const PLUME_MAX = 60;

class Rings {
  readonly mesh: InstancedMesh;
  /** White spray columns thrown up by boils and dives: they show from a long way off. */
  readonly plumes: InstancedMesh;
  private readonly pAnim: InstancedBufferAttribute;
  private readonly plume: { x: number; z: number; size: number; age: number; life: number }[] = [];
  private pNext = 0;
  private readonly anim: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly ring: {
    x: number;
    z: number;
    size: number;
    age: number;
    life: number;
    kind: number;
    seed: number;
  }[] = [];
  private next = SLICK_SLOTS;
  private slicks = 0;

  constructor() {
    const geo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.anim = new InstancedBufferAttribute(new Float32Array(RING_MAX * 4), 4);
    this.anim.setUsage(DynamicDrawUsage);
    geo.setAttribute('aAnim', this.anim);
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    const a: N = instancedDynamicBufferAttribute(this.anim);
    const p: N = uv().mul(2).sub(1);
    const r: N = length(p);
    const age: N = a.x;
    const kind: N = a.y;
    const alpha: N = a.z;
    // 0: a splash ring that opens out, with a patch of white water inside it
    const ringA: N = float(1)
      .sub(smoothstep(0, 0.16, r.sub(age.mul(0.9).add(0.08)).abs()))
      .mul(float(1).sub(age));
    const foam: N = float(1)
      .sub(smoothstep(0.2, 0.9, r))
      .mul(float(1).sub(age))
      .mul(0.55);
    const splash: N = ringA.mul(0.8).add(foam).min(0.95);
    // 1: a slick, a pale glassy disc with a soft edge and a slow shimmer
    const slick: N = float(1)
      .sub(smoothstep(0.55, 1, r))
      .mul(0.26)
      .mul(float(0.85).add(r.mul(7).sub(a.w.mul(5)).sin().mul(0.15)));
    mat.opacityNode = mix(splash, slick, step(0.5, kind)).mul(alpha) as N;
    mat.colorNode = mix(vec3(1, 0.99, 0.97), vec3(0.86, 0.95, 0.97), step(0.5, kind)) as N;
    this.mesh = new InstancedMesh(geo, mat, RING_MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    for (let i = 0; i < RING_MAX; i++)
      this.ring.push({ x: 0, z: 0, size: 0, age: 1, life: 1, kind: 0, seed: i * 0.37 });

    // a soft white column: an upright ellipsoid whose silhouette fades, so it reads as spray and not a solid
    const cone = new SphereGeometry(1, 14, 10);
    this.pAnim = new InstancedBufferAttribute(new Float32Array(PLUME_MAX * 2), 2);
    this.pAnim.setUsage(DynamicDrawUsage);
    cone.setAttribute('aPlume', this.pAnim);
    const pm = new MeshBasicNodeMaterial();
    pm.transparent = true;
    pm.depthWrite = false;
    pm.side = DoubleSide;
    const pa: N = instancedDynamicBufferAttribute(this.pAnim);
    const facing: N = (normalView.z as N).abs().pow(0.55);
    const base: N = smoothstep(-0.95, -0.1, positionLocal.y as N);
    pm.colorNode = vec3(1, 0.985, 0.975) as N;
    pm.opacityNode = float(1).sub(pa.x).pow(1.3).mul(0.9).mul(facing).mul(base) as N;
    this.plumes = new InstancedMesh(cone, pm, PLUME_MAX);
    this.plumes.frustumCulled = false;
    this.plumes.count = 0;
    this.plumes.renderOrder = 3;
    for (let i = 0; i < PLUME_MAX; i++) this.plume.push({ x: 0, z: 0, size: 0, age: 1, life: 1 });
  }

  /** A column of spray: `size` is its base radius. */
  spray(x: number, z: number, size: number, life = 0.8): void {
    const q = this.plume[this.pNext] as (typeof this.plume)[number];
    q.x = x;
    q.z = z;
    q.size = size;
    q.age = 0;
    q.life = life;
    this.pNext = (this.pNext + 1) % PLUME_MAX;
  }

  /** A splash ring that lives `life` seconds. */
  splash(x: number, z: number, size: number, life = 1.1): void {
    const r = this.ring[this.next] as (typeof this.ring)[number];
    r.x = x;
    r.z = z;
    r.size = size;
    r.age = 0;
    r.life = life;
    r.kind = 0;
    this.next++;
    if (this.next >= RING_MAX) this.next = SLICK_SLOTS;
  }

  /** Reserve slick slots for this frame's slicks. */
  beginSlicks(): void {
    this.slicks = 0;
  }

  slick(x: number, z: number, size: number, strength: number): void {
    if (this.slicks >= SLICK_SLOTS) return;
    const r = this.ring[this.slicks++] as (typeof this.ring)[number];
    r.x = x;
    r.z = z;
    r.size = size;
    r.age = strength;
    r.life = 1e9;
    r.kind = 1;
  }

  update(dt: number, time: number, height: (x: number, z: number) => number): void {
    let n = 0;
    for (let i = 0; i < RING_MAX; i++) {
      const r = this.ring[i] as (typeof this.ring)[number];
      const isSlick = i < SLICK_SLOTS;
      if (isSlick) {
        if (i >= this.slicks) {
          r.kind = -1;
          continue;
        }
      } else {
        if (r.age >= 1) continue;
        r.age += dt / r.life;
        if (r.age >= 1) continue;
      }
      const y = height(r.x, r.z) + (isSlick ? 0.06 : 0.1);
      this.p.set(r.x, y, r.z);
      this.s.set(r.size, 1, r.size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      // slicks carry their strength in `age` slot and never age
      this.anim.setXYZW(n, isSlick ? 0 : r.age, r.kind, isSlick ? r.age : 1, time + r.seed);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;

    let k = 0;
    for (const q of this.plume) {
      if (q.age >= 1) continue;
      q.age += dt / q.life;
      if (q.age >= 1) continue;
      const grow = 0.55 + 0.8 * Math.sqrt(q.age);
      const rise = Math.sin(Math.min(1, q.age * 1.7) * Math.PI * 0.5);
      const tall = q.size * 2.4 * rise + 0.2;
      this.p.set(q.x, height(q.x, q.z) + tall * 0.35, q.z);
      this.s.set(q.size * grow, tall, q.size * grow);
      this.m.compose(this.p, this.q, this.s);
      this.plumes.setMatrixAt(k, this.m);
      this.pAnim.setXY(k, q.age, 1);
      k++;
    }
    this.plumes.count = k;
    this.plumes.instanceMatrix.needsUpdate = true;
    this.pAnim.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------
// camera-facing ribbons for the lines
// ---------------------------------------------------------------------------------------------------

class Ribbon {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly geo = new BufferGeometry();
  private readonly n: number;
  private readonly cam = new Vector3();
  private readonly a = new Vector3();
  private readonly d = new Vector3();
  private readonly v = new Vector3();

  constructor(
    n: number,
    private readonly width: number,
    color: string,
    opacity: number,
  ) {
    this.n = n;
    this.pos = new Float32Array(n * 2 * 3);
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geo.setIndex(idx);
    const mat = new MeshBasicNodeMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      side: DoubleSide,
    });
    mat.depthWrite = false;
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
  }

  /** Lay the ribbon along `pts` (n points), facing the camera. */
  set(pts: Vector3[], camera: Vector3): void {
    this.cam.copy(camera);
    const hw = this.width * 0.5;
    for (let i = 0; i < this.n; i++) {
      const p = pts[i] as Vector3;
      const q = pts[Math.min(this.n - 1, i + 1)] as Vector3;
      const o = pts[Math.max(0, i - 1)] as Vector3;
      this.d.copy(q).sub(o);
      this.v.copy(p).sub(this.cam);
      this.a.crossVectors(this.d, this.v);
      const l = this.a.length();
      if (l < 1e-6) this.a.set(0, 1, 0);
      else this.a.multiplyScalar(hw / l);
      // wider as it gets further away so a line stays visible at a cast
      const dist = this.v.length();
      const k = 1 + clamp(dist / 110, 0, 2.5);
      this.a.multiplyScalar(k);
      this.pos.set(
        [p.x - this.a.x, p.y - this.a.y, p.z - this.a.z, p.x + this.a.x, p.y + this.a.y, p.z + this.a.z],
        i * 6,
      );
    }
    (this.geo.attributes.position as BufferAttribute).needsUpdate = true;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------------------------------
// the tuna
// ---------------------------------------------------------------------------------------------------

/** A stylised tuna, +x forward, ~1 unit long: a torpedo with a sickle tail, finlets and a bright stripe. */
function buildTuna(back: string, belly: string, finlet: string): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const cBack = new Color(back);
  const cBelly = new Color(belly);
  const cFin = new Color(finlet);
  const cTail = new Color(back).lerp(new Color('#ffffff'), 0.25);
  const rings = 14;
  const seg = 10;
  const profile = (u: number): number => Math.sin(Math.PI * clamp(u, 0, 1) ** 0.72) * (1 - 0.25 * u) * 0.135;
  const ringAt = (i: number, j: number): [number, number, number, Color] => {
    const u = i / rings;
    const x = 0.5 - u * 0.9;
    const r = profile(u);
    const a = (j / seg) * Math.PI * 2;
    const y = Math.sin(a) * r * 1.05;
    const z = Math.cos(a) * r * 0.82;
    const c = new Color().copy(cBack).lerp(cBelly, clamp(0.5 - Math.sin(a) * 0.75, 0, 1));
    return [x, y, z, c];
  };
  const tri = (
    a: [number, number, number, Color],
    b: [number, number, number, Color],
    c: [number, number, number, Color],
  ) => {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      col.push(v[3].r, v[3].g, v[3].b);
    }
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = ringAt(i, j);
      const b = ringAt(i, j + 1);
      const c = ringAt(i + 1, j);
      const d = ringAt(i + 1, j + 1);
      tri(a, c, b);
      tri(b, c, d);
    }
  }
  const P = (x: number, y: number, z: number, c: Color): [number, number, number, Color] => [x, y, z, c];
  // sickle tail
  const tx = -0.4;
  tri(P(tx, 0, 0, cTail), P(tx - 0.16, 0.2, 0.0, cTail), P(tx - 0.1, 0.02, 0.0, cTail));
  tri(P(tx, 0, 0, cTail), P(tx - 0.1, -0.02, 0.0, cTail), P(tx - 0.16, -0.2, 0.0, cTail));
  tri(P(tx, 0, 0, cTail), P(tx - 0.1, 0.02, 0.0, cTail), P(tx - 0.16, 0.2, 0.0, cTail));
  tri(P(tx, 0, 0, cTail), P(tx - 0.16, -0.2, 0.0, cTail), P(tx - 0.1, -0.02, 0.0, cTail));
  // dorsal and pectoral fins
  tri(P(0.18, 0.1, 0, cBack), P(0.02, 0.1, 0, cBack), P(0.08, 0.26, 0, cFin));
  tri(P(0.02, 0.1, 0, cBack), P(0.18, 0.1, 0, cBack), P(0.08, 0.26, 0, cFin));
  for (const s of [-1, 1]) {
    tri(P(0.2, -0.04, 0.09 * s, cBack), P(0.1, -0.05, 0.09 * s, cBack), P(0.12, -0.14, 0.2 * s, cBelly));
    tri(P(0.1, -0.05, 0.09 * s, cBack), P(0.2, -0.04, 0.09 * s, cBack), P(0.12, -0.14, 0.2 * s, cBelly));
  }
  // yellow finlets along the back and belly
  for (let k = 0; k < 6; k++) {
    const x = -0.16 - k * 0.04;
    tri(P(x, 0.055, 0, cFin), P(x - 0.03, 0.055, 0, cFin), P(x - 0.015, 0.1, 0, cFin));
    tri(P(x - 0.03, 0.055, 0, cFin), P(x, 0.055, 0, cFin), P(x - 0.015, 0.1, 0, cFin));
    tri(P(x, -0.055, 0, cFin), P(x - 0.03, -0.055, 0, cFin), P(x - 0.015, -0.1, 0, cFin));
    tri(P(x - 0.03, -0.055, 0, cFin), P(x, -0.055, 0, cFin), P(x - 0.015, -0.1, 0, cFin));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------
// working birds
// ---------------------------------------------------------------------------------------------------

interface WorkBird {
  school: number;
  gannet: boolean;
  slot: number;
  ang: number;
  dir: number;
  rad: number;
  alt: number;
  speed: number;
  phase: number;
  /** 0 = circling, then 0..1 through a dive. */
  dive: number;
  next: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  pitch: number;
}

// ---------------------------------------------------------------------------------------------------

const LURE_COLORS = ['#ff8f9d', '#7ff0cf', '#c3a2ff', '#ffd45e'];

export class FishVisuals {
  readonly group = new Group();
  private readonly rings = new Rings();
  private readonly terns = new BirdFlock(TERN, 90, 'terns');
  private readonly gannets = new BirdFlock(GANNET, 20, 'gannets');
  private readonly birds: WorkBird[] = [];
  private readonly rng = new Rng(777);
  private readonly rods: Mesh[] = [];
  private readonly lureMesh: Mesh[] = [];
  private readonly lineRibbon: Ribbon[] = [];
  private readonly fightAbove: Ribbon;
  private readonly fightBelow: Ribbon;
  private readonly tuna: Mesh;
  private readonly beacons: Mesh[] = [];
  private readonly knots: Mesh[] = [];
  private readonly butt = new Vector3();
  private readonly tip = new Vector3();
  private readonly cam = new Vector3();
  private readonly pts: Vector3[] = Array.from({ length: 14 }, () => new Vector3());
  private readonly pts2: Vector3[] = Array.from({ length: 14 }, () => new Vector3());
  private readonly up = new Vector3(0, 1, 0);
  private readonly q = new Quaternion();
  private readonly mid = new Vector3();
  private readonly dirV = new Vector3();
  private t = 0;
  private leap = -1;
  private leapH = 0;
  private fishY = -3;
  private lureFoam = [0, 0, 0, 0];
  private fishFoam = 0;
  private boilAcc = 0;
  private lastSpecies = '';

  constructor(
    private readonly host: Game,
    private readonly mode: FishMode,
  ) {
    this.group.name = 'fishing';
    this.group.add(this.rings.mesh, this.rings.plumes, this.terns.mesh, this.gannets.mesh);

    // birds: a pool of slots, handed to whichever schools are working
    for (let i = 0; i < 90; i++) this.birds.push(this.newBird(false, i));
    for (let i = 0; i < 20; i++) this.birds.push(this.newBird(true, i));

    // rods, lures, lines
    const rodMat = matte('#6a5f78', 0.5);
    for (const [i, c] of LURE_COLORS.entries()) {
      const rod = new Mesh(new CylinderGeometry(0.008, 0.026, 1, 6).translate(0, 0.5, 0), rodMat);
      rod.frustumCulled = false;
      rod.castShadow = true;
      this.rods.push(rod);
      const lure = new Mesh(
        new ConeGeometry(0.1, 0.42, 8).rotateX(Math.PI / 2).translate(0, 0, 0.1),
        gel(c, 0.35),
      );
      lure.add(new Mesh(new SphereGeometry(0.1, 8, 6).translate(0, 0, 0.32), matte('#fffaf0', 0.5)));
      lure.frustumCulled = false;
      lure.visible = false;
      this.lureMesh.push(lure);
      const rb = new Ribbon(14, 0.016, '#ffffff', 0.85);
      this.lineRibbon.push(rb);
      const knot = new Mesh(new SphereGeometry(0.5, 7, 5), matte('#ffd6e0', 0.9));
      knot.visible = false;
      knot.frustumCulled = false;
      this.knots.push(knot);
      this.group.add(rod, lure, rb.mesh, knot);
      void i;
    }
    this.fightAbove = new Ribbon(14, 0.024, '#ffffff', 0.92);
    this.fightBelow = new Ribbon(14, 0.04, '#cfe9ff', 0.3);
    this.group.add(this.fightAbove.mesh, this.fightBelow.mesh);

    // the fish
    this.tuna = new Mesh(
      buildTuna('#3f6fb8', '#f4f1e6', '#ffe45e'),
      new ToonMaterial({ vertexColors: true, gloss: 0.6, side: DoubleSide }),
    );
    this.tuna.visible = false;
    this.tuna.frustumCulled = false;
    this.group.add(this.tuna);

    // marker beacons: a tall translucent column and a pennant
    for (let i = 0; i < 5; i++) {
      const g = new Group();
      const mat = new MeshBasicNodeMaterial({ color: new Color('#ffd1e8'), transparent: true, opacity: 0.2 });
      mat.depthWrite = false;
      const col = new Mesh(new CylinderGeometry(0.25, 0.9, 60, 8, 1, true).translate(0, 30, 0), mat);
      const flag = new Mesh(new CylinderGeometry(0.06, 0.06, 6, 6).translate(0, 3, 0), matte('#fffaf0'));
      const pen = new Mesh(
        new PlaneGeometry(2.2, 1.2).translate(1.1, 5.4, 0),
        new MeshBasicNodeMaterial({ color: new Color('#ff8fb0'), side: DoubleSide }),
      );
      g.add(col, flag, pen);
      g.visible = false;
      g.traverse((o) => {
        o.frustumCulled = false;
      });
      this.beacons.push(g as unknown as Mesh);
      this.group.add(g);
    }
  }

  private newBird(gannet: boolean, slot: number): WorkBird {
    return {
      school: 0,
      gannet,
      slot,
      ang: 0,
      dir: 1,
      rad: 0,
      alt: 0,
      speed: 0,
      phase: slot * 1.7,
      dive: 0,
      next: 0,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      bank: 0,
      pitch: 0,
    };
  }

  reset(): void {
    for (const b of this.birds) b.school = 0;
    this.leap = -1;
  }

  // ---- events from the mode -------------------------------------------------------------------------

  onStrike(rod: Rod): void {
    this.rings.splash(rod.x, rod.z, 5, 1.2);
    this.rings.splash(rod.x, rod.z, 3, 0.8);
    this.startLeap(1.8);
  }

  onThrash(): void {
    const f = this.mode.fight;
    if (!f) return;
    this.startLeap(f.depth < 8 ? 1.2 + Math.random() * 1.2 : 0.4);
    this.rings.splash(f.x, f.z, 4 + Math.random() * 2, 1.0);
  }

  onLost(f: Fight): void {
    this.rings.splash(f.x, f.z, 6, 1.4);
    this.leap = -1;
    this.tuna.visible = false;
  }

  private startLeap(h: number): void {
    if (this.leap >= 0 && this.leap < 0.6) return;
    this.leap = 0;
    this.leapH = h;
  }

  // ---- per frame -----------------------------------------------------------------------------------------

  update(dt: number): void {
    const h = this.host;
    const env = h.env;
    this.t += dt;
    const height = (x: number, z: number): number => env.waves.height(x, z, env.time);
    this.cam.copy(h.rw.camera.position);
    const b = h.player;

    this.updateBirds(dt, height, b.pos.x, b.pos.z);
    this.updateSurface(dt, height);
    this.updateRig(dt, height);
    this.updateFish(dt, height);
    this.updateBeacons(height);
    this.rings.update(dt, this.t, height);
  }

  // ---- working birds, boils and slicks ----------------------------------------------------------------

  private updateBirds(dt: number, height: (x: number, z: number) => number, px: number, pz: number): void {
    const world = this.mode.world;
    const fair = clamp(1 - (this.host.rw.weather.cloudStorm * 1.1 + this.host.rw.weather.rain), 0, 1);
    // hand out slots
    const taken = new Set<number>();
    for (const bd of this.birds) if (bd.school !== 0) taken.add(bd.slot + (bd.gannet ? 1000 : 0));
    const want = new Map<number, number>();
    for (const s of world.schools) {
      if (Math.hypot(s.x - px, s.z - pz) > 3800) continue;
      want.set(s.id, Math.round(world.birdCount(s) * fair));
    }
    // free birds whose school is gone or quiet
    const have = new Map<number, number>();
    for (const bd of this.birds) {
      if (bd.school === 0) continue;
      const w = want.get(bd.school) ?? 0;
      const n = have.get(bd.school) ?? 0;
      if (n >= w) bd.school = 0;
      else have.set(bd.school, n + 1);
    }
    for (const s of world.schools) {
      const w = want.get(s.id) ?? 0;
      let n = have.get(s.id) ?? 0;
      for (const bd of this.birds) {
        if (n >= w) break;
        if (bd.school !== 0) continue;
        // one gannet to every five or so terns
        if (bd.gannet !== (n % 5 === 4)) continue;
        bd.school = s.id;
        bd.ang = this.rng.range(0, Math.PI * 2);
        bd.dir = this.rng.next() < 0.5 ? -1 : 1;
        bd.rad = s.radius * this.rng.range(0.35, 0.95);
        bd.alt = bd.gannet ? this.rng.range(18, 34) : this.rng.range(8, 22);
        bd.speed = bd.gannet ? this.rng.range(9, 12) : this.rng.range(7, 10);
        bd.dive = 0;
        bd.next = this.rng.range(0.2, 2);
        bd.y = 0;
        n++;
      }
      have.set(s.id, n);
    }

    // fly them
    let nt = 0;
    let ng = 0;
    for (const bd of this.birds) {
      if (bd.school === 0) continue;
      const s = world.schools.find((q) => q.id === bd.school);
      if (!s) {
        bd.school = 0;
        continue;
      }
      bd.ang += (bd.speed / Math.max(8, bd.rad)) * bd.dir * dt;
      const wob = Math.sin(this.t * 0.7 + bd.phase) * bd.rad * 0.12;
      const rr = bd.rad + wob;
      const nx = s.x + Math.cos(bd.ang) * rr;
      const nz = s.z + Math.sin(bd.ang) * rr;
      let ny = bd.alt + Math.sin(this.t * 0.5 + bd.phase) * 2.5;
      let pitch = 0;
      let amp = 0.5;
      // dives
      if (bd.dive > 0) {
        bd.dive += dt / (bd.gannet ? 1.5 : 1.0);
        const k = bd.dive;
        if (k < 0.55) {
          const f = k / 0.55;
          ny = lerp(ny, 0.5, f * f);
          pitch = -1.1 * Math.sin(f * Math.PI * 0.5);
          amp = 0.05;
        } else if (k < 1) {
          const f = (k - 0.55) / 0.45;
          ny = lerp(0.5, bd.alt, f * f);
          pitch = 0.5 * (1 - f);
          amp = 0.9;
        } else bd.dive = 0;
        if (k >= 0.52 && k - dt / 1.2 < 0.52) {
          this.rings.splash(bd.x, bd.z, bd.gannet ? 3.4 : 1.8, bd.gannet ? 1.1 : 0.8);
          this.rings.spray(bd.x, bd.z, bd.gannet ? 1.2 : 0.7, 0.6);
        }
      } else {
        bd.next -= dt * (0.4 + 1.6 * s.feeding);
        if (bd.next <= 0 && s.spooked <= 0) {
          bd.dive = 0.001;
          bd.next = this.rng.range(1.2, 4);
        }
        amp = 0.35 + 0.45 * Math.max(0, Math.sin(this.t * 0.9 + bd.phase));
      }
      const hx = nx - bd.x;
      const hz = nz - bd.z;
      if (bd.y !== 0 && hx * hx + hz * hz > 1e-8) bd.heading = Math.atan2(hz, hx);
      bd.bank +=
        (-bd.dir * clamp((bd.speed * bd.speed) / (9.81 * Math.max(bd.rad, 6)), 0, 0.5) - bd.bank) *
        Math.min(1, dt * 2);
      bd.x = nx;
      bd.z = nz;
      bd.y = Math.max(ny, 0.1) + height(nx, nz) * 0.5;
      // far birds are drawn bigger so they still read as specks against the sky
      const dist = Math.hypot(nx - this.cam.x, nz - this.cam.z);
      const base = bd.gannet ? 1.1 : 0.9;
      const scale = base * (1 + clamp(dist / 230, 0, 8));
      const flock = bd.gannet ? this.gannets : this.terns;
      const i = bd.gannet ? ng++ : nt++;
      flock.set(i, bd.x, bd.y, bd.z, bd.heading, bd.bank, pitch, scale, bd.phase, amp, bd.gannet ? 8 : 15);
    }
    this.terns.commit(nt);
    this.gannets.commit(ng);
  }

  private updateSurface(dt: number, height: (x: number, z: number) => number): void {
    const world = this.mode.world;
    const b = this.host.player;
    this.rings.beginSlicks();
    this.boilAcc += dt;
    const doBoil = this.boilAcc > 0.12;
    if (doBoil) this.boilAcc = 0;
    for (const s of world.schools) {
      const d = Math.hypot(s.x - b.pos.x, s.z - b.pos.z);
      if (d > 4200) continue;
      if (s.surface && s.density > 0.3)
        this.rings.slick(s.x, s.z, s.radius * 1.5, clamp(s.density * (0.6 + 0.4 * (1 - s.feeding)), 0, 1));
      // boils: tuna crashing bait, a handful of white explosions across the school
      if (doBoil && s.surface && s.feeding > 0.6 && s.spooked <= 0 && s.tuna.some((f) => !f.gone)) {
        const n = 1 + Math.floor(s.feeding * 2.5);
        for (let i = 0; i < n; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * s.radius * 0.7;
          this.rings.splash(
            s.x + Math.cos(a) * r,
            s.z + Math.sin(a) * r,
            this.rng.range(3, 7),
            this.rng.range(0.7, 1.2),
          );
        }
      } else if (doBoil && s.surface && s.feeding > 0.35 && s.spooked <= 0 && d < 1500) {
        // bait showering out of the water: small, scattered
        const a = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * s.radius * 0.8;
        this.rings.splash(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, this.rng.range(0.8, 1.8), 0.7);
      }
    }
    void height;
  }

  // ---- rods, lines and lures ----------------------------------------------------------------------------

  private updateRig(dt: number, height: (x: number, z: number) => number): void {
    const b = this.host.player;
    const mode = this.mode;
    const tackle = mode.tackle;
    const playing = this.host.phase !== 'menu' && this.host.phase !== 'loading';
    const f = mode.fight;
    const kn = Math.max(0, b.speed) * KNOTS;
    for (let i = 0; i < 4; i++) {
      const rod = tackle.rods[i] as Rod;
      const mesh = this.rods[i] as Mesh;
      rodPoints(b, rod.spec, this.butt, this.tip);
      // a fighting rod bends towards the fish
      let tip = this.tip;
      if (rod.state === 'hooked' && f) {
        this.dirV.set(f.x - this.butt.x, 0, f.z - this.butt.z).normalize();
        const load = clamp(f.T, 0, 1.1);
        this.mid
          .copy(this.tip)
          .addScaledVector(this.dirV, 0.9 * load)
          .addScaledVector(this.up, -0.7 * load);
        tip = this.mid;
      }
      this.placeSegment(mesh, this.butt, tip);
      mesh.visible = playing;

      const lure = this.lureMesh[i] as Mesh;
      const ribbon = this.lineRibbon[i] as Ribbon;
      const knot = this.knots[i] as Mesh;
      const out =
        rod.state === 'fishing' ||
        rod.state === 'setting' ||
        rod.state === 'reeling' ||
        rod.state === 'tangled';
      knot.visible = rod.state === 'tangled';
      if (!out || !playing) {
        lure.visible = false;
        ribbon.hide();
        continue;
      }
      // the lure rides the surface in the wash, skipping when it is going too fast
      const skip = sstep(7.5, 10.5, kn);
      const ly = height(rod.x, rod.z) + 0.05 + skip * Math.abs(Math.sin(this.t * 13 + i * 2)) * 0.5;
      lure.visible = rod.state !== 'tangled' || true;
      lure.position.set(rod.x, ly, rod.z);
      this.dirV.set(rod.x - tip.x, 0, rod.z - tip.z);
      lure.rotation.y = Math.atan2(this.dirV.x, this.dirV.z) + Math.PI;
      // the line: tip to lure with a gentle sag, which grows when the boat is slow
      const sag = 0.25 + clamp((6 - kn) * 0.18, 0, 1.4);
      const n = this.pts.length;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const p = this.pts[k] as Vector3;
        p.set(lerp(tip.x, rod.x, t), lerp(tip.y, ly, t) - Math.sin(t * Math.PI) * sag, lerp(tip.z, rod.z, t));
      }
      ribbon.set(this.pts, this.cam);
      if (rod.state === 'tangled') {
        knot.position.set(lerp(tip.x, rod.x, 0.55), lerp(tip.y, ly, 0.55) - 0.6, lerp(tip.z, rod.z, 0.55));
        knot.scale.setScalar(0.5 + 0.1 * Math.sin(this.t * 4 + i));
      }
      // the lure's own wake
      this.lureFoam[i] = (this.lureFoam[i] as number) - dt;
      if ((this.lureFoam[i] as number) <= 0 && rod.state !== 'tangled' && kn > 2) {
        this.lureFoam[i] = skip > 0.2 ? 0.1 : 0.28;
        this.rings.splash(rod.x, rod.z, 0.5 + skip * 0.8, skip > 0.2 ? 0.45 : 0.9);
      }
    }
    void transom;
  }

  private placeSegment(mesh: Mesh, a: Vector3, b: Vector3): void {
    this.dirV.copy(b).sub(a);
    const len = this.dirV.length();
    mesh.position.copy(a);
    this.q.setFromUnitVectors(this.up, this.dirV.normalize());
    mesh.quaternion.copy(this.q);
    mesh.scale.set(1, Math.max(0.01, len), 1);
  }

  // ---- the fish and the fight line -----------------------------------------------------------------------

  private updateFish(dt: number, height: (x: number, z: number) => number): void {
    const f = this.mode.fight;
    const rod = this.mode.tackle.hooked;
    if (!f || !rod || this.host.phase === 'menu') {
      this.tuna.visible = false;
      this.fightAbove.hide();
      this.fightBelow.hide();
      return;
    }
    const b = this.host.player;
    // livery and size for this species
    if (f.species.id !== this.lastSpecies) {
      this.lastSpecies = f.species.id;
      const old = this.tuna.geometry;
      this.tuna.geometry = buildTuna(f.species.back, f.species.belly, f.species.finlet);
      old.dispose();
    }
    const len = 0.55 * Math.cbrt(f.kg) * 0.62; // metres: 55 kg ~ 1.3 m, 250 kg ~ 2.1 m
    this.tuna.scale.setScalar(len * 2.6);
    const wy = height(f.x, f.z);
    // depth shown: deep fish are only a dark shape a few metres down
    const shown = clamp(f.depth, 0.3, 4.2);
    let y = wy - shown * 0.8;
    if (this.leap >= 0) {
      this.leap += dt / 0.95;
      if (this.leap >= 1) {
        this.rings.splash(f.x, f.z, 4.5, 1.1);
        this.leap = -1;
      } else y = Math.max(y, wy - 0.2 + 4 * this.leapH * this.leap * (1 - this.leap));
    }
    this.fishY += (y - this.fishY) * Math.min(1, dt * 6);
    if (this.leap >= 0) this.fishY = y;
    this.tuna.position.set(f.x, this.fishY, f.z);
    const vx = f.ux + 0;
    const vz = f.uz + 0;
    const hd = Math.hypot(vx, vz) > 0.4 ? Math.atan2(vz, vx) : this.tuna.rotation.y * -1;
    this.tuna.rotation.set(
      f.mood === 'tired' ? Math.PI * 0.55 : Math.sin(this.t * 7) * 0.2 * (f.mood === 'thrash' ? 3 : 1),
      -hd,
      this.leap >= 0 ? (0.5 - this.leap) * 1.4 : 0,
      'YXZ',
    );
    this.tuna.visible = f.depth < 14 || this.leap >= 0;

    // its wake when it is working near the top
    this.fishFoam -= dt;
    if (this.fishFoam <= 0 && f.depth < 5 && Math.hypot(f.ux, f.uz) > 1.5) {
      this.fishFoam = 0.16;
      this.rings.splash(f.x, f.z, 1.2 + Math.hypot(f.ux, f.uz) * 0.25, 0.8);
    }

    // the line from the rod tip to the fish: bright above the water, faint below it
    rodPoints(b, rod.spec, this.butt, this.tip);
    const load = clamp(f.T, 0, 1.1);
    this.dirV.set(f.x - this.butt.x, 0, f.z - this.butt.z).normalize();
    this.mid
      .copy(this.tip)
      .addScaledVector(this.dirV, 0.9 * load)
      .addScaledVector(this.up, -0.7 * load);
    const tip = this.mid;
    const d = Math.hypot(f.x - tip.x, f.z - tip.z);
    const fy = -clamp(f.depth, 0, 30);
    // where the line meets the water
    const tw = tip.y / Math.max(0.01, tip.y - fy);
    const wx = lerp(tip.x, f.x, tw);
    const wz = lerp(tip.z, f.z, tw);
    const slack = clamp(1 - f.T / 0.35, 0, 1);
    const sag = (0.15 + slack * Math.min(d, 40) * 0.12) * (1 - 0.5 * clamp(f.T, 0, 1));
    const n = this.pts.length;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const p = this.pts[k] as Vector3;
      const wyy = height(lerp(tip.x, wx, t), lerp(tip.z, wz, t));
      p.set(lerp(tip.x, wx, t), lerp(tip.y, wyy, t) - Math.sin(t * Math.PI) * sag, lerp(tip.z, wz, t));
      const q2 = this.pts2[k] as Vector3;
      q2.set(lerp(wx, f.x, t), lerp(wyy, Math.max(fy, -6), t), lerp(wz, f.z, t));
    }
    this.fightAbove.set(this.pts, this.cam);
    this.fightBelow.set(this.pts2, this.cam);
    void b;
  }

  // ---- marks --------------------------------------------------------------------------------------------------

  private updateBeacons(height: (x: number, z: number) => number): void {
    const marks = this.mode.marks;
    for (let i = 0; i < this.beacons.length; i++) {
      const g = this.beacons[i] as unknown as Group;
      const m = marks[i];
      g.visible = !!m && this.host.phase === 'playing';
      if (m) g.position.set(m.x, height(m.x, m.z), m.z);
    }
  }
}
