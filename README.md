# HAULOVER — Run the Cut

A cartoon, physics-driven boating game set in **Haulover Inlet, Miami**. Pick a boat, pick the weather and the
tide, and run the Cut: a narrow channel between rock jetties where an ebb tide and an onshore wind stand the
sea up into breaking "haystacks". Round the sea buoy, come home through the Cut, then thread an old piling
field and dodge harbour traffic to park in your slip. Take on too much water and you go down; run out of
time and the harbourmaster gives up on you.

Built with **three.js WebGPU + TSL**, a hand-written boat physics engine and a fully procedural world — every
wave, hull, palm tree, cloud, engine note and chord is generated at runtime. There are no model, texture or
audio files. The whole game is a static single-page app that deploys to GitHub Pages.

![Golden hour in the Cut](docs/hero-golden.jpg)

## Play

- **Live:** `https://<your-user>.github.io/<your-repo>/` once you have deployed (see [Deploy](#deploy-to-github-pages)).
- **Locally:** `npm install && npm run dev`, then open the printed URL.

Best in a current Chrome, Edge or Safari 26 (WebGPU). Firefox and older browsers fall back to WebGL2
automatically. Phones work in landscape with on-screen controls, but this is a desktop game first.

## Highlights

| | |
|---|---|
| **Boats** | Five hulls with different physics: Sea Hornet 24 (center console), Miami Vice 33 (offshore go-fast), Sunset 42 (flybridge yacht), Pelican 30 (sloop under sail or motor), Tiki Barge 24 (sandbar pontoon). |
| **Weather** | Golden Hour, Sea Breeze, Misty Dawn, Tropical Squall, Nor'easter, Moonlit Run. Sun, sky, haze, grading, wind and sea state cross-fade together. |
| **Tide** | Ebb (going out), slack, flood (coming in). A real flow field runs through the Cut, strongest in the throat, and carries your boat *and* your wake. |
| **Water in the boat** | Every hull has a flooding capacity scaled by the difficulty. Gunwale overflow, slam spray, leaks from hull strikes, a slosh model, scuppers and a bilge pump decide whether you stay afloat. |
| **Difficulty** | Dockside, Weekender, Captain, Legend. Each tier changes how much water you may ship, how steep the sea gets, how hard the wind and tide push, how narrow the gates are, the run clock, the missed-gate penalty, how many boats share the Cut, and how many crab-pot floats and drift logs litter it. |
| **Docking challenge** | The run ends in the marina: wind through a field of timber pilings and circulating harbour boats, then park in slip 3 at under 0.9 m/s and within 22° of square, while a radar, parking-sensor beeps and a glowing berth guide you in. Every bump costs points. |
| **Living world** | Gulls that shadow your boat, pelicans skimming the chop, kites over the park, other boats working the Cut in their own lanes (real physics, real wakes), traffic crossing the Haulover bridge. |
| **Hazards** | Crab-pot floats (run one over and the line fouls your prop) and drift logs that ride the tide and hit hard. |
| **Sound** | Per-boat engines, wind, hull rush, surf, rain, thunder, gulls, gate chimes and a weather-aware generative score — all synthesised live with WebAudio. |

| | |
|---|---|
| ![Tropical Squall at the mouth](docs/squall.jpg) | ![Moonlit Run](docs/night.jpg) |
| ![The jetties](docs/jetties.jpg) | ![Docking challenge](docs/docking.jpg) |

![Menu](docs/menu.jpg)
![HUD](docs/hud.jpg)

## Controls

| Key | Action |
|---|---|
| `W` / `S` | Throttle lever up / down (it stays where you leave it); `Space` idles |
| `A` / `D` | Steer |
| `B` | Hold to run the bilge pump |
| `Q` / `E` | Trim the sheet (sloop) |
| `F` | Hoist / drop sails (sloop) |
| `C` | Camera: chase / helm / orbit |
| `R` | Respawn at the last gate (+20 s) |
| `Esc` / `P` | Pause |
| `H` / `F2` | Hide HUD / photo mode |
| `M` | Mute |
| `G` | Resolution: auto → 100% → 75% → 50% |
| Mouse drag / wheel | Look around / zoom |

A gamepad works too (stick steer, triggers throttle, A pumps, X camera). On touch devices a steering pad,
throttle lever and buttons appear during a run.

URL parameters (handy for demos and testing): `?boat=gofast&weather=squall&tide=ebb&difficulty=captain&route=inbound`,
`&route=full|outbound|inbound`, `&quality=low|medium|high`, `&webgl` to force the fallback renderer, `&debug` for a telemetry overlay, `&noui`.

## How it works

### Geography
Haulover Inlet is defined analytically: the shoreline, the dredged Cut, the jetties, the sandbar, bathymetry and
the tidal flow field are functions of position. They are baked once into grids that the CPU physics and the GPU
shaders both read, so what you see and what the boat feels are always the same thing.

### Waves
Twelve Gerstner components (three long swells, five chop, four standing "haystack" waves) are summed identically
on the CPU (with fixed-point inversion of the horizontal displacement so a buoyancy probe finds the *visible*
surface) and in the vertex shader. Swell shoals and breaks as the depth shrinks; haystacks grow with ebb speed ×
opposing wind × sea energy.

### Boat physics
A buoyancy "point cloud" gives every hull its own heave, pitch and roll. On top of that: quadratic and
hump-speed drag with planing lift, lateral keel lift, propeller thrust with ventilation, prop-wash steering,
wind forces (with an apparent-wind sail model for the sloop), seabed and obstacle contacts, free-surface
slosh and the water-in-the-hull model. Each hull is tuned against a headless balance harness
(`tests/`) that drives an autopilot through every weather preset.

### Rendering
- A cel-shaded cartoon look: four-band toon lighting on every solid, banded sky and hard-edged clouds, an ink
  outline pass (inverse-depth Laplacian, dry land and boats only), and a water shader built from flat tonal bands,
  hand-drawn wave dashes and crisp foam with a pale rim.
- `WebGPURenderer` with **TSL** node materials (WebGL2 fallback), HDR post pipeline (MSAA scene pass → bloom →
  tone mapping → grade → ink → dither), custom aerial-perspective fog.
- Water: Beer–Lambert body colour with the visible sea floor and caustics (quantised to bands), crest glow,
  stepped Fresnel sky reflection, chunky sun glints, cat's-paws and rain rings, foam from crests / surf / shore.
- A camera-following **wake simulation**: a ping-pong render target advected by the tidal flow, diffused and
  decayed, stamped by every boat (hull foam, bow wave, prop wash, contact shadow).
- Boat hulls are lofted from Bézier sections at load time; the city, palms and jetty boulders are instanced.
- An adaptive-resolution governor keeps the frame rate smooth on slower GPUs.

## Tech stack

three.js r186 (WebGPU + TSL) · TypeScript 7 (native `tsc`) · Vite 8 · Vitest 5 · Biome 2 · vanilla TS + modern
CSS (OKLCH, native nesting, `@layer`, `@starting-style`, `backdrop-filter`) · WebAudio · self-hosted variable
fonts. Runtime dependencies: three.js and two font packages.

## Development

```bash
npm install
npm run dev          # Vite dev server with HMR
npm run typecheck    # tsc --noEmit
npm test             # Vitest: boat calibration, balance ladder, docking feasibility, environment, scoring, course, traffic
npm run lint         # Biome
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ locally
```

Balance tooling (not part of the normal test run):

```bash
SWEEP=1 BOATS=console,cruiser WEATHERS=golden,squall CRUISES=0.4,0.7 npx vitest run tests/sweep.test.ts
TUNE=1 npx vitest run tests/tune.test.ts      # re-derive hull drag for the target top speeds
```

`scripts/sim-run.mjs` plays a whole game headlessly in the real page (autopilot at the helm, time fast-forwarded)
and prints the outcome, which is how the difficulty tiers were balanced.

`scripts/shot.mjs` drives a real Chrome via `playwright-core` to take screenshots and read console output
(`node scripts/shot.mjs --url http://127.0.0.1:5173/?auto&go --out shot.png`), and `scripts/touch-test.mjs`
exercises the touch layout in a phone-sized viewport. `?auto` hands the helm to the autopilot.

### Project layout

```
src/
  sim/       geography, waves, wind, environment, hazards, boat + water physics (no rendering)
  data/      boats, weather presets, difficulties
  game/      state machine, course + scoring, docking challenge, input, camera, traffic AI, autopilot
  render/    renderer, water, sky, terrain, wake, post, FX, boats/ and world/ builders
  audio/     procedural WebAudio engine + generative music
  ui/        menu, HUD, minimap, touch controls
tests/       vitest: physics calibration, balance, environment, course, scoring, traffic
```

## Deploy to GitHub Pages

The repository ships with a workflow (`.github/workflows/deploy.yml`). To publish:

1. Create a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually). It type-checks, runs the tests, builds, and deploys.

The build uses relative asset paths (`base: './'`) and has no client-side routing, so it works from any
sub-path (`https://user.github.io/repo/`) or a custom domain. A `404.html` and `.nojekyll` are included.
Social-card tags (`og:image` etc.) are injected automatically with the real URL during the Pages build.

## License

[MIT](LICENSE)
