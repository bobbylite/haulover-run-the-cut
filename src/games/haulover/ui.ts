// Haulover's interface: the route menu section, the gate / clock panel, the route minimap and the
// docking panel with its radar. The shell supplies everything else (loading, pause, bilge, dials).

import { clamp } from '../../core/math';
import { pathProgress } from '../../game/course';
import type { ModeUi, ModeUiHost } from '../../game/mode';
import type { HudState, Phase, ResultState } from '../../game/state';
import { fmtTime } from '../../ui/format';
import {
  conditionsSection,
  difficultySection,
  mountSeg,
  press,
  SharedMenu,
  tideSection,
  vesselSection,
} from '../../ui/menuSections';
import { DockRadar } from './dockRadar';
import { MiniMap } from './minimap';
import type { HaulMode } from './mode';

const routeSection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Route</span><span class="hint" id="routeHint"></span></div>
      <div class="seg" id="route" role="radiogroup" aria-label="Route"></div>
    </div>`;

export class HaulUi implements ModeUi {
  private host!: ModeUiHost;
  private shared!: SharedMenu;
  private mini!: MiniMap;
  private radar!: DockRadar;
  private gateDots: HTMLElement[] = [];

  constructor(private readonly mode: HaulMode) {}

  menuHtml(): string {
    return vesselSection() + conditionsSection() + tideSection() + routeSection() + difficultySection();
  }

  hudHtml(): string {
    return `
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
  </div>`;
  }

  attach(host: ModeUiHost): void {
    this.host = host;
    const g = host.game;
    this.mini = new MiniMap(g, this.mode);
    host.q('miniHost')?.appendChild(this.mini.canvas);
    this.radar = new DockRadar(g, this.mode);
    host.q('dockHost')?.appendChild(this.radar.canvas);
    this.shared = new SharedMenu(host, () => this.syncMenu());
    this.shared.build();
    mountSeg(
      host,
      'route',
      [
        ['full', 'Full run', 'out, back & dock'],
        ['outbound', 'Sprint out', 'bay → ocean'],
        ['inbound', 'Home & dock', 'ocean → marina'],
      ],
      'route',
      () => this.syncMenu(),
    );
    this.buildGateDots();
    this.syncMenu();
  }

  cycleVessel(d: number): void {
    this.shared.cycleVessel(d);
  }

  syncMenu(): void {
    this.shared.sync();
    const c = this.host.game.cfg;
    press(this.host.q('route'), 'v', c.route);
    const hint = this.host.q('routeHint');
    if (hint)
      hint.textContent =
        c.route === 'outbound'
          ? 'cross the bar, reach the sea buoy'
          : c.route === 'inbound'
            ? 'run home, then thread the pilings and dock'
            : 'round the buoy, come home, dock in slip 3';
    this.mini?.redraw();
  }

  onPhase(p: Phase): void {
    if (p === 'menu') {
      this.syncMenu();
      this.buildGateDots();
    }
    if (p === 'countdown') {
      this.mini.redraw();
      this.buildGateDots();
    }
  }

  private buildGateDots(): void {
    const prog = this.host.q('prog');
    if (!prog) return;
    for (const d of prog.querySelectorAll('i.dot')) d.remove();
    this.gateDots = [];
    const c = this.mode.course;
    for (const gt of c.gates) {
      const f = pathProgress(c, gt.x, gt.z, 0).frac;
      const d = document.createElement('i');
      d.className = 'dot';
      d.style.left = `${clamp(f, 0, 1) * 100}%`;
      prog.insertBefore(d, prog.querySelector('i.boat'));
      this.gateDots.push(d);
    }
  }

  update(h: HudState): void {
    const q = (id: string) => this.host.q(id) as HTMLElement;
    q('gateNo').textContent = `Gate ${Math.min(h.gate + 1, h.gates)} / ${h.gates}`;
    q('gateName').textContent = h.gateLabel;
    q('time').textContent = fmtTime(h.time);
    q('penalty').textContent = h.penalty > 0 ? `+${h.penalty.toFixed(0)} s penalty` : '';
    q('limit').textContent = h.dock ? '' : `limit ${fmtTime(h.timeLeft).slice(0, -2)}`;
    q('limit').classList.toggle('low', !h.dock && h.timeLeft < 30);
    const d = h.dock;
    q('dockPanel').hidden = !d;
    q('dockHost').hidden = !d;
    q('miniHost').hidden = !!d;
    if (d) {
      q('dkTime').textContent = fmtTime(d.timeLeft).slice(0, -2);
      q('dkTime').classList.toggle('low', d.timeLeft < 20);
      q('dkSpeed').classList.toggle('ok', d.speedOk);
      q('dkAngle').classList.toggle('ok', d.alignOk);
      q('dkPos').classList.toggle('ok', d.posOk);
      q('dkSpeed').textContent = `${d.speedKn.toFixed(1)} kn`;
      q('dkAngle').textContent = `${d.alignDeg.toFixed(0)}° off`;
      q('dkPos').textContent = d.posOk ? 'in berth' : `${d.dist.toFixed(0)} m`;
      q('dkHold').style.setProperty('--p', (d.hold / d.need).toFixed(3));
      q('dkRead').textContent =
        d.clearance < 12 ? `clearance ${Math.max(0, d.clearance).toFixed(1)} m` : 'steer for the slip';
      this.radar.draw();
    }
    q('prog').style.setProperty('--p', h.progress.toFixed(3));
    for (const [i, dot] of this.gateDots.entries()) dot.classList.toggle('done', i < h.gate);
    if (!h.dock) this.mini.draw();
  }

  resultHtml(r: ResultState): string {
    return `
      ${r.dock ? `<div class="dockline">${r.dock.docked ? `Docked in ${r.dock.time.toFixed(0)} s · touched down at ${r.dock.speedKn.toFixed(1)} kn · ${r.dock.alignDeg.toFixed(0)}° off · ${r.dock.touches} bump${r.dock.touches === 1 ? '' : 's'} · <b>+${r.dock.bonus}</b>` : 'Never made it into the slip.'}</div>` : ''}
      <div class="gates">${r.gates.map((gt) => `<div><span>${gt.label}</span><span class="${gt.offset === null ? 'miss' : 'ok'}">${gt.offset === null ? 'missed' : Math.abs(gt.offset) < 0.28 ? 'clean ✓' : 'passed'}</span></div>`).join('')}</div>`;
  }
}
