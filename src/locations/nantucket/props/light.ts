// Brant Point Light: the little white tower at the tip of the spit, a coral lantern roof, and the keeper's
// cottage behind it. Its lamp flashes at dusk so the harbour mouth can be found in the fog.

import { Color, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { flashBulb, gel, glass, matte, metal } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';
import { gableGeometry } from '../../../render/propKit';
import { LIGHT, seabedHeight } from '../geography';

export class BrantLight {
  readonly group = new Group();
  private readonly beam: Mesh;

  constructor() {
    this.group.name = 'brantLight';
    const base = Math.max(0.6, seabedHeight(LIGHT.x, LIGHT.z));
    const white = gel('#fdf8f2', 0.55);
    const coral = gel('#ff8f7a', 0.45);
    const stone = matte('#b9b3c9', 0.9);
    const trim = matte('#8b7f9e', 0.8);
    const pb = new PartBuilder();
    // granite footing, tapered tower, gallery, lantern and roof
    pb.cyl(stone, 3.2, 3.6, 1.6, { pos: [LIGHT.x, base + 0.8, LIGHT.z] }, 10);
    pb.add(new CylinderGeometry(1.7, 2.6, 8.6, 10, 1), white, { pos: [LIGHT.x, base + 5.9, LIGHT.z] });
    pb.cyl(trim, 2.6, 2.2, 0.5, { pos: [LIGHT.x, base + 10.4, LIGHT.z] }, 10);
    pb.cyl(trim, 2.7, 2.7, 0.1, { pos: [LIGHT.x, base + 11.35, LIGHT.z] }, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pb.cyl(
        trim,
        0.04,
        0.04,
        0.9,
        { pos: [LIGHT.x + Math.cos(a) * 2.6, base + 10.85, LIGHT.z + Math.sin(a) * 2.6] },
        5,
      );
    }
    pb.cyl(glass('#cfe9f2'), 1.35, 1.35, 2.0, { pos: [LIGHT.x, base + 12.1, LIGHT.z] }, 10);
    pb.add(new CylinderGeometry(0.15, 1.7, 1.4, 10, 1), coral, { pos: [LIGHT.x, base + 13.8, LIGHT.z] });
    pb.sphere(metal('#f3dfe0'), 0.22, { pos: [LIGHT.x, base + 14.65, LIGHT.z] }, 8);
    pb.sphere(flashBulb('#fff0c0', 5, 0), 0.55, { pos: [LIGHT.x, base + 12.1, LIGHT.z] }, 10);
    // the keeper's cottage, with its red-coral roof
    const cx = LIGHT.x - 24;
    const cz = LIGHT.z + 6;
    pb.box(white, 9, 4, 6.4, { pos: [cx, base + 2, cz] }, 0.2);
    pb.add(gableGeometry(), coral, { pos: [cx, base + 5, cz], scale: [10, 2.4, 7.6] });
    pb.box(matte('#6b5160'), 1.1, 2, 0.2, { pos: [cx + 1.5, base + 1.1, cz - 3.25] }, 0.05);
    this.group.add(pb.build());

    // the swinging beam, only really there at dusk
    const beamMat = new MeshBasicNodeMaterial();
    beamMat.transparent = true;
    beamMat.depthWrite = false;
    beamMat.color = new Color('#fff3cf');
    beamMat.opacity = 0.14;
    this.beam = new Mesh(new CylinderGeometry(0.3, 4.5, 110, 10, 1, true), beamMat);
    this.beam.rotation.z = Math.PI / 2;
    this.beam.position.set(55, 0, 0);
    const pivot = new Group();
    pivot.add(this.beam);
    pivot.position.set(LIGHT.x, base + 12.1, LIGHT.z);
    this.group.add(pivot);
    this.pivot = pivot;
    this.group.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  private readonly pivot: Group;

  update(time: number, night: number): void {
    this.pivot.rotation.y = time * 0.7;
    this.beam.visible = night > 0.2;
  }
}
