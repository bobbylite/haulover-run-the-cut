// The Haulover rock jetties: rubble mound (instanced boulders), concrete walkway, lamps and the
// flashing red / green entrance beacons at the tips.

import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { clamp, noise2, Rng } from '../../../core/math';
import { bulb, flashBulb, gel, matte, metal } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { ToonMaterial } from '../../../render/toon';
import { type P3, sweep } from '../../../render/world/sweep';
import { JETTY_CREST, JETTY_HALF, JETTY_X0, JETTY_X1, jettyZ } from '../geography';

function rockGeometry(seed: number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 0.72 + 0.5 * noise2(x * 1.9 + seed, z * 1.9 + y * 1.3, seed + 3);
    p.setXYZ(i, x * n, y * n * 0.82, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildJetties(): Group {
  const g = new Group();
  g.name = 'jetties';
  const rng = new Rng(4242);
  const rockMat = new ToonMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const palette = ['#9aa3b5', '#b3a9c4', '#8c96a8', '#c4b7ad', '#a7b2c2', '#7f8aa0', '#cbbfb0'].map(
    (c) => new Color(c),
  );
  const geos = [rockGeometry(1), rockGeometry(7), rockGeometry(13)];
  const perSide = 1400;
  const m4 = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const pos = new Vector3();
  const col = new Color();

  for (const side of [-1, 1] as const) {
    const meshes = geos.map((geo) => new InstancedMesh(geo, rockMat, Math.ceil(perSide / geos.length) + 8));
    meshes.forEach((m) => {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    });
    for (let i = 0; i < perSide; i++) {
      const x = JETTY_X0 - 12 + rng.next() * (JETTY_X1 - JETTY_X0 + 24);
      const jz = jettyZ(side, Math.min(Math.max(x, JETTY_X0), JETTY_X1));
      const lat = (rng.next() * 2 - 1) * (JETTY_HALF + 4.5);
      const al = Math.abs(lat) / (JETTY_HALF + 4.5);
      // crest in the middle, sloping into the water on both sides, tapering at the ends
      const endTaper = clamp((x - JETTY_X0 + 12) / 22, 0, 1) * clamp((JETTY_X1 + 12 - x) / 18, 0, 1);
      const top = (JETTY_CREST - 0.5) * (1 - al ** 1.5) * endTaper;
      const size = (1.1 + rng.next() * 1.9) * (0.65 + 0.5 * (1 - al));
      pos.set(x, top - size * 0.15 - al * 0.8, jz + lat);
      q.set(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5, rng.next() + 0.3).normalize();
      sc.set(
        size * (0.9 + rng.next() * 0.5),
        size * (0.65 + rng.next() * 0.35),
        size * (0.9 + rng.next() * 0.5),
      );
      m4.compose(pos, q, sc);
      const mi = meshes[i % meshes.length] as InstancedMesh;
      mi.setMatrixAt(mi.count, m4);
      col
        .copy(palette[Math.floor(rng.next() * palette.length)] as Color)
        .multiplyScalar(0.82 + rng.next() * 0.3);
      mi.setColorAt(mi.count, col);
      mi.count++;
    }
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      g.add(m);
    }

    // concrete walkway along the crest
    const path: P3[] = [];
    for (let x = JETTY_X0 + 6; x <= JETTY_X1 - 4; x += 6) path.push([x, 0, jettyZ(side, x)]);
    const w = JETTY_HALF * 0.52;
    const walk = sweep(
      path,
      [
        [-w, JETTY_CREST + 0.18],
        [w, JETTY_CREST + 0.18],
      ],
      { flip: true },
    );
    const walkMesh = new Mesh(walk, matte('#efe8dd', 0.9));
    walkMesh.receiveShadow = true;
    walkMesh.frustumCulled = false;
    g.add(walkMesh);
    const curb = sweep(
      path,
      [
        [-w, JETTY_CREST + 0.12],
        [-w, JETTY_CREST + 0.36],
        [w, JETTY_CREST + 0.36],
        [w, JETTY_CREST + 0.12],
      ],
      { closed: true },
    );
    const curbMesh = new Mesh(curb, gel('#fff6ea', 0.5));
    curbMesh.frustumCulled = false;
    g.add(curbMesh);

    // lamps + the entrance beacon tower
    const pb = new PartBuilder();
    const pole = metal('#e9eef3', 0.35);
    for (let x = JETTY_X0 + 40; x < JETTY_X1 - 30; x += 46) {
      const z = jettyZ(side, x) - side * 0.6;
      pb.cyl(pole, 0.05, 0.08, 4.0, { pos: [x, JETTY_CREST + 2.2, z] }, 8);
      pb.sphere(bulb('#fff2c8', 8), 0.16, { pos: [x, JETTY_CREST + 4.2, z] }, 8);
    }
    const tipX = JETTY_X1 - 6;
    const tipZ = jettyZ(side, tipX);
    const tower = side === -1 ? gel('#ff7b88', 0.4) : gel('#44d9a8', 0.4);
    pb.cyl(gel('#fff8ee', 0.45), 0.55, 0.85, 9, { pos: [tipX, JETTY_CREST + 4.8, tipZ] }, 16);
    pb.cyl(tower, 0.57, 0.62, 1.2, { pos: [tipX, JETTY_CREST + 3.0, tipZ] }, 16);
    pb.cyl(tower, 0.52, 0.55, 1.2, { pos: [tipX, JETTY_CREST + 6.4, tipZ] }, 16);
    pb.cyl(metal(), 0.75, 0.75, 0.12, { pos: [tipX, JETTY_CREST + 9.35, tipZ] }, 16);
    pb.cyl(gel('#2b3341'), 0.5, 0.62, 0.35, { pos: [tipX, JETTY_CREST + 9.55, tipZ] }, 12);
    pb.sphere(
      flashBulb(side === -1 ? '#ff4d5e' : '#3dffa8', 4, side === -1 ? 0 : 0.5),
      0.46,
      { pos: [tipX, JETTY_CREST + 10.1, tipZ] },
      14,
    );
    pb.cone(metal(), 0.78, 0.5, { pos: [tipX, JETTY_CREST + 10.85, tipZ] }, 16);
    g.add(pb.build());
  }
  return g;
}
