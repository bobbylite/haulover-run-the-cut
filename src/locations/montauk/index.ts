// Montauk Point, New York: where the Atlantic ebb meets an easterly breeze and the tuna wait on the rips.
// A thin adapter that presents the analytic geography, the scenery and the fishing grounds as a `Location`.

import type { DataTexture } from 'three/webgpu';
import type { Quality } from '../../render/renderWorld';
import type { GeoGrid } from '../../sim/geoGrid';
import type { Location } from '../types';
import {
  currentUnit,
  FLOW_CELL,
  floorKind,
  hardNormal,
  hardSDF,
  hayMask,
  landSDF,
  seabedHeight,
  swellExposure,
  WORLD,
} from './geography';
import { MontaukProps } from './props/world';
import { buildTerrain } from './terrain';

export const MONTAUK: Location = {
  id: 'montauk',
  name: 'Montauk Point',
  world: WORLD,
  flowCell: FLOW_CELL,
  fields: { seabedHeight, landSDF, hardSDF, hardNormal, floorKind, swellExposure, hayMask, currentUnit },
  map: {},
  corridorHalf: () => 900,
  buildTerrain: (geo: GeoGrid, noise: DataTexture) => buildTerrain(geo, noise),
  buildProps: (quality: Quality) => new MontaukProps(quality),
};
