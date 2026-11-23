import http from 'node:http';
import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { cropTypeOf, seedItemForCrop, productItemForCrop, harvestYield, advanceCrop } from './src/crop-rules.mjs';
import { SHOP_HUB_LAYOUT, SHOP_HUB_WORLD_ID, PERSONAL_ISLAND_PORTAL, createShopHubInstance, isWorldActionAllowed } from './src/hub-world.mjs';
import { SHOP_CATALOG, resolveShopQuantity, applyShopTrade } from './src/economy-rules.mjs';
import { advanceItemLogistics, normalizeDrops } from './src/item-logistics.mjs';
import { WORLD_GEN_VERSION, PREVIOUS_WORLD_GEN_VERSION, LEGACY_WORLD_GEN_VERSION, WORLD_MIN_Y, WORLD_MAX_Y, blockAt, biomeAt as generatedBiomeAt, findBiomeSamples, waterLevelAt, stepFluid, chunkCoord, DEFAULT_CHUNK_RADIUS } from './src/chunk-world.mjs';
import { mineralDrop, mineralTier, pickaxeTier, canMineMineral, mineralCore, isCoreDrop } from './src/mineral-world.mjs';
import { PLACEABLE_BLOCK_IDS, normalizeResourceInventory, RESOURCE_KEYS, WOOD_LOG_KEYS, SAPLING_KEYS, TREE_LOGS, TREE_SAPLINGS, MINERAL_ITEMS } from './src/resource-catalog.mjs';
import { biomeAt as legacyBiomeAt, generateTreesForChunk, treeDimensions } from './src/tree-world.mjs';
import { heightAt } from './src/chunk-world.mjs';
import { COAL_BLOCK_RECIPE } from './src/recipe-settings.mjs';

const ROOT=resolve(process.cwd());
const SAVE_DIR=resolve(process.env.TERRA_SAVE_DIR || join(ROOT,'data','worlds'));
const PORT=Number(process.env.PORT || 3000);
const HOST=process.env.HOST || '127.0.0.1';
const SECRET=process.env.TERRA_SESSION_SECRET || '';
if(SECRET.length<32) { console.error('Set TERRA_SESSION_SECRET (at least 32 characters).'); process.exit(1); }
let devClockModule=null,devTeleportService=null;
if(process.env.NODE_ENV==='development'){
 try{
  await access(join(ROOT,'devtools','index.mjs'));
  devClockModule=await import('./devtools/index.mjs');
  if(typeof devClockModule.createTimeControl!=='function'||typeof devClockModule.createTeleportService!=='function')devClockModule=null;
  if(devClockModule)devTeleportService=devClockModule.createTeleportService({
   worldMinY:WORLD_MIN_Y,worldMaxY:WORLD_MAX_Y,surfaceAt,
   isSolidForPlayer:solidForBody,
   hasGroundSupport:(world,x,y,z)=>!!block(world,Math.floor(x),Math.floor(y-.025),Math.floor(z)),
   isLiquidAt:(world,x,y,z)=>waterLevelAt(world,Math.floor(x),Math.floor(y),Math.floor(z))>0,
   biomeAt:(seed,x,z,version)=>version===LEGACY_WORLD_GEN_VERSION?legacyBiomeAt(seed,x,z):generatedBiomeAt(seed,x,z,version||WORLD_GEN_VERSION),
   getWaterSurfaceLanding:(world,x,z)=>world?.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION&&waterLevelAt(world,Math.floor(x),world.seaLevel,Math.floor(z))>0?{y:world.seaLevel+1}:null
  });
 }catch{devClockModule=null;devTeleportService=null;}
}
let developerMultiplier=1,devtimeQueue=Promise.resolve();
const devtoolsEnabled=!!devClockModule;
const BASE_GAME_MINUTES_PER_REAL_MINUTE=devClockModule?.BASE_GAME_MINUTES_PER_REAL_MINUTE||12;
const sessions=new Map();
const MINING_DURATION_MS=1200;
const PLAYER_HEIGHT=1.78,PLAYER_HALF_WIDTH=.34,MOVE_SPEED=4,GRAVITY=17,JUMP_SPEED=6.7;
const TREE_HARVEST_MS=1200,ORE_REGEN_MS=30000,ORE_CAPACITY=3;
const WHEAT_STAGE_MS=60000, WATER_DURATION_MS=300000;
const INVENTORY_CAP=1000000;
const LEGACY_TREES=[{id:'oak_west',x:-5,y:0,z:-5,scale:1},{id:'oak_east',x:5,y:0,z:4,scale:.9}];
const LEGACY_NODE_DEFS={
 'tree-a':{kind:'tree',tool:'axe',capacity:1,yield:5,x:-5,z:-5},'tree-b':{kind:'tree',tool:'axe',capacity:1,yield:5,x:5,z:4},
 'stone-a':{kind:'stone',tool:'pickaxe',capacity:24,yield:1,x:-2,z:4},'stone-b':{kind:'stone',tool:'pickaxe',capacity:24,yield:1,x:3,z:-4},'iron-a':{kind:'iron_ore',tool:'pickaxe',capacity:12,yield:1,x:5,z:-5}
};
const RECIPES={
 tool_bench:{cost:{stone:10,wood:5},item:true},
 agriculture_bench:{cost:{wheat:10,wood:5},item:true},
 block_bench:{cost:{stone:5,wood:5},item:true},
 basic_assembler:{cost:{stone:20,iron_ore:10,wood:20,coal_block:5},item:true},
 workbench:{cost:{wood:8,dirt:6},station:'t1_bench'},
 farming_bench:{cost:{wood:2,stone:3},station:'t1_bench',item:true},
 hoe:{cost:{wood:2,stone:1},station:'agriculture_bench',tool:true},
 stone_pickaxe:{cost:{wood:3,stone:3},station:'tool_bench',tool:true},
 watering_can:{cost:{wood:2,stone:2},station:'agriculture_bench',tool:true},
 scythe:{cost:{wood:2,stone:3},station:'agriculture_bench',tool:true},
 drill:{cost:{wood:10,dirt:12},station:'basic_assembler'},
 conveyor:{cost:{wood:4,dirt:5},station:'basic_assembler'},
 smelter:{cost:{wood:6,dirt:10},station:'basic_assembler'},
 coal_block:{cost:{[COAL_BLOCK_RECIPE.inputItem]:COAL_BLOCK_RECIPE.inputQuantity},station:'block_bench',output:{item:COAL_BLOCK_RECIPE.outputItem,quantity:COAL_BLOCK_RECIPE.outputQuantity}}
};
const allowedFiles=new Map([['/','index.html'],['/index.html','index.html'],['/models','models.html'],['/models.html','models.html'],['/src/model-assets.js','src/model-assets.js'],['/src/model-gallery.js','src/model-gallery.js'],['/src/hub-world.mjs','src/hub-world.mjs'],['/src/game.js','src/game.js'],['/src/terrain-atlas.js','src/terrain-atlas.js'],['/src/greedy-chunk-mesh.js','src/greedy-chunk-mesh.js'],['/src/nature-visuals.js','src/nature-visuals.js'],['/src/workstation-visuals.js','src/workstation-visuals.js'],['/src/industrial-visuals.js','src/industrial-visuals.js'],['/src/farmer-npc.js','src/farmer-npc.js'],['/src/farming-rules.mjs','src/farming-rules.mjs'],['/src/crop-rules.mjs','src/crop-rules.mjs'],['/src/item-logistics.mjs','src/item-logistics.mjs'],['/src/chunk-world.mjs','src/chunk-world.mjs'],['/src/mineral-world.mjs','src/mineral-world.mjs'],['/src/tree-world.mjs','src/tree-world.mjs'],['/src/resource-catalog.mjs','src/resource-catalog.mjs'],['/src/recipe-settings.mjs','src/recipe-settings.mjs']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const devFiles=new Map([['/devtools/time-control.js','devtools/time-control.js'],['/devtools/dev-panel.css','devtools/dev-panel.css']]);
const localAddress=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const key=(x,y,z)=>[x,y,z].join(',');
const inBounds=(x,y,z,world=null)=>Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&
 (world?.worldGenVersion?x>=-4096&&x<4096&&z>=-4096&&z<4096&&y>=WORLD_MIN_Y&&y<=WORLD_MAX_Y:x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16);
const nativeBlock=(size,x,y,z)=>{const half=size/2;return x>=-half&&x<half&&z>=-half&&z<half&&y>=-3&&y<0?'dirt':null;};
function block(world,x,y,z){const k=key(x,y,z);if(Object.hasOwn(world.edits,k))return world.edits[k];return world.worldGenVersion?blockAt(world,x,y,z):nativeBlock(world.islandSize||16,x,y,z);}
function biomeForWorld(world,x,z){return world?.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION?generatedBiomeAt(world.worldSeed,x,z,world.worldGenVersion):world?.worldGenVersion===LEGACY_WORLD_GEN_VERSION?legacyBiomeAt(world.worldSeed,x,z):null;}
function personalPortalCell(world,x,y,z){const floor=surfaceAt(world,PERSONAL_ISLAND_PORTAL.x,PERSONAL_ISLAND_PORTAL.z);return Math.abs(x-PERSONAL_ISLAND_PORTAL.x)<=4&&Math.abs(z-PERSONAL_ISLAND_PORTAL.z)<=5&&y>=floor&&y<=floor+4;}
const naturalTreeCache=new Map();
const biomeSamplesCache=new Map();
function surfaceAt(world,x,z){return world.worldGenVersion?heightAt(world.worldSeed,x,z,world.worldGenVersion):0;}
function naturalTreesInChunk(world,cx,cz){const cacheKey=`${world.worldGenVersion}:${world.worldSeed}:${cx},${cz}`;let trees=naturalTreeCache.get(cacheKey);if(!trees){trees=generateTreesForChunk(world.worldSeed,cx,cz,(x,z)=>surfaceAt(world,x,z),world.worldGenVersion);naturalTreeCache.set(cacheKey,trees);if(naturalTreeCache.size>256)naturalTreeCache.delete(naturalTreeCache.keys().next().value);}return trees;}
function naturalTreeById(world,id){if(!world.worldGenVersion||typeof id!=='string')return null;const prefix=`natural-tree:${world.worldSeed}:`;if(!id.startsWith(prefix))return null;const match=/^(-?\d+),(-?\d+)$/.exec(id.slice(prefix.length));if(!match)return null;const x=Number(match[1]),z=Number(match[2]),cx=Math.floor(x/16),cz=Math.floor(z/16);return naturalTreesInChunk(world,cx,cz).find(tree=>tree.id===id)||null;}
function treeById(world,id){return world.trees.find(t=>t.id===id)||naturalTreeById(world,id);}
function nearbyNaturalTrees(world,x,z){const cx=Math.floor(x/16),cz=Math.floor(z/16),trees=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)trees.push(...naturalTreesInChunk(world,cx+dx,cz+dz));return trees;}
function gatherTarget(world,type,id){
 if(type==='tree'){const item=treeById(world,id);return item&&item.stage>=3&&!item.harvested?{x:item.x+.5,y:item.y+Math.max(1.7,(item.height||5)*.55),z:item.z+.5}:null;}
 if(type==='wheat'||type==='crop'){const item=world.crops.find(c=>c.id===id);return item&&item.stage>=4?{x:item.x+.5,y:item.y+.45,z:item.z+.5}:null;}
 return null;
}
function gathered(world,type,id){return type==='tree'?world.harvestedTrees.includes(id):type==='wheat'||type==='crop'?world.harvestedCrops.includes(id):true;}
function equipped(inv,id){return !!id&&inv.quickSlots?.[inv.selectedSlot]===id&&(inv.tools?.[id]||0)>0;}
function consumeWood(inventory,amount){if(!Number.isSafeInteger(amount)||amount<0||inventory.wood<amount)return false;let left=amount;for(const id of ['oak_log','birch_log','rubberwood']){const used=Math.min(left,inventory[id]||0);inventory[id]-=used;left-=used;}inventory.wood-=amount;return true;}
function consumeSapling(inventory,species){if(!Number.isSafeInteger(inventory.sapling)||inventory.sapling<1)return false;const specific=TREE_SAPLINGS[species]||TREE_SAPLINGS.oak,typed=Object.values(TREE_SAPLINGS).reduce((sum,id)=>sum+(inventory[id]||0),0),legacy=Math.max(0,inventory.sapling-typed);if((inventory[specific]||0)>0)inventory[specific]--;else if(legacy>0&&species==='oak'){}else return false;inventory.sapling--;return true;}
function advanceGrowth(world,now=Date.now(),devMultiplier=1,gameDeltaOverride){
 // One real millisecond advances 12 game milliseconds at 1×, multiplied once
 // by the developer clock. Keep the 6-second activity window in real time so
 // slow requests/freezes cannot turn into offline catch-up.
 const multiplier=[1,2,5,10,50].includes(devMultiplier)?devMultiplier:1;
 const elapsed=Math.max(0,now-(world.lastGameTick||now)),realDt=elapsed<=6000?elapsed:0;
 const gameDt=Number.isFinite(gameDeltaOverride)?Math.max(0,gameDeltaOverride):realDt*BASE_GAME_MINUTES_PER_REAL_MINUTE*multiplier;world.lastGameTick=now;let changed=gameDt>0;
 // Water duration uses game milliseconds too, so it accelerates with crops
 // while preserving the exact 2× wet growth bonus.
 const wetTime={};for(const [tile,remainingValue] of Object.entries(world.watered)){const remaining=Math.max(0,Number(remainingValue)||0),wet=Math.min(gameDt,remaining);wetTime[tile]=wet;if(remaining<=gameDt)delete world.watered[tile];else world.watered[tile]=remaining-gameDt;}
 for(let i=0;i<world.crops.length;i++){const crop=world.crops[i];if(crop.stage<4&&gameDt){world.crops[i]=advanceCrop(crop,gameDt,wetTime[key(crop.x,crop.y,crop.z)]||0);changed=true;}}
 for(const t of world.trees)if(t.stage<3&&gameDt){t.progress+=gameDt;while(t.progress>=WHEAT_STAGE_MS*3&&t.stage<3){t.progress-=WHEAT_STAGE_MS*3;t.stage++;}changed=true;}
 return changed;
}
function refreshOreNodes(world){let changed=false;const now=Date.now();for(const node of world.oreNodes){if(node.remaining===0&&node.regenAt&&node.regenAt<=now){node.remaining=node.max||ORE_CAPACITY;node.regenAt=null;changed=true;}}return changed;}
function mineOre(world,id){
 const node=world.oreNodes.find(n=>n.id===id);if(!node||node.remaining<1)return {error:'Stone vein is exhausted'};
 const next={...world,inventory:{...world.inventory},oreNodes:world.oreNodes.map(n=>({...n})),revision:world.revision+1,updatedAt:Date.now()};
 const vein=next.oreNodes.find(n=>n.id===id);vein.remaining--;vein.regenAt=vein.remaining===0?(vein.legacyNode?null:Date.now()+ORE_REGEN_MS):null;const item=vein.dropItem||'stone';next.inventory[item]=(next.inventory[item]||0)+1;
 return {next};
}
const starterTools={wood_pickaxe:1,wood_axe:1,wood_shovel:1,stone_pickaxe:0};
const starterSlots=['wood_pickaxe','wood_axe','wood_shovel','dirt','sand',null,null,null];
function fresh(){
 const now=Date.now(),world={schema:1,worldVersion:3,worldSeed:randomBytes(4).readUInt32BE(0),worldGenVersion:WORLD_GEN_VERSION,seaLevel:0,fluidRevision:0,fluidEdits:{},fluidActive:[],fluidTickRate:5,worldAnchor:{x:0,y:0,z:0,kind:'landing-origin'},islandSize:10,revision:0,coins:100,location:null,inventory:{dirt:48,sand:8,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{workbench:0,farming_bench:0,tool_bench:0,agriculture_bench:0,block_bench:0,basic_assembler:0,drill:0,conveyor:0,smelter:0},tools:{...starterTools,hoe:0,watering_can:0,scythe:0},quickSlots:[...starterSlots],selectedSlot:1,wateringCanUses:10},edits:{},machines:[{id:'t1-bench-start',type:'t1_bench',x:2,y:0,z:1,rotation:0}],trees:[{id:'oak_start',x:-3,y:0,z:-3,scale:1,species:'oak',source:'planted',stage:3,progress:0,harvested:false}],harvestedTrees:[],tilled:[[-4,0,3],[-3,0,3],[-2,0,3],[-1,0,3],[0,0,3],[1,0,3],[2,0,3],[3,0,3],[4,0,3]],crops:[{id:'wheat_1',cropType:'wheat',x:-4,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_2',cropType:'wheat',x:-3,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_3',cropType:'wheat',x:-2,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_4',cropType:'wheat',x:-1,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_5',cropType:'wheat',x:0,y:0,z:3,stage:4,progress:0,lastTick:now}],watered:{},waterSources:[{x:4,y:0,z:4}],harvestedCrops:[],oreNodes:[{id:'stone_vein_start',x:3,y:0,z:-3,remaining:ORE_CAPACITY,max:ORE_CAPACITY,regenAt:null}],drops:[],player:{x:.5,y:0,z:.5,grounded:true},createdAt:now,updatedAt:now};
 const ground=(x,z)=>heightAt(world.worldSeed,x,z,WORLD_GEN_VERSION);
 for(const entity of [...world.machines,...world.trees,...world.oreNodes])entity.y=ground(entity.x,entity.z);
 world.tilled=world.tilled.map(([x,,z])=>[x,ground(x,z),z]);
 for(const crop of world.crops)crop.y=ground(crop.x,crop.z);
 for(const source of world.waterSources)source.y=ground(source.x,source.z);
 world.player.y=ground(0,0);world.inventory=normalizeResourceInventory(world.inventory);return world;
}
function validFluidState(w){
 if(!w.worldGenVersion||w.worldGenVersion<PREVIOUS_WORLD_GEN_VERSION)return true;
 const validCell=cell=>{if(typeof cell!=='string'||! /^-?\d+,-?\d+,-?\d+$/.test(cell))return false;const [x,y,z]=cell.split(',').map(Number);return x>=-4096&&x<4096&&z>=-4096&&z<4096&&y>=WORLD_MIN_Y&&y<=WORLD_MAX_Y;};
 return w.seaLevel===0&&Number.isSafeInteger(w.fluidRevision)&&w.fluidRevision>=0&&w.fluidEdits&&typeof w.fluidEdits==='object'&&!Array.isArray(w.fluidEdits)&&Object.keys(w.fluidEdits).length<=50000&&Object.entries(w.fluidEdits).every(([cell,level])=>validCell(cell)&&Number.isInteger(level)&&level>=0&&level<=8)&&
  (w.fluidActive===undefined||Array.isArray(w.fluidActive)&&w.fluidActive.length<=50000&&w.fluidActive.every(validCell))&&(w.fluidTickRate===undefined||[2,5,10].includes(w.fluidTickRate));
}
function validWorld(w){return w&&w.schema===1&&Number.isSafeInteger(w.revision)&&w.revision>=0&&w.inventory&&Number.isSafeInteger(w.inventory.dirt)&&w.inventory.dirt>=0&&w.inventory.dirt<=1000000&&w.edits&&typeof w.edits==='object'&&!Array.isArray(w.edits)&&Object.keys(w.edits).length<=20000&&
 (w.worldGenVersion===undefined||([LEGACY_WORLD_GEN_VERSION,PREVIOUS_WORLD_GEN_VERSION,WORLD_GEN_VERSION].includes(w.worldGenVersion)&&Number.isSafeInteger(w.worldSeed)&&w.worldSeed>=0&&w.worldSeed<=0xffffffff))&&
 validFluidState(w);}
function validPlayerPosition(p,world=null){return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)&&Math.abs(p.x)<=(world?.worldGenVersion?4096:64)&&Math.abs(p.z)<=(world?.worldGenVersion?4096:64)&&p.y>=(world?.worldGenVersion?WORLD_MIN_Y-8:-13)&&p.y<=(world?.worldGenVersion?WORLD_MAX_Y+8:18);}
function enqueueFluidAround(world,x,y,z){
 if(!(world?.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return;
 const active=new Set(Array.isArray(world.fluidActive)?world.fluidActive:[]);
 for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(waterLevelAt(world,x+dx,y+dy,z+dz)>0)active.add(key(x+dx,y+dy,z+dz));
 world.fluidActive=[...active].sort();
}
function advanceWorldFluid(session,now=Date.now()){
 const world=session.world;if(!(world.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return false;
 const rate=[2,5,10].includes(world.fluidTickRate)?world.fluidTickRate:5;
 const elapsed=Math.max(0,Math.min(5000,now-session.lastFluidTickAt));session.lastFluidTickAt=now;
 session.fluidTickRemainder=(session.fluidTickRemainder||0)+elapsed*rate/1000;
 const ticks=Math.min(20,Math.floor(session.fluidTickRemainder));if(!ticks||!world.fluidActive?.length)return false;
 session.fluidTickRemainder-=ticks;let changed=false,queueChanged=false;
 for(let i=0;i<ticks&&world.fluidActive?.length;i++){const result=stepFluid(world,world.fluidActive,{budget:2048});if(result.changed)changed=true;if(result.queueChanged)queueChanged=true;}
 if(changed){world.revision++;world.updatedAt=now;}
 return changed||queueChanged;
}
function fluidCellsNear(world,x,z){
 if(!(world.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return {};
 const cx=chunkCoord(Math.floor(x)),cz=chunkCoord(Math.floor(z)),cells={};
 for(const [cell,level]of Object.entries(world.fluidEdits||{})){const [wx,,wz]=cell.split(',').map(Number);if(Math.abs(chunkCoord(wx)-cx)<=DEFAULT_CHUNK_RADIUS&&Math.abs(chunkCoord(wz)-cz)<=DEFAULT_CHUNK_RADIUS)cells[cell]=level;}
 return cells;
}
function cookieValue(id){return id+'.'+createHmac('sha256',SECRET).update(id).digest('hex');}
function identity(req){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('terra_session='))?.slice(14);
 if(value){const [id,sig]=value.split('.');if(/^[a-f0-9]{32}$/.test(id)&&/^[a-f0-9]{64}$/.test(sig||'')){const expected=cookieValue(id).split('.')[1];if(timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return {id,isNew:false};}}
 return {id:randomBytes(16).toString('hex'),isNew:true};
}
async function load(id){if(sessions.has(id))return sessions.get(id);
 let w,created=false;try{w=JSON.parse(await readFile(join(SAVE_DIR,id+'.json'),'utf8'));if(!validWorld(w))throw Error('Invalid save');}
 catch(e){if(e.code!=='ENOENT')throw e;w=fresh();created=true;}
 if(!Number.isSafeInteger(w.islandSize))w.islandSize=16;
 const migrateOpenWorld=!created&&w.islandSize===10&&w.worldGenVersion===undefined;
 if(!Number.isSafeInteger(w.worldVersion))w.worldVersion=w.islandSize===10?2:1;
 if(!validPlayerPosition(w.player,w))w.player={x:.5,y:w.worldGenVersion?heightAt(w.worldSeed,0,0,w.worldGenVersion):0,z:.5,grounded:true};
 w.inventory.wood=Number.isSafeInteger(w.inventory.wood)&&w.inventory.wood>=0?w.inventory.wood:0;
 w.inventory.stone=Number.isSafeInteger(w.inventory.stone)&&w.inventory.stone>=0?w.inventory.stone:0;
 w.inventory.wheat=Number.isSafeInteger(w.inventory.wheat)&&w.inventory.wheat>=0?w.inventory.wheat:0;
 if(w.inventory.iron_ore===undefined&&Number.isSafeInteger(w.inventory.ironOre)&&w.inventory.ironOre>=0)w.inventory.iron_ore=w.inventory.ironOre;
 if(!w.inventory.tools&&Array.isArray(w.tools)){w.inventory.tools={wood_pickaxe:w.tools.includes('pickaxe')?1:0,wood_axe:w.tools.includes('axe')?1:0,wood_shovel:w.tools.includes('shovel')?1:0,stone_pickaxe:0,hoe:0,watering_can:0,scythe:0};}
 if(!w.inventory.items||typeof w.inventory.items!=='object'||Array.isArray(w.inventory.items))w.inventory.items={};
 for(const item of Object.keys(RECIPES))if(!RECIPES[item].tool&&!RECIPES[item].output&&(!Number.isSafeInteger(w.inventory.items[item])||w.inventory.items[item]<0))w.inventory.items[item]=0;
 if(!w.inventory.tools||typeof w.inventory.tools!=='object'||Array.isArray(w.inventory.tools))w.inventory.tools={...starterTools};
 if(!Number.isSafeInteger(w.inventory.tools.stone_pickaxe)||w.inventory.tools.stone_pickaxe<0)w.inventory.tools.stone_pickaxe=0;
 if(!Array.isArray(w.inventory.quickSlots))w.inventory.quickSlots=[...starterSlots];
 while(w.inventory.quickSlots.length<8)w.inventory.quickSlots.push(null);
 w.inventory.quickSlots=w.inventory.quickSlots.slice(0,8);
 if(!Number.isInteger(w.inventory.selectedSlot)||w.inventory.selectedSlot<0||w.inventory.selectedSlot>7)w.inventory.selectedSlot=1;
 if(!Array.isArray(w.machines))w.machines=[];normalizeDrops(w);
 if(!Array.isArray(w.trees)){
  const legacyNodeSave=Array.isArray(w.tools)||w.nodes&&typeof w.nodes==='object',legacyTrees=LEGACY_TREES.map((tree,i)=>{const id=i===0?'tree-a':'tree-b',node=LEGACY_NODE_DEFS[id],remaining=legacyNodeSave?(Number.isInteger(w.nodes?.[id])?w.nodes[id]:node.capacity):node.capacity;return {...tree,id,source:'legacy-node',stage:3,legacyYield:node.yield,harvested:remaining===0};});
  w.trees=w.islandSize===16?legacyTrees:[];
 }
 if(!Array.isArray(w.harvestedTrees))w.harvestedTrees=[];
 if(!Array.isArray(w.oreNodes))w.oreNodes=[];
 if(w.nodes&&typeof w.nodes==='object'&&!Array.isArray(w.nodes)){
  for(const [id,node]of Object.entries(LEGACY_NODE_DEFS)){
   const remaining=Number.isInteger(w.nodes[id])?Math.max(0,Math.min(node.capacity,w.nodes[id])):node.capacity;
   if(node.kind==='tree'){
    let tree=w.trees.find(t=>t.id===id);if(!tree){tree={id,x:node.x,y:0,z:node.z,source:'legacy-node',species:'oak',stage:3,legacyYield:node.yield,harvested:remaining===0};w.trees.push(tree);}else{tree.legacyYield=node.yield;tree.source='legacy-node';}
    if(remaining===0&&!w.harvestedTrees.includes(id))w.harvestedTrees.push(id);tree.harvested=remaining===0||w.harvestedTrees.includes(id);
   }else if(!Array.isArray(w.oreNodes)||!w.oreNodes.some(ore=>ore.id===id)){
    if(!Array.isArray(w.oreNodes))w.oreNodes=[];w.oreNodes.push({id,x:node.x,y:0,z:node.z,remaining,max:node.capacity,regenAt:null,legacyNode:true,...(node.kind==='iron_ore'?{dropItem:'iron_ore'}:{})});
   }
  }
 }
 if(!Array.isArray(w.crops))w.crops=[];
 if(!Array.isArray(w.harvestedCrops))w.harvestedCrops=[];
 if(!Array.isArray(w.tilled))w.tilled=[];if(!w.watered||typeof w.watered!=='object')w.watered={};
 if(w.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION){if(!Number.isInteger(w.seaLevel))w.seaLevel=0;if(!Number.isSafeInteger(w.fluidRevision))w.fluidRevision=0;if(!w.fluidEdits||typeof w.fluidEdits!=='object'||Array.isArray(w.fluidEdits))w.fluidEdits={};if(!Array.isArray(w.fluidActive))w.fluidActive=[];if(![2,5,10].includes(w.fluidTickRate))w.fluidTickRate=5;}
 w.lastGameTick=Date.now();for(const [tile,value] of Object.entries(w.watered))if(!Number.isFinite(value)||value<0)delete w.watered[tile];
 if(!Array.isArray(w.waterSources))w.waterSources=[];
 if(!Number.isSafeInteger(w.inventory.wheat_seed)||w.inventory.wheat_seed<0)w.inventory.wheat_seed=0;
 if(!Number.isSafeInteger(w.inventory.sapling)||w.inventory.sapling<0)w.inventory.sapling=0;
 if(!Number.isSafeInteger(w.inventory.wateringCanUses))w.inventory.wateringCanUses=10;
 if(!Number.isSafeInteger(w.coins)||w.coins<0||w.coins>1000000000)w.coins=100;
 for(const resource of ['wood','stone','wheat','wheat_seed','sapling'])if(!Number.isSafeInteger(w.inventory[resource])||w.inventory[resource]<0||w.inventory[resource]>INVENTORY_CAP)w.inventory[resource]=0;
 w.inventory=normalizeResourceInventory(w.inventory,INVENTORY_CAP);
 if(!w.location||typeof w.location!=='object'||Array.isArray(w.location))w.location={worldId:'personal-island',personalInstanceId:`terra:personal-island:private:${id}`};
 w.location.personalInstanceId=`terra:personal-island:private:${id}`;
 if(w.location.worldId!=='shop-hub')w.location.worldId='personal-island';
 if(w.location.worldId==='shop-hub'&&(!w.location.hubInstanceId||typeof w.location.hubInstanceId!=='string'))w.location.hubInstanceId=createShopHubInstance(id).instanceId;
 if(w.location.worldId==='shop-hub'&&(!validPlayerPosition(w.location.hubPlayer)||Math.abs(w.location.hubPlayer.x)>SHOP_HUB_LAYOUT.size.x/2||Math.abs(w.location.hubPlayer.z)>SHOP_HUB_LAYOUT.size.z/2))w.location.hubPlayer={...SHOP_HUB_LAYOUT.spawn,grounded:true};
 for(const t of ['hoe','watering_can','scythe'])if(!Number.isSafeInteger(w.inventory.tools[t]))w.inventory.tools[t]=0;
 if(migrateOpenWorld){
  w.worldSeed=randomBytes(4).readUInt32BE(0);w.worldGenVersion=WORLD_GEN_VERSION;w.seaLevel=0;w.fluidRevision=0;w.fluidEdits={};w.fluidActive=[];w.fluidTickRate=5;
  const ground=(x,z)=>heightAt(w.worldSeed,x,z,WORLD_GEN_VERSION);
  for(const entity of [...w.machines,...w.trees,...w.oreNodes])entity.y=(Number.isFinite(entity.y)?entity.y:0)+ground(entity.x,entity.z);
  w.tilled=w.tilled.map(([x,y,z])=>[x,(Number.isFinite(y)?y:0)+ground(x,z),z]);
  for(const crop of w.crops)crop.y=(Number.isFinite(crop.y)?crop.y:0)+ground(crop.x,crop.z);
  for(const source of w.waterSources)source.y=(Number.isFinite(source.y)?source.y:0)+ground(source.x,source.z);
  w.player={...w.player,y:(Number.isFinite(w.player.y)?w.player.y:0)+ground(0,0)};
 }
 if(!Array.isArray(w.inventory.quickSlots))w.inventory.quickSlots=[...starterSlots];while(w.inventory.quickSlots.length<8)w.inventory.quickSlots.push(null);
 const loadedAt=Date.now();for(const c of w.crops){c.cropType=cropTypeOf(c);if(!Number.isInteger(c.stage))c.stage=4;if(!Number.isFinite(c.progress))c.progress=0;c.lastTick=loadedAt;}
 for(const t of w.trees){if(!t.species)t.species='oak';if(!t.source)t.source='planted';if(!Number.isInteger(t.stage))t.stage=3;if(!Number.isFinite(t.progress))t.progress=0;t.lastTick=loadedAt;t.harvested=w.harvestedTrees.includes(t.id);}
 const sessionLoadedAt=Date.now();w.lastGameTick=sessionLoadedAt;for(const c of w.crops)c.lastTick=sessionLoadedAt;for(const t of w.trees)t.lastTick=sessionLoadedAt;
 const gameClock=devtoolsEnabled?devClockModule.createTimeControl({now:sessionLoadedAt}):null;
 if(gameClock&&developerMultiplier!==1)gameClock.setMultiplier(developerMultiplier,sessionLoadedAt);
 const activePlayer=w.location.worldId==='shop-hub'?w.location.hubPlayer:w.player;
 const session={world:w,queue:Promise.resolve(),mining:null,harvesting:null,gameClock,player:{...activePlayer,vy:0,grounded:activePlayer.grounded===true,lastAt:sessionLoadedAt},lastPlayerSaveAt:sessionLoadedAt,lastLogisticsAt:sessionLoadedAt,lastFluidTickAt:sessionLoadedAt,fluidTickRemainder:0};if(created||migrateOpenWorld)await save(id,w);sessions.set(id,session);return session;
}
function advanceSessionTime(session,now=Date.now(),multiplierOverride){
 const multiplier=multiplierOverride??(devtoolsEnabled?(session.gameClock?.snapshot().multiplier||developerMultiplier):1);
 const clockTick=session.gameClock?.tick(now);
 return advanceGrowth(session.world,now,multiplier,clockTick?.deltaGameMs);
}
async function save(id,w){await mkdir(SAVE_DIR,{recursive:true});const target=join(SAVE_DIR,id+'.json');const tmp=target+'.'+randomBytes(4).toString('hex')+'.tmp';const persisted={...w,crops:(w.crops||[]).map(({lastTick,...crop})=>crop),trees:(w.trees||[]).map(({lastTick,...tree})=>tree)};delete persisted.lastGameTick;await writeFile(tmp,JSON.stringify(persisted));await rename(tmp,target);}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function error(res,status,message){send(res,status,{error:message});}
async function jsonBody(req){let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>4096)throw Object.assign(Error('Request too large'),{status:413});}try{return JSON.parse(body);}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
function change(current,action){const {type,x,y,z,revision}=action||{};
 if(!inBounds(x,y,z,current))return {error:'Invalid coordinates'};
 if(!Number.isSafeInteger(revision)||revision!==current.revision)return {error:'Revision conflict',conflict:true};
 if(type==='place'&&personalPortalCell(current,x,y,z))return {error:'The portal area is protected'};
 const existing=block(current,x,y,z);
 if(type==='place'){
  const item=PLACEABLE_BLOCK_IDS.includes(action.item)?action.item:'dirt';
  if(existing)return {error:'Space is occupied'};
  if((current.inventory[item]||0)<1)return {error:`Not enough ${item}`};
  if(!(current.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION&&waterLevelAt(current,x,y,z)>0)&&![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>block(current,x+dx,y+dy,z+dz)))return {error:'Must attach to existing terrain or water'};
 }else if(type==='mine'){
  if(!existing)return {error:'No block'};
  if(['dirt','grass','sand'].includes(existing)){
   if(action.tool!=='wood_shovel'||!equipped(current.inventory,'wood_shovel'))return {error:'A wooden shovel is required'};
   const item=existing==='sand'?'sand':'dirt';if((current.inventory[item]||0)>=INVENTORY_CAP)return {error:'Inventory full'};
  }else if(existing==='coal_block'){
   if(!['wood_pickaxe','stone_pickaxe'].includes(action.tool)||!equipped(current.inventory,action.tool))return {error:'Equip a pickaxe to mine this block'};
   if((current.inventory.coal_block||0)>=INVENTORY_CAP)return {error:'Inventory full'};
  }else if(mineralTier(existing)!==null){
   if(!['wood_pickaxe','stone_pickaxe'].includes(action.tool)||!equipped(current.inventory,action.tool))return {error:'Equip a pickaxe to mine this block'};
   if(!canMineMineral(existing,action.tool))return {error:'T1 stone pickaxe required for this ore'};
   const item=existing==='stone'?'stone':mineralDrop(existing);if(!item)return {error:'Unsupported mineral block'};
   if((current.inventory[item]||0)>=INVENTORY_CAP)return {error:'Inventory full'};
  }else return {error:'This block cannot be mined with these tools'};
 }else return {error:'Unknown action'};
 if(Object.keys(current.edits).length>=20000&&!Object.hasOwn(current.edits,key(x,y,z)))return {error:'World edit limit'};
 // Never mutate the persisted object before the save succeeds.
 const next={...current,edits:{...current.edits},inventory:{...current.inventory},tilled:[...current.tilled],crops:[...current.crops],watered:{...current.watered},revision:current.revision+1,updatedAt:Date.now()};
 const original=block(current,x,y,z),placedItem=PLACEABLE_BLOCK_IDS.includes(action.item)?action.item:'dirt',after=type==='place'?placedItem:null;
 if(after===original)delete next.edits[key(x,y,z)];else next.edits[key(x,y,z)]=after;
 if(type==='place')next.inventory[placedItem]--;
 else if(['dirt','grass','sand'].includes(original)){const item=original==='sand'?'sand':'dirt';next.inventory[item]++;}
 else if(original==='coal_block')next.inventory.coal_block++;
 else{
  const item=original==='stone'?'stone':mineralDrop(original);next.inventory[item]=(next.inventory[item]||0)+1;
  const core=mineralCore(original);if(core&&isCoreDrop(original,randomInt(200)/200)&&(next.inventory[core]||0)<INVENTORY_CAP)next.inventory[core]=(next.inventory[core]||0)+1;
 }
 if(type==='mine'&&y===-1){const surface=key(x,0,z);next.tilled=next.tilled.filter(c=>key(...c)!==surface);next.crops=next.crops.filter(c=>!(c.x===x&&c.y===0&&c.z===z));delete next.watered[surface];}
 if(type==='mine'&&next.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION){next.fluidEdits={...(current.fluidEdits||{})};next.fluidActive=[...(current.fluidActive||[])];enqueueFluidAround(next,x,y,z);}
 return {next};
}
function solidForBody(world,x,y,z){
 for(const oy of [.1,.9,PLAYER_HEIGHT-.08])for(const ox of [-PLAYER_HALF_WIDTH,PLAYER_HALF_WIDTH])for(const oz of [-.19,.19])if(block(world,Math.floor(x+ox),Math.floor(y+oy),Math.floor(z+oz)))return true;
 const trees=world.worldGenVersion?[...(world.trees||[]),...nearbyNaturalTrees(world,x,z)]:world.trees||[];
 for(const tree of trees)if(tree&&tree.stage>=3&&!tree.harvested&&!(world.harvestedTrees||[]).includes(tree.id)){
  const centerX=tree.x+.5,centerZ=tree.z+.5,trunkRadius=(tree.trunkWidth||.62)/2;
  if(Math.abs(x-centerX)<trunkRadius+PLAYER_HALF_WIDTH&&Math.abs(z-centerZ)<trunkRadius+.19&&y<(tree.y||0)+(tree.height||2.4)&&y+PLAYER_HEIGHT>(tree.y||0))return true;
 }
 const height={t1_bench:1.25,workbench:1.25,drill:.95,conveyor:.55,smelter:1.6};
 return world.machines.some(m=>Math.abs(x-(m.x+.5))<.45+PLAYER_HALF_WIDTH&&Math.abs(z-(m.z+.5))<.45+.19&&y<m.y+(height[m.type]||1)&&y+PLAYER_HEIGHT>m.y);
}
function playerImmersed(world,p){
 if(!(world?.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return false;
 const x=Math.floor(p.x),z=Math.floor(p.z);
 return [p.y+.1,p.y+.9,p.y+1.7].some(y=>waterLevelAt(world,x,Math.floor(y),z)>0);
}
function playerSubmergedFraction(world,p){
 if(!(world?.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return 0;
 const x=Math.floor(p.x),z=Math.floor(p.z),samples=[.12,.46,.8,1.14,1.48,1.72];let submerged=0;
 for(const offset of samples){const y=p.y+offset,cellY=Math.floor(y),level=waterLevelAt(world,x,cellY,z);if(level>0&&y<cellY+level/8)submerged++;}
 return submerged/samples.length;
}
function stepPlayer(session,input){
 const p=session.player,now=Date.now(),dt=Math.min(.1,Math.max(.001,(now-p.lastAt)/1000));p.lastAt=now;
 let dx=Number(input?.x),dz=Number(input?.z);if(!Number.isFinite(dx)||!Number.isFinite(dz))return false;
 const length=Math.hypot(dx,dz);if(length>1){dx/=length;dz/=length;}
 const hub=session.world.location.worldId==='shop-hub',physicsWorld=hub?{islandSize:SHOP_HUB_LAYOUT.size.x,edits:{},machines:[]}:session.world;
 const collides=(x,y,z)=>hub?((solidForBody(physicsWorld,x,y,z)&&x+PLAYER_HALF_WIDTH>SHOP_HUB_LAYOUT.floor.minX&&x-PLAYER_HALF_WIDTH<SHOP_HUB_LAYOUT.floor.maxX+1&&z+PLAYER_HALF_WIDTH>SHOP_HUB_LAYOUT.floor.minZ&&z-PLAYER_HALF_WIDTH<SHOP_HUB_LAYOUT.floor.maxZ+1)||SHOP_HUB_LAYOUT.npcs.some(n=>Math.abs(x-(n.x+.5))<.45+PLAYER_HALF_WIDTH&&Math.abs(z-(n.z+.5))<.34+.19&&y<n.y+2.05&&y+PLAYER_HEIGHT>n.y)):solidForBody(physicsWorld,x,y,z);
 let immersed=playerImmersed(physicsWorld,p);const moveSpeed=immersed?2.65:MOVE_SPEED;
 const nextX=p.x+dx*moveSpeed*dt,nextZ=p.z+dz*moveSpeed*dt;
 if(!collides(nextX,p.y,p.z))p.x=nextX;
 if(!collides(p.x,p.y,nextZ))p.z=nextZ;
 if(hub){const edgeX=SHOP_HUB_LAYOUT.size.x/2-.45,edgeZ=SHOP_HUB_LAYOUT.size.z/2-.45;p.x=Math.max(-edgeX,Math.min(edgeX,p.x));p.z=Math.max(-edgeZ,Math.min(edgeZ,p.z));}
 if(input.jump===true&&p.grounded){p.vy=JUMP_SPEED;p.grounded=false;}
 immersed=playerImmersed(physicsWorld,p);
 const oldY=p.y;
 if(immersed){
  const submerged=playerSubmergedFraction(physicsWorld,p),buoyancy=GRAVITY*Math.min(1,submerged*1.18);
  p.vy+=(-GRAVITY+buoyancy)*dt;
  p.vy*=Math.exp(-2.4*dt);
  if(input.swim===true)p.vy=Math.min(4.2,p.vy+5.8*dt);
  if(input.dive===true)p.vy=Math.max(-4.2,p.vy-7.5*dt);
  p.vy=Math.max(-4.2,Math.min(4.2,p.vy));
 }else p.vy=Math.max(-19,p.vy-GRAVITY*dt);
 const nextY=oldY+p.vy*dt;
 if(p.vy<=0){const bx=Math.floor(p.x),bz=Math.floor(p.z),by=Math.floor(nextY-.03);
  if(oldY>=by+.9&&block(physicsWorld,bx,by,bz)&&nextY<=by+1){p.y=by+1;p.vy=0;p.grounded=true;}
  else{p.y=nextY;p.grounded=false;}
 }else{
  const headCell=Math.floor(nextY+PLAYER_HEIGHT),feetCell=Math.floor(nextY+.1);
  if(block(physicsWorld,Math.floor(p.x),headCell,Math.floor(p.z))){p.y=headCell-PLAYER_HEIGHT;p.vy=0;p.grounded=false;}
  else if(block(physicsWorld,Math.floor(p.x),feetCell,Math.floor(p.z))){p.y=feetCell+1;p.vy=0;p.grounded=true;}
  else{p.y=nextY;p.grounded=false;}
 }
 if(p.y < (physicsWorld.worldGenVersion?WORLD_MIN_Y:-13)){const spawn=hub?SHOP_HUB_LAYOUT.spawn:{x:.5,y:session.world.worldGenVersion?surfaceAt(session.world,0,0):0,z:.5};p.x=spawn.x;p.y=spawn.y;p.z=spawn.z;p.vy=0;p.grounded=true;}
 p.immersed=playerImmersed(physicsWorld,p);p.swimming=p.immersed&&(input.swim===true||p.vy>0);
 const savedPosition={x:p.x,y:p.y,z:p.z,grounded:p.grounded};
 if(hub)session.world.location.hubPlayer=savedPosition;else session.world.player=savedPosition;
 return true;
}
function publicWorld(session,id,req){
 const w=session.world,hub=w.location.worldId==='shop-hub';
 const player={...session.player,immersed:playerImmersed(w,session.player),swimming:session.player.swimming===true};
 let result;
 if(hub)result={schema:w.schema,worldVersion:w.worldVersion,islandSize:SHOP_HUB_LAYOUT.size.x,revision:w.revision,coins:w.coins,inventory:w.inventory,edits:{},machines:[],trees:[],harvestedTrees:[],tilled:[],crops:[],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],player,worldId:SHOP_HUB_WORLD_ID,worldInstanceId:w.location.hubInstanceId,worldKind:'shopHub',hub:createShopHubInstance(id)};
 else if(w.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION){const {fluidEdits,fluidActive,...publicSave}=w;result={...publicSave,fluidCells:fluidCellsNear(w,session.player.x,session.player.z),player,worldId:'personal-island',worldInstanceId:w.location.personalInstanceId,worldKind:'personal',personalPortal:{...PERSONAL_ISLAND_PORTAL,y:surfaceAt(w,PERSONAL_ISLAND_PORTAL.x,PERSONAL_ISLAND_PORTAL.z)}};}
 else result={...w,player,worldId:'personal-island',worldInstanceId:w.location.personalInstanceId,worldKind:'personal',personalPortal:{...PERSONAL_ISLAND_PORTAL,y:surfaceAt(w,PERSONAL_ISLAND_PORTAL.x,PERSONAL_ISLAND_PORTAL.z)}};
 if(devtoolsEnabled&&localAddress(req)){const snapshot=session.gameClock.snapshot();result.devtoolsEnabled=true;result.gameClock={...snapshot,gameMinutes:snapshot.gameTimeMinutes};result.biome=w.worldGenVersion&&w.location.worldId!=='shop-hub'?biomeForWorld(w,Math.floor(session.player.x),Math.floor(session.player.z)):null;result.devTeleport={previousAvailable:devTeleportService?.hasPrevious(session)===true,waterSafety:w.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION?'modeled':'not-modeled'};if(w.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION)result.fluidTickRate=w.fluidTickRate;}
 return result;
}
function near(session,target,radius){const p=session.player;return Math.hypot(target.x+.5-p.x,target.y-(p.y+1),target.z+.5-p.z)<=radius;}
async function handler(req,res){
 if(req.method==='GET'&&allowedFiles.has(new URL(req.url,'http://localhost').pathname)){
  const file=allowedFiles.get(new URL(req.url,'http://localhost').pathname);
  try{const bytes=await readFile(join(ROOT,file));res.writeHead(200,{'Content-Type':mime[extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(bytes);}catch{error(res,404,'Not found');}return;
 }
 const requestPath=new URL(req.url,'http://localhost').pathname;
 if(devFiles.has(requestPath)){
  if(req.method!=='GET'){error(res,405,'Method not allowed');return;}
  if(!devtoolsEnabled||!localAddress(req)){error(res,404,'Not found');return;}
  try{const file=devFiles.get(requestPath),bytes=await readFile(join(ROOT,file));res.writeHead(200,{'Content-Type':extname(file)==='.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(bytes);}catch{error(res,404,'Not found');}return;
 }
 if(!['GET','POST'].includes(req.method)){error(res,405,'Method not allowed');return;}
 const path=requestPath;
 const devTimePath=path==='/api/dev/time',devBiomesPath=path==='/api/dev/biomes',devFluidRatePath=path==='/api/dev/fluid-rate';
 const devTeleportPath=path==='/api/dev/teleport',devTeleportReturnPath=path==='/api/dev/teleport/return';
 if((devTimePath||devBiomesPath||devFluidRatePath||devTeleportPath||devTeleportReturnPath)&&(!devtoolsEnabled||!localAddress(req)||((devTeleportPath||devTeleportReturnPath)&&!devTeleportService))){error(res,404,'Not found');return;}
 const hubPaths=['/api/world/transition','/api/shop/open','/api/shop/trade','/api/inventory/drop','/api/npc/attack','/api/items/pickup'];
 if(path!=='/api/world'&&path!=='/api/action'&&path!=='/api/mine'&&path!=='/api/move'&&path!=='/api/harvest'&&path!=='/api/farm'&&path!=='/api/slot'&&path!=='/api/craft'&&path!=='/api/machine/place'&&!hubPaths.includes(path)&&!devTimePath&&!devBiomesPath&&!devFluidRatePath&&!devTeleportPath&&!devTeleportReturnPath){error(res,404,'Not found');return;}
 // Cross-origin browser actions should not mutate a player's island.
 const origin=req.headers.origin;if(origin&&origin!== 'http://'+req.headers.host && origin!=='https://'+req.headers.host){error(res,403,'Origin denied');return;}
 const who=identity(req);
 if(who.isNew)res.setHeader('Set-Cookie','terra_session='+cookieValue(who.id)+'; HttpOnly; SameSite=Lax; Path=/'+(req.socket.encrypted?'; Secure':''));
 const session=await load(who.id);
 if(!devTimePath||req.method==='GET')await devtimeQueue;
 if(devTimePath){
  if(req.method==='GET'){const changed=advanceSessionTime(session);if(changed)await save(who.id,session.world);const snapshot=session.gameClock.snapshot();send(res,200,{gameClock:{...snapshot,gameMinutes:snapshot.gameTimeMinutes}});return;}
  const body=await jsonBody(req),nextMultiplier=body?.multiplier;
  if(!devClockModule.DEV_TIME_MULTIPLIERS.includes(nextMultiplier)){const snapshot=session.gameClock.snapshot();send(res,400,{error:'Unsupported developer time multiplier',gameClock:{...snapshot,gameMinutes:snapshot.gameTimeMinutes}});return;}
  const job=devtimeQueue.catch(()=>{}).then(async()=>{
   const now=Date.now(),oldMultiplier=developerMultiplier;developerMultiplier=nextMultiplier;
   await Promise.all([...sessions.entries()].map(([id,active])=>{
    const settle=active.queue.catch(()=>{}).then(async()=>{
     advanceSessionTime(active,now,oldMultiplier);
     active.gameClock.setMultiplier(nextMultiplier,now);
     await save(id,active.world);
    });active.queue=settle;return settle;
   }));
   const snapshot=session.gameClock.snapshot();return {gameClock:{...snapshot,gameMinutes:snapshot.gameTimeMinutes}};
  });devtimeQueue=job.then(()=>undefined,()=>undefined);
  try{send(res,200,await job);}catch(err){console.error('Developer clock update failed:',err);error(res,500,'Unable to update developer clock');}return;
 }
 if(devBiomesPath){
  if(req.method!=='GET'){error(res,405,'Method not allowed');return;}
  if(!(session.world.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return send(res,409,{error:'Five-biome search requires an open world'});
  const seed=session.world.worldSeed;let biomes=biomeSamplesCache.get(seed);
  if(!biomes){biomes=findBiomeSamples(seed,{min:-2048,max:2048,step:16});biomeSamplesCache.set(seed,biomes);if(biomeSamplesCache.size>32)biomeSamplesCache.delete(biomeSamplesCache.keys().next().value);}
  send(res,200,{seed,genVersion:WORLD_GEN_VERSION,range:{minX:-2048,maxX:2048,minZ:-2048,maxZ:2048,step:16},biomes});return;
 }
 if(devFluidRatePath){
  if(req.method!=='POST'){error(res,405,'Method not allowed');return;}
  if(!(session.world.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION))return send(res,409,{error:'Fluid rate requires an open world'});
  const body=await jsonBody(req);if(![2,5,10].includes(body?.tickRate))return send(res,400,{error:'tickRate must be 2, 5, or 10'});
  session.world.fluidTickRate=body.tickRate;session.world.revision++;session.world.updatedAt=Date.now();await save(who.id,session.world);send(res,200,{tickRate:session.world.fluidTickRate,world:publicWorld(session,who.id,req)});return;
 }
 if(devTeleportPath||devTeleportReturnPath){
  if(req.method!=='POST'){error(res,405,'Method not allowed');return;}
  const body=devTeleportPath?await jsonBody(req):{};
  const job=session.queue.catch(()=>{}).then(async()=>{
   const world=session.world,previousPlayer=session.player,previousSaved=world.player;
   const outcome=devTeleportPath?devTeleportService.resolve(world,previousPlayer,body):devTeleportService.returnToPrevious(session,world,previousPlayer);
   if(!outcome.ok){
    const reason=outcome.reason||'순간이동을 완료하지 못했습니다.';
    console.info(JSON.stringify({event:'dev-teleport',worldSeed:world.worldSeed??null,worldGenVersion:world.worldGenVersion??null,from:{x:previousPlayer.x,y:previousPlayer.y,z:previousPlayer.z},requested:{x:body.x,y:body.y,z:body.z,autoY:body.autoY===true},biome:world.worldGenVersion?biomeForWorld(world,Math.floor(previousPlayer.x),Math.floor(previousPlayer.z)):null,success:false,reason}));
    return {status:outcome.status||400,data:{error:reason,code:outcome.code||'teleport-failed',world:publicWorld(session,who.id,req),waterSafety:world.worldGenVersion>=PREVIOUS_WORLD_GEN_VERSION?'modeled':'not-modeled'}};
   }
   const now=Date.now(),nextPlayer={...outcome.player,vy:0,lastAt:now};
   session.player=nextPlayer;
   world.player={x:nextPlayer.x,y:nextPlayer.y,z:nextPlayer.z,grounded:nextPlayer.grounded===true};
   session.mining=null;session.harvesting=null;
   try{await save(who.id,world);session.lastPlayerSaveAt=now;}
   catch(err){session.player=previousPlayer;world.player=previousSaved;throw err;}
   if(devTeleportPath)devTeleportService.rememberPrevious(session,world,outcome.origin);
   else devTeleportService.clearPrevious(session);
   const data={world:publicWorld(session,who.id,req),player:{x:nextPlayer.x,y:nextPlayer.y,z:nextPlayer.z,grounded:nextPlayer.grounded},previousPosition:devTeleportPath?outcome.previousPosition:null,biome:outcome.biome,waterSafety:outcome.waterSafety};
   console.info(JSON.stringify({event:'dev-teleport',worldSeed:world.worldSeed??null,worldGenVersion:world.worldGenVersion??null,from:{x:previousPlayer.x,y:previousPlayer.y,z:previousPlayer.z},to:{x:nextPlayer.x,y:nextPlayer.y,z:nextPlayer.z},biome:outcome.biome,success:true,operation:devTeleportPath?'teleport':'return'}));
   return {status:200,data};
  });
  session.queue=job;
  try{const result=await job;send(res,result.status,result.data);}catch(err){console.error('Developer teleport failed:',err);error(res,500,'Unable to save teleport position');}
  return;
 }
 if(path==='/api/world/transition'&&req.method==='POST'){
  const body=await jsonBody(req),destination=body?.destination;
  const job=session.queue.catch(()=>{}).then(async()=>{
   const loc=session.world.location,wasHub=loc.worldId==='shop-hub';
   if(destination==='shopHub'&&!wasHub){const portal={...PERSONAL_ISLAND_PORTAL,y:surfaceAt(session.world,PERSONAL_ISLAND_PORTAL.x,PERSONAL_ISLAND_PORTAL.z)};if(!near(session,portal,PERSONAL_ISLAND_PORTAL.interactionRadius))return {status:400,data:{error:'Move closer to the shop portal'}};loc.personalSpawn={...session.world.player};loc.worldId='shop-hub';loc.hubInstanceId=createShopHubInstance(who.id).instanceId;loc.hubPlayer={...SHOP_HUB_LAYOUT.spawn,grounded:true};session.player={...loc.hubPlayer,vy:0,lastAt:Date.now()};}
   else if(destination==='personal'&&wasHub){const portal=SHOP_HUB_LAYOUT.portals.find(p=>p.direction==='toPersonal');if(!portal||!near(session,portal,3.5))return {status:400,data:{error:'Move closer to the return portal'}};loc.worldId='personal-island';session.player={...(loc.personalSpawn||session.world.player),vy:0,lastAt:Date.now()};}
   else return {status:409,data:{error:'Already in destination world'}};
   session.mining=null;session.harvesting=null;session.world.revision++;session.world.updatedAt=Date.now();await save(who.id,session.world);return {status:200,data:{world:publicWorld(session,who.id,req)}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/shop/open'&&req.method==='POST'){
  if(session.world.location.worldId!=='shop-hub'||!isWorldActionAllowed('shopHub','interact'))return error(res,403,'Shop interactions are only available in the shop hub');
  const npc=SHOP_HUB_LAYOUT.npcs.find(n=>n.id==='farmer');if(!npc||!near(session,npc,npc.interactionRadius))return error(res,400,'Move closer to the farmer');
  send(res,200,{coins:session.world.coins,catalog:SHOP_CATALOG,revision:session.world.revision,inventory:session.world.inventory});return;
 }
 if(path==='/api/shop/trade'&&req.method==='POST'){
  if(session.world.location.worldId!=='shop-hub'||!isWorldActionAllowed('shopHub','trade'))return error(res,403,'Trading is only available in the shop hub');
  const npc=SHOP_HUB_LAYOUT.npcs.find(n=>n.id==='farmer');if(!npc||!near(session,npc,npc.interactionRadius))return error(res,400,'Move closer to the farmer');const body=await jsonBody(req);
  const job=session.queue.catch(()=>{}).then(async()=>{const w=session.world;if(body?.revision!==w.revision)return {status:409,data:{error:'Revision conflict',world:publicWorld(session,who.id,req)}};
   const quantity=resolveShopQuantity({selection:body?.quantity,action:body?.action,item:body?.item,inventory:w.inventory,coins:w.coins});
   const trade=applyShopTrade({player:{coins:w.coins,inventory:w.inventory},action:body?.action,item:body?.item,quantity});if(!trade.ok)return {status:400,data:{error:trade.error,world:publicWorld(session,who.id,req)}};
   const next={...w,coins:trade.player.coins,inventory:trade.player.inventory,revision:w.revision+1,updatedAt:Date.now()};await save(who.id,next);session.world=next;return {status:200,data:{world:publicWorld(session,who.id,req),trade:{action:trade.action,item:trade.item,quantity:trade.quantity,total:trade.total,unitPrice:trade.unitPrice}}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(['/api/inventory/drop','/api/npc/attack','/api/items/pickup'].includes(path)&&req.method==='POST'&&session.world.location.worldId==='shop-hub')return error(res,403,'That action is forbidden in the protected shop hub');
 const capabilityByPath={'/api/action':'place','/api/mine':'mine','/api/harvest':'harvest','/api/farm':'farm','/api/slot':'equip','/api/craft':'build','/api/machine/place':'build','/api/inventory/drop':'drop','/api/items/pickup':'drop','/api/npc/attack':'combat'};
 if(session.world.location.worldId==='shop-hub'&&capabilityByPath[path]&& !isWorldActionAllowed('shopHub',capabilityByPath[path]))return error(res,403,'That action is disabled in the protected shop hub');
 if(path==='/api/slot'&&req.method==='POST'){const body=await jsonBody(req),slot=body?.selectedSlot??body?.slot;if(!Number.isInteger(slot)||slot<0||slot>7)return error(res,400,'Invalid quick slot');const quickSlots=[...session.world.inventory.quickSlots];if(typeof body?.item==='string'){const assignable=Object.hasOwn(session.world.inventory.tools||{},body.item)?(session.world.inventory.tools[body.item]>0):RESOURCE_KEYS.includes(body.item)&&(session.world.inventory[body.item]||0)>0;if(!assignable)return error(res,400,'Item is unavailable');quickSlots[slot]=body.item;}const item=quickSlots[slot],toolOwned=(session.world.inventory.tools?.[item]||0)>0,placeableOwned=['dirt','sand','coal_block'].includes(item)&&(session.world.inventory[item]||0)>0;if(item&&!toolOwned&&!placeableOwned)return error(res,400,'Item is unavailable');const next={...session.world,inventory:{...session.world.inventory,quickSlots,selectedSlot:slot},revision:session.world.revision+1,updatedAt:Date.now()};await save(who.id,next);session.world=next;send(res,200,{world:publicWorld(session,who.id,req)});return;}
 if(path==='/api/world'&&req.method==='GET'){
  const job=session.queue.catch(()=>{}).then(async()=>{
   const now=Date.now(),elapsed=Math.max(0,now-session.lastLogisticsAt);session.lastLogisticsAt=now;
   const changed=refreshOreNodes(session.world)|advanceSessionTime(session,now)|advanceItemLogistics(session.world,elapsed)|advanceWorldFluid(session,now);
   if(changed)await save(who.id,session.world);
   return publicWorld(session,who.id,req);
  });session.queue=job.then(()=>undefined,()=>undefined);try{send(res,200,await job);}catch(err){console.error('World update failed:',err);error(res,500,'Unable to update world');}return;
 }
 if(path==='/api/items/pickup'&&req.method==='POST'){
  const body=await jsonBody(req),job=session.queue.catch(()=>{}).then(async()=>{
   const w=session.world,id=body?.dropId,index=w.drops.findIndex(d=>d.id===id);
   if(!Number.isSafeInteger(body?.revision)||body.revision!==w.revision)return {status:409,data:{error:'Revision conflict',world:publicWorld(session,who.id,req)}};
   if(index<0)return {status:404,data:{error:'Item is no longer available',world:publicWorld(session,who.id,req)}};
   const drop=w.drops[index],p=session.player;
   if(Math.hypot(drop.x-p.x,drop.y-(p.y+1),drop.z-p.z)>2.35)return {status:400,data:{error:'Move closer to the item',world:publicWorld(session,who.id,req)}};
   const keyName=drop.item;
   if(!RESOURCE_KEYS.includes(keyName))return {status:400,data:{error:'This item cannot be collected',world:publicWorld(session,who.id,req)}};
   if((w.inventory[keyName]||0)+drop.quantity>INVENTORY_CAP)return {status:400,data:{error:'Inventory full',world:publicWorld(session,who.id,req)}};
   if(WOOD_LOG_KEYS.includes(keyName)&&(w.inventory.wood||0)+drop.quantity>INVENTORY_CAP||SAPLING_KEYS.includes(keyName)&&(w.inventory.sapling||0)+drop.quantity>INVENTORY_CAP)return {status:400,data:{error:'Inventory full',world:publicWorld(session,who.id,req)}};
   const inventory={...w.inventory,[keyName]:(w.inventory[keyName]||0)+drop.quantity};
   if(WOOD_LOG_KEYS.includes(keyName))inventory.wood=(inventory.wood||0)+drop.quantity;
   if(SAPLING_KEYS.includes(keyName))inventory.sapling=(inventory.sapling||0)+drop.quantity;
   const next={...w,inventory,drops:w.drops.filter((_,i)=>i!==index),revision:w.revision+1,updatedAt:Date.now()};
   await save(who.id,next);session.world=next;return {status:200,data:{world:publicWorld(session,who.id,req),item:drop.item,quantity:drop.quantity}};
  });session.queue=job.then(()=>undefined,()=>undefined);try{const r=await job;send(res,r.status,r.data);}catch(err){console.error('Item pickup failed:',err);error(res,500,'Unable to collect item');}return;
 }

 if(path==='/api/farm'&&req.method==='POST'){
  const body=await jsonBody(req),action=body?.action;const job=session.queue.catch(()=>{}).then(async()=>{
   const w=session.world;advanceSessionTime(session);const inv={...w.inventory,tools:{...w.inventory.tools},items:{...w.inventory.items}},p=session.player;
   if(!Number.isSafeInteger(body.revision)||body.revision!==w.revision)return {status:409,data:{error:'Revision conflict',world:w}};
   const point=([x,y,z])=>({x:x+.5,y:y+.5,z:z+.5});
   const validCell=Number.isInteger(body.x)&&Number.isInteger(body.y)&&Number.isInteger(body.z)&&inBounds(body.x,body.y,body.z,w);
   if(!validCell)return {status:400,data:{error:'Invalid coordinates',world:w}};
   const {x,y,z}=body,cell=key(x,y,z),near=point([x,y,z]);
   if(personalPortalCell(w,x,y,z))return {status:400,data:{error:'The portal area is protected',world:w}};
   if(Math.hypot(near.x-p.x,near.y-(p.y+1),near.z-p.z)>5.5)return {status:400,data:{error:'Target out of reach',world:w}};
   const next={...w,inventory:inv,tilled:[...w.tilled],crops:[...w.crops],watered:{...w.watered},trees:[...w.trees],revision:w.revision+1,updatedAt:Date.now()};
   if(action==='till'){
    if(body.tool!=='hoe'||!equipped(w.inventory,'hoe'))return {status:400,data:{error:'Equip a wooden hoe',world:w}};
    if(!['dirt','grass'].includes(block(w,x,y-1,z))||block(w,x,y,z)||w.tilled.some(c=>key(...c)===cell))return {status:400,data:{error:'Tile cannot be tilled',world:w}};
    next.tilled.push([x,y,z]);
   }else if(action==='plant'){
    if(!w.tilled.some(c=>key(...c)===cell))return {status:400,data:{error:'Wheat grows only on tilled soil',world:w}};
    if(w.crops.some(c=>c.x===x&&c.y===y&&c.z===z))return {status:400,data:{error:'Tile already has a crop',world:w}};
    let cropType;try{cropType=cropTypeOf({cropType:body.cropType??'wheat'});}catch{return {status:400,data:{error:'Unknown crop type',world:w}};}
    const seedItem=seedItemForCrop(cropType);if((inv[seedItem]||0)<1)return {status:400,data:{error:`No ${cropType} seeds`,world:w}};
    inv[seedItem]--;next.crops.push({id:randomBytes(8).toString('hex'),cropType,x,y,z,stage:1,progress:0,lastTick:Date.now()});
   }else if(action==='water'){
    if(body.tool!=='watering_can'||!equipped(w.inventory,'watering_can'))return {status:400,data:{error:'Equip a watering can',world:w}};
    if(!w.tilled.some(c=>key(...c)===cell))return {status:400,data:{error:'Select tilled soil',world:w}};
    if(inv.wateringCanUses<1)return {status:400,data:{error:'Watering can is empty',world:w}};
    inv.wateringCanUses--;next.watered[cell]=WATER_DURATION_MS;
   }else if(action==='refill'){
    if(body.tool!=='watering_can'||!equipped(w.inventory,'watering_can'))return {status:400,data:{error:'A watering can is required',world:w}};
    if(!w.waterSources.some(s=>Math.hypot(s.x+.5-p.x,s.y+.5-(p.y+1),s.z+.5-p.z)<=3))return {status:400,data:{error:'Move next to water',world:w}};
    inv.wateringCanUses=10;
   }else if(action==='harvest'||action==='scythe'){
    const scythe=action==='scythe'||body.tool==='scythe';if(scythe){if(!equipped(w.inventory,'scythe'))return {status:400,data:{error:'Equip a scythe',world:w}};}else if(body.tool&&body.tool!=='hand')return {status:400,data:{error:'Harvest by hand or use a scythe',world:w}};
    const candidates=w.crops.filter(c=>c.stage>=4&&!w.harvestedCrops.includes(c.id)&& (scythe?Math.abs(c.x-x)<=1&&Math.abs(c.y-y)<=1&&Math.abs(c.z-z)<=1:c.x===x&&c.y===y&&c.z===z));
    if(!candidates.length)return {status:400,data:{error:'No mature crop in range',world:w}};
    const rewards={};for(const crop of candidates){const yieldItems=harvestYield(cropTypeOf(crop));rewards[yieldItems.productItem]=(rewards[yieldItems.productItem]||0)+yieldItems.productQuantity;rewards[yieldItems.seedItem]=(rewards[yieldItems.seedItem]||0)+yieldItems.seedQuantity;}
    if(Object.entries(rewards).some(([item,count])=>(inv[item]||0)+count>INVENTORY_CAP))return {status:400,data:{error:'Inventory full',world:w}};
    next.harvestedCrops=[...w.harvestedCrops,...candidates.map(c=>c.id)];for(const [item,count]of Object.entries(rewards))inv[item]=(inv[item]||0)+count;next.crops=w.crops.filter(c=>!candidates.some(h=>h.id===c.id));
   }else if(action==='plant_tree'){
    const species=['oak','birch','rubber'].includes(body.species)?body.species:'oak';if((inv.sapling||0)<1)return {status:400,data:{error:'No saplings',world:w}};
    if(!['dirt','grass'].includes(block(w,x,y-1,z))||block(w,x,y,z))return {status:400,data:{error:'Plant on clear dirt or grass',world:w}};
    const newTreeRadius=treeDimensions(species,.5).crownWidth/2;
    const occupied=[...w.trees,...(w.worldGenVersion?nearbyNaturalTrees(w,x+.5,z+.5):[])].some(t=>!t.harvested&&!(w.harvestedTrees||[]).includes(t.id)&&Math.hypot(t.x-x,t.z-z)<newTreeRadius+(t.crownWidth||1.5)/2)||w.oreNodes.some(o=>Math.hypot(o.x-x,o.z-z)<.8)||w.machines.some(m=>Math.hypot(m.x-x,m.z-z)<.9)||w.waterSources.some(s=>Math.hypot(s.x-x,s.z-z)<.9)||w.crops.some(c=>Math.hypot(c.x-x,c.z-z)<.85)||Math.abs(p.x-(x+.5))<.7&&Math.abs(p.z-(z+.5))<.7;
    if(occupied)return {status:400,data:{error:'Space is occupied',world:w}};
    if(!consumeSapling(inv,species))return {status:400,data:{error:`No ${species} saplings`,world:w}};
    next.trees.push({id:randomBytes(8).toString('hex'),source:'planted',species,x,y,z,stage:0,progress:0,lastTick:Date.now(),harvested:false});
   }else return {status:400,data:{error:'Unknown farming action',world:w}};
   await save(who.id,next);session.world=next;return {status:200,data:{world:next,harvested:(action==='harvest'||action==='scythe')?next.harvestedCrops.length-w.harvestedCrops.length:undefined}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/move'&&req.method==='POST'){
  const body=await jsonBody(req);
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(!stepPlayer(session,body))return {status:400,data:{error:'Invalid movement input'}};const now=Date.now();advanceSessionTime(session,now);const fluidChanged=advanceWorldFluid(session,now);
   if(fluidChanged||now-session.lastPlayerSaveAt>=5000){try{await save(who.id,session.world);session.lastPlayerSaveAt=now;}catch(err){console.error('Player position save failed:',err);}}
   const world=publicWorld(session,who.id,req);return {status:200,data:{player:{x:session.player.x,y:session.player.y,z:session.player.z,grounded:session.player.grounded,immersed:playerImmersed(session.world,session.player),swimming:session.player.swimming===true},fluidCells:world.fluidCells||{},fluidRevision:world.fluidRevision||0}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/harvest'&&req.method==='POST'){
  const body=await jsonBody(req);
  if(body?.type==='cancel'){session.harvesting=null;send(res,200,{ok:true});return;}
  const resourceType=body?.resourceType||(body?.treeId?'tree':null),resourceId=body?.resourceId||body?.treeId,target=gatherTarget(session.world,resourceType,resourceId);
  if(body?.type==='start'){
   if(!target||gathered(session.world,resourceType,resourceId)){error(res,400,'Resource unavailable');return;}
   if(resourceType==='tree'&&(body.tool!=='wood_axe'||!equipped(session.world.inventory,'wood_axe'))){error(res,400,'A wooden axe is required');return;}
   const p=session.player;if(Math.hypot(target.x-p.x,target.y-(p.y+1),target.z-p.z)>5.5){error(res,400,'Resource out of reach');return;}
   session.harvesting={resourceType,resourceId,tool:body.tool,startedAt:Date.now()};send(res,200,{ok:true});return;
  }
  if(body?.type!=='collect'){error(res,400,'Unknown harvest action');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   const active=session.harvesting,type=active?.resourceType,id=active?.resourceId,point=gatherTarget(session.world,type,id),p=session.player;
   if(!point||!active||type!==resourceType||id!==resourceId||active.tool!==body.tool||Date.now()-active.startedAt<TREE_HARVEST_MS||gathered(session.world,type,id))return {status:400,data:{error:'Harvest not ready'}};
   if(type==='tree'&&(body.tool!=='wood_axe'||!equipped(session.world.inventory,'wood_axe')))return {status:400,data:{error:'A wooden axe is required'}};
   if(Math.hypot(point.x-p.x,point.y-(p.y+1),point.z-p.z)>5.5)return {status:400,data:{error:'Resource out of reach'}};
   const next={...session.world,inventory:{...session.world.inventory},revision:session.world.revision+1,updatedAt:Date.now()};
   let amount=1,rewards={};
   if(type==='tree'){
    const tree=treeById(session.world,id);if(!tree)return {status:400,data:{error:'Tree is unavailable'}};
    const species=['oak','birch','rubber'].includes(tree.species)?tree.species:'oak',logItem=TREE_LOGS[species],saplingItem=TREE_SAPLINGS[species];
    if(Number.isSafeInteger(tree.legacyYield)){amount=tree.legacyYield;rewards={wood:amount};}
    else{amount=2+randomInt(2);const saplingAmount=1+randomInt(2);rewards={wood:amount,[logItem]:amount,sapling:saplingAmount,[saplingItem]:saplingAmount,...(species==='rubber'?{rubber_sap:1}:{})};}
    if(Object.entries(rewards).some(([item,count])=>(next.inventory[item]||0)+count>INVENTORY_CAP))return {status:400,data:{error:'Inventory full'}};
    next.harvestedTrees=[...session.world.harvestedTrees,id];next.trees=next.trees.map(t=>t.id===id?{...t,harvested:true}:t);for(const [item,count]of Object.entries(rewards))next.inventory[item]=(next.inventory[item]||0)+count;
   }else{
    const crop=session.world.crops.find(c=>c.id===id);if(!crop||crop.stage<4)return {status:400,data:{error:'Crop is not mature'}};
    const yieldItems=harvestYield(cropTypeOf(crop));rewards={[yieldItems.productItem]:yieldItems.productQuantity,[yieldItems.seedItem]:yieldItems.seedQuantity};
    if(Object.entries(rewards).some(([item,count])=>(next.inventory[item]||0)+count>INVENTORY_CAP))return {status:400,data:{error:'Inventory full'}};
    next.harvestedCrops=[...session.world.harvestedCrops,id];next.crops=next.crops.filter(c=>c.id!==id);for(const [item,count]of Object.entries(rewards))next.inventory[item]=(next.inventory[item]||0)+count;
   }
   session.harvesting=null;await save(who.id,next);session.world=next;
   return {status:200,data:{world:session.world,yield:amount,resourceType:type,rewards}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/craft'&&req.method==='POST'){
  const body=await jsonBody(req),recipe=Object.hasOwn(RECIPES,body?.recipe)?RECIPES[body.recipe]:null;
  if(!recipe){error(res,400,'Unknown recipe');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(!Number.isSafeInteger(body.revision)||body.revision!==session.world.revision)return {status:409,data:{error:'Revision conflict',world:session.world}};
   if(body.recipe==='workbench'&&(session.world.machines.some(m=>m.type==='workbench')||session.world.inventory.items.workbench>0))return {status:400,data:{error:'Workbench already built',world:session.world}};
   if(recipe.station){
    const stationTypes=recipe.station==='agriculture_bench'?['agriculture_bench','farming_bench']:[recipe.station];
    const station=session.world.machines.find(m=>stationTypes.includes(m.type));
    const legacyT1Fallback=recipe.station==='t1_bench'&&session.world.worldVersion<2&&!station;
    if(!station&&!legacyT1Fallback)return {status:400,data:{error:'Required station is not placed',world:session.world}};
    if(station&&Math.hypot(station.x+.5-session.player.x,station.y+.6-(session.player.y+1),station.z+.5-session.player.z)>4.5)return {status:400,data:{error:'Move closer to the crafting station',world:session.world}};
   }
   if(Object.entries(recipe.cost).some(([resource,count])=>(session.world.inventory[resource]||0)<count))return {status:400,data:{error:'Missing crafting materials',world:session.world}};
   if(recipe.output&&recipe.output.quantity>INVENTORY_CAP-(session.world.inventory[recipe.output.item]||0))return {status:400,data:{error:'Inventory full',world:session.world}};
   const inventory={...session.world.inventory,items:{...session.world.inventory.items}},next={...session.world,inventory,revision:session.world.revision+1,updatedAt:Date.now()};
   for(const [resource,count] of Object.entries(recipe.cost)){if(resource==='wood')consumeWood(next.inventory,count);else next.inventory[resource]-=count;}
   if(recipe.tool){next.inventory.tools[body.recipe]=(next.inventory.tools[body.recipe]||0)+1;const free=next.inventory.quickSlots.findIndex((item,i)=>i>=3&&!item);if(free>=0)next.inventory.quickSlots[free]=body.recipe;}
   else if(recipe.output)next.inventory[recipe.output.item]=(next.inventory[recipe.output.item]||0)+recipe.output.quantity;else next.inventory.items[body.recipe]=(next.inventory.items[body.recipe]||0)+1;
   await save(who.id,next);session.world=next;return {status:200,data:{world:session.world}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/machine/place'&&req.method==='POST'){
  const body=await jsonBody(req),type=body?.type;
  if(!Object.hasOwn(RECIPES,type)||RECIPES[type].tool||!Number.isInteger(body?.x)||!Number.isInteger(body?.y)||!Number.isInteger(body?.z)||!Number.isInteger(body?.rotation)||body.rotation<0||body.rotation>3){error(res,400,'Invalid machine placement');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(!Number.isSafeInteger(body.revision)||body.revision!==session.world.revision)return {status:409,data:{error:'Revision conflict',world:session.world}};
   const {x,y,z}=body,p=session.player,center={x:x+.5,y:y+.5,z:z+.5};
   if(!inBounds(x,y,z,session.world)||personalPortalCell(session.world,x,y,z)||Math.hypot(center.x-p.x,center.y-(p.y+1),center.z-p.z)>5.5)return {status:400,data:{error:'Machine placement out of reach or reserved',world:session.world}};
   if(block(session.world,x,y,z)||!block(session.world,x,y-1,z))return {status:400,data:{error:'Machine needs a clear, supported tile',world:session.world}};
   if(session.world.machines.some(m=>m.x===x&&m.y===y&&m.z===z))return {status:400,data:{error:'Tile already occupied',world:session.world}};
   if(!session.world.inventory.items[type])return {status:400,data:{error:'No crafted machine in inventory',world:session.world}};
   if(Math.abs(center.x-p.x)<.65&&Math.abs(center.z-p.z)<.65&&center.y>=p.y&&center.y<=p.y+1.8)return {status:400,data:{error:'Cannot place machine inside player',world:session.world}};
   const inventory={...session.world.inventory,items:{...session.world.inventory.items}},next={...session.world,inventory,machines:[...session.world.machines],revision:session.world.revision+1,updatedAt:Date.now()};
   inventory.items[type]--;next.machines.push({id:randomBytes(8).toString('hex'),type,x,y,z,rotation:body.rotation});
   await save(who.id,next);session.world=next;return {status:200,data:{world:session.world}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/mine'&&req.method==='POST'){
  const body=await jsonBody(req);
  if(body?.type==='cancel'){session.mining=null;send(res,200,{ok:true});return;}
  if(body?.type!=='start'){error(res,400,'Invalid mining action');return;}
  const targetType=body.targetType||'block';let target,id;
  if(targetType==='ore'){
   if(refreshOreNodes(session.world))await save(who.id,session.world);
   if(body.revision!==session.world.revision){send(res,409,{error:'Revision conflict',world:session.world});return;}
   id=body.resourceId;const node=session.world.oreNodes.find(n=>n.id===id);
   if(body.tool!=='wood_pickaxe'||!equipped(session.world.inventory,'wood_pickaxe')){error(res,400,'A wooden pickaxe is required');return;}
   if(!node||node.remaining<1){error(res,400,'Stone vein is regenerating');return;}
   target={x:node.x+.5,y:node.y+.5,z:node.z+.5};
  }else{
   if(targetType!=='block'||!inBounds(body.x,body.y,body.z,session.world)){error(res,400,'Invalid mining target');return;}
   if(body.revision!==session.world.revision){send(res,409,{error:'Revision conflict',world:session.world});return;}
   const blockType=block(session.world,body.x,body.y,body.z);
   if(!blockType){error(res,400,'No block');return;}
   if(['dirt','grass','sand'].includes(blockType)){if(body.tool!=='wood_shovel'||!equipped(session.world.inventory,'wood_shovel')){error(res,400,'A wooden shovel is required');return;}}
   else if(mineralTier(blockType)!==null){if(!['wood_pickaxe','stone_pickaxe'].includes(body.tool)||!equipped(session.world.inventory,body.tool)){error(res,400,'Equip a pickaxe to mine this block');return;}if(!canMineMineral(blockType,body.tool)){error(res,400,'T1 stone pickaxe required for this ore');return;}}
   else{error(res,400,'This block cannot be mined');return;}
   target={x:body.x+.5,y:body.y+.5,z:body.z+.5};
  }
  const p=session.player;
  if(Math.hypot(target.x-p.x,target.y-(p.y+1),target.z-p.z)>5.5){error(res,400,'Target out of reach');return;}
  session.mining={targetType,cell:targetType==='block'?key(body.x,body.y,body.z):null,resourceId:id,revision:body.revision,tool:body.tool,startedAt:Date.now()};
  send(res,200,{ok:true});return;
 }
 if(path==='/api/action'&&req.method==='POST'){
  const body=await jsonBody(req);
  // Sequentialize writes per identity; concurrent requests cannot duplicate resources.
  const job=session.queue.catch(()=>{}).then(async()=>{
   const oreMine=body?.type==='mine'&&body.targetType==='ore';let center;
   if(oreMine){const node=session.world.oreNodes.find(n=>n.id===body.resourceId);if(!node)return {status:400,data:{error:'Unknown stone vein',world:session.world}};center={x:node.x+.5,y:node.y+.5,z:node.z+.5};}
   else{if(!inBounds(body?.x,body?.y,body?.z,session.world))return {status:400,data:{error:'Invalid coordinates',world:session.world}};center={x:body.x+.5,y:body.y+.5,z:body.z+.5};}
   const p=session.player;
   if(Math.hypot(center.x-p.x,center.y-(p.y+1),center.z-p.z)>5.5)return {status:400,data:{error:'Target out of reach',world:session.world}};
   if(body.type==='place'&&Math.abs(center.x-p.x)<.65&&Math.abs(center.z-p.z)<.65&&center.y>=p.y&&center.y<=p.y+1.8)return {status:400,data:{error:'Cannot place inside player',world:session.world}};
   if(body?.type==='mine'){
    const mining=session.mining;
    const matches=mining&&mining.targetType===(oreMine?'ore':'block')&&(oreMine?mining.resourceId===body.resourceId:mining.cell===key(body.x,body.y,body.z))&&mining.revision===body.revision&&mining.tool===body.tool;
    if(!matches){return {status:400,data:{error:'Mining was not started',world:session.world}};}
    if(Date.now()-mining.startedAt<MINING_DURATION_MS){return {status:400,data:{error:'Mining is not complete',world:session.world}};}
    if(oreMine){if(body.revision!==session.world.revision)return {status:409,data:{error:'Revision conflict',world:session.world}};if(body.tool!=='wood_pickaxe'||!equipped(session.world.inventory,'wood_pickaxe'))return {status:400,data:{error:'A wooden pickaxe is required',world:session.world}};refreshOreNodes(session.world);const outcome=mineOre(session.world,body.resourceId);if(outcome.error)return {status:400,data:{error:outcome.error,world:session.world}};session.mining=null;await save(who.id,outcome.next);session.world=outcome.next;return {status:200,data:{world:session.world}};}
    session.mining=null;
   }
   const outcome=change(session.world,body);
   if(outcome.error)return {status:outcome.conflict?409:400,data:{error:outcome.error,world:session.world}};
   await save(who.id,outcome.next);session.world=outcome.next;
   session.mining=null;
   return {status:200,data:{world:session.world}};
  });
  session.queue=job;
  const result=await job;send(res,result.status,result.data);return;
 }
 error(res,405,'Method not allowed');
}
const server=http.createServer((req,res)=>{handler(req,res).catch(err=>{console.error(err);if(!res.headersSent)error(res,err.status||500,err.status?err.message:'Server error');else res.destroy();});});
server.listen(PORT,HOST,()=>console.log('TERRA prototype server: http://'+HOST+':'+PORT));
