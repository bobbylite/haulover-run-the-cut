// Noise buffers and a synthetic reverb impulse response; everything the audio engine needs is generated
// at runtime so the game ships with zero audio assets.

export type NoiseKind = 'white' | 'pink' | 'brown';

/** A seamlessly loopable mono noise buffer (the tail is cross-faded into the head). */
export function makeNoise(ctx: BaseAudioContext, kind: NoiseKind, seconds = 4): AudioBuffer {
  const fade = Math.floor(ctx.sampleRate * 0.12);
  const n = Math.floor(ctx.sampleRate * seconds) + fade;
  const raw = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let brown = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = brown * 3.5;
    }
  }
  const len = n - fade;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  d.set(raw.subarray(0, len));
  // cross-fade the overhang into the start so the loop point is inaudible
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = (d[i] as number) * t + (raw[len + i] as number) * (1 - t);
  }
  return buf;
}

/** Stereo exponentially-decaying noise whose highs die faster than its lows (a warm outdoor tail). */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.6, decay = 3.1): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = (1 - t) ** 1.5 * Math.exp(-decay * t * 2.2);
      const k = 0.62 - 0.5 * t; // one-pole low-pass that closes over time
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * env * (i < 400 ? i / 400 : 1);
    }
  }
  return buf;
}
