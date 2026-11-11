# TERRA EOS: Single-player server prototype

## What is implemented
- Node.js HTTP server serves the Three.js client.
- Guest sessions are keyed with a random 128-bit ID and SHA-256 HMAC cookie, `HttpOnly`, `SameSite=Lax`.
- Each guest has a separate JSON file in `data/worlds`. The server accepts block edits only at valid coordinates and rejects non-adjacent placement, negative inventory, and stale revisions.
- Writes serialize per guest, save to a temporary file, then atomically rename.
- Client shows the flat 16×16×3 dirt island, voxel trees, and player avatar.
- Keyboard and touch movement, third-person camera, jump, fall respawn, visible face-only voxel meshing, and place/mine buttons.

## Limits
This is **not** a production online service. No permanent user accounts, password login, account recovery, billing, database, or cloud deployment are provided.
- Guest identity depends on the browser cookie. Clearing cookies can orphan saved worlds.
- Player movement and edit reach are simulated by the client, **not server-authoritative**; suitable only for a noncompetitive functional prototype. Implement authenticated/server-validated movement and placement before a public economy/game launch.
- Data saves use local JSON files; production should use a database and backups.
- Decorative trees are not harvestable, there is no ore node or factory loop yet.
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
