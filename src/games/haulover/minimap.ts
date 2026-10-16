// Route-strip minimap: a top-down view of the whole course painted from the baked bathymetry,
// with gates, the current's set and the boat.

import { KNOTS } from '../../core/math';
import type { Game } from '../../game/game';
import type { HaulMode } from './mode';

const X0 = -1060;
const X1 = 1140;
const Z0 = -290;
const Z1 = 290;
const W = 880;
const H = Math.round((W * (Z1 - Z0)) / (X1 - X0));

const sx = (x: number): number => ((x - X0) / (X1 - X0)) * W;
const sz = (z: number): number => ((z - Z0) / (Z1 - Z0)) * H;

export class MiniMap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');

  constructor(
    private readonly game: Game,
    private readonly mode: HaulMode,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.bg.width = W;
    this.bg.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.redraw();
  }

  /** Repaint the static layer (call when route / tide change). */
  redraw(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const map = this.game.loc.map;
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
          const t = Math.min(1, h / 3);
          r = 196 - 40 * t;
          gg = 222 - 20 * t;
          b = 160 - 50 * t;
          if (map.bridgeX !== undefined && Math.abs(x - map.bridgeX) < 8) {
            r = 150;
            gg = 148;
            b = 170;
          }
        } else {
          const d = -h;
          const t = 1 - Math.exp(-d / 5);
          r = 150 + (24 - 150) * t;
          gg = 232 + (112 - 232) * t;
          b = 214 + (190 - 214) * t;
          const s = Math.exp(-d * 0.7);
          r += (246 - r) * s * 0.6;
          gg += (232 - gg) * s * 0.6;
          b += (200 - b) * s * 0.6;
        }
        const i = (py * W + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // jetties
    g.strokeStyle = '#8b92a6';
    g.lineWidth = 3;
    g.lineCap = 'round';
    const jet = map.jetties;
    for (const side of jet ? ([-1, 1] as const) : []) {
      if (!jet) break;
      g.beginPath();
      for (let x = jet.x0; x <= jet.x1; x += 20) {
        const px = sx(x);
        const pz = sz(jet.z(side, x));
        if (x === jet.x0) g.moveTo(px, pz);
        else g.lineTo(px, pz);
      }
      g.stroke();
    }

    // tidal set arrows
    const tmp = { x: 0, z: 0 };
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.4;
    for (let x = X0 + 90; x < X1; x += 118) {
      for (let z = -150; z <= 150; z += 75) {
        this.game.env.currentAt(x, z, tmp);
        const m = Math.hypot(tmp.x, tmp.z);
        if (m < 0.25 || this.game.env.geo.heightAt(x, z) > 0) continue;
        const a = Math.atan2(tmp.z, tmp.x);
        const L = Math.min(24, 5 + m * 7);
        const x0 = sx(x);
        const z0 = sz(z);
        g.beginPath();
        g.moveTo(x0, z0);
        g.lineTo(x0 + Math.cos(a) * L, z0 + Math.sin(a) * L);
        g.stroke();
        g.beginPath();
        g.moveTo(x0 + Math.cos(a) * L, z0 + Math.sin(a) * L);
        g.lineTo(x0 + Math.cos(a + 2.6) * 5 + Math.cos(a) * L, z0 + Math.sin(a + 2.6) * 5 + Math.sin(a) * L);
        g.lineTo(x0 + Math.cos(a - 2.6) * 5 + Math.cos(a) * L, z0 + Math.sin(a - 2.6) * 5 + Math.sin(a) * L);
        g.fill();
      }
    }

    // course
    const c = this.mode.course;
    g.setLineDash([7, 6]);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (const [i, p] of c.path.entries()) {
      if (i === 0) g.moveTo(sx(p.x), sz(p.z));
      else g.lineTo(sx(p.x), sz(p.z));
    }
    g.stroke();
    g.setLineDash([]);
    for (const gt of c.gates) {
      const lx = -gt.nz;
      const lz = gt.nx;
      const ax = gt.x - lx * gt.half;
      const az = gt.z - lz * gt.half;
      const bx = gt.x + lx * gt.half;
      const bz = gt.z + lz * gt.half;
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sx(ax), sz(az));
      g.lineTo(sx(bx), sz(bz));
      g.stroke();
      g.fillStyle = '#ff6f7d';
      g.beginPath();
      g.arc(sx(ax), sz(az), 3, 0, 7);
      g.fill();
      g.fillStyle = '#37d6a0';
      g.beginPath();
      g.arc(sx(bx), sz(bz), 3, 0, 7);
      g.fill();
    }
    if (c.dock) {
      // the slip we are heading for, drawn as a dashed berth with an anchor-coloured outline
      g.strokeStyle = '#ffb02a';
      g.lineWidth = 2.5;
      g.setLineDash([4, 3]);
      const sl = c.dock.slip;
      g.strokeRect(
        sx(sl.x0),
        sz(sl.z - sl.half),
        sx(sl.x1) - sx(sl.x0),
        sz(sl.z + sl.half) - sz(sl.z - sl.half),
      );
      g.setLineDash([]);
      g.font = '700 13px "Fredoka Variable", system-ui, sans-serif';
      g.fillStyle = 'rgba(190,100,0,0.95)';
      g.textAlign = 'center';
      g.fillText('MARINA', sx(sl.x0 + 20), sz(sl.z) - 14);
    }
    g.font = '600 15px "Fredoka Variable", system-ui, sans-serif';
    g.fillStyle = 'rgba(40,40,90,0.7)';
    g.textAlign = 'center';
    g.fillText('BISCAYNE BAY', sx(-780), sz(-215));
    g.fillText('HAULOVER PARK', sx(-60), sz(215));
    g.fillText('ATLANTIC', sx(820), sz(-215));
  }

  draw(): void {
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    // other traffic: small white chevrons
    for (const v of this.mode.traffic.vessels) {
      if (v.wait > 0) continue;
      g.save();
      g.translate(sx(v.boat.pos.x), sz(v.boat.pos.z));
      g.rotate(v.boat.heading);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.strokeStyle = 'rgba(40,60,120,0.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-5, 4.5);
      g.lineTo(-5, -4.5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
    const b = this.game.player;
    const x = sx(b.pos.x);
    const z = sz(b.pos.z);
    g.save();
    g.translate(x, z);
    g.rotate(b.heading);
    g.shadowColor = 'rgba(255,120,100,0.9)';
    g.shadowBlur = 10;
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(11, 0);
    g.lineTo(-8, 7);
    g.lineTo(-4, 0);
    g.lineTo(-8, -7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // current speed tag
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(30,30,80,0.8)';
    g.font = '600 13px "Fredoka Variable", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`${(b.sog * KNOTS).toFixed(0)} kn`, Math.min(W - 52, x + 14), Math.max(14, z - 12));
  }
}
