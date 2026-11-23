# TERRA world v3 and orbital commons status

Status: implementation in progress; static source review only. Browser, Android, and automated tests have not been run for this update.

## World generation

- New worlds use generation version 3. Version 1 and 2 surface samples remain addressable with their original deterministic formulas; existing generated saves are not silently regenerated.
- New v3 worlds use the ordinary seeded plains surface at the origin; they have no flattened starter pad. The existing multi-scale v3 terrain field remains in place, with gentler relief in plains and stronger relief in forests. Coast, river, and ocean biome identities remain compatible with the existing world and water systems.
- The player, starter farm, trees, resource node, and workbench are positioned at their own generated surface heights. The starship portal reports its local terrain height and tilts to follow the nearby ground. The protected plains biome classification around the origin remains unchanged.
- Surface layers, sparse edits, streamed chunk meshes, tree placement, generated water, and server collision use the same seed and absolute coordinates.
- Grass uses less high-frequency speckle, more muted biome colors, and coordinate-varied 4×4 metre mesh patches to soften large repeated carpets while retaining the game's pixel texture style.

## Orbital commons

- The protected hub footprint is 96×64 metres. It has a central arrival/concourse route, four visual market or public-space kiosks, observation windows, structural ribs, a greenhouse display, and a return gate.
- The existing farmer stall remains the only live shop interaction. Other kiosks are scenery until their services are implemented.
- The hub is still instantiated separately for each single-player save. It is a shared-use hub layout, not a multiplayer room or public online server.
- A small starship surrounds the personal-world portal. The portal's reserved construction zone, visible model, and server interaction radius were expanded together.

## Changed files

- `src/chunk-world.mjs`, `src/tree-world.mjs`: v3 terrain plus v1/v2 generation compatibility; removed the special v3 flat-start override.
- `src/terrain-atlas.js`, `src/greedy-chunk-mesh.js`: ground color and repeat breakup improvements.
- `server.mjs`, `src/game.js`: v3 world and fluid compatibility, hub movement bounds, station rendering, starfield, and portal integration.
- `src/hub-world.mjs`: 96×64m station layout and public-space placements.
- `tests/chunk-world.test.mjs`, `tests/chunk-server.test.mjs`, `tests/devtools.test.mjs`, `tests/world-v2-generation.test.mjs`, `tests/hub-world.test.mjs`: update existing generation, surface-placement, and layout expectations; no tests were run.
- `docs/GAME_DESIGN_AND_ROADMAP.md`, `README.md`: current feature status.

## Remaining acceptance work

- Review the terrain at representative seeds and biome transitions for playable slopes, skyline variety, coast blending, and starter-area sightlines.
- Review the starship silhouette and station scale, kiosk approach space, camera clipping, collision, shadows, and WebGL frame time in browser and on Android.
- Connect services to the three scenic kiosks if they are meant to be functional shops or public services.
- Add online shared-hub sessions only if the game scope expands beyond its current single-player server model.
