// Nantucket's interface: the challenge picker (levels by tier, with stars and locks), the vessel card, the
// clock and berth panel, the berthing radar, the thruster and tug controls, and the result card. The shell
// supplies the speedometer, wind rose, pause and toasts.

import { clamp } from '../../core/math';
import type { Game } from '../../game/game';
import type { ModeUi, ModeUiHost } from '../../game/mode';
import type { HudState, Phase, ResultState } from '../../game/state';
import { fmtTime } from '../../ui/format';
import { boatIcon } from '../../ui/icons';
import { conditionsSection, difficultySection, press, SharedMenu, tideSection } from '../../ui/menuSections';
import type { TouchButton } from '../../ui/touch';
import { LEVELS, levelById, NANT_DIFFICULTIES, nantDifficulty, TIERS } from './levels';
import { NantMap } from './map';
import type { NantMode } from './mode';
import { NantRadar } from './radar';

const KIND_LABEL = { slip: 'slip', alongside: 'wharf', mooring: 'mooring' } as const;

const challengeSection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Challenge</span><span class="hint">← → to browse</span></div>
      <div class="nt-levels" id="ntLevels"></div>
      <div class="nt-card" id="ntCard"></div>
      <div class="boat-card" id="boatCard"></div>
    </div>`;

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

export class NantUi implements ModeUi {
  readonly startLabel = 'Cast Off';
  private host!: ModeUiHost;
  private shared!: SharedMenu;
  private radar!: NantRadar;
  private map!: NantMap;
  private mapT = 0;

  constructor(private readonly mode: NantMode) {}

  // ---- menu ----------------------------------------------------------------------------------------

  menuHtml(): string {
    return challengeSection() + conditionsSection() + tideSection() + difficultySection();
  }

  controlsHtml(): string {
    return `
        <kbd>W / S</kbd><span>Throttle lever up / down (<kbd>Space</kbd> idle, <kbd>S</kbd> astern)</span>
        <kbd>A / D</kbd><span>Steer (twin screws turn a ship on the spot)</span>
        <kbd>Q / E</kbd><span>Bow thruster: bow to port / starboard</span>
        <kbd>Z / V</kbd><span>Stern thruster: stern to port / starboard</span>
        <kbd>1 2 3 4</kbd><span>Call a tug: bow to port / starboard, stern to port / starboard</span>
        <kbd>5</kbd><span>Tugs hold: brake everything</span>
        <kbd>C</kbd><span>Camera: chase / helm / orbit</span>
        <kbd>R</kbd><span>Back to the start (+25 s)</span>
        <kbd>H</kbd><span>Toggle HUD · <kbd>F2</kbd> photo · <kbd>M</kbd> sound · <kbd>G</kbd> resolution</span>
        <kbd>Gamepad</kbd><span>Stick steer · RT/LT throttle · d-pad bow thruster · LB/RB stern thruster</span>`;
  }

  hintHtml(): string {
    return 'Bring the hull onto the <b>glowing berth</b> · <kbd>Q</kbd>/<kbd>E</kbd> bow thruster · <kbd>Z</kbd>/<kbd>V</kbd> stern · <kbd>1</kbd>–<kbd>5</kbd> tugs · <kbd>W</kbd>/<kbd>S</kbd> throttle · <kbd>Esc</kbd> pause';
  }

  touchButtons(game: Game): TouchButton[] {
    const input = game.input;
    return [
      { label: 'Bow ◀', hold: (on) => (input.touchBow = on ? -1 : 0) },
      { label: 'Bow ▶', hold: (on) => (input.touchBow = on ? 1 : 0) },
      { label: 'Stern ◀', hold: (on) => (input.touchStern = on ? -1 : 0) },
      { label: 'Stern ▶', hold: (on) => (input.touchStern = on ? 1 : 0) },
      { label: 'Tug hold', tap: () => this.mode.callTug('hold') },
    ];
  }

  hudHtml(): string {
    return `
  <div class="hud-top-left glass hud-part nt-obj">
    <div class="row"><div><div class="label" id="ntLevel">Challenge</div><div class="gate-name" id="ntBerth">Berth</div></div><div class="timeblock"><div class="time num" id="ntClock">0:00</div><div class="limit num">left</div></div></div>
  </div>
  <div class="hud-minimap hud-dockhost glass hud-part" id="ntRadarHost"></div>
  <div class="hud-dock glass hud-part nt-dock" id="ntDock">
    <div class="head"><span class="label" id="ntKind">Berthing</span><b class="num" id="ntDist">0 m</b></div>
    <div class="chips"><span id="ntSpeed">Speed</span><span id="ntAngle">Angle</span><span id="ntPos">Berth</span></div>
    <div class="hold"><i id="ntHold"></i></div>
    <div class="read num" id="ntRead"></div>
  </div>
  <div class="nt-ctl glass hud-part" id="ntCtl" hidden>
    <div class="thr" id="ntThr">
      <div class="trow" id="ntBowRow"><span class="label">Bow</span><div class="tbar"><i id="ntBow"></i></div><span class="keys"><kbd>Q</kbd><kbd>E</kbd></span></div>
      <div class="trow" id="ntSternRow"><span class="label">Stern</span><div class="tbar"><i id="ntStern"></i></div><span class="keys"><kbd>Z</kbd><kbd>V</kbd></span></div>
    </div>
    <div class="tugs" id="ntTugs">
      <div class="label">Tugs <b class="num" id="ntTugLeft">0</b> left</div>
      <div class="tbtns">
        <button data-call="bow-port" title="Bow tug pushes to port">1<small>Bow ◀</small></button>
        <button data-call="bow-stbd" title="Bow tug pushes to starboard">2<small>Bow ▶</small></button>
        <button data-call="stern-port" title="Stern tug pushes to port">3<small>Stern ◀</small></button>
        <button data-call="stern-stbd" title="Stern tug pushes to starboard">4<small>Stern ▶</small></button>
        <button data-call="hold" title="Tugs hold her: brake">5<small>Hold</small></button>
      </div>
    </div>
  </div>`;
  }

  attach(host: ModeUiHost): void {
    this.host = host;
    const g = host.game;
    host.root.dataset.game = 'nantucket';
    host.root.classList.add('nt-root');
    this.radar = new NantRadar(g, this.mode);
    host.q('ntRadarHost')?.appendChild(this.radar.canvas);
    // the harbour chart floats over the scene while you choose (a pin per challenge)
    this.map = new NantMap(g, this.mode, (id) => this.pick(id));
    const chart = document.createElement('div');
    chart.className = 'nt-map glass';
    chart.innerHTML =
      '<div class="head"><span class="label">Nantucket Harbor</span><span class="hint">click a pin</span></div>';
    chart.appendChild(this.map.canvas);
    host.root.querySelector('.s-menu')?.appendChild(chart);
    this.shared = new SharedMenu(host, () => this.syncMenu(), {
      difficulties: NANT_DIFFICULTIES.map((d) => [d.id, d.name] as [string, string]),
      diffOf: nantDifficulty,
    });
    this.shared.build();
    this.buildLevels();
    host.q('ntLevels')?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      this.pick(b.dataset.id as string);
    });
    host.q('ntTugs')?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-call]');
      if (b && g.phase === 'playing') this.mode.callTug(b.dataset.call as never);
    });
    // "next challenge" on the result card
    host.root.addEventListener('click', (e) => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('#ntNext');
      if (!n) return;
      this.pick(n.dataset.id as string);
      g.startRun();
    });
    this.syncMenu();
  }

  /** Choose a challenge: it brings its own vessel, and suggests its sky and tide. */
  private pick(id: string): void {
    const l = levelById(id);
    this.host.game.setConfig({ level: l.id, boat: l.boat, weather: l.weather, tide: l.tide });
    this.syncMenu();
  }

  cycleVessel(d: number): void {
    const i = LEVELS.findIndex((l) => l.id === this.mode.level.id);
    // skip the locked ones
    for (let k = 1; k <= LEVELS.length; k++) {
      const n = LEVELS[(i + d * k + LEVELS.length * 4) % LEVELS.length];
      if (n && this.mode.open(n)) {
        this.pick(n.id);
        return;
      }
    }
  }

  private buildLevels(): void {
    const el = this.host.q('ntLevels');
    if (!el) return;
    const m = this.mode;
    el.innerHTML = TIERS.map((t) => {
      const ls = LEVELS.filter((l) => l.tier === t.tier);
      const open = m.open(ls[0] as (typeof LEVELS)[number]);
      return `<div class="nt-tier ${open ? '' : 'locked'}" title="${open ? t.blurb : 'earn a star on two of the tier above to open this'}"><div class="th"><span class="label">${t.name}</span></div><div class="nt-grid">${ls
        .map((l) => {
          const s = m.stars[l.id] ?? 0;
          return `<button data-id="${l.id}" role="radio" aria-pressed="false" aria-disabled="${!open}" title="${l.name}">${boatIcon(l.boat)}<b>${l.name}</b><span class="st ${s ? 'got' : ''}">${open ? stars(s) : '🔒'}</span></button>`;
        })
        .join('')}</div></div>`;
    }).join('');
  }

  syncMenu(): void {
    this.shared?.sync();
    const m = this.mode;
    this.buildLevels();
    press(this.host.q('ntLevels'), 'id', m.level.id);
    this.map?.draw();
    const l = m.level;
    const card = this.host.q('ntCard');
    if (card) {
      const diff = m.diff;
      card.innerHTML = `
        <div class="nt-line"><span class="chip">${KIND_LABEL[m.berth.kind]}</span><b>${m.berth.label}</b><span class="nt-time num">${fmtTime(l.time * diff.timeScale).slice(0, -2)} on the clock</span></div>
        <p>${l.blurb}</p>
        <div class="nt-line small"><span>${m.spec.thrusters ? 'thrusters ✓' : 'no thrusters'}</span><span>${m.tugCalls() ? `${m.tugCalls()} tug calls (${l.tugFree} free)` : 'no tugs'}</span><span>tier ${l.tier}</span></div>`;
    }
  }

  onPhase(p: Phase): void {
    if (p === 'menu') {
      this.syncMenu();
      this.map.draw();
    }
    if (p === 'countdown' || p === 'playing') this.radar.draw();
  }

  // ---- HUD -----------------------------------------------------------------------------------------

  update(h: HudState): void {
    const q = (id: string) => this.host.q(id) as HTMLElement;
    const m = this.mode;
    if (h.phase === 'menu' && performance.now() - this.mapT > 120) {
      this.mapT = performance.now();
      this.map.draw();
    }
    q('ntLevel').textContent = m.level.name;
    q('ntBerth').textContent = m.berth.label;
    q('ntClock').textContent = fmtTime(h.timeLeft).slice(0, -2);
    q('ntClock').classList.toggle('low', h.timeLeft < 30);
    const st = h.berth;
    q('ntDock').hidden = !st;
    q('ntRadarHost').hidden = !st;
    const ship = m.spec.thrusters || m.tugs.calls > 0;
    q('ntCtl').hidden = !st || !ship;
    if (!st) return;
    const mooring = st.kind === 'mooring';
    q('ntKind').textContent = `${KIND_LABEL[st.kind]} · ${st.label}`;
    q('ntDist').textContent = `${Math.round(st.dist)} m`;
    q('ntSpeed').classList.toggle('ok', st.speedOk);
    q('ntAngle').classList.toggle('ok', st.alignOk);
    q('ntPos').classList.toggle('ok', st.posOk);
    q('ntSpeed').textContent = `${st.speedKn.toFixed(2)} kn`;
    q('ntAngle').textContent = mooring ? 'bow to ball' : `${st.alignDeg.toFixed(0)}° off`;
    q('ntPos').textContent = st.posOk
      ? mooring
        ? 'on the ball'
        : 'in berth'
      : mooring
        ? `${st.dist.toFixed(0)} m`
        : `${Math.abs(st.along).toFixed(0)} · ${Math.abs(st.across).toFixed(0)} m`;
    q('ntHold').style.setProperty('--p', clamp(st.hold / st.need, 0, 1).toFixed(3));
    q('ntRead').textContent =
      st.dist > 70
        ? `${Math.round(st.dist)} m to go · full astern stops you in ${Math.round(st.stopDist)} m`
        : st.clearance < 14
          ? `clearance ${Math.max(0, st.clearance).toFixed(1)} m · stop in ${Math.round(st.stopDist)} m`
          : `along ${st.along >= 0 ? '+' : ''}${st.along.toFixed(1)} m · off ${st.across >= 0 ? '+' : ''}${st.across.toFixed(1)} m`;
    if (ship) {
      const b = this.host.game.player;
      const bar = (id: string, v: number) => {
        const el = q(id);
        el.style.setProperty('--v', v.toFixed(3));
      };
      q('ntThr').hidden = !m.spec.thrusters;
      bar('ntBow', b.bowThr);
      bar('ntStern', b.sternThr);
      q('ntTugs').hidden = m.tugs.calls === 0;
      q('ntTugLeft').textContent = String(m.tugs.callsLeft);
      const busy = new Set(m.tugs.busy().map((t) => t.call));
      for (const btn of q('ntTugs').querySelectorAll<HTMLElement>('button[data-call]')) {
        btn.classList.toggle('on', busy.has(btn.dataset.call as never));
        btn.toggleAttribute('disabled', m.tugs.callsLeft <= 0);
      }
    }
    this.radar.draw();
  }

  // ---- results -------------------------------------------------------------------------------------

  resultStats(r: ResultState): string {
    const b = r.berth;
    if (!b) return '';
    return `
      <div class="grid">
        <div><span class="label">Time</span><b class="num">${fmtTime(r.time)}</b></div>
        <div><span class="label">Touchdown</span><b class="num">${b.docked ? `${b.speedKn.toFixed(2)} kn` : '—'}</b></div>
        <div><span class="label">Off the mark</span><b class="num">${b.docked ? `${b.alongM.toFixed(1)} · ${b.acrossM.toFixed(1)} m` : '—'}</b></div>
        <div><span class="label">Angle</span><b class="num">${b.docked ? `${b.alignDeg.toFixed(0)}°` : '—'}</b></div>
        <div><span class="label">Bumps</span><b class="num">${b.touches}</b></div>
        <div><span class="label">Hull left</span><b class="num">${r.hullPct}%</b></div>
        <div><span class="label">Tug calls</span><b class="num">${b.tugCalls}${b.tugFree ? ` / ${b.tugFree} free` : ''}</b></div>
        <div><span class="label">Top speed</span><b class="num">${r.maxSpeedKn} kn</b></div>
      </div>`;
  }

  resultHtml(r: ResultState): string {
    const b = r.berth;
    if (!b) return '';
    const parts = b.docked
      ? `<div class="gates">${b.parts.map((p) => `<div><span>${p.label}</span><span class="${p.pts >= 0 ? 'ok' : 'miss'}">${p.pts >= 0 ? '+' : ''}${p.pts}</span></div>`).join('')}</div>`
      : '';
    const m = this.mode;
    const next = LEVELS[LEVELS.findIndex((l) => l.id === b.level) + 1];
    const nextOpen = next && b.docked && m.open(next) ? next : null;
    return `
      ${b.unlocked ? `<div class="dockline">🔓 New tier unlocked: <b>${b.unlocked}</b></div>` : ''}
      ${b.docked && b.newStars ? `<div class="dockline">★ New best on ${b.levelName}: ${stars(r.stars)}</div>` : ''}
      ${parts}
      ${nextOpen ? `<button class="btn" id="ntNext" data-id="${nextOpen.id}">Next: ${nextOpen.name} ▶</button>` : ''}`;
  }
}
