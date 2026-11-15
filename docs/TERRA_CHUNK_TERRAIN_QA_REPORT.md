# TERRA Chunk Terrain QA Report

## Scope and baseline

- Baseline SHA: `5bebf852f411083d58363b603b63dd9bfaf017e1` on branch `main`.
- The required local agricultural QA commits `87cf63c` and `5bebf85` are present in repository history.
- The repository already contained unrelated uncommitted EOS work when this task began. Those edits and evidence folders were preserved; no commit was created.
- No Android/ADB test was run, as explicitly requested. No GitHub Actions, remote push, or deployment was run.

## Terrain and persistence design

- New worlds retain `schema: 1` and `worldVersion: 3`, and add an unsigned `worldSeed`, `worldGenVersion: 1`, and a `(0,0,0)` `worldAnchor` coordinate record.
- The shared deterministic terrain module uses 16×16 X/Z columns and Y `[-32,32]`. Seeded global-coordinate smooth value noise generates gentle surface heights; the first world has a seed-independent 12×12 flat landing area (X/Z `[-6,5]`) at surface Y=0. The spawn is `(0.5,0,0.5)`. Surface blocks are grass, the next three layers are dirt, and deeper layers are stone.
- World edits remain sparse global-coordinate patches in the existing per-user JSON save. Explicit edits, including `null` air patches, take precedence over generated terrain. This preserves the existing file format and lets old schema-1 saves without generation metadata continue using their original island and bounds.
- The server saves a newly created world immediately so its seed is durable before the first gameplay mutation. The client streams the player-centered Chebyshev window (radius 4 by default, configurable from 2–6), queues the center first, and disposes GPU chunk geometry on unload without deleting saved edits. Unedited chunks use heightfield meshes; edited neighborhoods use voxel meshing. The existing legacy renderer remains active for unversioned saves.
- Block and machine placement previews use the same expanded coordinate bounds as the server for generated worlds while preserving legacy bounds.

## Changed and added files

Terrain-specific changes in this task:

- `server.mjs` — generated-world metadata, seed persistence, world-aware bounds, generated block resolution, and generated terrain collision/edit handling.
- `src/game.js` — streamed terrain meshes, center-out chunk work, edit invalidation, loaded-chunk raycasts/outlines, world-aware previews, and client-side build/frame stats.
- `src/chunk-world.mjs` — deterministic generation, coordinate helpers, bounded height cache, chunk-window planning, and stale-job guard.
- `tests/chunk-world.test.mjs` — deterministic terrain, coordinate/seam, overlay, cache, streaming-window, and stale-job tests.
- `tests/chunk-server.test.mjs` — isolated server persistence/restart, edit, collision, generated agriculture, and legacy-save tests.
- `tests/devtools.test.mjs` — copies the new required shared server module into the isolated no-devtools fixture.
- `tests/server.test.mjs` — expects a null patch after generated block mining and asserts immediate inventory reward/no world drop.
- `docs/TERRA_CHUNK_TERRAIN_QA_REPORT.md` — this report.

Other already-dirty files at task start were retained: `devtools/time-control.js`, `index.html`, `src/item-logistics.mjs`, `tests/item-logistics.test.mjs`, `tests/ux-regression.test.mjs`, plus pre-existing evidence under `android-vd-host/evidence/`. `server.mjs`, `src/game.js`, `tests/devtools.test.mjs`, and `tests/server.test.mjs` also had pre-existing diffs; this task added the terrain integration described above without discarding those earlier changes.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Determinism, multiple seeds, negative coordinates, chunk border continuity, layers, safe plateau, edit overlays, bounded cache | PASS | `tests/chunk-world.test.mjs` |
| Radius-4 window size/order and movement add/remove set; stale generation/unloaded job guard | PASS | `tests/chunk-world.test.mjs` |
| Seed/anchor saved immediately and restored after server restart | PASS | `tests/chunk-server.test.mjs` |
| Generated block placement/mining across negative chunk boundary, restart persistence, null air patch | PASS | `tests/chunk-server.test.mjs` |
| Generated underground collision | PASS | `tests/chunk-server.test.mjs` |
| Generated terrain till/plant/water, revision/inventory, duplicate plant prevention, restart persistence | PASS | `tests/chunk-server.test.mjs` |
| Legacy schema-1 save without generation metadata | PASS | `tests/chunk-server.test.mjs`, `tests/server.test.mjs` |
| Existing and new automated suite | PASS — 73 tests, 73 passed, 0 failed | `npm test` |
| JavaScript syntax checks | PASS | `node --check server.mjs`, `node --check src/game.js`, `node --check src/chunk-world.mjs` |
| Whitespace/conflict-marker check | PASS | `git diff --check` |
| Actual browser/WebGL rendering and GPU resource disposal | NOT RUN | No Chromium/Chrome/Firefox executable or Playwright/Puppeteer package was available in this Termux environment. Static source and Node integration tests do not establish visual correctness or FPS. |
| Physical Android tablet / virtual display | NOT RUN | Excluded by the user's instruction for this run. |
| Ship/lander model clearance | NOT IMPLEMENTED / NOT VERIFIED | No spacecraft/lander model exists in the active client, so only the coordinate anchor and flat starter surface were added/checked; no ship geometry or clearance is claimed. |

## Failure and repair record

The first full suite run after integration had 2 failures among 70 tests:

1. The isolated no-devtools fixture copied `server.mjs` but not the new `src/chunk-world.mjs` dependency. The fixture now copies the shared module.
2. A pre-existing server test expected mining to delete an edit key. In a generated world the correct persistent operation is a `null` patch, which masks the original generated block after reload. The assertion now verifies that behavior.

The focused server/client terrain tests passed after those fixes, then the final full suite passed 73/73. The additional agriculture integration test and stream-planning/stale-job tests were included in that final run.

## Performance measurement and limits

- Node v26.13.1 generated the 81-chunk radius-4 height-column set (20,736 columns) in 35.08 ms in a one-shot local measurement; process RSS was 49 MB and heap used 6.4 MB at the sample. This measures shared terrain column generation and cache use only.
- No browser Three.js meshing time, GPU memory, draw calls, mobile frame time, or FPS was measured. The client reports chunk build duration, GPU geometry/draw counts, and RAF interval EMA at runtime, but without a browser they remain unverified; RAF interval is not CPU render time or FPS.
- Chunk mesh construction is synchronous for one chunk. The queue checks a roughly 3 ms frame budget between builds, but one individual chunk build can exceed it. This is a known responsiveness risk requiring browser/tablet measurement and, if observed, sliced or worker-based meshing.

## Isolation and repository state

- All new server tests use temporary save directories and localhost ports. No normal user save JSON was read for mutation or reset.
- Existing unrelated dirty changes were not reverted. No commit was made because the worktree contains overlapping prior user changes.
- GitHub Actions, remote operations, deployment, and device input were not used.
