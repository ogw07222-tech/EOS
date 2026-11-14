# TERRA Agriculture 2nd QA Report — 2026-11-14

## Environment and isolation

- Checkout: `b95122197571635c9018bd8955230d8948f291a5` (`feat: add private shop hub and farmer economy`). The integration commit `857ea5294268ec1ea0b6e41a1629498ce16f052b` exists in local history.
- Wireless ADB: `127.0.0.1:45911`, Samsung SM-X820.
- Display 0 remained the physical 2800×1752 panel. The only test target was VirtualDisplay 16, 1280×720, owner `dev.eclipse.vdisplay`, `removeMode 1`.
- TERRA ran in the separate `dev.terra.vdtest` WebView host, explicitly started on Display 16. Its Window Manager window reported `mDisplayId=16`. Input was sent only with `adb shell input -d 16 ...`; no app was launched and no input was sent on Display 0.
- Server save files, cookie and session secret were in a disposable `$TMPDIR/terra-second-qa` directory and removed after the run. The TERRA host was force-stopped afterward. The existing ECLIPSE host/APK/settings were not changed or stopped.
- Chrome was not launched in this run; this was the documented TERRA WebView host route.

## Browser and display checks

- The WebView loaded `http://127.0.0.1:38173/`, reported one 1280×720 canvas and `webgl:true`.
- The host-owned VirtualDisplay capture visibly rendered the island, HUD, mobile controls and developer panel: [`initial.png`](../android-vd-host/evidence/second-qa/initial.png).
- A later capture after watering showed the planted crop, wet soil and updated inventory: [`final-water.png`](../android-vd-host/evidence/second-qa/final-water.png). The plant reached stage 4 in the on-screen growth capture: [`final-grown.png`](../android-vd-host/evidence/second-qa/final-grown.png).
- After switching to the app’s `채집·채굴` mode, a Display 16 tap harvested the visible stage 4 crop. The host displayed “밀 +1 · 씨앗 +1”; the disposable save recorded revision 5, the crop ID in `harvestedCrops`, wheat 0→1 and seeds 3→4. Final VirtualDisplay capture: [`final-harvested.png`](../android-vd-host/evidence/second-qa/final-harvested.png).
- The host input log records the current-run taps and swipes with display ID 16: [`touches.csv`](../android-vd-host/evidence/second-qa/touches.csv). WebGL probe and live display/window records are also saved in this evidence directory.

## Touch QA outcome

| Action | Result |
| --- | --- |
| Till | Passed. Display 16 tap at `(650,500)` created tile `(0,0,0)` and advanced the saved world revision. |
| Plant | Passed. A second tap on the same tile created a stage 1 crop and consumed one seed. |
| Water | Passed. Selecting the watering can and tapping the tile set a positive water timer and reduced uses from 10 to 9. |
| Growth | Passed. With the documented developer control at 50×, the visible crop reached stage 4. Wet soil rendered with the corrected darker color. |
| Harvest by touch | Passed after using `채집·채굴` mode. Initial taps in `농사` mode did not issue a harvest request; inspection of the client handlers showed that mature-crop harvesting is handled in mining/harvest mode. Switching to that mode and tapping the rendered crop removed it and awarded one wheat and one seed. |

This round completed a full on-device touch loop: till, plant, water, accelerated growth to stage 4 and harvest. Earlier unsuccessful taps were not counted as passes.

## Server and automated QA

- Fixed a client wetness check that compared remaining game milliseconds with epoch time. `isFarmTileWatered()` now recognizes positive remaining duration; the server serves that shared rules module. This is reflected in the WebView water capture above.
- Added save/restart checks for crops at stages 1–4, inventory and water state, guest isolation and no offline growth.
- Added water capacity, empty-can rejection, refill-at-source and non-stacking timer checks.
- Added concurrent planting/harvesting checks: one request succeeds and stale duplicate requests conflict without duplicate rewards.
- Added an isolated 30-loop farming run using the existing test-only development 50× rate and a deterministic process-local virtual clock. Each loop verified planting, active-time growth to stage 4, watering, harvest reward, revisioned save; the 30-loop final state survived a server restart. No 100× rate or production setting was added or changed.
- Existing test coverage also exercised the scythe’s 3×3×3 mature-only behavior, shop purchase/sale validation, stale revision handling, tree-yield boundaries, developer water/growth timing and guest-save isolation.
- `npm test`: **47 passed, 0 failed**. The automated/API suite and the separately observed Display 16 touch harvest both passed.

## Changes and limits

Changed files: `server.mjs`, `src/farming-rules.mjs`, `src/game.js`, `tests/farming.test.mjs`, `tests/server.test.mjs`, and the test-only clock fixture under `tests/fixtures/`.

GitHub Actions were not run. No commit or push was made. No 100× speed or production setting was added or changed.
