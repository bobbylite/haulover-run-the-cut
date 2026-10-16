// The agent-facing observation must stay plain JSON and expose only what the player could know. The page
// integration (stepping, acting) is exercised by scripts/agent-demo.mjs; this pins the data contract.
import { describe, expect, it } from 'vitest';
import { boatById } from '../src/data/boats';
import { observe } from '../src/dev/agentApi';
import type { Game } from '../src/game/game';
import { emptyHud } from '../src/game/state';
import { Boat } from '../src/sim/boat';

function stubGame(mode: Record<string, unknown>): Game {
  const hud = emptyHud();
  Object.assign(hud, {
    heading: 93.4,
    windKn: 14.26,
    windFrom: 71.6,
    currentKn: 2.04,
    currentTo: 88,
    waveH: 1.234,
  });
  hud.wave.angleDeg = 44.6;
  hud.wave.bad = 0.123;
  const player = new Boat(boatById('console'));
  player.pos.set(123.456, 0, -78.9);
  return {
    phase: 'playing',
    clock: 12.3456,
    cfg: {
      boat: 'console',
      weather: 'm-dawn',
      tide: 'ebb',
      difficulty: 'weekender',
      route: 'full',
      level: '',
    },
    player,
    hud,
    toasts: [1, 2, 3, 4, 5].map((i) => ({ id: i, text: `toast ${i}`, tone: 'info', ttl: 1 })),
    result: null,
    mode,
  } as unknown as Game;
}

describe('agent observations', () => {
  it('are plain JSON with the documented shape', () => {
    const o = observe(stubGame({ id: 'montauk' }));
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(Object.keys(o).sort()).toEqual(
      ['boat', 'clock', 'config', 'game', 'mode', 'phase', 'result', 'schema', 'sea', 'toasts'].sort(),
    );
    expect(o.schema).toBe(1);
    expect(o.game).toBe('montauk');
  });

  it('use compass degrees, knots and tidy numbers', () => {
    const o = observe(stubGame({ id: 'haulover' }));
    expect(o.boat.headingDeg).toBe(93.4);
    expect(o.boat.x).toBe(123.5);
    expect(o.boat.z).toBe(-78.9);
    expect(o.clock).toBe(12.35);
    expect(o.sea).toMatchObject({
      windKn: 14.3,
      windFromDeg: 72,
      currentKn: 2,
      currentToDeg: 88,
      waveAngleDeg: 45,
    });
    expect(o.boat.bilgeFrac).toBeGreaterThanOrEqual(0);
  });

  it('only shows the last few toasts', () => {
    expect(observe(stubGame({ id: 'haulover' })).toasts).toEqual([
      'toast 2',
      'toast 3',
      'toast 4',
      'toast 5',
    ]);
  });

  it('asks the mode for its state, and tells it whether the agent may cheat', () => {
    const seen: boolean[] = [];
    const g = stubGame({
      id: 'montauk',
      agentState: (cheat: boolean) => {
        seen.push(cheat);
        return cheat ? { schools: [{ id: 1 }] } : { stage: 'search' };
      },
    });
    expect(observe(g).mode).toEqual({ stage: 'search' });
    expect(observe(g, true).mode).toEqual({ schools: [{ id: 1 }] });
    expect(seen).toEqual([false, true]);
  });
});
