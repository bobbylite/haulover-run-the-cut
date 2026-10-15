// Pieces shared by every boat builder.

import { float, mix, positionLocal, sin, smoothstep, uv, vec3, vec4 } from 'three/tsl';
import { Color, DoubleSide, Group, Mesh, NodeMaterial, PlaneGeometry } from 'three/webgpu';
import { lerp, smoothstep as sstep } from '../../core/math';
import { HULL_OPTS, type HullOpts, sheerAt } from '../../data/boats';
import type { BoatSpec } from '../../sim/boatSpec';
import { shared } from '../shared';
import { type HullShape, type Livery, loftShell, loftTransom } from './loft';
import { bulb, flagMaterial, hullMaterial } from './materials';
import type { PartBuilder, V3 } from './parts';

type N = any;

export interface SailParts {
  boom: Group;
  jib: Group;
  uBillow: { value: number };
  uLuff: { value: number };
  uSide: { value: number };
}

export interface ModelParts {
  group: Group;
  /** Rotated about Y by the steering angle. */
  engines: Group[];
  /** Pivots that point downwind. */
  flags: Group[];
  wheel?: Group;
  sail?: SailParts;
}

export interface LiverySpec {
  top: string;
  stripe: string;
  boot: string;
  bottom: string;
  inner: string;
  stripeFrom?: number;
  stripeTo?: number;
}

export interface HullTune {
  deadrise?: [number, number];
  chine?: [number, number];
  keelFactor?: number;
  rake?: number;
  stripeFrom?: number;
  stripeTo?: number;
}

export function hullOpts(spec: BoatSpec): HullOpts {
  const o = HULL_OPTS.get(spec.id);
  if (!o) throw new Error(`no hull opts for ${spec.id}`);
  return o;
}

export function makeHullShape(o: HullOpts, liv: LiverySpec, tune: HullTune = {}): HullShape {
  const dr = tune.deadrise ?? [0.3, 0.62];
  const cr = tune.chine ?? [0.86, 0.4];
  const livery: Livery = {
    top: new Color(liv.top),
    stripe: new Color(liv.stripe),
    stripeFrom: liv.stripeFrom ?? tune.stripeFrom ?? 0.3,
    stripeTo: liv.stripeTo ?? tune.stripeTo ?? 0.44,
    boot: new Color(liv.boot),
    bootFrom: -0.03,
    bootTo: 0.07,
    bottom: new Color(liv.bottom),
    inner: new Color(liv.inner),
  };
  return {
    length: o.length,
    beam: o.beam,
    xAft: o.xAft,
    draft: o.draft,
    planform: o.planform,
    sheer: (s) => sheerAt(o, s),
    rocker: (s) => o.rocker * sstep(o.rockerStart, 1.0, s) ** 1.6,
    deadrise: (s) => lerp(dr[0], dr[1], sstep(0.2, 0.95, s)),
    chineRatio: (s) => lerp(cr[0], cr[1], sstep(0.3, 1.0, s)),
    keelFactor: tune.keelFactor ?? 1.2,
    rake: tune.rake ?? 0.3,
    livery,
  };
}

export function hullMeshes(shape: HullShape): Group {
  const g = new Group();
  const mat = hullMaterial(shape.livery.inner);
  const shell = new Mesh(loftShell(shape), mat);
  const transom = new Mesh(loftTransom(shape), mat);
  for (const m of [shell, transom]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** Translucent water pooled in the cockpit; scaled/tilted each frame. */
export function makeCockpitWater(spec: BoatSpec): Mesh {
  const co = spec.cockpit;
  const m = new NodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  const p = positionLocal;
  const ripple = sin(p.x.mul(9.0).add(shared.time.mul(2.4)))
    .mul(sin(p.z.mul(11.0).sub(shared.time.mul(1.9))))
    .mul(0.5)
    .add(0.5);
  const edge = smoothstep(0.5, 0.42, p.x.abs()).mul(1.0);
  void edge;
  const col = mix(vec3(0.16, 0.62, 0.7), vec3(0.45, 0.92, 0.9), ripple.mul(0.5));
  m.colorNode = vec4(col as N, float(0.78)) as N;
  const geo = new PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, m);
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.scale.set((co.x1 - co.x0) * 0.96, 1, co.halfWidth * 2 * 0.94);
  mesh.position.set((co.x0 + co.x1) / 2, co.soleY + 0.01, 0);
  mesh.name = 'cockpitWater';
  void uv;
  return mesh;
}

/** A flag on a pole: returns a pivot (rotated downwind each frame). */
export function makeFlag(w: number, h: number, c1: string, c2: string, bands = 3): Group {
  const pivot = new Group();
  const geo = new PlaneGeometry(w, h, 10, 3).translate(w / 2, 0, 0);
  const mesh = new Mesh(geo, flagMaterial(c1, c2, bands));
  mesh.castShadow = false;
  pivot.add(mesh);
  return pivot;
}

/** Red / green sidelights and a white stern light. */
export function navLights(pb: PartBuilder, port: V3, stbd: V3, stern?: V3): void {
  pb.sphere(bulb('#ff4d5e'), 0.06, { pos: port }, 8);
  pb.sphere(bulb('#4dff9a'), 0.06, { pos: stbd }, 8);
  if (stern) pb.sphere(bulb('#ffffff'), 0.06, { pos: stern }, 8);
}
