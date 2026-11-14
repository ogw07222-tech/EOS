import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { createHmac } from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir){
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:'testing_secret_for_terra_game_1234567890'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 const started=await new Promise((resolve,reject)=>{
 let output='';let timeout=setTimeout(()=>reject(Error('Timed out starting server: '+stderr)),5000);
 child.stdout.on('data',b=>{output+=b.toString();if(output.includes('TERRA prototype server:')){clearTimeout(timeout);resolve(true);}});
 child.on('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code+': '+stderr));});
 });
 return child;
}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await once(child,'exit');}
async function request(port,path,options={}){const res=await fetch('http://127.0.0.1:'+port+path,options);return {status:res.status,cookie:res.headers.get('set-cookie'),body:await res.json()};}

test('independent guest island edits are validated and persist across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'terra-eos-test-'));const port=await randomPort();let proc;
 try{
 proc=await boot(port,dir);
 const alice=await request(port,'/api/world');assert.equal(alice.status,200);
 assert.equal(alice.body.inventory.dirt,48);assert.equal(alice.body.revision,0);
 const cookie=alice.cookie.split(';')[0];assert.match(cookie,/^terra_session=/);
 const bob=await request(port,'/api/world');const bCookie=bob.cookie.split(';')[0];
 assert.notEqual(cookie,bCookie);
 const build=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:1,y:0,z:0,revision:0})});
 assert.equal(build.status,200);assert.equal(build.body.world.inventory.dirt,47);assert.equal(build.body.world.edits['1,0,0'],'dirt');
 const stale=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:2,y:0,z:0,revision:0})});
 assert.equal(stale.status,409);
 const unsupported=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:12,y:5,z:12,revision:1})});
 assert.equal(unsupported.status,400);
 const bobWorld=await request(port,'/api/world',{headers:{Cookie:bCookie}});
 assert.equal(bobWorld.body.revision,0);
 await stop(proc);proc=await boot(port,dir);
 const persisted=await request(port,'/api/world',{headers:{Cookie:cookie}});
 assert.equal(persisted.body.revision,1);
 assert.equal(persisted.body.inventory.dirt,47);
 assert.equal(persisted.body.edits['1,0,0'],'dirt');
 const equipShovel=await request(port,'/api/slot',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:2})});assert.equal(equipShovel.status,200);
 const mining=await request(port,'/api/mine',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'start',targetType:'block',tool:'wood_shovel',x:1,y:0,z:0,revision:equipShovel.body.world.revision})});
 assert.equal(mining.status,200);
 await new Promise(resolve=>setTimeout(resolve,1250));
 const take=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'mine',targetType:'block',tool:'wood_shovel',x:1,y:0,z:0,revision:equipShovel.body.world.revision})});
 assert.equal(take.status,200);assert.equal(take.body.world.inventory.dirt,48);
 assert.equal(Object.hasOwn(take.body.world.edits,'1,0,0'),false);
 }finally{await stop(proc);await rm(dir,{recursive:true,force:true});}
});

test('new guest gets the designed island, tools, crops and resource harvesting',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'terra-eos-start-'));const port=await randomPort();let proc;
 try{
  proc=await boot(port,dir);const guest=await request(port,'/api/world'),cookie=guest.cookie.split(';')[0],w=guest.body;
  assert.equal(w.islandSize,10);assert.equal(w.worldVersion,3);
  assert.deepEqual(Object.fromEntries(Object.entries(w.inventory.tools).filter(([k])=>['wood_pickaxe','wood_axe','wood_shovel'].includes(k))),{wood_pickaxe:1,wood_axe:1,wood_shovel:1});
  assert.deepEqual(w.inventory.quickSlots.slice(0,3),['wood_pickaxe','wood_axe','wood_shovel']);assert.equal(w.inventory.quickSlots.length,8);
  assert.equal(Object.keys(w.inventory.tools).some(k=>k.includes('iron')),false);
  assert.equal(w.crops.length,5);assert.ok(w.crops.every(c=>c.stage===4));assert.equal(w.tilled.length,9);assert.equal(w.oreNodes.length,1);assert.equal(w.trees.length,1);
  assert.equal(w.machines.filter(m=>m.type==='t1_bench').length,1);
  const headers={Cookie:cookie,'Content-Type':'application/json'};
  const wrongTool=await request(port,'/api/mine',{method:'POST',headers,body:JSON.stringify({type:'start',targetType:'block',x:0,y:-1,z:0,tool:'wood_pickaxe',revision:w.revision})});
  assert.equal(wrongTool.status,400);
  const wrongAxe=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'start',resourceType:'tree',resourceId:'oak_start',tool:'wood_pickaxe'})});assert.equal(wrongAxe.status,400);
  const startTree=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'start',resourceType:'tree',resourceId:'oak_start',tool:'wood_axe'})});assert.equal(startTree.status,200);
  await new Promise(resolve=>setTimeout(resolve,1220));
  const tree=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'collect',resourceType:'tree',resourceId:'oak_start',tool:'wood_axe'})});
  assert.equal(tree.status,200);assert.ok([2,3].includes(tree.body.world.inventory.wood));assert.equal(tree.body.world.inventory.sapling,1);
  const startWheat=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'start',resourceType:'wheat',resourceId:'wheat_1'})});assert.equal(startWheat.status,200);
  await new Promise(resolve=>setTimeout(resolve,1220));
  const wheat=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'collect',resourceType:'wheat',resourceId:'wheat_1'})});
  assert.equal(wheat.status,200);assert.equal(wheat.body.world.inventory.wheat,1);assert.deepEqual(wheat.body.world.harvestedCrops,['wheat_1']);
  const noAxe=await request(port,'/api/harvest',{method:'POST',headers,body:JSON.stringify({type:'start',resourceType:'tree',resourceId:'oak_start'})});assert.equal(noAxe.status,400);
  const wrongPick=await request(port,'/api/mine',{method:'POST',headers,body:JSON.stringify({type:'start',targetType:'ore',resourceId:'stone_vein_start',tool:'wood_axe',revision:2})});assert.equal(wrongPick.status,400);
  const equipPick=await request(port,'/api/slot',{method:'POST',headers,body:JSON.stringify({selectedSlot:0})});assert.equal(equipPick.status,200);
  const startOre=await request(port,'/api/mine',{method:'POST',headers,body:JSON.stringify({type:'start',targetType:'ore',resourceId:'stone_vein_start',tool:'wood_pickaxe',revision:equipPick.body.world.revision})});assert.equal(startOre.status,200);
  await new Promise(resolve=>setTimeout(resolve,1220));
  const ore=await request(port,'/api/action',{method:'POST',headers,body:JSON.stringify({type:'mine',targetType:'ore',resourceId:'stone_vein_start',tool:'wood_pickaxe',revision:equipPick.body.world.revision})});
  assert.equal(ore.status,200);assert.equal(ore.body.world.inventory.stone,1);assert.equal(ore.body.world.oreNodes[0].remaining,2);
 }finally{await stop(proc);await rm(dir,{recursive:true,force:true});}
});

test('legacy saves keep their island size and existing world state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'terra-eos-legacy-'));const port=await randomPort();let proc;
 try{
  const id='0123456789abcdef0123456789abcdef',secret='testing_secret_for_terra_game_1234567890';
  await writeFile(join(dir,id+'.json'),JSON.stringify({schema:1,revision:7,inventory:{dirt:21,wood:4,stone:2,items:{workbench:1},tools:{},quickSlots:[],selectedSlot:0},edits:{'2,0,2':'dirt'},machines:[{id:'oldbench',type:'workbench',x:0,y:0,z:0}],trees:[{id:'old-tree',x:-2,y:0,z:-2}],harvestedTrees:[]}));
  proc=await boot(port,dir);const sig=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${sig}`;
  const response=await request(port,'/api/world',{headers:{Cookie:cookie}});assert.equal(response.status,200);
  assert.equal(response.body.islandSize,16);assert.equal(response.body.worldVersion,1);assert.equal(response.body.revision,7);
  assert.equal(response.body.inventory.dirt,21);assert.equal(response.body.inventory.wood,4);
  assert.equal(response.body.trees.length,1);assert.equal(response.body.trees[0].id,'old-tree');assert.equal(response.body.trees[0].x,-2);assert.equal(response.body.trees[0].z,-2);assert.equal(response.body.trees[0].stage,3);
  assert.equal(response.body.crops.length,0);assert.equal(response.body.oreNodes.length,0);assert.deepEqual(response.body.machines,[{id:'oldbench',type:'workbench',x:0,y:0,z:0}]);
 }finally{await stop(proc);await rm(dir,{recursive:true,force:true});}
});
