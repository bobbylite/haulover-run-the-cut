// The games on offer. Each one is loaded on demand (its own chunk) so the title screen and the first
// paint never pay for a location they did not pick. `status: 'soon'` games show on the title screen but
// cannot be started yet; see docs/ROADMAP.md for what is planned.

import type { GameId, ModeDef } from '../game/mode';

export interface GameEntry {
  id: GameId;
  title: string;
  place: string;
  tagline: string;
  status: 'ready' | 'soon';
  load(): Promise<ModeDef>;
}

const notYet = (name: string) => () => Promise.reject(new Error(`${name} is not built yet`));

export const GAMES: readonly GameEntry[] = [
  {
    id: 'haulover',
    title: 'Haulover',
    place: 'Haulover Inlet · Miami',
    tagline: 'Thread the jetties, take the sea, round the buoy and dock in the marina.',
    status: 'ready',
    load: async () => (await import('./haulover/mode')).HAULOVER_GAME,
  },
  {
    id: 'montauk',
    title: 'Montauk',
    place: 'Montauk Point · New York',
    tagline: 'Find the bait. Hook the tuna. Keep the line tight while the crew reels.',
    status: 'ready',
    load: async () => (await import('./montauk/mode')).MONTAUK_GAME,
  },
  {
    id: 'nantucket',
    title: 'Nantucket',
    place: 'Nantucket Harbor · Massachusetts',
    tagline: 'Pick a vessel and a berth, and park it. Cruise ships are the hardest.',
    status: 'soon',
    load: notYet('Nantucket'),
  },
];

export const gameById = (id: string | null | undefined): GameEntry | undefined =>
  GAMES.find((g) => g.id === id);

/**
 * Which game a URL asks for. `?game=` wins. Otherwise any of the original launch parameters means
 * Haulover (so every existing link, screenshot tool and test script keeps working); a bare URL means
 * "show the title screen".
 */
const LEGACY_LAUNCH = [
  'boat',
  'weather',
  'tide',
  'difficulty',
  'route',
  'auto',
  'go',
  'noui',
  'cam',
  'wakedebug',
  'cruise',
];

export function pickGame(q: URLSearchParams): GameEntry | null {
  const named = gameById(q.get('game'));
  if (named) return named;
  if (LEGACY_LAUNCH.some((k) => q.has(k))) return gameById('haulover') ?? null;
  return null;
}
