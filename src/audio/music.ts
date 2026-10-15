// Generative ambient music: a slow chord loop of airy pads, a soft sub bass and sparse plucked
// arpeggios, all washed in reverb. The chord set follows the weather (sunny / stormy / night).

export type Mood = 'sunny' | 'storm' | 'night';

interface Chord {
  notes: number[]; // MIDI
}

const CHORDS: Record<Mood, Chord[]> = {
  // Fmaj9 - Em9 - Dm9 - G7sus4 : warm, drifting, a little "city pop"
  sunny: [
    { notes: [41, 53, 57, 60, 64, 67] },
    { notes: [40, 52, 55, 59, 62, 66] },
    { notes: [38, 50, 53, 57, 60, 64] },
    { notes: [43, 55, 60, 62, 65, 69] },
  ],
  // Dm9 - Bbmaj7 - Gm9 - A7sus4 : heavier, slower
  storm: [
    { notes: [38, 50, 53, 57, 60, 64] },
    { notes: [34, 46, 50, 53, 57, 62] },
    { notes: [43, 55, 58, 62, 65, 69] },
    { notes: [33, 45, 52, 55, 59, 62] },
  ],
  // Am9 - Fmaj9 - Cmaj7 - Em7 : sparse and calm
  night: [
    { notes: [45, 57, 60, 64, 67, 71] },
    { notes: [41, 53, 57, 60, 64, 67] },
    { notes: [36, 48, 55, 59, 64, 67] },
    { notes: [40, 52, 55, 59, 62, 67] },
  ],
};

const TEMPO: Record<Mood, number> = { sunny: 84, storm: 64, night: 58 };
// probability of a pluck on each 8th-note step (syncopated)
const PATTERN = [0.9, 0.3, 0.55, 0.8, 0.4, 0.6, 0.75, 0.3];

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export class Music {
  private mood: Mood = 'sunny';
  private intensity = 0.4;
  private step = 0;
  private chordIdx = 0;
  private nextTime = 0;
  private readonly pad: BiquadFilterNode;
  private started = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly reverb: AudioNode,
  ) {
    this.pad = ctx.createBiquadFilter();
    this.pad.type = 'lowpass';
    this.pad.frequency.value = 1300;
    this.pad.Q.value = 0.4;
    const padOut = ctx.createGain();
    padOut.gain.value = 0.55;
    this.pad.connect(padOut);
    padOut.connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    padOut.connect(send);
    send.connect(reverb);
  }

  setMood(m: Mood): void {
    this.mood = m;
  }

  /** 0 = menu calm, 1 = full run. Opens the pad filter and thickens the arpeggio. */
  setIntensity(x: number): void {
    this.intensity = x;
    this.pad.frequency.setTargetAtTime(900 + x * 1100, this.ctx.currentTime, 1.5);
  }

  update(): void {
    const ctx = this.ctx;
    const stepLen = 60 / TEMPO[this.mood] / 2;
    if (!this.started) {
      this.nextTime = ctx.currentTime + 0.15;
      this.started = true;
    }
    // if the tab was throttled and we fell far behind, resync rather than burst-playing
    if (this.nextTime < ctx.currentTime - 1) this.nextTime = ctx.currentTime + 0.1;
    while (this.nextTime < ctx.currentTime + 0.5) {
      this.schedule(this.nextTime, stepLen);
      this.nextTime += stepLen;
      this.step++;
    }
  }

  private schedule(t: number, stepLen: number): void {
    const chords = CHORDS[this.mood];
    const stepInChord = this.step % 16;
    if (stepInChord === 0) {
      this.chordIdx = (this.chordIdx + (this.step === 0 ? 0 : 1)) % chords.length;
      this.playPad(chords[this.chordIdx] as Chord, t, stepLen * 16);
    }
    const chord = chords[this.chordIdx] as Chord;
    // bass on the downbeat and the "and" of 3
    if (stepInChord === 0 || stepInChord === 6 || stepInChord === 11) {
      this.pluck(mtof(chord.notes[0] as number), t, 'sine', 0.2 * (stepInChord === 0 ? 1 : 0.6), 1.6, 0, 0.1);
    }
    // arpeggio
    const density = 0.55 + 0.45 * this.intensity;
    if (Math.random() < (PATTERN[this.step % 8] as number) * density * (this.mood === 'night' ? 0.7 : 1)) {
      const pool = chord.notes.slice(1);
      const n = (pool[Math.floor(Math.random() * pool.length)] as number) + (Math.random() < 0.45 ? 12 : 0);
      this.pluck(
        mtof(n + 12),
        t,
        'triangle',
        0.075 + Math.random() * 0.04,
        1.1,
        (Math.random() - 0.5) * 0.9,
        0.7,
      );
    }
  }

  private playPad(chord: Chord, t: number, len: number): void {
    const ctx = this.ctx;
    for (const note of chord.notes) {
      for (const detune of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = note < 45 ? 'sine' : 'triangle';
        o.frequency.value = mtof(note);
        o.detune.value = detune;
        const g = ctx.createGain();
        const peak = (note < 45 ? 0.09 : 0.045) * (0.8 + Math.random() * 0.4);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + len * 0.3);
        g.gain.setValueAtTime(peak, t + len * 0.75);
        g.gain.linearRampToValueAtTime(0, t + len * 1.35);
        o.connect(g);
        g.connect(this.pad);
        o.start(t);
        o.stop(t + len * 1.4);
      }
    }
  }

  private pluck(
    freq: number,
    t: number,
    type: OscillatorType,
    vol: number,
    decay: number,
    pan: number,
    send: number,
  ): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.005;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    let tail: AudioNode = g;
    if (pan !== 0 && 'createStereoPanner' in ctx) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(this.out);
    const s = ctx.createGain();
    s.gain.value = send;
    tail.connect(s);
    s.connect(this.reverb);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.05);
    o2.stop(t + decay + 0.05);
  }
}
