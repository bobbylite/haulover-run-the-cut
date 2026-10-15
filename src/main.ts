import './style.css';
import { Autopilot } from './game/autopilot';
import { Game } from './game/game';
import { mountDebugHud } from './ui/debugHud';
import { UI } from './ui/ui';

const tick = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  const app = document.getElementById('app') as HTMLElement;
  const q = new URLSearchParams(location.search);

  const ui = new UI(document.body);
  ui.setLoading(0.08, 'Charting the inlet…');
  await tick();
  // baking the bathymetry happens when the game constructs its Environment
  const game = await Game.create(app, undefined, (p, m) => ui.setLoading(p, m));
  ui.attach(game);
  ui.onMute = (muted) => {
    game.audio.setVolume(game.settings.master);
    return muted;
  };
  Object.assign(window, { __game: game, __ui: ui });
  if (q.has('wakedebug')) game.rw.water.uDebug.value = 1;
  const updateDebug = q.has('debug') ? mountDebugHud(game) : () => {};

  if (q.has('auto')) {
    const ap = new Autopilot(game.course.path, Number(q.get('cruise') ?? 0.7));
    ap.dock = !!game.course.dock;
    (window as unknown as Record<string, unknown>).__ap = ap;
    const orig = game.input.controls.bind(game.input);
    game.input.controls = () => {
      const c = orig();
      ap.update(game.player, c);
      return c;
    };
    game.onPhase((p) => {
      if (p === 'countdown') {
        ap.setPath(game.course.path);
        ap.dock = !!game.course.dock;
      }
    });
    if (q.has('go')) game.startRun();
  }

  let last = performance.now();
  game.rw.renderer.setAnimationLoop((now) => {
    const dt = (now - last) / 1000;
    last = now;
    game.update(dt);
    game.render();
    ui.update(now);
    updateDebug();
  });
}

main().catch((e) => {
  console.error('[game] failed', e);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="color:#f55;padding:1rem;position:fixed;top:0;left:0;z-index:99;background:#000a">${String(e?.stack ?? e)}</pre>`,
  );
});
