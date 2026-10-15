// On-screen controls for touch devices: a steering pad, a throttle lever and a few buttons. They only
// appear on coarse-pointer devices while a run is under way, and feed the same Input the keyboard does.

import type { Game } from '../game/game';

export const isTouchDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function mountTouchControls(root: HTMLElement, game: Game): void {
  if (!isTouchDevice()) return;
  root.classList.add('touch-device');
  const el = document.createElement('div');
  el.className = 'touch-controls';
  el.innerHTML = `
    <div class="t-steer" id="tSteer" aria-label="Steer"><i></i><span>STEER</span></div>
    <div class="t-thr" id="tThr" aria-label="Throttle"><b></b><i></i><span>THR</span></div>
    <div class="t-btns">
      <button id="tPump">Pump</button>
      <button id="tCam">Cam</button>
      <button id="tRes">Respawn</button>
      <button id="tPause">Pause</button>
    </div>`;
  root.appendChild(el);

  const input = game.input;
  const steer = el.querySelector<HTMLElement>('#tSteer') as HTMLElement;
  const thr = el.querySelector<HTMLElement>('#tThr') as HTMLElement;
  const steerKnob = steer.querySelector('i') as HTMLElement;
  const thrFill = thr.querySelector('b') as HTMLElement;
  const thrKnob = thr.querySelector('i') as HTMLElement;

  // steering: drag left/right of the pad centre; springs back on release
  let steerId = -1;
  const setSteer = (e: PointerEvent): void => {
    const r = steer.getBoundingClientRect();
    const v = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.15;
    input.touchSteer = Math.max(-1, Math.min(1, v));
  };
  steer.addEventListener('pointerdown', (e) => {
    steerId = e.pointerId;
    steer.setPointerCapture(e.pointerId);
    setSteer(e);
  });
  steer.addEventListener('pointermove', (e) => {
    if (e.pointerId === steerId) setSteer(e);
  });
  const endSteer = (e: PointerEvent): void => {
    if (e.pointerId !== steerId) return;
    steerId = -1;
    input.touchSteer = null;
  };
  steer.addEventListener('pointerup', endSteer);
  steer.addEventListener('pointercancel', endSteer);

  // throttle lever: stays where it is left, like the real one. Bottom 20% is reverse.
  let thrId = -1;
  const setThr = (e: PointerEvent): void => {
    const r = thr.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top) / r.height; // 0 bottom .. 1 top
    input.touchThrottle = Math.max(-0.4, Math.min(1, (t - 0.2) / 0.8));
  };
  thr.addEventListener('pointerdown', (e) => {
    thrId = e.pointerId;
    thr.setPointerCapture(e.pointerId);
    setThr(e);
  });
  thr.addEventListener('pointermove', (e) => {
    if (e.pointerId === thrId) setThr(e);
  });
  const endThr = (e: PointerEvent): void => {
    if (e.pointerId === thrId) thrId = -1;
  };
  thr.addEventListener('pointerup', endThr);
  thr.addEventListener('pointercancel', endThr);

  const hold = (id: string, set: (on: boolean) => void): void => {
    const b = el.querySelector<HTMLElement>(id) as HTMLElement;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      set(true);
    });
    const up = (): void => set(false);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  };
  hold('#tPump', (on) => {
    input.touchPump = on;
  });
  const tap = (id: string, fn: () => void): void => {
    (el.querySelector(id) as HTMLElement).addEventListener('click', fn);
  };
  tap('#tCam', () => game.cycleCamera());
  tap('#tRes', () => game.respawn());
  tap('#tPause', () => game.togglePause());

  // mirror the live lever / wheel back onto the pads
  const sync = (): void => {
    const t = Math.max(-0.4, Math.min(1, input.throttle));
    const frac = 0.2 + t * 0.8;
    thrFill.style.height = `${Math.max(0, frac) * 100}%`;
    thrKnob.style.bottom = `${Math.max(0, frac) * 100}%`;
    steerKnob.style.transform = `translateX(${input.steer * 38}%)`;
    requestAnimationFrame(sync);
  };
  sync();
}
