import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const saveDir = process.env.TERRA_SAVE_DIR;
const cookieFile = process.env.TERRA_QA_COOKIE_FILE;
const secret = process.env.TERRA_SESSION_SECRET || '';
if (!saveDir || !cookieFile || secret.length < 32) throw new Error('Set TERRA_SAVE_DIR, TERRA_QA_COOKIE_FILE, and a 32+ character TERRA_SESSION_SECRET');

const id = randomBytes(16).toString('hex');
const signature = createHmac('sha256', secret).update(id).digest('hex');
const now = Date.now();
const world = {
  schema: 1, worldVersion: 3, islandSize: 10, revision: 0, coins: 100, location: null,
  inventory: {
    dirt: 48, wood: 12, stone: 6, wheat: 0, wheat_seed: 4, sapling: 0,
    items: { workbench: 0, farming_bench: 0, drill: 0, conveyor: 0, smelter: 0 },
    tools: { wood_pickaxe: 1, wood_axe: 1, wood_shovel: 1, hoe: 1, watering_can: 1, scythe: 0 },
    quickSlots: ['wood_pickaxe', 'wood_axe', 'wood_shovel', 'hoe', 'watering_can', null, null, null],
    selectedSlot: 3, wateringCanUses: 10
  },
  edits: {}, machines: [{ id: 't1-bench-start', type: 't1_bench', x: 2, y: 0, z: 1, rotation: 0 }],
  trees: [{ id: 'oak_start', x: -3, y: 0, z: -3, scale: 1, stage: 3, progress: 0, harvested: false }],
  harvestedTrees: [], tilled: [[-4,0,3],[-3,0,3],[-2,0,3],[-1,0,3],[0,0,3],[1,0,3],[2,0,3],[3,0,3],[4,0,3]],
  crops: [
    { id: 'wheat_1', x: -4, y: 0, z: 3, stage: 4, progress: 0, lastTick: now },
    { id: 'wheat_2', x: -3, y: 0, z: 3, stage: 4, progress: 0, lastTick: now },
    { id: 'wheat_3', x: -2, y: 0, z: 3, stage: 4, progress: 0, lastTick: now },
    { id: 'wheat_4', x: -1, y: 0, z: 3, stage: 4, progress: 0, lastTick: now },
    { id: 'wheat_5', x: 0, y: 0, z: 3, stage: 4, progress: 0, lastTick: now }
  ],
  watered: {}, waterSources: [{ x: 4, y: 0, z: 4 }], harvestedCrops: [],
  oreNodes: [{ id: 'stone_vein_start', x: 3, y: 0, z: -3, remaining: 3, max: 3, regenAt: null }],
  player: { x: 0.5, y: 0, z: 0.5, grounded: true }, createdAt: now, updatedAt: now
};

await mkdir(resolve(saveDir), { recursive: true });
await mkdir(resolve(cookieFile, '..'), { recursive: true });
await writeFile(join(saveDir, id + '.json'), JSON.stringify(world), { mode: 0o600 });
await writeFile(cookieFile, 'terra_session=' + id + '.' + signature, { mode: 0o600 });
