# TERRA resource expansion integration contract

Baseline: dirty EOS working tree at `5bebf852f411083d58363b603b63dd9bfaf017e1`. Preserve existing world JSON and uncommitted changes. New crop/tree/mineral modules are pure deterministic/rule modules; the main checkout owns all integration into shared server, client, registry, save, and UI files.

## File ownership

| Owner | Exclusive files | Main integration touchpoints (main agent only) |
| --- | --- | --- |
| Minerals agent | `src/mineral-world.mjs`, `tests/mineral-world.test.mjs` | `server.mjs`, `src/chunk-world.mjs`, `src/game.js`, registry/UI and integration tests |
| Trees agent | `src/tree-world.mjs`, `tests/tree-world.test.mjs` | `server.mjs`, `src/game.js`, registry/UI and integration tests |
| Crops agent | `src/crop-rules.mjs`, `tests/crop-rules.test.mjs` | `server.mjs`, `src/game.js`, registry/UI and integration tests |
| Main | shared schema, registry, server, chunk adapter, UI, recipes, integration/QA report | All shared files listed above |

Agents work in separate temporary Git worktrees seeded with an exact filesystem snapshot of the current dirty baseline. They must not edit shared integration files or commit.

## Stable persisted identifiers

- Minerals: blocks `iron_ore`, `coal_ore`, `copper_ore`; inventory `iron_ore`, `coal`, `copper_ore`; cores `iron_vein_core`, `coal_vein_core`, `copper_vein_core`. Existing `stone`, `wood_pickaxe`, and `oreNodes` IDs remain intact. Add `stone_pickaxe` as T1.
- Trees: species `oak`, `birch`, `rubber`; inventory `oak_log`, `birch_log`, `rubberwood`, `oak_sapling`, `birch_sapling`, `rubber_sapling`, `rubber_sap`. Missing/legacy species means oak. Deterministic natural IDs are stable by seed and absolute root coordinate. Persisted `harvestedTrees` remains the natural-tree tombstone list; planted trees stay in `trees`.
- Crops: `cropType` values `wheat`, `carrot`, `potato`; products `wheat`, `carrot`, `potato`; seeds `wheat_seed`, `carrot_seed`, `potato_seed`. Missing/legacy `cropType` means wheat.
- Keep `schema:1`, `worldVersion:3`, `worldGenVersion:1`, `worldSeed`, `(0,0,0)` anchor, and global edits map unchanged. Do not migrate old edits or reset old worlds.
- Resource modules provide deterministic/rule primitives only. Server remains authoritative for mining, core RNG, harvest, inventory, revisions, duplicate prevention, and JSON saves. Existing queued server mutations remain the serialization boundary.

## Module APIs

- `mineral-world.mjs`: `mineralAt(seed,x,y,z,surfaceY)`, `mineralDrop(blockType)`, `mineralTier(blockType)`, `isCoreDrop(blockType,roll)`. Generation must be global-coordinate/seed deterministic and connected across chunk edges. Core roll is a separate event helper using `[0,1)` and threshold `0.005`.
- `tree-world.mjs`: `biomeAt(seed,x,z)`, `treeSpeciesAt(seed,x,z)`, `generateTreesForChunk(seed,cx,cz,surfaceAt)`, `treeDimensions(species,variant)`. Stable root IDs; include crownWidth <= 4 and trunkWidth <= 1.5 in returned records. `surfaceAt(x,z)` is supplied by the caller.
- `crop-rules.mjs`: `cropTypeOf(crop)`, `seedItemForCrop(type)`, `productItemForCrop(type)`, `harvestYield(type)`, and `advanceCrop(crop,gameDeltaMs,wetGameMs)` (or equivalent documented pure helpers). Missing crop type resolves to wheat; fixed yield is one product plus one matching seed.

## Validation ownership

Agents test their owned pure modules. Main adds isolated real-server fixtures that exercise mining/tools/core rolls, natural-tree harvest/tombstones/planting, crop API flows and restart compatibility, then runs the full suite. No Android display, physical-device input, GitHub Actions, remote push, or deployment is part of this run.
