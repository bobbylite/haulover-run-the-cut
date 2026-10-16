// The title screen: pick a game. Plain DOM, no renderer, so it appears instantly and costs nothing.

import { GAMES, type GameEntry } from '../games/registry';
import { boatIcon } from '../ui/icons';

const fishIcon = (): string =>
  `<svg viewBox="0 0 64 34" fill="none"><path d="M2 31c4-3 8 0 12-2s8 0 12-2 8 0 12-2 8 0 12-2 8 0 10-1" stroke="#7fd9e0" stroke-width="2" stroke-linecap="round" fill="none" opacity=".9"/><path d="M8 16c8-9 24-9 34 0-10 9-26 9-34 0Z" fill="currentColor"/><path d="M42 16l14-8v16Z" fill="currentColor"/><circle cx="16" cy="14" r="1.8" fill="#fff"/><path d="M26 11c2 3 2 7 0 10" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></svg>`;

const art = (id: string): string =>
  id === 'haulover' ? boatIcon('gofast') : id === 'montauk' ? fishIcon() : boatIcon('cruiser');

/** Show the title screen and resolve with the game the player picks. */
export function showTitle(parent: HTMLElement = document.body): Promise<GameEntry> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'title-screen';
    el.innerHTML = `
      <div class="title-inner">
        <div class="logo title-logo">RUN THE CUT</div>
        <div class="title-sub">three harbours · three ways to test a captain</div>
        <div class="title-cards" role="list">
          ${GAMES.map(
            (g, i) => `
          <button class="title-card glass" role="listitem" data-id="${g.id}" ${g.status === 'soon' ? 'aria-disabled="true"' : ''} style="--i:${i}">
            <div class="art">${art(g.id)}</div>
            <div class="place">${g.place}</div>
            <h2>${g.title}</h2>
            <p>${g.tagline}</p>
            <span class="cta ${g.status}">${g.status === 'ready' ? 'Play' : 'Coming soon'}</span>
          </button>`,
          ).join('')}
        </div>
      </div>`;
    parent.appendChild(el);
    const pick = (g: GameEntry) => {
      if (g.status !== 'ready') return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 380);
      resolve(g);
    };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-id]');
      const g = GAMES.find((x) => x.id === b?.dataset.id);
      if (g) pick(g);
    });
    addEventListener(
      'keydown',
      (e) => {
        const n = Number(e.key);
        const g = GAMES[n - 1];
        if (g && n >= 1) pick(g);
        if (e.code === 'Enter') pick(GAMES.find((x) => x.status === 'ready') as GameEntry);
      },
      { passive: true },
    );
    (el.querySelector('button:not([aria-disabled])') as HTMLElement | null)?.focus();
  });
}
