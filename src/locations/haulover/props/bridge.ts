// The A1A Haulover bridge: swept concrete deck rising 13.5 m over the Cut, approach ramps on piers,
// rails, lamp posts, and live traffic (instanced cars) that keeps flowing along the whole island road.

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { float, fract, mix, smoothstep, uv, vec3 } from 'three/tsl';
import { Color, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three/webgpu';
import { Rng, smoothstep as sstep } from '../../../core/math';
import { bulb, gel, matte, metal } from '../../../render/boats/materials';
import { PartBuilder, type V3 } from '../../../render/boats/parts';
import { ToonMaterial } from '../../../render/toon';
import { type P3, sweep } from '../../../render/world/sweep';
import { BRIDGE_X, seabedHeight } from '../geography';

type N = any;

export const DECK_HIGH = 13.5;
const DECK_THICK = 1.5;
const RAMP_FROM = 76;
const RAMP_TO = 250;
const ROAD_HALF = 9;

/** Road surface height at z (deck over the channel, ramp, then ground level). */
export function roadHeight(z: number): number {
  const a = Math.abs(z);
  if (a >= RAMP_TO) return seabedHeight(BRIDGE_X, z) + 0.08;
  const t = sstep(RAMP_FROM, RAMP_TO, a);
  const ground = seabedHeight(BRIDGE_X, Math.sign(z) * RAMP_TO) + 0.08;
  return DECK_HIGH + (ground - DECK_HIGH) * t;
}

function roadMaterial(): ToonMaterial {
  const m = new ToonMaterial({ roughness: 0.92, metalness: 0 });
  const across = uv().x;
  const along = uv().y;
  const asphalt = vec3(0.34, 0.33, 0.42);
  // double yellow centre, dashed white lane lines, solid edge lines
  const center = smoothstep(0.35, 0.2, across.sub(ROAD_HALF).abs());
  const dash = float(1).sub(smoothstep(0.45, 0.5, fract(along.div(9.0))));
  const lane = smoothstep(0.14, 0.07, across.sub(ROAD_HALF * 0.5).abs())
    .add(smoothstep(0.14, 0.07, across.sub(ROAD_HALF * 1.5).abs()))
    .mul(dash);
  const edge = smoothstep(0.16, 0.08, across.sub(0.35).abs()).add(
    smoothstep(0.16, 0.08, across.sub(ROAD_HALF * 2 - 0.35).abs()),
  );
  let c: N = mix(asphalt, vec3(1.0, 0.82, 0.3), center.clamp(0, 1));
  c = mix(c, vec3(0.97, 0.96, 0.95), lane.add(edge).clamp(0, 1));
  m.colorNode = c;
  return m;
}

interface Car {
  dir: 1 | -1;
  lane: number;
  speed: number;
  s: number;
  hue: number;
}

export class Bridge {
  readonly group = new Group();
  private readonly cars: Car[] = [];
  private readonly body: InstancedMesh;
  private readonly cabin: InstancedMesh;
  private readonly lights: InstancedMesh;
  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s1 = new Vector3(1, 1, 1);
  private readonly period = 6400;

  constructor() {
    this.group.name = 'bridge';
    this.buildDeck();
    this.buildRoads();
    this.buildPiers();
    this.buildFurniture();

    // traffic
    const rng = new Rng(909);
    const N_CARS = 96;
    const pastel = [
      '#ff8f7a',
      '#7ff0d0',
      '#ffd45e',
      '#9fb8ff',
      '#ff9ccf',
      '#fffaf3',
      '#c7b8ff',
      '#f6e7d3',
      '#8fe0ff',
    ];
    const bodyGeo = new RoundedBoxGeometry(4.4, 0.9, 1.85, 2, 0.25);
    const cabinGeo = new RoundedBoxGeometry(2.3, 0.7, 1.7, 2, 0.28);
    const lightGeo = new RoundedBoxGeometry(0.1, 0.18, 1.5, 1, 0.04);
    this.body = new InstancedMesh(bodyGeo, new ToonMaterial({ roughness: 0.35, metalness: 0.1 }), N_CARS);
    this.cabin = new InstancedMesh(
      cabinGeo,
      new ToonMaterial({ color: new Color('#26384f'), roughness: 0.12, metalness: 0.4 }),
      N_CARS,
    );
    this.lights = new InstancedMesh(lightGeo, bulb('#fff0c0', 8), N_CARS * 2);
    for (let i = 0; i < N_CARS; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      this.cars.push({
        dir,
        lane: rng.int(0, 1),
        speed: 9 + rng.next() * 8,
        s: rng.next() * this.period,
        hue: i,
      });
      this.body.setColorAt(i, new Color(pastel[i % pastel.length] as string));
    }
    for (const m of [this.body, this.cabin, this.lights]) {
      m.frustumCulled = false;
      m.castShadow = m !== this.lights;
    }
    this.body.instanceColor!.needsUpdate = true;
    this.group.add(this.body, this.cabin, this.lights);
  }

  // ---- geometry ---------------------------------------------------------------------------------

  private deckPath(from: number, to: number, step = 6): P3[] {
    const out: P3[] = [];
    for (let z = from; z <= to + 0.01; z += step) out.push([BRIDGE_X, roadHeight(z), z]);
    return out;
  }

  private buildDeck(): void {
    const path = this.deckPath(-RAMP_TO, RAMP_TO, 6);
    const concrete = matte('#d9d2e3', 0.9);
    const light = gel('#f3eee6', 0.55);
    // asphalt surface (uv.x across 0..18, uv.y along)
    const road = sweep(
      path,
      [
        [-ROAD_HALF, 0.02],
        [ROAD_HALF, 0.02],
      ],
      { uvScale: [1, 1], flip: true },
    );
    // fix the u origin so lane markings line up: sweep uv.x runs 0..len along the segment
    const roadMesh = new Mesh(road, roadMaterial());
    // girder body (closed profile) + pastel fascia
    const body = sweep(
      path,
      [
        [-ROAD_HALF - 2, -0.0],
        [-ROAD_HALF - 2.1, -DECK_THICK * 0.5],
        [-ROAD_HALF + 1.5, -DECK_THICK],
        [ROAD_HALF - 1.5, -DECK_THICK],
        [ROAD_HALF + 2.1, -DECK_THICK * 0.5],
        [ROAD_HALF + 2, 0.0],
      ],
      { closed: true },
    );
    const fascia = sweep(
      path,
      [
        [-ROAD_HALF - 2.04, 0.5],
        [-ROAD_HALF - 2.04, -0.1],
        [ROAD_HALF + 2.04, -0.1],
        [ROAD_HALF + 2.04, 0.5],
      ],
      { closed: false, flip: false },
    );
    const curbL = sweep(
      path,
      [
        [-ROAD_HALF - 2, 0.0],
        [-ROAD_HALF - 2, 0.22],
        [-ROAD_HALF, 0.22],
        [-ROAD_HALF, 0.02],
      ],
      { closed: true },
    );
    const curbR = sweep(
      path,
      [
        [ROAD_HALF, 0.02],
        [ROAD_HALF, 0.22],
        [ROAD_HALF + 2, 0.22],
        [ROAD_HALF + 2, 0.0],
      ],
      { closed: true },
    );
    for (const [geo, mat] of [
      [body, concrete],
      [curbL, light],
      [curbR, light],
      [fascia, gel('#ffd2c4', 0.5)],
    ] as const) {
      const m = new Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
    roadMesh.receiveShadow = true;
    roadMesh.frustumCulled = false;
    this.group.add(roadMesh);
  }

  /** The A1A ribbon on the island, either side of the bridge approaches. */
  private buildRoads(): void {
    const mat = roadMaterial();
    for (const side of [-1, 1] as const) {
      const path: P3[] = [];
      for (let z = RAMP_TO; z <= 3200; z += 24) {
        const zz = side * z;
        path.push([BRIDGE_X + 4 * Math.sin(zz * 0.004), roadHeight(zz) + 0.0, zz]);
      }
      const geo = sweep(
        path,
        [
          [-ROAD_HALF, 0.0],
          [ROAD_HALF, 0.0],
        ],
        { flip: true },
      );
      const m = new Mesh(geo, mat);
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  private buildPiers(): void {
    const pb = new PartBuilder();
    const concrete = matte('#cfc8dc', 0.92);
    const cap = gel('#f3eee6', 0.55);
    for (const side of [-1, 1] as const) {
      for (let a = RAMP_FROM + 14; a < RAMP_TO - 6; a += 22) {
        const z = side * a;
        const top = roadHeight(z) - DECK_THICK;
        const ground = seabedHeight(BRIDGE_X, z);
        const h = top - ground;
        if (h < 0.6) continue;
        for (const x of [-5.5, 5.5]) {
          pb.box(concrete, 1.5, h, 2.4, { pos: [BRIDGE_X + x, ground + h / 2, z] }, 0.18);
        }
        pb.box(cap, 15, 0.9, 2.8, { pos: [BRIDGE_X, top - 0.45, z] }, 0.2);
      }
    }
    // fender pilings flanking the channel under the span
    this.group.add(pb.build());
  }

  private buildFurniture(): void {
    const pb = new PartBuilder();
    const rail = metal('#f4f0ea', 0.4);
    const pole = metal('#e8edf2', 0.32);
    const pastel = gel('#ffd2c4', 0.45);
    for (const side of [-1, 1] as const) {
      const ex = BRIDGE_X + side * (ROAD_HALF + 1.7);
      // continuous railing: top rail + posts every 5 m
      const pts: V3[] = [];
      for (let z = -RAMP_TO; z <= RAMP_TO; z += 10) pts.push([ex, roadHeight(z) + 1.2, z]);
      pb.tube(rail, pts, 0.07, false, pts.length * 2);
      const pts2: V3[] = pts.map(([x, y, z]) => [x, y - 0.5, z]);
      pb.tube(rail, pts2, 0.04, false, pts.length * 2);
      for (let z = -RAMP_TO; z <= RAMP_TO; z += 5)
        pb.box(pastel, 0.16, 1.2, 0.16, { pos: [ex, roadHeight(z) + 0.62, z] }, 0.04);
      // lamp posts
      for (let z = -RAMP_TO + 20; z <= RAMP_TO - 20; z += 36) {
        const y = roadHeight(z);
        pb.cyl(pole, 0.08, 0.11, 8.5, { pos: [ex, y + 4.25, z] }, 8);
        pb.rod(pole, [ex, y + 8.4, z], [ex - side * 2.4, y + 8.9, z], 0.06);
        pb.sphere(bulb('#fff2c8', 9), 0.3, { pos: [ex - side * 2.5, y + 8.85, z] }, 8);
      }
    }
    this.group.add(pb.build());
  }

  // ---- traffic ----------------------------------------------------------------------------------

  update(dt: number, _time: number): void {
    const car = this.m4;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i] as Car;
      c.s = (c.s + c.speed * dt) % this.period;
      const z = c.dir * (-3200 + c.s);
      const lane = (c.lane === 0 ? 2.1 : 5.7) * -c.dir; // right-hand traffic: southbound (+z) uses -x lanes
      const x = BRIDGE_X + lane + (Math.abs(z) > RAMP_TO ? 4 * Math.sin(z * 0.004) : 0);
      const y = roadHeight(z) + 0.55;
      // the car's long axis is x; yaw it to travel along +z (dir 1) or -z (dir -1)
      this.q.setFromAxisAngle(this.up, c.dir === 1 ? -Math.PI / 2 : Math.PI / 2);
      this.p.set(x, y, z);
      car.compose(this.p, this.q, this.s1);
      this.body.setMatrixAt(i, car);
      this.p.set(x, y + 0.75, z);
      car.compose(this.p, this.q, this.s1);
      this.cabin.setMatrixAt(i, car);
      // head/tail lights (fixed to the body)
      for (const k of [0, 1]) {
        const sgn = k === 0 ? 1 : -1;
        this.p.set(x, y + 0.1, z + c.dir * sgn * 2.2);
        car.compose(this.p, this.q, this.s1);
        this.lights.setMatrixAt(i * 2 + k, car);
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }

  private readonly up = new Vector3(0, 1, 0);
}
