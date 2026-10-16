// Montauk Point Light: an octagonal white tower with its brown band, the lantern glowing on top, and the
// keeper's house and outbuildings on the hill beneath it.

import { Color, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, type Object3D } from 'three/webgpu';
import { bulb, gel, glass, matte, metal } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { LIGHTHOUSE, seabedHeight } from '../geography';

export class Lighthouse {
  readonly group = new Group();
  private readonly beam: Object3D;

  constructor() {
    this.group.name = 'lighthouse';
    const base = seabedHeight(LIGHTHOUSE.x, LIGHTHOUSE.z);
    const white = gel('#fdf8f2', 0.55);
    const brown = gel('#c98f86', 0.55);
    const trim = matte('#8b6672', 0.8);
    const roof = gel('#e58a92', 0.45);
    const pb = new PartBuilder();

    // the tower: three tapered octagonal drums (white / brown band / white)
    const seg = (y0: number, y1: number, r0: number, r1: number, mat: ReturnType<typeof gel>) =>
      pb.add(new CylinderGeometry(r1, r0, y1 - y0, 8, 1), mat, {
        pos: [0, (y0 + y1) / 2, 0],
        rot: [0, 0.39, 0],
      });
    seg(0, 10, 4.7, 4.1, white);
    seg(10, 19, 4.1, 3.55, brown);
    seg(19, 28, 3.55, 3.05, white);
    // a stout plinth and the keeper's door
    pb.cyl(trim, 5.1, 5.4, 1.8, { pos: [0, 0.9, 0] }, 8);
    pb.box(matte('#6b5160'), 1.2, 2.2, 0.5, { pos: [0, 2.3, 4.55] }, 0.1);
    // gallery, railing and lantern room
    pb.cyl(trim, 4.2, 3.3, 0.7, { pos: [0, 28.35, 0] }, 8);
    pb.cyl(trim, 4.35, 4.35, 0.14, { pos: [0, 29.55, 0] }, 24);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pb.cyl(trim, 0.05, 0.05, 1.2, { pos: [Math.cos(a) * 4.2, 28.9, Math.sin(a) * 4.2] }, 5);
    }
    pb.cyl(glass('#cfe9f2'), 2.0, 2.0, 3.0, { pos: [0, 30.0, 0] }, 12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pb.cyl(trim, 0.07, 0.07, 3.1, { pos: [Math.cos(a) * 2.0, 30.0, Math.sin(a) * 2.0] }, 5);
    }
    pb.add(new CylinderGeometry(0.2, 2.5, 1.8, 12, 1), roof, { pos: [0, 32.4, 0] });
    pb.sphere(metal('#f3dfe0'), 0.35, { pos: [0, 33.5, 0] }, 10);
    pb.cyl(metal('#f3dfe0'), 0.04, 0.04, 1.2, { pos: [0, 34.2, 0] }, 5);
    pb.sphere(bulb('#fff0c0', 10), 0.8, { pos: [0, 30.0, 0] }, 12);
    this.group.add(pb.build());

    // the swinging beam, only really there at dusk
    const beamMat = new MeshBasicNodeMaterial();
    beamMat.transparent = true;
    beamMat.depthWrite = false;
    beamMat.color = new Color('#fff3cf');
    beamMat.opacity = 0.16;
    const beam = new Mesh(new CylinderGeometry(0.4, 5.5, 160, 10, 1, true), beamMat);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(80, 0, 0);
    const pivot = new Group();
    pivot.position.set(0, 30, 0);
    pivot.add(beam);
    this.beam = pivot;
    this.group.add(pivot);

    this.group.position.set(LIGHTHOUSE.x, base, LIGHTHOUSE.z);

    // the keeper's house, a barn, and a path of white stones
    const houseAt = (dx: number, dz: number, w: number, d: number, yaw: number, wall: string, rf: string) => {
      const hb = new PartBuilder();
      const wallM = gel(wall, 0.6);
      hb.box(wallM, w, 5.2, d, { pos: [0, 2.6, 0] }, 0.2);
      hb.box(gel(rf, 0.5), w + 1.4, 0.5, d * 0.58, { pos: [0, 6.2, -d * 0.2], rot: [0.62, 0, 0] }, 0.1);
      hb.box(gel(rf, 0.5), w + 1.4, 0.5, d * 0.58, { pos: [0, 6.2, d * 0.2], rot: [-0.62, 0, 0] }, 0.1);
      hb.box(wallM, w, 1.6, 0.4, { pos: [0, 5.2, -d / 2 + 0.2] }, 0.1);
      for (const sx of [-0.28, 0.28]) {
        hb.box(glass('#6f93b8'), 1.1, 1.5, 0.12, { pos: [w * sx, 3.0, d / 2 + 0.05] }, 0.04);
        hb.box(matte('#fffdf8'), 1.5, 1.9, 0.08, { pos: [w * sx, 3.0, d / 2 + 0.02] }, 0.04);
      }
      hb.box(matte('#fff'), 1.0, 2.1, 0.12, { pos: [0, 1.15, d / 2 + 0.05] }, 0.04);
      hb.cyl(matte('#d9a09a'), 0.6, 0.6, 3.6, { pos: [w * 0.3, 7.6, 0] }, 6);
      const g = hb.build();
      g.position.set(dx, 0, dz);
      g.rotation.y = yaw;
      return g;
    };
    this.group.add(houseAt(-17, 14, 15, 8, 0.1, '#fdf6ee', '#e8a09c'));
    this.group.add(houseAt(-9, -21, 9, 6, -0.2, '#f4ece6', '#c9a0b8'));
    this.group.add(houseAt(14, 19, 7, 5, 0.3, '#fdf6ee', '#e8a09c'));
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  update(time: number): void {
    this.beam.rotation.y = time * 0.7;
  }
}
