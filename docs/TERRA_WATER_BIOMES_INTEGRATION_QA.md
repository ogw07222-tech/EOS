# TERRA water and biome integration QA

Date: 2026-11-15 (Asia/Seoul)
Repository: `/data/data/com.termux/files/home/EOS`
Branch: `prototype/unified-water-gate`
Starting commit: `8f3fec72f1882cf42fc8923ebf17a264fa933ace`

## Result

Code and automated server/world regression checks pass. Live-session attribution and Android Display 16 visual verification remain blocked because the reported `127.0.0.1:48183` listener and ECLIPSE Display 16 were absent. No existing world was reset or modified. No GitHub Actions or remote push was used.

## 48183 investigation and legacy-save distinction

At investigation time, `ss` found no listener on port 48183, no Node game server process was running, `curl http://127.0.0.1:48183/api/world` returned connection refused, and `adb reverse --list` was empty. Therefore the actual process, its source checkout, and the requested live API fields (`worldGenVersion`, `worldSeed`, `islandSize`, `worldKind`, `player`) could not be read. The source checkout used for this work is the repository and branch listed above; it cannot be proven to be the source of that absent process.

A read-only inspection found a candidate default save with `islandSize: 10`, no generation version or seed, personal-world kind, and a centered player. A disposable copy served by this branch returned HTTP 200 with `worldGenVersion: null`, `worldSeed: null`, `islandSize: 10`, `worldKind: "personal"`, and player `{x:0.5,y:0,z:0.5,grounded:true,vy:0,lastAt:...,immersed:false,swimming:false}`. The original file's SHA-256 was identical before and after (`3605d889f52c8ed05af8aef41295375e5150125feeda969b2021b714365467b9`); only the disposable copy was removed.

That candidate is consistent with the screenshot's `10×10 섬 · 블록 300` label (`10×10×3`) and legacy renderer, but cannot be attributed to the screenshot or port 48183. The label can also be the initial fallback UI before a world load. The client chooses streamed chunks only when `worldGenVersion` is present; versionless saves intentionally keep legacy island rendering. Legacy movement can walk past the finite island and fall before the server respawns below Y=-13, which is a plausible source of an out-of-island avatar image, not a verified explanation of this screenshot.

Evidence: `prototypes/water-integration-evidence-2026-11-15/48183-investigation.md`.

## Implementation and automated validation

Fresh worlds now use generation version 2 with five deterministic biomes (plains, forest, beach, ocean, river), continuous chunk terrain, generated ocean/river water, sparse saved fluid edits, player immersion/swimming state, water-safe developer teleport, and dev-only biome/tick-rate controls. Existing versionless and version 1 saves retain their prior generation behavior and data. V2 data rejects fluid cells outside world bounds. The client batches water surfaces per chunk and disposes chunk geometry on unload.

- `node --check` on changed JavaScript files: **PASS**.
- Focused chunk and resource server tests: **14/14 PASS**.
- Focused devtools, tree, and v2-world tests: **36/36 PASS**.
- `npm test`: **163/163 PASS**, 0 failed, 0 skipped.
- `git diff --check`: **PASS**.
- Determinism / conservation: 100 seeds × 100 fluid events, **PASS**.
- New-world generation: all five biomes and signed X/Z/diagonal chunk seams, **PASS**.
- 81-chunk ocean model: 132,756 generated full-water cells, 0 persisted cells, 0 active cells; query 356 ms in the full-suite sample. This is pure server/world generation timing and excludes browser rendering/GPU cost.
- Chunk streaming plan: radius 4 creates 81 chunks, **PASS**. Cross-boundary generation and developer teleport across positive/negative chunk seams, **PASS**.
- Long-distance teleport between river/ocean and return, safe surface landing, underwater rejection, **PASS**.
- Ocean/river rendering data and geometry implementation are covered by source/data tests, but no live browser/WebGL visual run was possible. Thus a runtime rendering failure is not device-verified.
- Collision/physics: generated underground solid collision, water not treated as solid, immersion/swimming and placement denial, fluid world-boundary and falling-flow checks, **PASS** in automated tests. Legacy falling off the island remains legacy behavior.
- Production mode hides the dev APIs; deleting `devtools/` leaves the base game bootable, **PASS**.

The tests distinguish generation/chunk seams, server collision/fluid behavior, and source-level rendering data. They do not replace on-device visual inspection for a GPU renderer failure.

## Android virtual display

ADB still sees SM-X820 Android 16, but `dumpsys display` shows Display 0 only; Display 16 is absent. No TERRA browser activity is present and no reverse port is configured. Per the constraint not to touch Display 0 or ECLIPSE app/data/services, no app was launched and no device input, screenshot capture, or host/service change was made. Android Display 16 QA is **BLOCKED** until that display is restored outside this run.

## Changed files

- `server.mjs`
- `src/chunk-world.mjs`
- `src/tree-world.mjs`
- `src/game.js`
- `devtools/teleport-server.mjs`
- `devtools/time-control.js`
- `devtools/dev-panel.css`
- `tests/chunk-world.test.mjs`
- `tests/devtools.test.mjs`
- `tests/resource-expansion-server.test.mjs`
- `tests/world-v2-generation.test.mjs` (new)

No pre-existing untracked evidence was removed or staged. No saved world was reset. No remote push or GitHub Actions run occurred.

## Follow-up on an alternate local port

After the initial report, a fresh development server was started on `127.0.0.1:48184` with a separate temporary save directory. `/api/world` returned `worldGenVersion: 2`, `worldSeed: 4044982795`, `islandSize: 10`, `worldKind: "personal"`, and a centered player at `{x:0.5,y:0,z:0.5,grounded:true,immersed:false,swimming:false}`. This confirms that `islandSize: 10` remains metadata on the new chunk world and does not force legacy rendering when `worldGenVersion: 2` is present. `/api/dev/biomes` returned plains, forest, beach, ocean, and river coordinates.

The QA server process was stopped after the requests. Its isolated disposable save files remain under `/data/data/com.termux/files/usr/tmp/terra-port-qa.w9JW7U`; the existing `EOS/data/worlds` was not used or changed. The original absent 48183 session remains unverified.
