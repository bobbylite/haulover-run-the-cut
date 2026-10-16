// Persistent settings and best scores (localStorage, tolerant of private mode).

import type { Quality } from '../render/renderWorld';
import type { GameId } from './mode';
import type { GameConfig } from './state';

export interface Settings {
  quality: Quality;
  master: number;
  music: boolean;
  sfx: boolean;
  hud: boolean;
  /** Haulover's last setup (the original single-game key, kept so existing saves carry over). */
  last?: Partial<GameConfig>;
  /** The last setup of every other game. */
  lastBy?: Partial<Record<GameId, Partial<GameConfig>>>;
}

const KEY = 'haulover-run:v1';
const BEST = 'haulover-run:best:v1';

/** Phones and tablets start lighter; the adaptive-resolution governor handles the rest. */
const defaultQuality = (): Quality => {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!coarse) return 'high';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return mem <= 4 ? 'low' : 'medium';
};

const defaults = (): Settings => ({
  quality: defaultQuality(),
  master: 0.8,
  music: true,
  sfx: true,
  hud: true,
});

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings(): Settings {
  const s = read(KEY, defaults());
  // honour ?quality=low|medium|high
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') s.quality = q;
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** The remembered setup for a game (Haulover uses the original key). */
export function lastConfig(s: Settings, game: GameId): Partial<GameConfig> {
  return (game === 'haulover' ? s.last : s.lastBy?.[game]) ?? {};
}

export function rememberConfig(s: Settings, game: GameId, c: GameConfig): void {
  if (game === 'haulover') s.last = { ...c };
  else s.lastBy = { ...s.lastBy, [game]: { ...c } };
}

/** Best-score key. Haulover keeps its original key shape so existing bests survive the multi-game split. */
export const bestKey = (game: GameId, c: GameConfig): string => {
  const k = `${c.boat}|${c.weather}|${c.tide}|${c.difficulty}|${c.route}`;
  return game === 'haulover' ? k : `${game}:${k}`;
};

export function loadBest(game: GameId, c: GameConfig): number {
  const all = read<Record<string, number>>(BEST, {});
  return all[bestKey(game, c)] ?? 0;
}

export function saveBest(game: GameId, c: GameConfig, score: number): void {
  const all = read<Record<string, number>>(BEST, {});
  all[bestKey(game, c)] = score;
  try {
    localStorage.setItem(BEST, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
