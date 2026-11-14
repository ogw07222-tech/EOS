import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {treeWoodYieldForRoll} from '../src/farming-rules.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_game_1234567890';
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir){const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('server startup timed out: '+stderr)),5000);child.stdout.on('data',b=>{out+=b;if(out.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${stderr}`));});});return child;}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function req(port,path,body,cookie){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cookie:r.headers.get('set-cookie'),body:await r.json()};}
async function freshWorld(){const dir=await mkdtemp(join(tmpdir(),'terra-farm-'));const port=await randomPort();const proc=await boot(port,dir);const r=await req(port,'/api/world');return {dir,port,proc,cookie:r.cookie.split(';')[0],world:r.body};}
async function preparedWorld(crops){const dir=await mkdtemp(join(tmpdir(),'terra-farm-fixture-'));const id='abcdef0123456789abcdef0123456789';const world={schema:1,worldVersion:3,islandSize:10,revision:0,inventory:{dirt:48,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{},tools:{wood_pickaxe:1,wood_axe:1,wood_shovel:1,hoe:1,scythe:1,watering_can:1},quickSlots:['wood_pickaxe','wood_axe','wood_shovel','hoe','watering_can','scythe',null,null],selectedSlot:5,wateringCanUses:10},edits:{},machines:[],trees:[],harvestedTrees:[],tilled:crops.map(c=>[c.x,c.y,c.z]),crops:crops.map((c,i)=>({id:`crop_${i}`,stage:4,progress:0,lastTick:Date.now(),...c})),watered:{},harvestedCrops:[],oreNodes:[],player:{x:.5,y:0,z:.5,grounded:true}};await writeFile(join(dir,id+'.json'),JSON.stringify(world));const port=await randomPort(),proc=await boot(port,dir),sig=createHmac('sha256',secret).update(id).digest('hex');return {dir,port,proc,cookie:`terra_session=${id}.${sig}`,world};}
const farm=(port,cookie,action,x,y,z,tool,revision)=>req(port,'/api/farm',{action,x,y,z,tool,revision},cookie);

test('tree wood probability boundary is 70 percent for two and 30 percent for three',()=>{
 assert.equal(treeWoodYieldForRoll(0),2);assert.equal(treeWoodYieldForRoll(0.699999),2);
 assert.equal(treeWoodYieldForRoll(0.7),3);assert.equal(treeWoodYieldForRoll(0.999999),3);
 assert.throws(()=>treeWoodYieldForRoll(1),RangeError);
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

test('watering, tree harvest, and planting requests are validated server-side',async()=>{
 const c=await freshWorld();try{
  const h={Cookie:c.cookie};let w=c.world;
  let r=await farm(c.port,c.cookie,'water',-4,0,3,'watering_can',w.revision);assert.notEqual(r.status,200);
  // Harvest start/collect remains a server-timed interaction, with one randomized wood roll.
  r=await req(c.port,'/api/harvest',{type:'start',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);
  await new Promise(resolve=>setTimeout(resolve,1220));
  r=await req(c.port,'/api/harvest',{type:'collect',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);
  assert.ok([2,3].includes(r.body.world.inventory.wood));assert.equal(r.body.world.inventory.sapling,1);
  const duplicate=await req(c.port,'/api/harvest',{type:'start',resourceType:'tree',resourceId:w.trees[0].id,tool:'wood_axe'},c.cookie);assert.notEqual(duplicate.status,200);
  const sapling=await farm(c.port,c.cookie,'plant_tree',4,0,0,null,r.body.world.revision);assert.equal(sapling.status,200,sapling.body.error);assert.equal(sapling.body.world.inventory.sapling,0);assert.equal(sapling.body.world.trees.find(t=>t.x===4&&t.z===0).stage,0);
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
