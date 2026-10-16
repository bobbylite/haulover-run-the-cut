// The harbour chart in the menu: the whole bowl from Brant Point to Easy Street, a pin on every challenge's berth
// (gold with the stars you have earned, grey while its tier is locked), and the selected challenge's start and
// route. Click a pin to pick that challenge.

import { boatById } from '../../data/boats';
import { berthTarget } from '../../game/berthing';
import type { Game } from '../../game/game';
import { BUOYS, berthById, DOCKS, LIGHT, MOORED, MOORINGS } from '../../locations/nantucket/geography';
import { LEVELS, type Level } from './levels';
import type { NantMode } from './mode';

const CSS_W = 400;
const DPR = 2;
const X0 = -650;
const X1 = 470;
const Z0 = -420;
const Z1 = 470;
const CSS_H = Math.round((CSS_W * (Z1 - Z0)) / (X1 - X0));
const W = CSS_W * DPR;
const H = CSS_H * DPR;

const sx = (x: number): number => ((x - X0) / (X1 - X0)) * W;
const sz = (z: number): number => ((z - Z0) / (Z1 - Z0)) * H;
const pm = (m: number): number => (m / (X1 - X0)) * W;

interface Pin {
  level: Level;
  x: number;
  y: number;
  r: number;
}

export class NantMap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');
  private pins: Pin[] = [];
  private hover: string | null = null;

  constructor(
    private readonly game: Game,
    private readonly mode: NantMode,
    private readonly onPick: (id: string) => void,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${CSS_W}px`;
    this.canvas.style.height = `${CSS_H}px`;
    this.bg.width = W;
    this.bg.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.paintStatic();
    this.canvas.addEventListener('pointermove', (e) => {
      const p = this.at(e);
      const id = p?.level.id ?? null;
      if (id !== this.hover) {
        this.hover = id;
        this.canvas.style.cursor = p && this.mode.open(p.level) ? 'pointer' : 'default';
        this.draw();
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    this.canvas.addEventListener('click', (e) => {
      const p = this.at(e);
      if (p && this.mode.open(p.level)) this.onPick(p.level.id);
    });
  }

  private at(e: PointerEvent | MouseEvent): Pin | null {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    let best: Pin | null = null;
    let bd = 22 * DPR;
    for (const p of this.pins) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private paintStatic(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const img = g.createImageData(W, H);
    const step = 3;
    for (let py = 0; py < H; py += step) {
      const z = Z0 + ((py + step / 2) / H) * (Z1 - Z0);
      for (let px = 0; px < W; px += step) {
        const x = X0 + ((px + step / 2) / W) * (X1 - X0);
        const h = geo.heightAt(x, z);
        let r: number;
        let gg: number;
        let b: number;
        if (h >= 0.05) {
          // the town and the spits: warm cream, with the town a shade pinker
          const town = z > 330 ? 1 : 0;
          r = 238 - 8 * town;
          gg = 226 - 14 * town;
          b = 196 - 6 * town;
        } else {
          const t = Math.min(1, -h / 9.5);
          r = 170 + (58 - 170) * t;
          gg = 232 + (150 - 232) * t;
          b = 228 + (204 - 228) * t;
          if (-h < 2.2) {
            const sh = 1 - Math.max(0, (-h - 0.05) / 2.15);
            r += (240 - r) * sh * 0.7;
            gg += (222 - gg) * sh * 0.7;
            b += (186 - b) * sh * 0.7;
          }
        }
        for (let dy = 0; dy < step && py + dy < H; dy++) {
          for (let dx = 0; dx < step && px + dx < W; dx++) {
            const i = ((py + dy) * W + px + dx) * 4;
            img.data[i] = r;
            img.data[i + 1] = gg;
            img.data[i + 2] = b;
            img.data[i + 3] = 255;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#d6a76a';
    g.strokeStyle = '#7a5a3a';
    g.lineWidth = 1.2 * DPR;
    for (const d of DOCKS) {
      const w = Math.max(pm(d.hx * 2), 1.4 * DPR);
      const h = Math.max(pm(d.hz * 2), 1.4 * DPR);
      g.fillRect(sx(d.x - d.hx), sz(d.z - d.hz), w, h);
      if (d.hx > 2) g.strokeRect(sx(d.x - d.hx), sz(d.z - d.hz), w, h);
    }
    g.fillStyle = '#f6f1ea';
    for (const m of MOORED) {
      g.beginPath();
      g.arc(sx(m.x), sz(m.z), 1.6 * DPR, 0, 7);
      g.fill();
    }
    g.fillStyle = '#ff9a84';
    for (const m of MOORINGS) {
      g.beginPath();
      g.arc(sx(m.x), sz(m.z), 1.2 * DPR, 0, 7);
      g.fill();
    }
    for (const b of BUOYS) {
      g.fillStyle = b.kind === 'nun' ? '#ff7d86' : '#62d9a8';
      g.beginPath();
      g.arc(sx(b.x), sz(b.z), 2.4 * DPR, 0, 7);
      g.fill();
    }
    // the light on Brant Point
    g.fillStyle = '#fffaf3';
    g.strokeStyle = '#ff8f7a';
    g.lineWidth = 1.6 * DPR;
    g.beginPath();
    g.arc(sx(LIGHT.x), sz(LIGHT.z), 3.2 * DPR, 0, 7);
    g.fill();
    g.stroke();
    g.font = `700 ${9 * DPR}px "Fredoka Variable", system-ui, sans-serif`;
    g.fillStyle = 'rgba(70,60,110,0.75)';
    g.textAlign = 'center';
    g.fillText('BRANT PT', sx(LIGHT.x), sz(LIGHT.z) - 8 * DPR);
    g.fillText('STEAMSHIP', sx(-360), sz(110));
    g.fillText('TOWN QUAY', sx(95), sz(352));
    g.fillText('EASY STREET', sx(280), sz(450));
    g.fillText('MOORINGS', sx(180), sz(-60));
    g.textAlign = 'right';
    g.fillText('N ↑', W - 8 * DPR, 14 * DPR);
  }

  /** Redraw: the chart, then the route of the selected challenge, then every pin. */
  draw(): void {
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    const sel = this.mode.level;
    const t = performance.now() / 1000;
    // the route of the selected challenge, from its start to its berth
    const berth = berthById(sel.berth);
    g.save();
    g.setLineDash([5 * DPR, 5 * DPR]);
    g.strokeStyle = 'rgba(90,60,170,0.7)';
    g.lineWidth = 2 * DPR;
    g.beginPath();
    g.moveTo(sx(sel.start.x), sz(sel.start.z));
    const pts = berth.approach.filter(([, z]) => z > sel.start.z - 30 || true);
    // the road starts at the harbour mouth: begin at the nearest road point to the start
    let from = 0;
    let bd = Infinity;
    for (const [i, [x, z]] of pts.entries()) {
      const d = Math.hypot(x - sel.start.x, z - sel.start.z);
      if (d < bd) {
        bd = d;
        from = i;
      }
    }
    for (const [x, z] of pts.slice(from)) g.lineTo(sx(x), sz(z));
    const tg = berthTarget(berth, boatById(sel.boat));
    g.lineTo(sx(tg.x), sz(tg.z));
    g.stroke();
    g.restore();
    // the start: a little arrow
    g.save();
    g.translate(sx(sel.start.x), sz(sel.start.z));
    g.rotate(sel.start.heading);
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.8 * DPR;
    g.beginPath();
    g.moveTo(9 * DPR, 0);
    g.lineTo(-6 * DPR, 5.5 * DPR);
    g.lineTo(-6 * DPR, -5.5 * DPR);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // the pins
    this.pins = [];
    const placed = new Map<string, number>();
    for (const l of LEVELS) {
      const b = berthById(l.berth);
      const tgt = berthTarget(b, boatById(l.boat));
      // two challenges at one berth: fan the pins out a little
      const n = placed.get(l.berth) ?? 0;
      placed.set(l.berth, n + 1);
      const x = sx(b.kind === 'mooring' ? b.x : tgt.x) + n * 15 * DPR;
      const y = sz(b.kind === 'mooring' ? b.z : tgt.z) - n * 3 * DPR;
      const open = this.mode.open(l);
      const stars = this.mode.stars[l.id] ?? 0;
      const selected = l.id === sel.id;
      const hot = l.id === this.hover;
      const r = (selected ? 11 : hot ? 10 : 8.5) * DPR;
      this.pins.push({ level: l, x, y, r });
      const idx = LEVELS.indexOf(l) + 1;
      g.save();
      g.translate(x, y);
      if (selected) {
        g.strokeStyle = `rgba(255,122,107,${0.35 + 0.35 * Math.sin(t * 4)})`;
        g.lineWidth = 3 * DPR;
        g.beginPath();
        g.arc(0, 0, r + 4 * DPR, 0, 7);
        g.stroke();
      }
      g.shadowColor = 'rgba(40,30,90,0.35)';
      g.shadowBlur = 5 * DPR;
      g.fillStyle = !open ? '#b9b5c9' : stars ? '#ffd45e' : '#fffaf3';
      g.strokeStyle = !open ? '#8f8aa6' : selected ? '#ff7a6b' : '#6a5aa8';
      g.lineWidth = (selected ? 3 : 2) * DPR;
      g.beginPath();
      g.arc(0, 0, r, 0, 7);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = open ? '#2b2850' : '#6f6a86';
      g.font = `800 ${(selected ? 12 : 10.5) * DPR}px "Fredoka Variable", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(open ? String(idx) : '🔒', 0, 0.5 * DPR);
      if (stars) {
        g.fillStyle = '#e8a21a';
        g.font = `700 ${8 * DPR}px system-ui, sans-serif`;
        g.fillText('★'.repeat(stars), 0, r + 8 * DPR);
      }
      g.restore();
    }
  }
}
