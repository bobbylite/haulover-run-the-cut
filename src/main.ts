import './style.css';
import { pickGame } from './games/registry';
import { showTitle } from './shell/title';

const tick = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  const app = document.getElementById('app') as HTMLElement;
  const q = new URLSearchParams(location.search);

  // a bare URL asks which game; any launch parameter goes straight in (see games/registry.ts)
  let entry = pickGame(q);
  if (!entry) {
    entry = await showTitle();
    // keep the pick across reloads (the quality switch reloads the page)
    q.set('game', entry.id);
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
  }

  // the engine and interface are only fetched once a game is picked, so the title screen is instant
  const [{ Game }, { UI }] = await Promise.all([import('./game/game'), import('./ui/ui')]);
  const ui = new UI(document.body, entry.title);
  ui.setLoading(0.08, 'Charting the waters…');
  await tick();
  const def = await entry.load();
  const game = await Game.create(app, def, undefined, (p, m) => ui.setLoading(p, m));
  ui.attach(game);
  ui.onMute = (muted) => {
    game.audio.setVolume(game.settings.master);
    return muted;
  };
  if (q.has('wakedebug')) game.rw.water.uDebug.value = 1;
  const updateDebug = q.has('debug') ? (await import('./ui/debugHud')).mountDebugHud(game) : () => {};

  if (q.has('auto')) {
    if (game.mode.id === 'haulover')
      (await import('./games/haulover/dev')).attachAutopilot(game, Number(q.get('cruise') ?? 0.7));
    if (game.mode.id === 'montauk')
      (await import('./games/montauk/dev')).attachBot(
        game,
        (q.get('skill') as 'captain') ?? 'captain',
        Number(q.get('cruise') ?? 0.55),
      );
    if (game.mode.id === 'nantucket')
      (await import('./games/nantucket/dev')).attachPilot(game, Number(q.get('cruise') ?? 0.7));
    if (q.has('go')) game.startRun();
  }
  // `?agent` hands the sim to an AI agent: observations and actions as JSON, stepped deterministically
  if (q.has('agent')) {
    const { mountAgentApi } = await import('./dev/agentApi');
    Object.assign(window, { __agent: mountAgentApi(game) });
  }
  // exposed last, so scripts that wait for `__game` see a game that is already set up (autopilot, ?go)
  Object.assign(window, { __game: game, __ui: ui });

  let last = performance.now();
  game.rw.renderer.setAnimationLoop((now) => {
    const dt = (now - last) / 1000;
    last = now;
    if (!game.manual) game.update(dt);
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
