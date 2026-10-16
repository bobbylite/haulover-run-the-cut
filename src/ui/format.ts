// Small formatters shared by the shell and every mode's UI.

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

/** Compass point for a bearing in degrees. */
export const cardinal = (deg: number): string =>
  CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] as string;

export const ft = (m: number): string => `${Math.round(m * 3.281)} ft`;

/** m:ss.s */
export const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
