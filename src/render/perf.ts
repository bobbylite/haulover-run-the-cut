// Adaptive resolution: watches the frame rate and trades pixel count for smoothness, creeping back up
// when there is headroom. Steps are small and rate-limited so buffer reallocation never causes a hitch loop.

export class PerfGovernor {
  /** Current render scale applied on top of the base pixel ratio (0.6 .. 1). */
  scale = 1;
  auto = true;
  fps = 60;
  private acc = 0;
  private frames = 0;
  private cooldown = 3;
  private good = 0;

  constructor(
    private readonly apply: (scale: number) => void,
    private readonly min = 0.6,
  ) {}

  setManual(scale: number): void {
    this.auto = false;
    this.set(scale);
  }

  setAuto(): void {
    this.auto = true;
    this.cooldown = 3;
  }

  private set(s: number): void {
    const next = Math.round(s * 100) / 100;
    if (next === this.scale) return;
    this.scale = next;
    this.apply(next);
  }

  /** Feed each frame's duration (seconds). */
  tick(dt: number): void {
    if (dt <= 0 || dt > 0.25) return; // tab switches, pauses, load hitches
    this.acc += dt;
    this.frames++;
    this.cooldown -= dt;
    if (this.acc < 1.5) return;
    this.fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (!this.auto || this.cooldown > 0) return;
    if (this.fps < 48 && this.scale > this.min) {
      this.set(Math.max(this.min, this.scale - 0.15));
      this.cooldown = 4;
      this.good = 0;
    } else if (this.fps > 57 && this.scale < 1) {
      if (++this.good >= 4) {
        this.set(Math.min(1, this.scale + 0.1));
        this.cooldown = 6;
        this.good = 0;
      }
    } else if (this.fps <= 57) {
      this.good = 0;
    }
  }
}
