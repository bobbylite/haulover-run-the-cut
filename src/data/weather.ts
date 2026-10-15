// Weather presets: art direction (sun, sky, haze, water tints, grading) + physical sea state.
// Compass bearings: 0 = N, 90 = E, 180 = S, 270 = W. "from" = where it comes from.

export interface WeatherPreset {
  id: string;
  name: string;
  blurb: string;
  icon: 'sunset' | 'sun' | 'mist' | 'storm' | 'wind' | 'moon';
  danger: 1 | 2 | 3 | 4 | 5;

  // sun / moon
  sunAzimuth: number;
  sunElevation: number;
  sunColor: string;
  sunIntensity: number;
  night?: boolean;

  // sky
  skyHorizon: string;
  skyMid: string;
  skyZenith: string;
  cloudCover: number; // 0 clear .. 1 overcast
  cloudStorm: number; // 0 white .. 1 charcoal
  cloudLit: string;
  cloudShade: string;
  haze: number; // exponential fog density (1/m)
  hazeColor: string;

  // water
  waterDeep: string;
  waterShallow: string;
  waterGlow: string;
  foam: number; // foam eagerness 0..1.5

  // sea state
  windSpeed: number; // m/s
  windFrom: number;
  gust: number;
  swellHeight: number;
  swellFrom: number;
  swellLength: number;
  chopHeight: number;
  rain: number;
  lightning: number;

  // grading
  exposure: number;
  saturation: number;
  contrast: number;
  bloom: number;
  vignette: number;
  warmth: number; // +warm / -cool split tone
}

export const WEATHER: readonly WeatherPreset[] = [
  {
    id: 'golden',
    name: 'Golden Hour',
    blurb: 'Peach skies, glassy bay, long glittering path to the sunset.',
    icon: 'sunset',
    danger: 1,
    sunAzimuth: 262,
    sunElevation: 9,
    sunColor: '#ffb98a',
    sunIntensity: 3.1,
    skyHorizon: '#ffd2b4',
    skyMid: '#ffa9b8',
    skyZenith: '#7c8fe0',
    cloudCover: 0.5,
    cloudStorm: 0,
    cloudLit: '#ffd1b0',
    cloudShade: '#b78fc6',
    haze: 0.00021,
    hazeColor: '#ffcfb8',
    waterDeep: '#1f6fae',
    waterShallow: '#62e6d2',
    waterGlow: '#8ff7d9',
    foam: 0.7,
    windSpeed: 3.8,
    windFrom: 112,
    gust: 0.22,
    swellHeight: 0.5,
    swellFrom: 95,
    swellLength: 1.0,
    chopHeight: 0.16,
    rain: 0,
    lightning: 0,
    exposure: 1.0,
    saturation: 1.12,
    contrast: 1.04,
    bloom: 0.5,
    vignette: 0.34,
    warmth: 0.45,
  },
  {
    id: 'breeze',
    name: 'Sea Breeze',
    blurb: 'Classic Miami afternoon. Bright turquoise, steady easterly, puffy clouds.',
    icon: 'sun',
    danger: 2,
    sunAzimuth: 168,
    sunElevation: 58,
    sunColor: '#fff0d8',
    sunIntensity: 3.6,
    skyHorizon: '#d9eeff',
    skyMid: '#97cdfb',
    skyZenith: '#4d9bf0',
    cloudCover: 0.55,
    cloudStorm: 0,
    cloudLit: '#ffffff',
    cloudShade: '#a9bfe0',
    haze: 0.00017,
    hazeColor: '#cfe6fb',
    waterDeep: '#0d5ea5',
    waterShallow: '#4fe0cf',
    waterGlow: '#7ff5d8',
    foam: 1.0,
    windSpeed: 8.2,
    windFrom: 82,
    gust: 0.3,
    swellHeight: 1.05,
    swellFrom: 88,
    swellLength: 1.0,
    chopHeight: 0.62,
    rain: 0,
    lightning: 0,
    exposure: 1.02,
    saturation: 1.1,
    contrast: 1.05,
    bloom: 0.35,
    vignette: 0.26,
    warmth: 0.1,
  },
  {
    id: 'dawn',
    name: 'Misty Dawn',
    blurb: 'Lilac fog rolls off the bay as the sun climbs out of the Atlantic.',
    icon: 'mist',
    danger: 2,
    sunAzimuth: 96,
    sunElevation: 6,
    sunColor: '#ffb394',
    sunIntensity: 2.7,
    skyHorizon: '#ffdcd2',
    skyMid: '#eeb0cf',
    skyZenith: '#8496e4',
    cloudCover: 0.35,
    cloudStorm: 0,
    cloudLit: '#ffd9cc',
    cloudShade: '#b9a0d4',
    haze: 0.0018,
    hazeColor: '#e9bfd8',
    waterDeep: '#2b74b0',
    waterShallow: '#79e6d7',
    waterGlow: '#a9f4e6',
    foam: 0.6,
    windSpeed: 4.8,
    windFrom: 62,
    gust: 0.2,
    swellHeight: 0.8,
    swellFrom: 82,
    swellLength: 1.1,
    chopHeight: 0.24,
    rain: 0,
    lightning: 0,
    exposure: 1.04,
    saturation: 1.05,
    contrast: 1.03,
    bloom: 0.5,
    vignette: 0.4,
    warmth: 0.35,
  },
  {
    id: 'squall',
    name: 'Tropical Squall',
    blurb: 'Charcoal cells, sideways rain and forked lightning over the Cut.',
    icon: 'storm',
    danger: 4,
    sunAzimuth: 205,
    sunElevation: 38,
    sunColor: '#dfe6ff',
    sunIntensity: 0.9,
    skyHorizon: '#a7b4c8',
    skyMid: '#6a7699',
    skyZenith: '#3a4468',
    cloudCover: 0.97,
    cloudStorm: 0.85,
    cloudLit: '#aeb8d2',
    cloudShade: '#39415f',
    haze: 0.00085,
    hazeColor: '#8d9bb4',
    waterDeep: '#143f66',
    waterShallow: '#37939a',
    waterGlow: '#58aeb0',
    foam: 1.3,
    windSpeed: 12.0,
    windFrom: 100,
    gust: 0.5,
    swellHeight: 1.6,
    swellFrom: 94,
    swellLength: 0.95,
    chopHeight: 1.0,
    rain: 0.8,
    lightning: 0.7,
    exposure: 1.0,
    saturation: 1.0,
    contrast: 1.08,
    bloom: 0.4,
    vignette: 0.5,
    warmth: -0.2,
  },
  {
    id: 'noreaster',
    name: "Nor'easter",
    blurb: 'Lavender-gray gale, long breaking swell stacked on the ebb. Experts only.',
    icon: 'wind',
    danger: 5,
    sunAzimuth: 128,
    sunElevation: 24,
    sunColor: '#e7e2f2',
    sunIntensity: 1.3,
    skyHorizon: '#cfd6e4',
    skyMid: '#9ba7c1',
    skyZenith: '#6d7a9d',
    cloudCover: 1,
    cloudStorm: 0.5,
    cloudLit: '#d6dcea',
    cloudShade: '#707c9c',
    haze: 0.00062,
    hazeColor: '#b9c4d8',
    waterDeep: '#184a74',
    waterShallow: '#47a2ab',
    waterGlow: '#74bfc0',
    foam: 1.5,
    windSpeed: 15.5,
    windFrom: 48,
    gust: 0.38,
    swellHeight: 2.7,
    swellFrom: 72,
    swellLength: 1.25,
    chopHeight: 1.25,
    rain: 0.35,
    lightning: 0,
    exposure: 0.98,
    saturation: 0.92,
    contrast: 1.07,
    bloom: 0.3,
    vignette: 0.45,
    warmth: -0.1,
  },
  {
    id: 'moon',
    name: 'Moonlit Run',
    blurb: 'Silver moon, starlit sky, glowing condo towers and running lights.',
    icon: 'moon',
    danger: 3,
    sunAzimuth: 108,
    sunElevation: 42,
    sunColor: '#a9c4ff',
    sunIntensity: 0.85,
    night: true,
    skyHorizon: '#3a4f93',
    skyMid: '#1f2d68',
    skyZenith: '#0b1238',
    cloudCover: 0.3,
    cloudStorm: 0.2,
    cloudLit: '#7d95d6',
    cloudShade: '#1c2552',
    haze: 0.00028,
    hazeColor: '#26366f',
    waterDeep: '#0a2d5e',
    waterShallow: '#1f7795',
    waterGlow: '#4d9fc4',
    foam: 0.8,
    windSpeed: 5.2,
    windFrom: 120,
    gust: 0.25,
    swellHeight: 0.7,
    swellFrom: 90,
    swellLength: 1.0,
    chopHeight: 0.3,
    rain: 0,
    lightning: 0,
    exposure: 1.2,
    saturation: 1.1,
    contrast: 1.05,
    bloom: 0.8,
    vignette: 0.45,
    warmth: -0.35,
  },
];

export const weatherById = (id: string): WeatherPreset =>
  WEATHER.find((w) => w.id === id) ?? (WEATHER[0] as WeatherPreset);
