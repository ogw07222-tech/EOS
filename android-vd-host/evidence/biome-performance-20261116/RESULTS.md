# EOS biome on-device check — 2026-11-16

Device: Samsung SM-X820, Android 16. EOS WebView on ECLIPSE-owned virtual display 31 (1280x720, removeMode 1). All captures are from the ECLIPSE host-owned virtual Surface. Display 0 was not used for input or capture.

Five generated-world biome points were obtained from `/api/dev/biomes`, visited with server-side `autoY` teleport, and confirmed by the server's returned biome. Each screenshot followed a 10-second settle interval; all HUDs showed the 25/25 target chunks loaded. WebGL stayed enabled at 1280x720.

| Biome | Server landing (x, y, z) | Grounded | HUD render FPS | HUD frame p50/p95 | Visual check |
|---|---:|:---:|---:|---:|---|
| Plains | (-303.5, 5, -2047.5) | yes | 67.0 | 16.5/16.7 ms | Grass plateau and nearby water visible |
| Forest | (-175.5, 4, -2047.5) | yes | 62.7 | 16.6/16.8 ms | Forest/tree meshes rendered; initial view occluded by a nearby tree, then camera orbit confirmed clear forest scene in `forest-orbit.png` and `panel.png` |
| Beach | (-335.5, 1, -2047.5) | no | 62.5 | 16.6/16.8 ms | Sandy shore rendered, player appears submerged/in water |
| Ocean | (-2047.5, 1, -2047.5) | no | 56.0 | 16.6/16.8 ms | Open-water terrain rendered, player appears submerged/in water |
| River | (368.5, 1, 32.5) | no | 51.3 | 16.6/16.8 ms | River channel, bank and water rendered; player appears in water |

`autoY` marked water landings as `waterSafety: modeled`; the three water-biome samples return `grounded:false`. This is consistent with the visible water immersion. It is a spawn/locomotion follow-up, not a missing-biome/render failure. FPS is the game's on-screen rolling render metric; p50/p95 are individual render-frame intervals, so brief high FPS readings can coexist with a 16.7 ms tail near the device's 60 Hz virtual display. Skin temperature rose to 39.2°C by teardown (above the 38°C first thermal threshold); I stopped the session promptly.

Evidence: five per-biome PNGs, `teleports.json`, `webgl-display31.csv`, `touches-display31.csv`, `terra-logcat.txt`, and `thermal.txt` in this directory.
