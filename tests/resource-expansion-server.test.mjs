import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createHmac} from 'node:crypto';
import net from 'node:net';
import {WORLD_GEN_VERSION,heightAt} from '../src/chunk-world.mjs';
import {generateTreesForChunk} from '../src/tree-world.mjs';

const root=resolve(import.meta.dirname,'..'),secret='testing_secret_for_terra_game_1234567890';
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(p,dir){const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(p),HOST:'127.0.0.1',TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('server startup timeout: '+stderr)),5000);child.stdout.on('data',b=>{if(b.toString().includes('TERRA prototype server:')){clearTimeout(timer);ok();}});child.once('exit',code=>{clearTimeout(timer);bad(Error(`server exit ${code}: ${stderr}`));});});return child;}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function req(p,path,body,cookie){const r=await fetch(`http://127.0.0.1:${p}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cookie:r.headers.get('set-cookie'),body:await r.json()};}
async function fixture(world){const dir=await mkdtemp(join(tmpdir(),'terra-resource-')),id='c0ffee0123456789c0ffee0123456789',p=await port(),sig=createHmac('sha256',secret).update(id).digest('hex');await writeFile(join(dir,id+'.json'),JSON.stringify(world));return {dir,id,p,cookie:`terra_session=${id}.${sig}`,child:await boot(p,dir)};}
const base=(inventory={},extra={})=>({schema:1,worldVersion:3,islandSize:10,revision:0,coins:100,inventory:{dirt:48,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{},tools:{wood_pickaxe:1,stone_pickaxe:1,wood_axe:1,wood_shovel:1,hoe:1,scythe:1},quickSlots:['wood_pickaxe','stone_pickaxe','wood_axe','wood_shovel','hoe','scythe',null,null],selectedSlot:0,wateringCanUses:10,...inventory},edits:{},machines:[],trees:[],harvestedTrees:[],tilled:[],crops:[],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],drops:[],player:{x:.5,y:0,z:.5,grounded:true},...(extra.worldGenVersion===WORLD_GEN_VERSION?{seaLevel:0,fluidRevision:0,fluidEdits:{},fluidActive:[],fluidTickRate:5}:{}),...extra});

test('carrot and potato plant with their own seed and mature to exact one-plus-one rewards across restart',async()=>{
 const w=base({carrot_seed:1,potato_seed:1},{tilled:[[0,0,3],[1,0,3],[2,0,3],[3,0,3]],crops:[{id:'carrot-ripe',cropType:'carrot',x:0,y:0,z:3,stage:4},{id:'potato-ripe',cropType:'potato',x:1,y:0,z:3,stage:4}]});
 const c=await fixture(w);try{let world=(await req(c.p,'/api/world',null,c.cookie)).body;
  for(const [cropType,x,seed]of [['carrot',2,'carrot_seed'],['potato',3,'potato_seed']]){const r=await req(c.p,'/api/farm',{action:'plant',cropType,x,y:0,z:3,tool:'hoe',revision:world.revision},c.cookie);assert.equal(r.status,200,r.body.error);world=r.body.world;assert.equal(world.inventory[seed],0);assert.equal(world.crops.find(v=>v.x===x).cropType,cropType);}
  for(const [x,product,seed]of [[0,'carrot','carrot_seed'],[1,'potato','potato_seed']]){const r=await req(c.p,'/api/farm',{action:'harvest',x,y:0,z:3,tool:'hand',revision:world.revision},c.cookie);assert.equal(r.status,200,r.body.error);world=r.body.world;assert.equal(world.inventory[product],1);assert.equal(world.inventory[seed],1);}
  await stop(c.child);c.child=await boot(c.p,c.dir);world=(await req(c.p,'/api/world',null,c.cookie)).body;assert.equal(world.inventory.carrot,1);assert.equal(world.inventory.carrot_seed,1);assert.equal(world.inventory.potato,1);assert.equal(world.inventory.potato_seed,1);assert.equal(world.crops.filter(x=>x.x<2).length,0);
 }finally{await stop(c.child);await rm(c.dir,{recursive:true,force:true});}
});

test('rubber tree harvest gives typed logs, sapling, and sap once; tombstone survives reload',async()=>{
 const w=base({sapling:0,selectedSlot:2},{trees:[{id:'rubber-fixture',x:0,y:0,z:0,species:'rubber',source:'planted',stage:3,height:6,crownWidth:3,trunkWidth:1}],player:{x:.5,y:0,z:.5,grounded:true}}),c=await fixture(w);
 try{let r=await req(c.p,'/api/harvest',{type:'start',resourceType:'tree',resourceId:'rubber-fixture',tool:'wood_axe'} ,c.cookie);assert.equal(r.status,200,r.body.error);await new Promise(resolve=>setTimeout(resolve,1230));r=await req(c.p,'/api/harvest',{type:'collect',resourceType:'tree',resourceId:'rubber-fixture',tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);
  const got=r.body.world.inventory;assert.ok([2,3].includes(got.rubberwood));assert.equal(got.wood,got.rubberwood);assert.ok([1,2].includes(got.rubber_sapling));assert.equal(got.sapling,got.rubber_sapling);assert.equal(got.rubber_sap,1);assert.deepEqual(r.body.rewards,{wood:got.wood,rubberwood:got.rubberwood,sapling:got.sapling,rubber_sapling:got.rubber_sapling,rubber_sap:1});
  await stop(c.child);c.child=await boot(c.p,c.dir);const world=(await req(c.p,'/api/world',null,c.cookie)).body;assert.ok(world.harvestedTrees.includes('rubber-fixture'));assert.equal(world.inventory.rubber_sap,1);r=await req(c.p,'/api/harvest',{type:'start',resourceType:'tree',resourceId:'rubber-fixture',tool:'wood_axe'},c.cookie);assert.equal(r.status,400);
 }finally{await stop(c.child);await rm(c.dir,{recursive:true,force:true});}
});

test('generated natural tree harvest tombstone prevents rebirth after server restart',async()=>{
 const worldSeed=7654321,x=-12,z=0,y=heightAt(worldSeed,x,z,WORLD_GEN_VERSION),cx=Math.floor(x/16),cz=Math.floor(z/16),trees=generateTreesForChunk(worldSeed,cx,cz,(tx,tz)=>heightAt(worldSeed,tx,tz,WORLD_GEN_VERSION)),tree=trees.find(v=>v.x===x&&v.z===z);
 assert.ok(tree,'the deterministic starter oak is present in its owning chunk');
 const w=base({selectedSlot:2},{worldGenVersion:WORLD_GEN_VERSION,worldSeed,worldAnchor:{x:0,y:0,z:0,kind:'landing-origin'},player:{x:x+.5,y,z:z+.5,grounded:true}}),c=await fixture(w);
 try{let r=await req(c.p,'/api/harvest',{type:'start',resourceType:'tree',resourceId:tree.id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);await new Promise(resolve=>setTimeout(resolve,1230));r=await req(c.p,'/api/harvest',{type:'collect',resourceType:'tree',resourceId:tree.id,tool:'wood_axe'},c.cookie);assert.equal(r.status,200,r.body.error);assert.ok(r.body.world.harvestedTrees.includes(tree.id));
  await stop(c.child);c.child=await boot(c.p,c.dir);let world=(await req(c.p,'/api/world',null,c.cookie)).body;assert.ok(world.harvestedTrees.includes(tree.id));r=await req(c.p,'/api/harvest',{type:'start',resourceType:'tree',resourceId:tree.id,tool:'wood_axe'},c.cookie);assert.equal(r.status,400,'a generated chunk tree cannot be harvested twice after restart');
 }finally{await stop(c.child);await rm(c.dir,{recursive:true,force:true});}
});

test('manual pickup accepts registered machine item IDs once and persists the stack',async()=>{
 const c=await fixture(base({},{drops:[{id:'coal-stack',item:'coal',quantity:3,x:.5,y:1,z:.5,conveyorId:null,progress:0}]}));
 try{const world=(await req(c.p,'/api/world',null,c.cookie)).body;const body={dropId:'coal-stack',revision:world.revision};const [a,b]=await Promise.all([req(c.p,'/api/items/pickup',body,c.cookie),req(c.p,'/api/items/pickup',body,c.cookie)]);assert.equal(a.status,200,a.body.error);assert.equal(a.body.world.inventory.coal,3);assert.deepEqual(a.body.world.drops,[]);assert.ok([404,409].includes(b.status));await stop(c.child);c.child=await boot(c.p,c.dir);const saved=(await req(c.p,'/api/world',null,c.cookie)).body;assert.equal(saved.inventory.coal,3);assert.deepEqual(saved.drops,[]);
 }finally{await stop(c.child);await rm(c.dir,{recursive:true,force:true});}
});

test('starter coal block rejects T0, mines once with T1, and persists the air edit',async()=>{
 const worldSeed=0x12345678,x=15,y=Math.floor(heightAt(worldSeed,15,-1,WORLD_GEN_VERSION))-8,z=-1,surfaceY=heightAt(worldSeed,x,z,WORLD_GEN_VERSION);
 const w=base({stone_pickaxe:1},{worldGenVersion:WORLD_GEN_VERSION,worldSeed,worldAnchor:{x:0,y:0,z:0,kind:'landing-origin'},player:{x:x+.5,y,z:z+.5,grounded:true}}),c=await fixture(w);
 try{let world=(await req(c.p,'/api/world',null,c.cookie)).body;let r=await req(c.p,'/api/mine',{type:'start',targetType:'block',x,y,z,tool:'wood_pickaxe',revision:world.revision},c.cookie);assert.equal(r.status,400,'wood pickaxe cannot mine coal');
  r=await req(c.p,'/api/slot',{selectedSlot:1},c.cookie);assert.equal(r.status,200,r.body.error);world=r.body.world;r=await req(c.p,'/api/mine',{type:'start',targetType:'block',x,y,z,tool:'stone_pickaxe',revision:world.revision},c.cookie);assert.equal(r.status,200,r.body.error);await new Promise(resolve=>setTimeout(resolve,1230));r=await req(c.p,'/api/action',{type:'mine',targetType:'block',x,y,z,tool:'stone_pickaxe',revision:world.revision},c.cookie);assert.equal(r.status,200,r.body.error);assert.ok([1,2].includes(r.body.world.inventory.coal));assert.equal(r.body.world.edits[`${x},${y},${z}`],null);
  const duplicate=await req(c.p,'/api/action',{type:'mine',targetType:'block',x,y,z,tool:'stone_pickaxe',revision:r.body.world.revision},c.cookie);assert.equal(duplicate.status,400);await stop(c.child);c.child=await boot(c.p,c.dir);world=(await req(c.p,'/api/world',null,c.cookie)).body;assert.ok([1,2].includes(world.inventory.coal));assert.equal(world.inventory.coal,r.body.world.inventory.coal);assert.equal(world.edits[`${x},${y},${z}`],null);assert.ok(Number.isFinite(surfaceY));
 }finally{await stop(c.child);await rm(c.dir,{recursive:true,force:true});}
});
