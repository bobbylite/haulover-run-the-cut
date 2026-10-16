// Haulover: the original Run the Cut. Gates through the Cut, the sea buoy, the way home, and the docking
// finale in the marina. This is the rules half of what used to be `Game`: the course and its gates, the
// run clock and its penalties, hazards, ambient traffic, the docking attempt, scoring and the result.

import { clamp, KNOTS } from '../../core/math';
import { difficultyById } from '../../data/difficulty';
import { weatherById } from '../../data/weather';
import { type Course, crossedGate, pathProgress } from '../../game/course';
import { Docking } from '../../game/docking';
import type { Game } from '../../game/game';
import type { GameMode, ModeDef, Pose } from '../../game/mode';
import { computeScore, parTime } from '../../game/scoring';
import { loadBest, saveBest } from '../../game/settings';
import type { GameConfig, HudState, Phase, ResultState } from '../../game/state';
import { Traffic } from '../../game/traffic';
import { HAULOVER } from '../../locations/haulover';
import { makeCourse } from '../../locations/haulover/course';
import type { Harbor, SlipBerth } from '../../locations/types';
import type { WakeBoat } from '../../render/wake';
import { HazardView } from '../../render/world/hazardView';
import { GateMarkers } from '../../render/world/markers';
import type { Boat } from '../../sim/boat';
import { Hazards } from '../../sim/hazards';
import { HaulUi } from './ui';

/** How a Haulover run can end (the other games add their own outcomes). */
type HaulOutcome = Exclude<ResultState['outcome'], 'landed' | 'adrift'>;

export class HaulMode implements GameMode {
  readonly id = 'haulover' as const;
  readonly ui: HaulUi;

  course!: Course;
  markers!: GateMarkers;
  traffic!: Traffic;
  hazardView!: HazardView;
  readonly hazards: Hazards;
  readonly docking: Docking;

  // run state
  private elapsed = 0;
  private penalty = 0;
  private nextGate = 0;
  private pathHint = 0;
  private prevX = 0;
  private prevZ = 0;
  private gateOffsets: (number | null)[] = [];
  private collisions = 0;
  private maxSpeed = 0;
  private strandedT = 0;
  private timeWarned = false;
  private readonly harbor: Harbor;

  constructor(private readonly host: Game) {
    this.hazards = new Hazards(host.loc);
    this.harbor = host.loc.harbor as Harbor;
    this.docking = new Docking(this.harbor.berths[0] as SlipBerth);
    this.ui = new HaulUi(this);
  }

  get start(): Pose {
    return this.course.start;
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
      { lanePath: makeCourse('outbound').path, basinLoop: this.harbor.basinLoop },
      h.obstacles,
    );
    this.course = makeCourse(h.cfg.route, difficultyById(h.cfg.difficulty).gateScale);
    this.markers = new GateMarkers(this.course);
    h.rw.world.add(this.markers.group);
    this.hazardView = new HazardView();
    h.rw.world.add(this.hazardView.group);
  }

  prepare(prev: GameConfig): void {
    const c = this.host.cfg;
    if (c.route !== prev.route || c.difficulty !== prev.difficulty) {
      this.course = makeCourse(c.route, difficultyById(c.difficulty).gateScale);
      this.markers.setCourse(this.course);
    }
  }

  populate(): void {
    const h = this.host;
    this.traffic.reset(
      h.benvStatic,
      weatherById(h.cfg.weather),
      h.settings.quality,
      this.course.start.x,
      difficultyById(h.cfg.difficulty).traffic,
    );
  }

  begin(): void {
    const diff = difficultyById(this.host.cfg.difficulty);
    this.elapsed = 0;
    this.penalty = 0;
    this.nextGate = 0;
    this.pathHint = 0;
    this.collisions = 0;
    this.maxSpeed = 0;
    this.strandedT = 0;
    this.timeWarned = false;
    this.docking.reset();
    this.hazards.generate(this.course, diff.hazards);
    this.gateOffsets = this.course.gates.map(() => null);
    this.prevX = this.host.player.pos.x;
    this.prevZ = this.host.player.pos.z;
  }

  // ---- respawn -------------------------------------------------------------------------------------

  respawnPose(): Pose | null {
    const gi = Math.max(0, this.nextGate - 1);
    const g = this.nextGate > 0 ? this.course.gates[gi] : null;
    return {
      x: g ? g.x : this.course.start.x,
      z: g ? g.z : this.course.start.z,
      heading: Math.atan2(
        g ? g.nz : Math.sin(this.course.start.heading),
        g ? g.nx : Math.cos(this.course.start.heading),
      ),
    };
  }

  onRespawn(pose: Pose): void {
    this.penalty += 20;
    this.prevX = pose.x;
    this.prevZ = pose.z;
    this.strandedT = 0;
    this.host.toast('Back on course (+20 s)', 'warn');
  }

  // ---- queries -------------------------------------------------------------------------------------

  clearance(): number {
    return this.docking.active ? this.docking.status.clearance : 99;
  }

  wakeBoats(entry: (b: Boat) => WakeBoat): WakeBoat[] {
    return this.traffic.wakeBoats(this.host.player, entry);
  }

  /** Par time for this boat on this course. */
  par(): number {
    return parTime(this.course.length, this.host.player.spec.topSpeed);
  }

  /** Run-clock allowance for this difficulty (the docking challenge has its own timer). */
  runLimit(): number {
    return this.par() * difficultyById(this.host.cfg.difficulty).timeLimit;
  }

  private berthName(): string {
    return this.docking.berth.label.toLowerCase();
  }

  // ---- per-frame -----------------------------------------------------------------------------------

  update(dt: number, phase: Phase): void {
    this.updateTraffic(dt);
    if (phase === 'playing' || phase === 'failed' || phase === 'finished')
      this.runLogic(dt, phase === 'playing');
    this.prevX = this.host.player.pos.x;
    this.prevZ = this.host.player.pos.z;
  }

  visuals(dt: number): void {
    const h = this.host;
    this.markers.update(h.env, this.nextGate, h.clock);
    // the glowing target slip (green once speed, angle and position are all right)
    const ds = this.docking.status;
    h.rw.props.dockMarker?.update(
      dt,
      !!this.course.dock && h.phase !== 'loading',
      this.docking.active && ds.posOk && ds.alignOk && ds.speedOk,
      this.docking.berthX(h.player.spec.length),
      h.player.spec.length,
    );
  }

  private updateTraffic(dt: number): void {
    const h = this.host;
    const player = h.player;
    this.traffic.update(dt, h.benvStatic, player, weatherById(h.cfg.weather));
    this.hazards.addObstacles(this.traffic.obstacles);
    this.hazardView.sync(this.hazards.list, h.env, h.clock);
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

  private runLogic(dt: number, playing: boolean): void {
    const h = this.host;
    const b = h.player;
    const diff = difficultyById(h.cfg.difficulty);
    const dockMode = this.docking.active;
    if (playing) {
      this.elapsed += dt;
      this.maxSpeed = Math.max(this.maxSpeed, b.sog);
      // the clock only runs out before the docking challenge begins (which has its own timer)
      if (!dockMode && this.elapsed + this.penalty > this.runLimit()) {
        this.finish('timeout');
        return;
      }
    }

    // hull strikes -> damage + leaks + shake (gentler thresholds at the dock, where speeds are tiny)
    const hitSpeed = dockMode ? 1.1 : 2.2;
    for (const im of b.impacts) {
      if (!playing) break;
      if (dockMode && im.speed > 0.45) this.docking.touches++;
      if (im.speed > hitSpeed) {
        this.collisions++;
        const harm = Math.min(0.5, (im.speed - 0.8 * hitSpeed) * 0.045);
        if (im.hard) {
          b.damage(harm);
          h.cam.addShake(Math.min(1, im.speed / 9));
          h.splash(0.5);
          h.audio.hit(im.speed);
          h.toast(
            `Hull strike! Hull ${Math.round(b.hull * 100)}% · leaking ${b.water.leak.toFixed(1)} L/s`,
            'bad',
          );
        }
      } else if (dockMode && im.speed > 0.45) {
        h.audio.hit(Math.max(1.2, im.speed * 2));
        h.toast('Bump! Fenders to the wind.', 'warn', 1.4);
      }
    }
    b.impacts.length = 0;

    if (!playing) return;

    // floating hazards: run over a crab-pot float and the line wraps your prop
    this.hazards.update(dt, h.env);
    if (this.hazards.pots(b.pos.x, b.pos.z, b.fwd.x, b.fwd.z, b.spec.length, b.spec.beam)) {
      b.foulT = 4.5;
      h.audio.hit(3.2);
      h.cam.addShake(0.35);
      h.toast('Prop fouled in a crab-pot line! Ease off and let it clear.', 'bad', 3.2);
    }

    // gates
    const gates = this.course.gates;
    for (let k = this.nextGate; k < Math.min(gates.length, this.nextGate + 3); k++) {
      const g = gates[k] as (typeof gates)[number];
      const hit = crossedGate(g, this.prevX, this.prevZ, b.pos.x, b.pos.z, 6 * diff.gateScale);
      if (!hit) continue;
      for (let m = this.nextGate; m < k; m++) {
        this.penalty += diff.missPenalty;
        h.toast(`Missed gate: ${gates[m]?.label} (+${diff.missPenalty} s)`, 'warn');
      }
      this.gateOffsets[k] = hit.offset;
      this.nextGate = k + 1;
      if (g.kind === 'dock') {
        this.docking.start(diff.dockTime);
        this.traffic.startBasin(diff.traffic);
        h.toast(`Marina Entrance: park in ${this.berthName()}, mind the pilings!`, 'good', 4);
        h.audio.gate(true, k);
      } else if (g.kind !== 'finish') {
        const clean = Math.abs(hit.offset) < 0.28;
        h.toast(clean ? `${g.label}: clean line` : g.label, clean ? 'good' : 'info', 1.8);
        h.audio.gate(clean, k);
      }
      break;
    }

    // finish: sea-buoy line on the sprint, or a successful berth on the routes that come home
    if (!this.course.dock) {
      if (this.nextGate >= gates.length) this.finish('finished');
    } else if (dockMode) {
      const r = this.docking.update(dt, b, h.benv);
      if (r === 'docked') this.finish('docked');
      else if (r === 'timeout') this.finish('timeout');
    }

    // failure
    const failure = h.boatFailure();
    if (failure) this.finish(failure);
    if (b.grounded > 0.25 && b.sog < 0.9 && !dockMode) this.strandedT += dt;
    else this.strandedT = Math.max(0, this.strandedT - dt * 0.5);
    if (this.strandedT > 11) this.finish('stranded');

    // the run clock
    const left = this.runLimit() - (this.elapsed + this.penalty);
    if (!dockMode && left < 30 && !this.timeWarned) {
      this.timeWarned = true;
      h.toast('30 seconds on the clock!', 'warn', 3);
      h.audio.alarm(false);
    }
  }

  // ---- the end of the run --------------------------------------------------------------------------

  private finish(outcome: HaulOutcome): void {
    const h = this.host;
    if (h.phase === 'finished' || h.phase === 'failed') return;
    const diff = difficultyById(h.cfg.difficulty);
    const spec = h.player.spec;
    const time = this.elapsed + this.penalty;
    const capacityL = spec.capacity * diff.capacity;
    const peak = h.player.water.peakVolume;
    const ok = outcome === 'finished' || outcome === 'docked';
    const par = this.par();
    const hasDock = !!this.course.dock;
    const ds = this.docking.status;
    const docked = outcome === 'docked';
    const dockInfo = hasDock
      ? {
          docked,
          time: this.docking.t,
          speedKn: ds.speedKn,
          alignDeg: ds.alignDeg,
          touches: this.docking.touches,
          bonus: 0,
        }
      : null;
    const rideBonus = h.player.ride.bonus + h.airBonus;
    const sc = computeScore({
      time,
      par,
      peakFrac: peak / capacityL,
      offsets: this.gateOffsets,
      collisions: this.collisions,
      difficultyMult: diff.score * spec.scoreMult,
      hull: h.player.hull,
      ride: rideBonus,
      dock: hasDock
        ? {
            docked,
            timeFrac: ds.timeLeft / Math.max(1, this.docking.limit),
            speed: h.player.sog,
            alignErr: (ds.alignDeg * Math.PI) / 180,
            touches: this.docking.touches,
          }
        : undefined,
    });
    if (dockInfo) dockInfo.bonus = Math.round(sc.parts.dock * diff.score);
    const best = loadBest(this.id, h.cfg);
    const score = ok ? sc.score : 0;
    const newBest = ok && score > best;
    if (newBest) saveBest(this.id, h.cfg, score);
    const titles: Record<HaulOutcome, [string, string]> = {
      finished: ['Through the Cut!', 'You cleared the sea buoy.'],
      docked: ['Docked!', `Tied up in ${this.berthName()} with the whole marina watching.`],
      swamped: ['Swamped!', `You shipped more than ${Math.round(capacityL)} L and went down.`],
      wrecked: ['Hull breached!', 'The sea pounded the hull to pieces. Take big waves at 45°, not head-on.'],
      capsized: ['Capsized!', 'The sea rolled you over.'],
      stranded: ['Aground!', 'Stuck on the bottom with the tide going out.'],
      timeout: [
        'Out of time!',
        this.docking.active
          ? 'The harbourmaster gave up waiting for you to park.'
          : 'The clock beat you through the Cut.',
      ],
    };
    h.endRun(
      {
        outcome,
        title: titles[outcome][0],
        subtitle: titles[outcome][1],
        time,
        penalty: this.penalty,
        score,
        stars: ok ? sc.stars : 0,
        best: Math.max(best, newBest ? score : best),
        newBest,
        dryPct: Math.round(clamp(1 - peak / capacityL, 0, 1) * 100),
        peakL: Math.round(peak),
        capacityL: Math.round(capacityL),
        gates: this.course.gates.map((g, i) => ({ label: g.label, offset: this.gateOffsets[i] ?? null })),
        collisions: this.collisions,
        hullPct: Math.round(h.player.hull * 100),
        bestCombo: h.player.ride.bestCombo + 1,
        rideBonus: Math.round(Math.min(900, rideBonus)),
        totalIntakeL: Math.round(h.player.water.totalIntake),
        maxSpeedKn: Math.round(this.maxSpeed * KNOTS),
        boat: spec.name,
        weather: weatherById(h.cfg.weather).name,
        difficulty: diff.name,
        dock: dockInfo,
      },
      ok,
    );
  }

  // ---- agents ----------------------------------------------------------------------------------------

  agentState(): Record<string, unknown> {
    const g = this.course.gates[Math.min(this.nextGate, this.course.gates.length - 1)];
    const ds = this.docking.active ? this.docking.status : null;
    return {
      route: this.host.cfg.route,
      gates: this.course.gates.length,
      gatesPassed: Math.min(this.nextGate, this.course.gates.length),
      nextGate: g
        ? {
            label: g.label,
            kind: g.kind,
            x: Math.round(g.x),
            z: Math.round(g.z),
            nx: +g.nx.toFixed(3),
            nz: +g.nz.toFixed(3),
            half: g.half,
          }
        : null,
      timeLeftS: Math.round(
        this.docking.active ? 0 : Math.max(0, this.runLimit() - (this.elapsed + this.penalty)),
      ),
      penaltyS: Math.round(this.penalty),
      docking: ds
        ? {
            speedKn: +ds.speedKn.toFixed(1),
            alignDeg: Math.round(ds.alignDeg),
            distM: Math.round(ds.dist),
            clearanceM: +ds.clearance.toFixed(1),
            speedOk: ds.speedOk,
            alignOk: ds.alignOk,
            posOk: ds.posOk,
            timeLeftS: Math.round(ds.timeLeft),
          }
        : null,
    };
  }

  // ---- HUD -----------------------------------------------------------------------------------------

  fillHud(h: HudState): void {
    const g = this.host;
    const b = g.player;
    h.time = this.elapsed + this.penalty;
    h.penalty = this.penalty;
    h.gate = Math.min(this.nextGate, this.course.gates.length);
    h.gates = this.course.gates.length;
    h.gateLabel = this.course.gates[Math.min(this.nextGate, this.course.gates.length - 1)]?.label ?? '';
    const prog = pathProgress(this.course, b.pos.x, b.pos.z, this.pathHint);
    this.pathHint = prog.idx;
    h.progress = g.phase === 'menu' ? 0 : clamp(prog.frac, 0, 1);
    h.dock = this.docking.active ? this.docking.status : null;
    h.timeLeft = this.docking.active ? 0 : Math.max(0, this.runLimit() - (this.elapsed + this.penalty));
  }
}

export const HAULOVER_GAME: ModeDef = {
  id: 'haulover',
  title: 'Haulover',
  location: HAULOVER,
  create: (host) => new HaulMode(host),
};
