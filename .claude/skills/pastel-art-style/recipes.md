# Recipes in this codebase's idiom

Paths are from a file in `src/locations/<place>/props/` unless noted. Everything uses `ToonMaterial` (directly or
through `gel/matte/metal/glass/canvas/bulb`). Colours come from `palette.md`.

## 1. A prop from rounded primitives (merged per material)

```ts
import { Group } from 'three/webgpu';
import { bulb, gel, glass, matte, metal } from '../../../render/boats/materials';
import { PartBuilder } from '../../../render/boats/parts';

const pb = new PartBuilder();
const wall = gel('#fdf8f2', 0.55);                       // glossy cream; roughness 0.3-0.7 is the range
pb.box(wall, 14, 5, 8, { pos: [0, 2.5, 0] }, 0.2);       // RoundedBox: (mat, w, h, d, xform, cornerRadius)
pb.box(gel('#e8a09c', 0.5), 15, 0.5, 4.6, { pos: [0, 6, -1.6], rot: [0.62, 0, 0] }, 0.1); // roof slope
pb.cyl(matte('#8b6672', 0.8), 0.6, 0.6, 3, { pos: [3, 7, 0] }, 6);  // (mat, rTop, rBot, h, xform, segments)
pb.sphere(bulb('#fff0c0', 10), 0.8, { pos: [0, 30, 0] }, 12);       // lights glow brighter at night
group.add(pb.build());                                   // ONE Mesh per material: keep draw calls low
group.traverse((o) => { o.frustumCulled = false; });     // the camera is always near the action
```

`tube(mat, pts, radius)`, `rod(mat, a, b, radius)`, `capsule`, `torus`, `cone` exist too. Boats use lofted hulls
(`src/render/boats/loft.ts`) with a livery of `{top, stripe, boot, bottom, inner}`: cream top, one pastel stripe,
a coral/teal boot stripe, a saturated-but-soft bottom.

## 2. Many small things: one merged, vertex-coloured mesh

```ts
import { Color, IcosahedronGeometry } from 'three/webgpu';
import { type Placement, scatterMesh } from '../../../render/propKit';
import { ToonMaterial } from '../../../render/toon';

const items: Placement[] = bushes.map((b) => ({
  x: b.x, y: b.h, z: b.z, sx: s, sy: s * 0.8, sz: s, yaw: rng.next() * 6.28,
  color: PASTEL[rng.int(0, PASTEL.length - 1)] as Color,
}));
group.add(scatterMesh(new IcosahedronGeometry(1, 0), items, new ToonMaterial({ vertexColors: true, roughness: 0.95 })));
```
Pick colours from a small list (4-6) so the scatter reads as a *painted* clump, not noise. Use a seeded
`Rng` (`src/core/math.ts`) so the scene is identical every load.

## 3. Land colour

Land is a heightfield mesh with per-vertex colours (`src/render/terrainMesh.ts`: `buildTerrainBlock`). You write
`color(x, z, h, out)`; blend a few palette colours with `Color.lerp`, driven by distance inland, slope and a little
fbm noise (`fbm2`). Steep slope -> banded clay (`sin(h * 1.9 + n)` between two pastels); waterline -> wet sand.
Never let a land colour go below L ~0.55 except shaded undersides, which the lighting darkens anyway.

## 4. A new sky (weather preset)

Add an entry to `WEATHER` in `src/data/weather.ts`:

```ts
{
  id: 'm-example', name: 'Example Sky', exclusive: 'montauk',       // omit `exclusive` to share with every game
  blurb: 'One sentence a player would enjoy reading.', icon: 'sunset', danger: 3,
  sunAzimuth: 94, sunElevation: 7, sunColor: '#ffb9a2', sunIntensity: 2.9,
  skyHorizon: '#ffd3e0', skyMid: '#f4aed6', skyZenith: '#8c9cf2',   // light/warm -> pinker -> cool periwinkle
  cloudCover: 0.55, cloudStorm: 0, cloudLit: '#ffdfe9', cloudShade: '#b3a0dc',
  haze: 0.0007, hazeColor: '#f2c4dc',                               // hazeColor = horizon colour
  waterDeep: '#2a66ad', waterShallow: '#6fdbd1', waterGlow: '#a7f0e3', foam: 1.05,
  windSpeed: 8.6, windFrom: 76, gust: 0.32, swellHeight: 1.35, swellFrom: 84, swellLength: 1.1, chopHeight: 0.62,
  rain: 0, lightning: 0, exposure: 1.03, saturation: 1.1, contrast: 1.04, bloom: 0.55, vignette: 0.36, warmth: 0.4,
}
```
Also: add the id to `MOODS` in `src/audio/audio.ts` (sunny/storm/night) and add a `weatherIcon` case if you need a
new icon. Check it at sunrise and with the sun *behind* the camera, and run `tests/montauk.location.test.ts`-style
assertions if the sky is exclusive to a game with rules (wind direction vs tide).

## 5. A shader decal or effect (TSL, instanced)

Per-instance data goes in an `InstancedBufferAttribute` read with `instancedDynamicBufferAttribute` (see
`src/render/birds.ts` and the `Rings` class in `src/games/montauk/visuals.ts`):

```ts
const a = instancedDynamicBufferAttribute(anim);            // (age, kind, alpha, seed)
const r = length(uv().mul(2).sub(1));                       // radius on a unit quad
mat.transparent = true; mat.depthWrite = false; mat.side = DoubleSide;
mat.opacityNode = ringShape.mul(a.z);                       // soft edges: smoothstep, never step()
mat.colorNode = vec3(1, 0.99, 0.97);                        // warm white, not 1,1,1
// soft silhouette for puffs: pow(abs(normalView.z), 0.55); band a gradient: toonQ(x, float(4), float(0.12))
```
Set `renderOrder` above the water (-5); keep `frustumCulled = false` on instanced meshes. Remember grazing angles
(a flat ring is a hairline from a low camera): add height for anything that must be read from far away.

## 6. A HUD panel

```html
<div class="my-panel glass hud-part" id="myPanel" hidden>
  <div class="head"><span class="label">Fish finder</span><b class="num" id="myRead">-</b></div>
</div>
```
```css
@layer hud {
  .my-panel { position: absolute; right: clamp(12px, 2vw, 28px); top: 24px; padding: 12px 16px; border-radius: var(--r-md); }
  .my-panel[hidden] { display: none; }               /* required: this layer's display beats [hidden] */
  .my-panel .label { color: var(--ink-soft); }
}
```
Text is `--ink`; accents from tokens; numbers get `.num`. Update from `ModeUi.update(h)` (about 20 Hz, from the shell)
and write text only when it changed. For canvas drawing use the HUD canvas colours in `palette.md`, `Fredoka
Variable` for numbers and `Josefin Sans Variable` for small labels, white strokes 2-2.5px with round joins.

## 7. A flock of birds

```ts
import { BirdFlock, GANNET, TERN } from '../../render/birds';
const terns = new BirdFlock(TERN, 90, 'terns');   // instanced; group.add(terns.mesh)
terns.set(i, x, y, z, heading, bank, pitch, scale, phase, flapAmp, flapRate);  // per bird per frame
terns.commit(count);
```
Birds far from the camera are drawn bigger (`scale * (1 + dist / 230)`, capped) so they stay readable as specks.

## 8. Check it

```bash
node scripts/palette-check.mjs --changed          # hex colours outside the pastel envelope in your diff
node scripts/shot.mjs --url "http://127.0.0.1:5392/?game=montauk&weather=m-dawn" --wait 7000 --out /tmp/look.png
```
Look at the PNG. See the `playtest-and-verify` skill for the full loop.
