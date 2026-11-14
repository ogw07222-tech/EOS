# TERRA / EOS — First playable server prototype

An **individual sky-island game hosted by a central Node.js server**. Multiplayer and player-hosted dedicated servers are deliberately out of scope.

## Implemented (v0.1 prototype)

- The previous orbital camera-only viewer has become a **third-person game**.
- New players receive a flat **10×10×3** starting island: one grassy surface layer and two dirt layers, with no cave or stone stratum. Existing 16×16 saves retain their original island dimensions.
- **Metric scale:** 1 terrain block = **1 metre** (1×1×1 m); the player is **1.78 m tall** and approximately **0.68 m wide with arms down**, using the same metre-based coordinate system. The Three.js worldRoot uses a shared 3.75× rendering conversion for both terrain and avatar, so visual proportions match the physical units. Existing 16×16 island save coordinates remain unchanged.
- Keyboard: **WASD / arrows** to move, **Space** to jump; mouse drag to orbit, wheel to zoom.
- Tablet/mobile: virtual joystick, jump button, drag camera, pinch zoom.
- **Place:** tap/click a nearby block face to place dirt. **Mine:** press and hold the target block for 1.2 seconds; a progress bar appears, and releasing early or dragging cancels mining.
- Dirt inventory is checked and updated on the server; your changes persist on the server between sessions when the same browser keeps its guest cookie.
- Player position is saved with the guest island about every five seconds and restored on reconnect.
- New players receive one wooden pickaxe, axe, and shovel in the quickbar. Hold on a stone vein, tree, or dirt block with the matching tool to mine it; five wheat plants can be harvested directly. The server awards resources and saves harvest state. The start island includes one stone vein, one tree, five wheat plants, and a T1 crafting bench.
- The T1 bench enables crafting the first specialist workbench; further blueprints require the relevant placed station. Ore regenerates after depletion. Machines do not automate production.
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

The server simulates player movement, gravity, jumping, collision, and fall recovery from bounded directional inputs. It also checks interaction reach and measures the 1.2-second mining session. The prototype still needs stronger production protections, account recovery, and durable storage before public release.

Craftable machines are currently placeable models; machine input/output and automation are not connected yet.

**Not implemented:** permanent accounts/authentication, public production deployment, cloud database, machine production/automation, seed sourcing through the future shared NPC shop, portals, combat, and offline factory progression. Wheat seeds are not obtainable in the current prototype. Guest cookies are not a substitute for a durable account.

Design goals: Islands-style block expansion, renewable placed ore nodes (including stone), deliberately slow production and processing with affordable machine recipes, portal-gated adventure islands, and single-player server persistence.

**No GitHub Actions were triggered or configured.**
