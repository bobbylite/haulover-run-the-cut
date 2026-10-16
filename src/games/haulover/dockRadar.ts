// Docking radar: a zoomed top-down view of the marina basin with the pilings, piers, moored boats,
// the harbour traffic, your hull, and a ghost of where the boat has to end up.

import type { Game } from '../../game/game';
import type { Harbor, SlipBerth } from '../../locations/types';
import type { HaulMode } from './mode';

const CSS_W = 300;
const DPR = 2;

export class DockRadar {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');

  private readonly harbor: Harbor;
  private readonly berth: SlipBerth;
  private readonly X0: number;
  private readonly X1: number;
  private readonly Z0: number;
  private readonly Z1: number;
  private readonly W: number;
  private readonly H: number;
  private readonly sx: (x: number) => number;
  private readonly sz: (z: number) => number;
  private readonly px: (m: number) => number;

  constructor(
    private readonly game: Game,
    private readonly mode: HaulMode,
  ) {
    const harbor = game.loc.harbor;
    if (!harbor) throw new Error('DockRadar needs a location with a harbor');
    this.harbor = harbor;
    this.berth = harbor.berths[0] as SlipBerth;
    const v = harbor.view;
    this.X0 = v.x0;
    this.X1 = v.x1;
    this.Z0 = v.z0;
    this.Z1 = v.z1;
    const CSS_H = Math.round((CSS_W * (v.z1 - v.z0)) / (v.x1 - v.x0));
    this.W = CSS_W * DPR;
    this.H = CSS_H * DPR;
    const { W } = this;
    this.sx = (x) => ((x - v.x0) / (v.x1 - v.x0)) * W;
    this.sz = (z) => ((z - v.z0) / (v.z1 - v.z0)) * this.H;
    this.px = (m) => (m / (v.x1 - v.x0)) * W;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = `${CSS_W}px`;
    this.canvas.style.height = `${CSS_H}px`;
    this.bg.width = this.W;
    this.bg.height = this.H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.paintStatic();
  }

  private paintStatic(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const img = g.createImageData(this.W, this.H);
    const step = 3;
    for (let py = 0; py < this.H; py += step) {
      const z = this.Z0 + ((py + step / 2) / this.H) * (this.Z1 - this.Z0);
      for (let pxx = 0; pxx < this.W; pxx += step) {
        const x = this.X0 + ((pxx + step / 2) / this.W) * (this.X1 - this.X0);
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
        for (let dy = 0; dy < step && py + dy < this.H; dy++) {
          for (let dx = 0; dx < step && pxx + dx < this.W; dx++) {
            const i = ((py + dy) * this.W + pxx + dx) * 4;
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
    for (const d of this.harbor.docks) {
      g.fillRect(
        this.sx(d.x - d.hx),
        this.sz(d.z - d.hz),
        this.px(d.hx * 2),
        ((d.hz * 2) / (this.Z1 - this.Z0)) * this.H,
      );
      g.strokeRect(
        this.sx(d.x - d.hx),
        this.sz(d.z - d.hz),
        this.px(d.hx * 2),
        ((d.hz * 2) / (this.Z1 - this.Z0)) * this.H,
      );
    }
    // moored boats
    for (const m of this.harbor.moored) {
      g.save();
      g.translate(this.sx(m.x), this.sz(m.z));
      g.rotate(m.yaw);
      g.fillStyle = '#f1ece4';
      g.strokeStyle = '#6a7a99';
      g.lineWidth = 1.2 * DPR;
      const l = this.px(m.length);
      const b = this.px(m.beam);
      g.beginPath();
      g.roundRect(-l / 2, -b / 2, l, b, b * 0.45);
      g.fill();
      g.stroke();
      g.restore();
    }
    // pilings (drawn bigger than life so they read)
    for (const p of this.harbor.pilings) {
      if (p.r > 1) continue; // boat hulls are drawn above
      if (p.x < this.X0 || p.x > this.X1 || p.z < this.Z0 || p.z > this.Z1) continue;
      g.fillStyle = '#5a4030';
      g.beginPath();
      g.arc(this.sx(p.x), this.sz(p.z), Math.max(2.6 * DPR, this.px(p.r * 1.8)), 0, 7);
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
    const st = this.mode.docking.status;
    const b = game.player;
    const ok = st.posOk && st.alignOk && st.speedOk;
    const t = performance.now() / 1000;

    // the target slip and berth ghost
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    g.fillStyle = ok ? 'rgba(80,230,160,0.35)' : `rgba(255,240,120,${0.16 + 0.14 * pulse})`;
    g.fillRect(
      this.sx(this.berth.x0),
      this.sz(this.berth.z - this.berth.half),
      this.px(this.berth.x1 - this.berth.x0),
      ((this.berth.half * 2) / (this.Z1 - this.Z0)) * this.H,
    );
    g.setLineDash([6 * DPR, 5 * DPR]);
    g.strokeStyle = ok ? '#1fcf86' : '#ff8f2a';
    g.lineWidth = 2 * DPR;
    g.strokeRect(
      this.sx(this.berth.x0),
      this.sz(this.berth.z - this.berth.half),
      this.px(this.berth.x1 - this.berth.x0),
      ((this.berth.half * 2) / (this.Z1 - this.Z0)) * this.H,
    );
    g.setLineDash([]);
    const L = this.px(b.spec.length);
    const B = this.px(b.spec.beam);
    g.save();
    g.translate(this.sx(st.berthX), this.sz(st.berthZ));
    g.strokeStyle = ok ? '#1fcf86' : '#ff8f2a';
    g.setLineDash([4 * DPR, 3 * DPR]);
    g.lineWidth = 2 * DPR;
    g.beginPath();
    g.roundRect(-L / 2, -B / 2, L, B, B * 0.4);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    // harbour traffic and anything else afloat
    for (const v of this.mode.traffic.vessels) {
      if (v.wait > 0) continue;
      const vb = v.boat;
      if (
        vb.pos.x < this.X0 - 10 ||
        vb.pos.x > this.X1 + 10 ||
        vb.pos.z < this.Z0 - 10 ||
        vb.pos.z > this.Z1 + 10
      )
        continue;
      g.save();
      g.translate(this.sx(vb.pos.x), this.sz(vb.pos.z));
      g.rotate(vb.heading);
      g.fillStyle = '#ff6b6b';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.6 * DPR;
      const l = Math.max(this.px(vb.spec.length), 12 * DPR);
      const w = Math.max(this.px(vb.spec.beam), 7 * DPR);
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
    g.translate(this.sx(b.pos.x), this.sz(b.pos.z));
    g.strokeStyle = 'rgba(40,40,100,0.7)';
    g.lineWidth = 2 * DPR;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(this.px(b.vel.x * 3), ((b.vel.z * 3) / (this.Z1 - this.Z0)) * this.H);
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
    g.fillText(
      this.berth.label.toUpperCase(),
      this.sx(this.berth.x0) + 4 * DPR,
      this.sz(this.berth.z - this.berth.half) - 5 * DPR,
    );
  }
}
