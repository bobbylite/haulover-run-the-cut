# AGENTS.md: working on Run the Cut

*Pastel, physics-driven boating games on one engine: **Haulover** (run the inlet, dock in the marina),
**Montauk** (find bait, troll, hook and land a tuna), **Nantucket** (docking, up to cruise ships; not started).
three.js WebGPU + TSL, TypeScript, Vite, Vitest, Biome. No asset files: everything is procedural.*

This file is for any coding agent (and human). Claude Code reads it through `CLAUDE.md`. Keep it accurate: if you
learn something that cost you time, add it to **Gotchas**.

## Start here

1. `docs/ROADMAP.md` is the plan and the memory: status board, milestones with tasks, **decision log**, **session
   log**. Read the status board and the last session-log rows before you start; add a row when you finish.
2. Skills (read the `SKILL.md` before the matching kind of work; they are plain markdown any agent can follow):
   - `.claude/skills/pastel-art-style/`: **anything seen** (props, colours, skies, shaders, HUD, CSS, icons).
   - `.claude/skills/playtest-and-verify/`: how to run the gates, screenshots, headless bots and the agent API.
   - `.claude/skills/add-game-mode/`: adding a Location + GameMode (Nantucket) or a mechanic with its own rules/UI/tests.
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
node scripts/agent-demo.mjs ...  # an agent loop over window.__agent (the template for a real agent)
node scripts/palette-check.mjs --changed   # hex colours in your diff outside the pastel envelope
```
Scripts import `playwright-core`, so run them from the repo root. Pick a port other than 5173/5391 and **kill
your servers when you finish**.

## Map of the code

```
src/main.ts            pick a game (title screen or ?game=), lazy-load the engine + mode, start the frame loop
src/game/              Game (engine host: renderer, sea, boat, camera, input, audio, phase machine, shared feedback),
                       GameMode/ModeUi/ModeDef seam (mode.ts), settings (per-game saves), camera, input, scoring
src/games/<id>/        one game's RULES + UI: mode.ts, ui.ts, visuals.ts, dev.ts (scripted pilot); registry.ts lists them
src/locations/<place>/ one place's DATA + scenery: geography.ts (pure fns of x,z), terrain.ts, props/, index.ts (a Location)
src/sim/               pure physics/rules, no rendering: boat, boatWater, waves, waveRide, sail, environment, geoGrid,
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
- macOS: BSD `sed` needs `sed -i ''`; there is no `timeout`. Prefer the edit tools or a small Python script.
- `GameConfig.route` is still Haulover's; Docking/Traffic/ResultState are Haulover-shaped. Generalise when the next game
  needs it (see the roadmap's carried-forward list), not speculatively.
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

Haulover: complete. Montauk: playable v1 (search, troll, fight; polish backlog in the roadmap). Nantucket: not
started; M3c (a big-vessel physics spike) is the suggested first task. Tests: ~170, all green; `npm run check` is clean.
