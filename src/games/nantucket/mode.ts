// Nantucket: the docking challenge. Pick a vessel-and-berth challenge, bring the ship in through the harbour
// (tide setting, wind pushing, traffic about), and park it: a slip, a wharf face or a mooring ball. Big ships
// have tunnel thrusters and a small budget of tug calls. This is the rules half: the berth session, the
// clock, bumps and hull damage, the tugs, scoring, stars and what they unlock.

import { clamp, KNOTS } from '../../core/math';
import { boatById } from '../../data/boats';
import type { Difficulty } from '../../data/difficulty';
import { weatherById } from '../../data/weather';
import { BerthSession, berthTarget } from '../../game/berthing';
import { type BerthScoreInput, scoreBerth } from '../../game/berthScore';
import type { Game } from '../../game/game';
import type { GameMode, ModeDef, Pose } from '../../game/mode';
import { loadBest, loadStars, saveBest, saveStars } from '../../game/settings';
import type { GameConfig, HudState, Phase, ResultState } from '../../game/state';
import { Traffic } from '../../game/traffic';
import { NANTUCKET } from '../../locations/nantucket';
import { berthById, FAIRWAY } from '../../locations/nantucket/geography';
import type { Berth } from '../../locations/types';
import type { WakeBoat } from '../../render/wake';
import type { Boat } from '../../sim/boat';
import type { BoatSpec } from '../../sim/boatSpec';
import { type TugCall, TugCrew } from '../../sim/tugs';
import { LEVELS, type Level, levelById, levelOpen, nantDifficulty, TIERS, tierOpen } from './levels';
import { TugVisuals } from './tugVisuals';
import { NantUi } from './ui';

type Outcome = Exclude<ResultState['outcome'], 'finished' | 'landed' | 'adrift'>;

/** The tug keys: 1 bow to port, 2 bow to starboard, 3 stern to port, 4 stern to starboard, 5 hold. */
export const TUG_KEYS: [string, TugCall][] = [
  ['Digit1', 'bow-port'],
  ['Digit2', 'bow-stbd'],
  ['Digit3', 'stern-port'],
  ['Digit4', 'stern-stbd'],
  ['Digit5', 'hold'],
];

/** The fairway as a dense polyline (the ambient traffic's road), 18 m between points. */
function densify(pts: readonly (readonly [number, number])[], step = 18): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as readonly [number, number];
    const b = pts[i + 1] as readonly [number, number];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++)
      out.push({ x: a[0] + ((b[0] - a[0]) * k) / n, z: a[1] + ((b[1] - a[1]) * k) / n });
  }
  const last = pts[pts.length - 1] as readonly [number, number];
  out.push({ x: last[0], z: last[1] });
  return out;
}

export class NantMode implements GameMode {
  readonly id = 'nantucket' as const;
  readonly ui: NantUi;

  level: Level = LEVELS[0] as Level;
  berth: Berth = berthById(LEVELS[0]?.berth ?? '');
  spec!: BoatSpec;
  session!: BerthSession;
  tugs!: TugCrew;
  traffic!: Traffic;
  tugVis!: TugVisuals;
  /** Stars earned so far on each level. */
  stars: Record<string, number> = {};

  // run state
  private elapsed = 0;
  private penalty = 0;
  private maxSpeed = 0;
  private strandedT = 0;
  private bumpToastT = -10;
  private timeWarned = false;
  private readonly keyDown = new Set<string>();
  /** Seconds the player's thrusters have been in use (flavour for the result card). */
  thrusterS = 0;

  constructor(private readonly host: Game) {
    this.ui = new NantUi(this);
    this.stars = loadStars('nantucket');
    this.setLevel(levelById(host.cfg.level));
  }

  get start(): Pose {
    return this.level.start;
  }

  get diff(): Difficulty & { timeScale: number } {
    return nantDifficulty(this.host.cfg.difficulty);
  }

  /** Seconds on the clock for this level at this difficulty. */
  limit(): number {
    return this.level.time * this.diff.timeScale;
  }

  /** Tug calls for this run: hard difficulties allow fewer. */
  tugCalls(): number {
    const base = this.level.tugs;
    if (base === 0) return 0;
    const id = this.host.cfg.difficulty;
    return Math.max(1, base + (id === 'dockside' ? 1 : id === 'captain' ? -1 : id === 'legend' ? -2 : 0));
  }

  private setLevel(l: Level): void {
    this.level = l;
    this.berth = berthById(l.berth);
    this.spec = boatById(l.boat);
    this.session = new BerthSession(this.berth, this.spec);
    this.tugs = new TugCrew(this.spec, this.tugCalls());
  }

  /** Whether a level can be played yet. */
  open(l: Level): boolean {
    return levelOpen(l, this.stars);
  }

  // ---- setup ---------------------------------------------------------------------------------------

  init(): void {
    const h = this.host;
    this.traffic = new Traffic(
      (m) => h.rw.world.add(m.root),
      (m) => {
        h.rw.world.remove(m.root);
        m.dispose();
      },
      { lanePath: densify(FAIRWAY), basinLoop: { x: -20, z: 105, rx: 66, rz: 38 } },
      h.obstacles,
    );
    this.tugVis = new TugVisuals(h, this);
    // the level decides the vessel (the URL's ?level= may have arrived after construction)
    this.setLevel(levelById(h.cfg.level));
    h.cfg.level = this.level.id;
    h.cfg.boat = this.level.boat;
  }

  prepare(prev: GameConfig): void {
    const c = this.host.cfg;
    if (c.level !== prev.level || c.difficulty !== prev.difficulty || c.boat !== this.level.boat) {
      this.setLevel(levelById(c.level));
      c.level = this.level.id;
      c.boat = this.level.boat;
    }
  }

  populate(): void {
    const h = this.host;
    this.traffic.reset(
      h.benvStatic,
      weatherById(h.cfg.weather),
      h.settings.quality,
      this.level.start.x,
      this.diff.traffic * (this.spec.length > 30 ? 0.5 : 1) * 0.6,
    );
  }

  begin(): void {
    const h = this.host;
    this.elapsed = 0;
    this.penalty = 0;
    this.maxSpeed = 0;
    this.strandedT = 0;
    this.timeWarned = false;
    this.thrusterS = 0;
    this.bumpToastT = -10;
    this.tugs = new TugCrew(this.spec, this.tugCalls());
    this.tugVis.reset();
    this.session = new BerthSession(this.berth, this.spec);
    this.session.start(this.limit());
    // hear every bump: a docking game cares about a tap on the fenders
    h.player.impactMin = 0.3;
    h.player.tugs.length = 0;
    this.traffic.startBasin(this.diff.traffic * 0.6, h.benvStatic, weatherById(h.cfg.weather));
  }

  // ---- respawn ---------------------------------------------------------------------------------------

  respawnPose(): Pose | null {
    return this.level.start;
  }

  onRespawn(pose: Pose): void {
    this.penalty += 25;
    this.session.hold = 0;
    this.host.player.tugs.length = 0;
    this.tugs.active.length = 0;
    void pose;
    this.host.toast('Back to the start (+25 s)', 'warn');
  }

  // ---- queries -------------------------------------------------------------------------------------

  clearance(): number {
    return this.session.active ? this.session.status.clearance : 99;
  }

  wakeBoats(entry: (b: Boat) => WakeBoat): WakeBoat[] {
    const out = this.traffic.wakeBoats(this.host.player, entry);
    return [...out, ...this.tugVis.wakeBoats(entry)];
  }

  // ---- per-frame -----------------------------------------------------------------------------------

  update(dt: number, phase: Phase): void {
    this.updateTraffic(dt);
    if (phase === 'playing' || phase === 'failed' || phase === 'finished')
      this.runLogic(dt, phase === 'playing');
  }

  visuals(dt: number): void {
    const h = this.host;
    const marker = h.rw.props.berthMarker;
    const st = this.session.status;
    const ring = this.berth.kind === 'mooring';
    const t = berthTarget(this.berth, this.spec);
    marker?.update(
      dt,
      h.phase === 'loading'
        ? null
        : {
            x: ring ? this.berth.x : t.x,
            z: ring ? this.berth.z : t.z,
            heading: t.heading,
            length: ring ? this.berth.width : this.spec.length,
            beam: this.spec.beam,
            ring,
          },
      this.session.active && st.posOk && st.alignOk && st.speedOk,
    );
    this.tugVis.update(dt);
  }

  private updateTraffic(dt: number): void {
    const h = this.host;
    const player = h.player;
    this.traffic.update(dt, h.benvStatic, player, weatherById(h.cfg.weather));
    const wnd = { x: 0, z: 0 };
    for (const v of this.traffic.vessels) {
      if (v.wait > 0) continue;
      h.env.windAt(v.boat.pos.x, v.boat.pos.z, wnd);
      v.model.update(v.boat, wnd, h.env.time);
      if (Math.hypot(v.boat.pos.x - player.pos.x, v.boat.pos.z - player.pos.z) < 160) {
        h.rw.spray.emit(dt, v.boat, h.env);
      }
    }
  }

  private edge(code: string): boolean {
    const down = this.host.input.held(code);
    const was = this.keyDown.has(code);
    if (down) this.keyDown.add(code);
    else this.keyDown.delete(code);
    return down && !was;
  }

  private runLogic(dt: number, playing: boolean): void {
    const h = this.host;
    const b = h.player;

    if (playing) {
      this.elapsed += dt;
      this.maxSpeed = Math.max(this.maxSpeed, b.sog);
      if (Math.abs(b.bowThr) > 0.1 || Math.abs(b.sternThr) > 0.1) this.thrusterS += dt;
    }

    // bumps: any contact at all counts, a hard one hurts
    const hitSpeed = 0.95 + Math.min(0.5, this.spec.length / 120);
    for (const im of b.impacts) {
      if (!playing) break;
      this.session.touches++;
      if (im.speed > hitSpeed) {
        const harm = Math.min(0.5, (im.speed - 0.7 * hitSpeed) * 0.05);
        b.damage(harm);
        h.cam.addShake(Math.min(1, im.speed / 4));
        h.audio.hit(Math.max(3, im.speed * 2.5));
        h.toast(`Hull strike! Hull ${Math.round(b.hull * 100)}%`, 'bad');
      } else {
        h.audio.hit(Math.max(1.2, im.speed * 2.2));
        if (this.elapsed - this.bumpToastT > 2.2) {
          this.bumpToastT = this.elapsed;
          h.toast('Bump! Fenders to the wind.', 'warn', 1.4);
        }
      }
    }
    b.impacts.length = 0;
    if (!playing) {
      b.tugs.length = 0;
      return;
    }

    // tugs: five keys, each press a call (they only work on a hull with a tug budget)
    if (this.tugs.calls > 0) {
      for (const [code, call] of TUG_KEYS) {
        if (this.edge(code)) this.callTug(call);
      }
    }
    this.tugs.update(dt, b);

    // the berth (the session's clock carries the respawn penalties)
    this.session.t = this.elapsed + this.penalty - dt;
    const r = this.session.update(dt, b, h.benv);
    if (r === 'docked') this.finish('docked');
    else if (r === 'timeout') this.finish('timeout');

    // failure
    const failure = h.boatFailure();
    if (failure) this.finish(failure);
    if (b.grounded > 0.25 && b.sog < 0.6) this.strandedT += dt;
    else this.strandedT = Math.max(0, this.strandedT - dt * 0.5);
    if (this.strandedT > 9) this.finish('stranded');

    const left = this.limit() - (this.elapsed + this.penalty);
    if (left < 30 && !this.timeWarned) {
      this.timeWarned = true;
      h.toast('30 seconds on the clock!', 'warn', 3);
      h.audio.alarm(false);
    }
  }

  /** Call a tug: a toast either way so the player knows whether it came. */
  callTug(call: TugCall): void {
    if (this.tugs.request(call)) {
      const text: Record<TugCall, string> = {
        'bow-port': 'Tug on the bow: pushing to port',
        'bow-stbd': 'Tug on the bow: pushing to starboard',
        'stern-port': 'Tug on the stern: pushing to port',
        'stern-stbd': 'Tug on the stern: pushing to starboard',
        hold: 'Tugs holding her: braking',
      };
      this.host.toast(
        `${text[call]} · ${this.tugs.callsLeft} call${this.tugs.callsLeft === 1 ? '' : 's'} left`,
        'info',
        2,
      );
      this.host.audio.gate(true, 1);
      this.tugVis.onCall();
    } else if (this.tugs.calls > 0) {
      this.host.toast('No tug calls left!', 'warn', 1.6);
    }
  }

  // ---- the end of the run --------------------------------------------------------------------------

  private finish(outcome: 'docked' | Outcome): void {
    const h = this.host;
    if (h.phase === 'finished' || h.phase === 'failed') return;
    const diff = this.diff;
    const spec = this.spec;
    const st = this.session.status;
    const docked = outcome === 'docked';
    const time = this.elapsed + this.penalty;
    const limit = this.limit();
    const fin = this.session.finish ?? {
      along: st.along,
      across: st.across,
      align: (st.alignDeg * Math.PI) / 180,
      speed: h.player.sog,
    };
    const input: BerthScoreInput = {
      docked,
      timeFrac: clamp((limit - time) / limit, 0, 1),
      along: fin.along,
      across: fin.across,
      align: fin.align,
      speed: fin.speed,
      rules: this.session.rules,
      touches: this.session.touches,
      hull: h.player.hull,
      tugCalls: this.tugs.used,
      tugFree: this.level.tugFree,
      mult: diff.score * spec.scoreMult,
    };
    const sc = scoreBerth(input);
    const best = loadBest(this.id, h.cfg);
    const score = docked ? sc.score : 0;
    const newBest = docked && score > best;
    if (newBest) saveBest(this.id, h.cfg, score);
    const before = this.stars[this.level.id] ?? 0;
    let unlocked: string | null = null;
    if (docked && sc.stars > before) {
      const openBefore = new Set(TIERS.filter((t) => tierOpen(t.tier, this.stars)).map((t) => t.tier));
      this.stars[this.level.id] = sc.stars;
      saveStars(this.id, this.level.id, sc.stars);
      const next = TIERS.find((t) => !openBefore.has(t.tier) && tierOpen(t.tier, this.stars));
      if (next) unlocked = next.name;
    }
    const titles: Record<'docked' | Outcome, [string, string]> = {
      docked: ['Berthed!', `${this.spec.name} secure at ${this.berth.label}.`],
      swamped: ['Swamped!', 'The harbour chop filled her up. Mind the bilge in a blow.'],
      wrecked: ['Hull breached!', 'Too many hard knocks on the wharf. Take it slower next time.'],
      capsized: ['Capsized!', 'She rolled over in the harbour. Easy on the helm.'],
      stranded: ['Aground!', 'On the flats with the tide going out. Stay in the dredged channel.'],
      timeout: ['Out of time!', 'The harbourmaster gave up waiting for you to tie up.'],
    };
    const lines: { label: string; pts: number }[] = [
      { label: 'Berthed', pts: Math.round(sc.parts.base * input.mult) },
      { label: 'Precision', pts: Math.round(sc.parts.precision * input.mult) },
      { label: 'Time left', pts: Math.round(sc.parts.time * input.mult) },
      { label: 'Gentle touch', pts: Math.round(sc.parts.gentle * input.mult) },
      { label: 'Hull', pts: Math.round(sc.parts.hull * input.mult) },
      { label: `Bumps ×${this.session.touches}`, pts: Math.round(sc.parts.bumps * input.mult) },
      { label: `Tugs ×${this.tugs.used}`, pts: Math.round(sc.parts.tugs * input.mult) },
    ].filter((p) => p.pts !== 0);
    h.endRun(
      {
        outcome,
        title: titles[outcome][0],
        subtitle: titles[outcome][1],
        time,
        penalty: this.penalty,
        score,
        stars: docked ? sc.stars : 0,
        best: Math.max(best, newBest ? score : best),
        newBest,
        dryPct: 100,
        peakL: Math.round(h.player.water.peakVolume),
        capacityL: Math.round(spec.capacity * diff.capacity),
        gates: [],
        collisions: this.session.touches,
        hullPct: Math.round(h.player.hull * 100),
        bestCombo: 1,
        rideBonus: 0,
        totalIntakeL: Math.round(h.player.water.totalIntake),
        maxSpeedKn: Math.round(this.maxSpeed * KNOTS),
        boat: spec.name,
        weather: weatherById(h.cfg.weather).name,
        difficulty: diff.name,
        dock: null,
        berth: {
          docked,
          level: this.level.id,
          levelName: this.level.name,
          berth: this.berth.label,
          kind: this.berth.kind,
          time,
          alongM: fin.along,
          acrossM: fin.across,
          alignDeg: (fin.align * 180) / Math.PI,
          speedKn: fin.speed * KNOTS,
          touches: this.session.touches,
          tugCalls: this.tugs.used,
          tugFree: this.level.tugFree,
          parts: lines,
          newStars: docked && sc.stars > before,
          unlocked,
        },
      },
      docked,
    );
  }

  // ---- agents ----------------------------------------------------------------------------------------

  agentState(cheat?: boolean): Record<string, unknown> {
    const st = this.session.status;
    const t = st.target;
    return {
      level: this.level.id,
      berth: { id: this.berth.id, kind: this.berth.kind, label: this.berth.label },
      // the goal pose is shown on the water, so it is fair game for a player (and an agent)
      target: {
        x: Math.round(t.x),
        z: Math.round(t.z),
        headingDeg: Math.round(((t.heading * 180) / Math.PI + 450) % 360),
      },
      status: this.session.active
        ? {
            distM: Math.round(st.dist),
            alongM: +st.along.toFixed(1),
            acrossM: +st.across.toFixed(1),
            speedKn: +st.speedKn.toFixed(2),
            alignDeg: Math.round(st.alignDeg),
            speedOk: st.speedOk,
            alignOk: st.alignOk,
            posOk: st.posOk,
            holdS: +st.hold.toFixed(1),
            needS: st.need,
            clearanceM: +Math.min(99, st.clearance).toFixed(1),
            stopDistM: Math.round(st.stopDist),
            bumps: this.session.touches,
            timeLeftS: Math.round(Math.max(0, this.limit() - (this.elapsed + this.penalty))),
          }
        : null,
      tugs: { left: this.tugs.callsLeft, used: this.tugs.used },
      thrusters: !!this.spec.thrusters,
      ...(cheat ? { traffic: this.traffic.vessels.length } : {}),
    };
  }

  agentAct(a: Record<string, unknown>): void {
    const tug = a.tug as TugCall | undefined;
    if (tug) this.callTug(tug);
  }

  // ---- HUD -----------------------------------------------------------------------------------------

  fillHud(h: HudState): void {
    const g = this.host;
    h.time = this.elapsed + this.penalty;
    h.penalty = this.penalty;
    h.berth = g.phase === 'menu' || !this.session.active ? null : this.session.status;
    h.timeLeft = Math.max(0, this.limit() - (this.elapsed + this.penalty));
    h.gateLabel = this.berth.label;
  }
}

export const NANTUCKET_GAME: ModeDef = {
  id: 'nantucket',
  title: 'Nantucket',
  location: NANTUCKET,
  defaults: {
    weather: 'n-golden',
    tide: 'slack',
    difficulty: 'weekender',
    boat: 'pontoon',
    level: 'tiki-slip',
  },
  create: (host) => new NantMode(host),
};
