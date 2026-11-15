# TERRA resource expansion QA report

## Scope and baseline

- Repository: `/data/data/com.termux/files/home/EOS`
- Branch: `main`
- Baseline commit: `5bebf852f411083d58363b603b63dd9bfaf017e1`
- Baseline contained uncommitted chunk terrain, world-item logistics, and prior UX work. Those changes were preserved and integrated with this resource expansion.
- Three isolated agent worktrees were used for mineral, tree, and crop rule modules. Their owned module/test files were copied into the main checkout and tested there.
- No ECLIPSE settings, Android display, physical device, GitHub Actions, deployment, or remote push was used.

## Implemented

- Deterministic iron, coal, and copper vein lookup by world seed and global voxel coordinates; T0/T1 pickaxe validation; server-side independent 1-in-200 core roll; mining writes an air edit before the reward is saved.
- Forest/plains and oak/birch/rubber generation with stable root IDs, species dimensions, a single harvest target per tree, typed logs/saplings, rubber sap, and persisted natural-tree harvest tombstones.
- Wheat compatibility plus separately seeded carrots and potatoes with fixed one-product plus one-matching-seed harvests, using the existing game-time and watering rules.
- Stable resource IDs and inventory normalization without changing schema 1, `worldVersion: 3`, chunk generation version, seed, anchor, or existing edits. Legacy crops with no `cropType` remain wheat; legacy trees with no species remain oak; legacy wood/sapling totals remain available.
- UI selectors for crop and planted tree species, farmer-shop purchase controls for carrot and potato seeds, a T1 stone-pickaxe recipe, resource inventory labels, and shared low-poly thumbnails for new item types.
- Client block mining now permits either pickaxe for stone/ore targets and retains the server's tier gate. Registered resource IDs can be manually picked up from persisted world drops; duplicate pickup remains serialized and revision checked.

## Changed implementation and test files

- `index.html`
- `server.mjs`
- `src/game.js`
- `src/economy-rules.mjs`
- `src/chunk-world.mjs`
- `src/crop-rules.mjs`
- `src/item-logistics.mjs`
- `src/mineral-world.mjs`
- `src/resource-catalog.mjs`
- `src/tree-world.mjs`
- `devtools/time-control.js`
- `docs/TERRA_CHUNK_TERRAIN_QA_REPORT.md`
- `docs/TERRA_RESOURCE_EXPANSION_DESIGN.md`
- `tests/chunk-server.test.mjs`
- `tests/chunk-world.test.mjs`
- `tests/crop-rules.test.mjs`
- `tests/devtools.test.mjs`
- `tests/economy-rules.test.mjs`
- `tests/farming.test.mjs`
- `tests/item-logistics.test.mjs`
- `tests/mineral-world.test.mjs`
- `tests/resource-expansion-server.test.mjs`
- `tests/server.test.mjs`
- `tests/tree-world.test.mjs`
- `tests/ux-regression.test.mjs`
- `tests/world-scale.test.mjs`

## Verification

- `npm test`: **94 passed, 0 failed**, 12.39 seconds.
- New tests during the resource expansion: **21 total** (4 mineral rules, 5 tree rules, 5 crop rules, 5 server integration cases, 1 economy rule, 1 UI regression). The five server integration cases cover carrot/potato plant/harvest and reload, rubber-tree typed yield and tombstone reload, generated natural-tree tombstone reload, one-time registered-resource pickup and reload, and T0 rejection/T1 coal mining with persisted air edit.
- `node --check server.mjs`, `node --check src/game.js`, and `node --check tests/resource-expansion-server.test.mjs`: passed.
- `git diff --check`: passed.
- Existing item-logistics tests continue to cover straight, turning, and uphill belt links, save/reload state, and explicit pickup. The drill output server test continues to pass.
- Existing tree module tests verify deterministic chunk-order-independent generation, negative coordinates, forest/plains and grove distributions, stable seam ownership, target size bounds, and spacing.
- Existing chunk tests verify deterministic generation, negative chunk coordinates, seam continuity, persistence of edits, and stream queue invalidation.
- One test run reported the farming edge stress fixture's server RSS at 57,804 KiB before and 62,808 KiB after 114 requests. This is a single Node server fixture measurement, not an Android or frame-rate benchmark.

## Not verified

- A local browser binary and Playwright/Puppeteer are unavailable, so actual WebGL rendering, visual model orientation, and mobile layout were not screenshot-verified.
- No physical Android/tablet test was performed, as requested. Mobile FPS, draw-call behavior, and long-duration chunk streaming memory are therefore unmeasured.
- The share-library URL supplied in chat returned an empty page to the available reader; the latest local Downloads prompt was used as the task source.

## Failure and repair notes

- The first full suite had three failures: the no-devtools test fixture did not copy newly imported modules, a legacy tree test assumed a fixed one-sapling yield despite the specified 1–2 range, and a world-scale regex expected the old tree-root creation code. The fixture now includes the required modules and the assertions reflect the implemented contract.
- The first rubber-tree integration run had the fixture's selected quick slot on a pickaxe. The fixture now selects the axe and the same real-server test passes.

## Commit

Local commit only; no remote push.
