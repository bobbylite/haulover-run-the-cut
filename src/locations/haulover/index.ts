// Haulover Inlet, Miami: the original Run the Cut location. A thin adapter that presents the analytic
// geography, the marina and the scenery as a `Location`.

import type { DataTexture } from 'three/webgpu';
import type { Quality } from '../../render/renderWorld';
import type { GeoGrid } from '../../sim/geoGrid';
import type { Harbor, Location } from '../types';
import {
  BASIN_LOOP,
  BRIDGE_X,
  currentUnit,
  cutHalfW,
  DOCK_APPROACH,
  DOCKS,
  FLOW_CELL,
  floorKind,
  hardNormal,
  hardSDF,
  hayMask,
  JETTY_X0,
  JETTY_X1,
  jettyZ,
  landSDF,
  MOORED,
  PILINGS,
  SLIP_BERTH,
  seabedHeight,
  swellExposure,
  WORLD,
} from './geography';
import { WorldProps } from './props/world';
import { buildTerrain } from './terrain';

const harbor: Harbor = {
  docks: DOCKS,
  pilings: PILINGS,
  moored: MOORED,
  berths: [SLIP_BERTH],
  approach: DOCK_APPROACH,
  basinLoop: BASIN_LOOP,
  view: { x0: -575, x1: -362, z0: 18, z1: 246 },
};

export const HAULOVER: Location = {
  id: 'haulover',
  name: 'Haulover Inlet',
  world: WORLD,
  flowCell: FLOW_CELL,
  fields: { seabedHeight, landSDF, hardSDF, hardNormal, floorKind, swellExposure, hayMask, currentUnit },
  harbor,
  map: { bridgeX: BRIDGE_X, jetties: { x0: JETTY_X0, x1: JETTY_X1, z: jettyZ } },
  corridorHalf: (x) => cutHalfW(Math.min(Math.max(x, -480), 480)),
  keepClear: (x, z) => x < -440 && z > 20,
  buildTerrain: (geo: GeoGrid, noise: DataTexture) => buildTerrain(geo, noise),
  buildProps: (quality: Quality) => new WorldProps(quality, SLIP_BERTH),
};
