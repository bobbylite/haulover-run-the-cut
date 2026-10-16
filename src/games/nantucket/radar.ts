// The berthing radar: a top-down square of harbour centred on the target berth, zoomed to your distance. It
// shows the quays and moored hulls, the set of the tide, the ghost of where your hull has to end up, your own
// hull with its velocity whisker, and where full astern would stop you. Everything a ship's captain would want
// on the bridge-wing display.

import { berthTarget } from '../../game/berthing';
import type { Game } from '../../game/game';
import { BUOYS, DOCKS, MOORED, MOORINGS } from '../../locations/nantucket/geography';
import type { NantMode } from './mode';

const CSS = 300;
const DPR = 2;
const PX = CSS * DPR;
/** The zoom steps (half-width of the window, m); the radar snaps between them so the background is cached. */
const ZOOMS = [45, 70, 105, 160, 240, 360, 520];

export class NantRadar {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');
  private cx = 0;
  private cz = 0;
  private half = 0;
  private bgKey = '';
  private cxN = 0;
  private czN = 0;
  private readonly cur = { x: 0, z: 0 };

  constructor(
    private readonly game: Game,
    private readonly mode: NantMode,
  ) {
    this.canvas.width = PX;
    this.canvas.height = PX;
    this.canvas.style.width = `${CSS}px`;
    this.canvas.style.height = `${CSS}px`;
    this.bg.width = PX;
    this.bg.height = PX;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  private sx = (x: number): number => ((x - this.cx) / (2 * this.half) + 0.5) * PX;
  private sz = (z: number): number => ((z - this.cz) / (2 * this.half) + 0.5) * PX;
  private pm = (m: number): number => (m / (2 * this.half)) * PX;

  /** Redraw the cached chart for a window. */
  private paintStatic(): void {
    const g = this.bg.getContext('2d') as CanvasRenderingContext2D;
    const geo = this.game.env.geo;
    const img = g.createImageData(PX, PX);
    const step = 4;
    for (let py = 0; py < PX; py += step) {
      const z = this.cz + ((py + step / 2) / PX - 0.5) * 2 * this.half;
      for (let pxx = 0; pxx < PX; pxx += step) {
        const x = this.cx + ((pxx + step / 2) / PX - 0.5) * 2 * this.half;
        const h = geo.heightAt(x, z);
        let r: number;
        let gg: number;
        let b: number;
        if (h >= 0.05) {
          r = 232;
          gg = 222;
          b = 190;
        } else {
          const t = Math.min(1, -h / 9);
          r = 168 + (62 - 168) * t;
          gg = 230 + (160 - 230) * t;
          b = 226 + (205 - 226) * t;
          // water too shallow for THIS hull (its keel plus a metre) gets a sandy wash: a place to ground
          const safe = this.mode.spec.keelDepth + 1.0;
          if (-h < safe) {
            const sh = 1 - Math.max(0, (-h - 0.05) / (safe - 0.05));
            r += (240 - r) * sh * 0.75;
            gg += (214 - gg) * sh * 0.75;
            b += (178 - b) * sh * 0.75;
          }
        }
        for (let dy = 0; dy < step && py + dy < PX; dy++) {
          for (let dx = 0; dx < step && pxx + dx < PX; dx++) {
            const i = ((py + dy) * PX + pxx + dx) * 4;
            img.data[i] = r;
            img.data[i + 1] = gg;
            img.data[i + 2] = b;
            img.data[i + 3] = 255;
          }
        }
      }
    }
    g.putImageData(img, 0, 0);
    // piers
    g.fillStyle = '#d6a76a';
    g.strokeStyle = '#7a5a3a';
    g.lineWidth = 1.5 * DPR;
    for (const d of DOCKS) {
      const x = this.sx(d.x - d.hx);
      const y = this.sz(d.z - d.hz);
      const w = this.pm(d.hx * 2);
      const h = this.pm(d.hz * 2);
      if (x > PX || y > PX || x + w < 0 || y + h < 0) continue;
      g.fillRect(x, y, Math.max(w, 1.5 * DPR), Math.max(h, 1.5 * DPR));
      if (d.hx > 2) g.strokeRect(x, y, w, h);
    }
    // moored hulls
    for (const m of MOORED) {
      if (Math.abs(m.x - this.cx) > this.half + 20 || Math.abs(m.z - this.cz) > this.half + 20) continue;
      g.save();
      g.translate(this.sx(m.x), this.sz(m.z));
      g.rotate(m.yaw);
      g.fillStyle = '#f6f1ea';
      g.strokeStyle = '#6a7a99';
      g.lineWidth = 1.1 * DPR;
      const l = Math.max(this.pm(m.length), 4 * DPR);
      const b = Math.max(this.pm(m.beam), 2.4 * DPR);
      g.beginPath();
      g.roundRect(-l / 2, -b / 2, l, b, b * 0.45);
      g.fill();
      g.stroke();
      g.restore();
    }
    // mooring balls and buoys
    for (const m of MOORINGS) {
      if (Math.abs(m.x - this.cx) > this.half || Math.abs(m.z - this.cz) > this.half) continue;
      g.fillStyle = '#ff9a84';
      g.beginPath();
      g.arc(this.sx(m.x), this.sz(m.z), Math.max(2 * DPR, this.pm(0.8)), 0, 7);
      g.fill();
    }
    for (const b of BUOYS) {
      if (Math.abs(b.x - this.cx) > this.half || Math.abs(b.z - this.cz) > this.half) continue;
      g.fillStyle = b.kind === 'nun' ? '#ff7d86' : '#62d9a8';
      g.beginPath();
      g.arc(this.sx(b.x), this.sz(b.z), 3 * DPR, 0, 7);
      g.fill();
    }
  }

  private roundHull(g: CanvasRenderingContext2D, L: number, B: number): void {
    g.beginPath();
    g.moveTo(L / 2, 0);
    g.quadraticCurveTo(L * 0.2, B / 2, -L / 2, B / 2);
    g.lineTo(-L / 2, -B / 2);
    g.quadraticCurveTo(L * 0.2, -B / 2, L / 2, 0);
  }

  draw(): void {
    const game = this.game;
    const mode = this.mode;
    const b = game.player;
    const st = mode.session.status;
    const berth = mode.berth;
    const tg = berthTarget(berth, mode.spec);
    // window: on the berth when you are near it, drifting towards the midpoint (so both fit) as you get far;
    // the centre snaps to a coarse grid and the zoom to steps so the chart is only repainted now and then
    const dist = Math.hypot(b.pos.x - tg.x, b.pos.z - tg.z);
    const far = Math.min(1, Math.max(0, (dist - berth.radar) / (berth.radar * 2.2)));
    const mx = tg.x + ((b.pos.x - tg.x) / 2) * far;
    const mz = tg.z + ((b.pos.z - tg.z) / 2) * far;
    const reach = (x: number, z: number, cx: number, cz: number): number =>
      Math.max(Math.abs(x - cx), Math.abs(z - cz));
    let half = berth.radar;
    for (let pass = 0; pass < 2; pass++) {
      const snap = Math.max(10, half / 3);
      this.cxN = Math.round(mx / snap) * snap;
      this.czN = Math.round(mz / snap) * snap;
      const need = Math.max(
        berth.radar,
        reach(b.pos.x, b.pos.z, this.cxN, this.czN) * 1.18,
        reach(tg.x, tg.z, this.cxN, this.czN) * 1.18,
      );
      half = ZOOMS.find((z) => z >= need) ?? (ZOOMS[ZOOMS.length - 1] as number);
    }
    const key = `${mode.level.id}:${mode.spec.id}:${half}:${this.cxN}:${this.czN}`;
    if (key !== this.bgKey) {
      this.bgKey = key;
      this.half = half;
      this.cx = this.cxN;
      this.cz = this.czN;
      this.paintStatic();
    }
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    const ok = st.posOk && st.alignOk && st.speedOk;
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);

    // the set of the tide and the wind: a grid of little arrows
    g.save();
    g.strokeStyle = 'rgba(30,70,160,0.34)';
    g.fillStyle = 'rgba(30,70,160,0.34)';
    g.lineWidth = 1.3 * DPR;
    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 4; j++) {
        const x = this.cx + ((i / 5) * 2 - 1) * this.half;
        const z = this.cz + ((j / 5) * 2 - 1) * this.half;
        game.env.currentAt(x, z, this.cur);
        const sp = Math.hypot(this.cur.x, this.cur.z);
        if (sp < 0.04) continue;
        const len = Math.min(26 * DPR, 9 * DPR + sp * 26 * DPR);
        const ux = this.cur.x / sp;
        const uz = this.cur.z / sp;
        const px = this.sx(x);
        const py = this.sz(z);
        g.beginPath();
        g.moveTo(px - (ux * len) / 2, py - (uz * len) / 2);
        g.lineTo(px + (ux * len) / 2, py + (uz * len) / 2);
        g.stroke();
        g.beginPath();
        g.moveTo(px + (ux * len) / 2, py + (uz * len) / 2);
        g.lineTo(
          px + (ux * len) / 2 - ux * 5 * DPR - uz * 3 * DPR,
          py + (uz * len) / 2 - uz * 5 * DPR + ux * 3 * DPR,
        );
        g.lineTo(
          px + (ux * len) / 2 - ux * 5 * DPR + uz * 3 * DPR,
          py + (uz * len) / 2 - uz * 5 * DPR - ux * 3 * DPR,
        );
        g.closePath();
        g.fill();
      }
    }
    g.restore();

    // the approach hint, dotted
    if (berth.approach.length > 1) {
      g.setLineDash([4 * DPR, 6 * DPR]);
      g.strokeStyle = 'rgba(80,60,160,0.35)';
      g.lineWidth = 1.5 * DPR;
      g.beginPath();
      for (const [k, [x, z]] of berth.approach.entries()) {
        if (k === 0) g.moveTo(this.sx(x), this.sz(z));
        else g.lineTo(this.sx(x), this.sz(z));
      }
      g.stroke();
      g.setLineDash([]);
    }

    // the target: the footprint the hull has to fill (a ring for a mooring)
    const L = this.pm(mode.spec.length);
    const B = this.pm(mode.spec.beam);
    const col = ok ? '#1fcf86' : '#ff8f2a';
    g.save();
    if (berth.kind === 'mooring') {
      g.translate(this.sx(berth.x), this.sz(berth.z));
      g.strokeStyle = col;
      g.lineWidth = 2.4 * DPR;
      g.setLineDash([5 * DPR, 4 * DPR]);
      g.beginPath();
      g.arc(0, 0, Math.max(this.pm(berth.width), 9 * DPR), 0, 7);
      g.stroke();
      g.fillStyle = ok ? 'rgba(80,230,160,0.4)' : `rgba(255,200,80,${0.2 + 0.2 * pulse})`;
      g.fill();
    } else {
      g.translate(this.sx(tg.x), this.sz(tg.z));
      g.rotate(tg.heading);
      g.strokeStyle = col;
      g.lineWidth = 2.4 * DPR;
      g.setLineDash([6 * DPR, 4 * DPR]);
      g.beginPath();
      g.roundRect(-L / 2, -B / 2, L, B, B * 0.4);
      g.stroke();
      g.fillStyle = ok ? 'rgba(80,230,160,0.35)' : `rgba(255,240,120,${0.12 + 0.14 * pulse})`;
      g.fill();
    }
    g.restore();

    // harbour traffic
    for (const v of mode.traffic.vessels) {
      if (v.wait > 0) continue;
      const vb = v.boat;
      if (Math.abs(vb.pos.x - this.cx) > this.half + 20 || Math.abs(vb.pos.z - this.cz) > this.half + 20)
        continue;
      g.save();
      g.translate(this.sx(vb.pos.x), this.sz(vb.pos.z));
      g.rotate(vb.heading);
      g.fillStyle = '#ff6b6b';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.6 * DPR;
      const l = Math.max(this.pm(vb.spec.length), 12 * DPR);
      const w = Math.max(this.pm(vb.spec.beam), 7 * DPR);
      g.beginPath();
      g.moveTo(l / 2, 0);
      g.lineTo(-l / 2, w / 2);
      g.lineTo(-l / 2, -w / 2);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    // your vessel, with the whisker of where it is heading and the dot where full astern would stop it
    const bx = this.sx(b.pos.x);
    const bz = this.sz(b.pos.z);
    const inside = bx > 8 * DPR && bx < PX - 8 * DPR && bz > 8 * DPR && bz < PX - 8 * DPR;
    g.save();
    const px = Math.min(PX - 10 * DPR, Math.max(10 * DPR, bx));
    const pz = Math.min(PX - 10 * DPR, Math.max(10 * DPR, bz));
    g.translate(px, pz);
    const vs = Math.hypot(b.vel.x, b.vel.z);
    if (inside && vs > 0.08) {
      const ux = b.vel.x / vs;
      const uz = b.vel.z / vs;
      g.strokeStyle = 'rgba(40,40,100,0.75)';
      g.lineWidth = 2 * DPR;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(this.pm(b.vel.x * 6), this.pm(b.vel.z * 6));
      g.stroke();
      // where full astern brings it to rest
      g.fillStyle = st.stopDist > st.dist * 0.9 ? '#e0405a' : '#2b3d8a';
      g.beginPath();
      g.arc(this.pm(ux * st.stopDist), this.pm(uz * st.stopDist), 4.4 * DPR, 0, 7);
      g.fill();
    }
    // a halo so your own hull never gets lost among the traffic
    g.strokeStyle = `rgba(255,122,107,${0.35 + 0.3 * pulse})`;
    g.lineWidth = 2.4 * DPR;
    g.beginPath();
    g.arc(0, 0, Math.max(L * 0.62, 17 * DPR), 0, 7);
    g.stroke();
    g.rotate(b.heading);
    g.shadowColor = 'rgba(255,110,90,0.9)';
    g.shadowBlur = inside ? 8 * DPR : 0;
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.2 * DPR;
    this.roundHull(g, Math.max(L, 18 * DPR), Math.max(B, 10 * DPR));
    g.fill();
    g.stroke();
    g.restore();

    // scale bar and north
    g.fillStyle = 'rgba(40,40,90,0.8)';
    g.strokeStyle = 'rgba(40,40,90,0.8)';
    g.lineWidth = 2 * DPR;
    const bar = this.half > 200 ? 100 : this.half > 100 ? 50 : this.half > 60 ? 20 : 10;
    g.beginPath();
    g.moveTo(10 * DPR, PX - 12 * DPR);
    g.lineTo(10 * DPR + this.pm(bar), PX - 12 * DPR);
    g.stroke();
    g.font = `700 ${11 * DPR}px "Fredoka Variable", system-ui, sans-serif`;
    g.textAlign = 'left';
    g.fillText(`${bar} m`, 10 * DPR, PX - 18 * DPR);
    g.textAlign = 'right';
    g.fillText('N ↑', PX - 10 * DPR, 18 * DPR);
    g.textAlign = 'left';
    g.fillText(berth.label.toUpperCase(), 10 * DPR, 18 * DPR);
  }
}
