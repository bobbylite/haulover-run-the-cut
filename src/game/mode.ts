// The seam between the engine host (`Game`) and what you actually do in a place.
//
// The host owns the world: renderer, sea, boat, camera, input, audio, the phase machine
// (menu -> countdown -> playing -> paused -> finished | failed), shared boat feedback (slams, green water,
// wave streaks, jumps, sails, bilge and hull warnings) and the shared HUD data. A `GameMode` owns the
// rules: the course or the fish or the berth, the clock, scoring, ambient traffic, its HUD fields and
// its UI. One mode is active per page load; each lives behind a dynamic import (see games/registry.ts).

import type { AudioFrame } from '../audio/audio';
import type { Difficulty } from '../data/difficulty';
import type { Location } from '../locations/types';
import type { WakeBoat } from '../render/wake';
import type { Boat } from '../sim/boat';
import type { TouchButton } from '../ui/touch';
import type { Game } from './game';
import type { GameConfig, HudState, Phase, ResultState } from './state';

export type GameId = 'haulover' | 'montauk' | 'nantucket';

/** Where a boat is put and which way it points (heading = atan2(z, x)). */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** What the shell hands a mode's UI. */
export interface ModeUiHost {
  readonly root: HTMLElement;
  readonly game: Game;
  /** Look up an element by id inside the UI root. */
  q(id: string): HTMLElement | undefined;
  /** Start the run (the menu's primary button and the Enter key). */
  start(): void;
}

/** The mode-specific parts of the interface. The shell keeps loading, pause, quality, mute and toasts. */
export interface ModeUi {
  /** Menu sections between the brand and the primary button. */
  menuHtml(): string;
  /** HUD panels the mode owns (objective panel, map, docking panel). */
  hudHtml(): string;
  /** Wire up once the DOM exists and the game is running. */
  attach(host: ModeUiHost): void;
  /** Re-read the config into the menu (and redraw maps). */
  syncMenu(): void;
  /** Browse vessels with the arrow keys in the menu. */
  cycleVessel(d: number): void;
  onPhase(p: Phase): void;
  /** Throttled HUD tick while not in the menu. */
  update(h: HudState): void;
  /** The body of the result card, above the buttons. */
  resultHtml(r: ResultState): string;
  /** Key list for the controls pop-up and the pause screen (default: the Haulover helm). */
  controlsHtml?(): string;
  /** The one-line hint under the HUD for the first seconds of a run. */
  hintHtml?(): string;
  /** The stat grid of the result card (default: bilge, hull and wave stats). */
  resultStats?(r: ResultState): string;
  /** Label of the menu's primary button (default "Set Sail"). */
  startLabel?: string;
  /** Extra on-screen buttons for touch devices. */
  touchButtons?(game: Game): TouchButton[];
}

export interface GameMode {
  readonly id: GameId;
  readonly ui: ModeUi;
  /** Where the player's boat is held for the menu and the countdown. */
  readonly start: Pose;
  /** Once, after the renderer, sea, input and obstacle list exist: build the mode's scene objects. */
  init(): void;
  /** The menu config changed, before the player's boat is rebuilt: rebuild the course / targets. */
  prepare(prev: GameConfig): void;
  /** (Re)seed ambient traffic for the current config. */
  populate(): void;
  /** A fresh run is about to start its countdown: reset run state. */
  begin(): void;
  /** Every frame the sim runs, after the player's boat has stepped and shared feedback has run. */
  update(dt: number, phase: Phase): void;
  /** Every frame, after the boat models are posed: markers, target glows. */
  visuals(dt: number): void;
  /** Fill the mode's fields of the shared HUD. */
  fillHud(h: HudState): void;
  /** Where a respawn puts the boat, or null if respawn is not allowed right now. */
  respawnPose(): Pose | null;
  /** The boat has just been put back (apply the penalty, reset trackers). */
  onRespawn(pose: Pose): void;
  /** Open water between the hull and the nearest obstacle (m) for the parking-sensor beeps; 99 = none. */
  clearance(): number;
  /** Other boats that disturb the water this frame. */
  wakeBoats(entry: (b: Boat) => WakeBoat): WakeBoat[];
  /** Extra sound the mode wants mixed in (a fish on the line). */
  audio?(): AudioFrame['fishing'];
  /** This game's own sea scaling for a difficulty id (otherwise the shared table is used). */
  difficulty?(id: string): Difficulty;
  /**
   * What an AI agent playing through `window.__agent` may observe about this game (JSON-serialisable). With
   * `cheat` it may also see what the player cannot (where the fish are). See src/dev/agentApi.ts.
   */
  agentState?(cheat: boolean): Record<string, unknown>;
  /** Game-specific actions an agent can take (set the spread, drag lever, pump, …). */
  agentAct?(action: Record<string, unknown>): void;
}

/** Everything the registry needs to boot a game. */
export interface ModeDef {
  id: GameId;
  title: string;
  location: Location;
  /** The setup a first-time player of this game starts with (a sky that belongs to the place, say). */
  defaults?: Partial<GameConfig>;
  create(host: Game): GameMode;
}
