# Palette reference

Colours already in the game. Reuse them; derive new ones from the nearest neighbour (see `SKILL.md`).
CSS is OKLCH; the 3D world is hex (three.js `Color`).

## UI tokens (`src/style.css`, `@layer tokens`)

| Token | Value | Use |
|---|---|---|
| `--ink` / `--ink-soft` / `--ink-faint` | `oklch(0.31 0.075 285)` at 100 / 68 / 40 % | all text, strokes, "black" |
| `--glass` / `--glass-strong` / `--glass-edge` | `oklch(1 0 0 / .42 / .62 / .7)` | panel fill, heavy panel fill, 1.5px edge |
| `--coral` / `--coral-deep` | `oklch(.76 .15 28)` / `oklch(.66 .18 24)` | boat marker, primary action, danger text |
| `--peach` `--sun` | `oklch(.86 .09 55)` `oklch(.92 .12 95)` | warm accents, warnings |
| `--mint` / `--mint-deep` | `oklch(.87 .11 175)` / `oklch(.7 .12 180)` | good / sweet zone |
| `--aqua` `--sky` `--lavender` `--pink` | `oklch(.82 .1 205)` `(.8 .1 240)` `(.78 .11 298)` `(.82 .12 350)` | water-ish, info, drag/gradients |
| `--grad-sunset` | peach -> coral -> pink -> lavender (100deg) | progress fills, titles |
| `--grad-sea` | aqua -> sky (135deg) | sea-flavoured fills |
| Radii / easing | `--r-lg 26px` `--r-md 18px` `--r-sm 12px`; `--ease`, `--ease-spring` | |

Toast tones: good `oklch(.93 .1 170)`->`(.92 .08 200)`; warn `oklch(.94 .11 90)`->`(.9 .12 60)`; bad `oklch(.88 .12 20)`->`(.85 .14 5)`.

## Skies and seas (`src/data/weather.ts`)

Horizon is the lightest and warmest; zenith the coolest. Haze colour is the horizon colour.

| id | name | horizon | mid | zenith | cloud lit / shade | haze | water deep / shallow | wind m/s from | sun az/el |
|---|---|---|---|---|---|---|---|---|---|
| `golden` | Golden Hour | #ffd2b4 | #ffa9b8 | #7c8fe0 | #ffd1b0 / #b78fc6 | #ffcfb8 @ 0.00021 | #1f6fae / #62e6d2 | 3.8 from 112° | 262°/9° |
| `breeze` | Sea Breeze | #d9eeff | #97cdfb | #4d9bf0 | #ffffff / #a9bfe0 | #cfe6fb @ 0.00017 | #0d5ea5 / #4fe0cf | 8.2 from 82° | 168°/58° |
| `dawn` | Misty Dawn | #ffdcd2 | #eeb0cf | #8496e4 | #ffd9cc / #b9a0d4 | #e9bfd8 @ 0.0018 | #2b74b0 / #79e6d7 | 4.8 from 62° | 96°/6° |
| `squall` | Tropical Squall | #a7b4c8 | #6a7699 | #3a4468 | #aeb8d2 / #39415f | #8d9bb4 @ 0.00085 | #143f66 / #37939a | 12 from 100° | 205°/38° |
| `noreaster` | Nor'easter | #cfd6e4 | #9ba7c1 | #6d7a9d | #d6dcea / #707c9c | #b9c4d8 @ 0.00062 | #184a74 / #47a2ab | 15.5 from 48° | 128°/24° |
| `moon` | Moonlit Run | #3a4f93 | #1f2d68 | #0b1238 | #7d95d6 / #1c2552 | #26366f @ 0.00028 | #0a2d5e / #1f7795 | 5.2 from 120° | 108°/42° |
| `m-dawn` | Cotton-Candy Dawn | #ffd3e0 | #f4aed6 | #8c9cf2 | #ffdfe9 / #b3a0dc | #f2c4dc @ 0.0007 | #2a66ad / #6fdbd1 | 8.6 from 76° | 94°/7° |
| `m-peach` | Peach Fog Bank | #ffe5d3 | #ffc4b6 | #a6aee8 | #ffe4d6 / #bba8d8 | #ffd8c6 @ 0.0023 | #306fa8 / #78dcc9 | 7.2 from 98° | 118°/15° |
| `m-dusk` | Lilac Dusk | #ffc9c2 | #e7a0d2 | #6e76d2 | #ffc6ca / #8e78c4 | #e8b4d0 @ 0.0005 | #2a4f9c / #5fc6d0 | 11.4 from 68° | 262°/5° |
| `m-gale` | Rosé Nor'easter | #ead3dc | #c6a8c6 | #7c86b8 | #ecd4e0 / #7a7aa6 | #d6bfd2 @ 0.0009 | #1d4a78 / #4fa4ad | 15.5 from 56° | 100°/16° |

Grading lives in the same preset: exposure ~0.98–1.2, saturation 0.92–1.12, contrast 1.02–1.08, bloom 0.3–0.8
(the dreamiest skies 0.5–0.6), vignette 0.26–0.5, warmth -0.35 (moon) .. +0.45 (golden/peach).

## Land (vertex colours)

| Role | Haulover (`locations/haulover/terrain.ts`) | Montauk (`locations/montauk/terrain.ts`) |
|---|---|---|
| Dry sand | #f5e3bd | #f7e8c9 |
| Wet sand | #d9c196 | #dcc59f |
| Dune grass | #b6c27a (oats) | #b6cf8a / #9bc182 |
| Lawn / moor | #9bd078 #84c46f #c4dd86 | #9fd286, moor #b8a2cb, olive #aebf80 |
| Scrub / mangrove | #4aa872 #2f8a63 #58b573 | #6fb88c |
| Cliff / clay | - | #f0bda2 peach, #dca6ac rose, #f4dfbc cream (banded by height) |
| Hard surface | promenade #efe6d8, asphalt #a4a1b8, concrete #e4dccf | road #c9c4d4 |

The land material multiplies these by a warm/cool noise tint `vec3(0.8,0.8,0.76) + vec3(0.3,0.28,0.34) * noise`.

## Props and boats

| Thing | Colours |
|---|---|
| Rocks | #a9a4bb #b8b0c4 #9d9bb3 #c4bccb #b0a8bd (lavender-grey) |
| Bluff scrub | #79bd8f #8fcf8a #b8a6d6 #e9aabb #9bc8a0 #7fb89a |
| Lighthouse | tower #fdf8f2, band #c98f86, trim #8b6672, roof #e58a92, lantern glass #cfe9f2 |
| Cottages | walls #cfc8dc #d9d0c4 #c8d6d4 #e0c9cc #d6d8e8; roofs #e58a92 #8f8aa6 #c9a86a #7aa6b8 |
| Buoys | red nun #ff7d86 (light #ff9aa2), green can #62d9a8 (light #8af0c4), cream collar #fdf7ee |
| Console boat (hero paint) | top #fcfbf6, stripe #6fe6cc, boot #ff8f7a, bottom #33b3c6, canvas #84e8dd |
| Marina paint sets | cream + one pastel stripe + one coral/teal boot, e.g. `['#fcfbf6','#6fe6cc','#ff8f7a','#33b3c6','#84e8dd','#8be9df']` |
| Rods / lures | rod #6a5f78; lures #ff8f9d #7ff0cf #c3a2ff #ffd45e |
| Gull / tern / gannet | gull body #fbfbf8, wing #c4cde0, tip #2f3347, beak #ffc25c; gannet head #ffe6a0 |
| Tuna | yellowfin back #3f6fb8 belly #f4f1e6 finlets #ffe45e; bluefin #2f4a96 / #e9ecf6 / #c9d3ff; bigeye #4a5fa8 / #f1eef0 / #ffd96b; albacore #4f7fc0 / #f2f4fa / #ffe27a |

## HUD canvases (map, sonar, fight diagrams)

- Chart sea: shallow `rgb(168,236,222)` -> deep `rgb(52,92,176)`, rips white-washed; land `rgb(244,230,190)` -> `rgb(192,208,160)`.
- Sonar: water `#9fe6f0 -> #5aa6dc -> #4a4fa6`, bait `rgba(255,150,120)`, floor `#f7e2ba`, fish arches white with a `#fff496` core.
- Fish moods: run `#ff7a6b`, sulk `#a98cff`, thrash `#ffa24a`, circle `#4fd0e6`, dash `#ff4f7a`, tired `#5fe0b0`.
- Tension zones: slack `rgba(160,170,210,.45)`, sweet `rgba(95,224,176,.75)`, high `rgba(255,200,90,.85)`, snap `rgba(255,90,110,.9)`.

Run `node scripts/palette-check.mjs --changed` to list hex colours in your diff that fall outside the envelope.
