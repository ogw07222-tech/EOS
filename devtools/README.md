# TERRA developer tools

The tools are loaded only when the server runs with `NODE_ENV=development` and this folder is present. Set `TERRA_SESSION_SECRET` (at least 32 characters) and run locally with `npm run dev`. Production (`NODE_ENV=production`) and the regular `npm start` command do not import the developer module, expose its static files, include its panel flag, or register its API.

The time panel supports 1×, 2×, 5×, 10×, and 50×. The game clock applies the existing 12 game minutes per real minute once, then multiplies it by the selected developer rate. Only world growth and watering duration use game time. Player movement, harvesting hold duration, and mining hold duration keep their real-time rules.

The time API and developer assets are limited to loopback clients and are unavailable in production. The multiplier lives in memory and returns to 1× after a server restart. Player saves contain crop/tree progress and remaining watering game time, not a wall-clock timestamp for developer speed.

Release-removal check: temporarily remove or rename `devtools/`, run the regular server, and verify `/api/dev/time` and `/devtools/time-control.js` return 404 while `/api/world` omits `devtoolsEnabled`. The regular game continues at 1× because `advanceGrowth` defaults to the base 12× game clock. Restore this folder after checking.
