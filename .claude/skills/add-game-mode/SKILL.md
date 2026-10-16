---
name: add-game-mode
description: How to add a new game (a Location plus a GameMode) to Run the Cut, or extend Haulover/Montauk/Nantucket - the Location/GameMode seam, the registry, per-game saves, menu and HUD hooks, the pure-sim-plus-bot testing pattern, and the docs to update. Use when starting Nantucket (M3), adding a new place, or adding a mechanic that needs its own rules, UI and tests.
---

# Add a game (or a mechanic) the way the first two were built

The engine hosts one game per page load. A **Location** is *data* (the sea fields, terrain, scenery); a **GameMode**
is *rules* (what you do there, scoring, HUD). `src/game/game.ts` (`Game`) is the engine host and knows neither.
Read `docs/ROADMAP.md` first: it holds the plan (Nantucket M3 is next), the decision log and the session log.

## The pieces

```
src/locations/<place>/   geography.ts (pure functions of x,z)  terrain.ts  props/*.ts  index.ts -> `Location`
src/sim/<topic>/         pure, seeded, no rendering, no DOM: the rules' maths (e.g. src/sim/fishing)
src/games/<id>/          mode.ts (GameMode + ModeDef)  ui.ts (ModeUi)  visuals.ts  dev.ts (scripted pilot)
src/games/registry.ts    one entry per game (title card, `status`, lazy `load()`)
tests/                   <topic>.*.test.ts for the sims, <place>.location.test.ts, a whole-day/run test
```

## Steps

1. **Location** (`src/locations/types.ts` is the contract). Provide `world` extents + `fields` (`seabedHeight`,
   `landSDF`, `hardSDF`, `currentUnit`, `swellExposure`, `hayMask`, `floorKind`), `buildTerrain`, `buildProps`.
   Frame: **+x east, +z south, y up**, sea level 0, `heading = atan2(z, x)`. Keep fields analytic so the physics, the
   baked grid and the shaders agree. Test it: start pose is open water, shoreline where expected, current direction,
   no NaNs, bake works (`tests/montauk.location.test.ts` is the template). Look at it from above (dump a PNG of the
   baked grid) before you build scenery.
2. **Pure sim first** (`src/sim/<topic>/`). Deterministic with the `Rng` from `src/core/math.ts` (never
   `Math.random()` in a sim). Write the scripted **good player, bad player and idle player** *before* the UI, and pin:
   good lands most, bad habits lose for an understandable reason, difficulty tiers get harder. Montauk's
   `tests/fishHarness.ts` (a kinematic boat + pilots) is the pattern. Tune against the bot, not by feel.
3. **GameMode** (`src/game/mode.ts`): `start` pose, `init`, `prepare(prev)`, `populate`, `begin`, `update(dt, phase)`,
   `visuals(dt)`, `fillHud`, `respawnPose`, `onRespawn`, `clearance`, `wakeBoats`; optional `difficulty(id)`,
   `audio()`, `agentState(cheat)`, `agentAct(a)`. End a run with `host.endRun(result, ok)` (`ResultState` in
   `src/game/state.ts`; add outcomes/fields there, optional ones preferred so other games are untouched). Shared
   boat feedback (slams, green water, wave streak, hull damage, bilge) is free from the host: use `host.frameSlam`,
   `host.boatFailure()`, `host.toast()`, `host.cam`, `host.audio`.
4. **ModeUi** (`menuHtml/hudHtml/attach/syncMenu/onPhase/update/resultHtml`, plus optional `controlsHtml/hintHtml/
   resultStats/startLabel/touchButtons`). Compose the shared menu parts (`src/ui/menuSections.ts`: vessel, conditions,
   tide, difficulty; `SharedMenu` takes per-game tides/difficulty names). A game with its own skies lists only
   those (`exclusive` in `src/data/weather.ts`). HUD CSS goes in a new `@layer hud` block at the **end** of
   `src/style.css`, prefixed with the game (`.fm-*` for Montauk) so parallel work does not conflict. Follow the
   `pastel-art-style` skill.
5. **Register it**: add the `ModeDef` (`id`, `title`, `location`, `defaults`, `create`) and flip the registry entry to
   `status: 'ready'` with `load: () => import('./<id>/mode')`. Saves are per game (`src/game/settings.ts`); Haulover
   keeps its legacy keys, a new game gets `game:`-prefixed ones automatically.
6. **Agent surface**: add `agentState`/`agentAct` so an agent can play it (`src/dev/agentApi.ts`); write a bot in
   `games/<id>/dev.ts` and a `scripts/<id>-run.mjs` like `scripts/fish-run.mjs`. Test via the `playtest-and-verify` skill.
7. **Docs**: tick the task in `docs/ROADMAP.md`, add a decision-log row for anything non-obvious and a session-log
   row, update the README table. Add the game's keys to `controlsHtml`.

## Rules of thumb that cost time when ignored

- **Decouple "the sea does X" from "the game does Y".** If a rule needs the real boat, make the rule a pure function
  of numbers (`speedWindow(kn)`, `Fight.step(dt, input)`) and feed it from the mode; then it is testable in
  milliseconds on a kinematic boat.
- **Speed through the water vs over the ground.** The tide gives free ground speed; fish, lines and wakes live in the
  water. Use `boat.speed` (through water) for noise/lure/spook rules, `boat.sog` only for "where am I going".
- **Per-tier difficulty belongs to the game**: shared `Difficulty` scales sea/bilge; override with `GameMode.difficulty`
  if the game's seas are already steep (Montauk does).
- **Hot shared files** (`style.css`, `registry.ts`, `state.ts`, `game.ts`): append, do not reformat; keep edits small.
- **Heaviest hazards for a first build**: the camera (a fish astern is behind a chase camera: add a framing camera),
  grazing-angle decals (add height), HUD at 1280x720 and phone landscape, and bots that cheat (label them).
- Do not hard-code Haulover: `GameConfig.route` is still Haulover's; the carried-forward items for Nantucket
  (berth generalisation, big-vessel physics) are listed under M2/M3 in the roadmap.
