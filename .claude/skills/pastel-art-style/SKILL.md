---
name: pastel-art-style
description: The "pastel cel-shaded sea" art direction of Run the Cut (Haulover, Montauk, Nantucket). Use whenever you add or change anything that is seen - a prop, boat, terrain colour, weather or sky preset, water or sky shader, particle or decal, HUD panel, icon, CSS or animation - so it matches the existing look. Gives the palette, the material and shader rules, the UI glass system, recipes in this codebase's own idiom, and a review checklist.
---

# Pastel cel-shaded sea: the house style

The look is **a hand-painted cartoon of the sea at golden hour**: flat colour bands instead of gradients, soft
pastel hues instead of realism, warm lights and cool lavender shadows, one confident dark-violet ink for
outlines and text, and frosted-glass UI floating over it. Everything is procedural (no model, texture or audio
files). If a change makes a screenshot look photographic, grey, neon or muddy, it is wrong.

Read `palette.md` for exact colours and `recipes.md` for copy-pasteable code before writing anything.

## The five rules

1. **Bands, not ramps.** Light, water depth, sky and clouds are *quantised* into a few flat levels with soft
   shoulders (`toonQ(x, levels, softness)` in `src/render/toon.ts`). Never ship a smooth lighting gradient on a
   solid, and never use more than ~5 levels for a world shader.
2. **Pastel envelope.** Surfaces live at OKLCH lightness 0.70–0.95 and chroma <= ~0.16. Saturated colour is only
   for tiny, deliberate accents (a lure, a flag, a flashing buoy light, the coral boat arrow). No pure black,
   no pure grey, no `#fff`/`#000` fills: whites are warm cream (`#fdf8f2`, `#fffaf3`), darks are violet.
3. **Warm light, cool shade.** Sun, haze and horizon are warm (peach/pink/gold). Shadows, deep water and cloud
   undersides are lavender/periwinkle/teal, never neutral grey. The hemisphere light is sky-tinted so lit and
   shaded sides contrast in *hue*, not just value.
4. **Ink where it helps.** Solid things (boats, land, props) get the post-pass ink outline; **water never does**
   (wave crests would turn into silhouettes). UI text is always `--ink` (a deep violet), never black.
5. **Round, simple, readable.** Rounded boxes, lofted hulls, low-poly spindles with vertex colours. A prop should
   read at 300 m as one coloured shape. Detail comes from *colour blocking* (stripes, trims) not geometry.

## What the look is made of (where to change it)

| Layer | File | What it does |
|---|---|---|
| Solid shading | `src/render/toon.ts` | `ToonMaterial`: 4 light bands (gradient map `[22,92,168,222]`), sky/sun-tinted rim (`rim` 0.22), optional hard `gloss` glint. **Every solid uses it.** `PartBuilder` + `gel/matte/metal/glass/canvas/bulb/flashBulb` (`src/render/boats/{parts,materials}.ts`) build from it. |
| Post | `src/render/pipeline.ts` | HDR -> bloom -> AgX tone map -> pastel grade (exposure/saturation/contrast/**warmth** split tone) -> ink outline -> vignette + dither. Driven by the weather preset. |
| Sky + clouds | `src/render/atmosphere.ts`, `sky.ts` | A banded dome (4-5 stepped bands), hard-edged 3-level clouds, warm horizon band widest toward the sun. |
| Water | `src/render/water.ts` | Flat depth bands, wave slope bands, hand-drawn dashes, crisp foam with a pale rim, a few Fresnel sky bands, chunky glints. |
| Land | `src/locations/*/terrain.ts` + `src/render/terrainMesh.ts` | Pastel **vertex colours** (sand, dune grass, clay bluffs, moor...) multiplied by a warm/cool noise tint. |
| Weather | `src/data/weather.ts` | The art direction as data: sun, sky triplet, clouds, haze, water tints, grading. `exclusive` presets belong to one game. |
| UI | `src/style.css` (`@layer`s), `src/ui/*`, `src/games/*/ui.ts` | The glass design system: OKLCH tokens, Fredoka + Josefin Sans, pills, springy motion. |

## Colour: how to pick one

Derive, don't invent. Start from the nearest existing swatch in `palette.md` and move only along these lines:

- **Hue family** per material: sea = teal/aqua/periwinkle; sand = cream/peach; vegetation = mint/sage with
  lavender and pink accents (beach plum, heather); rock = lavender-grey; wood = peach-brown; sails/hulls = cream
  with one pastel stripe and one coral/teal boot stripe.
- **A new sky** is a *triplet*: horizon (lightest, warmest) -> mid (pinker/more saturated) -> zenith (cooler,
  deeper, periwinkle). Haze colour = horizon colour. Cloud lit = warm light, cloud shade = lavender.
- **Water** is a pair: shallow (mint/aqua, high lightness) and deep (cobalt/indigo). Shade the *deep* colour
  toward the sky's zenith hue so reflections and body agree.
- Keep `saturation` 1.0–1.12 and `bloom` 0.3–0.8 in grading; night uses a violet-blue wash, never black.

## Motion and feel

- Spring/ease tokens: `--ease`, `--ease-spring`. Entrances use `@starting-style` or the `toast-in` pop.
- Things bob on the *live* wave height (`env.waves.height(x, z, env.time)`), never on a sine of their own.
- Splashes are foam rings + soft white ellipsoid plumes (see `src/games/montauk/visuals.ts`); camera shake is
  short and decays fast; wakes come from the wake map, not particles.
- Flat decals vanish at grazing angles (the camera is low): anything that must read at distance needs height
  (a plume, a column, a flag), not just a ring on the water.

## UI (the glass system)

- Panel = `.glass` (white 42% fill, `blur(20px) saturate(1.6)`, 1.5px white edge, soft violet shadow). Heavier
  panels use `--glass-strong`. HUD panels also carry `.hud-part` so `H`/photo mode can fade them.
- Radii `--r-lg 26 / --r-md 18 / --r-sm 12`, pills fully round. Labels: `.label` (Josefin Sans, uppercase,
  letter-spacing .14em, `--ink-soft`). Numbers: `.num` (tabular). Display text: Fredoka.
- Colours only from tokens (`--coral --coral-deep --peach --sun --mint --mint-deep --aqua --sky --lavender
  --pink`, `--grad-sunset`, `--grad-sea`) in **OKLCH**. Status colours: good = mint->aqua gradient, warn =
  sun->peach, bad = coral->pink. Never raw red/green.
- Icons: small inline SVG, flat pastel fills + `currentColor` strokes with round caps (see `src/ui/icons.ts`).
- CSS rules live in `@layer reset, tokens, base, layout, components, hud, overlays, utilities`. **Gotcha:** a
  `display:` set in a later layer beats the global `[hidden]{display:none}` in `reset`; add an explicit
  `.thing[hidden]{display:none}` for any panel that sets `display`.
- Make HUD panels survive 1280x720 and a 844x390 phone landscape (see the `@media (max-height: ...)` blocks at the
  end of `style.css`; `zoom` scales the *position* values too).

## Review checklist (run through it before you say a visual change is done)

- [ ] Screenshot it in at least a warm sky (`m-dawn` or `golden`) **and** a cool/stormy one (`noreaster`, `m-gale`).
- [ ] Squint: do the colours still sit in the pastel envelope? Any pure grey/black/white/neon patch?
- [ ] Shaded sides are lavender/teal, not grey. Lit sides are warm.
- [ ] A new solid uses `ToonMaterial` (via `gel/matte/...` or `vertexColors`), not a PBR material.
- [ ] No outline on water things; no textures or asset files added.
- [ ] Text on glass is `--ink`; every colour is a token; `[hidden]` still hides.
- [ ] It looks right at 3 distances: close (menu orbit), mid (chase cam, 30 m), far (300 m+, a speck).
- [ ] `npm run check` is clean and the HUD still fits 1280x720.

Take the screenshots with the `playtest-and-verify` skill (`scripts/shot.mjs`).
