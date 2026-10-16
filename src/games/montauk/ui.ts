// Montauk's interface: the menu (vessel, sky, tide, tier), the day panel, the chart, the fish finder, the
// troll panel with its speed window, the fight panel (tension gauge, stern-cone diagram, line, crew), the
// binocular overlay and the result card. The shell supplies bilge, hull, dials, toasts and pause.

import { Vector3 } from 'three/webgpu';
import { clamp, KNOTS } from '../../core/math';
import type { Game } from '../../game/game';
import type { ModeUi, ModeUiHost } from '../../game/mode';
import type { HudState, Phase, ResultState } from '../../game/state';
import { LINE_MAX, type Mood, SWEET } from '../../sim/fishing/fight';
import { speedWindow } from '../../sim/fishing/tackle';
import { TIERS, tierById } from '../../sim/fishing/tiers';
import { fmtTime } from '../../ui/format';
import {
  conditionsSection,
  difficultySection,
  press,
  SharedMenu,
  tideSection,
  vesselSection,
} from '../../ui/menuSections';
import type { TouchButton } from '../../ui/touch';
import { FishMap } from './map';
import type { FishMode } from './mode';
import { Sonar } from './sonar';

const MOOD_LABEL: Record<Mood, string> = {
  run: 'RUNNING',
  sulk: 'SOUNDING',
  thrash: 'THRASHING',
  circle: 'CIRCLING',
  dash: 'LAST DASH',
  tired: 'TIRED',
};
const MOOD_COLOR: Record<Mood, string> = {
  run: '#ff7a6b',
  sulk: '#a98cff',
  thrash: '#ffa24a',
  circle: '#4fd0e6',
  dash: '#ff4f7a',
  tired: '#5fe0b0',
};
const ROD_COLORS = ['#ff8f9d', '#7ff0cf', '#c3a2ff', '#ffd45e'];

const howSection = (): string => `
    <div class="sec fm-how">
      <div class="head"><span class="label">The day</span><span class="hint">wind against tide, all day</span></div>
      <ol>
        <li><b>Find the bait:</b> birds, boils, slicks. <kbd>V</kbd> is binoculars.</li>
        <li><b>Troll through it</b> at 5–8 kn through the water. <kbd>L</kbd> sets the spread.</li>
        <li><b>Fish on:</b> throttle back, ease the drag <kbd>Q</kbd>, chase the run, stern to the fish.</li>
      </ol>
    </div>`;

export class FishUi implements ModeUi {
  readonly startLabel = 'Cast Off';
  private host!: ModeUiHost;
  private shared!: SharedMenu;
  private map!: FishMap;
  private sonar!: Sonar;
  private gauge!: CanvasRenderingContext2D;
  private dir!: CanvasRenderingContext2D;
  private root!: HTMLElement;
  private readonly cache = new Map<string, string>();
  private readonly tagEls: HTMLElement[] = [];
  private lastPing = 0;
  private mapT = 0;
  private readonly v3 = new Vector3();

  constructor(private readonly mode: FishMode) {}

  // ---- menu ----------------------------------------------------------------------------------------

  menuHtml(): string {
    return vesselSection() + conditionsSection() + tideSection() + difficultySection() + howSection();
  }

  controlsHtml(): string {
    return `
        <kbd>W / S</kbd><span>Throttle lever up / down (<kbd>Space</kbd> idle, <kbd>S</kbd> astern)</span>
        <kbd>A / D</kbd><span>Steer</span>
        <kbd>L</kbd><span>Set the spread / reel the lines in</span>
        <kbd>V</kbd><span>Hold: binoculars (drag to look around)</span>
        <kbd>T</kbd><span>Mark this spot (bait drifts with the tide)</span>
        <kbd>Q / E</kbd><span>Fish on: ease / tighten the drag</span>
        <kbd>Z</kbd><span>Fish on: hold to pump the rod</span>
        <kbd>B</kbd><span>Hold to run the bilge pump</span>
        <kbd>C</kbd><span>Camera: chase / helm / orbit</span>
        <kbd>R</kbd><span>Run back to the lee off the Point (−75 s of daylight)</span>
        <kbd>H</kbd><span>Toggle HUD · <kbd>F2</kbd> photo · <kbd>M</kbd> sound · <kbd>G</kbd> resolution</span>
        <kbd>Gamepad</kbd><span>Stick steer · RT/LT throttle · LB/RB drag · B pump · A bilge · X camera</span>`;
  }

  touchButtons(game: Game): TouchButton[] {
    const m = this.mode;
    const input = game.input;
    return [
      { label: 'Lines', tap: () => m.toggleLines() },
      { label: 'Mark', tap: () => m.dropMark() },
      { label: 'Binos', hold: (on) => (input.touchBino = on) },
      { label: 'Rod pump', hold: (on) => (input.touchFishPump = on) },
      { label: 'Drag −', hold: (on) => (input.touchSheet = on ? -1 : 0) },
      { label: 'Drag +', hold: (on) => (input.touchSheet = on ? 1 : 0) },
    ];
  }

  hintHtml(): string {
    return '<kbd>L</kbd> lines · <kbd>V</kbd> binoculars · <kbd>T</kbd> mark · <kbd>Q</kbd>/<kbd>E</kbd> drag · <kbd>Z</kbd> pump · <kbd>W</kbd>/<kbd>S</kbd> throttle · <kbd>Esc</kbd> pause';
  }

  hudHtml(): string {
    return `
  <div class="hud-top-left glass hud-part fm-obj">
    <div class="row"><div><div class="label" id="fmPhase">Searching</div><div class="gate-name" id="fmTitle">Find the bait</div></div><div class="timeblock"><div class="time num" id="fmClock">0:00</div><div class="limit num">daylight</div></div></div>
    <div class="progress" id="fmDay"><i class="fill"></i><i class="boat"></i></div>
    <div class="fm-chips"><span id="fmStrikes">0 strikes</span><span id="fmLost">0 lost</span><span id="fmMarks">T to mark</span></div>
  </div>
  <div class="hud-fmmap glass hud-part" id="fmMapHost"></div>
  <div class="fm-sonar glass hud-part" id="fmSonarHost">
    <div class="head"><span class="label">Fish finder</span><b class="num" id="fmSonarRead">—</b></div>
  </div>
  <div class="fm-troll glass hud-part" id="fmTroll">
    <div class="head"><span class="label">Trolling</span><b class="num" id="fmStw">0.0 kn</b><small id="fmSog"></small></div>
    <div class="fm-speed" id="fmSpeed"><i class="win"></i><i class="ideal"></i><i class="dot"></i></div>
    <div class="fm-speed-ticks"><span>0</span><span>4</span><span>8</span><span>12 kn</span></div>
    <div class="fm-rods" id="fmRods">${ROD_COLORS.map((c, i) => `<span class="pip" data-i="${i}" style="--c:${c}"></span>`).join('')}<small id="fmRodTxt"></small></div>
    <div class="fm-msg" id="fmTrollMsg"></div>
  </div>
  <div class="fm-fight glass hud-part" id="fmFight" hidden>
    <canvas id="fmGauge" width="150" height="200" aria-label="Line tension"></canvas>
    <canvas id="fmDir" width="200" height="200" aria-label="Where the fish is"></canvas>
    <div class="fm-bars">
      <div class="fm-mood" id="fmMood">RUNNING</div>
      <div class="fm-bar"><span>Fish</span><i id="fmStam"></i></div>
      <div class="fm-bar"><span>Line</span><i id="fmLine"></i><b class="num" id="fmLineTxt">0 m</b></div>
      <div class="fm-bar"><span>Crew</span><i id="fmCrew"></i></div>
      <div class="fm-bar drag"><span>Drag</span><i id="fmDrag"></i><kbd>Q</kbd><kbd>E</kbd></div>
      <div class="fm-hint" id="fmHint"></div>
    </div>
  </div>
  <div class="fm-bino" id="fmBino" hidden><div class="ring"></div><div class="tags" id="fmTags"></div><div class="reticle"></div></div>`;
  }

  attach(host: ModeUiHost): void {
    this.host = host;
    this.root = host.root;
    host.root.classList.add('fm-root');
    const g = host.game;
    this.map = new FishMap(g, this.mode);
    host.q('fmMapHost')?.appendChild(this.map.canvas);
    this.sonar = new Sonar();
    host.q('fmSonarHost')?.appendChild(this.sonar.canvas);
    this.gauge = (host.q('fmGauge') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
    this.dir = (host.q('fmDir') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
    this.shared = new SharedMenu(host, () => this.syncMenu(), {
      tides: [
        ['ebb', 'Ebb', 'against the wind'],
        ['flood', 'Flood', 'with the wind'],
      ],
      difficulties: TIERS.map((t) => [t.id, t.name] as [string, string]),
    });
    this.shared.build();
    this.syncMenu();
  }

  cycleVessel(d: number): void {
    this.shared.cycleVessel(d);
  }

  syncMenu(): void {
    this.shared.sync();
    const c = this.host.game.cfg;
    const set = (id: string, text: string) => {
      const el = this.host.q(id);
      if (el) el.textContent = text;
    };
    press(this.host.q('tide'), 'v', c.tide);
    set(
      'tideHint',
      c.tide === 'ebb' ? 'the easterly stands the rips up' : 'wind and tide push you at the rocks',
    );
    const t = tierById(c.difficulty);
    set('diffHint', `${Math.round(t.daylightS / 60)} min of daylight`);
    const bl = this.host.q('wxBlurb');
    if (bl) bl.textContent = `${bl.textContent ?? ''}`;
    this.map?.redraw();
    // the difficulty buttons carry the tier blurb as a tooltip
    for (const b of this.host.q('diff')?.querySelectorAll<HTMLElement>('button') ?? []) {
      b.title = tierById(b.dataset.v ?? '').blurb;
    }
  }

  onPhase(p: Phase): void {
    if (p === 'menu') this.syncMenu();
    if (p === 'countdown') {
      this.sonar.clear();
      this.map.redraw();
    }
    this.root.classList.toggle('fm-fighting', false);
  }

  // ---- per tick ----------------------------------------------------------------------------------------

  private setText(id: string, text: string): void {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    const el = this.host.q(id);
    if (el) el.textContent = text;
  }

  update(h: HudState): void {
    const m = this.mode;
    const g = this.host.game;
    const b = g.player;
    const q = (id: string) => this.host.q(id) as HTMLElement;
    const phase = m.phaseName;
    const t = m.tier;

    // the day
    const left = m.daylightLeft;
    this.setText('fmClock', fmtTime(left).slice(0, -2));
    q('fmClock').classList.toggle('low', left < 60);
    q('fmDay').style.setProperty('--p', clamp(m.elapsed / t.daylightS, 0, 1).toFixed(3));
    this.setText('fmStrikes', `${m.strikes} ${m.strikes === 1 ? 'strike' : 'strikes'}`);
    this.setText('fmLost', `${m.lost} lost`);
    this.setText('fmMarks', m.marks.length ? `${m.marks.length} marked` : 'T to mark');
    const titles: Record<typeof phase, [string, string]> = {
      search: ['Searching', m.sightings.size ? 'Run down the signs' : 'Find the bait'],
      troll: [
        'Trolling',
        m.tackle.tangled ? 'Lines crossed, straighten out' : 'Work the spread through the school',
      ],
      fight: ['FISH ON', m.fight ? `${m.fight.kg} kg ${m.fight.species.name}` : ''],
    };
    this.setText('fmPhase', titles[phase][0]);
    this.setText('fmTitle', titles[phase][1]);
    this.root.classList.toggle('fm-fighting', !!m.fight);

    // the chart, a few times a second
    this.mapT += 1;
    if (this.mapT % 2 === 0) this.map.draw();

    // the fish finder
    const echo = m.world.echo(b.pos.x, b.pos.z);
    const fresh = this.sonar.push(0.045, echo, g.clock);
    if (fresh) {
      g.audio.sonarPing();
      g.toast(this.sonar.label, 'good', 3);
    }
    if (g.clock - this.lastPing > 2.4) {
      this.lastPing = g.clock;
      if (echo.bait) g.audio.sonarPing();
    }
    this.setText(
      'fmSonarRead',
      echo.marks.length
        ? `Fish! ${echo.marks.length > 1 ? `${echo.marks.length} arches` : 'arch'}`
        : echo.bait
          ? `Bait ${Math.round(echo.bait.depth)} m`
          : `${Math.round(echo.bottom)} m`,
    );

    // troll and fight panels swap
    const fighting = !!m.fight;
    q('fmTroll').hidden = fighting;
    q('fmFight').hidden = !fighting;
    if (fighting) this.drawFight();
    else this.drawTroll();

    this.drawBinoculars();
    void h;
  }

  // ---- troll -------------------------------------------------------------------------------------------

  private drawTroll(): void {
    const m = this.mode;
    const b = this.host.game.player;
    const q = (id: string) => this.host.q(id) as HTMLElement;
    const kn = Math.max(0, b.speed) * KNOTS;
    const sog = b.sog * KNOTS;
    this.setText('fmStw', `${kn.toFixed(1)} kn`);
    this.setText('fmSog', `${sog.toFixed(1)} over the ground`);
    const sp = q('fmSpeed');
    sp.style.setProperty('--v', clamp(kn / 12, 0, 1).toFixed(3));
    const win = speedWindow(kn);
    sp.dataset.q = win > 0.8 ? 'good' : win > 0.3 ? 'ok' : 'bad';
    let k = 0;
    const pips = q('fmRods').querySelectorAll<HTMLElement>('.pip');
    for (const [i, el] of pips.entries()) {
      const r = m.tackle.rods[i];
      if (!r) continue;
      el.dataset.s = r.state;
      if (r.state === 'fishing') k++;
    }
    this.setText(
      'fmRodTxt',
      m.tackle.tangled
        ? `${m.tackle.tangled} tangled`
        : m.tackle.linesOut === 0
          ? 'stowed · L to set'
          : m.tackle.fishing === 4
            ? 'spread out'
            : 'setting…',
    );
    let msg = '';
    if (m.tackle.linesOut === 0 && m.tackle.tangled === 0)
      msg = 'Find the bait, slow down, then set the spread (L).';
    else if (m.tackle.tangled) msg = 'Hold a steady 3 to 7 knots in a straight line to clear it.';
    else if (kn > 9.2) msg = 'Too fast: the lures are skipping out. Ease the throttle.';
    else if (kn > 8) msg = 'A touch fast. Lures are starting to skip.';
    else if (kn < 3) msg = 'Too slow: the lures are sinking.';
    else if (kn < 4.5) msg = 'A bit slow. Bring it up to 5 or 6.';
    else if (Math.abs(this.host.game.input.steer) > 0.55)
      msg = 'Easy on the helm. A tight turn crosses the lines.';
    else msg = 'In the window. Keep it straight and steady.';
    void k;
    this.setText('fmTrollMsg', msg);
  }

  // ---- fight -------------------------------------------------------------------------------------------

  private drawFight(): void {
    const m = this.mode;
    const f = m.fight;
    if (!f) return;
    const q = (id: string) => this.host.q(id) as HTMLElement;
    const b = this.host.game.player;

    // tension gauge with the sweet zone, the drag setting and a short trace
    const g = this.gauge;
    const W = 150;
    const H = 200;
    g.clearRect(0, 0, W, H);
    const top = 18;
    const bot = H - 14;
    const y = (t: number) => bot - ((bot - top) * clamp(t, 0, 1.3)) / 1.3;
    const bx = 8;
    const bw = 30;
    const zone = (a: number, c: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(bx, y(c), bw, y(a) - y(c));
    };
    zone(0, SWEET[0], 'rgba(160, 170, 210, 0.45)');
    zone(SWEET[0], SWEET[1], 'rgba(95, 224, 176, 0.75)');
    zone(SWEET[1], 1, 'rgba(255, 200, 90, 0.85)');
    zone(1, 1.3, 'rgba(255, 90, 110, 0.9)');
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    g.strokeRect(bx, top, bw, bot - top);
    // the drag setting: where the line starts to slip
    const ty = y(f.td);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(bx + bw + 1, ty);
    g.lineTo(bx + bw + 9, ty - 5);
    g.lineTo(bx + bw + 9, ty + 5);
    g.closePath();
    g.fill();
    g.font = '700 10px "Josefin Sans Variable", system-ui, sans-serif';
    g.fillStyle = 'rgba(60,50,110,0.8)';
    g.textAlign = 'left';
    g.fillText('drag', bx + bw + 11, ty + 3);
    // current tension marker
    const ky = y(f.T);
    const col = f.T > 1 ? '#ff4f6a' : f.T > SWEET[1] ? '#ffb02a' : f.T < SWEET[0] ? '#8d97c9' : '#2fbf8f';
    g.fillStyle = col;
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(bx - 4, ky - 6, bw + 8, 12, 6);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(60,50,110,0.9)';
    g.font = '700 13px "Fredoka Variable", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(`${Math.round(f.T * 100)}`, bx + bw / 2, 12);
    // trace over the last few seconds, to the right of the gauge
    const tr = m.trace;
    g.strokeStyle = 'rgba(70, 60, 130, 0.85)';
    g.lineWidth = 1.8;
    g.beginPath();
    const tx0 = bx + bw + 46;
    const tw = W - tx0 - 4;
    for (let i = 0; i < tr.length; i++) {
      const px = tx0 + (i / 240) * tw;
      const py = y(tr[i] as number);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 1;
    for (const lv of [SWEET[0], SWEET[1], 1]) {
      g.beginPath();
      g.moveTo(tx0, y(lv));
      g.lineTo(tx0 + tw, y(lv));
      g.stroke();
    }

    // direction: heading up, the stern cone below, the fish at its bearing and distance
    this.drawDirection(f, b.heading);

    // bars and read-outs
    const mood = f.mood;
    const moodEl = q('fmMood');
    this.setText('fmMood', MOOD_LABEL[mood]);
    moodEl.style.setProperty('--c', MOOD_COLOR[mood]);
    q('fmStam').style.setProperty('--v', clamp(f.stam, 0, 1).toFixed(3));
    q('fmLine').style.setProperty('--v', clamp(f.L / LINE_MAX, 0, 1).toFixed(3));
    q('fmLine').dataset.hi = f.L / LINE_MAX > 0.7 ? '1' : '0';
    this.setText('fmLineTxt', `${Math.round(f.L)} m`);
    q('fmCrew').style.setProperty('--v', clamp(1 - f.fatigue, 0, 1).toFixed(3));
    q('fmCrew').dataset.rest = f.resting > 0 ? '1' : '0';
    q('fmDrag').style.setProperty('--v', clamp(this.host.game.input.sheet, 0, 1).toFixed(3));
    const hint = q('fmHint');
    this.setText('fmHint', f.hint);
    hint.dataset.tone =
      f.snapMeter > 0.2 || f.chafe > 0.3 || f.slackMeter > 0.8 ? 'bad' : f.warning ? 'warn' : 'ok';
  }

  private drawDirection(f: NonNullable<FishMode['fight']>, heading: number): void {
    const g = this.dir;
    const W = 200;
    const cx = W / 2;
    const cy = 52;
    g.clearRect(0, 0, W, W);
    const R = (d: number) => 20 * Math.log2(1 + d / 9);
    // rings
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(70,60,130,0.6)';
    g.font = '700 9px "Josefin Sans Variable", system-ui, sans-serif';
    g.textAlign = 'left';
    for (const d of [10, 30, 80, 200]) {
      g.beginPath();
      g.arc(cx, cy, R(d), 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${d}`, cx + 3, cy + R(d) + 9);
    }
    // the stern cone (astern is down)
    const cone = (30 * Math.PI) / 180;
    g.fillStyle = 'rgba(95, 224, 176, 0.35)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R(300), Math.PI / 2 - cone, Math.PI / 2 + cone);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(47, 191, 143, 0.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(cone) * R(300), cy + Math.cos(cone) * R(300));
    g.moveTo(cx, cy);
    g.lineTo(cx - Math.sin(cone) * R(300), cy + Math.cos(cone) * R(300));
    g.stroke();
    // the boat
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(cx, cy - 18);
    g.quadraticCurveTo(cx + 10, cy - 4, cx + 7, cy + 8);
    g.lineTo(cx - 7, cy + 8);
    g.quadraticCurveTo(cx - 10, cy - 4, cx, cy - 18);
    g.closePath();
    g.fill();
    g.stroke();
    // the line and the fish
    const d = f.dist;
    const r = R(d);
    const fx = cx + Math.sin(f.theta) * r;
    const fy = cy + Math.cos(f.theta) * r;
    const taut = clamp(f.T / 0.6, 0, 1);
    g.strokeStyle = `rgba(80,70,150,${0.35 + taut * 0.6})`;
    g.lineWidth = 1 + taut * 2.4;
    g.setLineDash(f.T < 0.1 ? [3, 4] : []);
    g.beginPath();
    g.moveTo(cx, cy + 8);
    g.lineTo(fx, fy);
    g.stroke();
    g.setLineDash([]);
    // which way it is swimming, in the boat's frame
    const a = -heading;
    const sx = f.ux * Math.cos(a) - f.uz * Math.sin(a);
    const sz = f.ux * Math.sin(a) + f.uz * Math.cos(a);
    // boat frame: +x forward = up on the diagram, +z starboard = right
    const vx = sz;
    const vy = -sx;
    const sp = Math.hypot(vx, vy);
    g.strokeStyle = MOOD_COLOR[f.mood];
    g.lineWidth = 2.6;
    if (sp > 0.4) {
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + (vx / sp) * Math.min(26, sp * 5), fy + (vy / sp) * Math.min(26, sp * 5));
      g.stroke();
    }
    // the run it is about to make
    const w = f.warning;
    if (w && w.mood === 'run') {
      const wa = w.dir + a;
      const dx = Math.cos(wa);
      const dz = Math.sin(wa);
      const ax2 = dz;
      const ay2 = -dx;
      g.setLineDash([4, 3]);
      g.strokeStyle = '#ff4f7a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + ax2 * 38, fy + ay2 * 38);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#ff4f7a';
      g.beginPath();
      const ex = fx + ax2 * 38;
      const ey = fy + ay2 * 38;
      g.moveTo(ex, ey);
      g.lineTo(ex - ax2 * 8 + ay2 * 5, ey - ay2 * 8 - ax2 * 5);
      g.lineTo(ex - ax2 * 8 - ay2 * 5, ey - ay2 * 8 + ax2 * 5);
      g.fill();
    }
    g.fillStyle = MOOD_COLOR[f.mood];
    g.strokeStyle = '#fff';
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(fx, fy, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // wind and the tide's set, small, at the foot of the diagram
    const env = this.host.game.env;
    const cur = { x: 0, z: 0 };
    env.currentAt(f.x, f.z, cur);
    const arrow = (x: number, z: number, col: string, label: string, ox: number) => {
      const l = Math.hypot(x, z);
      if (l < 0.05) return;
      const bx = x * Math.cos(a) - z * Math.sin(a);
      const bz = x * Math.sin(a) + z * Math.cos(a);
      const ax3 = bz / l;
      const ay3 = -bx / l;
      const px = ox;
      const py = 186;
      g.strokeStyle = col;
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(px - ax3 * 9, py - ay3 * 9);
      g.lineTo(px + ax3 * 9, py + ay3 * 9);
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(px + ax3 * 12, py + ay3 * 12);
      g.lineTo(px + ax3 * 5 + ay3 * 4, py + ay3 * 5 - ax3 * 4);
      g.lineTo(px + ax3 * 5 - ay3 * 4, py + ay3 * 5 + ax3 * 4);
      g.fill();
      g.fillStyle = 'rgba(70,60,130,0.8)';
      g.textAlign = 'center';
      g.fillText(label, px, py + 12 - 24);
    };
    arrow(cur.x, cur.z, '#3fa6e6', 'tide', 28);
    const wnd = { x: 0, z: 0 };
    env.windAt(f.x, f.z, wnd);
    arrow(wnd.x, wnd.z, '#c9b6ff', 'wind', W - 28);
  }

  // ---- binoculars and sighting tags ------------------------------------------------------------------------

  private drawBinoculars(): void {
    const m = this.mode;
    const g = this.host.game;
    const bino = this.host.q('fmBino') as HTMLElement;
    bino.hidden = !m.binoculars;
    bino.classList.toggle('on', m.binoculars);
    if (!m.binoculars) return;
    const tags = this.host.q('fmTags') as HTMLElement;
    const cam = g.rw.camera;
    const w = innerWidth;
    const h = innerHeight;
    let n = 0;
    for (const s of m.seenNow) {
      const c = s.cue;
      if (c.kind === 'slick' && !m.binoculars) continue;
      this.v3.set(c.x, 6, c.z).project(cam);
      if (this.v3.z > 1 || this.v3.z < -1) continue;
      const px = (this.v3.x * 0.5 + 0.5) * w;
      const py = (-this.v3.y * 0.5 + 0.5) * h;
      if (px < 20 || px > w - 20 || py < 20 || py > h - 20) continue;
      let el = this.tagEls[n];
      if (!el) {
        el = document.createElement('div');
        el.className = 'fm-tag';
        tags.appendChild(el);
        this.tagEls[n] = el;
      }
      el.style.transform = `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px)`;
      el.dataset.k = c.kind;
      const label = c.kind === 'boil' ? 'Boils' : c.kind === 'birds' ? 'Birds' : 'Slick';
      const txt = `${label} · ${(s.dist / 1852).toFixed(1)} nm`;
      if (el.textContent !== txt) el.textContent = txt;
      el.hidden = false;
      n++;
    }
    for (let i = n; i < this.tagEls.length; i++) (this.tagEls[i] as HTMLElement).hidden = true;
  }

  // ---- results ---------------------------------------------------------------------------------------------

  resultStats(r: ResultState): string {
    const f = r.fish;
    if (!f) return '';
    return `
      <div class="grid">
        <div><span class="label">Catch</span><b class="num">${f.landed ? `${f.kg} kg` : '—'}</b></div>
        <div><span class="label">Species</span><b class="num">${f.landed ? f.species : '—'}</b></div>
        <div><span class="label">Fight</span><b class="num">${f.landed ? fmtTime(f.fightS).slice(0, -2) : '—'}</b></div>
        <div><span class="label">Clean fight</span><b class="num">${f.landed ? `${f.cleanPct}%` : '—'}</b></div>
        <div><span class="label">Strikes</span><b class="num">${f.strikes}</b></div>
        <div><span class="label">Lost</span><b class="num">${f.lost}</b></div>
        <div><span class="label">Daylight used</span><b class="num">${fmtTime(r.time).slice(0, -2)}</b></div>
        <div><span class="label">Hull left</span><b class="num">${r.hullPct}%</b></div>
      </div>`;
  }

  resultHtml(r: ResultState): string {
    const f = r.fish;
    if (!f) return '';
    if (f.landed) {
      return `<div class="gates">${f.parts
        .map(
          (p) =>
            `<div><span>${p.label}</span><span class="${p.pts >= 0 ? 'ok' : 'miss'}">${p.pts >= 0 ? '+' : ''}${p.pts}</span></div>`,
        )
        .join('')}</div>`;
    }
    return f.reason ? `<div class="dockline">${f.reason}</div>` : '';
  }
}
