# TERRA / EOS — First playable server prototype

An **individual sky-island game hosted by a central Node.js server**. Multiplayer and player-hosted dedicated servers are deliberately out of scope.

## Implemented (v0.1 prototype)

- The previous orbital camera-only viewer has become a **third-person game**.
- Flat 16×16 starting island, three layers of dirt, green grass surface, two decorative block trees; no underground mines or stone layer.
- **Metric scale:** 1 terrain block = **1 metre** (1×1×1 m); the player is **1.78 m tall** and approximately **0.68 m wide with arms down**, using the same metre-based coordinate system. The Three.js worldRoot uses a shared 3.75× rendering conversion for both terrain and avatar, so visual proportions match the physical units. Existing 16×16 island save coordinates remain unchanged.
- Keyboard: **WASD / arrows** to move, **Space** to jump; mouse drag to orbit, wheel to zoom.
- Tablet/mobile: virtual joystick, jump button, drag camera, pinch zoom.
- **Hotbar/inventory:** equip **pickaxe** for stone/iron ore nodes, **shovel** for dirt/sand blocks, **axe** for tree/wood nodes. Select dirt or sand in the hotbar to place blocks. Keyboard slots **1–5**; mobile hotbar taps.
- **Mining:** press and hold a valid target for 1.2 seconds. Releasing early or dragging cancels progress. Incorrect tools cannot harvest the target.
- Starter stone, iron and wood nodes are backed by server-stored quantities; sand placement and harvesting persist in inventory.
- Dirt inventory is checked and updated on the server; your changes persist on the server between sessions when the same browser keeps its guest cookie.
- Players get isolated **guest island saves**, not shared multiplayer worlds.
- Existing drill + conveyor proof of concept is archived at [`prototypes/mining-conveyor.html`](prototypes/mining-conveyor.html).

## Run the game

Requires **Node.js 22+** and internet access for the Three.js CDN.

```bash
git clone https://github.com/ogw07222-tech/EOS.git
cd EOS
export TERRA_SESSION_SECRET="$(openssl rand -hex 32)"
npm start
```

Open **http://localhost:3000** in your browser.

On Windows PowerShell, set the secret with `$env:TERRA_SESSION_SECRET = "a-long-random-secret-of-at-least-32-chars"` before running `npm start`.

For a mobile device on the same LAN, open `http://YOUR_COMPUTER_LAN_IP:3000` if your local firewall/network permits access. This is intended for private local testing, **not production Internet hosting**.

## Test

```bash
npm test
```

This checks browser entry point and mesh invariants, preserves checks for the archived conveyor prototype, and exercises the server through HTTP including isolated guest worlds, stale write rejection, block transactions, and save/restart.

## Architecture and boundaries

See [`docs/SERVER_ARCHITECTURE.md`](docs/SERVER_ARCHITECTURE.md).

The 1.2-second mining duration is currently enforced by the browser interaction code; the prototype server still accepts direct mine API calls without measuring a mining session. Implement server-side timing validation before public release.

**Not implemented:** permanent accounts/authentication, public production deployment, secure server-side movement verification, cloud database, crafting, ore regeneration, production machinery, portals, combat, and offline factory progression. Guest cookies are not a substitute for a durable account.

Design goals: Islands-style block expansion, renewable placed ore nodes (including stone), deliberately slow production and processing with affordable machine recipes, portal-gated adventure islands, and single-player server persistence.

**No GitHub Actions were triggered or configured.**
