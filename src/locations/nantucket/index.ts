// Nantucket Harbor, Massachusetts: the docking challenge's home. A thin adapter that presents the analytic
// geography, the town and the berths on offer as a `Location`.

import type { DataTexture } from 'three/webgpu';
import type { Quality } from '../../render/renderWorld';
import type { GeoGrid } from '../../sim/geoGrid';
import type { Location } from '../types';
import {
  BERTHS,
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
import { NantucketProps } from './props/world';
import { buildTerrain } from './terrain';

export const NANTUCKET: Location = {
  id: 'nantucket',
  name: 'Nantucket Harbor',
  world: WORLD,
  flowCell: FLOW_CELL,
  fields: { seabedHeight, landSDF, hardSDF, hardNormal, floorKind, swellExposure, hayMask, currentUnit },
  berths: BERTHS,
  map: {},
  corridorHalf: () => 300,
  buildTerrain: (geo: GeoGrid, noise: DataTexture) => buildTerrain(geo, noise),
  buildProps: (quality: Quality) => new NantucketProps(quality),
};
