# TERRA facility redesign — Android performance QA runbook

## Current verification status

This is a procedure and evidence checklist, not a test result. On 2026-11-16, `adb devices -l` listed no attached device; connecting to `172.20.6.114:5555` was refused. No display was started and no Android measurements were collected in this run. Earlier TERRA visual QA on the SM-X820 reached Android Thermal Status 1 and approximately 41°C skin temperature, so do not start a sustained load test until the tablet is reachable and a fresh thermal sample is safe.

Use the current local branch and preserve its pending open-world changes. Do not reset, migrate, or reuse `data/worlds`, and do not use an assumed port, display ID, cookie, seed, or old screenshot. GitHub Actions, remote push, and merge are out of scope.

## Safe collection helper

`android-vd-host/collect-facility-evidence.sh` records raw evidence only. It:

- Requires an explicit nonzero `DISPLAY_ID`, one unambiguous online ADB target (or explicit `ANDROID_SERIAL`), and an empty evidence directory.
- Refuses a display unless it is a 1280×720 virtual display owned by `dev.eclipse.vdisplay`, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`, and WindowManager mirroring disabled. It also checks that `dev.terra.vdtest/.BrowserActivity` is on that display and absent from Display 0.
- Requires a disposable QA cookie and verifies `/api/world` is a personal generation-v2 world. It hashes the local and served client files to catch a stale server or browser build.
- Captures only through the existing ECLIPSE host-owned Surface, then saves WebView logs, WebGL/touch CSVs, thermal, memory, and `gfxinfo` raw output. It never launches a browser, sends input, calls `screencap`, or prints the cookie.

Example, after the host and isolated server are already running and placement is verified:

```sh
mkdir -p "$TMPDIR/terra-facility-qa/worlds"
export TERRA_SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export TERRA_SAVE_DIR="$TMPDIR/terra-facility-qa/worlds"
export TERRA_QA_COOKIE_FILE="$TMPDIR/terra-facility-qa/cookie.txt"
# Initialize only the disposable test fixture, then start the dev server on the port
# supported by the installed TERRA WebView. Confirm the actual server PID and port.
node android-vd-host/prepare-fixture.mjs
PORT=38173 NODE_ENV=development node server.mjs
```

In another shell, set `DISPLAY_ID` from the current `termux-vd.sh status` and `cmd display get-displays` output; use an empty, timestamped path:

```sh
DISPLAY_ID=16
TERRA_BASE_URL=http://127.0.0.1:38173 \
  android-vd-host/collect-facility-evidence.sh \
  "$DISPLAY_ID" "android-vd-host/evidence/facility-qa-YYYYMMDD-HHMMSS"
```

The `16` above is only an example. Resolve the live ID for each run. If ADB is disconnected, the helper must fail closed; do not try Display 0 or use a remembered wireless port. Set up `adb reverse` only after checking `adb reverse --list` and confirming the server’s actual port.

The helper makes one low-load snapshot. It is not a stress test and does not itself prove FPS, operation, or correct facility motion. Inspect its PNG and CSV/log files before interpreting any numbers.

## Build and world identity

Before each capture, record:

1. `pwd`, `git branch --show-current`, `git status --short`, and the current local commit. Preserve any pre-existing modifications and untracked evidence.
2. The `node server.mjs` PID, working directory, bound port, and a successful HTTP response from that port.
3. `/api/world` values `worldGenVersion`, `worldSeed`, and `worldKind`; use an isolated `TERRA_SAVE_DIR` and `worldKind=personal`.
4. Local and served hashes for `index.html`, `src/game.js`, terrain atlas/greedy mesh, nature visuals, workstation visuals, and industrial visuals. The collector compares those files when their allowlisted routes exist.
5. The browser’s `TERRAVD CREATE display=<ID>`, page-finished URL, `webgl.csv` with `webgl:true`, and WindowManager task placement on the same verified display.

A successful curl alone does not prove the WebView loaded the current modules. A page title or 10×10 legacy view is not proof of a generation-v2 world.

## Controlled visual and interaction matrix

Keep screen size, camera pose, seed, chunk radius, quality setting, and world data fixed when comparing old/new visuals. If the old model cannot be run on the same open-world code and fixture, record the comparison as unavailable instead of mixing different builds.

Capture all views through the ECLIPSE-owned Surface at 1280×720. Never use a physical-display screenshot. Verify the live scene includes the actual requested type before calling a capture valid.

- **Workstations:** `workbench`, `t1_bench`, `tool_bench`, `agriculture_bench`/legacy `farming_bench`, `block_bench`, and `basic_assembler`.
- **Industrial:** drill, flat and uphill conveyors, and smelter. Include matching drops on belts for the moving-state view.
- **World:** plains, forest, beach, river, ocean; include close/far views and one chunk boundary/cave exposure case.
- **Natural/agriculture:** oak, birch, rubber; wheat, carrot, and potato at early, mid, and mature stages.
- **HUD:** 8 quick slots, station interaction, item count, inventory/crafting panel, and tap target clearance.

For actual input, first verify the app is still on the live nonzero display. Every input must include the explicit display target, for example `adb shell input -d "$DISPLAY_ID" tap X Y`. Confirm the result in server state as well as the capture. Never invoke `vd.py input`, Chrome, or Samsung Internet for TERRA.

## Station regression cases

Use disposable server state and verify before/after `/api/world` data for every case:

1. Create one of each supported facility and check type/ID, rotation 0/1/2/3, location, and recipe/inventory state survive save/reload.
2. Verify the rendered model rotates with its machine record and its 1×1m floor footprint stays inside the placement tile. Elevated detail may exceed 1m in Y; it must not change server collision, selection, or neighbor placement rules.
3. Check workstation interaction is available at the old radius and that decorative parts do not capture terrain taps.
4. Place 1, 10, then 100 repeated machines if the device remains cool. Record object/draw-call change at each step; a cached model should not allocate new geometry/material resources per instance.
5. Remove/rebuild the same fixture, cross a chunk edge, and reload. Verify each old group detaches, shared resources remain usable by its siblings, and geometry/texture counts return to the expected factory baseline.
6. The drill auger moves only while a mineable node is in operating range; depleted/no-node state stays idle. Conveyor rollers move only while a drop is assigned to that belt; direction, corners, and one-block uphill transfer stay aligned with the item. No smelting animation should imply a smelting simulation when none exists.
7. Confirm recipes, IDs, server-authoritative validation, collision area, interaction reach, drop/pickup rules, and serialized saves are unchanged.

Do not mutate the production world to build a visual fixture. Do not weaken tests, invent new outputs, or count a model-only fixture as an end-to-end server pass.

## Performance sample protocol

Collect a cold/idle sample and a warmed sample for both the existing local model build and the redesigned build. Use the exact same device, virtual display, seed, visible object layout, camera, chunk radius, and app state. State how each 30 FPS and 60 FPS target was enforced. The virtual display’s refresh-rate label alone is not proof the game achieved that frame rate.

| Measure | Evidence / interpretation |
|---|---|
| FPS and frame time | Capture frame intervals over at least 60s per condition. Report p50/p95 and missed-frame ratio. The current game exposes `terrainFrameAvgMs` EMA only; it does not provide p50/p95 samples unless instrumentation is added. |
| Draw calls / triangles | Record `renderer.info.render.calls` and `.triangles` with the visible camera. Compare 1/10/100 instances. Do not infer draw calls from mesh count alone. |
| Chunk build | Record per-chunk last/mean/max build time while moving through fixed seed/coordinates; also verify seams and mining-exposed faces. |
| Three.js resource counts | Record `renderer.info.memory.geometries` and `.textures` before/after repeated create/remove cycles. Account for factory-owned cached geometry that should remain until factory disposal. |
| WebGL contexts | Record the host WebGL probe canvas count and inspect Android/WebView logs for context loss. One probe canvas is not by itself a count of GPU driver contexts. |
| Memory | Save `dumpsys meminfo dev.terra.vdtest` at matching points. It is process memory, not an exact GPU VRAM measurement. State that GPU memory is unavailable if the driver exposes no trustworthy figure. |
| Temperature / throttling | Save `dumpsys thermalservice` before and after each interval, with timestamps and sensor names/status. Report the hottest trustworthy AP/skin/battery sensors and thermal status. |

The game’s `#stats` currently displays chunk generation EMA, geometry count, and draw count when `body.debug-mode` is active; `renderer.info` also exposes triangles/textures to development instrumentation. The CSS hides `#stats` by default and current code does not establish a `?debug=1` switch or a frame-time percentile buffer. The main integrator should expose those through a development-only path if they are needed for a device run. Do not expose devtools to production.

### Stop conditions

Stop workload immediately if thermal status rises above 0, skin temperature reaches 42°C, temperature is rising quickly, rendering stutters severely, WebGL reports context loss, or Android reports throttling. Do not continue until cooled. Record the stop point and leave the test incomplete. Never substitute old temperature data for a current sample.

## Result ledger

For each row mark **PASS**, **FAIL**, or **BLOCKED**, with evidence path and exact fixture/build identity. At minimum include: all facility silhouettes; rotation/placement/interactions; repeat create/remove resource counts; drill and belt operation state; terrain seams/mining; five biome coverage; natural/crop stages; HUD; save/reload; WebGL/log check; 30/60 performance; thermal/throttling; devtools/production split. Automated test PASS does not imply Android PASS.
