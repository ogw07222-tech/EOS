# Developer coordinate teleport — QA report

Date: 2026-11-15 (Asia/Seoul)

## Scope and repository

- Repository: `/data/data/com.termux/files/home/EOS`
- Branch: `prototype/unified-water-gate`
- Starting commit: `a3d31b460b794794789687327f30454f583d3591`
- The branch was clean except for two pre-existing untracked `android-vd-host/evidence/` directories. They were not modified or staged. Other existing worktrees were inspected and left untouched.
- GitHub `ogw07222-tech/EOS` `main` was read for `server.mjs`, `devtools/index.mjs`, `devtools/time-control.js`, and `devtools/README.md`. Its existing optional devtools import, local-address gate, panel loader, and folder-removal contract match the active local tree. No GitHub write, Actions run, merge, or push was performed.

## Subagent work

Three subagents were used, in the assigned disjoint scopes:

- Agent A: server/API and authority — `server.mjs`, `devtools/index.mjs`, `devtools/teleport-server.mjs`. Agent A sent the API contract before Agent C wrote tests.
- Agent B: existing developer UI — `devtools/time-control.js`, `devtools/dev-panel.css`. The time-rate controls remain in the same panel.
- Agent C: test-only changes — `tests/devtools.test.mjs`.
- Main agent: integrated successful teleport snapshots into `src/game.js`, guarded against stale movement/poll responses, updated `devtools/README.md`, ran integration/device verification, and wrote this report.

## Implementation

- `POST /api/dev/teleport` accepts finite numeric X/Z and either direct finite Y or `autoY: true`. Server bounds match generated and legacy world limits. Auto-Y checks player collision, support, and world bounds with a maximum vertical search of eight blocks.
- `POST /api/dev/teleport/return` restores the origin saved before the latest successful teleport. The origin is one-shot and clears only after the return save succeeds.
- Both APIs are registered only when `NODE_ENV=development`, the `devtools/` folder is present, and the request is loopback. They share the session write queue, persist through the existing world save, reset velocity and mining/harvest actions, and roll position back if saving fails. `/api/move` remains displacement-only and cannot set Y or absolute coordinates.
- The existing developer panel now provides X/Y/Z fields, safe auto-Y, move/return, current coordinate display and copy, server-reported biome, mobile layout, and errors. The client updates the live player and requests the target chunk window after a successful server response.
- In this game revision the world has no liquid-cell/ocean/river implementation. The server reports `waterSafety: "not-modeled"`; the panel disables the underwater QA toggle instead of claiming water safety. Generated biome reporting is limited to existing `plains` and `forest` IDs.

## Verification

| Check | Result |
| --- | --- |
| `node --check` on changed JavaScript files | PASS |
| `node --test tests/devtools.test.mjs` | PASS — 13 tests |
| `node --test tests/fluid-gate.test.mjs` | PASS — 25 tests, including 10,000-event determinism/invariant run |
| `npm test` | PASS — 145 tests, 0 failed/skipped |
| `git diff --check` | PASS |
| Production and `devtools/`-removed gates | PASS in `tests/devtools.test.mjs`: time/teleport routes and UI assets return 404; world omits `devtoolsEnabled`; ordinary server boots |
| Non-loopback access when bound to `0.0.0.0` | PASS: anonymous and cookie-bearing requests to time/teleport routes and dev assets return 404 |
| Teleport cases | PASS: direct Y, automatic Y, negative coordinates, X/Z chunk seams, invalid/out-of-range values, solid overlap (even with `allowWater`), previous-location return, persistence across server restart, and save-failure rollback |
| Ordinary movement bypass | PASS: `/api/move` treats X/Z as velocity and ignores submitted Y/absolute coordinates |
| Android 16 ECLIPSE virtual display | PASS for UI smoke: see below |

The test author first found two overly strict assertions (error wording and internal `vy`/`lastAt` fields); the assertions were corrected to match the public contract without reducing coverage. A server smoke probe also initially mistook empty surface Y=0 for a solid block; the probe was corrected to use an actual solid interior coordinate, then passed.

## Android virtual-display smoke

- Device: Samsung SM-X820, Android 16. Authorized ADB transport: `127.0.0.1:45027`.
- Display 16 was confirmed as 1280×720 `VIRTUAL`, owner `dev.eclipse.vdisplay` UID 10303, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`, `mWindowManagerMirroring=false`, and `mDisplayIdToMirror=0`. The TERRA Activity was confirmed on Display 16 and absent from Display 0 before test input.
- The existing `dev.terra.vdtest/.BrowserActivity` loaded the local development server and reported `webgl:true` with a 1280×720 canvas. The dev panel rendered on mobile. Touches were explicitly sent with `adb shell input -d 16`.
- UI test: entered X/Z `(16.5, 16.5)`, used auto-Y, moved to server-saved `(16.5, -1, 16.5)`, saw `forest`, then used the previous-position button. Server save returned to `(0.5, 0, 0.5)` and the UI disabled the one-shot return button.
- Screenshots came only from the ECLIPSE HostService-owned snapshot Surface. No Display 0 input or capture was used. Evidence: `prototypes/devtools-teleport-evidence-2026-11-15/`.
- Android logged `Too many active WebGL contexts` while old hidden TERRA test tasks existed on Display 16. The active test page still reported WebGL true, rendered before/after screenshots, and completed the teleport/return. ADB reverse could not bind because port 38173 was already in use; same-device `127.0.0.1:38173` loaded successfully without a reverse mapping.

## Remaining unverified items

- Water-in-volume teleport cannot be verified until liquid volumes are represented in the game. The QA option is disabled and the API reports `not-modeled`.
- This build has no `river`, `beach`, or `ocean` biome IDs to search or display; only `plains` and `forest` exist.
- The device smoke crossed to a nearby chunk and returned. A very long-distance Android teleport, memory observation, and rapid repeated far-chunk cancellation were not run on device. Existing chunk-stream generation invalidation remains in place; a dedicated teleport stress test may be added if needed.
- No test simulated a mid-request network disconnect on Android. Server persistence failure rollback is covered by integration test.

## Delivery

- Modified implementation files: `server.mjs`, `src/game.js`, `devtools/index.mjs`, `devtools/teleport-server.mjs`, `devtools/time-control.js`, `devtools/dev-panel.css`, `devtools/README.md`.
- Test file: `tests/devtools.test.mjs`.
- QA report: `TELEPORT_QA_REPORT.md`.
- Final verification ran after all implementation, test, and documentation changes; local commit SHA is recorded in the final handoff.
- GitHub main remains unchanged; no remote push or GitHub Actions run occurred.
