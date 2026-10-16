// The menu sections every game shares: vessel, conditions (weather), tide and difficulty. A mode's menu
// composes these with whatever is its own (Haulover adds the route). The markup carries fixed ids, so
// only one mode's menu exists per page.

import { KNOTS } from '../core/math';
import { ALL_BOATS, BOATS } from '../data/boats';
import { DIFFICULTIES, type Difficulty, difficultyById } from '../data/difficulty';
import { weatherById, weatherFor } from '../data/weather';
import type { ModeUiHost } from '../game/mode';
import type { GameConfig } from '../game/state';
import { type BoatSpec, SKILL_LABELS } from '../sim/boatSpec';
import { cardinal, ft } from './format';
import { boatIcon, weatherIcon } from './icons';

export const vesselSection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Vessel</span><span class="hint">← → to browse</span></div>
      <div class="boats" id="boats" role="radiogroup" aria-label="Vessel"></div>
      <div class="boat-card" id="boatCard"></div>
    </div>`;

export const conditionsSection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Conditions</span><span class="hint" id="wxDanger"></span></div>
      <div class="weather" id="weather" role="radiogroup" aria-label="Weather"></div>
      <p class="wx-blurb" id="wxBlurb"></p>
    </div>`;

export const tideSection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Tide</span><span class="hint" id="tideHint"></span></div>
      <div class="seg" id="tide" role="radiogroup" aria-label="Tide"></div>
    </div>`;

export const difficultySection = (): string => `
    <div class="sec">
      <div class="head"><span class="label">Difficulty</span><span class="hint" id="diffHint"></span></div>
      <div class="seg" id="diff" role="radiogroup" aria-label="Difficulty"></div>
    </div>`;

/** A segmented radio control that writes one config key when pressed. */
export function mountSeg(
  host: ModeUiHost,
  id: string,
  items: [string, string, string?][],
  key: keyof GameConfig,
  onChange: () => void,
): void {
  const seg = host.q(id);
  if (!seg) return;
  seg.innerHTML = items
    .map(
      ([v, label, sub]) =>
        `<button data-v="${v}" role="radio" aria-pressed="false">${label}${sub ? `<small>${sub}</small>` : ''}</button>`,
    )
    .join('');
  seg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]');
    if (!b) return;
    host.game.setConfig({ [key]: b.dataset.v } as Partial<GameConfig>);
    onChange();
  });
}

/** Mark the button whose data attribute equals `val` as pressed. */
export function press(hostEl: HTMLElement | undefined, attr: 'id' | 'v', val: string): void {
  if (!hostEl) return;
  for (const b of hostEl.querySelectorAll<HTMLElement>('button')) {
    b.setAttribute('aria-pressed', String(b.dataset[attr] === val));
  }
}

type SegItem = [string, string, string?];

/** What a game may change about the shared sections: which tides and which difficulty names it offers. */
export interface SharedMenuOptions {
  tides?: SegItem[];
  difficulties?: SegItem[];
  /** The vessels the picker offers (default: the small boats). */
  vessels?: readonly BoatSpec[];
  /** The game's own difficulty table, where it has one. */
  diffOf?: (id: string) => Difficulty;
}

const TIDES: SegItem[] = [
  ['ebb', 'Ebb', 'going out'],
  ['slack', 'Slack', 'calm'],
  ['flood', 'Flood', 'coming in'],
];

/** Builds and keeps in sync the shared sections. */
export class SharedMenu {
  constructor(
    private readonly host: ModeUiHost,
    private readonly onChange: () => void,
    private readonly opts: SharedMenuOptions = {},
  ) {}

  build(): void {
    const { host } = this;
    const g = host.game;
    const boats = host.q('boats');
    if (boats) {
      boats.innerHTML = (this.opts.vessels ?? BOATS)
        .map(
          (b) =>
            `<button data-id="${b.id}" role="radio" aria-pressed="false" title="${b.name}">${boatIcon(b.id)}<span>${b.short}</span></button>`,
        )
        .join('');
      boats.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
        if (!b) return;
        g.setConfig({ boat: b.dataset.id as GameConfig['boat'] });
        this.onChange();
      });
    }
    const wx = host.q('weather');
    if (wx) {
      wx.innerHTML = weatherFor(g.mode.id)
        .map(
          (w) =>
            `<button data-id="${w.id}" role="radio" aria-pressed="false">${weatherIcon(w.icon)}<span>${w.name}</span><span class="dots">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= w.danger ? 'on' : ''}"></i>`).join('')}</span></button>`,
        )
        .join('');
      wx.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
        if (!b) return;
        g.setConfig({ weather: b.dataset.id as string });
        this.onChange();
      });
    }
    mountSeg(host, 'tide', this.opts.tides ?? TIDES, 'tide', this.onChange);
    mountSeg(
      host,
      'diff',
      this.opts.difficulties ??
        DIFFICULTIES.map((d) => [d.id, d.name.replace('Haulover ', '')] as [string, string]),
      'difficulty',
      this.onChange,
    );
  }

  cycleVessel(d: number): void {
    const g = this.host.game;
    const list = this.opts.vessels ?? BOATS;
    const i = list.findIndex((b) => b.id === g.cfg.boat);
    const n = list[(i + d + list.length) % list.length];
    if (!n) return;
    g.setConfig({ boat: n.id });
    this.onChange();
  }

  /** Re-read the config into the sections, the boat card and the conditions strip. */
  sync(): void {
    const { host } = this;
    const c = host.game.cfg;
    press(host.q('boats'), 'id', c.boat);
    press(host.q('weather'), 'id', c.weather);
    press(host.q('tide'), 'v', c.tide);
    press(host.q('diff'), 'v', c.difficulty);

    const spec = ALL_BOATS.find((b) => b.id === c.boat);
    if (!spec) return;
    const diff = (this.opts.diffOf ?? difficultyById)(c.difficulty);
    const w = weatherById(c.weather);
    const bar = (v: number, fill: string) =>
      `<div class="bar" style="--v:${v}; --fill:${fill}"><i></i></div>`;
    const stat = (label: string, v: number, fill: string) => `<span>${label}</span>${bar(v, fill)}`;
    const set = (id: string, html: string, asText = false) => {
      const el = host.q(id);
      if (!el) return;
      if (asText) el.textContent = html;
      else el.innerHTML = html;
    };
    set(
      'boatCard',
      `
      <div class="tagline"><span>${spec.tagline}</span><span class="skill-chip" data-level="${spec.skill}" title="How hard this boat is to drive well">${'★'.repeat(spec.skill)}${'☆'.repeat(5 - spec.skill)} <b>${SKILL_LABELS[spec.skill]}</b></span></div>
      <h2>${spec.name}</h2>
      <p>${spec.blurb}</p>
      <div class="stats">
        ${stat('Speed', spec.stats.speed, 'linear-gradient(90deg,var(--mint),var(--aqua))')}
        ${stat('Handling', spec.stats.handling, 'linear-gradient(90deg,var(--sky),var(--lavender))')}
        ${stat('Stability', spec.stats.stability, 'linear-gradient(90deg,var(--sun),var(--peach))')}
        ${stat('Dryness', spec.stats.dryness, 'linear-gradient(90deg,var(--aqua),var(--mint))')}
        ${stat('Windage', spec.stats.windage, 'linear-gradient(90deg,var(--peach),var(--coral))')}
        ${stat('Tide', spec.stats.tide, 'linear-gradient(90deg,var(--sky),var(--aqua))')}
      </div>
      <div class="specs"><span><b>${spec.length.toFixed(1)} m</b> / ${ft(spec.length)}</span><span>top <b>${Math.round(spec.topSpeed * KNOTS)} kn</b></span><span>draft <b>${spec.keelDepth.toFixed(1)} m</b></span>${spec.sail ? '<span><b>sail + motor</b></span>' : ''}${spec.thrusters ? '<span><b>thrusters</b></span>' : ''}</div>`,
    );
    set('wxBlurb', w.blurb, true);
    set('wxDanger', `${'●'.repeat(w.danger)}${'○'.repeat(5 - w.danger)}`, true);
    set(
      'tideHint',
      c.tide === 'ebb' ? 'strong set to the sea' : c.tide === 'flood' ? 'pushing you in' : 'barely moving',
      true,
    );
    set('diffHint', `bilge: ${Math.round(spec.capacity * diff.capacity)} L`, true);

    const wspeed = w.windSpeed * KNOTS;
    set(
      'strip',
      `
      <div class="c"><span class="label">Wind</span><b class="num">${Math.round(wspeed)} kn</b><span class="label">${cardinal(w.windFrom)}</span></div>
      <div class="c"><span class="label">Swell</span><b class="num">${(w.swellHeight * 3.28).toFixed(0)} ft</b><span class="label">${cardinal(w.swellFrom)}</span></div>
      <div class="c"><span class="label">Current</span><b class="num">${c.tide === 'slack' ? '0.2' : c.tide === 'ebb' ? (2.7 * KNOTS * diff.currentScale).toFixed(1) : (2.3 * KNOTS * diff.currentScale).toFixed(1)} kn</b><span class="label">${c.tide === 'flood' ? 'inbound' : c.tide === 'ebb' ? 'outbound' : 'slack'}</span></div>`,
    );
  }
}
