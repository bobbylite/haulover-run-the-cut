// Palms, sea-grape shrubs and mangroves. Palms are one merged mesh (trunk + fronds, vertex colours)
// instanced ~1000 times; the vertex shader sways them with the live wind and gusts.

import { float, positionGeometry, positionLocal, sin, smoothstep, vec3 } from 'three/tsl';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { clamp, hash2, noise2, Rng } from '../../core/math';
import {
  BRIDGE_X,
  bayX,
  beachX,
  cutHalfW,
  cutZ,
  hardSDF,
  ISLETS,
  landSDF,
  mainX,
  seabedHeight,
} from '../../sim/geography';
import { shared } from '../shared';
import { ToonMaterial } from '../toon';

type N = any;

const PALM_H = 10;

function palmGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number, c: Color) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  const trunkA = new Color('#c09062');
  const trunkB = new Color('#a37448');
  const R = 10;
  const S = 9;
  const bend = 0.9;
  const centre = (t: number): [number, number, number] => [bend * t * t, PALM_H * t, 0.35 * bend * t * t];
  // trunk
  const ring: number[][] = [];
  for (let i = 0; i <= R; i++) {
    const t = i / R;
    const [cx, cy, cz] = centre(t);
    const r = 0.27 - 0.13 * t + (i % 2 === 0 ? 0.016 : 0);
    const c = (i % 2 === 0 ? trunkA : trunkB).clone();
    const row: number[] = [];
    for (let k = 0; k < S; k++) {
      const a = (k / S) * Math.PI * 2;
      row.push(push(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, c));
    }
    ring.push(row);
  }
  for (let i = 0; i < R; i++) {
    for (let k = 0; k < S; k++) {
      const a = ring[i]![k]!;
      const b = ring[i]![(k + 1) % S]!;
      const c = ring[i + 1]![k]!;
      const d = ring[i + 1]![(k + 1) % S]!;
      idx.push(a, c, b, b, c, d);
    }
  }
  // fronds
  const [tx, ty, tz] = centre(1);
  const greens = ['#3c9a62', '#4cae6b', '#35905a', '#59bb74'].map((c) => new Color(c));
  const tip = new Color('#9be6a6');
  const FR = 11;
  for (let f = 0; f < FR; f++) {
    const a = (f / FR) * Math.PI * 2 + (f % 2) * 0.18;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const len = 3.6 + (f % 3) * 0.35;
    const droop = 1.7 + (f % 2) * 0.5;
    const base = greens[f % greens.length] as Color;
    const SEG = 7;
    let prevL = -1;
    let prevR = -1;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const cx = tx + dx * len * t;
      const cz = tz + dz * len * t;
      const cy = ty + 0.5 * Math.sin(t * 2.2) - droop * t * t;
      const w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)) ** 0.7 + 0.03;
      const c = base.clone().lerp(tip, t * 0.7);
      const px = -dz * w;
      const pz = dx * w;
      const l = push(cx + px, cy - w * 0.35, cz + pz, c);
      const r = push(cx - px, cy - w * 0.35, cz - pz, c);
      if (prevL >= 0) idx.push(prevL, prevR, l, prevR, r, l);
      prevL = l;
      prevR = r;
    }
  }
  // dead hanging fronds + coconuts
  const dead = new Color('#a98655');
  for (let f = 0; f < 3; f++) {
    const a = f * 2.1 + 0.4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const i0 = push(tx + dx * 0.15 - dz * 0.1, ty - 0.1, tz + dz * 0.15 + dx * 0.1, dead);
    const i1 = push(tx + dx * 0.15 + dz * 0.1, ty - 0.1, tz + dz * 0.15 - dx * 0.1, dead);
    const i2 = push(tx + dx * 0.9, ty - 1.5, tz + dz * 0.9, dead);
    idx.push(i0, i1, i2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function swayMaterial(): ToonMaterial {
  const m = new ToonMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    side: DoubleSide,
  });
  const p = positionLocal as N;
  const hN = (positionGeometry.y as N).div(PALM_H).clamp(0.0, 1.2);
  const t = shared.time;
  const dir = (shared.wind as N).div((shared.windSpeed as N).max(0.5));
  const gust = sin(t.mul(0.8).add(p.x.mul(0.05)).add(p.z.mul(0.043)))
    .mul(0.5)
    .add(0.5);
  const amp = hN
    .mul(hN)
    .mul(float(0.12).add((shared.windSpeed as N).mul(0.03)))
    .mul(gust.mul(0.7).add(0.55));
  const ph = sin(t.mul(1.5).add(p.x.mul(0.37)).add(p.z.mul(0.23)));
  const crown = smoothstep(0.78, 1.0, hN);
  const flutter = sin(t.mul(6.5).add(p.x.mul(2.3)).add(positionGeometry.x.mul(3.0)))
    .mul(0.06)
    .mul(crown)
    .mul((shared.windSpeed as N).mul(0.12).add(0.35));
  m.positionNode = vec3(
    p.x.add((dir.x as N).mul(amp).mul(ph.mul(0.35).add(1.0))),
    p.y.add(flutter),
    p.z.add((dir.y as N).mul(amp).mul(ph.mul(0.35).add(1.0))),
  ) as N;
  return m;
}

export class Vegetation {
  readonly group = new Group();

  constructor(quality: 'low' | 'medium' | 'high' = 'high') {
    this.group.name = 'vegetation';
    const density = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1;
    const rng = new Rng(8080);
    const palmSpots: { x: number; z: number; s: number; yaw: number; tint: number }[] = [];
    const taken = new Set<string>();
    const cell = 6.5;
    const tryPalm = (x: number, z: number, s = 0.75 + rng.next() * 0.6) => {
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      if (taken.has(key)) return;
      if (landSDF(x, z) > -6) return;
      const h = seabedHeight(x, z);
      if (h < 0.7) return;
      // keep clear of the cut, road, marina, bridge ramps
      const cd = Math.abs(z - cutZ(x)) - cutHalfW(x);
      if (x > bayX(z) - 4 && x < beachX(z) + 40 && cd < 20) return;
      const roadX = BRIDGE_X + 4 * Math.sin(z * 0.004);
      if (Math.abs(x - roadX) < 10.5) return;
      if (hardSDF(x, z) < 8) return;
      if (Math.abs(z - 158) < 30 && x < bayX(158) + 70 && x > bayX(158) - 5) return;
      taken.add(key);
      palmSpots.push({ x, z, s, yaw: rng.next() * 6.283, tint: rng.next() });
    };

    // Haulover Park (south): generous scatter; beaches & dunes along the whole coast
    for (let i = 0; i < 9000 * density; i++) {
      const z = (rng.next() * 2 - 1) * 1500;
      const park = z > 90 && z < 1050;
      const x = bayX(z) + 16 + rng.next() * (beachX(z) - bayX(z) - 40);
      const dOcean = beachX(z) - x;
      const dune = dOcean > 28 && dOcean < 110;
      const n = noise2(x * 0.02, z * 0.02, 5);
      if (park) {
        if (n > 0.38 || (dune && rng.next() < 0.5)) tryPalm(x, z);
      } else if (z < -230) {
        // north: palms on the dune line and between towers
        if (dOcean > 20 && dOcean < 52 && n > 0.3) tryPalm(x, z, 0.6 + rng.next() * 0.5);
        else if (n > 0.62 && rng.next() < 0.3) tryPalm(x, z, 0.6 + rng.next() * 0.5);
      } else if (dune) {
        tryPalm(x, z);
      }
    }
    // street palms down both sides of A1A
    for (let z = -2900; z < 2900; z += 17) {
      if (Math.abs(z) < 260) continue;
      const rx = BRIDGE_X + 4 * Math.sin(z * 0.004);
      for (const side of [-1, 1]) {
        const x = rx + side * 12.5;
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        if (taken.has(key)) continue;
        if (landSDF(x, z) > -6 || seabedHeight(x, z) < 0.7) continue;
        taken.add(key);
        palmSpots.push({
          x,
          z: z + (rng.next() - 0.5) * 3,
          s: 0.95 + rng.next() * 0.25,
          yaw: rng.next() * 6.283,
          tint: rng.next(),
        });
      }
    }

    const palms = new InstancedMesh(palmGeometry(), swayMaterial(), palmSpots.length);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const sc = new Vector3();
    const pos = new Vector3();
    const up = new Vector3(0, 1, 0);
    const col = new Color();
    palmSpots.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      sc.set(p.s, p.s, p.s);
      pos.set(p.x, seabedHeight(p.x, p.z) - 0.1, p.z);
      m4.compose(pos, q, sc);
      palms.setMatrixAt(i, m4);
      palms.setColorAt(i, col.setRGB(0.85 + p.tint * 0.2, 0.9 + p.tint * 0.15, 0.82 + p.tint * 0.12));
    });
    palms.castShadow = true;
    palms.receiveShadow = true;
    palms.frustumCulled = false;
    this.group.add(palms);

    // sea-grape shrubs + mangrove clumps (instanced blobs)
    const bushGeo = new IcosahedronGeometry(1, 1);
    const bushMat = new ToonMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
    const bushes: { x: number; y: number; z: number; r: number; c: Color }[] = [];
    const greens = ['#6fc283', '#58b573', '#7fd08e', '#4aa872', '#8ad69b'].map((c) => new Color(c));
    const darks = ['#2f8a63', '#3b9a6d', '#2a7f5e', '#46a877'].map((c) => new Color(c));
    for (let i = 0; i < 5200 * density; i++) {
      const z = (rng.next() * 2 - 1) * 1700;
      const x = bayX(z) + 6 + rng.next() * (beachX(z) - bayX(z) - 12);
      if (landSDF(x, z) > -3) continue;
      const dOcean = beachX(z) - x;
      const dBay = x - bayX(z);
      const cd = Math.abs(z - cutZ(x)) - cutHalfW(x);
      if (cd < 16) continue;
      if (Math.abs(x - (BRIDGE_X + 4 * Math.sin(z * 0.004))) < 11) continue;
      if (z < -230 && dOcean > 62 && rng.next() < 0.7) continue;
      const dunes = dOcean > 24 && dOcean < 100;
      const bay = dBay < 26;
      if (!(dunes || bay) || rng.next() > (dunes ? 0.55 : 0.8)) continue;
      const h = seabedHeight(x, z);
      if (h < 0.4) continue;
      bushes.push({
        x,
        y: h,
        z,
        r: 0.7 + rng.next() * 1.3,
        c: greens[Math.floor(rng.next() * greens.length)] as Color,
      });
    }
    for (const it of ISLETS) {
      for (let i = 0; i < 70 * density; i++) {
        const a = rng.next() * 6.283;
        const rr = Math.sqrt(rng.next()) * it.r * 0.8;
        const x = it.x + Math.cos(a) * rr;
        const z = it.z + Math.sin(a) * rr;
        if (landSDF(x, z) > -4) continue;
        bushes.push({
          x,
          y: Math.max(0.2, seabedHeight(x, z)),
          z,
          r: 1.6 + rng.next() * 2.6,
          c: darks[Math.floor(rng.next() * darks.length)] as Color,
        });
      }
    }
    for (let z = -2600; z < 2600; z += 11) {
      if (hash2(z, 3) > 0.62) continue;
      const x = mainX(z) - 6 - rng.next() * 40;
      bushes.push({
        x,
        y: 0.7,
        z: z + rng.next() * 9,
        r: 2.4 + rng.next() * 3.2,
        c: darks[Math.floor(rng.next() * darks.length)] as Color,
      });
    }
    const bushMesh = new InstancedMesh(bushGeo, bushMat, bushes.length);
    bushes.forEach((b, i) => {
      pos.set(b.x, b.y + b.r * 0.25, b.z);
      q.setFromAxisAngle(up, rng.next() * 6.283);
      sc.set(b.r * 1.3, b.r * 0.85, b.r * 1.3);
      m4.compose(pos, q, sc);
      bushMesh.setMatrixAt(i, m4);
      bushMesh.setColorAt(i, b.c);
    });
    bushMesh.castShadow = false;
    bushMesh.receiveShadow = true;
    bushMesh.frustumCulled = false;
    this.group.add(bushMesh);
    void clamp;
  }
}
