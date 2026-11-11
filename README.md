# TERRA / EOS

A mobile-first 3D sky-island factory automation prototype.

## Current world: starter island

The default `index.html` displays the first TERRA starter sky island:
- Flat 16×16 block grass surface, three blocks thick.
- **Dirt only** beneath grass; no stone strata, caves or mines.
- Pixel-textured grass, grassy dirt edge, and exposed brown dirt sides.
- No interior block faces are rendered; sides and underside are generated as outward-facing WebGL surfaces.
- Two removable-in-view voxel trees, togglable block grid, camera rotation, zoom and top-down view.
- Built with Three.js WebGL, designed for mouse and tablet touch input.

Launch using a local HTTP server, e.g. `python -m http.server 8080`, and open `http://localhost:8080`. The Three.js ES module is loaded from a CDN, so internet access is required.

## Earlier mining logistics prototype

The preserved drill, ore and conveyor demonstrator is at [`prototypes/mining-conveyor.html`](prototypes/mining-conveyor.html).

## Checks

Run `node --test tests/*.test.mjs` to check structural invariants. These do not replace manual WebGL and mobile device testing.

## Project design principles

- Sky-island expansion by placing blocks.
- All mineable industrial stone/metals come from placed renewable resource nodes, **not underground mining**.
- Deliberately slow ore production/processing, with low construction requirements.
- Optional portal travel to additional adventure/resource islands.
- Hostable dedicated multiplayer servers are a future goal, not yet implemented.

No GitHub Actions workflows have been added or executed.
