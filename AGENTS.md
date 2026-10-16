# AGENTS.md: working on Run the Cut

*Pastel, physics-driven boating games on one engine: **Haulover** (run the inlet, dock in the marina),
**Montauk** (find bait, troll, hook and land a tuna), **Nantucket** (berthing: slips, wharves, moorings, up to a cruise ship).
three.js WebGPU + TSL, TypeScript, Vite, Vitest, Biome. No asset files: everything is procedural.*

This file is for any coding agent (and human). Claude Code reads it through `CLAUDE.md`. Keep it accurate: if you
learn something that cost you time, add it to **Gotchas**.

## Start here

1. `docs/ROADMAP.md` is the plan and the memory: status board, milestones with tasks, **decision log**, **session
   log**. Read the status board and the last session-log rows before you start; add a row when you finish.
2. Skills (read the `SKILL.md` before the matching kind of work; they are plain markdown any agent can follow):
   - `.claude/skills/pastel-art-style/`: **anything seen** (props, colours, skies, shaders, HUD, CSS, icons).
   - `.claude/skills/playtest-and-verify/`: how to run the gates, screenshots, headless bots and the agent API.
   - `.claude/skills/add-game-mode/`: adding a Location + GameMode or a mechanic with its own rules/UI/tests (Nantucket is the berth-based example).
3. `npm run check` must pass before you hand work back (biome + tsc + vitest, about 30 s). `npm run build` too if
   you touched `src/`.

## Commands

```bash
npm install            # Node >= 22.12 (.nvmrc)
npm run dev            # Vite on :5173 (the human's); use a spare port for yours: npx vite --port 5392 --host 127.0.0.1
npm run check          # lint + typecheck + tests: the gate
npm test | npm run lint | npm run typecheck | npm run build | npm run format
node scripts/shot.mjs ...        # screenshots from real Chrome (WebGPU)         -> see playtest-and-verify
node scripts/sim-run.mjs ...     # a whole Haulover run, headless, scripted pilot
node scripts/fish-run.mjs ...    # whole Montauk days;  fish-fights.mjs: land rates per tier
node scripts/dock-run.mjs ...    # Nantucket levels (--level liner-east | --all), the harbour pilot at the helm
node scripts/agent-demo.mjs ...  # an agent loop over window.__agent (the template for a real agent)
node scripts/palette-check.mjs --changed   # hex colours in your diff outside the pastel envelope
```
Scripts import `playwright-core`, so run them from the repo root. Pick a port other than 5173/5391 and **kill
your servers when you finish**.

## Map of the code

```
src/main.ts            pick a game (title screen or ?game=), lazy-load the engine + mode, start the frame loop
src/game/              berthing.ts + berthScore.ts + harborPilot.ts (Nantucket's pure berth rules, scoring and test pilot),
                       Game (engine host: renderer, sea, boat, camera, input, audio, phase machine, shared feedback),
                       GameMode/ModeUi/ModeDef seam (mode.ts), settings (per-game saves), camera, input, scoring
src/games/<id>/        one game's RULES + UI: mode.ts, ui.ts, visuals.ts, dev.ts (scripted pilot); registry.ts lists them
src/locations/<place>/ one place's DATA + scenery: geography.ts (pure fns of x,z), terrain.ts, props/, index.ts (a Location)
src/sim/               pure physics/rules, no rendering: boat, boatWater, waves, waveRide, sail, tugs, environment, geoGrid,
  sim/fishing/         fish world, trolling tackle, the fight (seeded, deterministic)
src/render/            renderer, water, sky/atmosphere, post pipeline, toon materials, boats/, fx/, birds, propKit, terrainMesh
src/ui/ src/shell/     shell UI (loading, shared menu, dials, pause, results, touch), the title screen
src/data/              boats, weather presets (the art direction as data), difficulties
src/audio/             procedural WebAudio engine + music (synthesised live)
src/dev/agentApi.ts    window.__agent: JSON observations/actions, deterministic stepping (?agent)
tests/                 vitest; fishHarness.ts = kinematic boat + scripted pilots
scripts/  docs/        dev tools; ROADMAP.md + screenshots
```
The seam: the **engine** (`Game`) owns the world and the phase machine (`menu -> countdown -> playing -> paused ->
finished | failed`); a **GameMode** owns the rules and is driven each frame (`update`, `visuals`, `fillHud`...).
A mode never touches the renderer's internals; it uses `host.*` (`toast`, `cam`, `audio`, `endRun`, `frameSlam`...).

## Conventions

- **Frames and units:** world **+x east, +z south, y up**, sea level 0, metres. `heading = atan2(z, x)` (radians).
  UI/agent bearings are **compass degrees** (0 = N, 90 = E). Speeds: `boat.speed` is through the water, `boat.sog` over
  the ground; show knots (`KNOTS` in `src/core/math.ts`). The tide gives free ground speed: fish, lures and wakes live
  in the water.
- **Determinism:** sims use the seeded `Rng` (`src/core/math.ts`), never `Math.random()`; a sim function takes numbers
  in and gives numbers out so a test can drive it on a kinematic boat. Rendering/DOM never leak into `src/sim`.
- **Tests first for rules:** every mechanic gets a scripted *good*, *bad* and *idle* player (`tests/fishHarness.ts`),
  a difficulty-ordering test and a determinism test. Tune numbers against the bot, not by feel; keep thresholds loose
  enough to survive tuning (assert relationships, not magic numbers).
- **Style:** Biome (`biome.json`): 2 spaces, single quotes, semicolons, 110 columns. TSL nodes are typed `N = any` and
  cast with `as N` (that is the idiom here). Prefer new files over growing hot ones. Comments explain *why*; the existing
  files are the voice to match. Format only the files you touch (`npx biome check --write <paths>`).
- **Art:** follow `pastel-art-style`. Every solid is a `ToonMaterial`; no textures, models or audio files; colours come
  from the palette; water never gets an outline; check screenshots in a warm and a stormy sky.
- **CSS:** native nesting inside `@layer reset, tokens, base, layout, components, hud, overlays, utilities`; OKLCH
  tokens only. Add a game's HUD CSS in its own `@layer hud` block at the **end** of `style.css`, class-prefixed.

## Gotchas (each one cost real time)

- A `display:` in a later CSS layer beats the global `[hidden]` in `reset`: add `.thing[hidden]{display:none}`.
- `GameMode.visuals(dt)` is a *method*; do not name a field `visuals` (Montauk's is `fx`).
- `Game.create(root, def, cfg?)`: `cfg` is `Partial<GameConfig>` and **overrides** `def.defaults`; don't pass a full default.
- Flat decals on the water vanish at grazing angles (the camera is low). Give anything that must read at distance
  height (plume, column, flag). Water never writes depth: transparent effects need `renderOrder` above -5.
- Debug the *real page*, not just vitest: WebGPU shaders/materials only fail at runtime (`scripts/shot.mjs` prints
  console errors). Missing imports in TSL files show up as a blank scene.
- `window.__game` is exposed last on purpose (scripts wait for it); `?agent` makes the page stop driving the sim.
- Headless run-to-run variation: real animation frames advance the sea clock before a script takes over. For
  reproducible runs use the agent API (`?agent&seed=N`). Always compare against a clean-checkout baseline before blaming
  your change (`git worktree add /tmp/base HEAD`, symlink `node_modules`, own port).
- Boat hulls are lofted meshes, so **triangle winding is art direction**: `loftShell` faces outward (livery on the outside,
  plain liner inside), `hullStrip` faces up (decks and soles are only drawn from above), and `loftTransom` must close its
  fan or the sea shows through the stern. Open-deck hulls also cut the sea out of themselves (`HullCut` in
  `render/water.ts`, fed from `Game.hullCut`); the pontoon opts out because you must see the water between its tubes.
  A cockpit that "looks full of water" is a winding or cut-out bug, not a colour problem.
- Adding a boat touches: `BoatSpec['id']` (`sim/boatSpec.ts`) and `GameConfig['boat']` (`game/state.ts`), a `make*()` +
  `HULL_OPTS` entry in `data/boats.ts`, a model in `render/boats/models/` registered in `boatModel.ts` (builder + paints),
  `boatIcon` in `ui/icons.ts`, an `ENGINES` profile in `audio/audio.ts`, and the `TOP` / tune / slow-boat tables in
  `tests/`. Set `dragX` from `TUNE=1 npx vitest run tests/tune.test.ts` (it prints the drag that gives the target top speed).
- macOS: BSD `sed` needs `sed -i ''`; there is no `timeout`. Prefer the edit tools or a small Python script.
- `GameConfig.route` is still Haulover's; Docking/Traffic/ResultState are Haulover-shaped. Generalise when the next game
  needs it (see the roadmap's carried-forward list), not speculatively.
- **Grids index by whole cells:** a Location's `world` extents must be whole multiples of both `cell` and `flowCell`,
  or `GeoGrid` produces NaN heights and the page renders black (Nantucket's is 2800 x 1800 over 8 m / 10 m cells).
- **Carving a shape out of land:** `max(land, -hole)` leaves a phantom "wall" of small SDF values across the hole's open
  mouth, and `hardSDF` built on it blocks boats. Build land as a union of blocks around the hole (see Nantucket's
  `landSDF`), then `hardSDF` is only ever a real edge.
- **Big hulls:** a ship needs `thrusters`, `engine.pivot`, a dense bumper set (`bumperCount` in `data/hull.ts`) and a lin
  drag (`linDrag`) to stop; the fairway must be dredged to its keel (the radar shades the shallows from `keelDepth`).
  `Boat.impactMin` (default 1 m/s) is the closing speed a hard contact is reported at: a docking game lowers it to 0.3.
- **`PartBuilder` merges position + normal + uv:** a custom geometry you `pb.add()` needs a (flat) `uv` or the merge fails
  with a console error and the whole material bucket vanishes.
- **Level clocks come from the pilot:** Nantucket's `time` values are ~1.5x what the test pilot needs at the middle
  difficulty. When you change a hull, a berth or the tide, re-run `scripts/dock-run.mjs --all` (or the dock tests) and
  re-derive them rather than guessing.
- **CI is slower than your machine:** the Pages deploy runs `npm test` on a 4-vCPU runner and a loaded one took 7.6 s over a
  Montauk day that takes 2.3 s locally, so Vitest's 5 s default timed it out and blocked the deploy. `vite.config.ts` sets
  `testTimeout` to 60 s; a test that needs more than that on your machine should set its own. To check a change against the
  CI conditions run the suite on the `.nvmrc` Node (24) with the cores busy (e.g. a few `yes > /dev/null &`), not just idle.
- Shared files everyone edits (`style.css`, `registry.ts`, `state.ts`, `game.ts`, `weather.ts`): append and keep diffs
  small so parallel branches merge.

## Playing the game as an agent

`?game=<id>&agent` mounts `window.__agent` (`src/dev/agentApi.ts`): `start(cfg)`, `act({throttle, steer, bilge, mode})`,
`step(seconds)`, `observe({cheat})`, `describe()`. JSON in/out, compass degrees, knots, metres; the sim only advances
inside `step()`. A *playing* agent uses only what a player could know (the default observation); `cheat:true` exposes
hidden state (fish positions) for tests and balance bots. `scripts/agent-demo.mjs` is a worked loop. Add a game's
fields via `GameMode.agentState()` / `agentAct()`, not to the API itself.

## Working with other agents

- **Claim and log:** mark your task in the roadmap status board (◐ + date + branch) when you start; tick the task, add a
  decision-log row for anything non-obvious, and add a session-log row when you finish, in the same change as the code.
- **Branches and PRs:** branch `agent/<topic>` off `develop`; small PRs; use `.github/pull_request_template.md`. CI
  (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build; Pages deploys only from `main`.
- **Don't collide:** one agent per milestone or per mode; shared engine edits (`src/game`, `src/render`, `src/sim`) are
  small, additive and behind optional hooks so other games stay unchanged (see how `ModeUi` got `controlsHtml`,
  `resultStats`, `touchButtons`). Say in the PR which games you ran.
- **Reporting:** state exactly what you verified and what you did not (gates, screenshots opened, bot runs with
  numbers). "Looks right" without having opened the screenshot is not verification.

## Hard rules

- **Commits:** do not commit, push, open PRs or issues, or change GitHub settings unless the human asked. When you do
  commit, end the message with the attribution trailer your harness gives (Claude: `Co-Authored-By: Claude ... <noreply@anthropic.com>`);
  **never add Copilot attribution** to this repo.
- **Never force-push or rewrite pushed history** without explicit approval for that specific action.
- Do not delete or overwrite files you have not read; do not commit secrets, `dist/`, `node_modules/` or scratch files.
- Do not add runtime dependencies without a reason in the PR (runtime deps today: three.js and two font packages).
- Stop dev servers and background processes you started.

## State of the project (keep current; details in the roadmap)

Haulover: complete. Montauk: playable v1 (search, troll, fight; polish backlog in the roadmap). Nantucket: playable v1
(twelve berthing challenges, nine vessels incl. tug / ferry / cruise ship, thrusters, tugs, stars and unlocks; backlog in
the roadmap). Tests: ~320, all green; `npm run check` is clean (about a minute).
