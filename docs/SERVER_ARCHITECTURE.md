# EOS server architecture

## Runtime and save model

- `server.mjs` serves the browser client and the JSON API. It binds to `127.0.0.1` by default.
- Guest identities use a random 128-bit ID signed with HMAC-SHA256 in an HttpOnly, SameSite=Lax cookie.
- Each guest world is stored as schema-1 JSON under `data/worlds`. Writes are serialized per session and committed with a temporary file plus atomic rename.
- The server remains authoritative for movement, collision, reach, revisions, mining duration, inventory changes, crafting, machine placement, drops, and conveyor updates.
- Saves without newer terrain fields retain their legacy island size and coordinates. Load normalization preserves old inventory aliases and migrates the former `tools[]` and `nodes{}` representation into the current `inventory.tools`, `oreNodes`, and `trees` fields.

## Client/server flow

- The browser loads the current world from `GET /api/world`, submits bounded movement to `/api/move`, and refreshes world entities and conveyor state from the same world endpoint.
- Block mining starts through `/api/mine`; the server requires the selected owned tool and a 1.2-second hold before `/api/action` can commit the result.
- Direct mining and harvesting award inventory immediately. Machine-produced items are persisted as world drops and can only be acquired through an explicit `/api/items/pickup` interaction.
- Machine and conveyor item state is stored with the world. The logistics simulation updates belts and drop positions on world refresh, including corners and one-block rises.
- `/api/slot` validates ownership before assigning an item to one of the eight saved quick slots. Inventory and quickbar thumbnails are rendered from the shared item model generator and cached in the browser.

## Scope and limits

This is a local prototype, not a public production service. It has no durable account recovery, cloud database, public deployment hardening, or offline factory progression. Three.js is loaded from a CDN, so the browser needs network access. Production hosting would need TLS, rate limiting, durable storage, backup, and account recovery.

See [`GAME_DESIGN_AND_ROADMAP.md`](GAME_DESIGN_AND_ROADMAP.md) for planned game systems. GitHub Actions are not run by this workflow.
