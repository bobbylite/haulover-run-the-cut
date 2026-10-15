// Keyboard, gamepad and pointer input -> boat controls + camera orbit.
// Throttle is a persistent lever (W/S move it, Space cuts it) like a real helm.

import { clamp, damp } from '../core/math';

export interface Controls {
  throttle: number;
  steer: number;
  sheet: number;
  pump: boolean;
}

export type Action = 'camera' | 'reset' | 'pause' | 'hud' | 'mute' | 'photo' | 'sail' | 'quality';

const ACTIONS: Record<string, Action> = {
  KeyC: 'camera',
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'hud',
  KeyM: 'mute',
  KeyF: 'sail',
  KeyG: 'quality',
  F2: 'photo',
};

export class Input {
  throttle = 0;
  steer = 0;
  sheet = 0.5;
  pump = false;
  /** User camera offsets (radians) from dragging; they relax back after a moment. */
  orbitYaw = 0;
  orbitPitch = 0;
  zoom = 1;
  dragging = false;
  lastOrbit = -10;
  /** Active input device label for UI hints. */
  device: 'keyboard' | 'gamepad' = 'keyboard';
  enabled = false;
  /** On-screen controls: steer is -1..1 while touched, throttle is a one-shot lever position. */
  touchSteer: number | null = null;
  touchThrottle: number | null = null;
  touchPump = false;

  private readonly keys = new Set<string>();
  private readonly listeners = new Map<Action, Array<() => void>>();
  private steerRaw = 0;
  private dragId = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(readonly el: HTMLElement) {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointermove', this.onPointerMove);
    addEventListener('pointerup', this.onPointerUp);
    addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  on(action: Action, fn: () => void): void {
    const l = this.listeners.get(action) ?? [];
    l.push(fn);
    this.listeners.set(action, l);
  }

  private fire(a: Action): void {
    for (const fn of this.listeners.get(a) ?? []) fn();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.device = 'keyboard';
      const a = ACTIONS[e.code];
      if (a) this.fire(a);
    }
    this.keys.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.dragging = true;
    this.dragId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.orbitYaw = clamp(this.orbitYaw - dx * 0.006, -Math.PI, Math.PI);
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -0.2, 0.9);
    this.lastOrbit = performance.now() / 1000;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.dragId) this.dragging = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.zoom = clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.55, 1.9);
  };

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Per-frame integration of the lever / wheel / sheet from raw input. */
  update(dt: number): void {
    // gamepad
    const pad = navigator.getGamepads?.().find((p) => p?.connected) ?? null;
    let padThrottle: number | null = null;
    let padSteer = 0;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      padSteer = Math.abs(ax) > 0.12 ? ax : 0;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) padThrottle = rt - lt * 0.4;
      this.pump = this.pump || !!pad.buttons[0]?.pressed;
      if (Math.abs(ax) > 0.2 || rt > 0.2) this.device = 'gamepad';
      if (pad.buttons[3]?.pressed && !this.padY) this.fire('reset');
      if (pad.buttons[2]?.pressed && !this.padX) this.fire('camera');
      if (pad.buttons[9]?.pressed && !this.padStart) this.fire('pause');
      this.padY = !!pad.buttons[3]?.pressed;
      this.padX = !!pad.buttons[2]?.pressed;
      this.padStart = !!pad.buttons[9]?.pressed;
    }

    if (this.enabled) {
      // throttle lever
      if (this.touchThrottle !== null) {
        this.throttle = this.touchThrottle;
        this.touchThrottle = null;
      } else if (padThrottle !== null) {
        this.throttle += (padThrottle - this.throttle) * damp(10, dt);
      } else {
        if (this.down('KeyW', 'ArrowUp')) this.throttle += 0.6 * dt;
        if (this.down('KeyS', 'ArrowDown')) this.throttle -= 0.9 * dt;
        if (this.down('Space', 'KeyX')) this.throttle += (0 - this.throttle) * damp(6, dt);
        if (this.down('ShiftLeft', 'ShiftRight')) this.throttle = Math.max(this.throttle, 1);
        this.throttle = clamp(this.throttle, -0.4, 1);
      }
      // wheel
      let target = this.touchSteer ?? padSteer;
      if (this.down('KeyA', 'ArrowLeft')) target -= 1;
      if (this.down('KeyD', 'ArrowRight')) target += 1;
      target = clamp(target, -1, 1);
      const rate = Math.abs(target) > 0.01 ? 3.4 : 5.0;
      this.steerRaw += (target - this.steerRaw) * damp(rate, dt);
      this.steer = this.steerRaw;
      // sail sheet
      if (this.down('KeyQ')) this.sheet = clamp(this.sheet - 0.32 * dt, 0, 1);
      if (this.down('KeyE')) this.sheet = clamp(this.sheet + 0.32 * dt, 0, 1);
      if (pad) {
        if (pad.buttons[4]?.pressed) this.sheet = clamp(this.sheet - 0.32 * dt, 0, 1);
        if (pad.buttons[5]?.pressed) this.sheet = clamp(this.sheet + 0.32 * dt, 0, 1);
      }
      this.pump =
        this.down('KeyB', 'ControlLeft', 'ControlRight') || !!pad?.buttons[0]?.pressed || this.touchPump;
    } else {
      this.steer += (0 - this.steer) * damp(6, dt);
      this.pump = false;
      this.touchSteer = null;
    }

    // camera orbit relaxes back behind the boat when not dragging
    if (!this.dragging && performance.now() / 1000 - this.lastOrbit > 1.6) {
      const k = damp(1.4, dt);
      this.orbitYaw -= this.orbitYaw * k;
      this.orbitPitch -= this.orbitPitch * k;
    }
  }

  controls(): Controls {
    return { throttle: this.throttle, steer: this.steer, sheet: this.sheet, pump: this.pump };
  }

  reset(): void {
    this.throttle = 0;
    this.steer = 0;
    this.steerRaw = 0;
    this.sheet = 0.5;
  }

  private padY = false;
  private padX = false;
  private padStart = false;
}
