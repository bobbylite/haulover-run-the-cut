// Dev tooling for Haulover (`?auto`): hand the helm to the autopilot, for screenshots, sim-run and demos.

import { Autopilot } from '../../game/autopilot';
import type { Game } from '../../game/game';
import type { HaulMode } from './mode';

export function attachAutopilot(game: Game, cruise: number): void {
  const mode = game.mode as HaulMode;
  const ap = new Autopilot(mode.course.path, cruise);
  ap.dock = !!mode.course.dock;
  ap.berth = mode.docking.berth;
  (window as unknown as Record<string, unknown>).__ap = ap;
  const orig = game.input.controls.bind(game.input);
  game.input.controls = () => {
    const c = orig();
    ap.update(game.player, c);
    return c;
  };
  game.onPhase((p) => {
    if (p === 'countdown') {
      ap.setPath(mode.course.path);
      ap.dock = !!mode.course.dock;
    }
  });
}
