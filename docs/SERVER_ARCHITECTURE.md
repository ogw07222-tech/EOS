# TERRA EOS: Single-player server prototype

## What is implemented
- Node.js HTTP server serves the Three.js client.
- Guest sessions are keyed with a random 128-bit ID and SHA-256 HMAC cookie, `HttpOnly`, `SameSite=Lax`.
- Each guest has a separate JSON file in `data/worlds`. The server accepts block edits only at valid coordinates and rejects non-adjacent placement, negative inventory, and stale revisions.
- Writes serialize per guest, save to a temporary file, then atomically rename.
- Client shows a flat 16×16×3 dirt island, a 1.78m player, and resource nodes (trees, stone, iron).
- Keyboard and touch movement, third-person camera, jump, fall respawn, visible face-only voxel meshing.
- The active client has eight quick slots, an inventory panel, tool-specific harvesting, block placement when holding dirt/sand, an on-target mining gauge, pickup notifications, and subtle walk animation.
- Server validates tool type for harvesting: pickaxe for stone/iron, axe for trees, shovel for dirt/sand, with inventory/node stock saved in each guest world.

## Limits
This is **not** a production online service. No permanent user accounts, password login, account recovery, billing, database, or cloud deployment are provided.
- Guest identity depends on the browser cookie. Clearing cookies can orphan saved worlds.
- Player movement and edit reach are simulated by the client, **not server-authoritative**; suitable only for a noncompetitive functional prototype. Implement authenticated/server-validated movement and placement before a public economy/game launch.
- Data saves use local JSON files; production should use a database and backups.
- Trees, stone and iron nodes are harvestable, but **currently fixed and finite**. There is **no placement/moving, regeneration, or factory loop** yet.
- **The agreed unified game clock is not implemented:** target is 1 real minute = 12 in-game minutes; all timed systems use game time; world progression stops while the player is offline, without catch-up. This needs server-authoritative active sessions and heartbeat/lease control.
- For complete confirmed gameplay rules, postponed features and their order, see [GAME_DESIGN_AND_ROADMAP.md](GAME_DESIGN_AND_ROADMAP.md).
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
