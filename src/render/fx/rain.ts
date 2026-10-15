// Rain: thousands of streaks around the camera, animated entirely in the vertex shader (stateless,
// so there is no CPU cost). Slanted by the live wind and thinned by the rain intensity uniform.

import { attribute, cameraPosition, float, fract, length, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import { BufferAttribute, BufferGeometry, LineBasicNodeMaterial, LineSegments } from 'three/webgpu';
import { Rng } from '../../core/math';
import { shared } from '../shared';

type N = any;

export class Rain {
  readonly mesh: LineSegments;
  /** 0..1 */
  readonly intensity = uniform(0);

  constructor(count = 9000) {
    const rng = new Rng(7);
    const seed = new Float32Array(count * 2 * 4);
    const end = new Float32Array(count * 2);
    const pos = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const a = rng.next();
      const b = rng.next();
      const c = rng.next();
      const d = rng.next();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        seed.set([a, b, c, d], j * 4);
        end[j] = k;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 4));
    g.setAttribute('aEnd', new BufferAttribute(end, 1));

    const R = 38;
    const H = 30;
    const fall = 13;
    const m = new LineBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    const aSeed: N = attribute('aSeed', 'vec4');
    const aEnd: N = attribute('aEnd', 'float');
    const cam = cameraPosition as N;
    const wind = shared.wind as N;
    const phase: N = fract(aSeed.z.add((shared.time as N).mul(fall / H)));
    const y: N = cam.y.add(H * 0.5).sub(phase.mul(H));
    // world-fixed lattice wrapping around the camera
    const offX: N = aSeed.x
      .mul(2 * R)
      .sub(cam.x)
      .add(R)
      .mod(2 * R)
      .sub(R);
    const offZ: N = aSeed.y
      .mul(2 * R)
      .sub(cam.z)
      .add(R)
      .mod(2 * R)
      .sub(R);
    // slant: drift with the wind as the drop falls
    const slant: N = (shared.windSpeed as N).mul(0.045);
    const dx: N = (wind.x as N).mul(slant);
    const dz: N = (wind.y as N).mul(slant);
    const streak: N = float(0.9).add((shared.windSpeed as N).mul(0.05));
    const along: N = aEnd.mul(streak);
    const px: N = cam.x
      .add(offX)
      .sub(dx.mul(along))
      .add(dx.mul(phase.mul(H)).mul(0.25));
    const pz: N = cam.z
      .add(offZ)
      .sub(dz.mul(along))
      .add(dz.mul(phase.mul(H)).mul(0.25));
    const py: N = y.add(along.mul(fall * 0.1));
    // thin out by intensity: each drop has its own threshold
    const keep: N = smoothstep(0.0, 0.001, (this.intensity as N).sub(aSeed.w));
    m.positionNode = mix(vec3(cam.x, cam.y.add(500.0), cam.z), vec3(px, py, pz), keep) as N;
    const dist: N = length(vec3(offX, y.sub(cam.y), offZ));
    const fade: N = float(1)
      .sub(smoothstep(R * 0.35, R, dist))
      .mul(smoothstep(1.2, 4.0, dist));
    m.colorNode = vec3(0.82, 0.9, 1.0) as N;
    m.opacityNode = fade.mul((this.intensity as N).mul(0.5).add(0.12)).mul(0.6) as N;
    this.mesh = new LineSegments(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'rain';
  }
}
