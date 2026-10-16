// Physical description of a vessel. All lengths in metres, forces in newtons, local frame:
//   +X = bow, +Y = up, +Z = starboard. Origin = centre of the design waterline.

export interface HullSample {
  x: number;
  y: number; // underside of the cell
  z: number;
  /** Buoyancy stiffness, N per metre of immersion. */
  k: number;
  /** Vertical damping, N*s/m. */
  c: number;
  /** Maximum useful immersion (hull depth above the sample), m. */
  cell: number;
  /** Share of dynamic planing lift carried by this sample (sums to 1). */
  lift: number;
  /** Quadratic drag areas (N per (m/s)^2) for forward and lateral flow. */
  dragX: number;
  dragZ: number;
}

export interface Weir {
  x: number;
  y: number;
  z: number;
  /** Effective weir width (m) used for green-water inflow. */
  width: number;
  /** Bow-ish: also catches slam spray. */
  bow: boolean;
}

export interface Bumper {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface EngineSpec {
  /** Prop position (local). */
  x: number;
  y: number;
  /** Static thrust at full throttle (N) and speed at which thrust has fallen to zero (m/s). */
  thrust: number;
  zeroThrustSpeed: number;
  reverse: number;
  /** Max steering angle (rad) and how quickly it slews (rad/s). */
  steerMax: number;
  steerRate: number;
  /** Rudder lift coefficient: lateral force N per (m/s)^2 per radian. */
  rudder: number;
  /** Engine character for audio. */
  sound: 'outboard' | 'v8' | 'diesel' | 'sail';
  /** Cut-off steering authority at low speed (prop wash steering for outboards). */
  washSteer: number;
}

export interface SailSpec {
  area: number;
  /** Centre of effort (local). */
  x: number;
  y: number;
  /** Mast base and height for the visual. */
  mastX: number;
  mastHeight: number;
}

export interface Cockpit {
  /** Plan rectangle of the cockpit well (local). */
  x0: number;
  x1: number;
  halfWidth: number;
  soleY: number;
  /** Scupper area (m^2) draining the well. */
  scupper: number;
  /** Where the scuppers dump (local x, z) to sample the outside water level. */
  scupperX: number;
}

export interface BoatSpec {
  id: 'console' | 'gofast' | 'cruiser' | 'charter' | 'sloop' | 'pontoon';
  name: string;
  short: string;
  tagline: string;
  blurb: string;
  length: number;
  beam: number;
  mass: number;
  draft: number;
  /** Centre of gravity (local). */
  cg: [number, number, number];
  /** Radii of gyration factors -> inertia (roll, yaw, pitch). */
  inertia: [number, number, number];
  samples: HullSample[];
  weirs: Weir[];
  bumpers: Bumper[];
  engine: EngineSpec;
  sail?: SailSpec;
  cockpit: Cockpit;
  /** Dry hull windage: frontal & side areas (m^2), drag coeffs, height of centre of effort (local y). */
  wind: { front: number; side: number; cdFront: number; cdSide: number; ceX: number; ceY: number };
  /** Progressive buoyancy (V-hull / flare): stiffness grows with immersion, per metre. */
  flare: number;
  /** Lateral keel / skeg drag multiplier. */
  keel: number;
  /** Depth of the lowest part of the hull / keel below the waterline (for grounding). */
  keelDepth: number;
  /** Angular damping (roll, yaw, pitch) in N*m*s/rad. */
  angDamp: [number, number, number];
  /** Natural flooding volume in litres, and virtual added-mass factor for the water inside. */
  capacity: number;
  waterMassScale: number;
  /** Bilge pump rate (L/s). */
  pump: number;
  /** Planing: speed (m/s) at which dynamic lift reaches design value and fraction of weight carried. */
  planing: { speed: number; fraction: number; aoa: number };
  /** Resistance hump near the transition to planing (drag multiplier gain at `speed`). */
  hump: { speed: number; width: number; gain: number };
  /** Displacement hull speed (m/s): resistance climbs steeply past it. Absent on planing hulls. */
  hullSpeed?: number;
  /** Running trim: bow-up angle (rad) once planing, extra bow-up while climbing the hump, and torque gain. */
  trim: { plane: number; hump: number; gain: number };
  /** Nominal top speed (m/s) for UI and AI. */
  topSpeed: number;
  /** Chase camera. */
  camera: { distance: number; height: number; look: number; helm: [number, number, number] };
  /** UI stat bars 0..1. */
  stats: {
    speed: number;
    handling: number;
    stability: number;
    dryness: number;
    windage: number;
    /** How hard the tidal current shoves this hull around. */
    tide: number;
  };
  /** Wave-impact speed (m/s) the hull shrugs off; anything harder wears the hull down. */
  strength: number;
  /** How hard the boat is to drive well, 1 (forgiving) to 5 (expert). */
  skill: 1 | 2 | 3 | 4 | 5;
  /** Score multiplier for taking the harder boat. */
  scoreMult: number;
}

export const SKILL_LABELS = ['', 'Easy', 'Easy', 'Moderate', 'Hard', 'Expert'] as const;

export const RHO_W = 1025;
export const RHO_A = 1.2;
