import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve, extname } from 'node:path';

const ROOT=resolve(process.cwd());
const SAVE_DIR=resolve(process.env.TERRA_SAVE_DIR || join(ROOT,'data','worlds'));
const PORT=Number(process.env.PORT || 3000);
const SECRET=process.env.TERRA_SESSION_SECRET || '';
if(SECRET.length<32) { console.error('Set TERRA_SESSION_SECRET (at least 32 characters).'); process.exit(1); }
const sessions=new Map();
const MINING_DURATION_MS=1200;
const PLAYER_HEIGHT=1.78,PLAYER_HALF_WIDTH=.34,MOVE_SPEED=4,GRAVITY=17,JUMP_SPEED=6.7;
const TREE_YIELD=14,WHEAT_YIELD=1,TREE_HARVEST_MS=1200,ORE_REGEN_MS=30000,ORE_CAPACITY=3;
const LEGACY_TREES=[{id:'oak_west',x:-5,y:0,z:-5,scale:1},{id:'oak_east',x:5,y:0,z:4,scale:.9}];
const RECIPES={
 workbench:{cost:{wood:8,dirt:6},station:'t1_bench'},
 drill:{cost:{wood:10,dirt:12},station:'workbench'},
 conveyor:{cost:{wood:4,dirt:5},station:'workbench'},
 smelter:{cost:{wood:6,dirt:10},station:'drill'}
};
const allowedFiles=new Map([['/','index.html'],['/index.html','index.html'],['/src/game.js','src/game.js']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const key=(x,y,z)=>[x,y,z].join(',');
const inBounds=(x,y,z)=>Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16;
const nativeBlock=(size,x,y,z)=>{const half=size/2;return x>=-half&&x<half&&z>=-half&&z<half&&y>=-3&&y<0?'dirt':null;};
function block(world,x,y,z){const k=key(x,y,z);return Object.hasOwn(world.edits,k)?world.edits[k]:nativeBlock(world.islandSize||16,x,y,z);}
function gatherTarget(world,type,id){
 if(type==='tree'){const item=world.trees.find(t=>t.id===id);return item?{x:item.x,y:item.y+1.7,z:item.z}:null;}
 if(type==='wheat'){const item=world.crops.find(c=>c.id===id);return item?{x:item.x+.5,y:item.y+.45,z:item.z+.5}:null;}
 return null;
}
function gathered(world,type,id){return type==='tree'?world.harvestedTrees.includes(id):type==='wheat'?world.harvestedCrops.includes(id):true;}
function refreshOreNodes(world){let changed=false;const now=Date.now();for(const node of world.oreNodes){if(node.remaining===0&&node.regenAt&&node.regenAt<=now){node.remaining=node.max||ORE_CAPACITY;node.regenAt=null;changed=true;}}return changed;}
function mineOre(world,id){
 const node=world.oreNodes.find(n=>n.id===id);if(!node||node.remaining<1)return {error:'Stone vein is exhausted'};
 const next={...world,inventory:{...world.inventory},oreNodes:world.oreNodes.map(n=>({...n})),revision:world.revision+1,updatedAt:Date.now()};
 const vein=next.oreNodes.find(n=>n.id===id);vein.remaining--;vein.regenAt=vein.remaining===0?Date.now()+ORE_REGEN_MS:null;next.inventory.stone++;
 return {next};
}
const starterTools={wood_pickaxe:1,wood_axe:1,wood_shovel:1};
const starterSlots=['wood_pickaxe','wood_axe','wood_shovel',null,null,null,null,null];
function fresh(){return {schema:1,worldVersion:2,islandSize:10,revision:0,inventory:{dirt:48,wood:0,stone:0,wheat:0,items:{workbench:0,drill:0,conveyor:0,smelter:0},tools:{...starterTools},quickSlots:[...starterSlots],selectedSlot:1},edits:{},machines:[{id:'t1-bench-start',type:'t1_bench',x:2,y:0,z:1,rotation:0}],trees:[{id:'oak_start',x:-3,y:0,z:-3,scale:1}],harvestedTrees:[],crops:[{id:'wheat_1',x:-4,y:0,z:3},{id:'wheat_2',x:-3,y:0,z:3},{id:'wheat_3',x:-2,y:0,z:3},{id:'wheat_4',x:-1,y:0,z:3},{id:'wheat_5',x:0,y:0,z:3}],harvestedCrops:[],oreNodes:[{id:'stone_vein_start',x:3,y:0,z:-3,remaining:ORE_CAPACITY,max:ORE_CAPACITY,regenAt:null}],player:{x:.5,y:0,z:.5,grounded:true},createdAt:Date.now(),updatedAt:Date.now()};}
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
 if(!Array.isArray(w.oreNodes))w.oreNodes=[];
 const session={world:w,queue:Promise.resolve(),mining:null,harvesting:null,player:{...w.player,vy:0,grounded:w.player.grounded===true,lastAt:Date.now()},lastPlayerSaveAt:Date.now()};sessions.set(id,session);return session;
}
async function save(id,w){await mkdir(SAVE_DIR,{recursive:true});const target=join(SAVE_DIR,id+'.json');const tmp=target+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(tmp,JSON.stringify(w));await rename(tmp,target);}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function error(res,status,message){send(res,status,{error:message});}
async function jsonBody(req){let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>4096)throw Object.assign(Error('Request too large'),{status:413});}try{return JSON.parse(body);}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
function change(current,action){const {type,x,y,z,revision}=action||{};
 if(!inBounds(x,y,z))return {error:'Invalid coordinates'};
 if(!Number.isSafeInteger(revision)||revision!==current.revision)return {error:'Revision conflict',conflict:true};
 const existing=block(current,x,y,z);
 if(type==='place'){
  if(existing)return {error:'Space is occupied'};
  if(current.inventory.dirt<1)return {error:'Not enough dirt'};
  if(![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>block(current,x+dx,y+dy,z+dz)))return {error:'Must attach to existing terrain'};
 }else if(type==='mine'){
  if(action.tool!=='wood_shovel')return {error:'A wooden shovel is required'};
  if(!existing)return {error:'No block'};
  if(current.inventory.dirt>=1000000)return {error:'Inventory full'};
 }else return {error:'Unknown action'};
 if(Object.keys(current.edits).length>=20000&&!Object.hasOwn(current.edits,key(x,y,z)))return {error:'World edit limit'};
 // Never mutate the persisted object before the save succeeds.
 const next={...current,edits:{...current.edits},inventory:{...current.inventory},revision:current.revision+1,updatedAt:Date.now()};
 const original=nativeBlock(current.islandSize||16,x,y,z),after=type==='place'?'dirt':null;
 if(after===original)delete next.edits[key(x,y,z)];else next.edits[key(x,y,z)]=after;
 next.inventory.dirt+=type==='place'?-1:1;
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
 const nextX=p.x+dx*MOVE_SPEED*dt,nextZ=p.z+dz*MOVE_SPEED*dt;
 if(!solidForBody(session.world,nextX,p.y,p.z))p.x=nextX;
 if(!solidForBody(session.world,p.x,p.y,nextZ))p.z=nextZ;
 if(input.jump===true&&p.grounded){p.vy=JUMP_SPEED;p.grounded=false;}
 const oldY=p.y;p.vy=Math.max(-19,p.vy-GRAVITY*dt);const nextY=oldY+p.vy*dt;
 if(p.vy<=0){const bx=Math.floor(p.x),bz=Math.floor(p.z),by=Math.floor(nextY-.03);
  if(oldY>=by+.9&&block(session.world,bx,by,bz)&&nextY<=by+1){p.y=by+1;p.vy=0;p.grounded=true;}
  else{p.y=nextY;p.grounded=false;}
 }else{p.y=nextY;p.grounded=false;}
 if(p.y < -13){p.x=.5;p.y=0;p.z=.5;p.vy=0;p.grounded=true;}
 session.world.player={x:p.x,y:p.y,z:p.z,grounded:p.grounded};
 return true;
}
async function handler(req,res){
 if(req.method==='GET'&&allowedFiles.has(new URL(req.url,'http://localhost').pathname)){
  const file=allowedFiles.get(new URL(req.url,'http://localhost').pathname);
  try{const bytes=await readFile(join(ROOT,file));res.writeHead(200,{'Content-Type':mime[extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(bytes);}catch{error(res,404,'Not found');}return;
 }
 if(!['GET','POST'].includes(req.method)){error(res,405,'Method not allowed');return;}
 const path=new URL(req.url,'http://localhost').pathname;
 if(path!=='/api/world'&&path!=='/api/action'&&path!=='/api/mine'&&path!=='/api/move'&&path!=='/api/harvest'&&path!=='/api/craft'&&path!=='/api/machine/place'){error(res,404,'Not found');return;}
 // Cross-origin browser actions should not mutate a player's island.
 const origin=req.headers.origin;if(origin&&origin!== 'http://'+req.headers.host && origin!=='https://'+req.headers.host){error(res,403,'Origin denied');return;}
 const who=identity(req);
 if(who.isNew)res.setHeader('Set-Cookie','terra_session='+cookieValue(who.id)+'; HttpOnly; SameSite=Lax; Path=/'+(req.socket.encrypted?'; Secure':''));
 const session=await load(who.id);
 if(path==='/api/world'&&req.method==='GET'){if(refreshOreNodes(session.world))await save(who.id,session.world);send(res,200,{...session.world,player:{x:session.player.x,y:session.player.y,z:session.player.z,grounded:session.player.grounded}});return;}
 if(path==='/api/move'&&req.method==='POST'){
  const body=await jsonBody(req);
  const job=session.queue.catch(()=>{}).then(async()=>{
   if(!stepPlayer(session,body))return {status:400,data:{error:'Invalid movement input'}};
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
   if(resourceType==='tree'&&(body.tool!=='wood_axe'||session.world.inventory.tools.wood_axe<1)){error(res,400,'A wooden axe is required');return;}
   const p=session.player;if(Math.hypot(target.x-p.x,target.y-(p.y+1),target.z-p.z)>5.5){error(res,400,'Resource out of reach');return;}
   session.harvesting={resourceType,resourceId,tool:body.tool,startedAt:Date.now()};send(res,200,{ok:true});return;
  }
  if(body?.type!=='collect'){error(res,400,'Unknown harvest action');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   const active=session.harvesting,type=active?.resourceType,id=active?.resourceId,point=gatherTarget(session.world,type,id),p=session.player;
   if(!point||!active||type!==resourceType||id!==resourceId||active.tool!==body.tool||Date.now()-active.startedAt<TREE_HARVEST_MS||gathered(session.world,type,id))return {status:400,data:{error:'Harvest not ready'}};
   if(type==='tree'&&(body.tool!=='wood_axe'||session.world.inventory.tools.wood_axe<1))return {status:400,data:{error:'A wooden axe is required'}};
   if(Math.hypot(point.x-p.x,point.y-(p.y+1),point.z-p.z)>5.5)return {status:400,data:{error:'Resource out of reach'}};
   const next={...session.world,inventory:{...session.world.inventory},revision:session.world.revision+1,updatedAt:Date.now()};
   const amount=type==='tree'?TREE_YIELD:WHEAT_YIELD;
   if(type==='tree'){next.harvestedTrees=[...session.world.harvestedTrees,id];next.inventory.wood+=amount;}
   else{next.harvestedCrops=[...session.world.harvestedCrops,id];next.inventory.wheat+=amount;}
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
   next.inventory.items[body.recipe]++;
   await save(who.id,next);session.world=next;return {status:200,data:{world:session.world}};
  });session.queue=job;const result=await job;send(res,result.status,result.data);return;
 }
 if(path==='/api/machine/place'&&req.method==='POST'){
  const body=await jsonBody(req),type=body?.type;
  if(!Object.hasOwn(RECIPES,type)||!Number.isInteger(body?.x)||!Number.isInteger(body?.y)||!Number.isInteger(body?.z)||!Number.isInteger(body?.rotation)||body.rotation<0||body.rotation>3){error(res,400,'Invalid machine placement');return;}
  const job=session.queue.catch(()=>{}).then(async()=>{
   const {x,y,z}=body,p=session.player,center={x:x+.5,y:y+.5,z:z+.5};
   if(!inBounds(x,y,z)||Math.hypot(center.x-p.x,center.y-(p.y+1),center.z-p.z)>5.5)return {status:400,data:{error:'Machine placement out of reach',world:session.world}};
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
   if(body.tool!=='wood_pickaxe'||session.world.inventory.tools.wood_pickaxe<1){error(res,400,'A wooden pickaxe is required');return;}
   if(!node||node.remaining<1){error(res,400,'Stone vein is regenerating');return;}
   target={x:node.x+.5,y:node.y+.5,z:node.z+.5};
  }else{
   if(targetType!=='block'||!inBounds(body.x,body.y,body.z)){error(res,400,'Invalid mining target');return;}
   if(body.revision!==session.world.revision){send(res,409,{error:'Revision conflict',world:session.world});return;}
   if(block(session.world,body.x,body.y,body.z)!=='dirt'){error(res,400,'No block');return;}
   if(body.tool!=='wood_shovel'||session.world.inventory.tools.wood_shovel<1){error(res,400,'A wooden shovel is required');return;}
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
    if(oreMine){if(body.revision!==session.world.revision)return {status:409,data:{error:'Revision conflict',world:session.world}};if(body.tool!=='wood_pickaxe'||session.world.inventory.tools.wood_pickaxe<1)return {status:400,data:{error:'A wooden pickaxe is required',world:session.world}};refreshOreNodes(session.world);const outcome=mineOre(session.world,body.resourceId);if(outcome.error)return {status:400,data:{error:outcome.error,world:session.world}};session.mining=null;await save(who.id,outcome.next);session.world=outcome.next;return {status:200,data:{world:session.world}};}
    if(body.tool!=='wood_shovel'||session.world.inventory.tools.wood_shovel<1)return {status:400,data:{error:'A wooden shovel is required',world:session.world}};
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
