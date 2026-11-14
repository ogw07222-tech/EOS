# TERRA Agriculture 3rd Boundary and Regression QA

Date: 2026-11-14

## Baseline and isolation

- Baseline HEAD: `3e24e41` (`test: complete second TERRA agriculture virtual display QA`). This checkout was five commits ahead of `origin/main` and 31 behind it. No rebase, reset, push or GitHub Actions run was performed.
- The separate agriculture stabilization, integration and openfield worktrees had local modifications and were left untouched. Existing stash entries were also left untouched.
- Baseline `npm test`: 47/47 passed.
- Wireless ADB was connected to SM-X820 at `127.0.0.1:45911`. The active ECLIPSE-owned VirtualDisplay was ID 16, 1280×720, `removeMode 1`. TERRA's `BrowserActivity` Window Manager record showed `mDisplayId=16`; no TERRA window was on Display 0. All 12 touch down/up events from this QA trace are tagged display 16. No touch or app launch was sent to Display 0.
- This device run used the TERRA-only WebView host. It did not establish Chrome secondary-display support. Captures came from the existing host's owned Display 16 Surface.
- ECLIPSE APK, source, signing material and settings were not changed. Only the existing host lifecycle was used to make Display 16 available; its service and VirtualDisplay were left running.

## Results

| Area | Result |
| --- | --- |
| Scythe XYZ volume | **Passed in API tests.** Covered all 27 cells at positive and negative/elevated centers, inside immature preservation, and all 98 outside cells; saved/reloaded and replayed without duplicate rewards. |
| Scythe touch | **Passed on Display 16.** A real farm-mode scythe tap harvested two mature fixture crops. A separate empty-range tap showed “No mature crop in range” and left the save revision and rewards unchanged. |
| Water touch | **Passed on Display 16.** A valid tap consumed the fixture's final use (1→0); the subsequent empty-can tap showed the refill instruction. Server save recorded 0 uses and 299,664 ms remaining on the watered tile. |
| Watering API boundaries | **Passed.** The edge/retry run exercised valid/invalid targets, exact depletion, empty-can rejection, refills and cap, plus persistence/restart checks. |
| 50× and 1× clock | **Passed in isolated API tests.** Development-only 50× growth and watering were followed by 1× restoration; the test asserted a 1,200 ms 1× game-time tick, remaining water, movement away/back, save and restart with offline time excluded. Existing 30-loop 50× farming test also passed. No production rate was changed. |
| Shop/reconnect | **Passed in existing API coverage.** Purchase/sale, stale/invalid transaction handling, private hub save and restart persistence passed. |
| Repetition and process health | **Passed.** 114 edge/retry API requests were exercised; 27 crops yielded exactly 27 wheat and 27 seeds. RSS was 52,068→57,384 kB (5,316 kB growth during the run); captured server stderr was empty. No FPS result is claimed. |
| Full regression | **Passed:** `npm test` 51/51; JavaScript syntax checks and `git diff --check` passed. |

## Important limit: chunks

The server persists a guest island as one JSON file. It has no chunk generation, streaming, unloading or reloading implementation. Movement away/back and save/restart were exercised as existing behavior; they do **not** count as chunk lifecycle verification. Chunk lifecycle is **not implemented**, so this report does not claim the full requested chunk QA or overall completion of that scope.

## Evidence

The isolated evidence directory [`android-vd-host/evidence/third-qa`](../android-vd-host/evidence/third-qa/) contains Display 16 WebGL and touch captures, the focused touch trace, host WebGL probe records/logs, and the final disposable-world state. `before.png`, `scythe-success.png`, `scythe-failure.png`, `water-success.png`, and `water-empty.png` are captures from the ECLIPSE host-owned VirtualDisplay surface. All captured QA touch events target ID 16.

No GitHub Actions were run and nothing was pushed. This result covers implemented agriculture behavior and the secondary-display host on the tested SM-X820; it does not cover chunk streaming or Chrome on a secondary display.

Test, fixture and evidence bundle commit: `87cf63c` (`test: add TERRA third agriculture boundary QA`). This report's finalization is a subsequent local documentation commit.
