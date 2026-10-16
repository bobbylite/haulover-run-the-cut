// Dev tooling for Nantucket (`?auto`): the harbour pilot at the helm, for screenshots, scripts and demos. It is
// the same pilot the tests use: it follows the berth's approach, slows on a braking profile, squares the hull
// up with the thrusters and, on a ship, spends the tug calls when it needs them.

import type { Game } from '../../game/game';
import { HarborPilot, type PilotControls } from '../../game/harborPilot';
import type { NantMode } from './mode';

export function attachPilot(game: Game, cruise = 0.7): void {
  const mode = game.mode as NantMode;
  let pilot: HarborPilot | null = null;
  const ctl: PilotControls = { throttle: 0, steer: 0, bow: 0, stern: 0 };
  let last = game.clock;
  const orig = game.input.controls.bind(game.input);
  game.input.controls = () => {
    const c = orig();
    const dt = Math.min(0.1, Math.max(1 / 240, game.clock - last));
    last = game.clock;
    if (pilot && game.phase === 'playing') {
      pilot.update(game.player, game.benv, ctl, dt);
      c.throttle = ctl.throttle;
      c.steer = ctl.steer;
      c.bow = ctl.bow;
      c.stern = ctl.stern;
    }
    return c;
  };
  // a fresh pilot (and tug crew) for every run
  game.onPhase((p) => {
    if (p === 'countdown') pilot = new HarborPilot(mode.berth, mode.spec, { cruise, tugs: mode.tugs });
  });
  (window as unknown as Record<string, unknown>).__pilot = () => pilot;
}
