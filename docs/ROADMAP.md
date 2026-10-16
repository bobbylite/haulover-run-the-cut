# Run the Cut — multi-game roadmap

**Status board** (update this table first whenever work lands; details below).

| Milestone | What | Status |
|---|---|---|
| M0 | Plan + audit (this document) | ☑ done |
| M1 | Location seam: pull Haulover out of the engine, zero behaviour change | ☑ done (2026-10-15) |
| M2 | `GameMode` split + title-screen launcher + per-game saves + code splitting | ☑ done (2026-10-15) |
| M3 | **Nantucket** — the docking challenge (many berths, many vessels, cruise ships) | ◑ **playable (v1, 2026-10-16)**: 12 levels, 5 tiers, 9 vessels; backlog at the end of the M3 section |
| M4 | **Montauk** — find the bait, hook the tuna, fight the fish | ◑ **playable (v1, 2026-10-16)**; polish backlog at the end of the M4 build plan |
| M5 | Polish, shared progression, deploy all three | ☐ not started |

Legend: ☐ not started · ◐ in progress · ☑ done. Every milestone ends with **`npm run typecheck && npm test && npm run build` green**.

> **Resuming after a break:** read the status board, the *Decision log* and the *Session log* at the bottom, open
> the first unchecked task of the first unfinished milestone, read only the files listed in it, do it, tick it,
> add a line to the Session log. Tasks are sized to fit one working session each.

---

## 1. Vision

*Run the Cut* becomes a small collection of boat games that share one engine, one look and one physics model:

| # | Game | Place | Core loop |
|---|---|---|---|
| 1 | **Haulover** | Haulover Inlet, Miami | *This game, as it is.* Run the jetties, round the sea buoy, dock in the marina. |
| 2 | **Montauk** | Montauk Point, NY | Read the water, spot a school of bait, troll a spread, hook a tuna, then keep it on with a tension-and-direction fight while the crew reels. |
| 3 | **Nantucket** | Nantucket Harbor, MA | Pick a vessel and a berth (slip, wharf, mooring) and put it there cleanly. Cruise ships are the hardest. |

The player picks a game from a title screen; each game has its own menu, rules, scoring and best scores. Boats,
weather, tide, difficulty and the sea itself are shared where they make sense.

## 2. What we already have (reuse map)

| Existing piece | Where | Reused by |
|---|---|---|
| Rigid-body boat, buoyancy cloud, drag/planing, thrust, rudder | `sim/boat.ts` | all three |
| Water-in-hull, hull damage, bilge, scuppers | `sim/boatWater.ts` | Haulover, Montauk (rough seas) |
| Wave field, wave axis, 45° rule, Wave Rider streak | `sim/waves.ts`, `sim/waveRide.ts` | Haulover, Montauk (running out through the rips) |
| Sail model, apparent wind | `sim/sail.ts` | all (sloop is selectable everywhere) |
| Environment: weather, tide, wind, difficulty scaling | `sim/environment.ts` | all |
| Renderer, water, sky, atmosphere, wake, spray, rain, post | `render/*` | all |
| Boat models + flags + liveries | `render/boats/*` | all; new hulls added per game |
| Docking status/scoring, radar, parking sensors | `game/docking.ts`, `ui/dockRadar.ts` | **Nantucket** (generalise) |
| Gulls, pelicans, wildlife | `render/world/wildlife.ts` | **Montauk** (birds working bait) |
| Traffic AI on the same physics | `game/traffic.ts` | Nantucket (ferries, boats under way) |
| Autopilot, headless harness, vitest balance tests | `game/autopilot.ts`, `tests/` | tests for every mode |
| Audio synth (engines, wind, slam, alarms) | `audio/audio.ts` | all; reel drag, birds, sonar ping added |

### The three blockers (found in the audit)

1. **Haulover is hard-coded into the engine.** `sim/geography.ts` exports module-level constants and functions
   (`WORLD`, `SLIP`, `DOCKS`, `JETTY_X0`, `cutZ`, `seabedHeight`, `currentUnit`, `swellExposure`, `hayMask`, …) and
   **24 files import it directly** (physics env, 10 world-prop builders, water/terrain/wake shaders' textures,
   minimap, dock radar, course, docking, traffic, autopilot, hazards). `Environment` already accepts an injected
   `GeoGrid`, so the seam half-exists — but `GeoGrid.bake()` reads the Haulover functions directly.
2. **`Game` (≈1000 lines) mixes engine and Haulover rules.** The frame loop, camera, input, audio, toasts and HUD
   state sit next to gates, course scoring, docking phase and the run clock.
3. **`UI` (≈900 lines) is one Haulover menu** (boat/weather/tide/route/difficulty) plus the in-run HUD.

Nothing about the physics or renderer is Haulover-specific beyond the data they read.

## 3. Target architecture

```
src/
  engine/            (shared; moved incrementally, not big-bang)
    sim/             boat, boatWater, waves, waveRide, sail, environment, wind
    render/          renderWorld, water, sky, wake, fx, boats/
    audio/ core/ input/ camera/
  locations/         one folder per place = DATA + prop builders, no rules
    haulover/        geography, props (city, jetties, marina…), course gates, weather defaults
    montauk/
    nantucket/
  games/             one folder per mode = RULES + UI
    haulover/        HaulMode: gates, run clock, scoring, docking finale
    montauk/         FishMode: bait, sonar, trolling, fight
    nantucket/       DockMode: berth picker, vessels, scoring
  shell/             title screen, mode registry, save data, settings, loading
```

Two small interfaces carry everything:

```ts
/** Where we are: pure data + builders. The physics and the shaders only ever see this. */
interface Location {
  id: 'haulover' | 'montauk' | 'nantucket';
  world: { x0: number; x1: number; z0: number; z1: number; cell: number };
  seabedHeight(x: number, z: number): number;
  landSDF(x: number, z: number): number;
  hardSDF(x: number, z: number): number;          // rocks, walls, piers, pilings
  hardNormal(x: number, z: number, out: Vec2): void;
  currentUnit(x: number, z: number, out: Vec2): void;
  swellExposure(x: number, z: number): number;
  hayMask(x: number, z: number): number;           // tide-rip standing waves
  buildProps(world: Group, env: Environment): LocationProps;  // scenery
  weatherDefaults: string[];                       // which presets fit the place
}

/** What we are doing there: rules, scoring, HUD. The engine calls these every frame. */
interface GameMode {
  id: 'haulover' | 'montauk' | 'nantucket';
  menu(host: HTMLElement, ctx: ShellContext): MenuHandle;   // pre-run setup UI
  start(ctx: RunContext): void;                              // build course/targets, place the boat
  update(dt: number, ctx: RunContext): void;                 // rules: gates / fish / berth
  hud(): ModeHud;                                            // data the HUD panels render
  result(): ResultState | null;
  dispose(): void;
}
```

`GameCore` (what is left of `Game`) owns the renderer, environment, boat, camera, input, audio, toasts and the
phase machine (`menu → countdown → playing → paused → finished|failed`) and delegates rules to the active
`GameMode`. A **mode registry** + **dynamic `import()`** per game keeps the first load small (bundle is already
1.18 MB).

**Compatibility rules for the refactor:** `?boat= &weather= &tide= &difficulty= &route=` keep working (default game =
Haulover); `scripts/shot.mjs`, `sim-run.mjs`, `window.__game` keep working; saved settings migrate, not reset.

---

## 4. Milestones and tasks

### M1 — Location seam (no behaviour change)

*Goal: the engine reads a `Location`, Haulover is one implementation of it. All 107 existing tests and the visuals are unchanged.*

- [x] **M1.1** Define `Location` (+ `Vec2`, `LocationProps`) in `src/locations/types.ts`. Read: `sim/geography.ts`, `sim/environment.ts`.
- [x] **M1.2** Create `src/locations/haulover/` re-exporting the current geography **as a `Location` object** (move code, keep names). `GeoGrid.bake(loc)` takes the location. Keep a `haulover` default so call sites compile.
- [x] **M1.3** Thread `Location` through the physics path: `Environment`, `makeBoatEnv`, `WaveField` (swell/hay masks), `Hazards`. Tests: `environment`, `boat.sim`, `balance` still green.
- [x] **M1.4** Thread it through render: `terrain`, `textures`, `water`, `wake` read the location's world extents, not `WORLD`.
- [x] **M1.5** Move the 10 prop builders (`render/world/*`) behind `location.buildProps`; Haulover's builds the same scene it does today.
- [x] **M1.6** Move course/gates and marina/docking constants (`SLIP`, `DOCK_APPROACH`, `BASIN_LOOP`, `DOCKS`, `PILINGS`, `MOORED`) onto the location; `Docking`, `Autopilot`, `Traffic`, `dockRadar`, `minimap` take them from the location.
- [x] **M1.7** A second, tiny test location (open flat sea) used in unit tests to prove nothing still assumes Haulover (`tests/location.test.ts`).
- **Done when:** the engine (`sim/`, `render/`, `audio/`, `ui/`) imports nothing from `locations/haulover` — **met**; the only remaining Haulover-aware file is `game/game.ts` (it picks `HAULOVER` and `makeCourse`), which is exactly M2.1. Tests, typecheck and build green; a full headless run, the menu scene, bridge/jetties and marina all render as before.
- **Risk (not yet removed):** `DOCKS/PILINGS/MOORED` are still filled by module-level side effects inside `locations/haulover/geography.ts`. Harmless while there is one *instance* per location, but Nantucket's harbor should use a builder function instead. `Harbor.berths` is also still slip-only (`SlipBerth`); M3b generalises it.

### M2 — Modes, shell, saves

*Goal: launch Haulover from a title screen; the engine knows nothing about gates.*

- [x] **M2.1** Define `GameMode` / `RunContext` / `ShellContext`; write `HaulMode` by **moving** gate, course, run-clock, scoring, docking-finale logic out of `Game` (`game/game.ts` lines for `runLogic`, `finish`, `respawn`, gates). `GameCore` keeps loop/camera/input/audio/toasts.
- [x] **M2.2** Split the UI: shared HUD parts (speedo, bilge, hull, wave dial, sail panel, toasts, pause) vs Haulover-only (gate progress, route menu, dock panel). Mode supplies menu + extra panels.
- [x] **M2.3** `shell/`: title screen "RUN THE CUT" with three cards (Haulover / Montauk / Nantucket — the last two "coming soon" until built), `?game=` routing, mode registry, dynamic imports.
- [x] **M2.4** Per-game saves: `saveBest(game, cfg)`, settings migration from the current single-game keys.
- [x] **M2.5** Docs: README "Games" section; update `scripts/*` for `?game=`.
- **Done when:** `?game=haulover` and every legacy launch URL play identically to today; a bare URL shows the title screen; tests + build green; first-load JS not larger than today. **Met** — the title screen is now an 11.7 KB entry chunk; the 980 KB engine, the 84 KB host and the 89 KB Haulover chunk load only after a pick. Title screen not yet checked on a phone in landscape (do that with M5.3).
- **Carried forward to M3:** `GameConfig.route` is still Haulover's `Route` (Nantucket needs a generic `variant`/berth field); `Docking`, the radar and `DockMarker` are slip-only; `Traffic`'s lanes/basin loop are Haulover-shaped; `ResultState` is Haulover-shaped (gates, dock line) — generalise when the second mode needs it.

### M3 — Nantucket: the docking challenge

**Fantasy:** Brant Point Light, Straight Wharf, Old North Wharf, the Boat Basin, Steamship Wharf, moorings in the harbor, fog and a cross-tide. Pick a vessel, pick a berth, and *park it*. Bigger vessel = harder.

**Design**
- **Berth types:** *stern-in slip* (Haulover's), *bow-in slip*, *alongside the wharf* (parallel, with the current), *mooring ball* (pick up the pennant at the bow, boat-hook radius), *Med moor* (stern to the quay, drop the anchor off the bow — stretch).
- **Berth definition:** polygon, target heading, tolerance ±°, max touchdown speed, approach lane, fenders yes/no, ambient hazards (boats moving, ferry arriving). Score = speed, angle, offset, time, bumps (reuse `DockStatus` scoring).
- **Vessels (difficulty ladder 1–5):** Tiki Barge & Hornet (1–2, existing) → Pelican sloop (3, wind-driven approach) → Sunset 42 (3) → **harbor tug / work boat** (3, twin screws, great turning) → **Island ferry** (4, ~70 m, twin screws + bow thruster) → **Mega-yacht** (4, ~60 m, thrusters) → **Cruise ship** (5, 200 m+, huge windage, momentum, bow + stern thrusters, pivot point mid-ship, **tug assist** budget the player calls on). Each adds a `skill` and `scoreMult` like the existing boats.
- **New controls for big vessels:** differential throttle (twin screws), bow/stern thrusters (`Z`/`C`… final keys decided in M3c), tug calls (push/pull/hold, limited per run), camera from the bridge wing.
- **Conditions:** fog and moonlit weather presets already exist; add wind/tide *gusts* at the harbor mouth; tide changes during the run on hard levels.
- **Progression:** a level-select map of the harbor with berth pins; star ratings (1–3) per berth/vessel; a vessel unlocks when the previous tier has ≥ 1 star in two berths.

**Tasks**
- [x] **M3a Location:** Nantucket geography (bathymetry, harbor basin, Brant Point, jetties, Easy Street Basin, wharves as `hardSDF`, tide flow through the entrance), scenery props (cobble waterfront, lighthouse, moored boats, ferry dock), weather defaults. First, *playable empty harbor* behind `?game=nantucket`.
- [x] **M3b Berth system:** generalise `Docking` to `Berth[]` + `BerthSession` (replace the single `SLIP`); `dockMarker` draws the active berth; radar/parking sensors read the active berth; mooring-ball pickup rule.
- [x] **M3c Big-vessel physics spike (do early, 1 session):** can `Boat` carry a 70 m / 200 m hull? Try scaled `BoatSpec` (mass 1e6–1e8 kg, samples grid, SUB_DT, inertia, camera distance) + thrusters + differential throttle. **Decision gate:** if numerics are unstable, add a simplified planar `ShipBody` (surge/sway/yaw + wind/current/thrusters, heave/pitch/roll cosmetic) behind the same interface used by `GameCore`.
- [x] **M3d Vessels:** tug, ferry, mega-yacht, cruise ship — `BoatSpec`, procedural models + Stars-and-Stripes ensign, engine audio (diesel/horn), docking autopilot parameters for tests.
- [x] **M3e Tug assist + thrusters UI:** thruster dial, tug call buttons/keys, HUD for pivot point & drift vector (very helpful for ships).
- [x] **M3f Levels + scoring:** ~12 berth challenges across vessel tiers, star thresholds, unlocks, level-select screen using the minimap renderer.
- [~] **M3g Traffic & hazards:** ferry arrival schedule, boats under way, current-set at the harbor mouth, fog banks.
- [x] **M3h Tests:** docking feasibility per vessel × berth with the autopilot (already the pattern in `tests/docking.test.ts`), determinism, star thresholds monotonic with difficulty.
- **Done when:** a player can open `?game=nantucket`, pick any unlocked vessel/berth, finish or fail it, see stars, and the cruise ship is clearly the hardest yet still beatable by the test autopilot with tug assist.
- **Delivered (v1, 2026-10-16):** `locations/nantucket/*` (bowl, Brant Point, Coatue, four wharves, Easy Street basin with ten fingers,
  a mooring field, town, lighthouse, buoys, dredged fairway, tide through the mouth), `game/{berthing,berthScore,harborPilot}.ts`,
  `sim/tugs.ts`, `data/{hull,ships}.ts`, ship models (`tug`, `ferry`, `liner`), `Boat` thrusters / twin-screw pivot / tug pushes, five
  Nantucket skies, `games/nantucket/*` (12 levels, radar, harbour chart, tug visuals, UI, dev pilot), `scripts/dock-run.mjs`. The pilot
  berths all 12 levels (`tests/nantucket.dock.*`). M3c verdict: the existing `Boat` carries a 116 m / 7,000 t hull (no `ShipBody`).
- **Nantucket backlog (not blocking):** a scheduled ferry arriving at Steamship Wharf and ambient ships under way (the shared `Traffic`
  runs small craft only); a mega-yacht tier; Med moor (stretch); a bridge-wing camera for ships; a horn; a drift-vector / pivot-point
  overlay on the helm; bow-in/stern-in slip bonus; more berths per level (a free-play picker of any vessel x any berth); fog banks that
  drift through the bowl; phone-landscape check of the berth HUD and the thruster / tug touch buttons.

### M4 — Montauk: the tuna game

**Fantasy:** Montauk Point light, the rips off the Point, a long run to the canyon edge. Find the bait, find the birds, find the tuna.

**Phase 1 — Search (drive and read the water)**
- **Surface cues:** diving gannets/terns (reuse `wildlife.ts`), slicks, "nervous water", boils where fish crash bait; seen at distance — a **binocular key** zooms and highlights cues for a moment.
- **Fish finder (sonar):** scrolling depth-vs-time panel under the boat; bait balls show as dense blobs at a depth, tuna as arches beneath them. Bait drifts with the current and thermocline; the player must set up **up-current** of it.
- **Rule:** run fast to get there, but **over ~10 kn near a school spooks it**. Slow to troll speed.
- **Mark** key drops a GPS marker on a school (reappears on the minimap).

**Phase 2 — Troll and hook**
- **Spread:** 4–6 lines off the stern, each with a lure/bait at a set distance. Lines trail **astern**; the HUD shows each rod tip.
- **Speed window:** troll 5–8 kn. Too fast → lures skip out of the water, lines blow back; too slow → nothing swims.
- **Heading:** sharp turns cross the lines (tangle risk, fix by straightening out and waiting); running **across** big seas flings the rod tips — the existing 45° rule applies.
- **Bite:** drag screams, rod bends, "FISH ON!" — the *hook-up* is a quick timing prompt (set the hook inside a window).

**Phase 3 — The fight (tension and direction)**
- **State:** fish bearing and distance from the stern, line out, **line tension** (0–1.2 of breaking strength), fish **stamina**, fish **mood**: *run* (hard, straight away), *sulk* (dives deep, heavy steady pull), *thrash* (erratic jerks), *circle* (near the boat), *tired*.
- **Player controls:** steer and throttle the **boat** (back down toward the fish, never run over the line), a **drag lever** (give line / take line), and a **pump** hold.
- **Crew:** reels automatically at a rate that falls as tension rises and stops at the redline; crew skill and fatigue are a stat.
- **Direction:** keep the fish inside a **±30° cone off the stern** for full reel efficiency. Fish off the beam loads the rail; fish **under the boat** risks the line chafing on the hull or prop = cut-off. Boat speed and sea state add tension spikes (a wave slam during a run can pop the line).
- **Win / lose:** line length ≤ boat length with low stamina → gaff and land. Tension over 1.0 for too long → snap; under ~0.1 for too long → hook pulls out.
- **Scoring:** species/size (bluefin, yellowfin, bigeye, mahi, shark as a bad surprise), time, lines tangled, clean fight bonus, crew morale; difficulty scales fish power and sea state.

**Tasks**
- [ ] **M4a Location:** Montauk geography (Point, the Ruins/Shagwong reef, shoals with **tide rips** using `hayMask`, deep water edge), lighthouse + bluffs + harbor scenery, weather defaults (fog banks, nor'easter, summer calm).
- [ ] **M4b Fish world sim** (`sim/fishing/`, pure + deterministic with a seeded `Rng`): `BaitSchool` (position, depth, density, drift), `Birds` (working/not), `Tuna` (depth, appetite), schedule per run. Unit tests.
- [ ] **M4c Search UI:** binoculars, cue rendering (birds diving, slicks, boils), sonar canvas panel, mark key, minimap markers.
- [ ] **M4d Trolling model** (`sim/fishing/tackle.ts`): line out vs boat speed, lure depth/skip, tangle model from turn rate, rod tips for rendering, bite roll. Unit tests for speed window and tangle.
- [ ] **M4e Fight model** (`sim/fishing/fight.ts`): fish state machine, tension = drag + stretch + boat/sea spikes, stamina, crew reel rate, cone efficiency, cut-off geometry. **Headless sim test** with a scripted "good player" and "bad player": good lands, bad snaps or loses it (like `balance.test.ts`).
- [ ] **M4f Fight UI + feel:** tension gauge with sweet zone, direction compass/cone, drag lever, line rendered from stern to fish, splashes, rod bend, reel + drag audio, camera shake on runs.
- [ ] **M4g Game loop:** `FishMode` — phases (search → troll → fight → land → next fish), run clock/daylight, scoring, results, best scores.
- [ ] **M4h Crew & tuning:** crew skill/fatigue, difficulty tiers, species table.
- **Done when:** a player can find bait by cues + sonar, troll a spread within the speed window, hook up, win *and* lose a fight for understandable reasons, and the headless good/bad-player tests pin that balance.

### M4 — build plan (detailed, 2026-10-15)

*The user's brief for this milestone: same art style with the pastel skies; **wind and tide work against you**; harder to play; **landing a tuna is the win**; it is easy to lose the fish if you do not captain properly.*

**Design decisions** (see Decision log for the why)
- **Win = a tuna on the deck.** Lose = out of daylight with no fish landed, boat lost (swamped/wrecked/capsized), or run out of range. Losing a *fish* costs you the fish, time, and spooks that school, but the day goes on.
- **Wind against tide, always.** Montauk's ebb runs east (out to sea); every Montauk weather has an *onshore easterly* wind, so the ebb stands the sea up into rips (`hayMask`) and the wind shoves the boat towards the rocks while the tide drags you out. Tide menu offers Ebb (default) and Flood only (no easy slack). The wind and tide **build through the day** (`Environment.windGain` / `tideGain`).
- **Captaining is the game.** Everything that decides the fish is a boat-handling input:
  - *Search:* run fast to get there, but a school spooks if you charge it above ~10 kn within ~150 m.
  - *Troll:* lure speed is **through the water** (current-relative), the window is ~4.5–8 kn; lures trail along the boat's *water-frame track*, so a sharp turn crosses the lines (tangle), going too fast skips the lures out.
  - *Hook-up:* the strike sets the hook only at troll speed. The instant it happens you must **throttle back** or the boat's own speed rips the line (tension rises with payout rate).
  - *Fight:* real tether physics. The fish has its own position, depth and velocity; the line has a length, a drag, a stretch; the boat is the real boat (wind, tide, waves all push it). Tension rises when the line pays out fast (fish running, boat running away, tide/wind opening the gap), off-axis fish load the rail, wave slams spike it, a fish under/forward of the boat chafes the line. The crew reels automatically, but only fast when the fish is inside the ±30° stern cone and tension is in the sweet zone.
- **Fish moods** (seeded, telegraphed ~1.5 s ahead): `run`, `sulk` (dives; heavy steady pull), `thrash` (erratic, slack-prone), `circle` (round the boat), `tired`, plus a last dash at the boat. Fish prefer to run with the tide, so you chase it *into* the rips.
- **Controls added:** `L` lines out/in, `V` (hold) binoculars, `T` mark a spot, `Q`/`E` drag (ease / tighten, reusing the sheet axis), `Z` (hold) pump the rod. Everything else is the normal helm.

**Tasks** (tick as they land; `npm run typecheck && npm test && npm run build` after each)
- [x] **M4.0 Seams:** `Environment.windGain/tideGain` (the sea builds through the day); `Game.frameSlam`; weather `exclusive` flag + `weatherFor(game)` + four Montauk pastel skies; `ModeUi` optional `controlsHtml/hintHtml/resultStats/startLabel/touchButtons`; result outcomes `landed | adrift`; `ModeDef.defaults`; `GameMode.difficulty()/audio()`; `GameCamera.fovOverride` + a `fight` (stern view) camera + look-around at the helm; `Input` keys `L V T Z`, `sheetRate`, touch fishing buttons; shared bird meshes extracted to `render/birds.ts`; `render/terrainMesh.ts`, `render/propKit.ts`.
- [x] **M4.1 Location:** `locations/montauk/` — geography (Point, shelf, edge, Shagwong reef, point shoal, Frisbee's hump, the Fingers, rip streak, tidal field with a back-eddy, boulders), pastel terrain with clay bluffs, props (lighthouse + keeper's house, bluff scrub, cottages, boulders, two buoys, ambient gulls). `tests/montauk.location.test.ts`.
- [x] **M4.2 Fish world** `sim/fishing/{species,tiers,world}.ts`: schools form on the zones, drift with the tide, feed in pulses, hold 0–3 tuna (4 species), show birds / boils / slicks / sonar echoes, spook on a fast hull (speed *through the water*), restock out of sight. `tests/fishing.world.test.ts`.
- [x] **M4.3 Tackle** `sim/fishing/tackle.ts`: four rods, water-frame track, speed window, skipping, tangles from crossed lure order, prop foul on backing down, sea tangles, strikes (proximity × depth × appetite × window). `tests/fishing.tackle.test.ts`.
- [x] **M4.4 Fight** `sim/fishing/fight.ts`: tether physics (fish force balance, stretch, drag slip, spool factor, rail load), moods with a 1.6 s warning, stamina, crew with cone/fatigue/pump, chafe, slam/heave spikes, last dash, gaff rule. `tests/fishing.fight.test.ts` (kinematic boat, scripted captains) pins good-vs-bad-captain and tier ordering.
- [x] **M4.5 Mode loop** `games/montauk/mode.ts`: search → troll → fight → landed, daylight clock, sky drifting to dusk, wind/tide ramp, out-of-range, aground, scoring, results, saves, registry entry. `tests/montauk.day.test.ts` plays whole days in the pure sims.
- [x] **M4.6 Visuals** `games/montauk/visuals.ts`: working terns/gannets with dives, boils and spray plumes, foam rings, slicks, rods bending to the fish, lines (camera-facing ribbons), lures that skip, a tuna model that leaps, beacons on marks.
- [x] **M4.7 HUD** `games/montauk/{ui,sonar,map}.ts`: day panel, chart, fish finder, troll panel (speed window, rod pips), fight panel (tension gauge with sweet zone + trace, stern-cone diagram with run warning, tide/wind arrows, line/crew/drag bars, live hint), binocular lens with spotted-tags, result card.
- [x] **M4.8 Audio + feel:** drag scream that rises with slip, reel clicks, strain whine near the limit, strike ratchet, sonar ping, camera shake on strike/loss.
- [x] **M4.9 Balance + docs:** scripted captain in the real page (`games/montauk/dev.ts`, `scripts/fish-run.mjs`, `scripts/fish-fights.mjs`); README, this log.
- **Done when:** met — a player can find bait by cues + sonar, troll a spread within the speed window, hook up, and win *and* lose a fight for understandable reasons; scripted good/bad captains pin that balance.

**Where it stands (measured):** scripted captain, real boat and sea, Mate tier: ~2/3 of fights landed, ~95 s average fight; whole Mate days land a tuna ~4 days in 6 (≈0.9 strikes a day); `powerAway`/`keepGoing`/`idle` captains land essentially nothing. Pure-sim days: Deckhand ~60 %, Mate ~37 %, Captain ~30 %, Legend ~20 %.

**Montauk polish backlog (not blocking):** ambient charter fleet on the grounds (a clue to where the fish are); a tangle visual; rod-tip bend on the *troll* strike; a shark/mako surprise; fog banks in the peach sky that really cut the horizon; bait-ball shimmer under slicks; tune the fish moods per species further (bigeye sulk, bluefin run); per-species fish results art; gamepad drag lever on triggers; phone-landscape pass on the fishing panels; real determinism for `?seed=` (the frame-timed prelude still varies the physics).

### M5 — Polish and ship

- [ ] **M5.1** Title screen art + per-game tagline cards, shared "captain's log" (best result per game).
- [ ] **M5.2** Audio pass per mode (sonar ping, reel, ship horns, harbor bells).
- [ ] **M5.3** Performance: lazy-load each game's chunk and props; per-location quality presets; check low-end WebGL2.
- [ ] **M5.4** README rewrite (three games), `docs/` screenshots refreshed, GitHub Pages workflow builds all modes.
- [ ] **M5.5** Cross-game regression pass (all tests, shot-tool smoke test per game).

---

## 5. Order and why

`M1 → M2 → M3 → M4`. The user's numbering is Haulover / Montauk / Nantucket, but **Nantucket before Montauk** is
recommended: it reuses the most (docking logic, radar, traffic), proves the `Location`/`GameMode` seams with the
least new simulation, and de-risks big-vessel physics early. Montauk needs the most *new* systems (fish sim,
sonar, fight). Easy to swap — M3 and M4 only depend on M1–M2.

## 6. Testing strategy

- Keep the **headless-harness pattern**: pure sim in `sim/` and `sim/fishing/`, deterministic (`Rng`), tested with vitest; render/UI stay thin.
- Every mode gets: a **feasibility/balance test with a scripted player**, a **monotonic difficulty** test, a **determinism** test.
- Use `scripts/shot.mjs` for before/after screenshots at the end of each milestone; `scripts/sim-run.mjs` for full-run smoke tests.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Ship-scale hulls destabilise the buoyancy cloud | M3c spike first; fallback `ShipBody` |
| Refactor breaks Haulover | M1/M2 are "no behaviour change" gates with before/after screenshots and the full test suite |
| Bundle size grows with three locations | dynamic `import()` per game; prop builders lazy |
| Fight feels random | deterministic seeded fish + scripted good/bad player tests; expose fish state in a debug overlay |
| Scope creep | each milestone has a *Done when*; stretch items are marked **stretch** (e.g. Med moor) |

## 8. Open questions (answer before the milestone that needs them)

- **M3:** keep the real Nantucket scale (a 200 m ship in that basin) or a stylised harbor so the cruise ship fits comfortably? *(default: stylised-but-recognisable)*
- **M4:** is the fish fight keyboard-only, or should it use the mouse/gamepad stick for rod angle? *(default: keyboard + gamepad triggers; no mouse requirement)*
- **M2:** should one profile share unlocks across games (sloop skill, boat unlocks) or keep each game separate? *(default: separate bests, shared settings)*
- **Issues:** mirror each milestone's checklist into GitHub issues? *(not done yet — would create public items)*

---

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-15 | Share one engine; separate `locations/` (data) from `games/` (rules). | 24 files read Haulover geography directly; rules are mixed into `Game`. |
| 2026-10-15 | Refactor incrementally with "no behaviour change" gates, not a rewrite. | Haulover has 107 tests and calibrated balance to protect. |
| 2026-10-15 | Recommend Nantucket before Montauk. | Most reuse, de-risks ship physics, fewest new systems. |
| 2026-10-15 | `Location` carries `fields`, `world`, `flowCell`, `harbor?`, `map`, `corridorHalf`, `keepClear?`, `buildTerrain`, `buildProps`. `GeoGrid` carries its own extents and is cached per location id. `Environment` takes the `Location` explicitly (no global/default). | Keeps tests honest (a second location exists in `tests/location.test.ts`) and makes baking cheap. |
| 2026-10-15 | Haulover wildlife (gulls, pelicans, kites) lives inside `locations/haulover/props`. | It is flavoured by Haulover (shorelines, park). Extract the generic bird logic for Montauk in M4b. |
| 2026-10-15 | **M2 design.** `Game` stays the engine host (same public API, so `window.__game` / UI / scripts keep working); rules move to a `GameMode` it drives through `prepare/populate/begin/update/visuals/fillHud/respawnPose/onRespawn/clearance/wakeBoats`. Shared boat feedback (slam, green water, wave streak, air, tack/gybe, bilge + hull warnings) stays in the host so every mode gets it. `HudState` stays the shared HUD shape (time/progress/objective fields are filled by the mode). Modes get the host object itself rather than a facade. `ModeUi` supplies menu sections, mode HUD panels, per-tick update and the result body; vessel picker / conditions / tide / difficulty are shared menu parts. A bare URL shows the title screen; any legacy launch param (`boat`, `weather`, `tide`, `difficulty`, `route`, `auto`, `go`, `noui`, `cam`, `debug`, `webgl`, `quality`) or `?game=` launches directly (Haulover when only legacy params). | Keeps every dev tool working unchanged and avoids a 1000-line big-bang rewrite. |
| 2026-10-15 | `?quality`, `?webgl` and `?debug` alone do **not** launch a game (they are global switches); `noui`, `auto`, `go`, `cam`, `wakedebug`, `cruise` and the five config params do (Haulover). After a pick the URL becomes `?game=<id>` so the quality-switch reload keeps the game. | Preserves every existing tool/link without making the title screen unreachable. |
| 2026-10-15 | Haulover save keys unchanged (`last`, bests keyed `boat|weather|tide|difficulty|route`); other games use a `lastBy[game]` slot and a `game:` prefix on bests. | Existing players keep their bests. |
| 2026-10-15 | Fixed a pre-existing UI bug while splitting the result card: a successful **docking** (`docked`) now shows stars and score like `finished` (it was treated as a non-win). | Found by reading the extracted code. |
| 2026-10-15 | **Confirmed by user:** build in order M1 → M2 → Nantucket → Montauk; Nantucket harbor is *stylised but recognisable* so the cruise ship fits. | User approved the plan as written. |
| 2026-10-15 | **User reordered: Montauk (M4) before Nantucket (M3).** Brief: pastel skies, wind and tide against you, harder, win = a tuna landed, easy to lose the fish if you do not captain. | Direct request. M3 and M4 only depend on M1–M2, so nothing else changes. |
| 2026-10-16 | **Montauk fight is a tether, not a bar.** Tension = stretch of a line whose length is paid out by a drag that slips (`slipGain × (T − drag)`) and taken in by the crew; the fish is a force balance (thrust by mood, water drag, line pull) so the boat, the tide and the sea decide the tension. The scripted captains in tests/dev bots are the balance reference. | The user's brief: *captain properly or lose the fish*. Anything that depends only on a meter would not punish bad boat handling. |
| 2026-10-16 | Lures trail along the boat's track **in the water frame**; tangles are detected by the *order* of lures across the stern flipping against the order of the rod tips. | Gives "keep the lines going off the stern" real geometry (sharp turn = tangle, beam wind = spread blows to leeward) with no special cases. |
| 2026-10-16 | Schools are spooked by speed **through the water**, not over the ground; the gaff and the crew use boat motion **relative to the water**. | The tide supplies plenty of ground speed for free; fish, boat and line all share the water. |
| 2026-10-16 | Montauk has its own sea scaling per tier (`seaFor`, via `GameMode.difficulty`) and its own default sky (`ModeDef.defaults`); a game that has exclusive skies lists only those. | Haulover's Legend swamped a console in the rips in seconds; Montauk's skies are already steep and you sit in them all day. |
| 2026-10-16 | Wind and tide **build through the run** (`windGain`/`tideGain`, per-tier ramp) and the sky drifts to dusk. | "Wind and tide work against you": waiting is not free, and it doubles as the daylight clock. |
| 2026-10-16 | **Agents play through `window.__agent`, not the DOM.** `?agent` makes the page stop driving the sim; the agent steps it, so a seed + action list reproduces a run. Observations are what a player could know; `cheat:true` is for tests/bots and must be labelled. Games add fields through `GameMode.agentState/agentAct`. | Headless scripts were non-deterministic and scraped internals; a stable JSON contract (pinned in `tests/agentApi.test.ts`) lets any agent playtest, reproduce bugs and regression-test balance. |
| 2026-10-16 | Hull winding and a per-hull sea cut-out are part of the boat art, and a sixth boat (`charter`, Montauk Lady 46) joins the fleet. | Cockpit floors read as white water: decks were wound downward (culled from above), the shell was inside-out (livery inside), and the sea painted over open cockpits. Fixed in `loft.ts`, `materials.ts` and the water shader for every boat. The charter is the old-school inboard Montauk boat the user asked for (bigger, heavy, steady, slow to turn). |
| 2026-10-16 | **M3c verdict: no `ShipBody`.** The existing `Boat` carries a 116 m / 7,000 t cruise ship with a spec scaled by `buildHull` and four additive fields (`engine.pivot`, `thrusters`, `linDrag`, `Boat.tugs`). | A spike measured it: level float, rated top speed within 8%, 190 m to stop from 4 m/s, sane thruster / wind / wall behaviour, 1.4 ms per update. A second body would have cost a second set of behaviours. |
| 2026-10-16 | A level fixes the vessel (`GameConfig.level`, saves and stars keyed by it). Ships sit on the same ladder as the boats; `BOATS` stays the Haulover / Montauk roster and `ALL_BOATS` adds `SHIPS`. | Haulover and Montauk menus must not offer a cruise ship; Nantucket's difficulty is *which vessel at which berth*. `GameConfig.route` stays Haulover's. |
| 2026-10-16 | Each wharf's approach road ends at a "mouth" (200 m back, 34 m off the face) and the last stretch is a shallow diagonal. The fairway is dredged along the ship's berth. | A pilot that cuts waypoint corners, or a 5.2 m keel on a 5 m bowl, groundes or hits things; the road, the depth and the test pilot were fixed together. |
| 2026-10-16 | Level clocks are ~1.5x the pilot's time at the middle difficulty (`tests/nantucket.dock.*` prove each level docks inside it). Captain and Harbor Pilot shorten the clock (0.85x, 0.7x) rather than only adding wind. | A clock you cannot meet is not difficulty. The pilot is conservative, so a human can beat it. |
| 2026-10-16 | Tier 1 uses the Tiki Barge, the Hornet (on a mooring only) and the Sunset 42. | The light, fast Hornet and the wind-blown pontoon cannot hold station against a quay for a pilot (or a beginner): slips and moorings forgive, a quay does not. Heavy hulls are the forgiving ones. |
| 2026-10-16 | The suite's `testTimeout` is 60 s (`vite.config.ts`), not Vitest's 5 s default. | The Pages deploy failed on `tests/montauk.day.test.ts` ("Test timed out in 5000ms"): a 2.3 s test on a laptop is over 5 s on a loaded runner, and the Nantucket dock tests had made the suite heavier. Reproduced on Node 24 under CPU load; the same run passes with the new timeout. |

## Session log

| Date | Milestone | What happened | Next |
|---|---|---|---|
| 2026-10-15 | M0 | Audited the code, wrote this roadmap. No code changed. | M1.1 |
| 2026-10-15 | M1 | Whole milestone in one session. `src/locations/{types.ts, haulover/*}`, `sim/geoGrid.ts`; moved geography, terrain, 10 prop builders and the route builder into `locations/haulover` with `git mv`; `Docking`, `Autopilot`, `Traffic`, `Hazards`, `DockRadar`, `minimap`, `DockMarker`, water/wake/textures now take data from the location. Added `tests/location.test.ts` (flat 800×600 m sea). 111 tests, typecheck, build green; full headless run docks; scene/bridge/jetties/marina screenshots verified. | **M2.1** — define `GameMode`/`RunContext` and move gate/course/run-clock/scoring/docking-finale out of `game/game.ts` into `HaulMode`. |
| 2026-10-15 | M2 | `game/mode.ts` (`GameMode`, `ModeUi`, `ModeDef`); `games/haulover/{mode,ui,dev,minimap,dockRadar}.ts` hold all Haulover rules and UI; `game/game.ts` is now the engine host (1039 → ~620 lines); `ui/ui.ts` is the shell, `ui/menuSections.ts` the shared menu, `ui/format.ts` shared formatters; `games/registry.ts` + `shell/title.ts` + dynamic imports. `Traffic` now takes the host's obstacle list; settings are per game. New `tests/shell.test.ts`. 120 tests, typecheck, build green; title → pick → menu, legacy URLs, full headless run (docks), in-run HUD and docking panel all verified in the real page. | **M3a** — Nantucket location (geography, harbor, scenery) playable empty behind `?game=nantucket`. Before that: M3c (big-vessel physics spike) is the riskiest item and is worth doing first. |
| 2026-10-16 | M4 | **Montauk v1, whole milestone in one session (user reordered it ahead of Nantucket).** New: `locations/montauk/*`, `sim/fishing/*`, `games/montauk/*`, `render/{birds,terrainMesh,propKit}.ts`, four pastel skies, per-game defaults/sea/skies/touch/controls hooks in the shell, fight/stern cameras and binoculars, fishing audio. Playtested headless on the real boat (fish-run / fish-fights) and with screenshots of the title, menu, search, troll, fight, binoculars and both result cards. 169 tests (+49), typecheck, build, lint green. | **M3** — Nantucket (M3c big-vessel physics spike first), or the Montauk polish backlog above. |
| 2026-10-16 | Agents | **Agent-collaboration kit.** `AGENTS.md` + `CLAUDE.md`; skills `pastel-art-style` (guide, palette, recipes), `playtest-and-verify`, `add-game-mode` in `.claude/skills/`; `window.__agent` (`src/dev/agentApi.ts`, `?agent`): JSON observations/actions, deterministic stepping, `GameMode.agentState/agentAct`; `scripts/agent-demo.mjs` (clears the Haulover outbound route from observations alone, hooks a Montauk fish); `scripts/palette-check.mjs`; `npm run check`; PR template; `ask` rule for force-pushes. | Nantucket M3c, or Montauk polish. |
| 2026-10-16 | Boats | **Dry cockpits + sixth boat.** Winding flips in `loftShell`/`hullStrip`, a closed `loftTransom`, liner shading, and a hull cut-out in the water shader (`HullCut`, up to 6 hulls) so no boat holds sea; verified with screenshots of all six boats in a warm and a stormy sky. New `charter` (Montauk Lady 46, 14.8 m / 24 t, twin diesels, tuna tower, outriggers, fighting chair; `models/charter.ts`, top 11 m/s tuned with `TUNE=1`); 6-up boat picker; scripted captain steers harder for slow-turning boats (charter lands 2 of 4 seeds on Weekender). 178 tests, typecheck, lint, build green. | Nantucket M3c, or Montauk polish. |
| 2026-10-16 | M3 | **Nantucket v1, whole milestone in one session.** M3c spike first (the `Boat` carries a ship), then `data/{hull,ships}.ts`, `Boat` thrusters / pivot / tug pushes, ship models, `locations/nantucket/*`, `game/{berthing,berthScore,harborPilot}.ts`, `sim/tugs.ts`, five skies, `games/nantucket/*` (12 levels, radar, chart, tugs, UI), `scripts/dock-run.mjs`, agent API (`bow`, `stern`, `tug`). Found and fixed on the way: a phantom wall across the basin mouth (carved SDF), non-whole grid extents (NaN, black screen), a ship grounding outside the dredge, a pilot cutting waypoint corners. Verified with screenshots (menu + chart, slip / mooring / quay / liner approaches, fog / nor'easter / night / breeze, result card) and `dock-run`; the pilot berths all 12 levels. ~330 tests, typecheck, lint, build green. | Nantucket backlog (ferry schedule, mega-yacht), Montauk polish, or M5. |
