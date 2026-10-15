// Ambient traffic: other boats working the Cut in their own right-hand lanes. They are full physics
// boats driven by the same autopilot used for testing, so they plane, heel, take the chop and throw
// wakes like the player does. Each one is a hard obstacle for the player's hull.

import { clamp, Rng } from '../core/math';
import { boatById } from '../data/boats';
import type { WeatherPreset } from '../data/weather';
import { BoatModel } from '../render/boats/boatModel';
import type { WakeBoat } from '../render/wake';
import { Boat, type BoatEnv } from '../sim/boat';
import { DynamicObstacles } from '../sim/boatEnv';
import { BASIN_LOOP } from '../sim/geography';
import { Autopilot, type Waypoint } from './autopilot';
import { makeCourse } from './course';

interface Vessel {
  boat: Boat;
  model: BoatModel;
  ap: Autopilot;
  /** +1 eastbound (out to sea), -1 westbound (back in). */
  dir: 1 | -1;
  baseCruise: number;
  /** Harbour traffic circulating in the marina basin (never retires). */
  basin: boolean;
  stuck: number;
  /** Seconds until a retired vessel re-enters (0 = running). */
  wait: number;
  ctl: { throttle: number; steer: number; sheet: number; pump: boolean };
}

interface Plan {
  id: string;
  dir: 1 | -1;
  cruise: number;
  variant: number;
}

/** The standing cast; storms thin it out. */
const CAST: Plan[] = [
  { id: 'gofast', dir: 1, cruise: 0.52, variant: 1 },
  { id: 'cruiser', dir: -1, cruise: 0.6, variant: 1 },
  { id: 'console', dir: -1, cruise: 0.55, variant: 2 },
  { id: 'pontoon', dir: 1, cruise: 0.7, variant: 0 },
  { id: 'cruiser', dir: 1, cruise: 0.5, variant: 2 },
  { id: 'gofast', dir: -1, cruise: 0.48, variant: 3 },
  { id: 'console', dir: 1, cruise: 0.6, variant: 0 },
  { id: 'pontoon', dir: -1, cruise: 0.65, variant: 0 },
];

/** Slow circulation in the marina basin: small and mid-size boats, each on its own lap offset. */
const BASIN_CAST: Plan[] = [
  { id: 'pontoon', dir: 1, cruise: 0.34, variant: 0 },
  { id: 'console', dir: 1, cruise: 0.2, variant: 2 },
  { id: 'cruiser', dir: 1, cruise: 0.26, variant: 2 },
  { id: 'console', dir: 1, cruise: 0.22, variant: 1 },
];

/** Closed racetrack round the harbour fairway (counter-clockwise from above, 4 m spacing). */
function basinLoop(): Waypoint[] {
  const pts: Waypoint[] = [];
  const per = Math.PI * 2 * Math.sqrt((BASIN_LOOP.rx ** 2 + BASIN_LOOP.rz ** 2) / 2);
  const n = Math.round(per / 4);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({
      x: BASIN_LOOP.x + Math.cos(t) * BASIN_LOOP.rx,
      z: BASIN_LOOP.z + Math.sin(t) * BASIN_LOOP.rz,
    });
  }
  return pts;
}

const LANE = 17;

export function laneOf(path: Waypoint[], dir: 1 | -1): Waypoint[] {
  const base = dir === 1 ? path : [...path].reverse();
  return base.map((p, i) => {
    const a = base[Math.max(0, i - 1)] as Waypoint;
    const b = base[Math.min(base.length - 1, i + 1)] as Waypoint;
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    // starboard of the direction of travel (heading +x => +z)
    return { x: p.x - (tz / l) * LANE, z: p.z + (tx / l) * LANE };
  });
}

export class Traffic {
  readonly vessels: Vessel[] = [];
  readonly obstacles = new DynamicObstacles();
  private readonly rng = new Rng(7007);
  private readonly lanes: Record<'1' | '-1', Waypoint[]>;
  private readonly wb: WakeBoat[] = [];
  private count = 4;
  private density = 1;
  private readonly loop = basinLoop();

  constructor(
    private readonly addModel: (m: BoatModel) => void,
    private readonly removeModel: (m: BoatModel) => void,
  ) {
    const path = makeCourse('outbound').path;
    this.lanes = { '1': laneOf(path, 1), '-1': laneOf(path, -1) };
  }

  /** (Re)populate for the current weather. `avoidX` keeps newcomers clear of the player's start. */
  reset(
    env: BoatEnv,
    weather: WeatherPreset,
    quality: 'low' | 'medium' | 'high',
    avoidX: number,
    density = 1,
  ): void {
    this.density = density;
    this.lastEnv = env;
    this.lastWeather = weather;
    for (const v of this.vessels) this.removeModel(v.model);
    this.vessels.length = 0;
    const calm = clamp(1 - weather.danger / 4, 0, 1);
    const max = quality === 'low' ? 3 : quality === 'medium' ? 5 : 8;
    this.count = Math.max(1, Math.min(max, Math.round((1 + calm * 4) * density)));
    for (let i = 0; i < this.count; i++) {
      const plan = CAST[i % CAST.length] as Plan;
      this.spawn(plan, weather, env, avoidX, true);
    }
  }

  private spawn(
    plan: Plan,
    weather: WeatherPreset,
    env: BoatEnv,
    avoidX: number,
    scatter: boolean,
    loopFrom = -1,
  ): void {
    const basin = loopFrom >= 0;
    const lane = basin ? this.loop : this.lanes[String(plan.dir) as '1' | '-1'];
    const spec = boatById(plan.id);
    let from = 0;
    if (scatter) {
      // spread the fleet along the route, but not on top of the player's start
      for (let tries = 0; tries < 20; tries++) {
        from = Math.floor(this.rng.range(6, lane.length * 0.8));
        const p = lane[from] as Waypoint;
        if (Math.abs(p.x - avoidX) > 220) break;
      }
    }
    // a basin boat laps the oval starting part-way round it
    const path = basin ? [...lane.slice(loopFrom), ...lane.slice(0, loopFrom)] : lane.slice(from);
    const p0 = path[0] as Waypoint;
    const p1 = path[1] as Waypoint;
    const heading = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    const boat = new Boat(spec);
    boat.reset(p0.x, p0.z, heading, env);
    boat.capacityLimit = spec.capacity * 1.6;
    boat.water.autoBilge = 0.6;
    boat.sailUp = false;
    // storms make for cautious skippers
    const cruise = basin
      ? plan.cruise
      : plan.cruise * (1 - 0.1 * weather.danger) * (1 + 0.18 * (this.density - 1));
    const v0 = spec.topSpeed * cruise * 0.9;
    boat.vel.set(Math.cos(heading) * v0, 0, Math.sin(heading) * v0);
    const model = new BoatModel(spec, plan.variant);
    model.root.traverse((o) => {
      o.frustumCulled = false;
    });
    this.addModel(model);
    this.vessels.push({
      boat,
      model,
      ap: new Autopilot(path, cruise, basin),
      dir: plan.dir,
      baseCruise: cruise,
      basin,
      stuck: 0,
      wait: 0,
      ctl: { throttle: 0, steer: 0, sheet: 0.5, pump: false },
    });
  }

  /** Advance every vessel. `player` is the human's boat (for avoidance and culling). */
  update(dt: number, env: BoatEnv, player: Boat, weather: WeatherPreset): void {
    this.obstacles.clear();
    for (let i = 0; i < this.vessels.length; i++) {
      const v = this.vessels[i] as Vessel;
      const b = v.boat;
      if (v.basin) {
        // harbour boats only matter near the player; far away they simply wait
        const far = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) > 520;
        v.model.root.visible = !far;
        if (far) continue;
      }
      if (v.wait > 0) {
        v.wait -= dt;
        v.model.root.visible = false;
        if (v.wait <= 0) this.respawn(i, env, weather, player);
        continue;
      }
      // keep clear of whoever is ahead in the lane (including the player)
      let slow = 1;
      const fx = Math.cos(b.heading);
      const fz = Math.sin(b.heading);
      const check = (ox: number, oz: number): void => {
        const dx = ox - b.pos.x;
        const dz = oz - b.pos.z;
        const along = dx * fx + dz * fz;
        const side = Math.abs(dx * -fz + dz * fx);
        if (along > 2 && along < 70 && side < 11) slow = Math.min(slow, clamp((along - 16) / 46, 0.12, 1));
      };
      check(player.pos.x, player.pos.z);
      for (const o of this.vessels) if (o !== v && o.wait <= 0) check(o.boat.pos.x, o.boat.pos.z);
      // sensible skippers ease off in the steep water at the mouth of the inlet
      const chop = env.chopAt(b.pos.x, b.pos.z);
      slow *= clamp(1.9 - chop * 1.4, 0.3, 1);
      v.ap.cruise = v.baseCruise * slow;
      v.ap.update(b, v.ctl);
      b.setInput(v.ctl);
      b.update(dt, env);
      b.impacts.length = 0;
      const spec = b.spec;
      // collision hull as three circles along the keel
      const r = spec.beam * 0.5 + 0.5;
      const half = spec.length * 0.32;
      this.obstacles.add(b.pos.x, b.pos.z, r);
      this.obstacles.add(b.pos.x + fx * half, b.pos.z + fz * half, r * 0.85);
      this.obstacles.add(b.pos.x - fx * half, b.pos.z - fz * half, r);

      // retire at the end of the lane, or when wedged / swamped / capsized
      const end = !v.basin && v.ap.done(b);
      v.stuck = b.sog < 0.5 && v.ap.cruise > 0.12 && !v.basin ? v.stuck + dt : Math.max(0, v.stuck - dt);
      if (v.basin && (b.sinking || b.capsized || b.grounded > 0.5)) {
        // a harbour boat that comes to grief is quietly replaced on its lap
        this.removeModel(v.model);
        this.vessels.splice(i, 1);
        i--;
        continue;
      }
      if (end || b.sinking || b.capsized || b.grounded > 0.5 || v.stuck > 14) {
        v.wait = 6 + this.rng.next() * 10;
        v.model.root.visible = false;
      }
    }
  }

  /** Bring a retired vessel back at the far end of a lane, if that is clear of the player. */
  private respawn(i: number, env: BoatEnv, weather: WeatherPreset, player: Boat): void {
    const old = this.vessels[i] as Vessel;
    const base = CAST[(i + Math.floor(this.rng.range(0, CAST.length))) % CAST.length] as Plan;
    const clear = (dir: 1 | -1): boolean => {
      const s = this.lanes[String(dir) as '1' | '-1'][0] as Waypoint;
      return Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 260;
    };
    const plan = clear(base.dir)
      ? base
      : clear(base.dir === 1 ? -1 : 1)
        ? { ...base, dir: (base.dir === 1 ? -1 : 1) as 1 | -1 }
        : null;
    if (!plan) {
      old.wait = 3;
      return;
    }
    this.removeModel(old.model);
    this.vessels.splice(i, 1);
    this.spawn(plan, weather, env, player.pos.x, false);
    // keep the slot order stable
    const nv = this.vessels.pop() as Vessel;
    this.vessels.splice(i, 0, nv);
  }

  /** Wake-map entries for vessels near the player (the map only covers a window around them). */
  wakeBoats(player: Boat, make: (b: Boat) => WakeBoat): WakeBoat[] {
    this.wb.length = 0;
    for (const v of this.vessels) {
      if (v.wait > 0) continue;
      const b = v.boat;
      if (Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) > 170) continue;
      this.wb.push(make(b));
    }
    return this.wb;
  }

  /** Send the harbour traffic out onto its laps (called as the player enters the marina). */
  startBasin(density: number, env?: BoatEnv, weather?: WeatherPreset): void {
    const e = env ?? this.lastEnv;
    const w = weather ?? this.lastWeather;
    if (!e || !w) return;
    for (let i = this.vessels.length - 1; i >= 0; i--) {
      const v = this.vessels[i] as Vessel;
      if (v.basin) {
        this.removeModel(v.model);
        this.vessels.splice(i, 1);
      }
    }
    const n = Math.max(2, Math.min(BASIN_CAST.length, Math.round(1.6 * density + 0.6)));
    for (let i = 0; i < n; i++) {
      const plan = BASIN_CAST[i] as Plan;
      this.spawn(plan, w, e, 0, false, Math.floor((this.loop.length * (i + 0.5)) / n));
    }
  }

  private lastEnv: BoatEnv | null = null;
  private lastWeather: WeatherPreset | null = null;

  dispose(): void {
    for (const v of this.vessels) this.removeModel(v.model);
    this.vessels.length = 0;
  }
}
