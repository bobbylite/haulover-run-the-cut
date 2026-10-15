// The Miami skyline: pastel condo towers (Sunny Isles to the north, Bal Harbour to the south, the
// mainland across the bay). One instanced mesh each for boxes and round towers; the facade is a
// procedural TSL shader (per-instance floors / columns, balcony bands, lit windows at night).

import {
  abs,
  float,
  floor,
  fract,
  instancedBufferAttribute,
  mix,
  normalLocal,
  select,
  sin,
  step,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { Rng } from '../../core/math';
import { BRIDGE_X, beachX, hardSDF, landSDF } from '../../sim/geography';
import { shared } from '../shared';
import { ToonMaterial } from '../toon';

type N = any;

const PASTELS = [
  '#ffd3de',
  '#d4f4ea',
  '#fff0c4',
  '#d6e4ff',
  '#ffe0cb',
  '#ece0ff',
  '#ffffff',
  '#c6ecff',
  '#ffd9ef',
  '#e3f6c7',
];

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  round: boolean;
  color: string;
  crown: boolean;
  podium: boolean;
  yaw: number;
}

function layout(): Tower[] {
  const rng = new Rng(31337);
  const out: Tower[] = [];
  const add = (x: number, z: number, hMin: number, hMax: number, big: boolean) => {
    if (landSDF(x, z) > -10) return;
    if (hardSDF(x, z) < 60) return;
    const w = (big ? 34 : 26) + rng.next() * (big ? 16 : 14);
    const d = (big ? 30 : 24) + rng.next() * 14;
    out.push({
      x,
      z,
      w,
      d,
      h: hMin + rng.next() ** 0.8 * (hMax - hMin),
      round: rng.next() < 0.16,
      color: PASTELS[Math.floor(rng.next() * PASTELS.length)] as string,
      crown: rng.next() < 0.45,
      podium: rng.next() < 0.5,
      yaw: (rng.next() - 0.5) * 0.18,
    });
  };

  // north: Sunny Isles Beach (two rows either side of A1A)
  for (let z = -230; z > -3400; z -= 55 + rng.next() * 85) {
    if (rng.next() < 0.14) continue;
    add(beachX(z) - 92 + (rng.next() - 0.5) * 26, z, 80, 215, true);
    if (rng.next() < 0.78)
      add(BRIDGE_X - 92 + (rng.next() - 0.5) * 30, z + (rng.next() - 0.5) * 30, 38, 120, false);
    if (rng.next() < 0.45) add(BRIDGE_X + 62 + (rng.next() - 0.5) * 20, z + 25, 30, 90, false);
  }
  // south: Bal Harbour
  for (let z = 1080; z < 3400; z += 55 + rng.next() * 90) {
    if (rng.next() < 0.18) continue;
    add(beachX(z) - 92 + (rng.next() - 0.5) * 26, z, 70, 185, true);
    if (rng.next() < 0.7)
      add(BRIDGE_X - 92 + (rng.next() - 0.5) * 30, z + (rng.next() - 0.5) * 30, 34, 100, false);
  }
  // the mainland across the bay
  for (let i = 0; i < 70; i++) {
    const z = (rng.next() * 2 - 1) * 3000;
    const x = -2150 - rng.next() * 420;
    add(x, z, 28, 120, false);
  }
  return out;
}

export class City {
  readonly group = new Group();
  private readonly towers: Tower[];

  constructor() {
    this.group.name = 'city';
    this.towers = layout();
    this.build();
  }

  private build(): void {
    const boxes: Tower[] = [];
    const rounds: Tower[] = [];
    for (const t of this.towers) (t.round ? rounds : boxes).push(t);

    // boxes: main + optional crown + optional podium instances
    const makeSet = (list: Tower[], round: boolean) => {
      const insts: { m: Matrix4; col: Color; info: [number, number, number, number] }[] = [];
      const q = new Quaternion();
      const sc = new Vector3();
      const pos = new Vector3();
      const up = new Vector3(0, 1, 0);
      let seed = 1;
      for (const t of list) {
        const base = new Color(t.color);
        const floors = Math.max(4, Math.round(t.h / 3.4));
        const colsW = Math.max(3, Math.round(t.w / 3.6));
        const colsD = Math.max(3, Math.round(t.d / 3.6));
        q.setFromAxisAngle(up, t.yaw);
        const push = (
          x: number,
          y: number,
          z: number,
          w: number,
          h: number,
          d: number,
          col: Color,
          fl: number,
          cw: number,
          cd: number,
        ) => {
          pos.set(x, y, z);
          sc.set(w, h, d);
          insts.push({
            m: new Matrix4().compose(pos, q, sc),
            col,
            info: [
              round ? Math.round((Math.PI * w) / 3.4) : cw,
              round ? Math.round((Math.PI * w) / 3.4) : cd,
              fl,
              seed++,
            ],
          });
        };
        push(t.x, 0, t.z, t.w, t.h, t.d, base, floors, colsW, colsD);
        if (t.crown) {
          const ch = 9 + t.h * 0.07;
          push(
            t.x,
            t.h,
            t.z,
            t.w * 0.62,
            ch,
            t.d * 0.62,
            base.clone().multiplyScalar(0.96),
            Math.round(ch / 3.4),
            Math.max(2, Math.round(colsW * 0.6)),
            Math.max(2, Math.round(colsD * 0.6)),
          );
        }
        if (t.podium) {
          const ph = 11;
          push(
            t.x,
            0,
            t.z,
            t.w * 1.45,
            ph,
            t.d * 1.4,
            base.clone().lerp(new Color('#ffffff'), 0.4),
            3,
            Math.round(colsW * 1.45),
            Math.round(colsD * 1.4),
          );
        }
      }
      if (insts.length === 0) return;
      const geo = round ? new CylinderGeometry(0.5, 0.5, 1, 28, 1) : new BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new ToonMaterial({ roughness: 0.55, metalness: 0.0 });
      const mesh = new InstancedMesh(geo, mat, insts.length);
      const infoArr = new Float32Array(insts.length * 4);
      const colArr = new Float32Array(insts.length * 3);
      insts.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        infoArr.set(it.info, i * 4);
        colArr.set([it.col.r, it.col.g, it.col.b], i * 3);
      });
      const info = instancedBufferAttribute(new InstancedBufferAttribute(infoArr, 4)) as N;
      const wallAttr = instancedBufferAttribute(new InstancedBufferAttribute(colArr, 3)) as N;

      // ---- facade shader -----------------------------------------------------------------------
      const side: N = round ? float(1) : step(abs(normalLocal.y), 0.5);
      const colsSel: N = round ? info.x : (select(abs(normalLocal.x).greaterThan(0.5), info.y, info.x) as N);
      const cell: N = vec2((uv().x as N).mul(colsSel), (uv().y as N).mul(info.z));
      const f: N = fract(cell);
      const id: N = floor(cell);
      const win = step(0.2, f.x).mul(step(f.x, 0.8)).mul(step(0.24, f.y)).mul(step(f.y, 0.82));
      const band = step(f.y, 0.1).add(step(0.9, f.y).mul(0.6));
      const hash = fract(
        sin(id.x.mul(12.9898).add(id.y.mul(78.233)).add(info.w.mul(37.719))).mul(43758.5453),
      );
      const glass = mix(vec3(0.16, 0.3, 0.46), vec3(0.45, 0.66, 0.85), uv().y.mul(0.6).add(hash.mul(0.25)));
      const wall = wallAttr.xyz;
      const facade0: N = mix(wall, glass, win.mul(0.92));
      const facade: N = mix(
        facade0,
        wall.mul(1.06).add(0.04),
        (band as N).clamp(0, 1).mul(float(1).sub(win)),
      );
      const roof = wall.mul(0.78);
      mat.colorNode = mix(roof, facade, side) as N;
      // lit windows at night
      const lit = step(0.55, hash).mul(win).mul(side);
      mat.emissiveNode = vec3(1.0, 0.82, 0.5).mul(lit).mul(shared.night).mul(1.6) as N;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    };
    makeSet(boxes, false);
    makeSet(rounds, true);
  }
}
