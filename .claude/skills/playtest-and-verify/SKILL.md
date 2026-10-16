---
name: playtest-and-verify
description: How to see and test Run the Cut as an agent - run the gates, start a dev server on a spare port, take screenshots with scripts/shot.mjs, play whole games headlessly (sim-run, fish-run, fish-fights), and drive the game through the JSON agent API (?agent, window.__agent). Use before claiming any gameplay, rendering or UI change works, after a refactor, and when balancing difficulty with scripted bots.
---

# Playtest and verify

You cannot judge a boat game from types and unit tests. Verify at four levels, cheapest first, and **say which
levels you actually ran** when you report back.

## 1. Gates (always)

```bash
npm run check        # biome + tsc + vitest: the one command. Must be clean (no warnings).
npm run build        # also type-checks and bundles; run before finishing anything that touches src/
```
Individual: `npm run lint`, `npm run typecheck`, `npx vitest run tests/<file>`. Balance tools that are not part of
the normal run: `SWEEP=1 ... tests/sweep.test.ts`, `DAY_TABLE=1 npx vitest run tests/montauk.day.test.ts -t prints`.

## 2. Look at it (any visual or UI change)

```bash
npx vite --port 5392 --host 127.0.0.1 &        # use 5392, not 5391/5173: those may be the human's server
node scripts/shot.mjs --url "http://127.0.0.1:5392/?game=montauk&seed=7" --wait 7000 \
  --steps '[{"eval":"window.__game.startRun()"},{"wait":5200},{"shot":"/tmp/run.png"}]' --out /tmp/menu.png
```
Then **open the PNG** (the Read tool shows images). `--w 1280 --h 720` and `--w 844 --h 390` check small screens.

Useful `eval` hooks: `window.__game` (the engine host: `.mode`, `.player`, `.env`, `.cam`, `.update(dt)`),
`window.__setCam(x,y,z, tx,ty,tz)` (fixed debug camera), `window.__game.mode.debugStrike('bluefin', 160)` (hook a
Montauk fish now). To jump ahead without waiting in real time, step the sim inside one `eval`:
`(()=>{const g=window.__game;for(let i=0;i<30*60;i++)g.update(1/30);})()`. To hold a key while shooting, dispatch
events (`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyV'}))`), since `shot.mjs` key holds block.

URL switches: `game=haulover|montauk`, `weather= boat= tide= difficulty= route=`, `seed=` (Montauk fish layout),
`quality=low|medium|high`, `webgl`, `noui`, `debug` (telemetry overlay), `auto&go` (scripted pilot), `agent`.
A bare URL shows the title screen. **Kill your servers when done** (`pkill -f "vite --port 5392"`).

## 3. Play a whole game headlessly (gameplay, balance, regressions)

```bash
node scripts/sim-run.mjs --url http://127.0.0.1:5392/ --boat console --weather breeze --difficulty weekender --route full --cruise 0.55
node scripts/fish-run.mjs   --seed 1,2,3 --difficulty weekender --skill captain     # whole Montauk days, real boat + sea
node scripts/fish-fights.mjs --difficulty dockside,weekender,captain,legend --n 10 --x 1900 --z 400   # land rates per tier
```
They run the real page with a scripted pilot (`?auto`; Montauk `skill=captain|idle|keepGoing|powerAway`) and fast-forward
the sim. Compare against a **baseline**: to know if *you* broke something, run the same command on a clean checkout
(`git worktree add /tmp/base HEAD`, symlink `node_modules`, another port) before blaming your change. Results vary
run to run unless you use the agent API (below), because real frames advance the sea clock before the script starts.

## 4. Play it through the agent API (deterministic, JSON)

Open `?game=<id>&agent[&seed=N][&noui]`. `window.__agent` then owns time: the sim only advances inside
`step()`/`start()`, so the same seed and actions give the same run.

```js
const A = window.__agent;
let o = A.start({ boat: 'console', weather: 'm-dawn', difficulty: 'weekender' });  // -> observation after the countdown
A.act({ throttle: 0.5, steer: 0.1 });         // holds until changed; { release: true } gives the helm back
o = A.step(2);                                // 2 s later (1/30 s steps); stops early when the run ends
o.boat.speedKn; o.sea.waveAngleDeg; o.mode;   // plain JSON; compass degrees, knots, metres (x east, z south)
A.act({ mode: { lines: 'out', drag: 0.2 } }); // game-specific actions (Montauk); A.describe() lists them all
A.observe({ cheat: true }).mode.schools;      // hidden state, for testing only; a *playing* agent must not use it
```
`scripts/agent-demo.mjs --game haulover|montauk` is a working template (observe -> decide -> act -> step). It clears
the Haulover outbound route from observations alone. Use the API to write a bot for a new mechanic, to reproduce a
bug exactly (`seed` + action list), and to get regression evidence that a "feel" change did not make a game
unwinnable. The data contract is pinned in `tests/agentApi.test.ts`; add a mode's fields to `agentState()` in the
mode, not to the API.

## What counts as verified

| You changed | Minimum evidence |
|---|---|
| a pure sim (`src/sim`) | unit test with a scripted good *and* bad player; `npm run check` |
| rules or balance | headless bot runs (3, 4 or the API) with numbers, compared with a baseline |
| anything visible | a screenshot you actually opened, in a warm and a stormy sky, plus 1280x720 |
| UI | screenshot of every state of the panel (hidden, normal, alarm) and phone landscape |
| a refactor | `npm run check`, `npm run build`, one headless run per game, title -> game -> result clicked through |

If you could not run something, say so plainly rather than implying it passed.
