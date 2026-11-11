# TERRA | Prototype specification

## Implemented
- Three.js WebGL renderer (depth buffer, lit meshes, shadows).
- 1×1×1 stone-and-mineral ore node, low-poly rotary drill with helix.
- Four conveyor tiles in this order: straight, up +1 tile, right-turn 90° inside 1×1, straight on upper level.
- Belt direction indicated by one arrow per tile; turn arrow is curved.
- Discrete ore cubes animate along a continuous 3D transport path.
- Manual pickup from visible transported cubes; auto-pickup proximity is intentionally absent.
- Touch/mouse orbit, pinch/wheel zoom, pause, speed, visibility toggle.

## Non-goals / pending
- No inventory persistence, energy simulation, ore recovery rates, ore extraction rules or collision physics yet.
- Ore movement is a scripted path prototype, not an adjacency-based general conveyor graph.
- Movement of an ore cube from the drill happens on a repeating schedule; actual resource subtraction/production is pending.
- Actual Android device tests still required.
- Three.js imports from CDN and requires internet.

## Tile placement convention
- X: initial flow direction; +Z: turn exit direction.
- Floor coordinate y=0; lower conveyor top y≈0.29 and upper conveyor top y≈1.29.
- Cells: (-1,0,0) straight; (0,0,0) ramp; (1,1,0) turn; (1,1,1) final straight.
- The curved turn is confined to a single 1×1 tile.

## Quality gate
Run `node --test tests/layout.test.mjs` and manually test the browser using an HTTP server. Do not claim Android browser verification without using an Android device.
