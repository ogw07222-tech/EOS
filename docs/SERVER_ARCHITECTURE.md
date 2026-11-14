# TERRA EOS: Single-player server prototype

## What is implemented
- Node.js HTTP server serves the Three.js client.
- Guest sessions are keyed with a random 128-bit ID and SHA-256 HMAC cookie, `HttpOnly`, `SameSite=Lax`.
- Each guest has a separate JSON file in `data/worlds`. The server accepts block edits only at valid coordinates and rejects non-adjacent placement, negative inventory, and stale revisions.
- Writes serialize per guest, save to a temporary file, then atomically rename.
- Mining start and cancellation are sent to the server; the server records the session and rejects mine actions completed before 1.2 seconds.
- The client sends directional movement and jump input to `/api/move`; the server simulates movement, gravity, collision, and fall recovery and returns the authoritative player position.
- Block action reach is checked against the server's player position.
- Player position is stored in the guest world save and checkpointed about every five seconds; older saves without a position start at the island spawn.
- Tree harvesting, material costs, blueprint unlocks, proximity to crafting stations, crafted machine inventory, and machine placement are validated and saved by the server.
- New version-2 guest worlds are generated as flat 10×10×3 islands with one tree, five harvestable wheat plants, one regenerating stone vein, and one T1 bench. The three wooden starter tools are available in the eight-slot quickbar; server actions enforce the matching axe, pickaxe, or shovel.
- The client renders world dimensions and resource nodes from the server save. Saves without a version retain the 16×16 legacy terrain and existing objects; migration fills missing fields without replacing existing progress.
- Keyboard and touch movement, third-person camera, jump, fall respawn, visible face-only voxel meshing, and place/mine buttons.

## Limits
This is **not** a production online service. No permanent user accounts, password login, account recovery, billing, database, or cloud deployment are provided.
- Guest identity depends on the browser cookie. Clearing cookies can orphan saved worlds.
- A sudden server stop can lose up to roughly five seconds of movement since the last position checkpoint.
- Machine models and the crafting progression are implemented, but machines do not produce or transport resources yet.
- The server trusts the requested movement direction, while capping its length and applying movement physics itself. Add request rate limits and a durable backend before public deployment.
- Data saves use local JSON files; production should use a database and backups.
- Trees and wheat can be harvested, and the starter stone vein can be mined. Seeds and machine production/automation are not implemented.
- World height and coordinate limits are fixed in the current prototype.
- Three.js is loaded from a CDN, so browsers need internet access.
- For public HTTPS hosting use a reverse proxy with TLS and secure cookie handling. Do not expose a development HTTP server directly to the public Internet.

## Run locally
Use Node.js 22+.
1. Set `TERRA_SESSION_SECRET` to a private random string of 32+ characters.
2. Run `npm start`.
3. Open `http://localhost:3000`.
4. Run `npm test` to validate HTTP behavior and geometry expectations.

No GitHub Actions workflows have been added or executed.
