// Where things are on the boat: the transom, and the four rod holders and tips. The sim works from the
// transom; the renderer draws the rods from the same points so the lines come off the rod tips.

import type { Vector3Like } from 'three/webgpu';
import { Vector3 } from 'three/webgpu';
import type { Boat } from '../../sim/boat';
import type { RodSpec } from '../../sim/fishing/tackle';

const tmp = new Vector3();

/** Spec-frame point -> world (the model's origin is the centre of gravity, offset by `cg`). */
export function toWorld(
  boat: Boat,
  x: number,
  y: number,
  z: number,
  out: Vector3Like & { set(...a: number[]): unknown },
): void {
  const cg = boat.spec.cg;
  tmp.set(x - cg[0], y - cg[1], z - cg[2]).applyQuaternion(boat.quat);
  out.set(tmp.x + boat.pos.x, tmp.y + boat.pos.y, tmp.z + boat.pos.z);
}

/** Height of the cockpit rail the rods stand in, in the spec frame. */
const deckY = (boat: Boat): number => boat.spec.cockpit.soleY + 0.95;

/** The transom centre in the world (where the line leaves the boat as far as the physics is concerned). */
export function transom(boat: Boat, out: Vector3Like & { set(...a: number[]): unknown }): void {
  toWorld(boat, -boat.spec.length * 0.5, deckY(boat), 0, out);
}

/** Rod holder (the butt) and rod tip in the world. Outrigger rods reach out and up. */
export function rodPoints(
  boat: Boat,
  rod: RodSpec,
  butt: Vector3Like & { set(...a: number[]): unknown },
  tip: Vector3Like & { set(...a: number[]): unknown },
): void {
  const L = boat.spec.length;
  const out = Math.abs(rod.tipLat) > 2.5;
  const lat = rod.tipLat * (out ? 1 : 0.55);
  toWorld(
    boat,
    -L * 0.5 + 0.7,
    deckY(boat),
    Math.sign(rod.tipLat) * Math.min(Math.abs(lat), boat.spec.beam * 0.4),
    butt,
  );
  if (out) toWorld(boat, -L * 0.5 - 0.6, deckY(boat) + 4.4, rod.tipLat * 1.35, tip);
  else toWorld(boat, -L * 0.5 - 2.6, deckY(boat) + 2.2, rod.tipLat * 1.1, tip);
}
