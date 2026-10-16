// Temporary developer HUD (replaced by the real UI).
import type { Game } from '../game/game';

export function mountDebugHud(game: Game): () => void {
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;left:10px;top:8px;margin:0;padding:8px 10px;font:12px/1.35 ui-monospace,monospace;color:#fff;background:#0007;border-radius:8px;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
  return () => {
    const h = game.hud;
    el.textContent = [
      `${h.phase}  ${game.cfg.boat} / ${game.cfg.weather} / ${game.cfg.tide} / ${game.cfg.difficulty}`,
      `spd ${h.speedKn.toFixed(1)} kn  thr ${h.throttle.toFixed(2)}  steer ${h.steer.toFixed(2)}  heel ${h.heelDeg.toFixed(1)}  pitch ${h.pitchDeg.toFixed(1)}`,
      `water ${h.litres.toFixed(0)}/${h.capacity.toFixed(0)} L (${(h.waterFrac * 100).toFixed(0)}%)  in ${h.intakeLps.toFixed(1)} net ${h.netLps.toFixed(1)} L/s  leak ${h.leakLps.toFixed(1)}  pump ${h.pumping}  hull ${(h.hull * 100).toFixed(0)}%`,
      `wave axis ${h.wave.angleDeg.toFixed(0)}°  bad ${h.wave.bad.toFixed(2)}  rough ${h.wave.rough.toFixed(2)}  streak ×${h.wave.mult}  air ${h.wave.air.toFixed(1)}s`,
      `wind ${h.windKn.toFixed(0)} kn from ${h.windFrom.toFixed(0)}  cur ${h.currentKn.toFixed(1)} kn  waves ${h.waveH.toFixed(2)} m`,
      `gate ${h.gate}/${h.gates} ${h.gateLabel}  prog ${(h.progress * 100).toFixed(0)}%  t ${h.time.toFixed(1)}  x ${h.x.toFixed(0)} z ${h.z.toFixed(0)}`,
      `fps ${game.rw.perf.fps.toFixed(0)}  res ${(game.rw.perf.scale * 100).toFixed(0)}%${game.rw.perf.auto ? ' (auto)' : ''}  mode ${game.mode.id}`,
      h.warning ?? '',
      game.toasts.map((t) => `· ${t.text}`).join('\n'),
      game.result
        ? `RESULT ${game.result.outcome} score ${game.result.score} stars ${game.result.stars}`
        : '',
    ].join('\n');
  };
}
