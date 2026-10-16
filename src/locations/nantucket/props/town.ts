// The town behind the bulkhead: rows of grey-shingled houses with white trim, a church with its tower, the
// big hotel by the Steamship terminal, and elms along the streets. One merged mesh per kind of thing.

import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry } from 'three/webgpu';
import { Rng } from '../../../core/math';
import { gel, matte } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { gableGeometry, type Placement, scatterMesh } from '../../../render/propKit';
import { ToonMaterial } from '../../../render/toon';
import { BUILDINGS, QUAY_TOP, seabedHeight, TREES } from '../geography';

const WALL = ['#cfcbe0', '#d9d4c8', '#c9d8d8', '#e3cdd2', '#d6d9ec', '#dcd2e6'].map((c) => new Color(c));
const ROOF = ['#8f8aa6', '#7aa6b8', '#c98f86', '#9a94b8', '#86a8a0'].map((c) => new Color(c));
const TREE = ['#79bd8f', '#8fcf8a', '#9bc8a0', '#7fb89a', '#a3d48a'].map((c) => new Color(c));

export function buildTown(quality: 'low' | 'medium' | 'high'): Group {
  const group = new Group();
  group.name = 'town';
  const rng = new Rng(97);
  const std = new ToonMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });

  const walls: Placement[] = [];
  const roofs: Placement[] = [];
  const trims: Placement[] = [];
  for (const b of BUILDINGS) {
    if (b.kind >= 2) continue; // the landmarks are built by hand below
    const base = Math.max(QUAY_TOP, seabedHeight(b.x, b.z));
    const wall = WALL[rng.int(0, WALL.length - 1)] as Color;
    const roof = ROOF[rng.int(0, ROOF.length - 1)] as Color;
    walls.push({ x: b.x, y: base + b.h / 2, z: b.z, sx: b.w, sy: b.h, sz: b.d, yaw: b.yaw, color: wall });
    roofs.push({
      x: b.x,
      y: base + b.h + b.d * 0.22,
      z: b.z,
      sx: b.w + 1.4,
      sy: b.d * 0.44,
      sz: b.d + 1.6,
      yaw: b.yaw,
      color: roof,
    });
    // white trim band under the eaves and a pastel door
    trims.push({
      x: b.x,
      y: base + b.h - 0.35,
      z: b.z,
      sx: b.w + 0.25,
      sy: 0.5,
      sz: b.d + 0.25,
      yaw: b.yaw,
      color: new Color('#fffaf3'),
    });
    // a chimney now and then
    if (rng.next() < 0.5)
      trims.push({
        x: b.x + (rng.next() - 0.5) * b.w * 0.5,
        y: base + b.h + b.d * 0.34,
        z: b.z,
        sx: 0.9,
        sy: 2.4,
        sz: 0.9,
        yaw: 0,
        color: new Color('#b49aa4'),
      });
  }
  group.add(
    scatterMesh(new BoxGeometry(1, 1, 1), walls, std),
    scatterMesh(gableGeometry(), roofs, std),
    scatterMesh(new BoxGeometry(1, 1, 1), trims, std),
  );

  // landmarks: the church, its tower and spire, and the hotel
  const pb = new PartBuilder();
  const white = gel('#fffaf3', 0.6);
  const slate = gel('#8f8aa6', 0.5);
  const coral = gel('#ff9f8a', 0.5);
  const glass = gel('#2b3d56', 0.2);
  const pastel = gel('#e3cdd2', 0.6);
  for (const b of BUILDINGS) {
    if (b.kind === 2) {
      const base = Math.max(QUAY_TOP, seabedHeight(b.x, b.z));
      pb.box(white, b.w, 9, b.d, { pos: [b.x, base + 4.5, b.z] }, 0.3);
      pb.add(gableGeometry(), slate, { pos: [b.x, base + 9 + 2.4, b.z], scale: [b.w + 1, 4.8, b.d + 1] });
      // the tower on the waterfront end
      pb.box(white, 6.5, 18, 6.5, { pos: [b.x, base + 9, b.z - b.d / 2 - 1.5] }, 0.3);
      pb.box(coral, 7.3, 1.2, 7.3, { pos: [b.x, base + 18.2, b.z - b.d / 2 - 1.5] }, 0.2);
      pb.add(new ConeGeometry(3.6, 9, 4, 1), slate, {
        pos: [b.x, base + 23.2, b.z - b.d / 2 - 1.5],
        rot: [0, Math.PI / 4, 0],
      });
      pb.sphere(gel('#ffd45e', 0.3), 0.5, { pos: [b.x, base + 28.2, b.z - b.d / 2 - 1.5] }, 8);
      for (let i = -2; i <= 2; i++)
        pb.box(glass, 1.2, 2.6, 0.14, { pos: [b.x + i * 3, base + 4.5, b.z - b.d / 2 - 0.05] }, 0.04);
    } else if (b.kind === 3) {
      const base = QUAY_TOP;
      pb.box(pastel, b.w, b.h, b.d, { pos: [b.x, base + b.h / 2, b.z] }, 0.3);
      pb.add(gableGeometry(), slate, { pos: [b.x, base + b.h + 2, b.z], scale: [b.w + 1.5, 4, b.d + 1.5] });
      pb.box(white, b.w + 0.3, 0.6, b.d + 0.3, { pos: [b.x, base + b.h - 0.4, b.z] }, 0.1);
      pb.box(coral, b.w + 0.3, 0.8, b.d + 0.3, { pos: [b.x, base + 3.4, b.z] }, 0.1);
      for (let f = 0; f < 2; f++)
        for (let i = -9; i <= 9; i++)
          pb.box(
            glass,
            1.3,
            1.5,
            0.14,
            { pos: [b.x + i * 2.4, base + 5 + f * 2.9, b.z - b.d / 2 - 0.05] },
            0.04,
          );
    }
  }
  group.add(pb.build());

  // elms: a trunk and a rounded crown
  const crowns: Placement[] = [];
  const trunks: Placement[] = [];
  const want = quality === 'low' ? 60 : TREES.length;
  for (const [x, z, s] of TREES.slice(0, want)) {
    const h = seabedHeight(x, z);
    trunks.push({
      x,
      y: h + s * 0.45,
      z,
      sx: 0.45,
      sy: s * 0.9,
      sz: 0.45,
      yaw: 0,
      color: new Color('#a58e8a'),
    });
    crowns.push({
      x,
      y: h + s * 1.35,
      z,
      sx: s * 0.95,
      sy: s * 0.85,
      sz: s * 0.95,
      yaw: rng.next() * 6.28,
      color: TREE[rng.int(0, TREE.length - 1)] as Color,
    });
  }
  group.add(
    scatterMesh(new CylinderGeometry(1, 1.2, 1, 6, 1), trunks, std),
    scatterMesh(new IcosahedronGeometry(1, 1), crowns, std),
  );
  void matte;
  return group;
}
