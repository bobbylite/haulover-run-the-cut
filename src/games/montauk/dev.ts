// Dev tooling for Montauk (`?auto`): a scripted captain at the helm, for screenshots, sim-run and tests.
// It looks for the nearest tuna school, runs out, slows down, trolls through it, and fights the fish by the
// book. Other `skill` settings are the bad habits the game is supposed to punish.

import { clamp, KNOTS, wrapAngle } from '../../core/math';
import type { Game } from '../../game/game';
import type { Controls } from '../../game/input';
import type { Boat } from '../../sim/boat';
import { LINE_MAX } from '../../sim/fishing/fight';
import { attackAngle } from '../../sim/waveRide';
import { makeWaveAxis } from '../../sim/waves';
import type { FishMode } from './mode';
import { transom } from './rig';

export type Skill = 'captain' | 'idle' | 'keepGoing' | 'powerAway';

const p3 = {
  x: 0,
  y: 0,
  z: 0,
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  },
};

export class FishBot {
  skill: Skill;
  /** Throttle for the run out to the grounds. */
  cruise = 0.55;
  /** Dev: the fish are found by cheating (the bot knows where the schools are). */
  private thrI = 0;
  private leg = 'approach' as 'approach' | 'pass' | 'turn';
  private legT = 0;
  private lastLeg = 0;
  private tack: number | null = null;
  private readonly axis = makeWaveAxis();

  constructor(
    private readonly game: Game,
    private readonly mode: FishMode,
    skill: Skill = 'captain',
  ) {
    this.skill = skill;
  }

  private steerTo(b: Boat, desired: number, c: Controls, gain = 1.7): void {
    const err = wrapAngle(desired - b.heading);
    const steer = clamp(gain * err - 0.7 * -b.angVel.y, -0.9, 0.9);
    // going astern the wheel works the other way round
    c.steer = b.speed < -0.5 ? -steer : steer;
  }

  /**
   * Take the sea at 45 degrees: if the line to the target is nearly head-on or beam-on to the waves, go
   * for the nearest 45 degree line instead and hold that tack until the target has moved well off it.
   */
  private seaHeading(b: Boat, desired: number): number {
    this.game.env.waves.axisAt(b.pos.x, b.pos.z, this.axis);
    const rough = this.axis.hs > 0.7;
    if (!rough) return desired;
    const bad = attackAngle(desired, this.axis.angle);
    if (bad > 0.62 && bad < 1.0) {
      this.tack = null;
      return desired;
    }
    if (this.tack !== null && Math.abs(wrapAngle(this.tack - desired)) < 1.15) return this.tack;
    let best = desired;
    let bd = 9;
    for (const k of [1, 3, -1, -3]) {
      const c = this.axis.angle + (k * Math.PI) / 4;
      const d = Math.abs(wrapAngle(c - desired));
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    this.tack = best;
    return best;
  }

  /** Hold a speed through the water (kn) with a PI loop on the throttle. */
  private hold(b: Boat, kn: number, c: Controls, dt: number): void {
    const e = kn / KNOTS - b.speed;
    this.thrI = clamp(this.thrI + 0.18 * e * dt, 0, 0.9);
    c.throttle = clamp(this.thrI + 0.07 * e, -0.3, 1);
  }

  update(b: Boat, c: Controls, dt = 1 / 60): void {
    const m = this.mode;
    m.override = null;
    if (this.game.phase !== 'playing') return;
    if (m.fight) this.fight(b, c, dt);
    else this.search(b, c, dt);
  }

  // ---- finding and trolling ------------------------------------------------------------------------

  private search(b: Boat, c: Controls, dt: number): void {
    const m = this.mode;
    const sch = m.nearestSchool(b.pos.x, b.pos.z, true) ?? m.nearestSchool(b.pos.x, b.pos.z);
    if (!sch) {
      c.throttle = 0.2;
      return;
    }
    const dist = Math.hypot(sch.x - b.pos.x, sch.z - b.pos.z);
    // aim at where it will be
    const lead = clamp(dist / Math.max(3, b.sog), 0, 120);
    const tx = sch.x + sch.vx * lead;
    const tz = sch.z + sch.vz * lead;
    const desired = Math.atan2(tz - b.pos.z, tx - b.pos.x);

    const linesOut = m.tackle.linesOut > 0 || m.tackle.tangled > 0;
    if (dist > 900) {
      // run out, taking the sea at 45 degrees
      this.steerTo(b, this.seaHeading(b, desired), c);
      c.throttle = this.cruise;
      this.thrI = 0.2;
      return;
    }
    if (dist > 450 && !linesOut) {
      this.steerTo(b, this.seaHeading(b, desired), c);
      this.hold(b, 9, c, dt);
      return;
    }
    // slow to troll and set the spread
    if (!linesOut && this.game.clock - this.lastLeg > 4) {
      if (Math.max(0, b.speed) * KNOTS < 8.5) m.toggleLines();
      this.lastLeg = this.game.clock;
    }
    this.hold(b, linesOut ? 6.1 : 7, c, dt);

    // troll legs through the school: straight in, straight through, a wide turn, back again. A heavy boat
    // answers the wheel slowly, so its small corrections have to be bigger ones.
    const k = clamp((0.8 / b.spec.stats.handling) ** 2, 1, 3.5);
    this.legT += dt;
    if (this.leg === 'approach') {
      this.steerTo(b, desired, c, 1.1);
      c.steer = clamp(c.steer, -0.1 * k, 0.1 * k);
      if (dist < 45) {
        this.leg = 'pass';
        this.legT = 0;
      }
    } else if (this.leg === 'pass') {
      c.steer = 0;
      if (this.legT > 55 || dist > 450) {
        this.leg = 'turn';
        this.legT = 0;
      }
    } else {
      c.steer = clamp(wrapAngle(desired - b.heading) > 0 ? 0.11 * k : -0.11 * k, -0.12 * k, 0.12 * k);
      if (Math.abs(wrapAngle(desired - b.heading)) < 0.3 || this.legT > 120) {
        this.leg = 'approach';
        this.legT = 0;
      }
    }
    if (m.tackle.tangled) {
      // straighten out and hold a gentle speed
      c.steer = 0;
      this.hold(b, 4.6, c, dt);
    }
  }

  // ---- the fight ------------------------------------------------------------------------------------

  private fight(b: Boat, c: Controls, dt: number): void {
    const m = this.mode;
    const f = m.fight;
    if (!f) return;
    if (this.skill === 'idle') {
      c.throttle = 0;
      c.steer = 0;
      return;
    }
    if (this.skill === 'keepGoing') {
      c.throttle = Math.max(c.throttle, 0.22);
      c.steer = 0;
      return;
    }
    if (this.skill === 'powerAway') {
      c.throttle = 0.7;
      c.steer = 0;
      return;
    }
    transom(b, p3 as never);
    const sx = p3.x;
    const sz = p3.z;
    const dx = f.x - sx;
    const dz = f.z - sz;
    const d = Math.max(1, Math.hypot(dx, dz));
    const bearing = Math.atan2(dz, dx);
    const cur = { x: 0, z: 0 };
    this.game.env.currentAt(f.x, f.z, cur);
    const away = ((f.ux + cur.x) * dx + (f.uz + cur.z) * dz) / d;
    const boatToward = (b.vel.x * dx + b.vel.z * dz) / d;
    const w = f.warning;
    const runningSoon = f.mood === 'run' || f.mood === 'dash' || w?.mood === 'run' || w?.mood === 'dash';
    let drag = 0.5;
    if (runningSoon) drag = 0.04;
    else if (f.T > 0.8) drag = 0.32;
    else if (f.T < 0.28 && f.stam < 0.7 && f.mood !== 'thrash') drag = 0.6;
    const spoolFrac = f.L / LINE_MAX;
    // a drag set light lets a run take line instead of parting it; the boat only needs to follow when the
    // spool is going or the tension will not come down
    const chase = (spoolFrac > 0.5 || (f.T > 0.95 && spoolFrac > 0.25)) && d > 10;
    let pump = false;
    const boatSpeed = Math.hypot(b.vel.x, b.vel.z);
    if (chase) {
      const off = Math.abs(wrapAngle(bearing - b.heading));
      this.steerTo(b, bearing, c, 2.2);
      if (off > 0.8 && spoolFrac < 0.75) c.throttle = 0.14;
      else {
        const want = Math.max(1.2, f.slip * 0.9, away * 0.8);
        c.throttle = clamp(0.2 + 0.1 * (want - boatToward), 0.1, 0.95);
      }
      m.override = { drag: Math.min(drag, 0.4), pump: false };
      return;
    }
    // otherwise: stern to the fish, hold the gap by feel for the tension
    const awayHdg = wrapAngle(bearing + Math.PI);
    const off = Math.abs(wrapAngle(awayHdg - b.heading));
    this.steerTo(b, awayHdg, c, 2.4);
    let throttle = clamp(0.7 * (0.4 - f.T), -0.3, 0.3);
    if (f.stam < 0.3 && d > 14) throttle = Math.min(throttle, -0.15); // it is spent: back down on it
    if (d < 12 && f.depth > 5) throttle = 0.25; // it is under the boat: ease away
    // an outboard only steers with the prop turning: a little way on while the stern comes round
    if (off > 0.4 && f.T > 0.2) throttle = Math.max(throttle, 0.12);
    // closing on a slack line with way on: brake
    if (f.T < 0.12 && boatToward > 0.5) throttle = Math.min(throttle, -0.3);
    // a spent fish alongside: stop the boat for the gaff
    if (f.stam < 0.3 && d < 22) {
      const rel = Math.hypot(b.vel.x - cur.x, b.vel.z - cur.z);
      throttle = clamp(0.5 * (0.35 - Math.max(0, b.speed)) + (rel > 1.5 ? -0.1 : 0), -0.3, 0.12);
    }
    c.throttle = throttle;
    pump = (f.mood === 'sulk' || f.stam < 0.5) && f.T < 0.55 && Math.abs(f.theta) < 0.7;
    m.override = { drag, pump };
    void dt;
    void boatSpeed;
  }
}

export function attachBot(game: Game, skill: Skill = 'captain', cruise = 0.55): FishBot {
  const mode = game.mode as FishMode;
  const bot = new FishBot(game, mode, skill);
  bot.cruise = cruise;
  (window as unknown as Record<string, unknown>).__bot = bot;
  const orig = game.input.controls.bind(game.input);
  game.input.controls = () => {
    const c = orig();
    bot.update(game.player, c);
    // the pump key stays the bilge pump; the bot decides that itself
    c.pump = game.player.water.litres > 0.45 * (game.player.capacityLimit ?? 1e9);
    return c;
  };
  return bot;
}
