// Docking radar: a zoomed top-down view of the marina basin with the pilings, piers, moored boats,
// the harbour traffic, your hull, and a ghost of where the boat has to end up.

import type { Game } from '../game/game';
import { DOCKS, MOORED, PILINGS, SLIP } from '../sim/geography';

const X0 = -575;
const X1 = -362;
const Z0 = 18;
const Z1 = 246;
const CSS_W = 300;
const CSS_H = Math.round((CSS_W * (Z1 - Z0)) / (X1 - X0));
const DPR = 2;
const W = CSS_W * DPR;
const H = CSS_H * DPR;

const sx = (x: number): number => ((x - X0) / (X1 - X0)) * W;
const sz = (z: number): number => ((z - Z0) / (Z1 - Z0)) * H;
const px = (m: number): number => (m / (X1 - X0)) * W;

export class DockRadar {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');

  constructor(private readonly game: Game) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${CSS_W}px`;
    this.canvas.style.height = `${CSS_H}px`;
    this.bg.width = W;
    this.bg.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.paintStatic();
  }

  private paintStatic(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const img = g.createImageData(W, H);
    const step = 3;
    for (let py = 0; py < H; py += step) {
      const z = Z0 + ((py + step / 2) / H) * (Z1 - Z0);
      for (let pxx = 0; pxx < W; pxx += step) {
        const x = X0 + ((pxx + step / 2) / W) * (X1 - X0);
        const h = geo.heightAt(x, z);
        let r: number;
        let gg: number;
        let b: number;
        if (h >= 0.05) {
          r = 232;
          gg = 220;
          b = 176;
        } else {
          const t = Math.min(1, -h / 3.4);
          r = 156 + (60 - 156) * t;
          gg = 226 + (176 - 226) * t;
          b = 222 + (206 - 222) * t;
        }
        for (let dy = 0; dy < step && py + dy < H; dy++) {
          for (let dx = 0; dx < step && pxx + dx < W; dx++) {
            const i = ((py + dy) * W + pxx + dx) * 4;
            img.data[i] = r;
            img.data[i + 1] = gg;
            img.data[i + 2] = b;
            img.data[i + 3] = 255;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    // finger piers + spine
    g.fillStyle = '#c99a62';
    g.strokeStyle = '#7a5a3a';
    g.lineWidth = 1.5 * DPR;
    for (const d of DOCKS) {
      g.fillRect(sx(d.x - d.hx), sz(d.z - d.hz), px(d.hx * 2), ((d.hz * 2) / (Z1 - Z0)) * H);
      g.strokeRect(sx(d.x - d.hx), sz(d.z - d.hz), px(d.hx * 2), ((d.hz * 2) / (Z1 - Z0)) * H);
    }
    // moored boats
    for (const m of MOORED) {
      g.save();
      g.translate(sx(m.x), sz(m.z));
      g.rotate(m.yaw);
      g.fillStyle = '#f1ece4';
      g.strokeStyle = '#6a7a99';
      g.lineWidth = 1.2 * DPR;
      const l = px(m.length);
      const b = px(m.beam);
      g.beginPath();
      g.roundRect(-l / 2, -b / 2, l, b, b * 0.45);
      g.fill();
      g.stroke();
      g.restore();
    }
    // pilings (drawn bigger than life so they read)
    for (const p of PILINGS) {
      if (p.r > 1) continue; // boat hulls are drawn above
      if (p.x < X0 || p.x > X1 || p.z < Z0 || p.z > Z1) continue;
      g.fillStyle = '#5a4030';
      g.beginPath();
      g.arc(sx(p.x), sz(p.z), Math.max(2.6 * DPR, px(p.r * 1.8)), 0, 7);
      g.fill();
      g.strokeStyle = '#e9d9bf';
      g.lineWidth = 1 * DPR;
      g.stroke();
    }
  }

  draw(): void {
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    const game = this.game;
    const st = game.docking.status;
    const b = game.player;
    const ok = st.posOk && st.alignOk && st.speedOk;
    const t = performance.now() / 1000;

    // the target slip and berth ghost
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    g.fillStyle = ok ? 'rgba(80,230,160,0.35)' : `rgba(255,240,120,${0.16 + 0.14 * pulse})`;
    g.fillRect(sx(SLIP.x0), sz(SLIP.z - SLIP.half), px(SLIP.x1 - SLIP.x0), ((SLIP.half * 2) / (Z1 - Z0)) * H);
    g.setLineDash([6 * DPR, 5 * DPR]);
    g.strokeStyle = ok ? '#1fcf86' : '#ff8f2a';
    g.lineWidth = 2 * DPR;
    g.strokeRect(
      sx(SLIP.x0),
      sz(SLIP.z - SLIP.half),
      px(SLIP.x1 - SLIP.x0),
      ((SLIP.half * 2) / (Z1 - Z0)) * H,
    );
    g.setLineDash([]);
    const L = px(b.spec.length);
    const B = px(b.spec.beam);
    g.save();
    g.translate(sx(st.berthX), sz(st.berthZ));
    g.strokeStyle = ok ? '#1fcf86' : '#ff8f2a';
    g.setLineDash([4 * DPR, 3 * DPR]);
    g.lineWidth = 2 * DPR;
    g.beginPath();
    g.roundRect(-L / 2, -B / 2, L, B, B * 0.4);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    // harbour traffic and anything else afloat
    for (const v of game.traffic.vessels) {
      if (v.wait > 0) continue;
      const vb = v.boat;
      if (vb.pos.x < X0 - 10 || vb.pos.x > X1 + 10 || vb.pos.z < Z0 - 10 || vb.pos.z > Z1 + 10) continue;
      g.save();
      g.translate(sx(vb.pos.x), sz(vb.pos.z));
      g.rotate(vb.heading);
      g.fillStyle = '#ff6b6b';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.6 * DPR;
      const l = Math.max(px(vb.spec.length), 12 * DPR);
      const w = Math.max(px(vb.spec.beam), 7 * DPR);
      g.beginPath();
      g.moveTo(l / 2, 0);
      g.lineTo(-l / 2, w / 2);
      g.lineTo(-l / 2, -w / 2);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    // your boat, with a velocity whisker
    g.save();
    g.translate(sx(b.pos.x), sz(b.pos.z));
    g.strokeStyle = 'rgba(40,40,100,0.7)';
    g.lineWidth = 2 * DPR;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(px(b.vel.x * 3), ((b.vel.z * 3) / (Z1 - Z0)) * H);
    g.stroke();
    g.rotate(b.heading);
    g.shadowColor = 'rgba(255,110,90,0.9)';
    g.shadowBlur = 8 * DPR;
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * DPR;
    const hl = Math.max(L, 14 * DPR);
    const hw = Math.max(B, 8 * DPR);
    g.beginPath();
    g.moveTo(hl / 2, 0);
    g.quadraticCurveTo(hl * 0.2, hw / 2, -hl / 2, hw / 2);
    g.lineTo(-hl / 2, -hw / 2);
    g.quadraticCurveTo(hl * 0.2, -hw / 2, hl / 2, 0);
    g.fill();
    g.stroke();
    g.restore();

    g.font = `700 ${11 * DPR}px "Fredoka Variable", system-ui, sans-serif`;
    g.fillStyle = 'rgba(40,40,90,0.75)';
    g.textAlign = 'left';
    g.fillText('SLIP 3', sx(SLIP.x0) + 4 * DPR, sz(SLIP.z - SLIP.half) - 5 * DPR);
  }
}
