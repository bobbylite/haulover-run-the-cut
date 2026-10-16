// The multi-game shell: which game a URL asks for, the registry, and per-game saves that leave
// Haulover's existing saved data untouched.
import { describe, expect, it } from 'vitest';
import { bestKey, lastConfig, rememberConfig, type Settings } from '../src/game/settings';
import type { GameConfig } from '../src/game/state';
import { GAMES, gameById, pickGame } from '../src/games/registry';

const q = (s: string) => new URLSearchParams(s);
const cfg: GameConfig = {
  boat: 'console',
  weather: 'breeze',
  tide: 'ebb',
  difficulty: 'weekender',
  route: 'full',
  level: '',
};
const blank = (): Settings => ({ quality: 'high', master: 0.8, music: true, sfx: true, hud: true });

describe('which game a URL asks for', () => {
  it('a bare URL shows the title screen', () => {
    expect(pickGame(q(''))).toBeNull();
  });

  it('?game= picks a game by name', () => {
    expect(pickGame(q('game=haulover'))?.id).toBe('haulover');
    expect(pickGame(q('game=montauk&boat=sloop'))?.id).toBe('montauk');
  });

  it('every original launch parameter still means Haulover, so old links and tools keep working', () => {
    for (const p of [
      'boat=sloop',
      'weather=squall',
      'tide=flood',
      'difficulty=legend',
      'route=inbound',
      'auto',
      'auto&go',
      'noui',
      'cam=1,2,3,4,5,6',
      'cruiser=1&wakedebug',
    ])
      expect(pickGame(q(p))?.id, p).toBe('haulover');
    expect(pickGame(q('boat=console&weather=breeze&quality=low&noui'))?.id).toBe('haulover');
  });

  it('global switches alone do not launch a game, and an unknown name falls back to the title', () => {
    expect(pickGame(q('quality=low'))).toBeNull();
    expect(pickGame(q('webgl'))).toBeNull();
    expect(pickGame(q('debug'))).toBeNull();
    expect(pickGame(q('game=nowhere'))).toBeNull();
  });
});

describe('the registry', () => {
  it('lists the three games, all playable now', () => {
    expect(GAMES.map((g) => g.id)).toEqual(['haulover', 'montauk', 'nantucket']);
    for (const g of GAMES) expect(g.status, g.id).toBe('ready');
    expect(gameById('nope')).toBeUndefined();
  });

  it('every game loads its definition lazily, and ids agree with the registry', async () => {
    for (const g of GAMES) {
      const def = await g.load();
      expect(def.id).toBe(g.id);
      expect(def.location.id).toBe(g.id);
    }
  });
});

describe('per-game saves', () => {
  it("keeps Haulover's original best-score key, so existing bests survive the split", () => {
    expect(bestKey('haulover', cfg)).toBe('console|breeze|ebb|weekender|full');
  });

  it('keeps other games separate from it', () => {
    // a berth-based game keys its bests by challenge, not by route
    expect(bestKey('nantucket', { ...cfg, level: 'tiki-slip' })).toBe(
      'nantucket:console|breeze|ebb|weekender|tiki-slip',
    );
    expect(bestKey('nantucket', { ...cfg, level: 'liner-east' })).not.toBe(
      bestKey('nantucket', { ...cfg, level: 'tiki-slip' }),
    );
    expect(bestKey('montauk', cfg)).not.toBe(bestKey('nantucket', cfg));
    expect(bestKey('montauk', cfg)).not.toBe(bestKey('haulover', cfg));
  });

  it("remembers each game's last setup separately; Haulover keeps the original field", () => {
    const s = blank();
    rememberConfig(s, 'haulover', { ...cfg, boat: 'gofast' });
    rememberConfig(s, 'nantucket', { ...cfg, boat: 'cruiser', weather: 'dawn' });
    expect(s.last?.boat).toBe('gofast');
    expect(lastConfig(s, 'haulover').boat).toBe('gofast');
    expect(lastConfig(s, 'nantucket').boat).toBe('cruiser');
    expect(lastConfig(s, 'nantucket').weather).toBe('dawn');
    expect(lastConfig(s, 'montauk')).toEqual({});
    // an old save with only `last` still reads back
    expect(lastConfig({ ...blank(), last: { boat: 'sloop' } }, 'haulover').boat).toBe('sloop');
  });
});
