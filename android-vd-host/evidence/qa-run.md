# TERRA VirtualDisplay QA — 2026-11-14

Device: Samsung SM-X820, Android 16. ADB serial: `127.0.0.1:45911`.

## Display placement and isolation

- ECLIPSE host display: ID 16, 1280×720, owner `dev.eclipse.vdisplay`, `removeMode 1`.
- Samsung Internet was opened with an explicit display-16 request, but its Activity was recorded in the physical display's hidden Samsung `MinimizedDesk` freeform task. Display 16 did not resume it. No touch input was sent to that browser task or Display 0. Chrome is installed but had no current ActivityRecord or Window, so it had no running display ID; it was not launched during QA.
- TERRA's separate `dev.terra.vdtest/.BrowserActivity` logged `CREATE display=16`; Window Manager reported its window `mDisplayId=16`. The Activity checks for a nonzero display before loading the URL and blocks touch delivery if moved to Display 0.
- The WebView loaded `http://127.0.0.1:38173/`, created a 1280×720 canvas, and reported `webgl:true`. The final PNG is a 1280×720 capture from the ECLIPSE host's owned VirtualDisplay surface. It visibly contains the island, TERRA HUD, mobile controls and developer panel.
- One intermediate camera-orbit capture was black while the Activity task was reported `visibleRequested=false`/sleeping even though the virtual display stayed ON. Explicitly bringing the TERRA Activity back on display 16 restored rendered frames; the final screenshot and WebGL probe passed. The temporary frame loss was not reproduced after relaunch, so its lower-level cause remains undetermined. No capture or input fell back to Display 0.
- A tap and camera swipe were sent only with `input -d 16`. The host touch log records the received events with display ID 16. The Display 0 activity section did not contain `dev.terra.vdtest`.

## Farming touch flow

Actions ran in a disposable save directory under `$TMPDIR/terra-vd-qa-20261114/worlds`. Its guest fixture supplied a hoe, watering can, four wheat seeds and mature crops. The regular `data/worlds` directory was not used.

| Action | Touch and observed result |
| --- | --- |
| Till | Tap Farm mode, then ground at `(650,500)`. Server added tilled tile `(0,0,0)`; revision 0→1. |
| Plant | Tap the same tile with the hoe selected. Crop `cab08a1d7612bcf1` appeared at stage 1; seeds 4→3; revision 1→2. |
| Water | Select quick slot 5 (watering can), tap the planted tile. Water uses 10→9; `watered["0,0,0"]` was set; revision reached 4. |
| Grow | The crop reached stage 4 under the normal 1× development rate. |
| Harvest | First taps missed the crop because the crop mesh had grown above the original soil coordinate. After inspecting the VirtualDisplay image, a tap on its visible location succeeded. The mature planted crop was removed and added to `harvestedCrops`; wheat and seeds were awarded. |

One additional mature starter wheat crop was also harvested by tapping its visible stalk. Final server state: revision 6, 2 wheat, 5 seeds, planted crop absent, and `harvestedCrops` includes both `wheat_2` and `cab08a1d7612bcf1`. See `qa-final-state.json`.

## Instrumentation correction

The first host build wrapped the WebGL probe result in a JSON string, so its CSV writer did not recognize `webgl:true`. The probe now returns an object directly. The app was rebuilt, reinstalled as the same TERRA-only package, and relaunched explicitly on display 16. The retest produced `webgl.csv` with `webgl:true`; no ECLIPSE package was rebuilt or reinstalled.

## Evidence

- `terra-final-revalidated.png` — final WebGL VirtualDisplay capture.
- `webgl.csv` — verified canvas and WebGL state.
- `touches.csv` — touch actions received on display 16.
- `window-display.txt` and `display-placement-summary.txt` — window and display placement.
- `android-logcat-terravd-revalidated.txt` — host display and WebGL probe logs.
- `qa-final-state.json` — final isolated guest world.
- `chrome-placement.json` and `samsung-browser-routing.txt` — browser placement findings.

No GitHub Actions ran. No input was sent to display 0. No claim is made that Samsung Internet or Chrome works on a secondary display.
