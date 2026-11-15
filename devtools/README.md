# TERRA developer tools

The tools are loaded only when the server runs with `NODE_ENV=development` and this folder is present. Set `TERRA_SESSION_SECRET` (at least 32 characters) and run locally with `npm run dev`. Production (`NODE_ENV=production`) and the regular `npm start` command do not import the developer module, expose its static files, include its panel flag, or register its API.

The time panel supports 1×, 2×, 5×, 10×, and 50×. The game clock applies the existing 12 game minutes per real minute once, then multiplies it by the selected developer rate. Only world growth and watering duration use game time. Player movement, harvesting hold duration, and mining hold duration keep their real-time rules.

The time API and developer assets are limited to loopback clients and are unavailable in production. The multiplier lives in memory and returns to 1× after a server restart. Player saves contain crop/tree progress and remaining watering game time, not a wall-clock timestamp for developer speed.

## Coordinate teleport

The same developer panel includes server-authoritative coordinate teleport. `POST /api/dev/teleport` accepts finite numeric X/Z and either a finite Y or `autoY: true`. Generated worlds use X/Z `[-4096, 4096)` and Y `[-32, 32]`; legacy worlds use X/Z `[-64, 64)` and Y `[-8, 16]`. Auto-Y searches at most eight vertical blocks from the generated surface for a clear player body with ground support. Solid blocks, trees, machines, unsupported ground, and world bounds are checked server-side.

`POST /api/dev/teleport/return` restores the origin saved by the latest successful teleport, then consumes that one-shot return point. A failed coordinate validation or save leaves the old player position and return point intact. Teleport requests share the per-session queue, persist using the existing world save, clear velocity and active mining/harvesting state, and log the world seed/generation, before/after coordinates, biome, and result without logging cookies or session secrets. The normal `/api/move` remains a velocity-only endpoint.

The current game does not model liquid cells or river/ocean/beach biomes. The panel therefore disables the underwater QA option and reports water detection as `not-modeled`; the server does not mistake the decorative watering trough for a water body. Generated terrain currently reports only its implemented `plains` and `forest` biomes.

All developer APIs, the time panel and the coordinate UI require development mode, this folder, and a loopback client. Binding the normal game server to `0.0.0.0` does not expose developer routes to remote clients.

Release-removal check: temporarily remove or rename `devtools/`, run the regular server, and verify `/api/dev/time`, `/api/dev/teleport`, `/api/dev/teleport/return`, `/devtools/time-control.js`, and `/devtools/dev-panel.css` return 404 while `/api/world` omits `devtoolsEnabled`. The regular game continues at its normal clock rate because the server does not load the optional developer module. Restore this folder after checking.
