// Beach life: pastel art-deco lifeguard huts, umbrellas, loungers, towels, people.
// Plus the Haulover sandbar party: rafted boats, floats and people standing in the shallows.

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import { Rng } from '../../core/math';
import { boatById } from '../../data/boats';
import type { Environment } from '../../sim/environment';
import { beachX, cutZ, SANDBAR, seabedHeight } from '../../sim/geography';
import { makeWaveSample } from '../../sim/waves';
import { makeFlag } from '../boats/common';
import { gel, glass, matte, metal } from '../boats/materials';
import { buildConsole, type ConsolePaint } from '../boats/models/console';
import { buildGoFast } from '../boats/models/gofast';
import { buildPontoon } from '../boats/models/pontoon';
import { PartBuilder } from '../boats/parts';
import { ToonMaterial } from '../toon';

const HUT_PALETTES = [
  ['#ffd2e1', '#7fe3d1', '#fff6e6'],
  ['#fff2b8', '#ff9ccf', '#ffffff'],
  ['#bfe5ff', '#ffb597', '#fff6e6'],
  ['#d9f5c8', '#c7b8ff', '#fffaf0'],
  ['#ffe0cb', '#6fe6cc', '#ffffff'],
];

function lifeguardHut(pal: string[]): Group {
  const g = new Group();
  const pb = new PartBuilder();
  const wall = gel(pal[0] as string, 0.6);
  const accent = gel(pal[1] as string, 0.5);
  const white = gel(pal[2] as string, 0.55);
  const wood = matte('#c79a63', 0.8);
  for (const x of [-0.85, 0.85])
    for (const z of [-0.85, 0.85]) pb.cyl(wood, 0.07, 0.08, 1.2, { pos: [x, 0.6, z] }, 8);
  pb.box(white, 2.5, 0.12, 2.5, { pos: [0, 1.22, 0] }, 0.03);
  pb.box(wall, 1.8, 1.5, 1.8, { pos: [0, 2.05, 0] }, 0.14);
  pb.box(accent, 1.86, 0.28, 1.86, { pos: [0, 2.55, 0] }, 0.06);
  pb.box(accent, 2.3, 0.1, 2.3, { pos: [0, 2.95, 0] }, 0.04);
  pb.box(wall, 2.0, 0.1, 2.0, { pos: [0, 3.05, 0] }, 0.04);
  pb.box(glass('#2d4a66'), 0.05, 0.6, 1.0, { pos: [0.92, 2.2, 0] }, 0.02);
  pb.box(glass('#2d4a66'), 1.0, 0.6, 0.05, { pos: [0, 2.2, 0.92] }, 0.02);
  for (let i = 0; i < 3; i++)
    pb.box(wood, 0.34, 0.06, 0.9, { pos: [1.45 + i * 0.3, 0.3 + i * 0.35, 0] }, 0.02);
  pb.rod(metal(), [-0.9, 3.05, -0.9], [-0.9, 4.6, -0.9], 0.02);
  g.add(pb.build());
  const flag = makeFlag(0.7, 0.42, '#ff6f7d', '#fffaf3', 2);
  flag.position.set(-0.9, 4.45, -0.9);
  g.add(flag);
  return g;
}

export class Beach {
  readonly group = new Group();
  readonly flags: Group[] = [];

  constructor(quality: 'low' | 'medium' | 'high' = 'high') {
    this.group.name = 'beach';
    const rng = new Rng(2468);
    const density = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;

    // lifeguard huts along both coasts
    const zs = [-1180, -940, -760, -590, -430, -300, 250, 410, 590, 760, 940, 1130];
    zs.forEach((z, i) => {
      const x = beachX(z) - 17;
      const h = lifeguardHut(HUT_PALETTES[i % HUT_PALETTES.length] as string[]);
      h.position.set(x, seabedHeight(x, z) - 0.05, z);
      this.group.add(h);
      h.traverse((o) => {
        o.frustumCulled = false;
      });
      h.children.forEach((c) => {
        if (c.children.length === 0 && (c as Group).isGroup) this.flags.push(c as Group);
      });
      this.flags.push(h.children[h.children.length - 1] as Group);
    });

    // umbrellas, loungers, towels and people
    const canopyGeo = new ConeGeometry(1.2, 0.55, 14, 1, true).translate(0, 2.4, 0);
    const poleGeo = new CylinderGeometry(0.025, 0.025, 2.4, 6).translate(0, 1.2, 0);
    const loungerGeo = new RoundedBoxGeometry(1.9, 0.14, 0.62, 1, 0.05).translate(0, 0.22, 0);
    const towelGeo = new RoundedBoxGeometry(1.8, 0.03, 0.85, 1, 0.01);
    const bodyGeo = new CapsuleGeometry(0.2, 0.62, 3, 8);
    const headGeo = new SphereGeometry(0.15, 10, 8);
    const pastel = [
      '#ffd2e1',
      '#7fe3d1',
      '#fff2b8',
      '#bfe5ff',
      '#ffb597',
      '#c7b8ff',
      '#ffffff',
      '#d9f5c8',
      '#ff9ccf',
    ].map((c) => new Color(c));
    const skin = ['#f1c7a1', '#d9a67a', '#8d5a3c', '#f6d9bf', '#b97d55'].map((c) => new Color(c));

    const items: { pos: Vector3; yaw: number; col: Color }[] = [];
    const towels: { pos: Vector3; yaw: number; col: Color }[] = [];
    const people: { pos: Vector3; yaw: number; col: Color; skin: Color; lying: boolean }[] = [];
    const clusters: number[] = [];
    for (let z = -1500; z < 1500; z += 70 + rng.next() * 140) {
      if (Math.abs(z - cutZ(0)) < 150) continue;
      clusters.push(z);
    }
    for (const cz of clusters) {
      const n = Math.round((4 + rng.next() * 9) * density);
      for (let i = 0; i < n; i++) {
        const z = cz + (i - n / 2) * (4.4 + rng.next());
        const x = beachX(z) - 11 - rng.next() * 18;
        const h = seabedHeight(x, z);
        if (h < 0.55) continue;
        const p = new Vector3(x, h - 0.05, z);
        const col = pastel[Math.floor(rng.next() * pastel.length)] as Color;
        items.push({ pos: p, yaw: rng.next() * 6.28, col });
        const tx = x + 1.7 * Math.cos(rng.next() * 6.28);
        const tz = z + 1.7 * Math.sin(rng.next() * 6.28);
        towels.push({
          pos: new Vector3(tx, seabedHeight(tx, tz) + 0.02, tz),
          yaw: rng.next() * 6.28,
          col: pastel[Math.floor(rng.next() * pastel.length)] as Color,
        });
        const np = rng.int(1, 3);
        for (let k = 0; k < np; k++) {
          const px = x + (rng.next() - 0.5) * 4;
          const pz2 = z + (rng.next() - 0.5) * 4;
          const lying = rng.next() < 0.45;
          people.push({
            pos: new Vector3(px, seabedHeight(px, pz2) + (lying ? 0.12 : 0.62), pz2),
            yaw: rng.next() * 6.28,
            col: pastel[Math.floor(rng.next() * pastel.length)] as Color,
            skin: skin[Math.floor(rng.next() * skin.length)] as Color,
            lying,
          });
        }
      }
    }
    const mk = (
      geo: import('three/webgpu').BufferGeometry,
      mat: ToonMaterial,
      list: { pos: Vector3; yaw: number; col?: Color }[],
      colour: boolean,
      scale = 1,
    ) => {
      const m = new InstancedMesh(geo, mat, Math.max(1, list.length));
      const m4 = new Matrix4();
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const sc = new Vector3(scale, scale, scale);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.yaw);
        m4.compose(it.pos, q, sc);
        m.setMatrixAt(i, m4);
        if (colour && it.col) m.setColorAt(i, it.col);
      });
      m.count = list.length;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    mk(canopyGeo, new ToonMaterial({ roughness: 0.85, side: 2 }), items, true);
    mk(
      poleGeo,
      new ToonMaterial({ color: new Color('#e9eef3'), roughness: 0.4, metalness: 0.7 }),
      items,
      false,
    );
    mk(
      loungerGeo,
      new ToonMaterial({ color: new Color('#fff8ee'), roughness: 0.7 }),
      items.map((it) => ({ pos: it.pos.clone().add(new Vector3(0.0, 0, 1.5)), yaw: it.yaw })),
      false,
    );
    mk(towelGeo, new ToonMaterial({ roughness: 0.95 }), towels, true);
    // people: standing capsules and lying ones
    const standing = people.filter((p) => !p.lying);
    mk(bodyGeo, new ToonMaterial({ roughness: 0.8 }), standing, true);
    mk(
      headGeo,
      new ToonMaterial({ roughness: 0.8 }),
      standing.map((p) => ({ pos: p.pos.clone().add(new Vector3(0, 0.62, 0)), yaw: 0, col: p.skin })),
      true,
    );
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  update(time: number, wind: { x: number; z: number }, heading = 0): void {
    const spd = Math.hypot(wind.x, wind.z) || 1;
    const a = Math.atan2(-wind.z / spd, wind.x / spd);
    for (const f of this.flags) f.rotation.y = a + Math.sin(time * 2.1) * 0.1;
    void heading;
  }
}

/** The Haulover sandbar party. */
export class Sandbar {
  readonly group = new Group();
  private readonly items: { g: Group; x: number; z: number; yaw: number; phase: number; amp: number }[] = [];
  private readonly ws = makeWaveSample();
  private readonly q = new Quaternion();
  private readonly n = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'sandbar';
    const rng = new Rng(1357);
    const consoleSpec = boatById('console');
    const gofast = boatById('gofast');
    const pontoon = boatById('pontoon');
    const pal: ConsolePaint[] = [
      {
        top: '#fcfbf6',
        stripe: '#6fe6cc',
        boot: '#ff8f7a',
        bottom: '#33b3c6',
        inner: '#f4efe4',
        canvas: '#84e8dd',
        cushion: '#8be9df',
      },
      {
        top: '#fff4f0',
        stripe: '#ff9ccf',
        boot: '#7ff0d0',
        bottom: '#3aa8c4',
        inner: '#f4efe4',
        canvas: '#ffc9de',
        cushion: '#ffd1e4',
      },
      {
        top: '#f4f9ff',
        stripe: '#8fb8ff',
        boot: '#ffd45e',
        bottom: '#2f86b8',
        inner: '#f4efe4',
        canvas: '#bcd4ff',
        cushion: '#c8dcff',
      },
      {
        top: '#fffaf0',
        stripe: '#ffb497',
        boot: '#6fe6cc',
        bottom: '#2f9bb0',
        inner: '#f4efe4',
        canvas: '#ffd9b8',
        cushion: '#ffd9c4',
      },
    ];
    const place = (g: Group, x: number, z: number, yaw: number) => {
      const wrap = new Group();
      wrap.add(g);
      wrap.position.set(x, 0, z);
      this.group.add(wrap);
      this.items.push({ g: wrap, x, z, yaw, phase: rng.next() * 6, amp: 0.01 });
    };
    // boats rafted around the lagoon
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng.next() * 0.35;
      const r = 62 + rng.next() * 34;
      const x = SANDBAR.x + Math.cos(a) * r;
      const z = SANDBAR.z + Math.sin(a) * r;
      const depth = -seabedHeight(x, z);
      if (depth < 0.5) continue;
      const yaw = a + Math.PI / 2 + (rng.next() - 0.5) * 0.4;
      const roll = rng.next();
      const model =
        roll < 0.3
          ? buildPontoon(pontoon).group
          : roll < 0.4
            ? buildGoFast(gofast).group
            : buildConsole(consoleSpec, pal[i % pal.length] as ConsolePaint).group;
      place(model, x, z, yaw);
    }
    // a few umbrellas + people on the dry patch and in the shallows
    const canopy = new ConeGeometry(1.1, 0.5, 12, 1, true).translate(0, 2.3, 0);
    const pole = new CylinderGeometry(0.025, 0.025, 2.3, 6).translate(0, 1.15, 0);
    const colors = ['#ffd2e1', '#7fe3d1', '#fff2b8', '#ff9ccf'].map((c) => new Color(c));
    const pb = new PartBuilder();
    void pb;
    const m4 = new Matrix4();
    const cm = new InstancedMesh(canopy, new ToonMaterial({ roughness: 0.85, side: 2 }), 5);
    const pm = new InstancedMesh(
      pole,
      new ToonMaterial({ color: new Color('#e9eef3'), roughness: 0.4, metalness: 0.7 }),
      5,
    );
    for (let i = 0; i < 5; i++) {
      const x = SANDBAR.x + (rng.next() - 0.5) * 18;
      const z = SANDBAR.z + (rng.next() - 0.5) * 14;
      m4.makeTranslation(x, Math.max(0.1, seabedHeight(x, z)), z);
      cm.setMatrixAt(i, m4);
      pm.setMatrixAt(i, m4);
      cm.setColorAt(i, colors[i % colors.length] as Color);
    }
    cm.frustumCulled = pm.frustumCulled = false;
    this.group.add(cm, pm);

    // waders + floats
    const bodyGeo = new CapsuleGeometry(0.2, 0.7, 3, 8);
    const headGeo = new SphereGeometry(0.15, 10, 8);
    const ringGeo = new TorusGeometry(0.75, 0.22, 10, 22).rotateX(Math.PI / 2);
    const NP = 46;
    const bodies = new InstancedMesh(bodyGeo, new ToonMaterial({ roughness: 0.8 }), NP);
    const heads = new InstancedMesh(headGeo, new ToonMaterial({ roughness: 0.8 }), NP);
    const rings = new InstancedMesh(ringGeo, new ToonMaterial({ roughness: 0.5 }), 16);
    const skin = ['#f1c7a1', '#d9a67a', '#8d5a3c', '#f6d9bf', '#b97d55'].map((c) => new Color(c));
    const shirts = ['#ff8f7a', '#7ff0d0', '#ffd45e', '#9fb8ff', '#ff9ccf', '#fffaf3'].map(
      (c) => new Color(c),
    );
    let pi = 0;
    for (let tries = 0; tries < 400 && pi < NP; tries++) {
      const a = rng.next() * 6.283;
      const r = rng.next() * 70;
      const x = SANDBAR.x + Math.cos(a) * r;
      const z = SANDBAR.z + Math.sin(a) * r;
      const d = -seabedHeight(x, z);
      if (d < 0.25 || d > 1.0) continue;
      m4.makeTranslation(x, -d + 0.9, z);
      bodies.setMatrixAt(pi, m4);
      bodies.setColorAt(pi, shirts[pi % shirts.length] as Color);
      m4.makeTranslation(x, -d + 1.62, z);
      heads.setMatrixAt(pi, m4);
      heads.setColorAt(pi, skin[pi % skin.length] as Color);
      pi++;
    }
    bodies.count = heads.count = pi;
    const flo = ['#ff9ccf', '#7ff0d0', '#ffd45e', '#9fb8ff', '#ff8f7a'].map((c) => new Color(c));
    for (let i = 0; i < 16; i++) {
      const a = rng.next() * 6.283;
      const r = 8 + rng.next() * 55;
      m4.makeTranslation(SANDBAR.x + Math.cos(a) * r, 0.05, SANDBAR.z + Math.sin(a) * r);
      rings.setMatrixAt(i, m4);
      rings.setColorAt(i, flo[i % flo.length] as Color);
    }
    for (const m of [bodies, heads, rings]) {
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
    }
    this.floats = rings;
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  private floats: InstancedMesh;

  update(env: Environment, time: number): void {
    for (const b of this.items) {
      env.waves.sample(b.x, b.z, env.time, this.ws);
      b.g.position.y = this.ws.h - 0.05 + Math.sin(time * 1.2 + b.phase) * b.amp;
      this.n.set(this.ws.nx, this.ws.ny, this.ws.nz);
      this.q.setFromUnitVectors(this.up, this.n);
      b.g.quaternion.setFromAxisAngle(this.up, b.yaw).premultiply(this.q.slerp(new Quaternion(), 0.5));
    }
    void this.floats;
  }
}
