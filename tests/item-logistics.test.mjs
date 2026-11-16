import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { advanceItemLogistics, normalizeDrops } from '../src/item-logistics.mjs';
import { readFileSync } from 'node:fs';

const root=resolve(import.meta.dirname,'..'),secret='testing_secret_for_terra_game_1234567890';
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir){const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b.toString());await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('server startup timed out: '+stderr)),5000);child.stdout.on('data',b=>{if(b.toString().includes('TERRA prototype server:')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(Error(`server exited ${code}: ${stderr}`));});});return child;}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function req(port,path,{cookie,body,method='GET'}={}){const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,cookie:response.headers.get('set-cookie'),body:await response.json()};}

test('item logistics preserves drops across belts, corners and one-tile uphill links',()=>{
 const world={drops:[{id:'ore-one',item:'stone',quantity:1,x:.5,y:.4,z:.5,conveyorId:'belt-a',progress:0}],machines:[
  {id:'belt-a',type:'conveyor',x:0,y:0,z:0,rotation:0},
  {id:'belt-b',type:'conveyor',x:1,y:1,z:0,rotation:1},
  {id:'belt-c',type:'conveyor',x:1,y:1,z:1,rotation:2},
  {id:'belt-d',type:'conveyor',x:0,y:1,z:1,rotation:0}
 ],oreNodes:[]};
 assert.equal(advanceItemLogistics(world,1400),true);
 assert.equal(world.drops.length,1);assert.equal(world.drops[0].id,'ore-one');assert.ok(world.drops[0].y>.9,'ascending segment raises item with the belt');
 assert.equal(world.drops[0].conveyorId,'belt-b');assert.ok(world.drops[0].progress>0,'turn progress continues on the next conveyor');
 const saved=structuredClone(world);advanceItemLogistics(saved,1000);assert.equal(saved.drops.length,1);assert.equal(saved.drops[0].item,'stone');
});

test('legacy saves normalize drops; duplicate IDs are discarded',()=>{
 const world={machines:[],drops:[{id:'same',item:'stone',quantity:1,x:0,y:0,z:0},{id:'same',item:'stone',quantity:9,x:2,y:0,z:0},{id:'bad',item:'stone',quantity:0,x:0,y:0,z:0}]};
 normalizeDrops(world);assert.equal(world.drops.length,1);assert.equal(world.drops[0].id,'same');
 const legacy={machines:[]};normalizeDrops(legacy);assert.deepEqual(legacy.drops,[]);
});


test('active game renders world entities with cached item models and only offers explicit pickup',()=>{
 const game=readFileSync(join(root,'src','game.js'),'utf8'),html=readFileSync(join(root,'index.html'),'utf8');
 assert.match(game,/function syncWorldDrops\(\)/);assert.match(game,/makeItemModel\(drop\.item\)/);assert.match(game,/entry\.root\.rotation\.y/);
 assert.match(game,/api\('\/api\/items\/pickup'/);assert.match(game,/considerInteraction\(best,'item'/);assert.match(game,/itemThumbnail\(id\)/);
 assert.match(html,/data-slot="7"[\s\S]*?<img alt="">/);assert.doesNotMatch(game,/auto.?pickup|automatic.?pickup/i);
});

test('drill output is a saved world entity; explicit pickup is atomic and survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'terra-item-world-')),port=await randomPort(),id='11223344556677881122334455667788';let proc;
 try{
  const initial={schema:1,worldVersion:3,islandSize:10,revision:0,coins:100,location:null,inventory:{dirt:48,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,items:{workbench:0,drill:0,conveyor:0},tools:{wood_pickaxe:1,wood_axe:1,wood_shovel:1},quickSlots:['wood_pickaxe','wood_axe','wood_shovel',null,null,null,null,null],selectedSlot:1,wateringCanUses:10},edits:{},machines:[{id:'drill-test',type:'drill',x:0,y:0,z:0,rotation:0,productionMs:0},{id:'belt-out',type:'conveyor',x:1,y:0,z:0,rotation:0}],trees:[],harvestedTrees:[],tilled:[],crops:[],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[{id:'vein-test',x:0,y:0,z:-2,remaining:2,max:2,regenAt:null}],drops:[],player:{x:1.5,y:0,z:.5,grounded:true},createdAt:Date.now(),updatedAt:Date.now()};
  await writeFile(join(dir,id+'.json'),JSON.stringify(initial));proc=await boot(port,dir);
  const signature=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${signature}`;
  let response=await req(port,'/api/world',{cookie});assert.equal(response.status,200);assert.deepEqual(response.body.drops,[]);
  await new Promise(resolve=>setTimeout(resolve,5200));response=await req(port,'/api/world',{cookie});assert.equal(response.status,200);assert.equal(response.body.drops.length,1);const drop=response.body.drops[0];assert.equal(drop.item,'stone');assert.equal(drop.quantity,1);assert.equal(response.body.oreNodes[0].remaining,1);assert.equal(response.body.inventory.stone,0,'machine output remains a world item');
  assert.equal(response.body.drops[0].conveyorId,'belt-out');
  const originalDrop=structuredClone(response.body.drops[0]);await stop(proc);proc=await boot(port,dir);for(let i=0;i<12;i++){await new Promise(resolve=>setTimeout(resolve,200));response=await req(port,'/api/world',{cookie});if(response.body.drops[0]?.x>originalDrop.x)break;}assert.equal(response.body.drops.length,1);assert.equal(response.body.drops[0].id,originalDrop.id);assert.ok(response.body.drops[0].x>originalDrop.x,`saved item resumes belt transport after server restart: ${JSON.stringify({originalDrop,after:response.body.drops[0]})}`);
  const rev=response.body.revision;const [one,two]=await Promise.all([req(port,'/api/items/pickup',{cookie,method:'POST',body:{dropId:drop.id,revision:rev}}),req(port,'/api/items/pickup',{cookie,method:'POST',body:{dropId:drop.id,revision:rev}})]);
  assert.equal(one.status,200);assert.equal(one.body.world.inventory.stone,1);assert.deepEqual(one.body.world.drops,[]);assert.ok([404,409].includes(two.status),'a concurrent second pickup cannot award the item twice');
  await stop(proc);proc=await boot(port,dir);response=await req(port,'/api/world',{cookie});assert.equal(response.body.inventory.stone,1);assert.deepEqual(response.body.drops,[]);assert.equal(response.body.oreNodes[0].remaining,1);
 }finally{await stop(proc);await rm(dir,{recursive:true,force:true});}
});
