import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {isFarmTileWatered,treeWoodYieldForRoll} from '../src/farming-rules.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_game_1234567890';
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir,nodeEnv,virtualTime=false){const clock=join(root,'tests','fixtures','virtual-clock.mjs');const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret,...(nodeEnv?{NODE_ENV:nodeEnv}:{}),...(virtualTime?{NODE_OPTIONS:`--import=${pathToFileURL(clock).href}`,TERRA_VIRTUAL_TIME_STEP_MS:'100'}:{})},stdio:['ignore','pipe','pipe']});let stderr='';child.qaStderr=()=>stderr;child.stderr.on('data',b=>stderr+=b.toString());await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('server startup timed out: '+stderr)),5000);child.stdout.on('data',b=>{out+=b;if(out.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${stderr}`));});});return child;}
async function processRssKb(pid){try{const status=await readFile(`/proc/${pid}/status`,'utf8'),match=status.match(/^VmRSS:\s+(\d+)\s+kB/m);return match?Number(match[1]):null;}catch{return null;}}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function req(port,path,body,cookie){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cookie:r.headers.get('set-cookie'),body:await r.json()};}
async function freshWorld(){const dir=await mkdtemp(join(tmpdir(),'terra-farm-'));const port=await randomPort();const proc=await boot(port,dir);const r=await req(port,'/api/world');return {dir,port,proc,cookie:r.cookie.split(';')[0],world:r.body};}
async function preparedWorld(crops,options={}){const dir=await mkdtemp(join(tmpdir(),'terra-farm-fixture-'));const id='abcdef0123456789abcdef0123456789';const inventory={dirt:48,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{},tools:{wood_pickaxe:1,wood_axe:1,wood_shovel:1,hoe:1,scythe:1,watering_can:1},quickSlots:['wood_pickaxe','wood_axe','wood_shovel','hoe','watering_can','scythe',null,null],selectedSlot:5,wateringCanUses:10,...options.inventory};const world={schema:1,worldVersion:3,worldGenVersion:2,worldSeed:0x51a7,seaLevel:0,fluidRevision:0,fluidEdits:{},fluidActive:[],fluidTickRate:5,islandSize:10,revision:options.revision??0,coins:options.coins??100,inventory,edits:{},machines:[],trees:options.trees||[],harvestedTrees:[],tilled:options.tilled||crops.map(c=>[c.x,c.y,c.z]),crops:crops.map((c,i)=>({id:`crop_${i}`,stage:4,progress:0,lastTick:Date.now(),...c})),watered:options.watered||{},waterSources:options.waterSources||[],harvestedCrops:[],oreNodes:[],player:options.player||{x:.5,y:0,z:.5,grounded:true}};await writeFile(join(dir,id+'.json'),JSON.stringify(world));const port=await randomPort(),proc=await boot(port,dir,options.nodeEnv,options.virtualTime),sig=createHmac('sha256',secret).update(id).digest('hex');return {dir,port,proc,cookie:`terra_session=${id}.${sig}`,world,id};}
const farm=(port,cookie,action,x,y,z,tool,revision)=>req(port,'/api/farm',{action,x,y,z,tool,revision},cookie);

test('tree wood probability boundary is 70 percent for two and 30 percent for three',()=>{
 assert.equal(treeWoodYieldForRoll(0),2);assert.equal(treeWoodYieldForRoll(0.699999),2);
 assert.equal(treeWoodYieldForRoll(0.7),3);assert.equal(treeWoodYieldForRoll(0.999999),3);
 assert.throws(()=>treeWoodYieldForRoll(1),RangeError);
});

test('farm moisture is interpreted as positive remaining game milliseconds',async()=>{
 assert.equal(isFarmTileWatered(300000),true);assert.equal(isFarmTileWatered(1),true);
 for(const remaining of [0,-1,null,undefined,NaN,Infinity,'300000'])assert.equal(isFarmTileWatered(remaining),false);
 const client=await readFile(join(root,'src','game.js'),'utf8');
 assert.ok(client.includes("isFarmTileWatered(world.watered?.[[x,y,z].join(',')])"));
});

test('new island has the complete flat starter farm and persists a hand harvest',async()=>{
 const c=await freshWorld();try{
  const w=c.world;
  assert.equal(w.islandSize,10);assert.equal(w.worldVersion,3);
  assert.equal(w.trees.length,1);assert.equal(w.trees[0].stage,3);
  assert.equal(w.oreNodes.length,1);assert.equal(w.machines.filter(m=>m.type==='t1_bench').length,1);
  assert.equal(w.tilled.length,9);assert.equal(w.crops.length,5);assert.ok(w.crops.every(v=>v.stage===4));
  assert.deepEqual(w.inventory.quickSlots.slice(0,3),['wood_pickaxe','wood_axe','wood_shovel']);assert.equal(w.inventory.quickSlots.length,8);
  const crop=w.crops[0];const action=await farm(c.port,c.cookie,'harvest',crop.x,crop.y,crop.z,null,w.revision);
  assert.equal(action.status,200,action.body.error);assert.equal(action.body.world.inventory.wheat,1);assert.equal(action.body.world.inventory.wheat_seed,1);
  assert.equal(action.body.world.crops.some(v=>v.x===crop.x&&v.y===crop.y&&v.z===crop.z),false);
  assert.ok(action.body.world.tilled.some(v=>v[0]===crop.x&&v[1]===crop.y&&v[2]===crop.z));
  const duplicate=await farm(c.port,c.cookie,'harvest',crop.x,crop.y,crop.z,null,action.body.world.revision);assert.notEqual(duplicate.status,200);
  const persisted=await req(c.port,'/api/world',null,c.cookie);assert.equal(persisted.body.inventory.wheat,1);assert.equal(persisted.body.inventory.wheat_seed,1);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('planting requires a tilled tile, consumes one seed and rejects a duplicate crop',async()=>{
 const c=await freshWorld();try{
  const headers={Cookie:c.cookie};let w=c.world;
  let response=await farm(c.port,c.cookie,'plant',2,0,4,'hoe',w.revision);assert.notEqual(response.status,200);
  // The initial field has four empty plots. Obtain a seed from a mature starter crop.
  const crop=w.crops[0];response=await farm(c.port,c.cookie,'harvest',crop.x,crop.y,crop.z,null,w.revision);assert.equal(response.status,200,response.body.error);w=response.body.world;
  response=await farm(c.port,c.cookie,'plant',1,0,3,'hoe',w.revision);assert.equal(response.status,200,response.body.error);w=response.body.world;
  assert.equal(w.inventory.wheat_seed,0);assert.equal(w.crops.find(v=>v.x===1&&v.y===0&&v.z===3).stage,1);
  response=await farm(c.port,c.cookie,'plant',1,0,3,'hoe',w.revision);assert.notEqual(response.status,200);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('scythe harvest is a block-coordinate 3x3x3 cube and cannot duplicate rewards',async()=>{
 const coords=[];for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=2;z<=4;z++)coords.push({x,y,z});
 coords.push({x:2,y:0,z:3},{x:0,y:2,z:3},{x:0,y:0,z:5});
 const c=await preparedWorld(coords);try{
  const result=await farm(c.port,c.cookie,'scythe',0,0,3,'scythe',0);
  assert.equal(result.status,200,result.body.error);assert.equal(result.body.harvested,27);
  assert.equal(result.body.world.inventory.wheat,27);assert.equal(result.body.world.inventory.wheat_seed,27);
  assert.equal(result.body.world.crops.length,3); // out of cube stays untouched
  const duplicate=await farm(c.port,c.cookie,'scythe',0,0,3,'scythe',result.body.world.revision);
  assert.notEqual(duplicate.status,200);assert.equal(duplicate.body.world.inventory.wheat,27);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('scythe covers all 27 XYZ cells at signed/elevated boundaries and preserves immature and all 98 surrounding cells after reload',async()=>{
 const cases=[
  {center:{x:16,y:0,z:16},player:{x:16.5,y:0,z:16.5,grounded:true},immatureCenter:false},
  {center:{x:-16,y:1,z:-16},player:{x:-15.5,y:1,z:-15.5,grounded:true},immatureCenter:true}
 ];
 for(const scenario of cases){
  const {center}=scenario,crops=[];
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(let dz=-2;dz<=2;dz++){
   const inside=Math.abs(dx)<=1&&Math.abs(dy)<=1&&Math.abs(dz)<=1;
   const stage=inside&&scenario.immatureCenter&&dx===0&&dy===0&&dz===0?3:4;
   crops.push({id:`cell_${dx}_${dy}_${dz}`,x:center.x+dx,y:center.y+dy,z:center.z+dz,stage,progress:0});
  }
  const c=await preparedWorld(crops,{player:scenario.player});try{
   const before=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));
   const initial=await req(c.port,'/api/world',null,c.cookie);assert.equal(initial.body.crops.length,125);
   const result=await farm(c.port,c.cookie,'scythe',center.x,center.y,center.z,'scythe',initial.body.revision);
   const expected=27-(scenario.immatureCenter?1:0);assert.equal(result.status,200,result.body.error);assert.equal(result.body.harvested,expected);
   assert.equal(result.body.world.inventory.wheat,expected);assert.equal(result.body.world.inventory.wheat_seed,expected);
   const expectedRemaining=98+(scenario.immatureCenter?1:0);assert.equal(result.body.world.crops.length,expectedRemaining);
   const remainingIds=new Set(result.body.world.crops.map(crop=>crop.id));
   for(const crop of crops){const inside=Math.abs(crop.x-center.x)<=1&&Math.abs(crop.y-center.y)<=1&&Math.abs(crop.z-center.z)<=1;const shouldRemain=!inside||crop.stage<4;assert.equal(remainingIds.has(crop.id),shouldRemain,`XYZ boundary mismatch: ${crop.id}`);}
   const after=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));
   assert.equal(after.crops.length,expectedRemaining);assert.equal(after.harvestedCrops.length,expected);
   assert.equal(after.inventory.wheat-before.inventory.wheat,expected);assert.equal(after.inventory.wheat_seed-before.inventory.wheat_seed,expected);
   await stop(c.proc);c.proc=await boot(c.port,c.dir);
   let reloaded=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(reloaded.crops.length,expectedRemaining);assert.equal(reloaded.harvestedCrops.length,expected);assert.equal(reloaded.inventory.wheat,expected);assert.equal(reloaded.inventory.wheat_seed,expected);
   const replay=await farm(c.port,c.cookie,'scythe',center.x,center.y,center.z,'scythe',reloaded.revision);assert.equal(replay.status,400);assert.equal(replay.body.world.inventory.wheat,expected);assert.equal(replay.body.world.inventory.wheat_seed,expected);
  }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
 }
});

test('114 scythe retry and watering boundary requests preserve single rewards, charges, and saved timers',async()=>{
 const center={x:0,y:0,z:3},crops=[];
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(let dz=-2;dz<=2;dz++)crops.push({id:`stress_${dx}_${dy}_${dz}`,x:center.x+dx,y:center.y+dy,z:center.z+dz,stage:4,progress:0});
 const c=await preparedWorld(crops,{tilled:[[0,0,3]],waterSources:[{x:0,y:0,z:0}],inventory:{selectedSlot:5,wateringCanUses:10}});try{
  let operations=0,w=(await req(c.port,'/api/world',null,c.cookie)).body;operations++;
  const before=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8')),rssBefore=await processRssKb(c.proc.pid);
  let r=await farm(c.port,c.cookie,'scythe',0,0,3,'scythe',w.revision);operations++;
  assert.equal(r.status,200,r.body.error);assert.equal(r.body.harvested,27);w=r.body.world;
  const duplicates=await Promise.all(Array.from({length:40},()=>farm(c.port,c.cookie,'scythe',0,0,3,'scythe',0)));operations+=duplicates.length;
  assert.equal(duplicates.filter(v=>v.status===409).length,40);w=(await req(c.port,'/api/world',null,c.cookie)).body;operations++;
  assert.equal(w.inventory.wheat,27);assert.equal(w.inventory.wheat_seed,27);assert.equal(w.harvestedCrops.length,27);assert.equal(w.crops.length,98);
  r=await farm(c.port,c.cookie,'scythe',0,0,3,'scythe',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wheat,27);
  r=await req(c.port,'/api/slot',{selectedSlot:4},c.cookie);operations++;assert.equal(r.status,200);w=r.body.world;
  for(let i=0;i<20;i++){const x=i%2===0?-1:1,z=i%4<2?3:4;r=await farm(c.port,c.cookie,'water',x,0,z,'watering_can',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wateringCanUses,10);assert.equal(r.body.world.revision,w.revision);}
  for(let i=0;i<5;i++){r=await farm(c.port,c.cookie,'water',64,0,3,'watering_can',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wateringCanUses,10);}
  for(let i=0;i<20;i++){r=await farm(c.port,c.cookie,'water',0,0,3,'hoe',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wateringCanUses,10);assert.equal(r.body.world.revision,w.revision);}
  for(let i=0;i<10;i++){r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',w.revision);operations++;assert.equal(r.status,200,r.body.error);w=r.body.world;assert.equal(w.inventory.wateringCanUses,9-i);assert.ok(w.watered['0,0,3']>0&&w.watered['0,0,3']<=300000);}
  const fullRevision=w.revision;
  for(let i=0;i<10;i++){r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wateringCanUses,0);assert.equal(r.body.world.revision,fullRevision);}
  r=await farm(c.port,c.cookie,'refill',0,0,0,'watering_can',w.revision);operations++;assert.equal(r.status,200,r.body.error);w=r.body.world;assert.equal(w.inventory.wateringCanUses,10);
  r=await farm(c.port,c.cookie,'refill',0,0,0,'watering_can',w.revision);operations++;assert.equal(r.status,200,r.body.error);w=r.body.world;assert.equal(w.inventory.wateringCanUses,10,'refill must cap at ten');
  assert.ok(operations>=100,`edge operation count ${operations}`);
  const after=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));
  assert.equal(after.harvestedCrops.length-before.harvestedCrops.length,27);assert.equal(after.crops.length,98);
  assert.equal(after.inventory.wheat-before.inventory.wheat,27);assert.equal(after.inventory.wheat_seed-before.inventory.wheat_seed,27);
  assert.equal(after.inventory.wateringCanUses,10);assert.ok(after.watered['0,0,3']>0);
  const rssAfter=await processRssKb(c.proc.pid);assert.equal(c.proc.qaStderr(),'');
  await stop(c.proc);c.proc=await boot(c.port,c.dir);w=(await req(c.port,'/api/world',null,c.cookie)).body;operations++;
  assert.equal(w.crops.length,98);assert.equal(w.harvestedCrops.length,27);assert.equal(w.inventory.wheat,27);assert.equal(w.inventory.wheat_seed,27);assert.equal(w.inventory.wateringCanUses,10);assert.ok(w.watered['0,0,3']>0);
  r=await farm(c.port,c.cookie,'scythe',0,0,3,'scythe',w.revision);operations++;assert.equal(r.status,400);assert.equal(r.body.world.inventory.wheat,27);
  const afterRestart=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));assert.equal(afterRestart.harvestedCrops.length,27);assert.equal(afterRestart.inventory.wheat,27);assert.equal(afterRestart.inventory.wheat_seed,27);
  console.log(JSON.stringify({qa:'edge-boundaries',operations,scytheHarvested:27,outsideRetained:98,wheatDelta:after.inventory.wheat-before.inventory.wheat,seedDelta:after.inventory.wheat_seed-before.inventory.wheat_seed,rssBeforeKb:rssBefore,rssAfterKb:rssAfter,serverStderr:c.proc.qaStderr()}));
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('watering, tree harvest, and planting requests are validated server-side',async()=>{
 const c=await freshWorld();try{
  const h={Cookie:c.cookie};let w=c.world;
  let r=await farm(c.port,c.cookie,'water',-4,0,3,'watering_can',w.revision);assert.notEqual(r.status,200);
  // Harvest start/collect remains a server-timed interaction, with one randomized wood roll.
  r=await req(c.port,'/api/harvest',{type:'start',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);
  await new Promise(resolve=>setTimeout(resolve,1220));
  r=await req(c.port,'/api/harvest',{type:'collect',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);
  assert.ok([2,3].includes(r.body.world.inventory.wood));assert.ok([1,2].includes(r.body.world.inventory.sapling));assert.equal(r.body.world.inventory.oak_log,r.body.world.inventory.wood);assert.equal(r.body.world.inventory.oak_sapling,r.body.world.inventory.sapling);
  const duplicate=await req(c.port,'/api/harvest',{type:'start',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.notEqual(duplicate.status,200);
  const saplingBefore=r.body.world.inventory.sapling,typedSaplingBefore=r.body.world.inventory.oak_sapling;
  const sapling=await farm(c.port,c.cookie,'plant_tree',4,0,0,null,r.body.world.revision);assert.equal(sapling.status,200,sapling.body.error);assert.equal(sapling.body.world.inventory.sapling,saplingBefore-1);assert.equal(sapling.body.world.inventory.oak_sapling,typedSaplingBefore-1);assert.equal(sapling.body.world.trees.find(t=>t.x===4&&t.z===0).stage,0);
  const occupied=await farm(c.port,c.cookie,'plant_tree',4,0,0,null,sapling.body.world.revision);assert.notEqual(occupied.status,200);
  const bad=await farm(c.port,c.cookie,'plant',63,0,63,'hoe',r.body.world.revision);assert.notEqual(bad.status,200);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('water doubles active-session crop progress while restart time is excluded',async()=>{
 const c=await preparedWorld([{x:0,y:0,z:3,stage:1,progress:59980}]);try{
  let r=await req(c.port,'/api/slot',{selectedSlot:4},c.cookie);assert.equal(r.status,200,r.body.error);
  r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',r.body.world.revision);assert.equal(r.status,200,r.body.error);assert.equal(r.body.world.inventory.wateringCanUses,9);
  await new Promise(resolve=>setTimeout(resolve,30));
  r=await req(c.port,'/api/world',null,c.cookie);assert.equal(r.body.crops[0].stage,2,'watering should double progress enough to reach the next stage');
  const crop=r.body.crops[0];assert.ok(crop.progress<60000);
  await stop(c.proc);c.proc=await boot(c.port,c.dir);await new Promise(resolve=>setTimeout(resolve,40));
  r=await req(c.port,'/api/world',null,c.cookie);assert.equal(r.body.crops[0].stage,2,'time spent offline must not advance the crop');
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('save, guest isolation, and restart preserve crops at every growth stage without offline catch-up',async()=>{
 const stages=[1,2,3,4].map((stage,i)=>({id:`stage_${stage}`,x:i-1,y:0,z:3,stage,progress:12000,lastTick:Date.now()}));
 const c=await preparedWorld(stages,{revision:17,coins:321,inventory:{wheat:8,wheat_seed:6,wateringCanUses:7},watered:{'0,0,3':240000}});try{
  let r=await req(c.port,'/api/world',null,c.cookie);assert.equal(r.body.revision,17);assert.deepEqual(r.body.crops.map(v=>v.stage),[1,2,3,4]);
  assert.equal(r.body.coins,321);assert.equal(r.body.inventory.wheat,8);assert.equal(r.body.inventory.wheat_seed,6);assert.equal(r.body.inventory.wateringCanUses,7);assert.ok(r.body.watered['0,0,3']>0);
  const persisted=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));assert.deepEqual(persisted.crops.map(v=>v.stage),[1,2,3,4]);
  const guest=await req(c.port,'/api/world');assert.equal(guest.body.coins,100);assert.equal(guest.body.crops.length,5);assert.ok(!guest.body.crops.some(v=>v.id.startsWith('stage_')),'another guest must not see the fixture crops');
  await stop(c.proc);c.proc=await boot(c.port,c.dir);await new Promise(resolve=>setTimeout(resolve,80));
  r=await req(c.port,'/api/world',null,c.cookie);assert.deepEqual(r.body.crops.map(v=>v.stage),[1,2,3,4],'offline duration must not grow crops');assert.equal(r.body.revision,17);assert.equal(r.body.inventory.wheat,8);assert.equal(r.body.inventory.wheat_seed,6);assert.equal(r.body.inventory.wateringCanUses,7);assert.ok(r.body.watered['0,0,3']>0);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('watering uses are capped, timers do not stack, and an empty can can refill at a source',async()=>{
 const c=await preparedWorld([{x:0,y:0,z:3,stage:1}],{waterSources:[{x:0,y:0,z:0}],inventory:{selectedSlot:4,wateringCanUses:1}});try{
  let r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',0);assert.equal(r.status,200,r.body.error);assert.equal(r.body.world.inventory.wateringCanUses,0);
  const first=r.body.world.watered['0,0,3'];assert.ok(first>0&&first<=300000);
  r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',r.body.world.revision);assert.equal(r.status,400);assert.equal(r.body.world.inventory.wateringCanUses,0);
  r=await farm(c.port,c.cookie,'refill',0,0,0,'watering_can',r.body.world.revision);assert.equal(r.status,200,r.body.error);assert.equal(r.body.world.inventory.wateringCanUses,10);
  r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',r.body.world.revision);assert.equal(r.status,200,r.body.error);assert.equal(r.body.world.inventory.wateringCanUses,9);
  const reset=r.body.world.watered['0,0,3'];assert.ok(reset>0&&reset<=300000);assert.ok(reset<=first+1000,'rewatering resets the duration instead of stacking it');
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('concurrent repeated planting and harvesting are revision-safe and award once',async()=>{
 const c=await preparedWorld([{id:'mature',x:0,y:0,z:3,stage:4}],{tilled:[[0,0,3],[1,0,3]],inventory:{wheat_seed:2}});try{
  await req(c.port,'/api/world',null,c.cookie); // initialize the serialized session before racing requests
  const plants=await Promise.all(Array.from({length:10},()=>farm(c.port,c.cookie,'plant',1,0,3,'hoe',0)));
  assert.equal(plants.filter(v=>v.status===200).length,1);assert.equal(plants.filter(v=>v.status===409).length,9);
  let w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.inventory.wheat_seed,1);assert.equal(w.crops.filter(v=>v.x===1).length,1);
  const harvests=await Promise.all(Array.from({length:10},()=>farm(c.port,c.cookie,'harvest',0,0,3,null,w.revision)));
  assert.equal(harvests.filter(v=>v.status===200).length,1);assert.equal(harvests.filter(v=>v.status===409).length,9);
  w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.inventory.wheat,1);assert.equal(w.inventory.wheat_seed,2);assert.equal(w.harvestedCrops.filter(id=>id==='mature').length,1);
  const guest=(await req(c.port,'/api/world')).body;assert.equal(guest.inventory.wheat,0);assert.equal(guest.inventory.wheat_seed,0);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('thirty full farming loops run on an isolated virtual 50x clock with growth, water, and save checks',async()=>{
 const c=await preparedWorld([],{nodeEnv:'development',virtualTime:true,tilled:[[0,0,3]],waterSources:[{x:0,y:0,z:0}],inventory:{wheat_seed:1,selectedSlot:3,wateringCanUses:10}});try{
  let r=await req(c.port,'/api/world',null,c.cookie);assert.equal(r.body.devtoolsEnabled,true);
  r=await req(c.port,'/api/dev/time',{multiplier:50},c.cookie);assert.equal(r.status,200);assert.equal(r.body.gameClock.multiplier,50);
  let expectedRevision=0;
  for(let i=0;i<30;i++){
   let w=(await req(c.port,'/api/world',null,c.cookie)).body;
   r=await req(c.port,'/api/slot',{selectedSlot:3},c.cookie);assert.equal(r.status,200);w=r.body.world;
   r=await farm(c.port,c.cookie,'plant',0,0,3,'hoe',w.revision);assert.equal(r.status,200,`loop ${i+1} plant: ${r.body.error}`);w=r.body.world;assert.equal(w.inventory.wheat_seed,0);
   r=await req(c.port,'/api/slot',{selectedSlot:4},c.cookie);assert.equal(r.status,200);w=r.body.world;
   if(w.inventory.wateringCanUses===0){r=await farm(c.port,c.cookie,'refill',0,0,0,'watering_can',w.revision);assert.equal(r.status,200,`loop ${i+1} refill: ${r.body.error}`);w=r.body.world;assert.equal(w.inventory.wateringCanUses,10);}
   r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',w.revision);assert.equal(r.status,200,`loop ${i+1} water: ${r.body.error}`);w=r.body.world;
   assert.ok(w.watered['0,0,3']>0&&w.watered['0,0,3']<=300000);assert.equal(w.inventory.wateringCanUses,((i%10)===9)?0:9-(i%10));
   await req(c.port,'/api/dev/time',null,c.cookie);await req(c.port,'/api/dev/time',null,c.cookie);
   w=(await req(c.port,'/api/world',null,c.cookie)).body;const crop=w.crops.find(v=>v.x===0&&v.z===3);assert.equal(crop.stage,4,`loop ${i+1} must mature through virtual active game time`);
   r=await farm(c.port,c.cookie,'harvest',0,0,3,null,w.revision);assert.equal(r.status,200,`loop ${i+1} harvest: ${r.body.error}`);w=r.body.world;
   expectedRevision=w.revision;
   assert.equal(w.crops.some(v=>v.x===0&&v.z===3),false);assert.equal(w.inventory.wheat,i+1);assert.equal(w.inventory.wheat_seed,1);assert.equal(w.harvestedCrops.length,i+1);
  }
  const persisted=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));assert.ok(expectedRevision>=150);assert.equal(persisted.revision,expectedRevision);assert.equal(persisted.inventory.wheat,30);assert.equal(persisted.inventory.wheat_seed,1);assert.equal(persisted.harvestedCrops.length,30);
  await stop(c.proc);c.proc=await boot(c.port,c.dir,'development',true);r=await req(c.port,'/api/world',null,c.cookie);assert.equal(r.body.revision,expectedRevision);assert.equal(r.body.inventory.wheat,30);assert.equal(r.body.inventory.wheat_seed,1);assert.equal(r.body.harvestedCrops.length,30);assert.equal(r.body.crops.length,0,'restart must preserve the harvested farm state');
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('50x watering and growth restore to 1x, retain only game-time water, and exclude restart gaps',async()=>{
 const c=await preparedWorld([{id:'wet',x:0,y:0,z:3,stage:1,progress:0},{id:'dry',x:1,y:0,z:3,stage:1,progress:0}],{nodeEnv:'development',virtualTime:true,waterSources:[{x:0,y:0,z:0}],inventory:{selectedSlot:4,wateringCanUses:2}});try{
  let w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.gameClock.multiplier,1);
  let r=await req(c.port,'/api/dev/time',{multiplier:50},c.cookie);assert.equal(r.status,200);assert.equal(r.body.gameClock.multiplier,50);
  r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',w.revision);assert.equal(r.status,200,r.body.error);w=r.body.world;assert.equal(w.inventory.wateringCanUses,1);
  const high=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(high.gameClock.multiplier,50);assert.equal(high.crops.find(v=>v.id==='wet').stage,4);assert.ok(high.watered['0,0,3']>0&&high.watered['0,0,3']<300000);
  const wetAt50=high.watered['0,0,3'];const clockAt50=high.gameClock.gameTimeMs;
  r=await req(c.port,'/api/dev/time',{multiplier:1},c.cookie);assert.equal(r.status,200);assert.equal(r.body.gameClock.multiplier,1);assert.equal(r.body.gameClock.gameMinutesPerRealMinute,12);assert.ok(r.body.gameClock.gameTimeMs>clockAt50);
  const clockAt1=r.body.gameClock.gameTimeMs;const oneTick=await req(c.port,'/api/dev/time',null,c.cookie);assert.equal(oneTick.body.gameClock.multiplier,1);assert.equal(oneTick.body.gameClock.gameTimeMs-clockAt1,1200,'the test clock must advance exactly one 1× tick');
  const afterOneTick=await req(c.port,'/api/world',null,c.cookie);assert.equal(afterOneTick.body.gameClock.multiplier,1);assert.equal(afterOneTick.body.crops.find(v=>v.id==='wet').stage,4);
  const waterAt1=afterOneTick.body.watered['0,0,3'];assert.ok(waterAt1>0);assert.ok(wetAt50-waterAt1>100000&&wetAt50-waterAt1<130000,`50x settlement followed by 1x ticks should consume game-time water: ${wetAt50}→${waterAt1}`);
  for(let i=0;i<5;i++)await req(c.port,'/api/move',{x:1,z:0},c.cookie);for(let i=0;i<5;i++)await req(c.port,'/api/move',{x:-1,z:0},c.cookie);
  w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.ok(Math.abs(w.player.x-.5)<.02,'move away and back returns the player');assert.equal(w.crops.find(v=>v.id==='wet').stage,4);assert.ok(w.watered['0,0,3']>0);
  const persisted=JSON.parse(await readFile(join(c.dir,c.id+'.json'),'utf8'));assert.equal(persisted.crops.find(v=>v.id==='wet').stage,4);assert.ok(persisted.watered['0,0,3']>0);
  await stop(c.proc);c.proc=await boot(c.port,c.dir,'development',true);r=await req(c.port,'/api/dev/time',null,c.cookie);assert.equal(r.body.gameClock.multiplier,1);w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.crops.find(v=>v.id==='wet').stage,4);assert.ok(w.watered['0,0,3']>0);assert.ok(Math.abs(w.player.x-.5)<.02);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('atomic save recovery ignores an orphaned partial temp file and keeps the last committed farm state',async()=>{
 const c=await preparedWorld([{id:'saved-crop',x:0,y:0,z:3,stage:4}],{revision:9,inventory:{wheat:2,wheat_seed:3}});try{
  const target=join(c.dir,c.id+'.json'),orphan=target+'.interrupted.tmp';await writeFile(orphan,'{"revision":10,"crops":[');
  let w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.revision,9);assert.equal(w.crops[0].id,'saved-crop');
  const result=await farm(c.port,c.cookie,'harvest',0,0,3,'hand',w.revision);assert.equal(result.status,200,result.body.error);assert.equal(result.body.world.inventory.wheat,3);assert.equal(result.body.world.inventory.wheat_seed,4);
  const committed=JSON.parse(await readFile(target,'utf8'));assert.equal(committed.revision,10);assert.equal(committed.crops.length,0);assert.deepEqual(committed.harvestedCrops,['saved-crop']);
  await stop(c.proc);c.proc=await boot(c.port,c.dir);w=(await req(c.port,'/api/world',null,c.cookie)).body;assert.equal(w.revision,10);assert.equal(w.inventory.wheat,3);assert.equal(w.inventory.wheat_seed,4);assert.equal(w.crops.length,0);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});

test('watered wheat advances at exactly twice the dry crop rate',async()=>{
 const c=await preparedWorld([{x:0,y:0,z:3,stage:1,progress:0},{x:1,y:0,z:3,stage:1,progress:0}]);try{
  let r=await req(c.port,'/api/slot',{selectedSlot:4},c.cookie);assert.equal(r.status,200,r.body.error);
  r=await farm(c.port,c.cookie,'water',0,0,3,'watering_can',r.body.world.revision);assert.equal(r.status,200,r.body.error);
  const initial=new Map(r.body.world.crops.map(crop=>[crop.x,crop.progress]));
  await new Promise(resolve=>setTimeout(resolve,80));r=await req(c.port,'/api/world',null,c.cookie);
  const wet=r.body.crops.find(crop=>crop.x===0).progress-initial.get(0),dry=r.body.crops.find(crop=>crop.x===1).progress-initial.get(1);
  assert.ok(dry>0,`dry crop should advance in game time (${dry}ms)`);assert.ok(Math.abs(wet/dry-2)<0.25,`wet/dry rate ${wet}/${dry}`);
 }finally{await stop(c.proc);await rm(c.dir,{recursive:true,force:true});}
});
