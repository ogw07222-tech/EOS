import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { blockAt, heightAt } from '../src/chunk-world.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_game_1234567890';
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir){const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Timed out starting server: '+stderr)),5000);child.stdout.on('data',b=>{output+=b.toString();if(output.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});child.on('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${stderr}`));});});return child;}
async function stop(proc){if(!proc||proc.exitCode!==null)return;proc.kill('SIGTERM');await once(proc,'exit');}
async function request(port,path,{cookie,body,...options}={}){const response=await fetch(`http://127.0.0.1:${port}${path}`,{...options,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...options.headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
function fixture({wood=0,stone=0,wheat=0,wheat_seed=0,iron_ore=0,coal=0,coal_block=0,logs={},machines=[]}={}){return {schema:1,worldVersion:1,islandSize:10,revision:0,coins:100,inventory:{dirt:0,sand:0,wood,stone,wheat,wheat_seed,iron_ore,coal,coal_block,...logs,items:{},tools:{wood_pickaxe:1,wood_axe:1,wood_shovel:1,stone_pickaxe:0,hoe:0,watering_can:0,scythe:0},quickSlots:['wood_pickaxe','wood_axe','wood_shovel',null,null,null,null,null],selectedSlot:0,wateringCanUses:10},edits:{},machines,trees:[],harvestedTrees:[],tilled:[],crops:[],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],drops:[],player:{x:.5,y:0,z:.5,grounded:true}};}
async function setup(t,world){const dir=await mkdtemp(join(tmpdir(),'terra-workstations-')),port=await randomPort(),id='abcdef0123456789abcdef0123456789';await writeFile(join(dir,id+'.json'),JSON.stringify(world));let proc=await boot(port,dir);const cookie=`terra_session=${id}.${createHmac('sha256',secret).update(id).digest('hex')}`;t.after(async()=>{await stop(proc);await rm(dir,{recursive:true,force:true});});return {port,cookie,dir,restart:async()=>{await stop(proc);proc=await boot(port,dir);}};}

 test('T0 workstation recipes consume mixed species logs and reject stale duplicate revisions',async t=>{
 const ctx=await setup(t,fixture({wood:5,stone:10,oak_log:2,birch_log:3}));
 const assetResponse=await fetch(`http://127.0.0.1:${ctx.port}/src/recipe-settings.mjs`);assert.equal(assetResponse.status,200);assert.match(await assetResponse.text(),/provisional:true/);
 const response=await request(ctx.port,'/api/world',{cookie:ctx.cookie});assert.equal(response.status,200);
 const revision=response.body.revision;
 const requests=await Promise.all([0,1].map(()=>request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe:'tool_bench',revision}})));
 assert.deepEqual(requests.map(r=>r.status).sort(),[200,409]);
 const world=requests.find(r=>r.status===200).body.world;assert.equal(world.inventory.wood,0);assert.equal(world.inventory.oak_log,0);assert.equal(world.inventory.birch_log,0);assert.equal(world.inventory.items.tool_bench,1);
 });

test('T0 facility recipes require harvested wheat, ore and coal blocks and preserve inventory on failure',async t=>{
 const ctx=await setup(t,fixture({wood:50,stone:35,wheat_seed:10,iron_ore:10}));
 let current=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;
 const fail=await request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe:'agriculture_bench',revision:current.revision}});assert.equal(fail.status,400);assert.equal(fail.body.world.inventory.wood,50);assert.equal(fail.body.world.inventory.wheat_seed,10);assert.equal(fail.body.world.revision,current.revision);
 current=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;
 let craft=await request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe:'basic_assembler',revision:current.revision}});assert.equal(craft.status,400);assert.equal(craft.body.world.inventory.iron_ore,10);assert.equal(craft.body.world.inventory.coal_block,0);
 });

test('crafted workstation placement consumes one item and survives server restart',async t=>{
 const ctx=await setup(t,fixture({wood:5,stone:10}));
 let world=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;
 let craft=await request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe:'tool_bench',revision:world.revision}});assert.equal(craft.status,200);world=craft.body.world;
 const candidates=[];for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++){const y=heightAt(world.worldSeed,x,z,world.worldGenVersion),center={x:x+.5,y:y+.5,z:z+.5};if(Math.abs(x+2)<=1&&z===0)continue;if(blockAt(world,x,y,z)!=null||blockAt(world,x,y-1,z)==null||Math.hypot(center.x-world.player.x,center.y-(world.player.y+1),center.z-world.player.z)>5.5)continue;candidates.push({x,y,z});}
 assert.ok(candidates.length,'migrated fixture should contain a reachable supported tile');const tile=candidates[0];
 const placement=await request(ctx.port,'/api/machine/place',{method:'POST',cookie:ctx.cookie,body:{type:'tool_bench',...tile,rotation:0,revision:world.revision}});assert.equal(placement.status,200,placement.body.error);assert.equal(placement.body.world.inventory.items.tool_bench,0);assert.equal(placement.body.world.machines[0].type,'tool_bench');
 await ctx.restart();world=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;assert.equal(world.machines[0].type,'tool_bench');assert.equal(world.revision,2);
});


test('all four confirmed workstation recipes craft from their specified T0 costs',async t=>{
 const ctx=await setup(t,fixture({wood:50,stone:35,wheat:10,iron_ore:10,coal_block:5}));
 let world=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;
 for(const recipe of ['tool_bench','agriculture_bench','block_bench','basic_assembler']){
  const result=await request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe,revision:world.revision}});assert.equal(result.status,200,`${recipe}: ${result.body.error}`);world=result.body.world;
 }
 assert.equal(world.inventory.items.tool_bench,1);assert.equal(world.inventory.items.agriculture_bench,1);assert.equal(world.inventory.items.block_bench,1);assert.equal(world.inventory.items.basic_assembler,1);assert.equal(world.inventory.wood,15);assert.equal(world.inventory.stone,0);assert.equal(world.inventory.wheat,0);assert.equal(world.inventory.iron_ore,0);assert.equal(world.inventory.coal_block,0);
});


test('coal blocks can only be crafted at a real nearby block bench',async t=>{
 const ctx=await setup(t,fixture({coal:10}));
 let world=(await request(ctx.port,'/api/world',{cookie:ctx.cookie})).body;
 let response=await request(ctx.port,'/api/craft',{method:'POST',cookie:ctx.cookie,body:{recipe:'coal_block',revision:world.revision}});assert.equal(response.status,400);assert.equal(response.body.world.inventory.coal,10);assert.equal(response.body.world.inventory.coal_block,0);assert.equal(response.body.world.revision,world.revision);
 const stationWorld=fixture({coal:10,machines:[{id:'block-station',type:'block_bench',x:2,y:0,z:0,rotation:0}]});
 const second=await setup(t,stationWorld);world=(await request(second.port,'/api/world',{cookie:second.cookie})).body;
 response=await request(second.port,'/api/craft',{method:'POST',cookie:second.cookie,body:{recipe:'coal_block',revision:world.revision}});assert.equal(response.status,200,response.body.error);assert.equal(response.body.world.inventory.coal,0);assert.equal(response.body.world.inventory.coal_block,1);
});
