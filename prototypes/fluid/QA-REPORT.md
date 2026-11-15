# Unified water prototype gate report

Date: 2026-11-15 (Asia/Seoul)
Prototype version: 1 (local only)
Repository baseline: `origin/main` = `d1fe7120acb4ef2b099515c77725b7756d7477ee`
Work branch: `prototype/unified-water-gate`

## Scope

This run implemented an isolated deterministic Node fluid prototype and tests. It did not modify `server.mjs`, `src/game.js`, existing world generation, or save data. It did not run GitHub Actions, push, deploy, or modify the two pre-existing evidence directories.

## Rules under evaluation

Water is represented by integer levels 1..8 in one map. Gravity is processed before conserved one-unit horizontal transfer. A refill proposal applies uniformly to any existing supported residual cell with either two or three full same-level neighbors; no source/ocean flags are used. Candidate W03 scenarios show the 2-neighbor rule refills a supported cell in a 2x2 pool, while the 3-neighbor rule does not; both refill in a 3x3 pool. The proposal is not yet accepted for production: long-run refill convergence and intended ocean/channel behavior need further evidence.

## Test results

- `node --check prototypes/fluid/engine.mjs`: PASS
- `node --check tests/fluid-gate.test.mjs`: PASS
- `node --test tests/fluid-gate.test.mjs`: PASS, 25/25 tests, including W01-W24 and 100 seeds × 100 mixed events (10,000 events), replayed per seed for deterministic hashes and invariants.
- `npm test`: PASS, 137/137 tests (includes the isolated gate suite and existing farming/world/game tests).
- `git diff --check`: PASS.
- Save restore: W11 restores identical state hash and resumes deterministically; no offline time is applied.
- Agricultural compatibility: W22 and existing farming tests pass; `waterSources`/`watered` fixture remains byte-identical.

W08 tests the X seams at 15→16 and -1→0. Z and diagonal boundary variants required by the prompt are not separately covered. W19 covers duplicate tick IDs, not true concurrent persistence during simultaneous mining. W18 is a synthetic 81-chunk rectangular water volume, not an integrated coast with waterfalls and channels.

## Performance sample

Environment: local Node runtime, `node --expose-gc`; one 144×144 XZ area (81 chunks), 8 water layers = 165,888 full water cells, active-cell budget 2,048. One sample of 20 consecutive ticks:

- Heap before water population: 3,131,256 bytes
- Heap after population and GC: 45,793,000 bytes (delta 42,661,744 bytes)
- RSS before: 44,236,800 bytes
- RSS after: 132,509,696 bytes (delta 88,272,896 bytes)
- Mean tick: 21.41 ms; p95: 35.55 ms; max: 35.93 ms
- Max processed per tick: 2,048
- Active cells remaining after 20 ticks: 124,928; queue: 124,928

This proves the per-tick cell cap is enforced but does not prove the queue drains or meets a frame-time budget. The measured sample is not a comparison against the live game baseline and is not a production performance pass.

## Failures found and corrected

- W06 initially let water escape the fixture and the remaining finite volume equilibrated before reaching the reopened barrier. The fixture now seals both ends and uses a three-cell reservoir; conservation is asserted.
- W13 initially placed the cave water inside a solid wall. The fixture now uses a sealed channel and an explicit mined barrier.
- W24 initially recorded dry cells as pending wakes; enqueue now first verifies that the cell contains water.
- W01/W07/W08 fixture overlap/leak errors from earlier runs were corrected. The full suite passed after these corrections.

## Gate decision / remaining work

The isolated scenario and stress suites pass, but the full gate is **NOT PASSED**: Z/diagonal boundary cases, queue-drain and memory-baseline comparisons, full coastal performance evidence, and integrated WebGL/server/save validation remain. Therefore no game integration or migration was performed. The newest request's no-push/no-GitHub-Actions constraint remains in force.

## Android virtual-display QA (2026-11-15)

A separate `prototypes/fluid/dev-preview/` page ran the same prototype `FluidEngine` in the existing `dev.terra.vdtest` WebView and rendered its actual levels with Three.js. This remains an isolated prototype: `src/game.js`, `server.mjs`, ECLIPSE files/settings, and production saves were not changed. No GitHub Actions, push, deploy, app install, wireless-debugging setup, or pairing was done.

- Device: Samsung SM-X820, Android 16. After the prior authorized transport disconnected, the already-connected ADB endpoint reappeared as `127.0.0.1:45027` (transport id 4); no port was guessed and no pairing flow was used.
- Verified display: Display 16, 1280×720, `VIRTUAL`, owner `dev.eclipse.vdisplay`, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`, `mWindowManagerMirroring=false`. Display 0 remained the internal panel; TERRA was absent from its activity list before launch.
- Host log and Window Manager confirmed `dev.terra.vdtest/.BrowserActivity` on Display 16. WebGL probe returned `webgl:true`; `webgl-host.csv` records all preview pages on display 16. Touch evidence contains only test inputs addressed to display 16.
- Screenshots were retrieved only from the ECLIPSE-owned snapshot Surface, not `screencap`. One early PNG read was incomplete and discarded. `a12-81chunk-pre-fog-fix.png` records the obscured visual attempt; the fog and water material were corrected, and `a12-81chunk-visible.png` shows the visible blue 81-chunk water surface.
- Repro command: `EOS_FLUID_QA_OUT="$PWD/prototypes/fluid/evidence-device-qa-2026-11-15" node prototypes/fluid/dev-preview/server.mjs`.

The raw device log has 40 rows in `fluid-runs.jsonl`, preserving early invalid and superseded attempts for audit. Final coverage includes A01–A14 at 10 ticks/s, A01–A04 at 2 and 5 ticks/s, and A11/A12 at 2, 5, and 10 ticks/s. The bad A11 rows used a leaking boundary fixture and are superseded by corrected sealed-fixture rows 35–37. A12 at 2 ticks/s initially hit the harness's 20-second timeout at 40 ticks; the timeout was extended and row 38 completed at 81 ticks. Row 2 is the invalid pre-fix A02 timing attempt; corrected A02 timing is represented by rows 4, 25, and 26. The final A12@5 visual retest is row 40. Do not treat superseded rows as final results.

Representative final measurements:

- A01 at 2 ticks/s: first arrival at `(1,0,0)` in 501ms; stable after 5 ticks / 2.50s; 2 water cells / 8 units; queue 0; mean fluid tick 0.22ms, max 0.50ms.
- A02 at 2 ticks/s: stable after 8 ticks / 4.00s; first arrival at `(3,0,0)` in 3.00s. The 5m scenario's 8-unit source settles at 4 water cells and does not reach the far end; this is observed behavior, not a successful end-to-end arrival.
- A11 corrected sealed full-volume fixture: 1,024 full cells / 8,192 units; queue 0 after one tick at each tested rate. The earlier leaking fixture results are invalid and retained only in the raw log.
- A12 81-chunk load: 165,888 full cells, 1,327,104 units, active-cell cap 2,048/tick, max queue 165,888; queue reached 0 after 81 ticks. At 2 ticks/s it took 40.52s (mean/p95/max fluid tick 15.42/22.60/25.80ms); at 5 ticks/s the final visual retest took 16.22s (14.09/16.70/33.10ms); at 10 ticks/s it took 8.11s (14.88/17.50/21.40ms). The WebView JS heap reported 11.9MB used / 18.2MB total; this excludes native and GPU memory and has no baseline comparison.
- The page's animation-frame counter varied and is not reliable as presented FPS; the display reports 60Hz. Fluid tick time and completion are reported separately.

Scenario limitations: A03's 10m channel fixture contains only 8 source units, so it settles before reaching the far end. A06–A08 action variants use fresh fixtures after opening the barrier; they do not measure breaking and reopening a barrier in one continuously evolving state. A10 is a simplified chunk reload fixture. A14 exercises prototype guard methods and checks unchanged state; it is not a production server input test. These results demonstrate isolated engine/browser behavior only, not integration correctness.

Local verification after the final preview changes: `node --check prototypes/fluid/dev-preview/app.mjs` PASS; `node --check prototypes/fluid/dev-preview/server.mjs` PASS; `node --test tests/fluid-gate.test.mjs` PASS (25/25, including 10,000-event stress); `npm test` PASS (137/137); `git diff --check` PASS.

## Gate decision / remaining work

The isolated engine and device preview run, but the full gate remains **NOT PASSED**. Z/diagonal boundary cases, queue-drain and memory-baseline comparisons, full coastal performance evidence, and integrated WebGL/server/save validation remain. No production integration or migration was performed. GitHub `main` was not changed or pushed.
