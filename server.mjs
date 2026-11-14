import http from 'node:http';
import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { treeWoodYieldForRoll } from './src/farming-rules.mjs';
import { SHOP_HUB_LAYOUT, SHOP_HUB_WORLD_ID, PERSONAL_ISLAND_PORTAL, createShopHubInstance, isWorldActionAllowed } from './src/hub-world.mjs';
import { SHOP_CATALOG, resolveShopQuantity, applyShopTrade } from './src/economy-rules.mjs';

const ROOT=resolve(process.cwd());
const SAVE_DIR=resolve(process.env.TERRA_SAVE_DIR || join(ROOT,'data','worlds'));
const PORT=Number(process.env.PORT || 3000);
const SECRET=process.env.TERRA_SESSION_SECRET || '';
if(SECRET.length<32) { console.error('Set TERRA_SESSION_SECRET (at least 32 characters).'); process.exit(1); }
let devClockModule=null;
if(process.env.NODE_ENV==='development'){
 try{await access(join(ROOT,'devtools','index.mjs'));devClockModule=await import('./devtools/index.mjs');if(typeof devClockModule.createTimeControl!=='function')devClockModule=null;}
 catch{devClockModule=null;}
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
const RECIPES={
 workbench:{cost:{wood:8,dirt:6},station:'t1_bench'},
 farming_bench:{cost:{wood:2,stone:3},station:'t1_bench',item:true},
 hoe:{cost:{wood:2,stone:1},station:'farming_bench',tool:true},
 watering_can:{cost:{wood:2,stone:2},station:'farming_bench',tool:true},
 scythe:{cost:{wood:2,stone:3},station:'farming_bench',tool:true},
 drill:{cost:{wood:10,dirt:12},station:'workbench'},
 conveyor:{cost:{wood:4,dirt:5},station:'workbench'},
 smelter:{cost:{wood:6,dirt:10},station:'drill'}
};
const allowedFiles=new Map([['/','index.html'],['/index.html','index.html'],['/src/game.js','src/game.js'],['/src/farmer-npc.js','src/farmer-npc.js']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
const devFiles=new Map([['/devtools/time-control.js','devtools/time-control.js'],['/devtools/dev-panel.css','devtools/dev-panel.css']]);
const localAddress=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const key=(x,y,z)=>[x,y,z].join(',');
const inBounds=(x,y,z)=>Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16;
const nativeBlock=(size,x,y,z)=>{const half=size/2;return x>=-half&&x<half&&z>=-half&&z<half&&y>=-3&&y<0?'dirt':null;};
function block(world,x,y,z){const k=key(x,y,z);return Object.hasOwn(world.edits,k)?world.edits[k]:nativeBlock(world.islandSize||16,x,y,z);}
function personalPortalCell(x,y,z){return Math.abs(x-PERSONAL_ISLAND_PORTAL.x)<=1&&z===PERSONAL_ISLAND_PORTAL.z&&y>=0&&y<=2;}
function gatherTarget(world,type,id){
 if(type==='tree'){const item=world.trees.find(t=>t.id===id);return item&&item.stage>=3&&!item.harvested?{x:item.x,y:item.y+1.7,z:item.z}:null;}
 if(type==='wheat'){const item=world.crops.find(c=>c.id===id);return item&&item.stage>=4?{x:item.x+.5,y:item.y+.45,z:item.z+.5}:null;}
 return null;
}
function gathered(world,type,id){return type==='tree'?world.harvestedTrees.includes(id):type==='wheat'?world.harvestedCrops.includes(id):true;}
function equipped(inv,id){return !!id&&inv.quickSlots?.[inv.selectedSlot]===id&&(inv.tools?.[id]||0)>0;}
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
 for(const c of world.crops)if(c.stage<4&&gameDt){c.progress+=gameDt+(wetTime[key(c.x,c.y,c.z)]||0);while(c.progress>=WHEAT_STAGE_MS&&c.stage<4){c.progress-=WHEAT_STAGE_MS;c.stage++;}changed=true;}
 for(const t of world.trees)if(t.stage<3&&gameDt){t.progress+=gameDt;while(t.progress>=WHEAT_STAGE_MS*3&&t.stage<3){t.progress-=WHEAT_STAGE_MS*3;t.stage++;}changed=true;}
 return changed;
}
function refreshOreNodes(world){let changed=false;const now=Date.now();for(const node of world.oreNodes){if(node.remaining===0&&node.regenAt&&node.regenAt<=now){node.remaining=node.max||ORE_CAPACITY;node.regenAt=null;changed=true;}}return changed;}
function mineOre(world,id){
 const node=world.oreNodes.find(n=>n.id===id);if(!node||node.remaining<1)return {error:'Stone vein is exhausted'};
 const next={...world,inventory:{...world.inventory},oreNodes:world.oreNodes.map(n=>({...n})),revision:world.revision+1,updatedAt:Date.now()};
 const vein=next.oreNodes.find(n=>n.id===id);vein.remaining--;vein.regenAt=vein.remaining===0?Date.now()+ORE_REGEN_MS:null;next.inventory.stone++;
 return {next};
}
const starterTools={wood_pickaxe:1,wood_axe:1,wood_shovel:1};
const starterSlots=['wood_pickaxe','wood_axe','wood_shovel',null,null,null,null,null];
function fresh(){const now=Date.now();return {schema:1,worldVersion:3,islandSize:10,revision:0,coins:100,location:null,inventory:{dirt:48,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{workbench:0,farming_bench:0,drill:0,conveyor:0,smelter:0},tools:{...starterTools,hoe:0,watering_can:0,scythe:0},quickSlots:[...starterSlots],selectedSlot:1,wateringCanUses:10},edits:{},machines:[{id:'t1-bench-start',type:'t1_bench',x:2,y:0,z:1,rotation:0}],trees:[{id:'oak_start',x:-3,y:0,z:-3,scale:1,stage:3,progress:0,harvested:false}],harvestedTrees:[],tilled:[[-4,0,3],[-3,0,3],[-2,0,3],[-1,0,3],[0,0,3],[1,0,3],[2,0,3],[3,0,3],[4,0,3]],crops:[{id:'wheat_1',x:-4,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_2',x:-3,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_3',x:-2,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_4',x:-1,y:0,z:3,stage:4,progress:0,lastTick:now},{id:'wheat_5',x:0,y:0,z:3,stage:4,progress:0,lastTick:now}],watered:{},waterSources:[{x:4,y:0,z:4}],harvestedCrops:[],oreNodes:[{id:'stone_vein_start',x:3,y:0,z:-3,remaining:ORE_CAPACITY,max:ORE_CAPACITY,regenAt:null}],player:{x:.5,y:0,z:.5,grounded:true},createdAt:now,updatedAt:now};}
function validWorld(w){return w&&w.schema===1&&Number.isSafeInteger(w.revision)&&w.revision>=0&&w.inventory&&Number.isSafeInteger(w.inventory.dirt)&&w.inventory.dirt>=0&&w.inventory.dirt<=1000000&&w.edits&&typeof w.edits==='object'&&!Array.isArray(w.edits)&&Object.keys(w.edits).length<=20000;}
function validPlayerPosition(p){return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)&&Math.abs(p.x)<=64&&Math.abs(p.z)<=64&&p.y>=-13&&p.y<=18;}
function cookieValue(id){return id+'.'+createHmac('sha256',SECRET).update(id).digest('hex');}
function identity(req){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('terra_session='))?.slice(14);
 if(value){const [id,sig]=value.split('.');if(/^[a-f0-9]{32}$/.test(id)&&/^[a-f0-9]{64}$/.test(sig||'')){const expected=cookieValue(id).split('.')[1];if(timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return {id,isNew:false};}}
 return {id:randomBytes(16).toString('hex'),isNew:true};
}
async function load(id){if(sessions.has(id))return sessions.get(id);
 let w;try{w=JSON.parse(await readFile(join(SAVE_DIR,id+'.json'),'utf8'));if(!validWorld(w))throw Error('Invalid save');}
 catch(e){if(e.code!=='ENOENT')throw e;w=fresh();}
 if(!Number.isSafeInteger(w.islandSize))w.islandSize=16;
 if(!Number.isSafeInteger(w.worldVersion))w.worldVersion=w.islandSize===10?2:1;
 if(!validPlayerPosition(w.player))w.player={x:.5,y:0,z:.5,grounded:true};
 w.inventory.wood=Number.isSafeInteger(w.inventory.wood)&&w.inventory.wood>=0?w.inventory.wood:0;
 w.inventory.stone=Number.isSafeInteger(w.inventory.stone)&&w.inventory.stone>=0?w.inventory.stone:0;
 w.inventory.wheat=Number.isSafeInteger(w.inventory.wheat)&&w.inventory.wheat>=0?w.inventory.wheat:0;
 if(!w.inventory.items||typeof w.inventory.items!=='object'||Array.isArray(w.inventory.items))w.inventory.items={};
 for(const item of Object.keys(RECIPES))if(!Number.isSafeInteger(w.inventory.items[item])||w.inventory.items[item]<0)w.inventory.items[item]=0;
 if(!w.inventory.tools||typeof w.inventory.tools!=='object'||Array.isArray(w.inventory.tools))w.inventory.tools={...starterTools};
 if(!Array.isArray(w.inventory.quickSlots))w.inventory.quickSlots=[...starterSlots];
 while(w.inventory.quickSlots.length<8)w.inventory.quickSlots.push(null);
 w.inventory.quickSlots=w.inventory.quickSlots.slice(0,8);
 if(!Number.isInteger(w.inventory.selectedSlot)||w.inventory.selectedSlot<0||w.inventory.selectedSlot>7)w.inventory.selectedSlot=1;
 if(!Array.isArray(w.machines))w.machines=[];
 if(!Array.isArray(w.trees))w.trees=w.islandSize===16?LEGACY_TREES.map(t=>({...t})):[];
 if(!Array.isArray(w.harvestedTrees))w.harvestedTrees=[];
 if(!Array.isArray(w.crops))w.crops=[];
 if(!Array.isArray(w.harvestedCrops))w.harvestedCrops=[];
 if(!Array.isArray(w.tilled))w.tilled=[];if(!w.watered||typeof w.watered!=='object')w.watered={};
 w.lastGameTick=Date.now();for(const [tile,value] of Object.entries(w.watered))if(!Number.isFinite(value)||value<0)delete w.watered[tile];
 if(!Array.isArray(w.waterSources))w.waterSources=[];
 if(!Number.isSafeInteger(w.inventory.wheat_seed)||w.inventory.wheat_seed<0)w.inventory.wheat_seed=0;
 if(!Number.isSafeInteger(w.inventory.sapling)||w.inventory.sapling<0)w.inventory.sapling=0;
 if(!Number.isSafeInteger(w.inventory.wateringCanUses))w.inventory.wateringCanUses=10;
 if(!Number.isSafeInteger(w.coins)||w.coins<0||w.coins>1000000000)w.coins=100;
 for(const resource of ['wood','stone','wheat','wheat_seed','sapling'])if(!Number.isSafeInteger(w.inventory[resource])||w.inventory[resource]<0||w.inventory[resource]>INVENTORY_CAP)w.inventory[resource]=0;
 if(!w.location||typeof w.location!=='object'||Array.isArray(w.location))w.location={worldId:'personal-island',personalInstanceId:`terra:personal-island:private:${id}`};
 w.location.personalInstanceId=`terra:personal-island:private:${id}`;
 if(w.location.worldId!=='shop-hub')w.location.worldId='personal-island';
 if(w.location.worldId==='shop-hub'&&(!w.location.hubInstanceId||typeof w.location.hubInstanceId!=='string'))w.location.hubInstanceId=createShopHubInstance(id).instanceId;
 if(w.location.worldId==='shop-hub'&&(!validPlayerPosition(w.location.hubPlayer)||Math.abs(w.location.hubPlayer.x)>SHOP_HUB_LAYOUT.size.x/2||Math.abs(w.location.hubPlayer.z)>SHOP_HUB_LAYOUT.size.z/2))w.location.hubPlayer={...SHOP_HUB_LAYOUT.spawn,grounded:true};
 for(const t of ['hoe','watering_can','scythe'])if(!Number.isSafeInteger(w.inventory.tools[t]))w.inventory.tools[t]=0;
 if(!Array.isArray(w.inventory.quickSlots))w.inventory.quickSlots=[...starterSlots];while(w.inventory.quickSlots.length<8)w.inventory.quickSlots.push(null);
 const loadedAt=Date.now();for(const c of w.crops){if(!Number.isInteger(c.stage))c.stage=4;if(!Number.isFinite(c.progress))c.progress=0;c.lastTick=loadedAt;}
 for(const t of w.trees){if(!Number.isInteger(t.stage))t.stage=3;if(!Number.isFinite(t.progress))t.progress=0;t.lastTick=loadedAt;t.harvested=w.harvestedTrees.includes(t.id);}
 if(!Array.isArray(w.oreNodes))w.oreNodes=[];
 const sessionLoadedAt=Date.now();w.lastGameTick=sessionLoadedAt;for(const c of w.crops)c.lastTick=sessionLoadedAt;for(const t of w.trees)t.lastTick=sessionLoadedAt;
 const gameClock=devtoolsEnabled?devClockModule.createTimeControl({now:sessionLoadedAt}):null;
 if(gameClock&&developerMultiplier!==1)gameClock.setMultiplier(developerMultiplier,sessionLoadedAt);
 const activePlayer=w.location.worldId==='shop-hub'?w.location.hubPlayer:w.player;
 const session={world:w,queue:Promise.resolve(),mining:null,harvesting:null,gameClock,player:{...activePlayer,vy:0,grounded:activePlayer.grounded===true,lastAt:sessionLoadedAt},lastPlayerSaveAt:sessionLoadedAt};sessions.set(id,session);return session;
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
 if(!inBounds(x,y,z))return {error:'Invalid coordinates'};
 if(!Number.isSafeInteger(revision)||revision!==current.revision)return {error:'Revision conflict',conflict:true};
 if(type==='place'&&personalPortalCell(x,y,z))return {error:'The portal area is protected'};
 const existing=block(current,x,y,z);
 if(type==='place'){
  if(existing)return {error:'Space is occupied'};
  if(current.inventory.dirt<1)return {error:'Not enough dirt'};
  if(![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>block(current,x+dx,y+dy,z+dz)))return {error:'Must attach to existing terrain'};
 }else if(type==='mine'){
  if(action.tool!=='wood_shovel'||!equipped(current.inventory,'wood_shovel'))return {error:'A wooden shovel is required'};
  if(!existing)return {error:'No block'};
  if(current.inventory.dirt>=1000000)return {error:'Inventory full'};
 }else return {error:'Unknown action'};
 if(Object.keys(current.edits).length>=20000&&!Object.hasOwn(current.edits,key(x,y,z)))return {error:'World edit limit'};
 // Never mutate the persisted object before the save succeeds.
 const next={...current,edits:{...current.edits},inventory:{...current.inventory},tilled:[...current.tilled],crops:[...current.crops],watered:{...current.watered},revision:current.revision+1,updatedAt:Date.now()};
 const original=nativeBlock(current.islandSize||16,x,y,z),after=type==='place'?'dirt':null;
 if(after===original)delete next.edits[key(x,y,z)];else next.edits[key(x,y,z)]=after;
 next.inventory.dirt+=type==='place'?-1:1;
 if(type==='mine'&&y===-1){const surface=key(x,0,z);next.tilled=next.tilled.filter(c=>key(...c)!==surface);next.crops=next.crops.filter(c=>!(c.x===x&&c.y===0&&c.z===z));delete next.watered[surface];}
 return {next};
}
function solidForBody(world,x,y,z){
 for(const oy of [.1,.9,PLAYER_HEIGHT-.08])for(const ox of [-PLAYER_HALF_WIDTH,PLAYER_HALF_WIDTH])for(const oz of [-.19,.19])if(block(world,Math.floor(x+ox),Math.floor(y+oy),Math.floor(z+oz)))return true;
 const height={t1_bench:1.25,workbench:1.25,drill:.95,conveyor:.55,smelter:1.6};
 return world.machines.some(m=>Math.abs(x-(m.x+.5))<.45+PLAYER_HALF_WIDTH&&Math.abs(z-(m.z+.5))<.45+.19&&y<m.y+(height[m.type]||1)&&y+PLAYER_HEIGHT>m.y);
}
function stepPlayer(session,input){
 const p=session.player,now=Date.now(),dt=Math.min(.1,Math.max(.001,(now-p.lastAt)/1000));p.lastAt=now;
 let dx=Number(input?.x),dz=Number(input?.z);if(!Number.isFinite(dx)||!Number.isFinite(dz))return false;
 const length=Math.hypot(dx,dz);if(length>1){dx/=length;dz/=length;}
 const hub=session.world.location.worldId==='shop-hub',physicsWorld=hub?{islandSize:SHOP_HUB_LAYOUT.size.x,edits:{},machines:[]}:session.world;
 const collides=(x,y,z)=>solidForBody(physicsWorld,x,y,z)||(hub&&SHOP_HUB_LAYOUT.npcs.some(n=>Math.abs(x-(n.x+.5))<.45+PLAYER_HALF_WIDTH&&Math.abs(z-(n.z+.5))<.34+.19&&y<n.y+2.05&&y+PLAYER_HEIGHT>n.y));
 const nextX=p.x+dx*MOVE_SPEED*dt,nextZ=p.z+dz*MOVE_SPEED*dt;
 if(!collides(nextX,p.y,p.z))p.x=nextX;
 if(!collides(p.x,p.y,nextZ))p.z=nextZ;
 if(hub){const edge=SHOP_HUB_LAYOUT.size.x/2-.45;p.x=Math.max(-edge,Math.min(edge,p.x));p.z=Math.max(-edge,Math.min(edge,p.z));}
 if(input.jump===true&&p.grounded){p.vy=JUMP_SPEED;p.grounded=false;}
 const oldY=p.y;p.vy=Math.max(-19,p.vy-GRAVITY*dt);const nextY=oldY+p.vy*dt;
 if(p.vy<=0){const bx=Math.floor(p.x),bz=Math.floor(p.z),by=Math.floor(nextY-.03);
  if(oldY>=by+.9&&block(physicsWorld,bx,by,bz)&&nextY<=by+1){p.y=by+1;p.vy=0;p.grounded=true;}
  else{p.y=nextY;p.grounded=false;}
 }else{p.y=nextY;p.grounded=false;}
 if(p.y < -13){const spawn=hub?SHOP_HUB_LAYOUT.spawn:{x:.5,y:0,z:.5};p.x=spawn.x;p.y=spawn.y;p.z=spawn.z;p.vy=0;p.grounded=true;}
 const savedPosition={x:p.x,y:p.y,z:p.z,grounded:p.grounded};
 if(hub)session.world.location.hubPlayer=savedPosition;else session.world.player=savedPosition;
 return true;
}
function publicWorld(session,id,req){
 const w=session.world,hub=w.location.worldId==='shop-hub';
 const result=hub?{schema:w.schema,worldVersion:w.worldVersion,islandSize:SHOP_HUB_LAYOUT.size.x,revision:w.revision,coins:w.coins,inventory:w.inventory,edits:{},machines:[],trees:[],harvestedTrees:[],tilled:[],crops:[],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],player:{...session.player},worldId:SHOP_HUB_WORLD_ID,worldInstanceId:w.location.hubInstanceId,worldKind:'shopHub',hub:createShopHubInstance(id)}:{...w,worldId:'personal-island',worldInstanceId:w.location.personalInstanceId,worldKind:'personal',personalPortal:PERSONAL_ISLAND_PORTAL,player:{...session.player}};
 if(devtoolsEnabled&&localAddress(req)){const snapshot=session.gameClock.snapshot();result.devtoolsEnabled=true;result.gameClock={...snapshot,gameMinutes:snapshot.gameTimeMinutes};}
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
 const devTimePath=path==='/api/dev/time';
 if(devTimePath&&(!devtoolsEnabled||!localAddress(req))){error(res,404,'Not found');return;}
 const hubPaths=['/api/world/transition','/api/shop/open','/api/shop/trade','/api/inventory/drop','/api/npc/attack'];
 if(path!=='/api/world'&&path!=='/api/action'&&path!=='/api/mine'&&path!=='/api/move'&&path!=='/api/harvest'&&path!=='/api/farm'&&path!=='/api/slot'&&path!=='/api/craft'&&path!=='/api/machine/place'&&!hubPaths.includes(path)&&!devTimePath){error(res,404,'Not found');return;}
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
 if(path==='/api/world/transition'&&req.method==='POST'){
  const body=await jsonBody(req),destination=body?.destination;
  const job=session.queue.catch(()=>{}).then(async()=>{
   const loc=session.world.location,wasHub=loc.worldId==='shop-hub';
   if(destination==='shopHub'&&!wasHub){if(!near(session,PERSONAL_ISLAND_PORTAL,PERSONAL_ISLAND_PORTAL.interactionRadius))return {status:400,data:{error:'Move closer to the shop portal'}};loc.personalSpawn={...session.world.player};loc.worldId='shop-hub';loc.hubInstanceId=createShopHubInstance(who.id).instanceId;loc.hubPlayer={...SHOP_HUB_LAYOUT.spawn,grounded:true};session.player={...loc.hubPlayer,vy:0,lastAt:Date.now()};}
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
 if(['/api/inventory/drop','/api/npc/attack'].includes(path)&&req.method==='POST'&&session.world.location.worldId==='shop-hub')return error(res,403,'That action is forbidden in the protected shop hub');
 const capabilityByPath={'/api/action':'place','/api/mine':'mine','/api/harvest':'harvest','/api/farm':'farm','/api/slot':'equip','/api/craft':'build','/api/machine/place':'build','/api/inventory/drop':'drop','/api/npc/attack':'combat'};
 if(session.world.location.worldId==='shop-hub'&&capabilityByPath[path]&& !isWorldActionAllowed('shopHub',capabilityByPath[path]))return error(res,403,'That action is disabled in the protected shop hub');
 if(path==='/api/slot'&&req.method==='POST'){const body=await jsonBody(req);const slot=body?.selectedSlot??body?.slot;if(!Number.isInteger(slot)||slot<0||slot>7)return error(res,400,'Invalid quick slot');const item=session.world.inventory.quickSlots[slot];if(item&&!(session.world.inventory.tools?.[item]>0))return error(res,400,'Item is unavailable');const next={...session.world,inventory:{...session.world.inventory,selectedSlot:slot},revision:session.world.revision+1,updatedAt:Date.now()};await save(who.id,next);session.world=next;send(res,200,{world:publicWorld(session,who.id,req)});return;}
 if(path==='/api/world'&&req.method==='GET'){const now=Date.now(),changed=refreshOreNodes(session.world)|advanceSessionTime(session,now);if(changed)await save(who.id,session.world);send(res,200,publicWorld(session,who.id,req));return;}
 if(path==='/api/farm'&&req.method==='POST'){
  const body=await jsonBody(req),action=body?.action;const job=session.queue.catch(()=>{}).then(async()=>{
   const w=session.world;advanceSessionTime(session);const inv={...w.inventory,tools:{...w.inventory.tools},items:{...w.inventory.items}},p=session.player;
   if(!Number.isSafeInteger(body.revision)||body.revision!==w.revision)return {status:409,data:{error:'Revision conflict',world:w}};
   const point=([x,y,z])=>({x:x+.5,y:y+.5,z:z+.5});
   const validCell=Number.isInteger(body.x)&&Number.isInteger(body.y)&&Number.isInteger(body.z)&&inBounds(body.x,body.y,body.z);
   if(!validCell)return {status:400,data:{error:'Invalid coordinates',world:w}};
   const {x,y,z}=body,cell=key(x,y,z),near=point([x,y,z]);
   if(personalPortalCell(x,y,z))return {status:400,data:{error:'The portal area is protected',world:w}};
   if(Math.hypot(near.x-p.x,near.y-(p.y+1),near.z-p.z)>5.5)return {status:400,data:{error:'Target out of reach',world:w}};
   const next={...w,inventory:inv,tilled:[...w.tilled],crops:[...w.crops],watered:{...w.watered},trees:[...w.trees],revision:w.revision+1,updatedAt:Date.now()};
   if(action==='till'){
    if(body.tool!=='hoe'||!equipped(w.inventory,'hoe'))return {status:400,data:{error:'Equip a wooden hoe',world:w}};
    if(block(w,x,y-1,z)!=='dirt'||block(w,x,y,z)||w.tilled.some(c=>key(...c)===cell))return {status:400,data:{error:'Tile cannot be tilled',world:w}};
    next.tilled.push([x,y,z]);
   }else if(action==='plant'){
    if(!w.tilled.some(c=>key(...c)===cell))return {status:400,data:{error:'Wheat grows only on tilled soil',world:w}};
    if(w.crops.some(c=>c.x===x&&c.y===y&&c.z===z))return {status:400,data:{error:'Tile already has a crop',world:w}};
    if(inv.wheat_seed<1)return {status:400,data:{error:'No wheat seeds',world:w}};
    inv.wheat_seed--;next.crops.push({id:randomBytes(8).toString('hex'),x,y,z,stage:1,progress:0,lastTick:Date.now()});
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
    if(inv.wheat+candidates.length>INVENTORY_CAP||inv.wheat_seed+candidates.length>INVENTORY_CAP)return {status:400,data:{error:'Inventory full',world:w}};
    next.harvestedCrops=[...w.harvestedCrops,...candidates.map(c=>c.id)];inv.wheat+=candidates.length;inv.wheat_seed+=candidates.length;next.crops=w.crops.filter(c=>!candidates.some(h=>h.id===c.id));
   }else if(action==='plant_tree'){
    if((inv.sapling||0)<1)return {status:400,data:{error:'No saplings',world:w}};
    if(!['dirt','grass'].includes(block(w,x,y-1,z))||block(w,x,y,z))return {status:400,data:{error:'Plant on clear dirt or grass',world:w}};
    const occupied=w.trees.some(t=>!t.harvested&&Math.hypot(t.x-x,t.z-z)<1.2)||w.oreNodes.some(o=>Math.hypot(o.x-x,o.z-z)<.8)||w.machines.some(m=>Math.hypot(m.x-x,m.z-z)<.9)||w.waterSources.some(s=>Math.hypot(s.x-x,s.z-z)<.9)||w.crops.some(c=>Math.hypot(c.x-x,c.z-z)<.85)||Math.abs(p.x-(x+.5))<.7&&Math.abs(p.z-(z+.5))<.7;
    if(occupied)return {status:400,data:{error:'Space is occupied',world:w}};
    inv.sapling--;next.trees.push({id:randomBytes(8).toString('hex'),x,y,z,stage:0,progress:0,lastTick:Date.now(),harvested:false});
   }else return {status:400,data:{error:'Unknown farming action',world:w}};
   await save(who.id,next);session.world=next;return {status:200,data:{world:next,harvested:(action==='harvest'||action==='scythe')?next.harvestedCrops.length-w.harvestedCrops.length:undefined}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/move'&&req.method==='POST'){
  const body=await jsonBody(req);
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(!stepPlayer(session,body))return {status:400,data:{error:'Invalid movement input'}};advanceSessionTime(session);
   const now=Date.now();
   if(now-session.lastPlayerSaveAt>=5000){try{await save(who.id,session.world);session.lastPlayerSaveAt=now;}catch(err){console.error('Player position save failed:',err);}}
   return {status:200,data:{player:{x:session.player.x,y:session.player.y,z:session.player.z,grounded:session.player.grounded}}};
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
   let amount=1;
   if(type==='tree'){amount=treeWoodYieldForRoll(Math.random());if(session.world.inventory.wood+amount>INVENTORY_CAP||(session.world.inventory.sapling||0)>=INVENTORY_CAP)return {status:400,data:{error:'Inventory full'}};next.harvestedTrees=[...session.world.harvestedTrees,id];next.trees=next.trees.map(t=>t.id===id?{...t,harvested:true}:t);next.inventory.wood+=amount;next.inventory.sapling=(next.inventory.sapling||0)+1;}
   else{const crop=session.world.crops.find(c=>c.id===id);if(!crop||crop.stage<4)return {status:400,data:{error:'Wheat is not mature'}};next.harvestedCrops=[...session.world.harvestedCrops,id];next.crops=next.crops.filter(c=>c.id!==id);next.inventory.wheat+=1;next.inventory.wheat_seed=(next.inventory.wheat_seed||0)+1;}
   session.harvesting=null;await save(who.id,next);session.world=next;
   return {status:200,data:{world:session.world,yield:amount,resourceType:type}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/craft'&&req.method==='POST'){
  const body=await jsonBody(req),recipe=Object.hasOwn(RECIPES,body?.recipe)?RECIPES[body.recipe]:null;
  if(!recipe){error(res,400,'Unknown recipe');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(body.recipe==='workbench'&&(session.world.machines.some(m=>m.type==='workbench')||session.world.inventory.items.workbench>0))return {status:400,data:{error:'Workbench already built',world:session.world}};
   if(recipe.station){
    const station=session.world.machines.find(m=>m.type===recipe.station);
    const legacyT1Fallback=recipe.station==='t1_bench'&&session.world.worldVersion<2&&!station;
    if(!station&&!legacyT1Fallback)return {status:400,data:{error:'Required station is not placed',world:session.world}};
    if(station&&Math.hypot(station.x+.5-session.player.x,station.y+.6-(session.player.y+1),station.z+.5-session.player.z)>4.5)return {status:400,data:{error:'Move closer to the crafting station',world:session.world}};
   }
   if(Object.entries(recipe.cost).some(([resource,count])=>(session.world.inventory[resource]||0)<count))return {status:400,data:{error:'Missing crafting materials',world:session.world}};
   const inventory={...session.world.inventory,items:{...session.world.inventory.items}},next={...session.world,inventory,revision:session.world.revision+1,updatedAt:Date.now()};
   for(const [resource,count] of Object.entries(recipe.cost))next.inventory[resource]-=count;
   if(recipe.tool){next.inventory.tools[body.recipe]=(next.inventory.tools[body.recipe]||0)+1;const free=next.inventory.quickSlots.findIndex((item,i)=>i>=3&&!item);if(free>=0)next.inventory.quickSlots[free]=body.recipe;}
   else next.inventory.items[body.recipe]++;
   await save(who.id,next);session.world=next;return {status:200,data:{world:session.world}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/machine/place'&&req.method==='POST'){
  const body=await jsonBody(req),type=body?.type;
  if(!Object.hasOwn(RECIPES,type)||RECIPES[type].tool||!Number.isInteger(body?.x)||!Number.isInteger(body?.y)||!Number.isInteger(body?.z)||!Number.isInteger(body?.rotation)||body.rotation<0||body.rotation>3){error(res,400,'Invalid machine placement');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   const {x,y,z}=body,p=session.player,center={x:x+.5,y:y+.5,z:z+.5};
   if(!inBounds(x,y,z)||personalPortalCell(x,y,z)||Math.hypot(center.x-p.x,center.y-(p.y+1),center.z-p.z)>5.5)return {status:400,data:{error:'Machine placement out of reach or reserved',world:session.world}};
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
   if(targetType!=='block'||!inBounds(body.x,body.y,body.z)){error(res,400,'Invalid mining target');return;}
   if(body.revision!==session.world.revision){send(res,409,{error:'Revision conflict',world:session.world});return;}
   if(block(session.world,body.x,body.y,body.z)!=='dirt'){error(res,400,'No block');return;}
   if(body.tool!=='wood_shovel'||!equipped(session.world.inventory,'wood_shovel')){error(res,400,'A wooden shovel is required');return;}
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
   else{if(!inBounds(body?.x,body?.y,body?.z))return {status:400,data:{error:'Invalid coordinates',world:session.world}};center={x:body.x+.5,y:body.y+.5,z:body.z+.5};}
   const p=session.player;
   if(Math.hypot(center.x-p.x,center.y-(p.y+1),center.z-p.z)>5.5)return {status:400,data:{error:'Target out of reach',world:session.world}};
   if(body.type==='place'&&Math.abs(center.x-p.x)<.65&&Math.abs(center.z-p.z)<.65&&center.y>=p.y&&center.y<=p.y+1.8)return {status:400,data:{error:'Cannot place inside player',world:session.world}};
   if(body?.type==='mine'){
    const mining=session.mining;
    const matches=mining&&mining.targetType===(oreMine?'ore':'block')&&(oreMine?mining.resourceId===body.resourceId:mining.cell===key(body.x,body.y,body.z))&&mining.revision===body.revision&&mining.tool===body.tool;
    if(!matches){return {status:400,data:{error:'Mining was not started',world:session.world}};}
    if(Date.now()-mining.startedAt<MINING_DURATION_MS){return {status:400,data:{error:'Mining is not complete',world:session.world}};}
    if(oreMine){if(body.revision!==session.world.revision)return {status:409,data:{error:'Revision conflict',world:session.world}};if(body.tool!=='wood_pickaxe'||!equipped(session.world.inventory,'wood_pickaxe'))return {status:400,data:{error:'A wooden pickaxe is required',world:session.world}};refreshOreNodes(session.world);const outcome=mineOre(session.world,body.resourceId);if(outcome.error)return {status:400,data:{error:outcome.error,world:session.world}};session.mining=null;await save(who.id,outcome.next);session.world=outcome.next;return {status:200,data:{world:session.world}};}
    if(body.tool!=='wood_shovel'||!equipped(session.world.inventory,'wood_shovel'))return {status:400,data:{error:'A wooden shovel is required',world:session.world}};
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
server.listen(PORT,()=>console.log('TERRA prototype server: http://localhost:'+PORT));
