// Hand-drawn SVG icons (currentColor + pastel accents).

export const weatherIcon = (id: string): string => {
  switch (id) {
    case 'sunset':
      return `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="18" r="7" fill="#ffb36b"/><path d="M2 22h28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 26h20M10 29.5h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".55"/><path d="M16 4v4M5.5 9.5l2.8 2.8M26.5 9.5l-2.8 2.8M2 18h3M27 18h3" stroke="#ff8f7a" stroke-width="2" stroke-linecap="round"/><rect x="0" y="19.6" width="32" height="4" fill="#fff" opacity=".0"/></svg>`;
    case 'sun':
      return `<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="6.5" fill="#ffd45e"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8" stroke="#ffb347" stroke-width="2.2" stroke-linecap="round"/></svg>`;
    case 'mist':
      return `<svg viewBox="0 0 32 32" fill="none"><circle cx="21" cy="10" r="5" fill="#ffc7b0"/><path d="M4 17h24M7 22h20M4 27h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".7"/><path d="M9 14h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".4"/></svg>`;
    case 'storm':
      return `<svg viewBox="0 0 32 32" fill="none"><path d="M9 20a5.5 5.5 0 0 1 .8-10.9A7 7 0 0 1 23 10.5 4.7 4.7 0 0 1 23 20H9Z" fill="#9aa5c8"/><path d="M17.5 17l-4 7h3.5l-1.8 6 6.3-8.5h-3.8l2-4.5Z" fill="#ffd45e" stroke="#ffb347" stroke-width=".8" stroke-linejoin="round"/><path d="M8 25l-1.6 3M23 24.5l-1.6 3" stroke="#7fb4ff" stroke-width="2" stroke-linecap="round"/></svg>`;
    case 'wind':
      return `<svg viewBox="0 0 32 32" fill="none"><path d="M3 11h15a3.5 3.5 0 1 0-3.5-3.5M3 17h22a3.5 3.5 0 1 1-3.5 3.5M3 23h10a3 3 0 1 1-3 3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M26 9l2 2-2 2" stroke="#7fd9e0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".0"/></svg>`;
    case 'moon':
      return `<svg viewBox="0 0 32 32" fill="none"><path d="M21 5a11 11 0 1 0 6 20 9 9 0 0 1-6-20Z" fill="#cdd7ff"/><circle cx="25.5" cy="8" r="1.4" fill="#fff"/><circle cx="29" cy="14" r="1" fill="#fff"/><circle cx="20" cy="4" r=".9" fill="#fff"/></svg>`;
    default:
      return '';
  }
};

/** Boat silhouettes, 64x34. */
export const boatIcon = (id: string): string => {
  const wave = `<path d="M2 31c4-3 8 0 12-2s8 0 12-2 8 0 12-2 8 0 12-2 8 0 10-1" stroke="#7fd9e0" stroke-width="2" stroke-linecap="round" fill="none" opacity=".9"/>`;
  switch (id) {
    case 'console':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<path d="M6 21h46l7-5-3 9c-1 3-3 4-6 4H14c-4 0-7-3-8-8Z" fill="currentColor"/><path d="M20 21V9M42 21V9" stroke="currentColor" stroke-width="2"/><rect x="16" y="6" width="30" height="3.5" rx="1.7" fill="#6fe6cc"/><rect x="29" y="12" width="7" height="9" rx="2" fill="currentColor"/><rect x="3" y="14" width="5" height="10" rx="2" fill="#2b3341"/></svg>`;
    case 'gofast':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<path d="M3 23l34-3 24-5-2 6c-1 4-4 6-8 6H8c-3 0-5-2-5-4Z" fill="currentColor"/><path d="M30 20l9-8 4 1-5 8Z" fill="#9fe7ee"/><path d="M12 22h46" stroke="#ff86b4" stroke-width="2" stroke-linecap="round"/><rect x="2" y="14" width="4" height="9" rx="2" fill="#2b3341"/></svg>`;
    case 'cruiser':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<path d="M3 21h54l5-4-3 9c-1 3-3 4-6 4H10c-4 0-6-3-7-9Z" fill="currentColor"/><rect x="14" y="11" width="30" height="10" rx="4" fill="currentColor"/><rect x="20" y="4" width="18" height="8" rx="3" fill="currentColor"/><rect x="19" y="2" width="22" height="2.6" rx="1.3" fill="#ffb497"/><rect x="18" y="14" width="22" height="4" rx="2" fill="#7fb9d6"/></svg>`;
    case 'charter':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<path d="M2 23c16 1 32 0 46-3l14-8-3 14c-1 3-3 4-6 4H9c-4 0-6-3-7-7Z" fill="currentColor"/><rect x="14" y="14" width="26" height="9" rx="3" fill="currentColor"/><rect x="19" y="8" width="16" height="6.5" rx="2.5" fill="currentColor"/><path d="M22 8V3M32 8V3M21 3h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M24 8L8 1M30 8l20-7" stroke="#98aef0" stroke-width="1.4" stroke-linecap="round"/><rect x="18" y="16.5" width="19" height="3.4" rx="1.7" fill="#7fb9d6"/><path d="M4 23.5h56" stroke="#98aef0" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="17" width="9" height="2.4" rx="1.2" fill="#ffb497"/></svg>`;
    case 'sloop':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<path d="M8 25h46l-6 6H14Z" fill="currentColor"/><path d="M30 2v22" stroke="currentColor" stroke-width="1.8"/><path d="M30 4l-15 19h15Z" fill="#fff6e6" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M32 6l13 17H32Z" fill="#fff6e6" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 26h40" stroke="#ff8f7a" stroke-width="2"/></svg>`;
    case 'pontoon':
      return `<svg viewBox="0 0 64 34" fill="none">${wave}<rect x="4" y="24" width="54" height="5" rx="2.5" fill="#70e5e0"/><rect x="6" y="20" width="50" height="4" rx="1" fill="currentColor"/><path d="M12 20V13M52 20V13M12 13h40" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M24 11l8-9 8 9Z" fill="#c99a55"/><path d="M26 11v9M38 11v9" stroke="#d9b57a" stroke-width="2"/></svg>`;
    default:
      return '';
  }
};

export const starIcon = (): string =>
  `<svg viewBox="0 0 32 32"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffb347"/></linearGradient></defs><path d="M16 2.8l3.9 8.1 8.9 1.2-6.5 6.2 1.6 8.8L16 22.7l-7.9 4.4 1.6-8.8L3.2 12l8.9-1.2Z" fill="url(#sg)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export const dropIcon = (): string =>
  `<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.5C5.5 5 3.5 7.2 3.5 9.6a4.5 4.5 0 0 0 9 0C12.5 7.2 10.5 5 8 1.5Z" fill="currentColor"/></svg>`;
