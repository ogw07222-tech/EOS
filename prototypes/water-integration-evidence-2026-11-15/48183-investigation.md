# User-reported 48183 world investigation

Date: 2026-11-15 (Asia/Seoul)
Requested endpoint: `http://127.0.0.1:48183/api/world`

## Live process/API status

- `ss -ltnp | rg ':48183\b'`: no listening process.
- `ps -ef | rg 'node|48183|server\.mjs'`: no Node game server process.
- `curl -i --max-time 3 http://127.0.0.1:48183/api/world`: connection refused.
- `adb reverse --list`: empty.
- Therefore there is no live process from which to determine the source path or retrieve the existing session's `/api/world` fields. No unauthenticated GET was sent because it could create a new session/save and would not identify the reported world.

## Device status

- ADB device is connected: SM-X820 Android 16 at `127.0.0.1:45027`.
- Live display list contains Display 0 only; ECLIPSE virtual Display 16 is absent.
- No TERRA BrowserActivity appears in the current activity list.
- No device input, capture, app launch, host/service change, or save access was performed.

## Source-level path clue (not a conclusion about the reported save)

- `server.mjs` creates new worlds with `islandSize: 10` as legacy metadata and `worldGenVersion: WORLD_GEN_VERSION`.
- `src/game.js` selects streamed terrain only when `world.worldGenVersion` is truthy; otherwise it renders a finite island using `world.islandSize`.
- `index.html` starts with the fallback text `10×10 시작 섬`; the legacy renderer sets `10×10 섬 · 블록 N`.
- Thus that label indicates the current client took the legacy path or retained the initial UI before a successful world load. It does not by itself prove a v2 chunk-generation failure. The requested API fields are required to distinguish those causes, but the server is offline here.

## Read-only local save metadata check

The default `EOS/data/worlds/` directory contains one candidate with `worldVersion: 3`, `islandSize: 10`, no `worldGenVersion`, no `worldSeed`, `player: {x:0.5,y:0,z:0.5,grounded:true}`, no edits, and a personal-island location. This is consistent with the legacy renderer and the 10×10×3 = 300 block label. Since port 48183 is offline and no session cookie/source process is available, this file cannot be attributed to the reported screenshot. It was only read for metadata and was not changed.

To verify the API behavior without touching that save, I copied this candidate to a disposable temp save directory and queried the current local branch's server with a test-only session secret. `/api/world` returned HTTP 200 with `worldGenVersion:null`, `worldSeed:null`, `islandSize:10`, `worldKind:"personal"`, and the centered player shown above. The SHA-256 of the original file before and after the cloned request was identical (`3605d889f52c8ed05af8aef41295375e5150125feeda969b2021b714365467b9`); the temp clone was removed afterward.

Legacy movement permits leaving the finite island footprint; gravity then drops the player and the server respawns below Y=-13. A screenshot during that fall could show the avatar beyond the edge. This is a legacy fall path hypothesis, not a verified cause for the current report.

No save was reset or modified. Only the listed metadata from the local candidate save was read.
