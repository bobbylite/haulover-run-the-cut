// A headless Nantucket run: the real boat, the real sea and harbour, a berth session and the test pilot at the
// helm. Used by the feasibility, balance and determinism tests (and by hand when tuning levels).

import { boatById } from '../src/data/boats';
import { weatherById } from '../src/data/weather';
import { BerthSession } from '../src/game/berthing';
import { scoreBerth } from '../src/game/berthScore';
import { HarborPilot, type PilotControls } from '../src/game/harborPilot';
import { type Level, levelById, nantDifficulty } from '../src/games/nantucket/levels';
import { NANTUCKET } from '../src/locations/nantucket';
import { berthById } from '../src/locations/nantucket/geography';
import { Boat } from '../src/sim/boat';
import { makeBoatEnv } from '../src/sim/boatEnv';
import { Environment } from '../src/sim/environment';
import { TugCrew } from '../src/sim/tugs';

export interface RunResult {
  outcome: 'docked' | 'timeout' | 'sunk' | 'capsized' | 'wrecked' | 'stranded';
  /** Seconds of sim time. */
  t: number;
  touches: number;
  hull: number;
  tugs: number;
  stars: number;
  score: number;
  maxSpeed: number;
  /** Where it ended up relative to its target. */
  along: number;
  across: number;
  alignDeg: number;
  dist: number;
}

export interface RunOptions {
  weather?: string;
  tide?: 'ebb' | 'flood' | 'slack';
  difficulty?: string;
  cruise?: number;
  /** Let the pilot use the level's tug calls. */
  tugs?: boolean;
  /** Seconds before giving up (default: the level's clock). */
  limit?: number;
  trace?: (line: string) => void;
}

const DT = 1 / 30;
const env = new Environment(NANTUCKET);

export function runLevel(level: Level | string, o: RunOptions = {}): RunResult {
  const lv = typeof level === 'string' ? levelById(level) : level;
  const diff = nantDifficulty(o.difficulty ?? 'weekender');
  env.time = 0;
  env.setConditions(weatherById(o.weather ?? lv.weather), o.tide ?? lv.tide, diff, true);
  const benv = makeBoatEnv(env);
  const spec = boatById(lv.boat);
  const berth = berthById(lv.berth);
  const boat = new Boat(spec);
  boat.reset(lv.start.x, lv.start.z, lv.start.heading, benv);
  boat.capacityLimit = spec.capacity * diff.capacity;
  boat.water.autoBilge = diff.autoBilge;
  boat.sailUp = false;
  boat.impactMin = 0.3;
  const limit = o.limit ?? lv.time * diff.timeScale;
  const session = new BerthSession(berth, spec);
  session.start(limit);
  const tugs = new TugCrew(spec, lv.tugs);
  const pilot = new HarborPilot(berth, spec, { cruise: o.cruise, tugs: o.tugs === false ? null : tugs });
  const ctl: PilotControls = { throttle: 0, steer: 0, bow: 0, stern: 0 };
  let maxSpeed = 0;
  let outcome: RunResult['outcome'] = 'timeout';
  let t = 0;
  for (let i = 0; i < Math.ceil(limit / DT) + 30; i++) {
    t += DT;
    env.time += DT;
    pilot.update(boat, benv, ctl, DT);
    boat.setInput({
      throttle: ctl.throttle,
      steer: ctl.steer,
      sheet: 0.5,
      pump: false,
      bow: ctl.bow,
      stern: ctl.stern,
    });
    tugs.update(DT, boat);
    boat.update(DT, benv);
    for (const im of boat.impacts) {
      session.touches++;
      if (im.speed > 1.2) boat.damage(Math.min(0.5, (im.speed - 0.8) * 0.05));
    }
    boat.impacts.length = 0;
    maxSpeed = Math.max(maxSpeed, boat.sog);
    const r = session.update(DT, boat, benv);
    if (o.trace && i % 150 === 0) {
      const st = session.status;
      o.trace(
        `${t.toFixed(0)}s pos(${boat.pos.x.toFixed(0)},${boat.pos.z.toFixed(0)}) hd ${((boat.heading * 180) / Math.PI).toFixed(0)} sog ${boat.sog.toFixed(2)} thr ${ctl.throttle.toFixed(2)} str ${ctl.steer.toFixed(2)} bow ${ctl.bow.toFixed(2)} stern ${ctl.stern.toFixed(2)} | dist ${st.dist.toFixed(0)} along ${st.along.toFixed(1)} across ${st.across.toFixed(1)} align ${st.alignDeg.toFixed(0)} hold ${st.hold.toFixed(1)} clr ${st.clearance.toFixed(1)} ${pilot.note} | gr ${boat.grounded.toFixed(2)} thrN ${boat.thrustN.toFixed(0)} sub ${boat.propSubmerge.toFixed(2)} depth ${(-benv.seabedAt(boat.pos.x, boat.pos.z)).toFixed(1)} yaw ${boat.angVel.y.toFixed(3)}`,
      );
    }
    if (r === 'docked') {
      outcome = 'docked';
      break;
    }
    if (boat.sinking) {
      outcome = 'sunk';
      break;
    }
    if (boat.capsized) {
      outcome = 'capsized';
      break;
    }
    if (boat.wrecked) {
      outcome = 'wrecked';
      break;
    }
    if (r === 'timeout') break;
  }
  const st = session.status;
  const fin = session.finish ?? {
    along: st.along,
    across: st.across,
    align: (st.alignDeg * Math.PI) / 180,
    speed: boat.sog,
  };
  const sc = scoreBerth({
    docked: outcome === 'docked',
    timeFrac: Math.max(0, (limit - t) / limit),
    along: fin.along,
    across: fin.across,
    align: fin.align,
    speed: fin.speed,
    rules: session.rules,
    touches: session.touches,
    hull: boat.hull,
    tugCalls: tugs.used,
    tugFree: lv.tugFree,
    mult: diff.score * spec.scoreMult,
  });
  return {
    outcome,
    t,
    touches: session.touches,
    hull: boat.hull,
    tugs: tugs.used,
    stars: sc.stars,
    score: sc.score,
    maxSpeed,
    along: st.along,
    across: st.across,
    alignDeg: st.alignDeg,
    dist: st.dist,
  };
}

const cache = new Map<string, RunResult>();

/** A run is deterministic, so a test file can share one result between the checks that need it. */
export function runLevelCached(level: Level | string, o: RunOptions = {}): RunResult {
  const lv = typeof level === 'string' ? levelById(level) : level;
  const { trace: _t, ...key } = o;
  const k = `${lv.id}|${JSON.stringify(key)}`;
  let r = cache.get(k);
  if (!r) {
    r = runLevel(lv, o);
    cache.set(k, r);
  }
  return r;
}
