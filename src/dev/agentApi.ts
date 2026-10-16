// An agent-playable surface for the games: `?game=<id>&agent` mounts `window.__agent`, a small JSON-in /
// JSON-out interface so an AI agent (or a test script) can *play* without scraping the DOM or racing the
// frame loop. The sim is stepped by the agent, not by requestAnimationFrame, so a run is reproducible:
// same `seed`, same actions, same result.
//
//   const a = window.__agent;
//   a.start({ boat: 'console', weather: 'm-dawn', difficulty: 'weekender' });   // menu -> a run in progress
//   a.act({ throttle: 0.5, steer: 0.1 });                                       // set the helm (it holds)
//   const obs = a.step(2);                                                      // advance 2 s, get what happened
//
// Frames and units (also in `describe()`): world x = east, z = south, metres; `headingDeg` and every bearing
// are compass degrees (0 = north, 90 = east); speeds in knots; `speedKn` is through the water, `sogKn` over the
// ground. Observations only ever contain what the *player* could know, unless `cheat` is asked for.

import { KNOTS } from '../core/math';
import type { Game } from '../game/game';
import type { Controls } from '../game/input';
import type { GameConfig, Phase } from '../game/state';

export interface AgentObservation {
  schema: 1;
  game: string;
  phase: Phase;
  /** Seconds of simulated play since the page loaded. */
  clock: number;
  config: GameConfig;
  boat: {
    id: string;
    x: number;
    z: number;
    headingDeg: number;
    speedKn: number;
    sogKn: number;
    throttle: number;
    steer: number;
    hullPct: number;
    bilgeLitres: number;
    /** Water in the boat as a fraction of what sinks it (1 = going down). */
    bilgeFrac: number;
    grounded: boolean;
  };
  sea: {
    windKn: number;
    windFromDeg: number;
    currentKn: number;
    currentToDeg: number;
    waveHeightM: number;
    /** Angle between the heading and the wave axis, degrees (0 head-on, 45 ideal, 90 broadside). */
    waveAngleDeg: number;
    /** 0..1, how wrong the line is for this sea. */
    waveBad: number;
  };
  /** The last few messages the player was shown. */
  toasts: string[];
  /** Set once the run is over. */
  result: { outcome: string; title: string; score: number; stars: number } | null;
  /** Whatever the game itself reports (gates, fish, lines). */
  mode: Record<string, unknown>;
}

export interface AgentAction {
  /** Throttle lever, -0.4 (astern) .. 1. */
  throttle?: number;
  /** Wheel, -1 (port) .. 1 (starboard). */
  steer?: number;
  /** Bow / stern tunnel thrusters of a ship, -1 (to port) .. 1 (to starboard); they persist like the wheel. */
  bow?: number;
  stern?: number;
  /** Hold the bilge pump. */
  bilge?: boolean;
  /** Sail trim 0 (in) .. 1 (out), and hoist or drop the sails (sloop). */
  sheet?: number;
  sail?: boolean;
  /** Put the boat back at the last safe place (the game decides where, and what it costs). */
  respawn?: boolean;
  /** Anything specific to the game (see `describe().games`). */
  mode?: Record<string, unknown>;
  /** Give the helm back (clear throttle / steer / bilge). */
  release?: boolean;
}

export interface AgentApi {
  version: 1;
  observe(opts?: { cheat?: boolean }): AgentObservation;
  act(a: AgentAction): void;
  /** Advance the sim `seconds` (default 1) in `dt` steps (default 1/30), stopping early when the run ends. */
  step(seconds?: number, opts?: { dt?: number; cheat?: boolean }): AgentObservation;
  /** Optionally set the setup, start a run, and play through the countdown. */
  start(cfg?: Partial<GameConfig>): AgentObservation;
  /** Back to the menu. */
  menu(): AgentObservation;
  /** Let the page's own frame loop run the sim again (a human watching), or take it back. */
  realtime(on: boolean): void;
  /** A description of the observation and action spaces, for building tools. */
  describe(): Record<string, unknown>;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** What the player can know right now (plus, with `cheat`, what only the sim knows). */
export function observe(g: Game, cheat = false): AgentObservation {
  const b = g.player;
  const h = g.hud;
  const cap = Math.max(1, b.capacityLimit ?? b.spec.capacity);
  return {
    schema: 1,
    game: g.mode.id,
    phase: g.phase,
    clock: r2(g.clock),
    config: { ...g.cfg },
    boat: {
      id: b.spec.id,
      x: r1(b.pos.x),
      z: r1(b.pos.z),
      headingDeg: r1(h.heading),
      speedKn: r1(Math.max(0, b.speed) * KNOTS),
      sogKn: r1(b.sog * KNOTS),
      throttle: r2(b.throttle),
      steer: r2(h.steer),
      hullPct: Math.round(b.hull * 100),
      bilgeLitres: Math.round(b.water.litres),
      bilgeFrac: r2(b.water.litres / cap),
      grounded: b.grounded > 0.2,
    },
    sea: {
      windKn: r1(h.windKn),
      windFromDeg: Math.round(h.windFrom),
      currentKn: r1(h.currentKn),
      currentToDeg: Math.round(h.currentTo),
      waveHeightM: r2(h.waveH),
      waveAngleDeg: Math.round(h.wave.angleDeg),
      waveBad: r2(h.wave.bad),
    },
    toasts: g.toasts.slice(-4).map((t) => t.text),
    result: g.result
      ? { outcome: g.result.outcome, title: g.result.title, score: g.result.score, stars: g.result.stars }
      : null,
    mode: g.mode.agentState?.(cheat) ?? {},
  };
}

export function mountAgentApi(g: Game): AgentApi {
  // from now on the agent steps the sim; the page keeps rendering so screenshots still work
  g.manual = true;
  let held: Partial<Controls> | null = null;
  const orig = g.input.controls.bind(g.input);
  g.input.controls = () => {
    const c = orig();
    if (held) Object.assign(c, held);
    return c;
  };

  const step = (seconds = 1, opts: { dt?: number; cheat?: boolean } = {}): AgentObservation => {
    const dt = opts.dt ?? 1 / 30;
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      g.update(dt);
      if (g.phase === 'finished' || g.phase === 'failed') break;
    }
    return observe(g, opts.cheat);
  };

  const api: AgentApi = {
    version: 1,
    observe: (opts) => observe(g, opts?.cheat),
    act(a) {
      if (a.release) held = null;
      const next: Partial<Controls> = { ...(held ?? {}) };
      if (a.throttle !== undefined) next.throttle = Math.max(-0.4, Math.min(1, a.throttle));
      if (a.steer !== undefined) next.steer = Math.max(-1, Math.min(1, a.steer));
      if (a.bilge !== undefined) next.pump = a.bilge;
      if (a.bow !== undefined) next.bow = Math.max(-1, Math.min(1, a.bow));
      if (a.stern !== undefined) next.stern = Math.max(-1, Math.min(1, a.stern));
      if (a.sheet !== undefined) {
        g.input.sheet = Math.max(0, Math.min(1, a.sheet));
        next.sheet = g.input.sheet;
      }
      if (!a.release && Object.keys(next).length) held = next;
      // the throttle is a lever: put the real one where the agent asked so releasing keeps it there
      if (a.throttle !== undefined) g.input.throttle = next.throttle ?? 0;
      if (a.sail !== undefined && g.player.spec.sail) g.player.sailUp = a.sail;
      if (a.respawn) g.respawn();
      if (a.mode) g.mode.agentAct?.(a.mode);
    },
    step,
    start(cfg) {
      if (g.phase === 'playing' || g.phase === 'countdown' || g.phase === 'paused') g.backToMenu();
      if (g.phase === 'finished' || g.phase === 'failed') g.backToMenu();
      if (cfg) g.setConfig(cfg);
      held = null;
      g.startRun();
      return step(3.8);
    },
    menu() {
      held = null;
      g.backToMenu();
      return observe(g);
    },
    realtime(on) {
      g.manual = !on;
    },
    describe() {
      return {
        version: 1,
        howTo:
          'Open the page with ?game=<haulover|montauk|nantucket>&agent[&seed=N][&noui]. start() -> act() -> step(); read observe(). ' +
          'The sim only advances inside step()/start(). Pass {cheat:true} to see hidden state (for testing, not for play).',
        frames:
          'x east, z south (metres); headingDeg / bearings are compass degrees (0 = N, 90 = E); speeds in knots',
        observation: ['game', 'phase', 'clock', 'config', 'boat', 'sea', 'toasts', 'result', 'mode'],
        action: {
          throttle: '-0.4..1 lever, persists',
          steer: '-1..1 wheel, persists',
          bow: '-1..1 bow thruster (ships), persists',
          stern: '-1..1 stern thruster (ships), persists',
          bilge: 'boolean, hold the pump',
          sheet: '0..1 sail trim (sloop)',
          sail: 'boolean, hoist / drop (sloop)',
          respawn: 'boolean',
          release: 'boolean, give the helm back',
          mode: 'game-specific, see games',
        },
        games: {
          haulover: {
            mode: {},
            observe: 'mode.nextGate {label,x,z,nx,nz,half}, gatesPassed, gates, timeLeftS, docking',
          },
          montauk: {
            mode: {
              lines: "'out' | 'in' | 'toggle'",
              mark: 'true: drop a mark here',
              drag: '0..1 drag lever (fight)',
              pump: 'boolean, pump the rod (fight)',
              binoculars: 'boolean',
            },
            observe:
              'mode.stage search|troll|fight, daylightLeftS, strikes, lost, rods[], sightings[], marks[], fight{mood,tension,drag,lineOutM,distM,bearingDeg,stamina,crew,hint,warning}; cheat adds schools[]',
          },
          nantucket: {
            config:
              'level: one of tiki-slip, hornet-moor, sunset-quay, pelican-moor, sunset-oldnorth, lady-straight, tug-slip, tug-steamship, ferry-west, ferry-east, liner-east, liner-fog (it brings its own boat)',
            mode: {
              tug: "'bow-port' | 'bow-stbd' | 'stern-port' | 'stern-stbd' | 'hold': call a tug (ships; limited calls)",
            },
            observe:
              'mode.level, berth{id,kind,label}, target{x,z,headingDeg} (where the middle of the hull has to finish), status{distM,alongM,acrossM,speedKn,alignDeg,speedOk,alignOk,posOk,holdS,needS,clearanceM,stopDistM,bumps,timeLeftS}, tugs{left,used}, thrusters',
          },
        },
        phases: ['loading', 'menu', 'countdown', 'playing', 'paused', 'finished', 'failed'],
      };
    },
  };
  return api;
}
