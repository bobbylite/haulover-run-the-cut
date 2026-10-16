// The engine host: owns the world (renderer, sea, the player's boat, camera, input, audio), the phase
// machine and the feedback every boat gets (slams, green water, wave streaks, jumps, sails, warnings).
// What you actually do in the place is a `GameMode` (see game/mode.ts) that the host drives each frame.

import { Quaternion, Vector3 } from 'three/webgpu';
import { AudioEngine, type AudioFrame } from '../audio/audio';
import { clamp, damp, KNOTS, wrapAngle } from '../core/math';
import { boatById } from '../data/boats';
import { type Difficulty, difficultyById } from '../data/difficulty';
import { weatherById } from '../data/weather';
import type { Location } from '../locations/types';
import { BoatModel } from '../render/boats/boatModel';
import { RenderWorld } from '../render/renderWorld';
import type { WakeBoat } from '../render/wake';
import type { BoatEnv } from '../sim/boat';
import { Boat } from '../sim/boat';
import { DynamicObstacles, makeBoatEnv } from '../sim/boatEnv';
import { Environment } from '../sim/environment';
import { idealSheet } from '../sim/sail';
import { CLEAN_PERIOD } from '../sim/waveRide';
import { GameCamera } from './camera';
import { Input } from './input';
import type { GameMode, ModeDef } from './mode';
import { lastConfig, loadSettings, rememberConfig, type Settings, saveSettings } from './settings';
import {
  emptyHud,
  type GameConfig,
  type HudState,
  type Phase,
  type ResultState,
  type ToastMsg,
} from './state';

export const DEFAULT_CONFIG: GameConfig = {
  boat: 'console',
  weather: 'breeze',
  tide: 'ebb',
  difficulty: 'weekender',
  route: 'full',
};

type Listener<T> = (v: T) => void;

/** What the boat itself can go wrong with, whatever the game. */
export type BoatFailure = 'wrecked' | 'swamped' | 'capsized';

export class Game {
  /** The place this run is set in. */
  readonly loc: Location;
  readonly env: Environment;
  /** The rules: the course, fish or berth. */
  readonly mode: GameMode;
  readonly hud: HudState = emptyHud();
  readonly toasts: ToastMsg[] = [];
  readonly settings: Settings = loadSettings();
  readonly audio = new AudioEngine();
  result: ResultState | null = null;
  cfg: GameConfig;
  phase: Phase = 'loading';

  rw!: RenderWorld;
  cam!: GameCamera;
  input!: Input;
  /** Moving hard obstacles (other vessels, drift logs): the mode fills it, the physics reads it. */
  readonly obstacles = new DynamicObstacles();
  benv!: BoatEnv;
  /** Same world without the moving obstacles, for ambient traffic's own physics. */
  benvStatic!: BoatEnv;
  player!: Boat;
  model!: BoatModel;
  /** Seconds of play since the page loaded (frame-stepped). */
  clock = 0;
  /** Points banked by clean landings after jumps (the streak keeps its own in `ride.bonus`). */
  airBonus = 0;
  /** The hardest hull slam this frame (the host clears the boat's own counter), for modes that care. */
  frameSlam = 0;

  private readonly phaseListeners: Listener<Phase>[] = [];
  private readonly splashListeners: Listener<number>[] = [];
  private toastId = 1;

  private countdownT = 0;
  private resumePhase: Phase = 'playing';
  private lastRespawn = -10;
  private lastBurstToast = -10;
  private lastHitToast = -10;
  private lastHeelToast = -10;
  private lastIronsToast = -10;
  private readonly warned = new Set<string>();
  private readonly tmpQ = new Quaternion();
  private readonly dbgFocus = new Vector3();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly cur = { x: 0, z: 0 };
  private readonly wnd = { x: 0, z: 0 };
  private lastCount = 99;
  private prevVy = 0;
  private heave = 0;
  /** Dev: fixed camera [x,y,z, tx,ty,tz] from ?cam= or window.__setCam. */
  debugCam: number[] | null = null;

  private constructor(cfg: GameConfig, def: ModeDef) {
    this.cfg = { ...cfg };
    this.loc = def.location;
    this.env = new Environment(def.location);
    this.mode = def.create(this);
  }

  static async create(
    root: HTMLElement,
    def: ModeDef,
    cfg: Partial<GameConfig> = {},
    progress: (p: number, msg: string) => void = () => {},
  ): Promise<Game> {
    const last = lastConfig(loadSettings(), def.id);
    const g = new Game({ ...DEFAULT_CONFIG, ...def.defaults, ...cfg, ...last, ...cfg }, def);
    await g.init(root, progress);
    return g;
  }

  private async init(root: HTMLElement, progress: (p: number, msg: string) => void): Promise<void> {
    const tick = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const q = new URLSearchParams(location.search);
    const cfgQ: Partial<GameConfig> = {};
    for (const k of ['boat', 'weather', 'tide', 'difficulty', 'route'] as const) {
      const v = q.get(k);
      if (v) (cfgQ as Record<string, string>)[k] = v;
    }
    Object.assign(this.cfg, cfgQ);
    const camQ = q.get('cam');
    if (camQ) this.debugCam = camQ.split(',').map(Number);
    (window as unknown as Record<string, unknown>).__setCam = (...a: number[]) => {
      this.debugCam = a.length ? a : null;
    };

    progress(0.35, 'Raising the sea…');
    await tick();
    this.env.setConditions(weatherById(this.cfg.weather), this.cfg.tide, this.diff(), true);
    this.rw = await RenderWorld.create(root, this.env, {
      quality: this.settings.quality,
      forceWebGL: q.has('webgl'),
    });
    progress(0.8, 'Rigging the boat…');
    await tick();
    this.cam = new GameCamera(this.rw.camera, this.env);
    this.input = new Input(this.rw.renderer.domElement);
    this.benv = makeBoatEnv(this.env, this.obstacles);
    this.benvStatic = makeBoatEnv(this.env);
    this.mode.init();
    this.rebuildPlayer();
    this.mode.populate();

    this.input.on('camera', () => this.cycleCamera());
    this.input.on('reset', () => this.respawn());
    this.input.on('quality', () => this.cycleResolution());
    this.input.on('pause', () => this.togglePause());
    this.input.on('sail', () => {
      if (this.player.spec.sail) this.player.sailUp = !this.player.sailUp;
    });
    this.input.on('hud', () => {
      this.settings.hud = !this.settings.hud;
      saveSettings(this.settings);
    });
    addEventListener('resize', () => this.rw.resize(innerWidth, innerHeight));
    progress(1, 'Ready');
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'playing') this.togglePause();
    });
    // sound: browsers only allow audio after a gesture, so the context is created on the first one
    this.audio.setVolume(this.settings.master);
    this.audio.setMusic(this.settings.music);
    this.audio.setSfx(this.settings.sfx);
    const unlock = () => this.audio.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const)
      addEventListener(ev, unlock, { passive: true });
    this.rw.lightning.onThunder = (delay, loud) => this.audio.thunder(delay, loud);
    this.setPhase('menu');
  }

  /** The sea scaling in force: the game's own, or the shared table. */
  private diff(): Difficulty {
    return this.mode.difficulty?.(this.cfg.difficulty) ?? difficultyById(this.cfg.difficulty);
  }

  // ------------------------------------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------------------------------------

  onPhase(fn: Listener<Phase>): void {
    this.phaseListeners.push(fn);
  }
  onSplash(fn: Listener<number>): void {
    this.splashListeners.push(fn);
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.hud.phase = p;
    for (const fn of this.phaseListeners) fn(p);
  }

  toast(text: string, tone: ToastMsg['tone'] = 'info', ttl = 2.8): void {
    this.toasts.push({ id: this.toastId++, text, tone, ttl });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  splash(a: number): void {
    for (const fn of this.splashListeners) fn(a);
  }

  // ------------------------------------------------------------------------------------------------
  // configuration (menu)
  // ------------------------------------------------------------------------------------------------

  setConfig(partial: Partial<GameConfig>): void {
    const prev = { ...this.cfg };
    Object.assign(this.cfg, partial);
    const c = this.cfg;
    this.mode.prepare(prev);
    const reseed = c.weather !== prev.weather || c.route !== prev.route || c.difficulty !== prev.difficulty;
    if (c.weather !== prev.weather || c.tide !== prev.tide || c.difficulty !== prev.difficulty) {
      const w = weatherById(c.weather);
      this.env.setConditions(w, c.tide, this.diff(), false);
      this.rw.weather.setTarget(w);
    }
    if (c.boat !== prev.boat || c.route !== prev.route || c.difficulty !== prev.difficulty)
      this.rebuildPlayer();
    if (reseed) this.mode.populate();
    rememberConfig(this.settings, this.mode.id, c);
    saveSettings(this.settings);
  }

  private rebuildPlayer(): void {
    if (this.model) {
      this.rw.world.remove(this.model.root);
      this.model.dispose();
    }
    const spec = boatById(this.cfg.boat);
    const diff = this.diff();
    this.player = new Boat(spec);
    const s = this.mode.start;
    this.player.reset(s.x, s.z, s.heading, this.benv);
    this.player.capacityLimit = spec.capacity * diff.capacity;
    this.player.water.autoBilge = diff.autoBilge;
    this.player.leakScale = diff.leakScale;
    this.model = new BoatModel(spec);
    this.model.root.traverse((o) => {
      o.frustumCulled = false;
    });
    this.rw.world.add(this.model.root);
    this.cam.snap(this.player);
  }

  // ------------------------------------------------------------------------------------------------
  // run control
  // ------------------------------------------------------------------------------------------------

  startRun(): void {
    const diff = this.diff();
    this.env.setConditions(weatherById(this.cfg.weather), this.cfg.tide, diff, true);
    this.rw.weather.setTarget(weatherById(this.cfg.weather));
    this.rebuildPlayer();
    this.mode.populate();
    this.airBonus = 0;
    this.warned.clear();
    this.toasts.length = 0;
    this.result = null;
    this.input.reset();
    this.input.enabled = false;
    this.countdownT = 3.4;
    this.lastCount = 99;
    this.mode.begin();
    this.setPhase('countdown');
    this.cam.mode = 'chase';
  }

  backToMenu(): void {
    this.input.enabled = false;
    this.result = null;
    this.rebuildPlayer();
    this.mode.populate();
    this.setPhase('menu');
  }

  /** A mode calls this when the run is over, win or lose. */
  endRun(result: ResultState, ok: boolean): void {
    if (this.phase === 'finished' || this.phase === 'failed') return;
    this.result = result;
    this.input.enabled = false;
    this.input.throttle = 0;
    this.setPhase(ok ? 'finished' : 'failed');
    this.audio.finish(ok);
  }

  togglePause(): void {
    if (this.phase === 'playing' || this.phase === 'countdown') {
      this.resumePhase = this.phase;
      this.setPhase('paused');
      this.input.enabled = false;
    } else if (this.phase === 'paused') {
      this.setPhase(this.resumePhase);
      this.input.enabled = this.resumePhase === 'playing';
    }
  }

  /** G: auto → 100% → 75% → 50% render scale. */
  cycleResolution(): void {
    const p = this.rw.perf;
    let label: string;
    if (p.auto) {
      p.setManual(1);
      label = '100%';
    } else if (p.scale >= 1) {
      p.setManual(0.75);
      label = '75%';
    } else if (p.scale >= 0.75) {
      p.setManual(0.5);
      label = '50%';
    } else {
      p.setAuto();
      label = 'auto';
    }
    this.toast(`Resolution: ${label}`, 'info', 1.6);
  }

  cycleCamera(): void {
    this.cam.cycle();
  }

  respawn(): void {
    if (this.phase !== 'playing' || this.clock - this.lastRespawn < 2.5) return;
    const pose = this.mode.respawnPose();
    if (!pose) return;
    this.lastRespawn = this.clock;
    const b = this.player;
    const keep = b.water.volume * 0.5;
    const keepHull = b.hull;
    const keepRide = b.ride.bonus;
    b.reset(pose.x, pose.z, pose.heading, this.benv);
    b.water.volume = keep;
    // a lift back onto the course patches the seams but does not rebuild the hull
    b.hull = keepHull;
    b.ride.bonus = keepRide;
    const diff = this.diff();
    b.leakScale = diff.leakScale;
    b.capacityLimit = boatById(this.cfg.boat).capacity * diff.capacity;
    b.water.autoBilge = diff.autoBilge;
    this.cam.snap(b);
    this.input.reset();
    this.mode.onRespawn(pose);
    this.audio.whoosh();
  }

  /** What has gone fatally wrong with the player's boat, if anything. */
  boatFailure(): BoatFailure | null {
    const b = this.player;
    if (b.wrecked) return 'wrecked';
    if (b.sinking && b.sinkT > 0.35) return 'swamped';
    if (b.capsized) return 'capsized';
    return null;
  }

  // ------------------------------------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------------------------------------

  update(rawDt: number): void {
    const dt = Math.min(rawDt, 1 / 15);
    this.rw.perf.tick(rawDt);
    this.clock += dt;
    this.input.update(dt);
    const phase = this.phase;
    const simulating = phase !== 'paused' && phase !== 'loading';

    if (simulating) {
      this.env.time += dt;
      this.env.blend(dt);
    }

    if (phase === 'menu' || phase === 'countdown') {
      this.hold(dt);
      this.player.hits.length = 0;
      this.player.ride.events.length = 0;
    }

    if (phase === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT - 0.4);
      if (n !== this.lastCount && n >= 1) this.audio.countdown(n);
      this.lastCount = n;
      if (this.countdownT <= 0) {
        this.setPhase('playing');
        this.input.enabled = true;
        this.toast('GO!', 'good', 1.2);
        this.audio.countdown(0);
      }
    }

    const boat = this.player;
    if (simulating) {
      this.frameSlam = 0;
      const c = this.input.controls();
      if (phase === 'playing') boat.setInput(c);
      else boat.setInput({ throttle: 0, steer: 0, sheet: boat.sheet, pump: false });
      boat.update(dt, this.benv);
      if (phase !== 'menu' && phase !== 'countdown') this.rw.spray.emit(dt, boat, this.env);
      if (phase === 'playing' || phase === 'failed' || phase === 'finished')
        this.boatFeedback(phase === 'playing');
      this.mode.update(dt, phase);
      if (this.phase === 'playing') this.boatWarnings();
    }

    this.updateToasts(dt);
    this.env.windAt(boat.pos.x, boat.pos.z, this.wnd);
    this.model.update(boat, this.wnd, this.env.time);
    this.mode.visuals(dt);
    this.updateHud();

    // camera
    const forceOrbit = phase === 'menu' || phase === 'finished' || phase === 'failed';
    this.cam.setViewShift(phase === 'menu' ? 0.16 : 0, dt);
    this.cam.update(dt, boat, this.input, this.clock, forceOrbit ? 'orbit' : undefined);
    let focus = boat.pos;
    const dc = this.debugCam;
    if (dc && dc.length >= 6) {
      this.rw.camera.position.set(dc[0] as number, dc[1] as number, dc[2] as number);
      this.rw.camera.lookAt(dc[3] as number, dc[4] as number, dc[5] as number);
      this.dbgFocus.set(dc[3] as number, dc[4] as number, dc[5] as number);
      focus = this.dbgFocus;
    }
    this.rw.update(dt, focus, this.wakeBoats());
    this.audio.update(dt, this.audioFrame(dt));
  }

  render(): void {
    this.rw.render();
  }

  /** Snapshot of everything the sound engine needs this frame. */
  private audioFrame(dt: number): AudioFrame {
    const b = this.player;
    const env = this.env;
    const spec = b.spec;
    const w = this.rw.weather;
    // apparent wind: true wind relative to the moving hull
    const ax = this.wnd.x - b.vel.x;
    const az = this.wnd.z - b.vel.z;
    // bounce intensity from vertical acceleration, smoothed
    const acc = Math.abs(b.vel.y - this.prevVy) / Math.max(dt, 1e-3);
    this.prevVy = b.vel.y;
    this.heave += (clamp(acc / 16, 0, 1) - this.heave) * Math.min(1, dt * 8);
    // breaking surf: swell reaching shallow water near the player
    const depth = env.depthAt(b.pos.x, b.pos.z);
    const surf = clamp(
      env.geo.swellAt(b.pos.x, b.pos.z) * clamp((7 - depth) / 5.5, 0, 1) * (env.sea.swellHeight / 1.1),
      0,
      1,
    );
    return {
      phase: this.phase,
      boatId: spec.id,
      engineOn: !(b.sinking || b.capsized) && (spec.sail ? !b.sailUp || b.throttle > 0.04 : true),
      throttle: b.throttle,
      rpm: b.rpm,
      speed: b.speed,
      topSpeed: spec.topSpeed,
      propSubmerge: b.propSubmerge,
      windApparent: Math.hypot(ax, az),
      gust: env.wind.gust,
      swellH: env.sea.swellHeight,
      surf,
      heave: this.heave,
      rain: w.rain,
      night: w.night,
      sailUp: b.sailUp,
      sailLuff: b.sailLuff,
      pumping: b.water.pumping,
      weather: this.cfg.weather,
      clearance: this.mode.clearance(),
      fouled: this.player.foulT > 0,
      fishing: this.mode.audio?.() ?? null,
    };
  }

  private readonly wb: WakeBoat[] = [];

  private wakeEntry(b: Boat): WakeBoat {
    const spec = b.spec;
    const sun = this.rw.weather.sunDir;
    const k = 2.4 / Math.max(0.18, sun.y);
    const wx = -sun.x * k;
    const wz = -sun.z * k;
    const strength =
      Math.min(1, Math.max(0, sun.y * 6)) *
      (1 - this.rw.weather.cloudCover * 0.55) *
      (1 - this.rw.weather.night);
    const sp = Math.max(0, b.speed);
    return {
      x: b.pos.x,
      z: b.pos.z,
      heading: b.heading,
      length: spec.length,
      beam: spec.beam,
      speed: sp,
      thrust01: clamp(Math.abs(b.thrustN) / spec.engine.thrust, 0, 1) * b.propSubmerge,
      planing01:
        clamp((sp - spec.hump.speed) / Math.max(1, spec.planing.speed - spec.hump.speed), 0, 1) *
        (spec.planing.fraction > 0.1 ? 1 : 0.2),
      shadowU: wx * b.fwd.x + wz * b.fwd.z,
      shadowV: wx * b.right.x + wz * b.right.z,
      sun: strength,
    };
  }

  /** Everything that disturbs the water this frame: the player plus the mode's other boats. */
  private wakeBoats(): WakeBoat[] {
    this.wb.length = 0;
    this.wb.push(this.wakeEntry(this.player));
    for (const e of this.mode.wakeBoats((b) => this.wakeEntry(b))) this.wb.push(e);
    return this.wb;
  }

  /** Keep the boat moored in place for the menu / countdown. */
  private hold(dt: number): void {
    const b = this.player;
    const s = this.mode.start;
    const k = damp(2.5, dt);
    b.pos.x += (s.x - b.pos.x) * k;
    b.pos.z += (s.z - b.pos.z) * k;
    b.vel.x *= 0.7;
    b.vel.z *= 0.7;
    const dh = wrapAngle(s.heading - b.heading);
    this.tmpQ.setFromAxisAngle(this.yAxis, -dh * k);
    b.quat.premultiply(this.tmpQ);
    b.angVel.y *= 0.8;
  }

  // ------------------------------------------------------------------------------------------------
  // boat feedback: what the sea does to any boat, in any game
  // ------------------------------------------------------------------------------------------------

  private boatFeedback(playing: boolean): void {
    const b = this.player;
    // slams + green water
    const w = b.water;
    this.frameSlam = Math.max(this.frameSlam, w.slam);
    if (w.slam > 0) {
      this.cam.addShake(Math.min(0.7, w.slam / 12));
      if (w.slam > 2.4) this.rw.spray.burst(b, Math.min(1, w.slam / 9));
      if (w.slam > 1.8) this.audio.slam(w.slam);
      w.slam = 0;
    }
    if (w.burst > 0) {
      if (w.burst > 18 && this.clock - this.lastBurstToast > 2.2 && playing) {
        this.toast(`Green water! +${Math.round(w.burst)} L`, 'warn');
        this.lastBurstToast = this.clock;
        this.splash(Math.min(1, w.burst / 90));
        this.audio.splash(Math.min(1, w.burst / 90));
        this.cam.addShake(Math.min(0.6, w.burst / 120));
      }
      w.burst = 0;
    }
    this.waveEvents(playing);
    this.sailEvents(playing);
  }

  /** Bilge and hull warnings. */
  private boatWarnings(): void {
    const b = this.player;
    const frac = b.water.litres / Math.max(1, b.capacityLimit ?? 1);
    if (frac > 0.5 && !this.warned.has('half')) {
      this.warned.add('half');
      this.toast('Bilge half full — hold B to pump!', 'warn', 3.2);
      this.audio.alarm(false);
    }
    if (frac > 0.8 && !this.warned.has('crit')) {
      this.warned.add('crit');
      this.toast('BILGE ALARM — slow down and pump!', 'bad', 3.5);
      this.audio.alarm(true);
    }
    if (frac < 0.3) {
      this.warned.delete('half');
      this.warned.delete('crit');
    }
    if (b.hull < 0.5 && !this.warned.has('hull50')) {
      this.warned.add('hull50');
      this.toast('Hull at 50% — ease the throttle and take the waves at 45°', 'warn', 3.6);
      this.audio.alarm(false);
    }
    if (b.hull < 0.25 && !this.warned.has('hull25')) {
      this.warned.add('hull25');
      this.toast('HULL FAILING — get out of the weather!', 'bad', 3.6);
      this.audio.alarm(true);
    }
  }

  /** Toasts, shake and score for wave hits, the Wave Rider streak and jumps. */
  private waveEvents(playing: boolean): void {
    const b = this.player;
    const ride = b.ride;
    for (const h of b.hits) {
      if (!playing) break;
      this.cam.addShake(Math.min(0.8, h.speed / 11));
      if (h.kind === 'slap') {
        this.rw.spray.burst(b, 0.8);
        this.splash(0.6);
        this.audio.splash(0.8);
        if (this.clock - this.lastHitToast > 4) {
          this.lastHitToast = this.clock;
          this.toast('Broadside wave! Quarter the sea at 45°', 'bad', 2.8);
        }
      } else if (h.damage > 0.012 && this.clock - this.lastHitToast > 3) {
        this.lastHitToast = this.clock;
        this.toast(
          `Slammed! −${Math.max(1, Math.round(h.damage * 100))}% hull · take it at 45° or ease off`,
          'bad',
          2.8,
        );
      }
    }
    b.hits.length = 0;
    for (const e of ride.events) {
      if (!playing) break;
      if (e.kind === 'combo') {
        this.toast(`Wave Rider ×${e.level + 1}`, 'good', 1.5);
        this.audio.gate(true, e.level);
        this.rw.spray.burst(b, 0.35);
      } else if (e.kind === 'broken') {
        if (e.level >= 2) this.toast(`Streak lost (×${e.level + 1})`, 'warn', 1.8);
      } else if (e.kind === 'air') {
        const t = e.time.toFixed(1);
        if (e.grade === 'smooth') {
          const pts = Math.round(15 * Math.min(e.time, 3) * Math.sqrt(ride.multiplier) * (0.6 + ride.rough));
          this.airBonus += pts;
          this.toast(`Air ${t} s · stuck the landing! +${pts}`, 'good', 1.7);
          this.audio.gate(true, 2);
        } else if (e.grade === 'nose') {
          this.toast(`Air ${t} s · nose-dive!`, 'warn', 1.8);
        } else {
          this.toast(`Air ${t} s · flat slap`, 'warn', 1.4);
        }
      }
    }
    ride.events.length = 0;
  }

  /** Tacks, gybes and being overpowered: what the sloop's rig is doing. */
  private sailEvents(playing: boolean): void {
    const b = this.player;
    for (const e of b.sailEvents) {
      if (!playing) break;
      if (e.kind === 'tack') {
        if (b.speed > 0.8) this.toast('Tack!', 'good', 1.3);
      } else {
        this.cam.addShake(Math.min(0.9, 0.25 + e.strength * 0.5));
        this.audio.hit(3 + e.strength * 4);
        this.toast(
          e.strength > 0.5 ? 'Crash gybe! Sheet in before you run off' : 'Gybe',
          e.strength > 0.5 ? 'bad' : 'warn',
          2.4,
        );
      }
    }
    b.sailEvents.length = 0;
    if (!playing || !b.spec.sail || !b.sailUp) return;
    if (b.heelDeg > 24 || b.heelDeg < -24) {
      if (this.clock - this.lastHeelToast > 6) {
        this.lastHeelToast = this.clock;
        this.toast('Overpowered! Ease the sheet (E) or bear away', 'warn', 2.6);
      }
    }
    const gamma = Math.abs(b.awa);
    if (gamma < 0.42 && b.speed < 1 && b.throttle < 0.1 && this.clock - this.lastIronsToast > 12) {
      this.lastIronsToast = this.clock;
      this.toast('In irons! Bear away, or use the motor to get the bow round', 'warn', 3);
    }
  }

  private updateToasts(dt: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i] as ToastMsg;
      t.ttl -= dt;
      if (t.ttl <= 0) this.toasts.splice(i, 1);
    }
  }

  private updateHud(): void {
    const h = this.hud;
    const b = this.player;
    const env = this.env;
    const diff = this.diff();
    h.phase = this.phase;
    h.speedMs = b.speed;
    h.speedKn = Math.max(0, b.speed) * KNOTS;
    h.topKn = b.spec.topSpeed * KNOTS * 1.12;
    h.throttle = b.throttle;
    h.steer = b.steer / Math.max(0.01, b.spec.engine.steerMax);
    h.rpm = b.rpm;
    const cap = b.capacityLimit ?? b.spec.capacity * diff.capacity;
    h.litres = b.water.litres;
    h.capacity = cap;
    h.waterFrac = clamp(b.water.litres / Math.max(1, cap), 0, 1.2);
    h.intakeLps = b.water.intakeRate;
    h.drainLps = b.water.drainRate;
    h.netLps = b.water.netRate;
    h.hull = b.hull;
    const r = b.ride;
    const wv = h.wave;
    wv.relDeg = (r.rel * 180) / Math.PI;
    wv.angleDeg = (r.angle * 180) / Math.PI;
    wv.bad = r.bad;
    wv.rough = r.rough;
    wv.clean = r.clean;
    wv.mult = r.multiplier;
    wv.next = r.combo >= 9 ? 1 : clamp(r.cleanT / CLEAN_PERIOD, 0, 1);
    wv.air = b.airT;
    h.leakLps = b.water.leak;
    h.pumping = b.water.pumping || (b.water.autoBilge > 0 && b.water.litres > 0);
    env.windAt(b.pos.x, b.pos.z, this.wnd);
    const ws = Math.hypot(this.wnd.x, this.wnd.z);
    h.windKn = ws * KNOTS;
    h.windFrom = ((Math.atan2(-this.wnd.x, this.wnd.z) * 180) / Math.PI + 360) % 360;
    h.gustKn = env.wind.speed * (1 + env.wind.gust) * KNOTS;
    env.currentAt(b.pos.x, b.pos.z, this.cur);
    h.currentKn = Math.hypot(this.cur.x, this.cur.z) * KNOTS;
    h.currentTo = ((Math.atan2(this.cur.x, -this.cur.z) * 180) / Math.PI + 360) % 360;
    const m = { s: 0, c: 0, h: 0 };
    env.waves.modulation(b.pos.x, b.pos.z, m);
    h.waveH = m.s * env.sea.swellHeight + m.c * env.sea.chopHeight * 0.8 + m.h * 0.9;
    h.heading = ((Math.atan2(b.fwd.x, -b.fwd.z) * 180) / Math.PI + 360) % 360;
    h.heelDeg = b.heelDeg;
    h.pitchDeg = (b.pitch * 180) / Math.PI;
    h.countdown = this.phase === 'countdown' ? Math.max(0, this.countdownT) : 0;
    if (b.spec.sail) {
      const gamma = Math.abs(b.awa);
      const ideal = idealSheet(gamma);
      const status = !b.sailUp
        ? 'down'
        : gamma < 0.42
          ? 'irons'
          : gamma > 2.75 && b.sheet > 0.7
            ? 'gybe'
            : b.sailAlpha < 0.07
              ? 'luff'
              : b.sailAlpha > 0.38
                ? 'stall'
                : 'drawing';
      h.sail = {
        up: b.sailUp,
        sheet: b.sheet,
        ideal,
        awaDeg: (b.awa * 180) / Math.PI,
        awsKn: b.appWind * KNOTS,
        boomDeg: b.sailUp ? (b.boomSide * b.boomAngle * 180) / Math.PI : 0,
        luff: b.sailLuff,
        power: b.sailPower,
        heelDeg: b.heelDeg,
        status,
      };
    } else h.sail = null;
    this.mode.fillHud(h);
    h.foul = b.foulT;
    h.grounded = b.grounded > 0.2;
    h.camera = this.cam.mode;
    h.x = b.pos.x;
    h.z = b.pos.z;
    h.warning = null;
    if (h.waterFrac > 0.8) h.warning = 'BILGE ALARM';
    else if (h.grounded) h.warning = 'AGROUND — back off!';
    else if (b.foulT > 0) h.warning = 'PROP FOULED';
    else if (b.propSubmerge < 0.4 && b.throttle > 0.3) h.warning = 'Prop out of the water';
  }
}
