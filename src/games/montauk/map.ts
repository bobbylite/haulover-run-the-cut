// The chart: the grounds from above, painted from the baked sea floor. It shows the Point, the shelf and
// the edge, the rips (white), the set of the tide, and only what the captain has actually seen or marked.

import { KNOTS } from '../../core/math';
import type { Game } from '../../game/game';
import { RANGE } from '../../locations/montauk/geography';
import type { FishMode } from './mode';

const X0 = -1500;
const X1 = 3500;
const Z0 = -1800;
const Z1 = 2000;
const W = 380;
const H = Math.round((W * (Z1 - Z0)) / (X1 - X0));

const sx = (x: number): number => ((x - X0) / (X1 - X0)) * W;
const sz = (z: number): number => ((z - Z0) / (Z1 - Z0)) * H;

export class FishMap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');

  constructor(
    private readonly game: Game,
    private readonly mode: FishMode,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.bg.width = W;
    this.bg.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.redraw();
  }

  /** Repaint the static layer (call when the tide changes). */
  redraw(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const img = g.createImageData(W, H);
    for (let py = 0; py < H; py++) {
      const z = Z0 + ((py + 0.5) / H) * (Z1 - Z0);
      for (let px = 0; px < W; px++) {
        const x = X0 + ((px + 0.5) / W) * (X1 - X0);
        const h = geo.heightAt(x, z);
        let r: number;
        let gg: number;
        let b: number;
        if (h >= 0.05) {
          const t = Math.min(1, h / 22);
          r = 244 - 52 * t;
          gg = 230 - 22 * t;
          b = 190 - 30 * t;
        } else {
          const d = -h;
          const t = 1 - Math.exp(-d / 34);
          r = 168 + (52 - 168) * t;
          gg = 236 + (92 - 236) * t;
          b = 222 + (176 - 222) * t;
          const hay = geo.hayAt(x, z);
          const s = Math.min(1, hay * 1.15);
          r += (255 - r) * s * 0.7;
          gg += (255 - gg) * s * 0.7;
          b += (255 - b) * s * 0.7;
        }
        const i = (py * W + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // depth contours every 20 m, softly
    // tidal set arrows
    const tmp = { x: 0, z: 0 };
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.2;
    for (let x = X0 + 420; x < X1; x += 700) {
      for (let z = Z0 + 300; z < Z1; z += 640) {
        this.game.env.currentAt(x, z, tmp);
        const m = Math.hypot(tmp.x, tmp.z);
        if (m < 0.15 || geo.heightAt(x, z) > -3) continue;
        const a = Math.atan2(tmp.z, tmp.x);
        const L = Math.min(22, 6 + m * 9);
        const x0 = sx(x);
        const z0 = sz(z);
        g.beginPath();
        g.moveTo(x0, z0);
        g.lineTo(x0 + Math.cos(a) * L, z0 + Math.sin(a) * L);
        g.stroke();
        g.beginPath();
        const ex = x0 + Math.cos(a) * L;
        const ez = z0 + Math.sin(a) * L;
        g.moveTo(ex, ez);
        g.lineTo(ex + Math.cos(a + 2.6) * 5, ez + Math.sin(a + 2.6) * 5);
        g.lineTo(ex + Math.cos(a - 2.6) * 5, ez + Math.sin(a - 2.6) * 5);
        g.fill();
      }
    }

    // the edge of the grounds
    g.setLineDash([6, 5]);
    g.strokeStyle = 'rgba(255, 143, 176, 0.9)';
    g.lineWidth = 1.8;
    g.strokeRect(sx(-RANGE.x), sz(-RANGE.z), sx(RANGE.x) - sx(-RANGE.x), sz(RANGE.z) - sz(-RANGE.z));
    g.setLineDash([]);

    g.font = '700 12px "Fredoka Variable", system-ui, sans-serif';
    g.fillStyle = 'rgba(40,40,90,0.72)';
    g.textAlign = 'center';
    g.fillText('MONTAUK POINT', sx(-640), sz(-120));
    g.fillText('THE RIPS', sx(1000), sz(110));
    g.fillText('THE EDGE', sx(2650), sz(-760));
    g.fillText('ATLANTIC', sx(2300), sz(1700));
    g.fillText("FRISBEE'S", sx(1500), sz(-1160));
  }

  draw(): void {
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    const m = this.mode;
    const now = m.elapsed;
    // what has been seen: birds, boils and slicks, fading as they age
    for (const s of m.sightings.values()) {
      const age = now - s.t;
      const a = Math.max(0.2, 1 - age / 35);
      const x = sx(s.x);
      const z = sz(s.z);
      g.save();
      g.translate(x, z);
      g.globalAlpha = a;
      if (s.kind === 'boil') {
        g.fillStyle = '#ff6f9c';
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? 4.5 : 10;
          const ang = (i / 10) * Math.PI * 2;
          g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        g.closePath();
        g.fill();
        g.stroke();
      } else if (s.kind === 'birds') {
        g.strokeStyle = '#fff';
        g.fillStyle = 'rgba(70, 70, 140, 0.9)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-8, -2);
        g.quadraticCurveTo(-4, -8, 0, 0);
        g.quadraticCurveTo(4, -8, 8, -2);
        g.stroke();
        g.lineWidth = 1.6;
        g.strokeStyle = 'rgba(70,70,140,0.95)';
        g.stroke();
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.lineWidth = 2;
        g.setLineDash([3, 2]);
        g.beginPath();
        g.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    // marks: pink pins
    for (const mk of m.marks) {
      const x = sx(mk.x);
      const z = sz(mk.z);
      g.fillStyle = '#ff6f9c';
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, z);
      g.lineTo(x - 5, z - 11);
      g.lineTo(x + 5, z - 11);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(x, z - 13, 4, 0, 7);
      g.fill();
      g.stroke();
    }
    // the fish on the line
    const f = m.fight;
    const b = this.game.player;
    if (f) {
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx(b.pos.x), sz(b.pos.z));
      g.lineTo(sx(f.x), sz(f.z));
      g.stroke();
      g.fillStyle = '#ffd45e';
      g.beginPath();
      g.arc(sx(f.x), sz(f.z), 4.5, 0, 7);
      g.fill();
    }
    // the boat
    const x = sx(b.pos.x);
    const z = sz(b.pos.z);
    g.save();
    g.translate(x, z);
    g.rotate(b.heading);
    g.shadowColor = 'rgba(255,120,100,0.9)';
    g.shadowBlur = 10;
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(-7, 6);
    g.lineTo(-3, 0);
    g.lineTo(-7, -6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(30,30,80,0.8)';
    g.font = '600 12px "Fredoka Variable", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${(b.sog * KNOTS).toFixed(0)} kn`, Math.min(W - 44, x + 12), Math.max(14, z - 10));
  }
}
