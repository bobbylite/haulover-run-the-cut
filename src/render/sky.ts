import { cameraPosition, Fn, mix, normalize, positionWorld, vec4 } from 'three/tsl';
import { BackSide, Mesh, NodeMaterial, type PerspectiveCamera, SphereGeometry } from 'three/webgpu';
import type { Atmosphere } from './atmosphere';

/** Camera-centred sky dome: gradient + sun/moon + stars + painterly clouds. */
export class Sky {
  readonly mesh: Mesh;

  constructor(atmos: Atmosphere) {
    const mat = new NodeMaterial();
    mat.side = BackSide;
    mat.depthWrite = false;
    mat.fog = false;
    mat.fragmentNode = Fn(() => {
      const dir = normalize(positionWorld.sub(cameraPosition));
      const sky = atmos.skyToon(dir).toVar();
      sky.addAssign(atmos.sunGlow(dir));
      sky.addAssign(atmos.stars(dir));
      const cl = atmos.clouds(dir);
      sky.addAssign(atmos.sunDisc(dir).mul(cl.a.oneMinus()));
      sky.assign(mix(sky, cl.rgb, cl.a));
      return vec4(sky, 1.0);
    })();
    this.mesh = new Mesh(new SphereGeometry(9000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  update(camera: PerspectiveCamera): void {
    this.mesh.position.copy(camera.position);
  }
}
