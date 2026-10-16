// Montauk: find the bait, troll a spread through it, hook a tuna, and keep it on while the crew reels.
// Landing a tuna is the win. The wind blows against the ebb the whole way, and both build through the day.
//
// This is the rules half. The fish world, the tackle and the fight are pure sims in sim/fishing; the real
// boat (wind, tide and sea pushing it around) is the engine's. What lives here is the day itself: phases,
// the daylight clock, what the captain has seen, scoring and the result.

import { Color, Vector3 } from 'three/webgpu';
import { clamp, KNOTS, lerp, Rng, smoothstep, wrapAngle } from '../../core/math';
import { type WeatherPreset, weatherById } from '../../data/weather';
import type { Game } from '../../game/game';
import type { GameMode, ModeDef, Pose } from '../../game/mode';
import { loadBest, saveBest } from '../../game/settings';
import type { CatchResult, GameConfig, HudState, Phase, ResultState } from '../../game/state';
import { MONTAUK } from '../../locations/montauk';
import { FISH_ZONES, RANGE, START } from '../../locations/montauk/geography';
import type { WakeBoat } from '../../render/wake';
import type { Boat } from '../../sim/boat';
import { Fight, type FightEnd } from '../../sim/fishing/fight';
import { SPECIES, type Species, type SpeciesId } from '../../sim/fishing/species';
import { type Rod, Tackle } from '../../sim/fishing/tackle';
import { type FishTier, seaFor, tierById } from '../../sim/fishing/tiers';
import {
  type Cue,
  cueSeen,
  FishWorld,
  type School,
  type SchoolTuna,
  visibilityRange,
} from '../../sim/fishing/world';
import { rodPoints, transom } from './rig';
import { FishUi } from './ui';
import { FishVisuals } from './visuals';

/** How the day can end here (on top of the shared boat failures). */
type FishOutcome = Extract<
  ResultState['outcome'],
  'landed' | 'timeout' | 'swamped' | 'wrecked' | 'capsized' | 'stranded' | 'adrift'
>;

export type FishPhase = 'search' | 'troll' | 'fight';

/** A sign the captain has actually seen, remembered for a while on the map. */
export interface Sighting {
  school: number;
  kind: Cue['kind'];
  x: number;
  z: number;
  /** Game time it was last seen (s). */
  t: number;
  strength: number;
}

export interface Mark {
  x: number;
  z: number;
  t: number;
  label: string;
}

/** Fade a preset towards another: the sky moves on through the day while the sea keeps its character. */
export function lerpPreset(a: WeatherPreset, b: WeatherPreset, t: number): WeatherPreset {
  const out = { ...a } as WeatherPreset;
  const c1 = new Color();
  const c2 = new Color();
  for (const k of [
    'sunColor',
    'skyHorizon',
    'skyMid',
    'skyZenith',
    'cloudLit',
    'cloudShade',
    'hazeColor',
    'waterDeep',
    'waterShallow',
    'waterGlow',
  ] as const) {
    out[k] = `#${c1.set(a[k]).lerp(c2.set(b[k]), t).getHexString()}`;
  }
  for (const k of [
    'sunElevation',
    'sunIntensity',
    'cloudCover',
    'haze',
    'foam',
    'exposure',
    'saturation',
    'contrast',
    'bloom',
    'vignette',
    'warmth',
  ] as const) {
    out[k] = lerp(a[k], b[k], t);
  }
  let d = ((b.sunAzimuth - a.sunAzimuth + 540) % 360) - 180;
  d = Number.isFinite(d) ? d : 0;
  out.sunAzimuth = a.sunAzimuth + d * t;
  return out;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass point for a world bearing (x east, z south). */
export const compassOf = (dx: number, dz: number): string => {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return COMPASS[(Math.round(((a + 360) % 360) / 45) % 8) as number] as string;
};

export class FishMode implements GameMode {
  readonly id = 'montauk' as const;
  readonly ui: FishUi;
  readonly start: Pose = { x: START.x, z: START.z, heading: START.heading };

  world!: FishWorld;
  readonly tackle = new Tackle();
  fight: Fight | null = null;
  fx!: FishVisuals;

  // the day
  elapsed = 0;
  strikes = 0;
  lost = 0;
  tangles = 0;
  lastLoss: string | null = null;
  landed: { species: Species; kg: number; fightS: number; cleanPct: number; peak: number } | null = null;
  readonly marks: Mark[] = [];
  readonly sightings = new Map<string, Sighting>();
  /** What is in view this frame (for the binocular overlay): cue plus screen-space bearing and distance. */
  seenNow: { cue: Cue; dist: number; bearing: number }[] = [];
  /** The last fight's tension history (for the gauge trace). */
  readonly trace: number[] = [];
  seed = 1;
  binoculars = false;
  /** An agent holding the binoculars up (see agentAct). */
  private agentBino = false;
  /** Dev and test: a pilot's hands on the drag lever and the pump, in place of the keyboard. */
  override: { drag?: number; pump?: boolean } | null = null;

  private seenAt = 0;
  private rangeT = 0;
  private strandedT = 0;
  private warnedDay = new Set<number>();
  private lastNervous = -99;
  private lastSpotToast = -99;
  private hintsShown = new Set<string>();
  private collisions = 0;
  private maxSpeed = 0;
  private overtime = 0;
  private prevHeading = 0;
  private yawRate = 0;
  private restY = 0;
  private heave = 0;
  private fightSeed = 1;
  private camBefore: string | null = null;
  private skyAt = -99;
  /** How the last fight ended (read by the dev scripts). */
  lastEndKind: FightEnd['kind'] | null = null;
  private readonly p3 = new Vector3();
  private readonly look3 = new Vector3();
  private readonly trng = new Rng(98765);

  constructor(private readonly host: Game) {
    this.ui = new FishUi(this);
  }

  difficulty(id: string): ReturnType<typeof seaFor> {
    return seaFor(id);
  }

  get tier(): FishTier {
    return tierById(this.host.cfg.difficulty);
  }

  get phaseName(): FishPhase {
    if (this.fight) return 'fight';
    return this.tackle.linesOut > 0 || this.tackle.tangled > 0 ? 'troll' : 'search';
  }

  get daylightLeft(): number {
    return Math.max(0, this.tier.daylightS - this.elapsed);
  }

  // ---- setup ---------------------------------------------------------------------------------------

  init(): void {
    const h = this.host;
    this.world = new FishWorld(
      {
        depthAt: (x, z) => h.env.depthAt(x, z),
        currentAt: (x, z, out) => h.env.currentAt(x, z, out),
      },
      FISH_ZONES,
      RANGE,
      this.tier,
      1,
    );
    this.fx = new FishVisuals(h, this);
    h.rw.world.add(this.fx.group);
    h.input.sheetRate = 0.9;
    h.input.on('lines', () => this.toggleLines());
    h.input.on('mark', () => this.dropMark());
    // the drag lever starts mid-travel
    h.input.sheet = 0.5;
  }

  prepare(prev: GameConfig): void {
    const c = this.host.cfg;
    // there is no slack water off Montauk: the tide is either going out or coming in
    if (c.tide === 'slack') c.tide = 'ebb';
    if (c.difficulty !== prev.difficulty) this.populate();
  }

  populate(): void {
    this.seed = (Math.floor(Math.random() * 1e9) + 1) | 0;
    const q = new URLSearchParams(location.search).get('seed');
    if (q) this.seed = Number(q) | 0;
    this.world.reset(this.seed, this.tier, this.start);
    this.world.tier = this.tier;
    // back at the dock the sea eases to where the day began
    this.host.env.windGain = 1;
    this.host.env.tideGain = 1;
  }

  begin(): void {
    const h = this.host;
    this.elapsed = 0;
    this.strikes = 0;
    this.lost = 0;
    this.tangles = 0;
    this.lastLoss = null;
    this.landed = null;
    this.fight = null;
    this.marks.length = 0;
    this.sightings.clear();
    this.seenNow = [];
    this.trace.length = 0;
    this.warnedDay.clear();
    this.hintsShown.clear();
    this.rangeT = 0;
    this.strandedT = 0;
    this.overtime = 0;
    this.collisions = 0;
    this.maxSpeed = 0;
    this.lastEndKind = null;
    this.skyAt = -99;
    this.fightSeed = this.seed * 31 + 7;
    h.env.windGain = 1;
    h.env.tideGain = 1;
    h.input.sheet = 0.5;
    h.cam.fightFocus = null;
    if (h.cam.mode === 'fight') h.cam.mode = 'chase';
    const b = h.player;
    this.prevHeading = b.heading;
    const s = this.sternOf(b);
    this.tackle.prime(s.x, s.z, b.fwd.x, b.fwd.z);
    this.restY = b.pos.y;
    this.fx.reset();
    this.hint(
      'start',
      'Find birds, boils or a slick. Hold V for binoculars; the fish finder shows what is under you.',
      6,
    );
  }

  private sternOf(b: Boat): { x: number; z: number } {
    transom(b, this.p3);
    return { x: this.p3.x, z: this.p3.z };
  }

  /** A teaching toast, shown once per run. */
  private hint(key: string, text: string, ttl = 5): void {
    if (this.hintsShown.has(key)) return;
    this.hintsShown.add(key);
    this.host.toast(text, 'info', ttl);
  }

  // ---- respawn -------------------------------------------------------------------------------------

  respawnPose(): Pose | null {
    // not in the middle of a fight; and it costs you the run home
    return this.fight ? null : { x: START.x, z: START.z, heading: START.heading };
  }

  onRespawn(): void {
    this.elapsed += 75;
    this.tackle.retrieve();
    const b = this.host.player;
    const s = this.sternOf(b);
    this.tackle.prime(s.x, s.z, b.fwd.x, b.fwd.z);
    this.host.toast('Back in the lee off the Point (−75 s of daylight)', 'warn');
  }

  /** After the boat models are posed: the rods, lines, birds and the fish follow the live state. */
  visuals(dt: number): void {
    this.fx.update(dt);
  }

  audio(): { slip: number; reel: number; tension: number } | null {
    const f = this.fight;
    return f ? { slip: f.slip, reel: f.reel, tension: f.T } : null;
  }

  clearance(): number {
    const b = this.host.player;
    const d = this.host.loc.fields.hardSDF(b.pos.x, b.pos.z) - b.spec.length * 0.4;
    return d < 14 ? d : 99;
  }

  wakeBoats(): WakeBoat[] {
    return [];
  }

  // ---- per frame -----------------------------------------------------------------------------------

  update(dt: number, phase: Phase): void {
    const h = this.host;
    const b = h.player;
    const playing = phase === 'playing';
    const live = playing || phase === 'failed' || phase === 'finished';

    // yaw rate and stern heave, used by the tackle and the fight
    this.yawRate = wrapAngle(b.heading - this.prevHeading) / Math.max(1e-3, dt);
    this.prevHeading = b.heading;
    this.restY += (b.pos.y - this.restY) * Math.min(1, dt / 6);
    this.heave = b.pos.y - this.restY;

    // the fish live their own lives from the moment the menu is up
    // a school is spooked by the noise and wake of the hull in the water, so it is the speed *through the
    // water* that counts, not the speed over the ground (the tide gives you plenty of that for free)
    const stw = Math.abs(b.speed);
    if (phase !== 'paused') this.world.step(dt, { x: b.pos.x, z: b.pos.z, sog: playing ? stw : 0 });

    if (phase === 'menu' || phase === 'countdown') {
      this.hold(b);
      return;
    }
    if (!live) return;

    this.sternFocus(b);
    if (playing) {
      this.elapsed += dt;
      this.maxSpeed = Math.max(this.maxSpeed, b.sog);
      this.dayClock(dt);
      this.senses(dt);
      this.rig(dt);
      this.fishing(dt);
      this.safety(dt);
    }
    this.impacts(playing);

    const failure = h.boatFailure();
    if (failure && playing) this.finish(failure);
    if (this.daylightLeft <= 0 && playing) {
      if (this.fight) {
        this.overtime += dt;
        this.hint('overtime', 'Last light! Land this fish and it is still a win.', 4);
        if (this.overtime > 150) this.finish('timeout');
      } else this.finish('timeout');
    }
  }

  /** What the stern view looks at: the fish on the line, else the middle of the spread, else nothing. */
  private sternFocus(b: Boat): void {
    const cam = this.host.cam;
    if (this.fight) return;
    let n = 0;
    let x = 0;
    let z = 0;
    for (const r of this.tackle.rods) {
      if (r.state === 'stowed' || r.state === 'hooked') continue;
      x += r.x;
      z += r.z;
      n++;
    }
    if (n === 0) {
      cam.fightFocus = null;
      if (cam.mode === 'fight') cam.mode = 'chase';
      return;
    }
    // aim a little short of the lures so the boat stays in frame
    const fx = x / n;
    const fz = z / n;
    cam.fightFocus = { x: b.pos.x + (fx - b.pos.x) * 0.8, z: b.pos.z + (fz - b.pos.z) * 0.8 };
  }

  private hold(b: Boat): void {
    // while waiting at the dock the spread is stowed and the trail is laid straight
    const s = this.sternOf(b);
    this.tackle.prime(s.x, s.z, b.fwd.x, b.fwd.z);
  }

  // ---- the day: sky and sea build ---------------------------------------------------------------------

  private dayClock(dt: number): void {
    void dt;
    const h = this.host;
    const t = this.tier;
    const p = clamp(this.elapsed / t.daylightS, 0, 1.15);
    h.env.windGain = lerp(1, t.windRamp, p);
    h.env.tideGain = lerp(1, t.tideRamp, p);
    // the sky drifts towards dusk through the second half of the day
    if (this.elapsed - this.skyAt > 4) {
      this.skyAt = this.elapsed;
      const base = weatherById(h.cfg.weather);
      const dusk = weatherById('m-dusk');
      const f = smoothstep(0.4, 1.05, p) * (base.id === dusk.id ? 0 : 0.7);
      h.rw.weather.setTarget(f > 0.01 ? lerpPreset(base, dusk, f) : base);
    }
    for (const mark of [120, 60, 30]) {
      if (this.daylightLeft <= mark && !this.warnedDay.has(mark)) {
        this.warnedDay.add(mark);
        h.toast(`${mark} seconds of daylight left`, mark <= 30 ? 'bad' : 'warn', 3);
        h.audio.alarm(mark <= 30);
      }
    }
  }

  // ---- what the captain can see ------------------------------------------------------------------------

  private senses(dt: number): void {
    const h = this.host;
    const input = h.input;
    // binoculars: hold V; the lens narrows and the view comes up to the helm
    const bino = (input.binoculars || this.agentBino) && !this.fight;
    if (bino !== this.binoculars) {
      this.binoculars = bino;
      if (bino) {
        this.camBefore = h.cam.mode;
        h.cam.mode = 'helm';
        h.cam.fovOverride = 17;
      } else {
        h.cam.fovOverride = null;
        if (this.camBefore) h.cam.mode = this.camBefore as typeof h.cam.mode;
        this.camBefore = null;
      }
    }

    this.seenAt -= dt;
    if (this.seenAt > 0) return;
    this.seenAt = 0.25;
    const b = h.player;
    const cam = h.rw.camera;
    const dir = cam.getWorldDirection(this.look3);
    const look = Math.atan2(dir.z, dir.x);
    const vFov = (cam.fov * Math.PI) / 180;
    const half = Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const range = visibilityRange(h.rw.weather.haze, bino);
    const cues = this.world.cues();
    this.seenNow = [];
    for (const c of cues) {
      const s = cueSeen(c, b.pos.x, b.pos.z, look, half, range);
      // the stern and the flanks are seen too, a little, so a circling flock behind you is not invisible
      const near = s.dist < range * c.reach * 0.35;
      if (!s.seen && !near) continue;
      this.seenNow.push({ cue: c, dist: s.dist, bearing: s.bearing });
      const key = `${c.school.id}:${c.kind}`;
      const was = this.sightings.get(key);
      this.sightings.set(key, {
        school: c.school.id,
        kind: c.kind,
        x: c.x,
        z: c.z,
        t: this.elapsed,
        strength: c.strength,
      });
      if (!was || this.elapsed - was.t > 20) this.spotted(c, s.dist, b);
    }
    // forget old sightings
    for (const [k, s] of this.sightings) if (this.elapsed - s.t > 35) this.sightings.delete(k);
  }

  private spotted(c: Cue, dist: number, b: Boat): void {
    if (this.elapsed - this.lastSpotToast < 6) return;
    this.lastSpotToast = this.elapsed;
    const h = this.host;
    const where = compassOf(c.x - b.pos.x, c.z - b.pos.z);
    const what = c.kind === 'boil' ? 'Boils' : c.kind === 'birds' ? 'Birds working' : 'A slick';
    h.toast(`${what} to the ${where}, ${(dist / 1852).toFixed(1)} nm`, 'good', 3.4);
    h.audio.gate(true, 2);
    this.hint(
      'spot',
      'Boils mean tuna; birds alone may be only bait. Slow to troll speed before you reach them.',
      6,
    );
  }

  // ---- controls ---------------------------------------------------------------------------------------

  toggleLines(): void {
    const h = this.host;
    if (h.phase !== 'playing' || this.fight) return;
    const stwKn = Math.max(0, h.player.speed) * KNOTS;
    if (this.tackle.linesOut > 0 || this.tackle.tangled > 0) {
      this.tackle.retrieve();
      h.toast('Reeling the lines in', 'info', 1.8);
    } else if (this.tackle.setLines(stwKn)) {
      h.toast('Lines out, one at a time. Hold it between 5 and 8 knots through the water.', 'good', 3.4);
      h.audio.splash(0.3);
    } else h.toast(`Too fast to set lines (${stwKn.toFixed(0)} kn). Slow below 9.`, 'warn', 2.6);
  }

  dropMark(): void {
    const h = this.host;
    if (h.phase !== 'playing') return;
    const b = h.player;
    const label = `Mark ${this.marks.length + 1}`;
    this.marks.push({ x: b.pos.x, z: b.pos.z, t: this.elapsed, label });
    if (this.marks.length > 5) this.marks.shift();
    h.toast(`${label} dropped. The bait will drift with the tide.`, 'info', 2.6);
    h.audio.gate(false, 1);
  }

  // ---- the spread ---------------------------------------------------------------------------------------

  private rig(dt: number): void {
    const h = this.host;
    const b = h.player;
    const s = this.sternOf(b);
    const cur = { x: 0, z: 0 };
    h.env.currentAt(b.pos.x, b.pos.z, cur);
    const fl = Math.hypot(b.fwd.x, b.fwd.z) || 1;
    // wave slaps fling the rod tips about
    for (const hit of b.hits) if (hit.kind === 'slap') this.tackle.seaSlap(hit.speed / 5, this.trng);
    this.tackle.biteRate = 0.5;
    this.tackle.update(
      dt,
      {
        sx: s.x,
        sz: s.z,
        fx: b.fwd.x / fl,
        fz: b.fwd.z / fl,
        stw: b.speed,
        yawRate: this.yawRate,
        cx: cur.x,
        cz: cur.z,
      },
      (x, z, r) => this.world.tunaNear(x, z, r),
      this.trng,
      this.tier.bite,
    );
    for (const e of this.tackle.drain()) {
      switch (e.kind) {
        case 'tangle':
          this.tangles++;
          h.toast(
            e.cause === 'sea'
              ? 'The sea has crossed your lines!'
              : 'Lines crossed! Straighten out and hold a steady speed.',
            'bad',
            3,
          );
          h.audio.hit(2.6);
          break;
        case 'foul':
          h.player.foulT = 4;
          h.toast('Backed down with lines out: they are round the prop!', 'bad', 3.2);
          break;
        case 'cleared':
          h.toast('Tangle cleared, lines going back out', 'good', 2.2);
          break;
        case 'strike':
          this.strike(e.rod, e.tuna, b);
          break;
        case 'crossFight':
          if (this.fight) {
            this.fight.chafe = Math.min(1, this.fight.chafe + 0.12);
            this.hint(
              'cross',
              'Careful: turning hard while the other lines come in crosses the fight line.',
              3,
            );
          }
          break;
      }
    }
    // tangled lines and crowded water are hints worth giving once
    if (this.tackle.linesOut > 0 && !this.fight) {
      const kn = Math.max(0, b.speed) * KNOTS;
      if (kn > 9.2)
        this.hint('fast', 'Too fast: the lures are skipping out of the water. Ease below 8 knots.', 4);
      else if (kn < 3 && kn > 0.3 && this.tackle.fishing > 0)
        this.hint('slow', 'Too slow: the lures are sinking. Speed up to 5 to 8 knots.', 4);
    }
  }

  // ---- strikes and fights ------------------------------------------------------------------------------

  private strike(rod: Rod, tuna: SchoolTuna, b: Boat): void {
    const h = this.host;
    if (this.fight) return;
    this.strikes++;
    tuna.gone = true;
    this.tackle.hook(rod);
    const s = this.sternOf(b);
    const line = Math.hypot(rod.x - s.x, rod.z - s.z) + 4;
    this.fightSeed++;
    this.fight = new Fight(tuna.species, tuna.kg, this.tier, this.fightSeed, {
      x: rod.x,
      z: rod.z,
      depth: clamp(tuna.depth, 1.5, 40),
      line,
    });
    this.trace.length = 0;
    this.lastEndKind = null;
    h.input.sheet = 0.5;
    h.cam.fightFocus = { x: rod.x, z: rod.z };
    if (h.cam.mode !== 'helm') h.cam.mode = 'fight';
    h.toast('FISH ON! Throttle back and ease the drag (Q), then chase it.', 'good', 4);
    h.audio.gate(true, 5);
    h.audio.strike();
    h.cam.addShake(0.5);
    this.fx.onStrike(rod);
  }

  private fishing(dt: number): void {
    const f = this.fight;
    if (!f) return;
    const h = this.host;
    const b = h.player;
    const s = this.sternOf(b);
    const fl = Math.hypot(b.fwd.x, b.fwd.z) || 1;
    // the fish and the boat share the tide, so what counts is the boat's motion through the water
    const cur = { x: 0, z: 0 };
    h.env.currentAt(b.pos.x, b.pos.z, cur);
    f.step(dt, {
      sx: s.x,
      sz: s.z,
      fx: b.fwd.x / fl,
      fz: b.fwd.z / fl,
      vx: b.vel.x - cur.x,
      vz: b.vel.z - cur.z,
      boatLen: b.spec.length,
      slam: h.frameSlam,
      rough: b.ride.rough,
      heave: this.heave,
      floor: (x, z) => h.env.depthAt(x, z),
      current: (x, z, out) => h.env.currentAt(x, z, out),
      drag: this.override?.drag ?? h.input.sheet,
      pump: this.override?.pump ?? h.input.fishPump,
    });
    this.trace.push(f.T);
    if (this.trace.length > 240) this.trace.shift();
    if (h.cam.fightFocus) {
      h.cam.fightFocus.x = f.x;
      h.cam.fightFocus.z = f.z;
    }
    for (const e of f.drain()) this.fightEvent(e);
    if (f.end) this.fightOver(f, f.end);
  }

  private fightEvent(e: ReturnType<Fight['drain']>[number]): void {
    const h = this.host;
    switch (e) {
      case 'run':
        h.toast('She is running!', 'warn', 1.6);
        h.audio.reelScream(1);
        break;
      case 'sulk':
        h.toast('Sounding. Hold steady and pump her up (Z).', 'info', 2.2);
        break;
      case 'thrash':
        this.fx.onThrash();
        break;
      case 'dash':
        h.toast('She has seen the boat: a last dash!', 'warn', 2.2);
        h.audio.reelScream(1);
        break;
      case 'rest':
        h.toast('The crew needs a breather…', 'info', 2);
        break;
      case 'slam':
        break;
    }
  }

  private fightOver(f: Fight, end: FightEnd): void {
    const h = this.host;
    this.lastEndKind = end.kind;
    const school = this.world.schools.find((s) => s.tuna.some((t) => t.gone && t.kg === f.kg));
    if (end.kind === 'landed') {
      this.endFightCamera();
      this.landed = {
        species: f.species,
        kg: f.kg,
        fightS: f.time,
        cleanPct: f.cleanPct,
        peak: f.peakT,
      };
      this.finish('landed');
      return;
    }
    this.endFightCamera();
    this.lost++;
    this.lastLoss = end.why;
    h.toast(
      end.kind === 'snapped' ? 'The line parted!' : end.kind === 'pulled' ? 'The hook pulled!' : 'Cut off!',
      'bad',
      3.4,
    );
    h.toast(end.why, 'warn', 6);
    h.audio.alarm(true);
    h.cam.addShake(0.7);
    if (school) this.world.spook(school, 50);
    this.fx.onLost(f);
    this.tackle.release();
    this.fight = null;
    h.toast('Set the lines again (L) once you are back at speed.', 'info', 4);
  }

  private endFightCamera(): void {
    const cam = this.host.cam;
    cam.fightFocus = null;
    if (cam.mode === 'fight') cam.mode = 'chase';
  }

  // ---- safety nets ---------------------------------------------------------------------------------------

  private safety(dt: number): void {
    const h = this.host;
    const b = h.player;
    // out of range: the grounds end
    if (Math.abs(b.pos.x) > RANGE.x || Math.abs(b.pos.z) > RANGE.z) {
      this.rangeT += dt;
      if (this.rangeT < dt * 1.5) h.toast('Leaving the grounds. Turn back or the day is over.', 'warn', 3);
      if (this.rangeT > 22) this.finish('adrift');
    } else this.rangeT = Math.max(0, this.rangeT - dt * 2);
    // aground
    if (b.grounded > 0.25 && b.sog < 0.9) this.strandedT += dt;
    else this.strandedT = Math.max(0, this.strandedT - dt * 0.5);
    if (this.strandedT > 10) this.finish('stranded');
    // a nervous school
    for (const s of this.world.schools) {
      if (
        s.fright > 0.45 &&
        this.elapsed - this.lastNervous > 9 &&
        Math.hypot(s.x - b.pos.x, s.z - b.pos.z) < s.radius + 200
      ) {
        this.lastNervous = this.elapsed;
        h.toast('The school is getting nervous. Ease off the throttle!', 'warn', 2.6);
      }
    }
  }

  private impacts(playing: boolean): void {
    const h = this.host;
    const b = h.player;
    for (const im of b.impacts) {
      if (!playing) break;
      if (im.speed > 2.2) {
        this.collisions++;
        const harm = Math.min(0.5, (im.speed - 1.8) * 0.045);
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
      }
    }
    b.impacts.length = 0;
  }

  // ---- the end of the day -------------------------------------------------------------------------------

  private finish(outcome: FishOutcome): void {
    const h = this.host;
    if (h.phase === 'finished' || h.phase === 'failed') return;
    const tier = this.tier;
    const spec = h.player.spec;
    const ok = outcome === 'landed';
    const land = this.landed;
    const parts: { label: string; pts: number }[] = [];
    let score = 0;
    if (ok && land) {
      parts.push({
        label: `${land.kg} kg ${land.species.name}`,
        pts: Math.round(land.kg * land.species.value * 3),
      });
      parts.push({ label: 'Clean fight', pts: Math.round(land.cleanPct * 4) });
      parts.push({ label: 'Daylight to spare', pts: Math.round((this.daylightLeft / tier.daylightS) * 600) });
      parts.push({ label: 'Hull in one piece', pts: Math.round(h.player.hull * 200) });
      if (this.lost > 0) parts.push({ label: `Lost fish ×${this.lost}`, pts: -60 * this.lost });
      if (this.tangles > 0) parts.push({ label: `Tangles ×${this.tangles}`, pts: -40 * this.tangles });
      const raw = parts.reduce((a, p) => a + p.pts, 0);
      score = Math.max(0, Math.round(raw * tier.score));
    }
    const best = loadBest(this.id, h.cfg);
    const newBest = ok && score > best;
    if (newBest) saveBest(this.id, h.cfg, score);
    const stars = !ok ? 0 : score >= 2800 ? 3 : score >= 1500 ? 2 : 1;
    const titles: Record<FishOutcome, [string, string]> = {
      landed: [
        land ? `A ${land.kg} kg ${land.species.name}!` : 'Tuna on the deck!',
        'Gaffed and over the rail. That is how it is done off Montauk.',
      ],
      timeout: [
        'Last light',
        this.strikes > 0
          ? 'The sun went down with no tuna on the deck.'
          : 'The sun went down without a bite. Look for boils, and slow down when you find them.',
      ],
      swamped: ['Swamped!', 'The rips filled the boat and took her down.'],
      wrecked: ['Hull breached!', 'The sea pounded the hull to pieces. Take big waves at 45°, not head-on.'],
      capsized: ['Capsized!', 'The sea rolled you over.'],
      stranded: ['Aground!', 'Stuck on the rocks off the Point with the ebb running.'],
      adrift: ['Out of range', 'You ran off the grounds and the day was over.'],
    };
    const fishRes: CatchResult = {
      landed: ok,
      species: land?.species.name ?? '',
      kg: land?.kg ?? 0,
      fightS: land?.fightS ?? 0,
      strikes: this.strikes,
      lost: this.lost,
      cleanPct: land?.cleanPct ?? 0,
      peakTension: land?.peak ?? 0,
      reason: this.lastLoss,
      parts,
    };
    h.endRun(
      {
        outcome,
        title: titles[outcome][0],
        subtitle: titles[outcome][1],
        time: this.elapsed,
        penalty: 0,
        score,
        stars,
        best: Math.max(best, newBest ? score : best),
        newBest,
        dryPct: Math.round(
          clamp(1 - h.player.water.peakVolume / Math.max(1, spec.capacity * 0.4), 0, 1) * 100,
        ),
        peakL: Math.round(h.player.water.peakVolume),
        capacityL: Math.round(spec.capacity),
        gates: [],
        collisions: this.collisions,
        hullPct: Math.round(h.player.hull * 100),
        bestCombo: h.player.ride.bestCombo + 1,
        rideBonus: Math.round(h.player.ride.bonus),
        totalIntakeL: Math.round(h.player.water.totalIntake),
        maxSpeedKn: Math.round(this.maxSpeed * KNOTS),
        boat: spec.name,
        weather: weatherById(h.cfg.weather).name,
        difficulty: tier.name,
        dock: null,
        fish: fishRes,
      },
      ok,
    );
  }

  // ---- HUD -----------------------------------------------------------------------------------------------

  fillHud(hud: HudState): void {
    hud.time = this.elapsed;
    hud.timeLeft = this.daylightLeft;
    hud.progress = clamp(this.elapsed / this.tier.daylightS, 0, 1);
    hud.dock = null;
    hud.gate = 0;
    hud.gates = 0;
    hud.gateLabel = '';
  }

  /** Where the tuna school nearest a point is (for the autopilot-style test bot and the debug overlay). */
  nearestSchool(x: number, z: number, tuna = false): School | undefined {
    let best: School | undefined;
    let bd = 1e12;
    for (const s of this.world.schools) {
      if (tuna && !s.tuna.some((f) => !f.gone)) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ---- agents ----------------------------------------------------------------------------------------

  /** What a captain can know: the stage, the clock, the signs seen, the lines, and the fight. `cheat` adds the fish. */
  agentState(cheat: boolean): Record<string, unknown> {
    const f = this.fight;
    const w = f?.warning;
    const out: Record<string, unknown> = {
      stage: this.phaseName,
      daylightLeftS: Math.round(this.daylightLeft),
      strikes: this.strikes,
      lost: this.lost,
      tangles: this.tangles,
      lastLoss: this.lastLoss,
      stwKn: +(Math.max(0, this.host.player.speed) * KNOTS).toFixed(1),
      troll: { windowKn: [4.5, 7.5], idealKn: 6.1 },
      rods: this.tackle.rods.map((r) => ({ rod: r.spec.label, state: r.state })),
      sightings: [...this.sightings.values()].map((s) => ({
        kind: s.kind,
        x: Math.round(s.x),
        z: Math.round(s.z),
        ageS: Math.round(this.elapsed - s.t),
      })),
      marks: this.marks.map((m) => ({ x: Math.round(m.x), z: Math.round(m.z) })),
      binoculars: this.binoculars,
      fight: f
        ? {
            species: f.species.name,
            kg: f.kg,
            mood: f.mood,
            tension: +f.T.toFixed(2),
            dragSetting: +f.td.toFixed(2),
            sweetZone: [0.3, 0.85],
            lineOutM: Math.round(f.L),
            distM: Math.round(f.dist),
            bearingFromAsternDeg: Math.round((f.theta * 180) / Math.PI),
            stamina: +f.stam.toFixed(2),
            crewFatigue: +f.fatigue.toFixed(2),
            reelMs: +f.reel.toFixed(1),
            hint: f.hint,
            warning: w
              ? {
                  mood: w.mood,
                  headingDeg: Math.round(
                    ((Math.atan2(Math.cos(w.dir), -Math.sin(w.dir)) * 180) / Math.PI + 360) % 360,
                  ),
                }
              : null,
          }
        : null,
    };
    if (cheat) {
      out.schools = this.world.schools.map((s) => ({
        id: s.id,
        x: Math.round(s.x),
        z: Math.round(s.z),
        radiusM: Math.round(s.radius),
        depthM: Math.round(s.depth),
        feeding: +s.feeding.toFixed(2),
        surface: s.surface,
        spooked: s.spooked > 0,
        tuna: s.tuna
          .filter((t) => !t.gone)
          .map((t) => ({ species: t.species.name, kg: t.kg, depthM: Math.round(t.depth) })),
      }));
    }
    return out;
  }

  /** `{lines: 'out'|'in'|'toggle', mark: true, drag: 0..1, pump: bool, binoculars: bool}` */
  agentAct(a: Record<string, unknown>): void {
    const h = this.host;
    if (a.lines === 'toggle') this.toggleLines();
    else if (a.lines === 'out' && this.tackle.linesOut === 0 && this.tackle.tangled === 0) this.toggleLines();
    else if (a.lines === 'in' && (this.tackle.linesOut > 0 || this.tackle.tangled > 0)) this.toggleLines();
    if (a.mark) this.dropMark();
    if (typeof a.drag === 'number') h.input.sheet = Math.max(0, Math.min(1, a.drag));
    if (typeof a.pump === 'boolean') this.override = { ...this.override, pump: a.pump };
    if (typeof a.binoculars === 'boolean') this.agentBino = a.binoculars;
  }

  /** Dev: hook a fish right now (for screenshots and tests). */
  debugStrike(species: SpeciesId = 'yellowfin', kg = 55): void {
    const h = this.host;
    if (this.fight) return;
    const b = h.player;
    this.tackle.setLines(0);
    for (const r of this.tackle.rods) {
      r.state = 'fishing';
      r.prog = 1;
    }
    this.tackle.update(
      0.01,
      {
        sx: this.sternOf(b).x,
        sz: this.sternOf(b).z,
        fx: b.fwd.x,
        fz: b.fwd.z,
        stw: b.speed,
        yawRate: 0,
        cx: 0,
        cz: 0,
      },
      () => [],
      this.trng,
    );
    const rod = this.tackle.rods[1] as Rod;
    const tuna: SchoolTuna = {
      id: -1,
      species: SPECIES[species],
      kg,
      ang: 0,
      rad: 0,
      spd: 0,
      depth: 6,
      hunger: 1,
      appetite: 1,
      x: rod.x,
      z: rod.z,
      gone: false,
    };
    this.strike(rod, tuna, b);
  }

  /** World position of a rod's butt and tip (for the visuals). */
  rodGeometry(
    boat: Boat,
    rodIdx: number,
    butt: { set(...a: number[]): unknown },
    tip: { set(...a: number[]): unknown },
  ): void {
    const rod = this.tackle.rods[rodIdx];
    if (rod) rodPoints(boat, rod.spec, butt as never, tip as never);
  }
}

export const MONTAUK_GAME: ModeDef = {
  id: 'montauk',
  title: 'Montauk',
  location: MONTAUK,
  defaults: { weather: 'm-dawn', tide: 'ebb', difficulty: 'weekender', boat: 'console' },
  create: (host) => new FishMode(host),
};
