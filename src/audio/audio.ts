// Procedural sound for the whole game, synthesised live with WebAudio (no asset files):
// per-boat engines, wind, water rush and swell, rain, thunder, gulls, bilge pump, slams, hull strikes,
// gate chimes, UI blips and a weather-aware generative score.

import { type Mood, Music } from './music';
import { makeImpulse, makeNoise, type NoiseKind } from './noise';

export interface AudioFrame {
  phase: 'loading' | 'menu' | 'countdown' | 'playing' | 'paused' | 'finished' | 'failed';
  boatId: string;
  /** Engine is running (false once swamped / capsized, or a sloop under sail). */
  engineOn: boolean;
  throttle: number;
  rpm: number;
  speed: number;
  topSpeed: number;
  propSubmerge: number;
  windApparent: number;
  gust: number;
  swellH: number;
  /** 0..1 breaking surf nearby. */
  surf: number;
  /** 0..1 how hard the hull is bouncing on the chop. */
  heave: number;
  rain: number;
  night: number;
  sailUp: boolean;
  sailLuff: number;
  pumping: boolean;
  weather: string;
  /** Open water between the hull and the nearest obstacle while docking (99 = not docking). */
  clearance: number;
  /** The prop is wrapped in a line: the engine coughs. */
  fouled: boolean;
  /** A fish on the line (Montauk): line going out, line coming in, and how hard it is loaded (0..1.2). */
  fishing?: { slip: number; reel: number; tension: number } | null;
}

interface EngineProfile {
  idle: number;
  max: number;
  cutoff: [number, number];
  twin: number;
  gain: number;
  noise: number;
}

/** Firing frequency range (Hz) and tone per boat. */
const ENGINES: Record<string, EngineProfile> = {
  console: { idle: 24, max: 175, cutoff: [420, 2300], twin: 0, gain: 1, noise: 0.5 },
  gofast: { idle: 20, max: 215, cutoff: [360, 2700], twin: 0.014, gain: 1.15, noise: 0.6 },
  cruiser: { idle: 15, max: 88, cutoff: [300, 1200], twin: 0.02, gain: 0.95, noise: 0.35 },
  charter: { idle: 13, max: 78, cutoff: [260, 1050], twin: 0.025, gain: 1.0, noise: 0.35 },
  sloop: { idle: 14, max: 72, cutoff: [280, 950], twin: 0, gain: 0.55, noise: 0.25 },
  pontoon: { idle: 20, max: 140, cutoff: [380, 1800], twin: 0, gain: 0.8, noise: 0.4 },
};

const MOODS: Record<string, Mood> = {
  golden: 'sunny',
  breeze: 'sunny',
  dawn: 'sunny',
  squall: 'storm',
  noreaster: 'storm',
  moon: 'night',
  'm-dawn': 'sunny',
  'm-peach': 'sunny',
  'm-dusk': 'sunny',
  'm-gale': 'storm',
};

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverbIn!: GainNode;
  private music: Music | null = null;
  private volume = 0.8;
  private sfxOn = true;
  private musicOn = true;
  private noises = new Map<NoiseKind, AudioBuffer>();
  private gullIn = 6;
  private t = 0;
  private lastHover = 0;
  private parkIn = 0;

  // persistent voices
  private eng?: {
    saw1: OscillatorNode;
    saw2: OscillatorNode;
    body: OscillatorNode;
    buzz: OscillatorNode;
    lump: OscillatorNode;
    lp: BiquadFilterNode;
    amp: GainNode;
    noiseG: GainNode;
    noiseF: BiquadFilterNode;
  };
  private windG?: GainNode;
  private windF?: BiquadFilterNode;
  private whistleG?: GainNode;
  private whistleF?: BiquadFilterNode;
  private rushLowG?: GainNode;
  private rushHiG?: GainNode;
  private rushHiF?: BiquadFilterNode;
  private slapG?: GainNode;
  private surfG?: GainNode;
  private rainG?: GainNode;
  private patterG?: GainNode;
  private pumpG?: GainNode;
  private flutterG?: GainNode;
  private dragG?: GainNode;
  private dragF?: BiquadFilterNode;
  private reelG?: GainNode;
  private reelOsc?: OscillatorNode;
  private strainG?: GainNode;
  private strainOsc?: OscillatorNode;

  /** Create the AudioContext on the first user gesture (browsers block it before that). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.build(new AC({ latencyHint: 'interactive' }));
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private analyser?: AnalyserNode;
  private meterBuf?: Float32Array<ArrayBuffer>;

  /** Output level (dBFS) of the final mix; used by the debug HUD and tests. */
  meter(): { rms: number; peak: number } {
    const ctx = this.ctx;
    if (!ctx) return { rms: -120, peak: -120 };
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
      this.meterBuf = new Float32Array(this.analyser.fftSize);
    }
    const buf = this.meterBuf as Float32Array<ArrayBuffer>;
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (const v of buf) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-6));
    return { rms: db(Math.sqrt(sum / buf.length)), peak: db(peak) };
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
  }

  // ------------------------------------------------------------------------------------------------
  // graph
  // ------------------------------------------------------------------------------------------------

  private noise(kind: NoiseKind): AudioBuffer {
    let b = this.noises.get(kind);
    if (!b) {
      b = makeNoise(this.ctx as AudioContext, kind, 4);
      this.noises.set(kind, b);
    }
    return b;
  }

  /** A looping noise source (random start so layers never phase-lock) → filter → gain. */
  private loop(
    kind: NoiseKind,
    filter: BiquadFilterType | null,
    freq: number,
    q: number,
    out: AudioNode,
  ): { g: GainNode; f: BiquadFilterNode | null } {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(kind);
    src.loop = true;
    let node: AudioNode = src;
    let f: BiquadFilterNode | null = null;
    if (filter) {
      f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g);
    g.connect(out);
    src.start(0, Math.random() * 3);
    return { g, f };
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.master.gain.setTargetAtTime(this.volume * 0.9, ctx.currentTime, 0.4);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 3.1);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master);

    // ---- engine ---------------------------------------------------------------------------------
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.Q.value = 0.8;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const mix = ctx.createGain();
    mix.gain.value = 0.8;
    mix.connect(lp);
    lp.connect(amp);
    amp.connect(this.sfx);
    const osc = (type: OscillatorType, vol: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g);
      g.connect(mix);
      o.start();
      return o;
    };
    const saw1 = osc('sawtooth', 0.5);
    const saw2 = osc('sawtooth', 0.35);
    const body = osc('triangle', 0.55);
    const buzz = osc('square', 0.12);
    // firing lumpiness: an LFO riding on the mix gain
    const lump = ctx.createOscillator();
    lump.frequency.value = 12;
    const lumpD = ctx.createGain();
    lumpD.gain.value = 0.22;
    lump.connect(lumpD);
    lumpD.connect(mix.gain);
    lump.start();
    const nz = this.loop('pink', 'bandpass', 600, 0.8, this.sfx);
    this.eng = { saw1, saw2, body, buzz, lump, lp, amp, noiseG: nz.g, noiseF: nz.f as BiquadFilterNode };

    // ---- wind ------------------------------------------------------------------------------------
    const w = this.loop('pink', 'bandpass', 400, 0.55, this.sfx);
    this.windG = w.g;
    this.windF = w.f as BiquadFilterNode;
    const wh = this.loop('pink', 'bandpass', 1100, 9, this.sfx);
    this.whistleG = wh.g;
    this.whistleF = wh.f as BiquadFilterNode;

    // ---- water rushing past the hull + chop slap ---------------------------------------------------
    this.rushLowG = this.loop('brown', 'lowpass', 280, 0.6, this.sfx).g;
    const rh = this.loop('pink', 'bandpass', 1900, 0.5, this.sfx);
    this.rushHiG = rh.g;
    this.rushHiF = rh.f as BiquadFilterNode;
    this.slapG = this.loop('brown', 'bandpass', 380, 1.1, this.sfx).g;

    // ---- ambient surf / swell ---------------------------------------------------------------------
    const surfMod = ctx.createGain();
    surfMod.gain.value = 0.62;
    const swellLfo = ctx.createOscillator();
    swellLfo.frequency.value = 0.11;
    const swellD = ctx.createGain();
    swellD.gain.value = 0.38;
    swellLfo.connect(swellD);
    swellD.connect(surfMod.gain);
    swellLfo.start();
    surfMod.connect(this.sfx);
    this.surfG = this.loop('brown', 'lowpass', 650, 0.5, surfMod).g;

    // ---- rain ----------------------------------------------------------------------------------------
    const rn = this.loop('white', 'highpass', 1000, 0.5, this.sfx);
    const rnLow = ctx.createBiquadFilter();
    rnLow.type = 'lowpass';
    rnLow.frequency.value = 7500;
    // re-route through a low-pass so it is a band, not a hiss
    rn.g.disconnect();
    rn.g.connect(rnLow);
    rnLow.connect(this.sfx);
    this.rainG = rn.g;
    this.patterG = this.loop('pink', 'bandpass', 2600, 0.7, this.sfx).g;

    // ---- bilge pump + sail flutter -------------------------------------------------------------------
    const pump = this.loop('pink', 'bandpass', 520, 1.4, this.sfx);
    const gate = ctx.createOscillator();
    gate.frequency.value = 5.2;
    const gateD = ctx.createGain();
    gateD.gain.value = 0.5;
    gate.connect(gateD);
    gateD.connect(pump.g.gain);
    gate.start();
    this.pumpG = pump.g;
    const fl = this.loop('pink', 'bandpass', 1500, 1.2, this.sfx);
    const flLfo = ctx.createOscillator();
    flLfo.frequency.value = 8.5;
    const flD = ctx.createGain();
    flD.gain.value = 0.5;
    flLfo.connect(flD);
    flD.connect(fl.g.gain);
    flLfo.start();
    this.flutterG = fl.g;

    // ---- fishing: the drag screaming, the reel's clicks and the strain of a loaded line -----------------
    const drag = this.loop('white', 'bandpass', 2400, 5, this.sfx);
    this.dragG = drag.g;
    this.dragF = drag.f as BiquadFilterNode;
    const reel = this.loop('pink', 'bandpass', 1500, 2.2, this.sfx);
    const reelLfo = ctx.createOscillator();
    reelLfo.type = 'square';
    reelLfo.frequency.value = 6;
    const reelD = ctx.createGain();
    reelD.gain.value = 0.5;
    reelLfo.connect(reelD);
    reelD.connect(reel.g.gain);
    reelLfo.start();
    this.reelG = reel.g;
    this.reelOsc = reelLfo;
    const strain = ctx.createOscillator();
    strain.type = 'triangle';
    strain.frequency.value = 600;
    const strainG = ctx.createGain();
    strainG.gain.value = 0;
    strain.connect(strainG);
    strainG.connect(this.sfx);
    strain.start();
    this.strainG = strainG;
    this.strainOsc = strain;

    this.music = new Music(ctx, this.musicBus, this.reverbIn);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  // ------------------------------------------------------------------------------------------------
  // per-frame mix
  // ------------------------------------------------------------------------------------------------

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (ctx?.state !== 'running') return;
    this.t += dt;
    const now = ctx.currentTime;
    const tc = 0.08;
    const set = (p: AudioParam | undefined, v: number, c = tc): void => {
      if (p) p.setTargetAtTime(v, now, c);
    };
    const paused = f.phase === 'paused';
    const live =
      f.phase === 'playing' || f.phase === 'countdown' || f.phase === 'finished' || f.phase === 'failed';
    const sfxK = this.sfxOn ? (paused ? 0.14 : 1) : 0;
    set(this.sfx.gain, sfxK, 0.12);

    // engine ---------------------------------------------------------------------------------------
    const e = this.eng;
    const prof = ENGINES[f.boatId] ?? (ENGINES.console as EngineProfile);
    if (e) {
      let rpm = clamp(f.rpm + (1 - f.propSubmerge) * f.throttle * 0.3, 0, 1.15);
      if (f.fouled) rpm = clamp(rpm * 0.55 + Math.sin(this.t * 31) * 0.14, 0.05, 1);
      const hz = prof.idle + (prof.max - prof.idle) * rpm ** 1.15;
      set(e.saw1.frequency, hz, 0.05);
      set(e.saw2.frequency, hz * (1 + prof.twin + 0.003), 0.05);
      set(e.body.frequency, hz, 0.05);
      set(e.buzz.frequency, hz * 2, 0.05);
      set(e.lump.frequency, hz * 0.5, 0.1);
      set(
        e.lp.frequency,
        (prof.cutoff[0] as number) + ((prof.cutoff[1] as number) - (prof.cutoff[0] as number)) * rpm ** 1.2,
        0.08,
      );
      const idleK = f.phase === 'menu' || f.phase === 'loading' ? 0.4 : 1;
      const run = f.engineOn ? 1 : 0;
      set(e.amp.gain, (0.07 + 0.22 * rpm) * prof.gain * idleK * run, 0.12);
      set(e.noiseG.gain, (0.02 + 0.11 * rpm) * prof.noise * idleK * run, 0.12);
      set(e.noiseF.frequency, 380 + 900 * rpm, 0.1);
    }

    // wind ------------------------------------------------------------------------------------------
    const w = f.windApparent;
    const wn = clamp(w / 22, 0, 1.4);
    set(this.windG?.gain, 0.3 * wn ** 1.4 * (1 + f.gust * 0.35), 0.25);
    set(this.windF?.frequency, 240 + 34 * w + Math.sin(this.t * 0.7) * 40, 0.3);
    set(this.whistleG?.gain, 0.045 * clamp((w - 9) / 10, 0, 1.4) * (0.6 + f.gust), 0.3);
    set(this.whistleF?.frequency, 880 + 24 * w + Math.sin(this.t * 1.9) * 60, 0.2);

    // water rush -------------------------------------------------------------------------------------
    const sp = clamp(f.speed / Math.max(1, f.topSpeed), 0, 1.2);
    const moving = live ? 1 : 0.35;
    set(this.rushLowG?.gain, 0.34 * sp ** 1.15 * moving, 0.15);
    set(this.rushHiG?.gain, 0.15 * sp ** 1.6 * moving, 0.15);
    set(this.rushHiF?.frequency, 1100 + 1800 * sp, 0.2);
    set(this.slapG?.gain, 0.32 * f.heave * clamp(sp * 1.6, 0, 1) * moving, 0.07);

    // ambient surf ------------------------------------------------------------------------------------
    set(this.surfG?.gain, 0.07 + 0.2 * f.surf + 0.06 * clamp(f.swellH / 2, 0, 1.5), 0.6);

    // rain ----------------------------------------------------------------------------------------------
    set(this.rainG?.gain, 0.26 * f.rain ** 1.25, 0.5);
    set(this.patterG?.gain, 0.09 * f.rain, 0.5);

    // pump + sail flutter ------------------------------------------------------------------------------
    set(this.pumpG?.gain, f.pumping && live ? 0.22 : 0, 0.1);
    set(this.flutterG?.gain, f.sailUp && live ? 0.3 * f.sailLuff ** 1.5 * clamp(w / 9, 0, 1) : 0, 0.15);

    // a fish on the line ------------------------------------------------------------------------------------
    const fa = live && !paused ? f.fishing : null;
    const slipK = fa ? clamp(fa.slip / 6, 0, 1) : 0;
    set(this.dragG?.gain, fa ? 0.26 * slipK ** 0.8 : 0, 0.05);
    set(this.dragF?.frequency, 1700 + 2800 * clamp((fa?.slip ?? 0) / 8, 0, 1), 0.05);
    const reelK = fa ? clamp(fa.reel / 2.6, 0, 1) : 0;
    set(this.reelG?.gain, 0.2 * reelK, 0.08);
    set(this.reelOsc?.frequency, 5 + 11 * reelK, 0.1);
    const strainK = fa ? clamp((fa.tension - 0.72) / 0.4, 0, 1) : 0;
    set(this.strainG?.gain, 0.045 * strainK, 0.06);
    set(this.strainOsc?.frequency, 520 + 900 * (fa?.tension ?? 0), 0.06);

    // music -------------------------------------------------------------------------------------------------
    const m = this.music;
    if (m) {
      m.setMood(MOODS[f.weather] ?? 'sunny');
      m.setIntensity(f.phase === 'playing' ? 0.75 : f.phase === 'menu' ? 0.3 : 0.5);
      const duck = f.phase === 'playing' ? 1 - 0.35 * clamp(f.rpm, 0, 1) : 1;
      set(this.musicBus.gain, this.musicOn ? 0.55 * duck : 0, 0.8);
      m.update();
    }

    // parking sensor: beeps speed up as the hull closes on a piling, pier or boat
    this.parkIn -= dt;
    if (f.clearance < 6 && live && !paused) {
      if (this.parkIn <= 0) {
        const c = Math.max(0, f.clearance);
        this.tone('triangle', 1180, 1180, 0.05 + 0.07 * (1 - c / 6), 0.003, 0.05, 0, 0, 0.05);
        this.parkIn = 0.07 + c * 0.1;
      }
    } else this.parkIn = 0;

    // gulls -----------------------------------------------------------------------------------------------------
    this.gullIn -= dt;
    if (this.gullIn <= 0) {
      this.gullIn = rand(8, 20);
      if (f.night < 0.5 && f.rain < 0.3 && !paused) this.gull();
    }
  }

  // ------------------------------------------------------------------------------------------------
  // one-shots
  // ------------------------------------------------------------------------------------------------

  private out(pan: number, send: number, bus?: AudioNode): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let last: AudioNode = ctx.createGain();
    const head = last;
    if (pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      last.connect(p);
      last = p;
    }
    last.connect(bus ?? this.sfx);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      last.connect(s);
      s.connect(this.reverbIn);
    }
    return head;
  }

  /** Enveloped oscillator with an optional pitch glide. */
  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    vol: number,
    attack: number,
    decay: number,
    delay = 0,
    pan = 0,
    send = 0.3,
    bus?: AudioNode,
  ): void {
    const ctx = this.ctx;
    if (!ctx || (!this.sfxOn && !bus)) return;
    const dest = this.out(pan, send, bus);
    if (!dest) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  /** Filtered noise burst with a filter sweep. */
  private burst(
    kind: NoiseKind,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    vol: number,
    dur: number,
    delay = 0,
    pan = 0,
    send = 0.2,
    attack = 0.005,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const dest = this.out(pan, send);
    if (!dest) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(kind);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.05);
  }

  /** A soft glassy bell. */
  private bell(freq: number, vol: number, delay = 0, pan = 0, decay = 1.5): void {
    this.tone('sine', freq, freq, vol, 0.004, decay, delay, pan, 0.5);
    this.tone('sine', freq * 2.01, freq * 2.01, vol * 0.28, 0.003, decay * 0.5, delay, pan, 0.5);
    this.tone('sine', freq * 3.98, freq * 3.98, vol * 0.1, 0.002, decay * 0.25, delay, pan, 0.5);
  }

  /** Hull slams into a wave. */
  slam(strength: number): void {
    const s = clamp(strength / 9, 0.1, 1);
    this.tone('sine', 120, 38, 0.5 * s, 0.004, 0.32, 0, 0, 0.12);
    this.burst('brown', 'lowpass', 900, 160, 0.7, 0.55 * s, 0.38, 0, 0, 0.15);
    if (s > 0.35) this.burst('white', 'bandpass', 2600, 900, 0.7, 0.22 * s, 0.3, 0.02, 0, 0.3);
  }

  /** Green water over the gunwales / big splash. */
  splash(a: number): void {
    const s = clamp(a, 0.2, 1);
    this.burst('white', 'bandpass', 2400, 700, 0.8, 0.3 * s, 0.45, 0, rand(-0.3, 0.3), 0.3);
    this.burst('brown', 'lowpass', 700, 200, 0.6, 0.3 * s, 0.4);
  }

  /** Hull strike on rock / wall / dock. */
  hit(speed: number): void {
    const s = clamp(speed / 9, 0.25, 1);
    this.tone('sine', 160, 45, 0.6 * s, 0.003, 0.3, 0, 0, 0.1);
    this.burst('white', 'bandpass', 1300, 380, 1.1, 0.5 * s, 0.22, 0, 0, 0.1, 0.002);
    this.burst('brown', 'lowpass', 600, 120, 0.7, 0.4 * s, 0.4);
  }

  /** Gate passed; clean lines get a rising arpeggio. */
  gate(clean: boolean, index: number): void {
    const scale = [659.25, 739.99, 830.61, 987.77, 1108.73, 1318.51];
    const base = (index * 2) % 3;
    const n1 = scale[base] as number;
    if (!clean) {
      this.bell(n1 * 0.75, 0.16, 0, 0, 0.9);
      return;
    }
    this.bell(n1, 0.2, 0);
    this.bell(scale[base + 1] as number, 0.18, 0.09);
    this.bell(scale[base + 2] as number, 0.2, 0.18);
  }

  countdown(n: number): void {
    if (n > 0) this.tone('sine', 523.25, 523.25, 0.32, 0.005, 0.3, 0, 0, 0.3);
    else {
      this.bell(1046.5, 0.3, 0);
      this.bell(1318.5, 0.22, 0.04);
      this.bell(1568, 0.2, 0.08);
    }
  }

  /** Bilge warning: two beeps, or four insistent ones when critical. */
  alarm(critical: boolean): void {
    const n = critical ? 4 : 2;
    for (let i = 0; i < n; i++) {
      this.tone('triangle', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.22, 0.004, 0.12, i * 0.16, 0, 0.15);
    }
  }

  whoosh(): void {
    this.burst('pink', 'bandpass', 300, 3200, 0.8, 0.28, 0.7, 0, 0, 0.3, 0.25);
  }

  finish(ok: boolean): void {
    if (ok) {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((fq, i) => {
        this.bell(fq, 0.2, i * 0.11, (i - 2) * 0.15, 2.2);
      });
    } else {
      this.tone('sine', 330, 110, 0.3, 0.01, 1.4, 0, 0, 0.5);
      this.tone('triangle', 247, 82, 0.2, 0.01, 1.6, 0.1, 0, 0.5);
      for (let i = 0; i < 9; i++) {
        this.tone(
          'sine',
          rand(160, 260),
          rand(500, 900),
          0.1,
          0.004,
          0.07,
          0.2 + i * rand(0.07, 0.16),
          rand(-0.5, 0.5),
          0.2,
        );
      }
      this.burst('brown', 'lowpass', 900, 100, 0.6, 0.35, 1.8, 0.05);
    }
  }

  /** Thunder arriving `delay` seconds after the flash. */
  thunder(delay: number, loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const l = clamp(loudness, 0.15, 1);
    const pan = rand(-0.7, 0.7);
    this.burst('white', 'highpass', 1800, 900, 0.6, 0.35 * l, 0.12, delay, pan, 0.4, 0.002);
    // the long rolling rumble: low-passed brown noise with random swells
    const dest = this.out(pan, 0.5);
    if (!dest) return;
    const t = ctx.currentTime + delay + 0.04;
    const dur = 3.5 + 3.5 * l;
    const src = ctx.createBufferSource();
    src.buffer = this.noise('brown');
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9 * l, t + 0.15);
    const bumps = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= bumps; i++) {
      const tt = t + (dur * i) / (bumps + 1);
      g.gain.linearRampToValueAtTime(rand(0.3, 0.8) * l, tt);
      g.gain.linearRampToValueAtTime(rand(0.15, 0.4) * l, tt + dur / (bumps * 2.4));
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.1);
  }

  private gull(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxOn) return;
    const pan = rand(-0.85, 0.85);
    const n = 2 + Math.floor(Math.random() * 3);
    const base = rand(1250, 1650);
    for (let i = 0; i < n; i++) {
      const delay = i * rand(0.2, 0.3);
      const dest = this.out(pan, 0.55);
      if (!dest) return;
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.25, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.78, t + 0.2);
      // FM vibrato for the raspy "kyow"
      const vib = ctx.createOscillator();
      vib.frequency.value = rand(34, 46);
      const vibD = ctx.createGain();
      vibD.gain.value = 90;
      vib.connect(vibD);
      vibD.connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(bp);
      bp.connect(g);
      g.connect(dest);
      o.start(t);
      vib.start(t);
      o.stop(t + 0.26);
      vib.stop(t + 0.26);
    }
  }

  /** A tuna hits the lure: the ratchet screams and a bright bell. */
  strike(): void {
    for (let i = 0; i < 12; i++) {
      this.tone('square', 900 + i * 55, 1500 + i * 90, 0.07, 0.002, 0.05, i * 0.045, 0, 0.1);
    }
    this.burst('white', 'bandpass', 3800, 1500, 1.2, 0.3, 0.7, 0, 0, 0.2, 0.02);
    this.bell(1318.5, 0.18, 0.3);
    this.bell(1760, 0.15, 0.38);
  }

  /** A short zip of line leaving the reel. */
  reelScream(strength: number): void {
    const s = clamp(strength, 0.2, 1);
    this.burst('white', 'bandpass', 2000, 4200, 1.6, 0.3 * s, 0.9, 0, 0, 0.15, 0.03);
  }

  /** The fish finder pings. */
  sonarPing(): void {
    this.tone('sine', 1500, 1500, 0.06, 0.003, 0.22, 0, 0.3, 0.4);
  }

  /** Menu / HUD interaction blips. */
  ui(kind: 'click' | 'hover' | 'start'): void {
    if (!this.ctx) return;
    if (kind === 'hover') {
      const n = performance.now();
      if (n - this.lastHover < 60) return;
      this.lastHover = n;
      this.tone('sine', 1500, 1500, 0.035, 0.002, 0.04, 0, 0, 0.05);
    } else if (kind === 'click') {
      this.tone('triangle', 820, 560, 0.12, 0.002, 0.09, 0, 0, 0.1);
    } else {
      this.whoosh();
      this.bell(783.99, 0.2, 0.05);
      this.bell(1174.7, 0.16, 0.14);
    }
  }
}
