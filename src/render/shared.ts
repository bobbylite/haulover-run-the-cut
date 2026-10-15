// Uniforms shared by every material that reacts to the sky / wind (water, clouds, sails, flags, palms).

import { uniform } from 'three/tsl';
import { Color, Vector2, Vector3 } from 'three/webgpu';

export const shared = {
  /** Game clock (s). */
  time: uniform(0),
  /** Wind velocity (towards), m/s, as (x, z). */
  wind: uniform(new Vector2(-1, 0)),
  windSpeed: uniform(5),
  /** 0 day .. 1 night: drives emissive lights. */
  night: uniform(0),
  /** Unit vector towards the sun (or moon). */
  sunDir: uniform(new Vector3(0, 1, 0)),
  sunColor: uniform(new Color(1, 1, 1)),
  /** Camera world position for LOD-ish effects. */
  focus: uniform(new Vector3()),
};
