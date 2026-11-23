# TERRA facility redesign — Android recovery diagnostics

## Scope and result

This report records device connectivity, Android/thermal state, ECLIPSE host installation, and virtual-display ownership only. It is not a TERRA gameplay or performance pass. No TERRA Activity was launched, no touch input was sent, no screenshot was captured, and no sustained workload was run. Physical Display 0 received no input or capture.

Run date: 2026-11-16 (Asia/Seoul). The current ADB endpoint was rechecked as `172.20.6.114:46213` and was online as an SM-X820. No remembered wireless port was reused.

## Device and host

- Model: Samsung SM-X820 (`gts10pwifixx`).
- Android release/API: 16 / 36.
- Build: `X820XXSBDZI2`; security patch `2026-09-05`.
- Installed ECLIPSE host: `dev.eclipse.vdisplay`, version `0.1`, target SDK 35, app ID/UID 10303. The package and APK path/hash are recorded in the evidence directory.
- The documented ECLIPSE `scripts/termux-vd.sh` / `vd.py` lifecycle workflow is installed. Its pre-start status correctly refused to treat a stopped display as usable.

## Display check

Before startup, the live display list contained only internal Display 0; VirtualDisplay 16 was absent. Using the installed ECLIPSE controller with the explicitly selected ADB serial created a fresh display. Android assigned **Display 19**. Before any TERRA launch, the live list and dumpsys confirmed:

- Type `VIRTUAL`, owner `dev.eclipse.vdisplay` (UID 10303), unique ID `virtual:dev.eclipse.vdisplay,10303,ECLIPSE-Offscreen,9`.
- 1280×720, 60 Hz, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`.
- `mWindowManagerMirroring=false`.
- Display 0 remained a separate internal display.

The device thermal stop threshold was then reached, so the ECLIPSE controller removed Display 19. Post-stop checks show only Display 0 and no active TERRA Activity. No TERRA browser or game process was started. Display 0 was inspected as state only; it was never targeted by input or capture.

## Thermal observations and stop

The first thermal read, before VirtualDisplay creation, reported **Thermal Status 1**, cached SKIN 40.0°C (HAL-current 40.1°C), AP 52.6°C, battery 30.9°C, and USB 31.0°C. This was already warm.

Immediately after the brief display lifecycle check, `dumpsys thermalservice` reported **Thermal Status 2** and HAL-current SKIN 42.2°C (cached 42.0°C), AP 51.7°C, battery 30.9°C, and USB 30.9°C. This met the stop criterion. The ECLIPSE display was stopped immediately; no additional workload was performed. Subsequent reads while stopped showed Thermal Status 2, with HAL-current SKIN readings of 41.6°C and then 40.5°C (cached sensor 42.0°C), AP 47.3°C then 47.7°C. These are separate sensor snapshots, not a performance trend. The tablet should cool until the thermal status and skin reading are safely below the stop thresholds before any game or frame-rate test is considered.

## Evidence

Raw device and display diagnostics are under [`android-vd-host/evidence/facility-recovery-20261116/`](../android-vd-host/evidence/facility-recovery-20261116/). Key files:

- `connection.txt`, `getprop.txt`, `package-dev.eclipse.vdisplay.txt`, `package-path.txt`, `host-apk-sha256.txt`
- `cmd-display-get-displays.txt`, `dumpsys-display.txt`, `dumpsys-window-displays.txt`, `dumpsys-activity-activities.txt`
- `dumpsys-thermalservice.txt` (at display creation), `dumpsys-thermalservice-after-stop.txt`, `dumpsys-thermalservice-current.txt`
- `cmd-display-after-stop.txt`, `cmd-display-current.txt`, `dumpsys-activity-after-stop.txt`
- `services-dev.eclipse.vdisplay.txt` and the controller's `commands.jsonl`

## QA disposition

- Device connectivity: **PASS** (explicit current serial).
- Android version and ECLIPSE host installation: **PASS**.
- ECLIPSE-owned nonzero display: **PASS**, verified as Display 19 before teardown.
- Display 0 input/capture isolation: **PASS** (no input or capture occurred).
- TERRA visuals, facilities, gameplay, 30/60 FPS, frame time, render calls/triangles, memory, and sustained thermal behavior: **BLOCKED / NOT RUN**. Current thermal Status 2 prevents a safe performance run.
- Display cleanup: **PASS**; Display 19 was removed and the live list contains only Display 0.

No source files or prior evidence were changed. No commit was created. Do not interpret the short display create/remove cycle as a graphics benchmark or as proof that it caused the temperature readings.

## Latest coordinated status

The latest read-only check by the main agent supersedes the interim active-display report: only internal Display 0 is present; Display 19 is absent; no TERRA Activity is active; and no ADB reverse mapping remains. The earlier evidence still records that this agent verified ECLIPSE-owned Display 19 (1280×720, own-content-only, `removeMode 1`, mirroring disabled) before removing it. Teardown status is **PASS**.

Latest reported thermal sample: **Thermal Status 2**, HAL-current SKIN 40.1°C (cached SKIN 42.0°C), AP 45.0°C. The thermal stop condition remains in effect; facility/game QA and performance testing remain **BLOCKED / NOT RUN**. No further device or display commands were run after the main agent's read-only check.

## Automated verification

- `node --check server.mjs src/game.js src/chunk-world.mjs tests/chunk-world.test.mjs tests/facility-redesign-qa.test.mjs tests/farming.test.mjs tests/ux-regression.test.mjs` (run in a loop): **PASS**.
- `node --test tests/fluid-gate.test.mjs`: **PASS, 25/25**.
- `node --test tests/facility-redesign-qa.test.mjs tests/workstation-visuals.test.mjs tests/industrial-visuals.test.mjs tests/workstations.test.mjs tests/ux-regression.test.mjs`: **PASS, 25/25**.
- `git diff --check`: **PASS**.
- Authoritative `npm test`: **PASS, 188/188 tests**. Log: [`android-vd-host/evidence/recovery-20261116-184406/npm-test-authoritative.log`](../android-vd-host/evidence/recovery-20261116-184406/npm-test-authoritative.log).
- Android facility visuals, interaction, FPS, and sustained thermal QA remain **BLOCKED / NOT RUN** because the latest thermal status is 2. Automated test success does not establish device QA.
- These commands and results were supplied by the main agent; no tests or device commands were run by this agent.
