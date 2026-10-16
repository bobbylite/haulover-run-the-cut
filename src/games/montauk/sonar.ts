// The fish finder: a scrolling picture of what is under the boat. Bait shows as a warm band at its depth,
// tuna as pale arches beneath it, and the bottom as a sandy floor. Fish only show when you pass right over
// them, so finding them is a matter of reading the surface first and the sonar second.

import { clamp } from '../../core/math';
import type { Echo } from '../../sim/fishing/world';

const W = 340;
const H = 170;
const COLS = 136;
const STEP = 0.3;

interface Column {
  echo: Echo;
}

export class Sonar {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cols: Column[] = [];
  private acc = 0;
  private maxDepth = 40;
  /** Set when a new tuna mark appears (the HUD blinks on it). */
  lastMarkT = -99;
  private lastMarks = new Set<number>();
  /** The mark seen most recently (for the label). */
  label = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.clear();
  }

  clear(): void {
    this.cols.length = 0;
    this.acc = 0;
    this.lastMarks.clear();
    this.label = '';
    this.draw(0);
  }

  /** Advance with the boat. `echo` is what is under it now. Returns true on a new fish mark. */
  push(dt: number, echo: Echo, time: number): boolean {
    this.acc += dt;
    let fresh = false;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.cols.push({ echo });
      if (this.cols.length > COLS) this.cols.shift();
    }
    for (const m of echo.marks) {
      if (!this.lastMarks.has(m.id)) {
        this.lastMarks.add(m.id);
        this.lastMarkT = time;
        fresh = true;
        this.label = `Fish arch ~${Math.round(m.kg / 5) * 5} kg at ${m.depth.toFixed(0)} m`;
      }
    }
    if (echo.marks.length === 0 && this.lastMarks.size > 4) this.lastMarks.clear();
    this.draw(time);
    return fresh;
  }

  private draw(time: number): void {
    const g = this.ctx;
    // depth range follows the sea floor under the window
    let bottomMax = 20;
    for (const c of this.cols) bottomMax = Math.max(bottomMax, c.echo.bottom);
    const want = clamp(bottomMax * 1.12, 28, 120);
    this.maxDepth += (want - this.maxDepth) * 0.12;
    const D = this.maxDepth;
    const y = (d: number): number => 14 + (d / D) * (H - 14);

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#9fe6f0');
    grad.addColorStop(0.5, '#5aa6dc');
    grad.addColorStop(1, '#4a4fa6');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const cw = (W - 34) / COLS;
    const x0 = 6;
    const n = this.cols.length;
    for (let i = 0; i < n; i++) {
      const c = this.cols[i] as Column;
      const x = x0 + (COLS - n + i) * cw;
      const e = c.echo;
      // the floor
      const by = y(e.bottom);
      g.fillStyle = 'rgba(247, 226, 186, 0.92)';
      g.fillRect(x, by, cw + 0.6, H - by);
      g.fillStyle = 'rgba(190, 160, 120, 0.5)';
      g.fillRect(x, by, cw + 0.6, 2);
      // the bait ball
      if (e.bait) {
        const top = y(e.bait.depth - e.bait.thick / 2);
        const bot = y(e.bait.depth + e.bait.thick / 2);
        g.fillStyle = `rgba(255, 150, 120, ${clamp(0.25 + e.bait.density * 0.7, 0, 0.95)})`;
        g.fillRect(x, top, cw + 0.6, Math.max(2, bot - top));
        g.fillStyle = `rgba(255, 224, 160, ${clamp(e.bait.density * 0.55, 0, 0.6)})`;
        g.fillRect(x, top + (bot - top) * 0.25, cw + 0.6, Math.max(1, (bot - top) * 0.45));
      }
      // tuna: slant range makes an arch as the boat goes over
      for (const m of e.marks) {
        const slant = Math.sqrt(m.depth * m.depth + m.d * m.d * 1.6);
        const r = clamp(Math.sqrt(m.kg) * 0.55, 2.2, 9);
        g.fillStyle = 'rgba(255, 255, 255, 0.95)';
        g.fillRect(x, y(slant) - r * 0.35, cw + 0.8, r * 0.7);
        g.fillStyle = 'rgba(255, 244, 150, 0.9)';
        g.fillRect(x, y(slant) - r * 0.12, cw + 0.8, r * 0.24);
      }
    }
    // depth rule
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 11px "Josefin Sans Variable", system-ui, sans-serif';
    g.textAlign = 'right';
    const step = D > 70 ? 20 : 10;
    for (let d = step; d < D - 4; d += step) {
      const yy = y(d);
      g.fillRect(W - 28, yy, 5, 1);
      g.fillText(`${d}`, W - 6, yy + 4);
    }
    // the ping line at the right edge
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    g.fillStyle = `rgba(255,255,255,${0.35 + pulse * 0.35})`;
    g.fillRect(x0 + COLS * cw, 14, 2, H - 14);
    // surface line
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(0, 13, W, 1.5);
  }
}
