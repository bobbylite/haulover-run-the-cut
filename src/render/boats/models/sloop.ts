// "Pelican 30": cruising sloop with a billowing, luffing main and jib driven by the sail physics.

import { float, positionLocal, sin, uniform, uv, vec3 } from 'three/tsl';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh } from 'three/webgpu';
import { sheerAt } from '../../../data/boats';
import type { BoatSpec } from '../../../sim/boatSpec';
import { shared } from '../../shared';
import { ToonMaterial } from '../../toon';
import {
  hullMeshes,
  hullOpts,
  type ModelParts,
  makeFlag,
  makeHullShape,
  navLights,
  type SailParts,
} from '../common';
import { gunwaleLine, hullStrip } from '../loft';
import { gel, glass, matte, metal, teak } from '../materials';
import { PartBuilder, type V3 } from '../parts';

type N = any;

interface SailUniforms {
  billow: ReturnType<typeof uniform>;
  luff: ReturnType<typeof uniform>;
  side: ReturnType<typeof uniform>;
}

/** Triangular sail on a (u, v) grid; the vertex shader adds camber (billow) and luff flutter. */
function sailMesh(
  tack: [number, number],
  head: [number, number],
  clew: [number, number],
  tint: string,
  u: SailUniforms,
  belly: number,
): Mesh {
  const NU = 16;
  const NV = 22;
  const pos: number[] = [];
  const uvs: number[] = [];
  const nor: number[] = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const lx = tack[0] + v * (head[0] - tack[0]);
    const ly = tack[1] + v * (head[1] - tack[1]);
    const rx = clew[0] + v * (head[0] - clew[0]);
    const ry = clew[1] + v * (head[1] - clew[1]);
    for (let i = 0; i <= NU; i++) {
      const t = i / NU;
      // roach on the leech
      const roach = Math.sin(Math.PI * v) * 0.18 * t * t;
      pos.push(lx + t * (rx - lx) - roach, ly + t * (ry - ly), 0);
      nor.push(0, 0, 1);
      uvs.push(t, v);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i;
      const b = a + 1;
      const c = a + NU + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);

  const m = new ToonMaterial({ roughness: 0.92, metalness: 0, side: DoubleSide });
  const c = new Color(tint);
  const t = uv().x;
  const v = uv().y;
  // camber: deepest around 40% chord, fading toward head
  const shape = sin(t.mul(Math.PI))
    .mul(float(1).sub(v.mul(0.5)))
    .mul(
      sin(v.min(0.92).mul(Math.PI * 0.95))
        .max(0.0)
        .pow(0.6),
    );
  const belly1 = shape.mul(u.billow as N).mul(belly);
  const flutter = sin(t.mul(13.0).sub(shared.time.mul(11.0)).add(v.mul(6.0)))
    .mul(t)
    .mul(float(0.12).add(shared.windSpeed.mul(0.016)))
    .mul(u.luff as N);
  const flutter2 = sin(t.mul(7.0).add(shared.time.mul(8.3)).sub(v.mul(4.0)))
    .mul(t.mul(t))
    .mul(0.08)
    .mul(u.luff as N);
  const dz = belly1
    .add(flutter)
    .add(flutter2)
    .mul(u.side as N);
  m.positionNode = positionLocal.add(vec3(0.0, 0.0, dz as N)) as N;
  // shade the pocket a little so the camber reads
  const shade = float(1).sub(shape.mul(u.billow as N).mul(0.16));
  m.colorNode = vec3(c.r, c.g, c.b).mul(shade) as N;
  const mesh = new Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildSloop(spec: BoatSpec): ModelParts {
  const o = hullOpts(spec);
  const sail = spec.sail!;
  const shape = makeHullShape(
    o,
    { top: '#fff6e6', stripe: '#ff8f7a', boot: '#37b5c4', bottom: '#2c8fa3', inner: '#fbf2e2' },
    { stripeFrom: 0.2, stripeTo: 0.34, deadrise: [0.35, 0.7], chine: [0.7, 0.3], keelFactor: 1.1, rake: 0.4 },
  );
  const root = new Group();
  root.add(hullMeshes(shape));

  const white = gel('#fff9ee');
  const coral = gel('#ff8f7a', 0.34);
  const mast = metal('#e2e8ee', 0.28);
  const rope = matte('#f0e6d6', 0.9);
  const pb = new PartBuilder();

  const deckMesh = new Mesh(
    hullStrip(shape, {
      s0: 0.245,
      s1: 0.995,
      y: (s) => sheerAt(o, s) - 0.07,
      camber: 0.07,
      inset: 0.0,
      steps: 22,
    }),
    teak('#dba56a', '#c48a55', 8),
  );
  const sole = new Mesh(
    hullStrip(shape, { s0: 0.03, s1: 0.25, y: 0.25, inset: 0.1, steps: 8 }),
    teak('#cf955d', '#b4784a', 6),
  );
  for (const m of [deckMesh, sole]) {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }
  for (const side of [-1, 1] as const) pb.tube(coral, gunwaleLine(shape, side, 0.0, 0.99, 30, 0.02), 0.04);

  // coachroof + cockpit coamings
  const deckY = sheerAt(o, 0.5) - 0.07;
  pb.box(white, 4.1, 0.55, 1.8, { pos: [-0.05, deckY + 0.27, 0] }, 0.2);
  for (const z of [-0.92, 0.92])
    pb.box(glass('#223f5a'), 2.8, 0.17, 0.03, { pos: [-0.05, deckY + 0.34, z] }, 0.015);
  pb.box(white, 0.7, 0.4, 1.0, { pos: [-2.2, deckY + 0.35, 0] }, 0.12);
  for (const z of [-1.17, 1.17]) pb.box(white, 2.1, 0.3, 0.1, { pos: [-3.15, 0.95, z] }, 0.04);
  // pedestal wheel
  pb.cyl(white, 0.07, 0.09, 0.9, { pos: [-3.7, 0.7, 0] });

  // keel + rudder
  pb.box(gel('#6f8294'), 0.16, 1.35, 1.8, { pos: [0.3, -1.0, 0] }, 0.05);
  pb.capsule(gel('#4f6275'), 0.2, 0.9, { pos: [0.3, -1.72, 0], rot: [0, 0, Math.PI / 2] });
  pb.box(white, 0.07, 1.0, 0.55, { pos: [-4.0, -0.6, 0] }, 0.03);

  // mast + standing rigging
  const mastX = sail.mastX;
  const top = sail.mastHeight;
  pb.cyl(mast, 0.045, 0.075, top, { pos: [mastX, deckY + top / 2, 0] }, 10);
  const tip: V3 = [mastX, deckY + top, 0];
  pb.rod(rope, tip, [4.6, deckY + 0.05, 0], 0.012);
  pb.rod(rope, tip, [-4.3, deckY + 0.05, 0], 0.012);
  for (const z of [-1.3, 1.3]) {
    pb.rod(rope, [mastX, deckY + 9.2, 0], [mastX - 0.2, deckY + 0.05, z], 0.01);
    pb.rod(rope, [mastX, deckY + 6.2, 0], [mastX + 0.6, deckY + 0.05, z], 0.01);
    pb.rod(mast, [mastX, deckY + 8.4, 0], [mastX - 0.05, deckY + 8.4, z * 0.45], 0.014);
  }
  // pulpits / stanchions
  for (const side of [-1, 1] as const) {
    const pts = gunwaleLine(shape, side, 0.28, 0.93, 14, 0.62).map(([x, y, z]) => [x, y, z * 0.92] as V3);
    pb.tube(mast, pts, 0.015);
    for (let i = 0; i < pts.length; i += 3)
      pb.rod(mast, [pts[i]![0], pts[i]![1] - 0.62, pts[i]![2]], pts[i]!, 0.012, 6);
  }
  navLights(
    pb,
    [3.4, sheerAt(o, 0.9) + 0.04, -0.7],
    [3.4, sheerAt(o, 0.9) + 0.04, 0.7],
    [mastX, deckY + top - 0.3, 0.05],
  );
  root.add(pb.build());

  // sails
  const uMain: SailUniforms = { billow: uniform(0.3), luff: uniform(0), side: uniform(1) };
  const uJib: SailUniforms = { billow: uniform(0.3), luff: uniform(0), side: uniform(1) };
  const boom = new Group();
  boom.position.set(mastX, deckY + 1.55, 0);
  const boomRod = new PartBuilder();
  boomRod.rod(mast, [0, 0, 0], [-4.0, 0, 0], 0.045, 8);
  boom.add(boomRod.build());
  boom.add(sailMesh([0.0, 0.05], [0.0, top - 1.9], [-3.9, 0.12], '#fffaf0', uMain, 0.55));
  root.add(boom);

  const jib = new Group();
  jib.position.set(4.5, deckY + 0.15, 0);
  jib.add(sailMesh([0, 0], [-3.55, top - 1.1], [-4.1, 0.55], '#ffffff', uJib, 0.45));
  root.add(jib);

  const burgee = makeFlag(0.55, 0.26, '#ff8f7a', '#fff9ee', 2);
  burgee.position.set(mastX, deckY + top + 0.1, 0);
  const ensign = makeFlag(0.5, 0.3, '#37b5c4', '#fff9ee', 3);
  ensign.position.set(-4.35, 1.9, 0);
  root.add(burgee, ensign);

  // steering wheel (rotates with the helm)
  const wheel = new Group();
  const wpb = new PartBuilder();
  wpb.torus(metal('#c9d2da'), 0.3, 0.025, { rot: [0, Math.PI / 2, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    wpb.rod(metal('#c9d2da'), [0, 0, 0], [0, Math.cos(a) * 0.3, Math.sin(a) * 0.3], 0.012);
  }
  wheel.add(wpb.build(false));
  wheel.position.set(-3.7, 1.28, 0);
  root.add(wheel);

  const sailParts: SailParts = {
    boom,
    jib,
    uBillow: {
      get value() {
        return uMain.billow.value as number;
      },
      set value(v: number) {
        uMain.billow.value = v;
        uJib.billow.value = v;
      },
    },
    uLuff: {
      get value() {
        return uMain.luff.value as number;
      },
      set value(v: number) {
        uMain.luff.value = v;
        uJib.luff.value = v;
      },
    },
    uSide: {
      get value() {
        return uMain.side.value as number;
      },
      set value(v: number) {
        uMain.side.value = v;
        uJib.side.value = v;
      },
    },
  };
  return { group: root, engines: [], flags: [burgee, ensign], sail: sailParts, wheel };
}
