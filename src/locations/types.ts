// A Location is a place: pure data plus scenery builders, and no game rules.
//
// The physics and the shaders only ever see the analytic `fields` (bathymetry, land, obstacles, tide,
// swell exposure), so what the boat feels and what is drawn always agree. Each game mode decides what to
// *do* in a location (gates, fish, berths); the location just says what is there.
//
// Frame: +X = east, +Z = south, +Y up, sea level y = 0 (same as the Haulover geography it was lifted from).

import type { DataTexture, Group } from 'three/webgpu';
import type { Quality } from '../render/renderWorld';
import type { BerthMarker } from '../render/world/berthMarker';
import type { DockMarker } from '../render/world/dockMarker';
import type { Environment } from '../sim/environment';
import type { GeoGrid } from '../sim/geoGrid';

export interface Vec2 {
  x: number;
  z: number;
}

/** Extent of the baked grids and the cell size (m) of the height / exposure grids. */
export interface WorldExtents {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cell: number;
}

/** Everything the physics, the baked GPU textures and the obstacle code read about the sea. */
export interface SeaFields {
  /** Terrain / sea-floor height (m); negative = underwater. */
  seabedHeight(x: number, z: number): number;
  /** Signed distance to dry land (negative inside). */
  landSDF(x: number, z: number): number;
  /** Signed distance to the nearest hard obstacle: rocks, walls, piers, pilings. */
  hardSDF(x: number, z: number): number;
  hardNormal(x: number, z: number, out: Vec2): void;
  /** Floor kind for the water shader: 0 sand, 1 seagrass, 2 rock. */
  floorKind(x: number, z: number, h: number): number;
  /** 0..1: how much open-sea swell reaches this point. */
  swellExposure(x: number, z: number): number;
  /** 0..1: where a running ebb stands the waves up into haystacks (tide rips). */
  hayMask(x: number, z: number): number;
  /** Unit tidal flow (ebb positive) at a point. */
  currentUnit(x: number, z: number, out: Vec2): void;
}

/** A finger pier, as a rectangle in world space. */
export interface Dock {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** A round hard obstacle: an old timber piling or the hull of a moored boat. */
export interface Piling {
  x: number;
  z: number;
  r: number;
}

/** A boat tied up in a slip or lying to a mooring. */
export interface Moored {
  x: number;
  z: number;
  yaw: number;
  kind: 'console' | 'gofast' | 'cruiser' | 'charter' | 'sloop' | 'pontoon';
  length: number;
  beam: number;
  pal: number;
}

/**
 * Something to park at (Nantucket). The geometry of a berth is vessel-independent; `berthTarget`
 * (game/berthing.ts) turns it into the pose a particular vessel has to finish in.
 */
export type BerthKind = 'slip' | 'alongside' | 'mooring';

export interface Berth {
  id: string;
  label: string;
  kind: BerthKind;
  /**
   * Slip: the middle of the closed end. Alongside: the point on the quay face that the middle of the vessel
   * should lie against. Mooring: the ball.
   */
  x: number;
  z: number;
  /**
   * Slip: the heading that runs from the mouth towards the closed end. Alongside: the heading of the outward
   * normal (from the quay into the water). Mooring: unused.
   */
  dir: number;
  /** Slip: clear width between the fingers (m). Alongside: unused. Mooring: the radius the bow must reach (m). */
  width: number;
  /** Slip: its depth from mouth to head (m). Alongside: the usable length of the face (m). */
  length: number;
  /** Which way round a vessel may finish (alongside: along the quay either way, slips: bow-in or stern-in). */
  ends: 'either' | 'bow' | 'stern';
  /** Alongside: the heading of the run along the quay that the approach road arrives on. */
  travel?: number;
  /** Half-width of the world window the docking radar shows, centred on the berth (m). */
  radar: number;
  /** From open water to the berth's mouth: a hint for the player and the road for the test pilot. */
  approach: readonly (readonly [number, number])[];
}

/**
 * A slip to park in: an axis-aligned stall opening towards -x. (Nantucket generalises this to wharves,
 * mooring balls and arbitrary headings; see docs/ROADMAP.md, M3b.)
 */
export interface SlipBerth {
  id: string;
  label: string;
  z: number;
  x0: number;
  x1: number;
  half: number;
}

/** A harbour: finger piers, pilings, moored boats, the berths on offer and the lane in to them. */
export interface Harbor {
  docks: readonly Dock[];
  pilings: readonly Piling[];
  moored: readonly Moored[];
  berths: readonly SlipBerth[];
  /** The line through the pilings to the first berth, as (x, z) waypoints. */
  approach: readonly (readonly [number, number])[];
  /** The open fairway where harbour traffic circulates (an oval racetrack). */
  basinLoop: { x: number; z: number; rx: number; rz: number };
  /** World window the docking radar shows. */
  view: { x0: number; x1: number; z0: number; z1: number };
}

/** What the minimap draws on top of the sea floor. */
export interface MapFeatures {
  /** Bridge crossing the channel at this x. */
  bridgeX?: number;
  /** Rock jetties: x extent and the z of the jetty on a side at x. */
  jetties?: { x0: number; x1: number; z(side: -1 | 1, x: number): number };
}

/** Player and weather context handed to the ambient wildlife every frame. */
export interface WildlifeInput {
  /** Player boat. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Visibility of birdlife (0 in storms / at night). */
  fair: number;
  windX: number;
  windZ: number;
  windSpeed: number;
  waveHeight: (x: number, z: number) => number;
}

/** The dressed scene around the water, built by a location. */
export interface LocationProps {
  group: Group;
  update(dt: number, time: number, env: Environment): void;
  wildlife: { update(dt: number, inp: WildlifeInput): void };
  /** The glowing target berth (locations with a harbour). */
  dockMarker?: DockMarker;
  /** The glowing target berth for berth-based games (Nantucket). */
  berthMarker?: BerthMarker;
}

export interface Location {
  id: string;
  name: string;
  world: WorldExtents;
  /** Cell size (m) of the baked tidal-flow grid. */
  flowCell: number;
  fields: SeaFields;
  harbor?: Harbor;
  /** The berths on offer (Nantucket); Haulover's single slip lives in `harbor`. */
  berths?: readonly Berth[];
  map: MapFeatures;
  /** Half-width of the navigable corridor at x (hazard placement, hints). */
  corridorHalf(x: number): number;
  /** Where floating hazards must not be placed (the marina basin). */
  keepClear?(x: number, z: number): boolean;
  /** The land mesh. */
  buildTerrain(geo: GeoGrid, noise: DataTexture): Group;
  /** Scenery: buildings, vegetation, piers, birds. */
  buildProps(quality: Quality): LocationProps;
}
