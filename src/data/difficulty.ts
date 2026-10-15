// Difficulty decides how much water a vessel may take on before it is swamped (and how rough the
// tide / seas are allowed to get). Capacity is a fraction of each boat's physical flooding volume.

export interface Difficulty {
  id: 'dockside' | 'weekender' | 'captain' | 'legend';
  name: string;
  blurb: string;
  /** Fraction of the hull's natural capacity you may ship before sinking. */
  capacity: number;
  waveScale: number;
  currentScale: number;
  /** Multiplier on the mean wind (and gustiness). */
  windScale: number;
  /** Multiplier for leaks from collisions. */
  leakScale: number;
  /** Auto-bilge helps pump when enabled (fraction of the manual pump rate). */
  autoBilge: number;
  /** Score multiplier. */
  score: number;
  /** Gate width multiplier (narrower = harder). */
  gateScale: number;
  /** Seconds added for every missed gate. */
  missPenalty: number;
  /** Run time limit as a multiple of the par time. */
  timeLimit: number;
  /** Multiplier on how many other boats work the Cut. */
  traffic: number;
  /** Floating hazards (crab-pot floats, drift logs) per kilometre of course. */
  hazards: number;
  /** Seconds allowed for the docking challenge. */
  dockTime: number;
}

export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: 'dockside',
    name: 'Dockside',
    blurb: 'A forgiving first run. Bigger bilge, auto-pump, fewer boats.',
    capacity: 0.6,
    waveScale: 1.0,
    currentScale: 1.0,
    windScale: 1.0,
    leakScale: 1.0,
    autoBilge: 0.2,
    score: 0.8,
    gateScale: 1.0,
    missPenalty: 8,
    timeLimit: 2.1,
    traffic: 0.6,
    hazards: 3,
    dockTime: 150,
  },
  {
    id: 'weekender',
    name: 'Weekender',
    blurb: 'A real fight. Steep seas, busy water, tight gates and a clock.',
    capacity: 0.36,
    waveScale: 1.12,
    currentScale: 1.12,
    windScale: 1.08,
    leakScale: 1.4,
    autoBilge: 0.06,
    score: 1,
    gateScale: 0.85,
    missPenalty: 12,
    timeLimit: 1.5,
    traffic: 1.0,
    hazards: 6,
    dockTime: 120,
  },
  {
    id: 'captain',
    name: 'Captain',
    blurb: 'Two green-water slams and you are done. Crowded channel, pots and logs.',
    capacity: 0.23,
    waveScale: 1.28,
    currentScale: 1.28,
    windScale: 1.18,
    leakScale: 1.8,
    autoBilge: 0,
    score: 1.6,
    gateScale: 0.7,
    missPenalty: 18,
    timeLimit: 1.3,
    traffic: 1.5,
    hazards: 10,
    dockTime: 95,
  },
  {
    id: 'legend',
    name: 'Haulover Legend',
    blurb: 'Barely a bucket of margin, a wall of traffic, and the tide wants you gone.',
    capacity: 0.14,
    waveScale: 1.45,
    currentScale: 1.45,
    windScale: 1.3,
    leakScale: 2.4,
    autoBilge: 0,
    score: 2.5,
    gateScale: 0.55,
    missPenalty: 25,
    timeLimit: 1.15,
    traffic: 2.0,
    hazards: 15,
    dockTime: 75,
  },
];

export const difficultyById = (id: string): Difficulty =>
  DIFFICULTIES.find((d) => d.id === id) ?? (DIFFICULTIES[1] as Difficulty);
