// Types shared between the game core and the UI.

import type { Tide } from '../sim/environment';
import type { Route } from './course';
import type { DockStatus } from './docking';

export type Phase = 'loading' | 'menu' | 'countdown' | 'playing' | 'paused' | 'finished' | 'failed';

export interface GameConfig {
  boat: 'console' | 'gofast' | 'cruiser' | 'sloop' | 'pontoon';
  weather: string;
  tide: Tide;
  difficulty: string;
  route: Route;
}

export interface HudState {
  phase: Phase;
  speedKn: number;
  speedMs: number;
  topKn: number;
  throttle: number;
  steer: number;
  rpm: number;
  litres: number;
  capacity: number;
  waterFrac: number;
  intakeLps: number;
  drainLps: number;
  leakLps: number;
  pumping: boolean;
  windKn: number;
  windFrom: number;
  gustKn: number;
  currentKn: number;
  /** compass bearing the current flows towards */
  currentTo: number;
  waveH: number;
  heading: number;
  heelDeg: number;
  pitchDeg: number;
  time: number;
  penalty: number;
  gate: number;
  gates: number;
  gateLabel: string;
  progress: number;
  countdown: number;
  sail: { up: boolean; sheet: number; luff: number; power: number } | null;
  /** Docking challenge status (null until the Marina Entrance gate is crossed). */
  dock: DockStatus | null;
  /** Seconds left before the run clock expires (docking has its own timer). */
  timeLeft: number;
  /** Seconds of fouled prop remaining. */
  foul: number;
  warning: string | null;
  grounded: boolean;
  camera: string;
  x: number;
  z: number;
}

export interface ToastMsg {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
  ttl: number;
}

export interface ResultState {
  outcome: 'finished' | 'docked' | 'swamped' | 'capsized' | 'stranded' | 'timeout';
  title: string;
  subtitle: string;
  time: number;
  penalty: number;
  score: number;
  stars: number;
  best: number;
  newBest: boolean;
  dryPct: number;
  peakL: number;
  capacityL: number;
  gates: { label: string; offset: number | null }[];
  collisions: number;
  totalIntakeL: number;
  maxSpeedKn: number;
  boat: string;
  weather: string;
  difficulty: string;
  /** Docking summary when the run ended in (or on the way to) the marina. */
  dock: {
    docked: boolean;
    time: number;
    speedKn: number;
    alignDeg: number;
    touches: number;
    bonus: number;
  } | null;
}

export const emptyHud = (): HudState => ({
  phase: 'loading',
  speedKn: 0,
  speedMs: 0,
  topKn: 40,
  throttle: 0,
  steer: 0,
  rpm: 0,
  litres: 0,
  capacity: 1,
  waterFrac: 0,
  intakeLps: 0,
  drainLps: 0,
  leakLps: 0,
  pumping: false,
  windKn: 0,
  windFrom: 0,
  gustKn: 0,
  currentKn: 0,
  currentTo: 0,
  waveH: 0,
  heading: 0,
  heelDeg: 0,
  pitchDeg: 0,
  time: 0,
  penalty: 0,
  gate: 0,
  gates: 0,
  gateLabel: '',
  progress: 0,
  countdown: 0,
  sail: null,
  dock: null,
  timeLeft: 0,
  foul: 0,
  warning: null,
  grounded: false,
  camera: 'chase',
  x: 0,
  z: 0,
});
