# TERRA / EOS — server-authoritative voxel survival prototype

EOS is a browser based, single-player voxel survival and factory game. A Node.js server owns the world state, validates actions, and saves each guest island as JSON. The Three.js client renders the terrain, tools, resources, crops, machines, inventory, and eight-slot quickbar.

## Current game features

- Third-person movement, jumping, camera orbit and zoom, touch joystick, and tablet controls.
- Seeded chunk terrain, resource veins, trees, farming, crafting, a farmer shop, and a protected shop hub.
- Server-validated mining and harvesting, block edits, machine placement, explicit item pickup, and persistent saves.
- Shared low-poly 3D item models for held tools, world drops, and cached transparent quickbar thumbnails.
- Legacy schema-1 guest saves are normalized during load, including old tool lists, resource aliases, node stocks, and sand edits.
- Drill output and conveyor logistics are saved world items; pickup requires explicit player interaction.

See [`docs/GAME_DESIGN_AND_ROADMAP.md`](docs/GAME_DESIGN_AND_ROADMAP.md) for the feature direction and [`docs/SERVER_ARCHITECTURE.md`](docs/SERVER_ARCHITECTURE.md) for persistence and API boundaries.

## Run locally

Requires Node.js 22+ and internet access for the Three.js CDN.

```sh
export TERRA_SESSION_SECRET="$(openssl rand -hex 32)"
npm start
```

Open http://localhost:3000. The server binds to 127.0.0.1 by default; set `HOST` to expose it on a private LAN during development.

## Verify

```sh
npm test
```

The test suite exercises server behavior over HTTP, persistence and migration, mining, farming, crafting, item logistics, world generation, client controls, and UI structure. GitHub Actions are not run as part of local development.
