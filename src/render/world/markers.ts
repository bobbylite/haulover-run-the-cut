// Gate markers: bobbing red / green can buoys with light pillars (next gate pulses), plus the sea buoy.

import { float, mix, positionLocal, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  NodeMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type { Course, Gate } from '../../game/course';
import type { Environment } from '../../sim/environment';
import { makeWaveSample } from '../../sim/waves';
import { bulb, gel, matte, metal } from '../boats/materials';
import { PartBuilder } from '../boats/parts';
import { shared } from '../shared';

type N = any;

interface Buoy {
  group: Group;
  x: number;
  z: number;
  phase: number;
  scale: number;
}

function makeBuoy(red: boolean, big = false): Group {
  const g = new Group();
  const body = red ? gel('#ff6f7d', 0.4) : gel('#37d6a0', 0.4);
  const white = gel('#fffaf3', 0.4);
  const pb = new PartBuilder();
  const s = big ? 2.6 : 1;
  pb.cyl(body, 0.5 * s, 0.62 * s, 1.15 * s, { pos: [0, 0.35 * s, 0] }, 16);
  pb.cyl(white, 0.52 * s, 0.52 * s, 0.14 * s, { pos: [0, 0.55 * s, 0] }, 16);
  pb.cone(body, 0.5 * s, 0.55 * s, { pos: [0, 1.2 * s, 0] }, 16);
  pb.rod(metal(), [0, 1.45 * s, 0], [0, 2.2 * s, 0], 0.03 * s);
  pb.sphere(bulb(red ? '#ff5a6a' : '#4dffb0', 9), 0.12 * s, { pos: [0, 2.28 * s, 0] }, 10);
  pb.cyl(matte('#394150'), 0.4 * s, 0.35 * s, 0.4 * s, { pos: [0, -0.35 * s, 0] }, 12);
  g.add(pb.build());
  return g;
}

/** Tall translucent pillar of light. */
function makePillar(color: [number, number, number], height: number) {
  const active = uniform(0);
  const passed = uniform(0);
  const m = new NodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.blending = AdditiveBlending;
  const h01 = positionLocal.y.div(height).add(0.5);
  const fade = float(1)
    .sub(smoothstep(0.0, 1.0, h01))
    .pow(1.6);
  const pulse = sin(shared.time.mul(3.2)).mul(0.25).add(0.75);
  const strength = active
    .mul(pulse.mul(0.85).add(0.2))
    .add(float(1).sub(active).mul(float(1).sub(passed)).mul(0.1))
    .add(passed.mul(0.0));
  const col = mix(vec3(...color), vec3(1.0, 0.82, 0.9), h01.mul(0.5));
  m.colorNode = vec4(col as N, fade.mul(strength).mul(0.55)) as N;
  const mesh = new Mesh(new CylinderGeometry(0.32, 0.55, height, 14, 1, true), m);
  mesh.position.y = height / 2;
  mesh.frustumCulled = false;
  return { mesh, active, passed };
}

export class GateMarkers {
  readonly group = new Group();
  private buoys: Buoy[] = [];
  private pillars: { active: { value: number }; passed: { value: number }; gate: number }[] = [];
  private readonly ws = makeWaveSample();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();

  constructor(course: Course) {
    this.build(course);
  }

  private build(course: Course): void {
    this.clear();
    for (const g of course.gates) this.addGate(g);
  }

  private addGate(g: Gate): void {
    // lateral axis: south-ish positive (red north, green south)
    const lx = -g.nz;
    const lz = g.nx;
    const finish = g.kind === 'finish';
    for (const side of [-1, 1] as const) {
      const red = side === -1;
      const buoy = makeBuoy(red, finish);
      const x = g.x + lx * g.half * side;
      const z = g.z + lz * g.half * side;
      buoy.position.set(x, 0, z);
      this.group.add(buoy);
      this.buoys.push({ group: buoy, x, z, phase: Math.random() * 6, scale: finish ? 2.6 : 1 });
      const p = makePillar(red ? [1.0, 0.42, 0.52] : [0.3, 1.0, 0.72], finish ? 90 : 55);
      p.mesh.position.set(x, 0, z);
      p.mesh.position.y = 0;
      this.group.add(p.mesh);
      p.mesh.position.y = (finish ? 90 : 55) / 2;
      this.pillars.push({ active: p.active, passed: p.passed, gate: g.index });
    }
  }

  private clear(): void {
    this.group.clear();
    this.buoys = [];
    this.pillars = [];
  }

  setCourse(course: Course): void {
    this.build(course);
  }

  /** `next` is the index of the gate the player must cross next; earlier gates are "passed". */
  update(env: Environment, next: number, time: number): void {
    for (const b of this.buoys) {
      env.waves.sample(b.x, b.z, env.time, this.ws);
      const bob = Math.sin(time * 1.3 + b.phase) * 0.03;
      b.group.position.y = this.ws.h - 0.15 * b.scale + bob;
      this.n.set(this.ws.nx, this.ws.ny, this.ws.nz);
      this.q.setFromUnitVectors(this.up, this.n);
      b.group.quaternion.slerp(this.q, 0.18);
    }
    for (const p of this.pillars) {
      p.active.value = p.gate === next ? 1 : 0;
      p.passed.value = p.gate < next ? 1 : 0;
    }
  }
}
