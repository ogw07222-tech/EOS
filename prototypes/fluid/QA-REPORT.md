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
