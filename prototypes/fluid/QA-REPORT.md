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

A separate `prototypes/fluid/dev-preview/` page was opened through the existing `dev.terra.vdtest` WebView. The page imports and runs the same `FluidEngine` from this prototype and renders its actual levels with Three.js. No files in `src/game.js`, `server.mjs`, or ECLIPSE were changed. Chrome and Samsung Internet were not launched; Display 0 received no touch or screenshot, and no wireless pairing or app installation was used.

- Device at connection: Samsung SM-X820, Android 16. ADB was already authorized as `127.0.0.1:44447`.
- Resolved virtual display: 16, 1280×720, `VIRTUAL`, owner `dev.eclipse.vdisplay`, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`, `mWindowManagerMirroring=false`; Display 0 remained the separate internal panel.
- TERRA host log: `CREATE display=16`, `PAGE_FINISHED display=16`; Window Manager showed `dev.terra.vdtest/.BrowserActivity` with `mDisplayId=16`. No TERRA host was listed in the Display 0 activity section.
- WebGL probe: `webgl:true`, canvas 1280×720. Captures are from the ECLIPSE-owned snapshot Surface only. Touch log entries from this run used display 16.
- Repro command for the preview server: `EOS_FLUID_QA_OUT="$PWD/prototypes/fluid/evidence-device-qa-2026-11-15" node prototypes/fluid/dev-preview/server.mjs`.

Device measurements saved in `prototypes/fluid/evidence-device-qa-2026-11-15/fluid-runs.jsonl`:

- A01 at 2 ticks/s: first arrival at `(1,0,0)` in 541ms; stable after 5 ticks / 2.54s; 2 water cells / 8 units; queue 0; mean fluid tick 0.56ms, max 0.80ms; animation-frame counter 118.9/s. Device display mode reports 60Hz, so the RAF counter is reported separately and is not treated as confirmed presented FPS.
- A02 at 2 ticks/s: 4 cells / 8 units; water reached `(3,0,0)` and did not reach the 5m end. Its timing fields are **invalid** because the run timer began when the scenario was selected, before the operator pressed Start. The preview code was corrected so the timer starts with the first physical tick; this corrected build could not be re-run on the device after ADB disconnected.

The first capture attempt read the ECLIPSE snapshot while its PNG was still being written; it was discarded. The saved `a01-current.png`, `a01-run.png`, `a02-running.png`, and interaction captures are complete 1280×720 PNGs. The evidence `touches.csv` contains only the eight touch down/up records from this run; all target display 16. Historic host touch records were excluded.

At approximately 18:00 KST the existing wireless ADB transport disappeared. `adb devices -l` returned no devices; reconnecting the previously authorized `127.0.0.1:44447` returned `Connection refused`; the existing ECLIPSE status script reported `Exactly one ADB device required`. I did not guess a new port, enable wireless debugging, or touch pairing UI. Therefore A03–A14, repeat rates 2/5/10, the 81-chunk device run, and corrected A02 timing are **NOT RUN**. Display 0 received no test input or capture.

Evidence: `prototypes/fluid/evidence-device-qa-2026-11-15/`. Android/WebGL visual capability is verified; the 14-scenario real-device QA requested in the newest prompt remains incomplete until the existing authorized ADB connection is restored.

Local verification after the preview timing correction: `node --check prototypes/fluid/dev-preview/app.mjs` PASS; `node --check prototypes/fluid/dev-preview/server.mjs` PASS; `node --test tests/fluid-gate.test.mjs` PASS (25/25, including 10,000-event stress); `npm test` PASS (137/137, 31.60s); `git diff --check` PASS. The new automatic device suite can run 32 fixture/rate combinations and has a 20s per-run timeout, but it was not launched because the existing ADB transport was unavailable.

The device report preserves the invalid A02 attempt as raw JSON for audit; use only A01 as valid wall-clock/arrival measurement. An ADB reconnection using the saved endpoint or user-provided current debug address/port is required before continuing A03–A14 and the 2/5/10 ticks/s matrix.
