// DOM UI: loading, menu, HUD, pause and results. Vanilla TS, built once from templates and updated
// imperatively from the game's HUD snapshot (~20 Hz) so the canvas never competes with layout work.

import { clamp, KNOTS } from '../core/math';
import { BOATS } from '../data/boats';
import { DIFFICULTIES, difficultyById } from '../data/difficulty';
import { WEATHER, weatherById } from '../data/weather';
import { pathProgress } from '../game/course';
import type { Game } from '../game/game';
import { saveSettings } from '../game/settings';
import type { GameConfig, Phase, ToastMsg } from '../game/state';
import { DockRadar } from './dockRadar';
import { boatIcon, dropIcon, starIcon, weatherIcon } from './icons';
import { MiniMap } from './minimap';
import { mountTouchControls } from './touch';

const CARDINALS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
export const cardinal = (deg: number): string =>
  CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] as string;
const ft = (m: number): string => `${Math.round(m * 3.281)} ft`;
const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function _q<T extends Element>(root: ParentNode, sel: string): T {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`missing ${sel}`);
  return e;
}

// ---- svg builders ------------------------------------------------------------------------------

const wavePath = (): string => {
  let d = 'M0 7';
  for (let i = 0; i < 6; i++) d += ' q11.5 -7 23 0 t23 0';
  return `${d} V160 H0 Z`;
};

const vialSvg = (): string => `
<svg class="vial" viewBox="0 0 66 150" aria-hidden="true">
  <defs>
    <clipPath id="vclip"><rect x="10" y="8" width="46" height="132" rx="23"/></clipPath>
    <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w1)"/><stop offset="1" stop-color="var(--w2)"/></linearGradient>
    <linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--w1)" stop-opacity=".55"/><stop offset="1" stop-color="var(--w2)" stop-opacity=".55"/></linearGradient>
  </defs>
  <rect x="10" y="8" width="46" height="132" rx="23" fill="#fff" fill-opacity=".34"/>
  <g clip-path="url(#vclip)">
    <g id="vWater" style="transform: translateY(calc(140px - var(--f, 0) * 132px)); transition: transform .5s cubic-bezier(.2,.8,.2,1)">
      <g id="vTilt" style="transform-origin: 33px 7px; transform: rotate(var(--tilt, 0deg)); transition: transform .25s ease-out">
        <g style="animation: vwave 2.4s linear infinite"><path d="${wavePath()}" fill="url(#wg2)" transform="translate(-23 -3)"/></g>
        <g style="animation: vwave 3.7s linear infinite reverse"><path d="${wavePath()}" fill="url(#wg)" transform="translate(-23 1)"/></g>
      </g>
    </g>
  </g>
  <rect x="10" y="8" width="46" height="132" rx="23" fill="none" stroke="#fff" stroke-width="2.6"/>
  <path d="M20 22c-4 12-4 34-1 52" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round" fill="none"/>
  <g stroke="oklch(0.31 0.075 285 / .45)" stroke-width="1.6" stroke-linecap="round"><path d="M52 41h-6M52 74h-6M52 107h-6"/></g>
  <style>@keyframes vwave { to { transform: translateX(-46px) } }</style>
</svg>`;

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const t = (a * Math.PI) / 180;
    return `${(cx + r * Math.sin(t)).toFixed(2)} ${(cy - r * Math.cos(t)).toFixed(2)}`;
  };
  return `M${p(a0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

const dialSvg = (): string => {
  const cx = 94;
  const cy = 98;
  const r = 78;
  let ticks = '';
  for (let i = 0; i <= 12; i++) {
    const a = -120 + (240 * i) / 12;
    const t = (a * Math.PI) / 180;
    const r0 = r - (i % 3 === 0 ? 12 : 7);
    ticks += `<line x1="${(cx + r0 * Math.sin(t)).toFixed(1)}" y1="${(cy - r0 * Math.cos(t)).toFixed(1)}" x2="${(cx + (r - 2) * Math.sin(t)).toFixed(1)}" y2="${(cy - (r - 2) * Math.cos(t)).toFixed(1)}" stroke="oklch(0.31 0.075 285 / ${i % 3 === 0 ? 0.55 : 0.3})" stroke-width="${i % 3 === 0 ? 2.4 : 1.6}" stroke-linecap="round"/>`;
  }
  return `
<svg class="dial" viewBox="0 0 188 128" aria-hidden="true">
  <defs><linearGradient id="dg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="oklch(0.85 0.11 190)"/><stop offset=".6" stop-color="oklch(0.88 0.11 85)"/><stop offset="1" stop-color="oklch(0.74 0.17 25)"/></linearGradient></defs>
  <path d="${arcPath(cx, cy, r - 5, -120, 120)}" stroke="oklch(0.31 0.075 285 / .13)" stroke-width="11" fill="none" stroke-linecap="round"/>
  <path id="dFill" d="${arcPath(cx, cy, r - 5, -120, 120)}" stroke="url(#dg)" stroke-width="11" fill="none" stroke-linecap="round" pathLength="100" style="stroke-dasharray: calc(var(--p, 0) * 100) 200; transition: stroke-dasharray .12s linear"/>
  ${ticks}
  <circle cx="${cx}" cy="${cy}" r="34" fill="#fff" fill-opacity=".62" stroke="#fff" stroke-width="2"/>
  <g id="dNeedle" style="transform-origin: ${cx}px ${cy}px; transform: rotate(var(--a, -120deg)); transition: transform .12s linear"><path d="M${cx - 4.5} ${cy - 40} L${cx} ${cy - r + 12} L${cx + 4.5} ${cy - 40} Z" fill="var(--coral-deep)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></g>
</svg>`;
};

const leverSvg = (): string => `
<svg class="lever" viewBox="0 0 34 118" aria-hidden="true">
  <rect x="14" y="6" width="6" height="106" rx="3" fill="oklch(0.31 0.075 285 / .16)"/>
  <g stroke="oklch(0.31 0.075 285 / .4)" stroke-width="1.6" stroke-linecap="round"><path d="M5 10h8M5 32h8M5 54h8M5 76h8M5 98h8" /></g>
  <path d="M26 82h-6" stroke="var(--mint-deep)" stroke-width="2.4" stroke-linecap="round"/>
  <g id="lKnob" style="transform: translateY(var(--y, 76px)); transition: transform .1s linear"><rect x="5" y="-8" width="24" height="16" rx="8" fill="#fff" stroke="var(--coral)" stroke-width="3"/><rect x="10" y="-2" width="14" height="4" rx="2" fill="var(--coral)"/></g>
</svg>`;

const roseSvg = (): string => `
<svg class="rose" viewBox="-64 -64 128 128" aria-hidden="true">
  <circle r="60" fill="#fff" fill-opacity=".3" stroke="#fff" stroke-width="2.5"/>
  <g id="rRing" style="transition: transform .12s linear">
    <g font-family="var(--font-label)" font-weight="800" font-size="11" text-anchor="middle" fill="oklch(0.31 0.075 285 / .7)">
      <text y="-44">N</text><text x="46" y="4" fill-opacity=".6">E</text><text y="52" fill-opacity=".6">S</text><text x="-46" y="4" fill-opacity=".6">W</text>
    </g>
    <g stroke="oklch(0.31 0.075 285 / .3)" stroke-width="1.6" stroke-linecap="round">
      <path d="M0 -58v6M0 58v-6M58 0h-6M-58 0h6"/>
    </g>
    <g id="rWind" style="transition: transform .2s linear"><path d="M0 -38 L0 -4" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M-7 -14 L0 -4 L7 -14" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cy="-40" r="3.4" fill="#fff"/><path d="M-4 -34l-6-5M4 -34l6-5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>
    <g id="rCur" style="transition: transform .2s linear"><path d="M0 -32 L0 8" stroke="oklch(0.68 0.14 232)" stroke-width="5" stroke-linecap="round"/><path d="M-9 -10 L0 6 L9 -10 Z" fill="oklch(0.68 0.14 232)"/></g>
  </g>
  <path d="M0 -15 C6 -6 7 6 5 14 H-5 C-7 6 -6 -6 0 -15Z" fill="var(--coral-deep)" stroke="#fff" stroke-width="2"/>
</svg>`;

// ---- the UI ---------------------------------------------------------------------------------------

export class UI {
  readonly root: HTMLElement;
  private game!: Game;
  private mini!: MiniMap;
  private lastHud = 0;
  private lastPhase: Phase = 'loading';
  private readonly toastEls = new Map<number, HTMLElement>();
  private radar!: DockRadar;
  private photo = false;
  private el!: Record<string, HTMLElement>;
  private gateDots: HTMLElement[] = [];
  private hintUntil = 0;
  onStart?: () => void;
  onMute?: (muted: boolean) => boolean;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    this.root.dataset.phase = 'loading';
    if (new URLSearchParams(location.search).has('noui')) this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.root.innerHTML = this.template();
    this.cache();
  }

  setLoading(p: number, msg: string): void {
    this.root.style.setProperty('--p', `${Math.round(p * 100)}%`);
    (this.el.loadFill as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    (this.el.loadMsg as HTMLElement).textContent = msg;
  }

  /** Called once the game exists. */
  attach(game: Game): void {
    this.game = game;
    const g = this.game;
    this.mini = new MiniMap(g);
    this.el.miniHost?.appendChild(this.mini.canvas);
    this.radar = new DockRadar(g);
    this.el.dockHost?.appendChild(this.radar.canvas);
    this.buildMenu();
    this.buildGateDots();
    mountTouchControls(this.root, g);
    g.onPhase((p) => this.onPhase(p));
    g.onSplash((a) => this.splash(a));
    g.input.on('photo', () => {
      this.photo = !this.photo;
      this.applyHudVisibility();
    });
    g.input.on('hud', () => this.applyHudVisibility());
    g.input.on('mute', () => this.toggleMute());
    // interface blips (event-delegated so rebuilt menu buttons keep working)
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button:not(#go)')) g.audio.ui('click');
    });
    this.root.addEventListener(
      'pointerover',
      (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.contains(e.relatedTarget as Node | null)) g.audio.ui('hover');
      },
      { passive: true },
    );
    addEventListener('keydown', (e) => {
      if (g.phase !== 'menu') return;
      if (e.code === 'Enter') this.start();
      if (e.code === 'ArrowRight') this.cycleBoat(1);
      if (e.code === 'ArrowLeft') this.cycleBoat(-1);
    });
    this.onPhase(g.phase);
    this.applyHudVisibility();
  }

  private start(): void {
    this.onStart?.();
    this.game.audio.ui('start');
    this.game.startRun();
    this.hintUntil = performance.now() + 22000;
  }

  private cycleBoat(d: number): void {
    const i = BOATS.findIndex((b) => b.id === this.game.cfg.boat);
    const n = BOATS[(i + d + BOATS.length) % BOATS.length]!;
    this.game.setConfig({ boat: n.id });
    this.syncMenu();
  }

  private toggleMute(): void {
    const s = this.game.settings;
    s.master = s.master > 0 ? 0 : 0.8;
    saveSettings(s);
    const muted = this.onMute?.(s.master === 0) ?? s.master === 0;
    this.el.muteBtn!.textContent = muted ? '🔇' : '🔊';
  }

  private applyHudVisibility(): void {
    const show = this.game.settings.hud && !this.photo;
    this.root.classList.toggle('hud-hide', !show);
  }

  private onPhase(p: Phase): void {
    this.root.dataset.phase = p;
    if (p === 'menu') {
      this.syncMenu();
      this.mini.redraw();
      this.buildGateDots();
    }
    if (p === 'countdown') {
      this.mini.redraw();
      this.buildGateDots();
    }
    if (p === 'finished' || p === 'failed') this.buildResult();
    this.lastPhase = p;
  }

  // ---- templates -----------------------------------------------------------------------------------

  private template(): string {
    return `
<section class="screen s-loading" data-passive>
  <div><div class="logo">HAULOVER</div><div class="tag">Run the Cut</div>
  <div class="wavebar"><i id="loadFill"></i></div><div class="msg" id="loadMsg">Warming up the tide…</div></div>
</section>

<section class="screen s-menu">
  <div class="menu-panel glass">
    <div class="brand"><div class="logo">HAULOVER</div><div class="sub">Run the Cut</div></div>
    <div class="sec">
      <div class="head"><span class="label">Vessel</span><span class="hint">← → to browse</span></div>
      <div class="boats" id="boats" role="radiogroup" aria-label="Vessel"></div>
      <div class="boat-card" id="boatCard"></div>
    </div>
    <div class="sec">
      <div class="head"><span class="label">Conditions</span><span class="hint" id="wxDanger"></span></div>
      <div class="weather" id="weather" role="radiogroup" aria-label="Weather"></div>
      <p class="wx-blurb" id="wxBlurb"></p>
    </div>
    <div class="sec">
      <div class="head"><span class="label">Tide</span><span class="hint" id="tideHint"></span></div>
      <div class="seg" id="tide" role="radiogroup" aria-label="Tide"></div>
    </div>
    <div class="sec">
      <div class="head"><span class="label">Route</span><span class="hint" id="routeHint"></span></div>
      <div class="seg" id="route" role="radiogroup" aria-label="Route"></div>
    </div>
    <div class="sec">
      <div class="head"><span class="label">Difficulty</span><span class="hint" id="diffHint"></span></div>
      <div class="seg" id="diff" role="radiogroup" aria-label="Difficulty"></div>
    </div>
    <div class="menu-cta">
      <button class="btn primary" id="go">Set Sail</button>
      <button class="btn ghost small" id="how">Controls</button>
    </div>
    <div class="controls-pop glass" id="ctrlPop" hidden>
      <div class="controls">
        <kbd>W / S</kbd><span>Throttle lever up / down (<kbd>Space</kbd> idle)</span>
        <kbd>A / D</kbd><span>Steer</span>
        <kbd>B</kbd><span>Hold to run the bilge pump</span>
        <kbd>Q / E</kbd><span>Trim the sheet (sloop) · <kbd>F</kbd> hoist / drop sails</span>
        <kbd>C</kbd><span>Camera: chase / helm / orbit</span>
        <kbd>R</kbd><span>Respawn at last gate (+20 s)</span>
        <kbd>H</kbd><span>Toggle HUD · <kbd>F2</kbd> photo mode · <kbd>M</kbd> sound · <kbd>G</kbd> resolution</span>
        <kbd>Drag</kbd><span>Look around · wheel to zoom</span>
        <kbd>Gamepad</kbd><span>Stick steer · RT/LT throttle · A pump · X camera</span>
      </div>
      <button class="btn small" id="ctrlClose">Got it</button>
    </div>
    <div class="menu-foot"><span><kbd>Enter</kbd> sail</span><span><kbd>W</kbd><kbd>S</kbd> throttle</span><span><kbd>A</kbd><kbd>D</kbd> steer</span><span><kbd>B</kbd> bilge pump</span></div>
  </div>
  <div class="menu-top-right">
    <div class="seg" id="quality" aria-label="Graphics quality" style="min-width:210px"></div>
    <button class="btn small glass" id="muteBtn" aria-label="Toggle sound" style="font-size:1rem">🔊</button>
  </div>
  <div class="conditions-strip glass" id="strip"></div>
</section>

<section class="screen s-hud" id="hud">
  <div class="vignette-water" id="vigW"></div>
  <div class="splash" id="splash"></div>
  <div class="hud-top-left glass hud-part">
    <div class="row"><div><div class="label" id="gateNo">Gate 0 / 0</div><div class="gate-name" id="gateName"></div></div><div class="timeblock"><div class="time num" id="time">0:00.0</div><div class="limit num" id="limit"></div></div></div>
    <div class="progress" id="prog"><i class="fill"></i><i class="boat"></i></div>
    <div class="penalty" id="penalty"></div>
  </div>
  <div class="hud-minimap glass hud-part" id="miniHost"></div>
  <div class="hud-minimap hud-dockhost glass hud-part" id="dockHost" hidden></div>
  <div class="hud-dock glass hud-part" id="dockPanel" hidden>
    <div class="head"><span class="label">Docking · slip 3</span><b class="num" id="dkTime">2:00</b></div>
    <div class="chips"><span id="dkSpeed">Speed</span><span id="dkAngle">Angle</span><span id="dkPos">Berth</span></div>
    <div class="hold"><i id="dkHold"></i></div>
    <div class="read num" id="dkRead"></div>
  </div>
  <div class="toast-stack" id="toasts"></div>
  <div class="hud-center"><div class="count" id="count"></div><div class="warning" id="warn" hidden></div></div>
  <div class="hud-bottom-left glass hud-part" id="water">
    ${vialSvg()}
    <div class="readout">
      <div class="label">Bilge</div>
      <div class="big num"><span id="wL">0</span><small> / <span id="wCap">0</span> L</small></div>
      <div class="pill" id="inPill">${dropIcon()} <span id="wIn">+0.0 L/s</span></div>
      <div class="pill" id="pumpPill">⚙ pump <kbd>B</kbd></div>
      <div class="pill alarm" id="leakPill" hidden>leak <span id="wLeak">0</span> L/s</div>
    </div>
  </div>
  <div class="hud-bottom-center glass hud-part">
    <div class="dialwrap">${dialSvg()}<div class="digital"><b class="num" id="kn">0</b><small>knots</small></div>
      <div class="steer"><i id="steerDot"></i></div></div>
    ${leverSvg()}
  </div>
  <div class="hud-bottom-right glass hud-part">
    ${roseSvg()}
    <div class="info">
      <div class="row"><span class="sw" style="background:#fff;box-shadow:0 0 0 2px oklch(0.31 0.075 285 / .3)"></span><div><div class="label">Wind</div><b class="num" id="wind">0 kn</b> <span id="windDir"></span></div></div>
      <div class="row"><span class="sw" style="background:oklch(0.68 0.14 232)"></span><div><div class="label">Current</div><b class="num" id="cur">0.0 kn</b></div></div>
      <div class="row"><span class="sw" style="background:var(--mint-deep)"></span><div><div class="label">Seas</div><b class="num" id="waves">0.0 m</b></div></div>
    </div>
  </div>
  <div class="hint-bar" id="hint"><kbd>W</kbd>/<kbd>S</kbd> throttle · <kbd>A</kbd>/<kbd>D</kbd> steer · hold <kbd>B</kbd> to pump · <kbd>C</kbd> camera · <kbd>R</kbd> respawn · <kbd>Esc</kbd> pause</div>
</section>

<section class="screen s-pause">
  <div class="card glass">
    <h2 class="logo" style="font-size:2.6rem">Paused</h2>
    <div class="controls">
      <kbd>W / S</kbd><span>Throttle lever up / down (<kbd>Space</kbd> idle)</span>
      <kbd>A / D</kbd><span>Steer</span>
      <kbd>B</kbd><span>Hold to run the bilge pump</span>
      <kbd>Q / E</kbd><span>Trim the sheet (sloop) · <kbd>F</kbd> hoist / drop sails</span>
      <kbd>C</kbd><span>Camera: chase / helm / orbit</span>
      <kbd>R</kbd><span>Respawn at last gate (+20 s)</span>
      <kbd>H</kbd><span>Toggle HUD · <kbd>F2</kbd> photo mode · <kbd>M</kbd> sound · <kbd>G</kbd> resolution</span>
      <kbd>Drag</kbd><span>Look around · wheel to zoom</span>
    </div>
    <div class="btns">
      <button class="btn primary" id="pResume" style="font-size:1.1rem">Resume</button>
      <button class="btn" id="pRestart">Restart run</button>
      <button class="btn ghost" id="pMenu">Back to menu</button>
    </div>
  </div>
</section>

<section class="screen s-result"><div class="card glass" id="resultCard"></div></section>`;
  }

  private cache(): void {
    const ids = [
      'loadFill',
      'loadMsg',
      'boats',
      'boatCard',
      'weather',
      'wxBlurb',
      'wxDanger',
      'tide',
      'tideHint',
      'route',
      'routeHint',
      'diff',
      'diffHint',
      'go',
      'how',
      'quality',
      'muteBtn',
      'strip',
      'vigW',
      'splash',
      'gateNo',
      'gateName',
      'time',
      'prog',
      'penalty',
      'miniHost',
      'dockHost',
      'dockPanel',
      'limit',
      'dkTime',
      'dkSpeed',
      'dkAngle',
      'dkPos',
      'dkHold',
      'dkRead',
      'toasts',
      'count',
      'warn',
      'water',
      'wL',
      'wCap',
      'inPill',
      'wIn',
      'pumpPill',
      'leakPill',
      'wLeak',
      'kn',
      'steerDot',
      'wind',
      'windDir',
      'cur',
      'waves',
      'hint',
      'pResume',
      'pRestart',
      'pMenu',
      'resultCard',
      'rRing',
      'rWind',
      'rCur',
      'dFill',
      'dNeedle',
      'lKnob',
      'vWater',
      'vTilt',
    ];
    this.el = {};
    for (const id of ids) {
      const e = this.root.querySelector<HTMLElement>(`#${id}`);
      if (e) this.el[id] = e;
    }
  }

  // ---- menu ----------------------------------------------------------------------------------------------

  private buildMenu(): void {
    const g = this.game;
    const boats = this.el.boats as HTMLElement;
    boats.innerHTML = BOATS.map(
      (b) =>
        `<button data-id="${b.id}" role="radio" aria-pressed="false" title="${b.name}">${boatIcon(b.id)}<span>${b.short}</span></button>`,
    ).join('');
    boats.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
      if (!b) return;
      g.setConfig({ boat: b.dataset.id as GameConfig['boat'] });
      this.syncMenu();
    });

    const wx = this.el.weather as HTMLElement;
    wx.innerHTML = WEATHER.map(
      (w) =>
        `<button data-id="${w.id}" role="radio" aria-pressed="false">${weatherIcon(w.icon)}<span>${w.name}</span><span class="dots">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= w.danger ? 'on' : ''}"></i>`).join('')}</span></button>`,
    ).join('');
    wx.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
      if (!b) return;
      g.setConfig({ weather: b.dataset.id as string });
      this.syncMenu();
    });

    const mkSeg = (id: string, items: [string, string, string?][], key: keyof GameConfig) => {
      const seg = this.el[id] as HTMLElement;
      seg.innerHTML = items
        .map(
          ([v, label, sub]) =>
            `<button data-v="${v}" role="radio" aria-pressed="false">${label}${sub ? `<small>${sub}</small>` : ''}</button>`,
        )
        .join('');
      seg.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]');
        if (!b) return;
        g.setConfig({ [key]: b.dataset.v } as Partial<GameConfig>);
        this.syncMenu();
      });
    };
    mkSeg(
      'tide',
      [
        ['ebb', 'Ebb', 'going out'],
        ['slack', 'Slack', 'calm'],
        ['flood', 'Flood', 'coming in'],
      ],
      'tide',
    );
    mkSeg(
      'route',
      [
        ['full', 'Full run', 'out, back & dock'],
        ['outbound', 'Sprint out', 'bay → ocean'],
        ['inbound', 'Home & dock', 'ocean → marina'],
      ],
      'route',
    );
    mkSeg(
      'diff',
      DIFFICULTIES.map((d) => [d.id, d.name.replace('Haulover ', '')] as [string, string]),
      'difficulty',
    );

    const qual = this.el.quality as HTMLElement;
    qual.innerHTML = (['low', 'medium', 'high'] as const)
      .map(
        (v) =>
          `<button data-v="${v}" aria-pressed="${g.settings.quality === v}">${v[0]!.toUpperCase()}${v.slice(1)}</button>`,
      )
      .join('');
    qual.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]');
      if (!b || b.dataset.v === g.settings.quality) return;
      g.settings.quality = b.dataset.v as typeof g.settings.quality;
      saveSettings(g.settings);
      location.reload();
    });

    this.el.go!.addEventListener('click', () => this.start());
    const pop = this.root.querySelector<HTMLElement>('#ctrlPop')!;
    this.el.how!.addEventListener('click', () => (pop.hidden = !pop.hidden));
    this.root.querySelector('#ctrlClose')!.addEventListener('click', () => (pop.hidden = true));
    this.el.muteBtn!.addEventListener('click', () => this.toggleMute());
    this.el.muteBtn!.textContent = g.settings.master === 0 ? '🔇' : '🔊';
    this.el.pResume!.addEventListener('click', () => g.togglePause());
    this.el.pRestart!.addEventListener('click', () => {
      g.togglePause();
      g.startRun();
    });
    this.el.pMenu!.addEventListener('click', () => {
      g.togglePause();
      g.backToMenu();
    });
    this.syncMenu();
  }

  private syncMenu(): void {
    const g = this.game;
    const c = g.cfg;
    const press = (host: HTMLElement, attr: 'id' | 'v', val: string) => {
      for (const b of host.querySelectorAll<HTMLElement>('button')) {
        b.setAttribute('aria-pressed', String(b.dataset[attr] === val));
      }
    };
    press(this.el.boats!, 'id', c.boat);
    press(this.el.weather!, 'id', c.weather);
    press(this.el.tide!, 'v', c.tide);
    press(this.el.route!, 'v', c.route);
    press(this.el.diff!, 'v', c.difficulty);

    const spec = BOATS.find((b) => b.id === c.boat)!;
    const diff = difficultyById(c.difficulty);
    const w = weatherById(c.weather);
    const bar = (v: number, fill: string) =>
      `<div class="bar" style="--v:${v}; --fill:${fill}"><i></i></div>`;
    const stat = (label: string, v: number, fill: string) => `<span>${label}</span>${bar(v, fill)}`;
    this.el.boatCard!.innerHTML = `
      <div class="tagline">${spec.tagline}</div>
      <h2>${spec.name}</h2>
      <p>${spec.blurb}</p>
      <div class="stats">
        ${stat('Speed', spec.stats.speed, 'linear-gradient(90deg,var(--mint),var(--aqua))')}
        ${stat('Handling', spec.stats.handling, 'linear-gradient(90deg,var(--sky),var(--lavender))')}
        ${stat('Stability', spec.stats.stability, 'linear-gradient(90deg,var(--sun),var(--peach))')}
        ${stat('Dryness', spec.stats.dryness, 'linear-gradient(90deg,var(--aqua),var(--mint))')}
        ${stat('Windage', spec.stats.windage, 'linear-gradient(90deg,var(--peach),var(--coral))')}
      </div>
      <div class="specs"><span><b>${spec.length.toFixed(1)} m</b> / ${ft(spec.length)}</span><span>top <b>${Math.round(spec.topSpeed * KNOTS)} kn</b></span><span>draft <b>${spec.keelDepth.toFixed(1)} m</b></span>${spec.sail ? '<span><b>sail + motor</b></span>' : ''}</div>`;
    this.el.wxBlurb!.textContent = w.blurb;
    this.el.wxDanger!.textContent = `${'●'.repeat(w.danger)}${'○'.repeat(5 - w.danger)}`;
    this.el.tideHint!.textContent =
      c.tide === 'ebb' ? 'strong set to the sea' : c.tide === 'flood' ? 'pushing you in' : 'barely moving';
    this.el.routeHint!.textContent =
      c.route === 'outbound'
        ? 'cross the bar, reach the sea buoy'
        : c.route === 'inbound'
          ? 'run home, then thread the pilings and dock'
          : 'round the buoy, come home, dock in slip 3';
    this.el.diffHint!.textContent = `bilge: ${Math.round(spec.capacity * diff.capacity)} L`;

    const wspeed = w.windSpeed * KNOTS;
    const strip = this.el.strip!;
    strip.innerHTML = `
      <div class="c"><span class="label">Wind</span><b class="num">${Math.round(wspeed)} kn</b><span class="label">${cardinal(w.windFrom)}</span></div>
      <div class="c"><span class="label">Swell</span><b class="num">${(w.swellHeight * 3.28).toFixed(0)} ft</b><span class="label">${cardinal(w.swellFrom)}</span></div>
      <div class="c"><span class="label">Current</span><b class="num">${c.tide === 'slack' ? '0.2' : c.tide === 'ebb' ? (2.7 * KNOTS * diff.currentScale).toFixed(1) : (2.3 * KNOTS * diff.currentScale).toFixed(1)} kn</b><span class="label">${c.tide === 'flood' ? 'inbound' : c.tide === 'ebb' ? 'outbound' : 'slack'}</span></div>`;
    if (this.mini) this.mini.redraw();
  }

  // ---- HUD ------------------------------------------------------------------------------------------------

  private buildGateDots(): void {
    const prog = this.el.prog!;
    for (const d of prog.querySelectorAll('i.dot')) d.remove();
    this.gateDots = [];
    const c = this.game.course;
    for (const gt of c.gates) {
      const f = pathProgress(c, gt.x, gt.z, 0).frac;
      const d = document.createElement('i');
      d.className = 'dot';
      d.style.left = `${clamp(f, 0, 1) * 100}%`;
      prog.insertBefore(d, prog.querySelector('i.boat'));
      this.gateDots.push(d);
    }
  }

  private splash(a: number): void {
    const s = this.el.splash!;
    s.style.setProperty('opacity', String(Math.min(1, 0.35 + a)));
    s.classList.remove('on');
    void s.offsetWidth;
    s.classList.add('on');
  }

  /** Called every frame; throttled internally. */
  update(now: number): void {
    const g = this.game;
    const phase = g.phase;
    if (phase === 'loading') return;
    if (now - this.lastHud < 45) return;
    this.lastHud = now;

    if (phase === 'menu') return;
    const h = g.hud;
    const e = this.el;

    // top-left
    e.gateNo!.textContent = `Gate ${Math.min(h.gate + 1, h.gates)} / ${h.gates}`;
    e.gateName!.textContent = h.gateLabel;
    e.time!.textContent = fmtTime(h.time);
    e.penalty!.textContent = h.penalty > 0 ? `+${h.penalty.toFixed(0)} s penalty` : '';
    e.limit!.textContent = h.dock ? '' : `limit ${fmtTime(h.timeLeft).slice(0, -2)}`;
    e.limit!.classList.toggle('low', !h.dock && h.timeLeft < 30);
    const d = h.dock;
    e.dockPanel!.hidden = !d;
    e.dockHost!.hidden = !d;
    e.miniHost!.hidden = !!d;
    if (d) {
      e.dkTime!.textContent = fmtTime(d.timeLeft).slice(0, -2);
      e.dkTime!.classList.toggle('low', d.timeLeft < 20);
      e.dkSpeed!.classList.toggle('ok', d.speedOk);
      e.dkAngle!.classList.toggle('ok', d.alignOk);
      e.dkPos!.classList.toggle('ok', d.posOk);
      e.dkSpeed!.textContent = `${d.speedKn.toFixed(1)} kn`;
      e.dkAngle!.textContent = `${d.alignDeg.toFixed(0)}° off`;
      e.dkPos!.textContent = d.posOk ? 'in berth' : `${d.dist.toFixed(0)} m`;
      e.dkHold!.style.setProperty('--p', (d.hold / d.need).toFixed(3));
      e.dkRead!.textContent =
        d.clearance < 12 ? `clearance ${Math.max(0, d.clearance).toFixed(1)} m` : 'steer for the slip';
      this.radar.draw();
    }
    const prog = e.prog!;
    prog.style.setProperty('--p', h.progress.toFixed(3));
    for (const [i, d] of this.gateDots.entries()) d.classList.toggle('done', i < h.gate);

    // water vial
    const w = e.water!;
    const f = clamp(h.waterFrac, 0, 1);
    w.style.setProperty('--f', f.toFixed(3));
    const tilt = clamp(g.player.water.tiltRoll * 57.3 * 0.7, -32, 32);
    w.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
    const [w1, w2] =
      f < 0.4
        ? ['oklch(0.86 0.1 190)', 'oklch(0.72 0.12 225)']
        : f < 0.7
          ? ['oklch(0.9 0.12 90)', 'oklch(0.78 0.14 60)']
          : ['oklch(0.84 0.14 30)', 'oklch(0.68 0.2 10)'];
    w.style.setProperty('--w1', w1!);
    w.style.setProperty('--w2', w2!);
    e.wL!.textContent = h.litres.toFixed(0);
    e.wCap!.textContent = h.capacity.toFixed(0);
    e.wIn!.textContent = `${h.intakeLps > 0.2 ? '+' : ''}${h.intakeLps.toFixed(1)} L/s`;
    e.inPill!.classList.toggle('on', h.intakeLps > 1);
    e.pumpPill!.classList.toggle('on', h.pumping);
    e.leakPill!.hidden = h.leakLps < 0.05;
    e.wLeak!.textContent = h.leakLps.toFixed(1);
    e.vigW!.style.setProperty('--w', clamp((h.waterFrac - 0.5) * 2, 0, 1).toFixed(2));

    // dial + lever
    const p = clamp(h.speedKn / Math.max(1, h.topKn), 0, 1);
    e.dFill!.style.setProperty('--p', p.toFixed(3));
    e.dNeedle!.style.setProperty('--a', `${(-120 + 240 * p).toFixed(1)}deg`);
    e.kn!.textContent = h.speedKn.toFixed(h.speedKn < 10 ? 1 : 0);
    e.lKnob!.style.setProperty('--y', `${(10 + (1 - (h.throttle + 0.4) / 1.4) * 100).toFixed(1)}px`);
    e.steerDot!.style.setProperty('--s', clamp(h.steer, -1, 1).toFixed(2));

    // rose (heading-up)
    e.rRing!.style.transform = `rotate(${(-h.heading).toFixed(1)}deg)`;
    e.rWind!.style.transform = `rotate(${(h.windFrom + 180).toFixed(1)}deg)`;
    e.rCur!.style.transform = `rotate(${h.currentTo.toFixed(1)}deg) scale(${(0.55 + Math.min(1, h.currentKn / 5) * 0.55).toFixed(2)})`;
    e.wind!.textContent = `${h.windKn.toFixed(0)} kn`;
    e.windDir!.textContent = `from ${cardinal(h.windFrom)}`;
    e.cur!.textContent = `${h.currentKn.toFixed(1)} kn`;
    e.waves!.textContent = `${(h.waveH * 3.28).toFixed(1)} ft`;

    // centre text
    e.count!.textContent =
      phase === 'countdown' ? (h.countdown > 0.4 ? String(Math.ceil(h.countdown - 0.4)) : 'GO') : '';
    if (phase === 'countdown' && h.countdown <= 0.4) e.count!.textContent = '';
    const warn = e.warn!;
    warn.hidden = !h.warning || phase !== 'playing';
    if (h.warning) warn.textContent = h.warning;

    this.syncToasts(g.toasts);
    if (!h.dock) this.mini.draw();
    e.hint!.style.opacity = performance.now() < this.hintUntil ? '1' : '0';
    void this.lastPhase;
  }

  private syncToasts(list: ToastMsg[]): void {
    const host = this.el.toasts!;
    const live = new Set<number>();
    for (const t of list) {
      live.add(t.id);
      let el = this.toastEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `toast ${t.tone}`;
        el.textContent = t.text;
        host.appendChild(el);
        this.toastEls.set(t.id, el);
      }
      el.classList.toggle('out', t.ttl < 0.4);
    }
    for (const [id, el] of this.toastEls) {
      if (!live.has(id)) {
        el.remove();
        this.toastEls.delete(id);
      }
    }
  }

  // ---- results ---------------------------------------------------------------------------------------------

  private buildResult(): void {
    const r = this.game.result;
    if (!r) return;
    const ok = r.outcome === 'finished';
    const stars = [1, 2, 3]
      .map(
        (i) =>
          `<span class="${i <= r.stars ? 'pop' : 'off'}" style="animation-delay:${0.5 + i * 0.22}s">${starIcon()}</span>`,
      )
      .join('');
    this.el.resultCard!.innerHTML = `
      <h2 class="title logo">${r.title}</h2>
      <p class="sub">${r.subtitle}</p>
      ${ok ? `<div class="stars">${stars}</div><div><div class="score num">${r.score.toLocaleString()}</div>${r.newBest ? '<span class="badge">NEW BEST</span>' : `<span class="label">best ${r.best.toLocaleString()}</span>`}</div>` : ''}
      <div class="grid">
        <div><span class="label">Time</span><b class="num">${fmtTime(r.time)}</b></div>
        <div><span class="label">Stayed dry</span><b class="num">${r.dryPct}%</b></div>
        <div><span class="label">Peak bilge</span><b class="num">${r.peakL}/${r.capacityL} L</b></div>
        <div><span class="label">Top speed</span><b class="num">${r.maxSpeedKn} kn</b></div>
        <div><span class="label">Hull strikes</span><b class="num">${r.collisions}</b></div>
        <div><span class="label">Water shipped</span><b class="num">${r.totalIntakeL} L</b></div>
      </div>
      ${r.dock ? `<div class="dockline">${r.dock.docked ? `Docked in ${r.dock.time.toFixed(0)} s · touched down at ${r.dock.speedKn.toFixed(1)} kn · ${r.dock.alignDeg.toFixed(0)}° off · ${r.dock.touches} bump${r.dock.touches === 1 ? '' : 's'} · <b>+${r.dock.bonus}</b>` : 'Never made it into the slip.'}</div>` : ''}
      <div class="gates">${r.gates.map((gt) => `<div><span>${gt.label}</span><span class="${gt.offset === null ? 'miss' : 'ok'}">${gt.offset === null ? 'missed' : Math.abs(gt.offset) < 0.28 ? 'clean ✓' : 'passed'}</span></div>`).join('')}</div>
      <div class="label">${r.boat} · ${r.weather} · ${r.difficulty}</div>
      <div class="btns">
        <button class="btn primary" id="rRetry" style="font-size:1.1rem">Run it again</button>
        <button class="btn" id="rMenu">Change setup</button>
      </div>`;
    this.el.resultCard!.querySelector('#rRetry')!.addEventListener('click', () => this.game.startRun());
    this.el.resultCard!.querySelector('#rMenu')!.addEventListener('click', () => this.game.backToMenu());
  }
}
