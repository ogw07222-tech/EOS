# TERRA open-world virtual display run

Date: 2026-11-15 (Asia/Seoul)
Device: Samsung SM-X820, Android 16
Virtual display: dynamically assigned ID 17 (requested display 16 was not a stable ID)
Display facts before launch: ECLIPSE-Offscreen, 1280×720, owner `dev.eclipse.vdisplay`, `removeMode 1`, `FLAG_OWN_CONTENT_ONLY`, `mWindowManagerMirroring=false`. Display 0 remained the physical 2800×1752 internal display.

## Isolated server and world

- TERRA dev server ran at `127.0.0.1:38173` with a random QA-only session secret and save directory under `$TMPDIR/terra-open-world.YZfwhl/worlds`.
- The existing `EOS/data/worlds` save directory was not used.
- `/api/world`: `worldGenVersion=2`, `worldSeed=3029736183`, `islandSize=10`, `worldKind=personal`; player started at `{x:0.5,y:0,z:0.5,grounded:true,immersed:false,swimming:false}`.
- TERRA WebView Activity reported `CREATE display=17`, then `PAGE_FINISHED display=17` with title `TERRA — My Island`.

## Rendering result

**FAIL: client renderer did not initialize.** The WebView screenshot shows only the background and “나만의 섬을 불러오는 중…” loading message. Its WebGL probe returned `canvases:0`, `width:0`, `height:0`, `webgl:false` on all 20 attempts. The screenshot is `initial-frame.png`; WebView logs are in `webview-errors.txt` and `logcat-after-launch.txt`.

No world geometry appeared, so this run did not validate chunk rendering, ocean/river appearance, movement, chunk boundaries, or collision on device. No touch input was sent. The probe confirms the failure is before any game canvas exists; available logs do not identify the exact cause. The game module imports Three.js from jsDelivr, so an Android WebView module/network load failure is a candidate to investigate, not a confirmed root cause. The TERRA host logged no explicit JavaScript exception.

`adb reverse tcp:38173 tcp:38173` failed with “cannot bind listener: Address already in use” while the TERRA server itself occupied that local port. The WebView still loaded the local index over `127.0.0.1`, but the external Three.js module did not progress to canvas creation. No reverse mapping was listed.

## Teardown

- Force-stopped `dev.terra.vdtest`.
- Stopped the isolated TERRA server; port 38173 no longer listened.
- Ran the ECLIPSE virtual-display stop workflow. Display 17 is absent afterward.
- Display 0 received no input and no capture. ECLIPSE game data and app were not modified.
- Temporary isolated server files remain under `$TMPDIR/terra-open-world.YZfwhl`; no existing world data was changed.
