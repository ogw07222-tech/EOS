import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {blockAt} from '../src/chunk-world.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_chunk_world_1234567890';

async function randomPort(){
 const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function boot(port,saveDir){
 const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TERRA_SAVE_DIR:saveDir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});
 let stderr='';proc.stderr.on('data',data=>stderr+=data.toString());
 await new Promise((resolve,reject)=>{
  let output='';const timer=setTimeout(()=>reject(Error('Server start timed out: '+stderr)),5000);
  proc.stdout.on('data',data=>{output+=data.toString();if(output.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});
  proc.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+stderr));});
 });
 return proc;
}
async function stop(proc){if(!proc||proc.exitCode!==null)return;proc.kill('SIGTERM');await once(proc,'exit');}
async function request(port,path,{cookie,method='GET',body}={}){
 const headers={};if(cookie)headers.Cookie=cookie;
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,cookie:response.headers.get('set-cookie'),body:await response.json()};
}
async function isolatedServer(t){
 const saveDir=await mkdtemp(join(tmpdir(),'terra-chunk-server-')),port=await randomPort();let proc=await boot(port,saveDir);
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 return {saveDir,port,restart:async()=>{await stop(proc);proc=await boot(port,saveDir);}};
}

test('new world persists its deterministic generation identity and landing origin across restart',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');assert.equal(created.status,200);
 const world=created.body,id=created.cookie.split(';')[0].match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 assert.ok(Number.isSafeInteger(world.worldSeed)&&world.worldSeed>=0&&world.worldSeed<=0xffffffff);
 assert.ok(Number.isSafeInteger(world.worldGenVersion)&&world.worldGenVersion>0);
 assert.deepEqual({x:world.worldAnchor?.x,y:world.worldAnchor?.y,z:world.worldAnchor?.z},{x:0,y:0,z:0});
 assert.equal(world.worldAnchor.kind,'landing-origin');
 const savePath=join(server.saveDir,id+'.json'),saved=JSON.parse(await readFile(savePath,'utf8'));
 assert.equal(saved.worldSeed,world.worldSeed);assert.equal(saved.worldGenVersion,world.worldGenVersion);assert.deepEqual(saved.worldAnchor,world.worldAnchor);
 await server.restart();const loaded=await request(server.port,'/api/world',{cookie:created.cookie.split(';')[0]});
 assert.equal(loaded.status,200);assert.equal(loaded.body.worldSeed,world.worldSeed);assert.equal(loaded.body.worldGenVersion,world.worldGenVersion);assert.deepEqual(loaded.body.worldAnchor,world.worldAnchor);
});

test('generated grass supports edits on both sides of the negative chunk edge; edits survive restart and removal restores generated terrain',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world'),cookie=created.cookie.split(';')[0];let world=created.body;
 assert.equal(blockAt(world,1,-1,0),'grass');assert.equal(blockAt(world,-1,-1,0),'grass');
 assert.equal(blockAt(world,1,-6,0),'stone','the safe pad has a generated underground stone layer');
 const standing=await request(server.port,'/api/move',{cookie,method:'POST',body:{x:0,z:0}});
 assert.equal(standing.status,200);assert.equal(standing.body.player.y,0);assert.equal(standing.body.player.grounded,true,'the server collision step stands on generated grass');
 const place=async x=>request(server.port,'/api/action',{cookie,method:'POST',body:{type:'place',x,y:0,z:0,revision:world.revision}});
 let response=await place(1);assert.equal(response.status,200,response.body.error);world=response.body.world;assert.equal(world.inventory.dirt,47);assert.equal(world.edits['1,0,0'],'dirt');
 response=await request(server.port,'/api/action',{cookie,method:'POST',body:{type:'place',x:-1,y:0,z:1,revision:world.revision}});
 assert.equal(response.status,200,response.body.error);world=response.body.world;assert.equal(world.inventory.dirt,46);assert.equal(world.edits['-1,0,1'],'dirt');

 await server.restart();world=(await request(server.port,'/api/world',{cookie})).body;
 assert.equal(world.inventory.dirt,46);assert.equal(world.edits['1,0,0'],'dirt');assert.equal(world.edits['-1,0,1'],'dirt');
 assert.equal(world.worldSeed,created.body.worldSeed);assert.equal(blockAt(world,1,-1,0),'grass');assert.equal(blockAt(world,-1,-1,1),'grass');
 const selected=await request(server.port,'/api/slot',{cookie,method:'POST',body:{selectedSlot:2}});assert.equal(selected.status,200);world=selected.body.world;
 const mining=await request(server.port,'/api/mine',{cookie,method:'POST',body:{type:'start',targetType:'block',x:-1,y:0,z:1,tool:'wood_shovel',revision:world.revision}});assert.equal(mining.status,200,mining.body.error);
 await new Promise(resolve=>setTimeout(resolve,1250));
 const mined=await request(server.port,'/api/action',{cookie,method:'POST',body:{type:'mine',targetType:'block',x:-1,y:0,z:1,tool:'wood_shovel',revision:world.revision}});
 assert.equal(mined.status,200,mined.body.error);assert.equal(mined.body.world.inventory.dirt,47);assert.equal(mined.body.world.edits['-1,0,1'],null,'an explicit air patch masks regenerated terrain');
 await server.restart();world=(await request(server.port,'/api/world',{cookie})).body;
 assert.equal(world.inventory.dirt,47);assert.equal(world.edits['-1,0,1'],null);assert.equal(world.edits['1,0,0'],'dirt');
 assert.equal(blockAt(world,-1,0,1),null,'mining the placed block restores generated air above the surface');assert.equal(blockAt(world,-1,-1,1),'grass');
});

test('server collision blocks horizontal movement through generated underground stone',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');
 const id=created.cookie.split(';')[0].match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 const savePath=join(server.saveDir,id+'.json'),saved=JSON.parse(await readFile(savePath,'utf8'));
 assert.equal(blockAt(saved,1,-6,0),'stone');
 // Isolated fixture places the avatar inside the safe pad's stone stratum;
 // a horizontal move must collide with the authoritative generated block.
 saved.player={x:1.5,y:-6,z:.5,grounded:true};await writeFile(savePath,JSON.stringify(saved));await server.restart();
 const moved=await request(server.port,'/api/move',{cookie:created.cookie.split(';')[0],method:'POST',body:{x:1,z:0}});
 assert.equal(moved.status,200);assert.equal(moved.body.player.x,1.5);assert.equal(moved.body.player.y,-6);assert.equal(moved.body.player.grounded,true);
});

test('generated flat-field agriculture saves till, seed use, watered time, and revision across restart without duplicate planting',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world'),cookie=created.cookie.split(';')[0];
 const id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 const savePath=join(server.saveDir,id+'.json'),fixture=JSON.parse(await readFile(savePath,'utf8'));
 // Seed tools only in this disposable per-test save; terrain and farm plot are generated.
 fixture.inventory.tools.hoe=1;fixture.inventory.tools.watering_can=1;fixture.inventory.quickSlots[3]='hoe';fixture.inventory.quickSlots[4]='watering_can';fixture.inventory.wheat_seed=2;fixture.inventory.wateringCanUses=10;
 await writeFile(savePath,JSON.stringify(fixture));await server.restart();
 const loaded=await request(server.port,'/api/world',{cookie});let world=loaded.body;
 assert.equal(world.worldSeed,created.body.worldSeed);assert.equal(world.worldGenVersion,created.body.worldGenVersion);
 assert.equal(world.edits['1,0,1'],undefined);assert.equal(blockAt(world,1,-1,1),'grass');
 const action=async(name,tool,revision=world.revision)=>request(server.port,'/api/farm',{cookie,method:'POST',body:{action:name,x:1,y:0,z:1,tool,revision}});
 let response=await request(server.port,'/api/slot',{cookie,method:'POST',body:{selectedSlot:3}});assert.equal(response.status,200);world=response.body.world;
 const beforeTillRevision=world.revision;response=await action('till','hoe');assert.equal(response.status,200,response.body.error);world=response.body.world;
 assert.equal(world.revision,beforeTillRevision+1);assert.ok(world.tilled.some(([x,y,z])=>x===1&&y===0&&z===1));assert.equal(world.inventory.wheat_seed,2);
 response=await action('plant','hoe');assert.equal(response.status,200,response.body.error);world=response.body.world;
 assert.equal(world.revision,beforeTillRevision+2);assert.equal(world.inventory.wheat_seed,1);assert.equal(world.crops.filter(c=>c.x===1&&c.y===0&&c.z===1).length,1);
 const duplicate=await action('plant','hoe');assert.equal(duplicate.status,400);assert.equal(duplicate.body.world.inventory.wheat_seed,1);assert.equal(duplicate.body.world.revision,world.revision);
 response=await request(server.port,'/api/slot',{cookie,method:'POST',body:{selectedSlot:4}});assert.equal(response.status,200);world=response.body.world;
 response=await action('water','watering_can');assert.equal(response.status,200,response.body.error);world=response.body.world;
 assert.equal(world.revision,beforeTillRevision+4);assert.equal(world.inventory.wateringCanUses,9);
 const waterKey='1,0,1',waterRemaining=world.watered[waterKey],crop=world.crops.find(c=>c.x===1&&c.y===0&&c.z===1);
 assert.ok(waterRemaining>0);assert.equal(crop.stage,1);assert.equal(world.inventory.wheat_seed,1);

 await server.restart();const reloaded=await request(server.port,'/api/world',{cookie});world=reloaded.body;
 assert.equal(world.worldSeed,created.body.worldSeed);assert.equal(world.worldGenVersion,created.body.worldGenVersion);
 assert.equal(world.revision,beforeTillRevision+4);assert.equal(world.inventory.wheat_seed,1);assert.equal(world.inventory.wateringCanUses,9);
 assert.ok(world.tilled.some(([x,y,z])=>x===1&&y===0&&z===1));assert.equal(world.crops.filter(c=>c.x===1&&c.y===0&&c.z===1).length,1);
 assert.equal(world.crops.find(c=>c.x===1&&c.y===0&&c.z===1).stage,1);assert.ok(world.watered[waterKey]>0&&world.watered[waterKey]<=waterRemaining);
 const afterRestartDuplicate=await request(server.port,'/api/farm',{cookie,method:'POST',body:{action:'plant',x:1,y:0,z:1,tool:'hoe',revision:world.revision}});
 assert.equal(afterRestartDuplicate.status,400);assert.equal(afterRestartDuplicate.body.world.inventory.wheat_seed,1);assert.equal(afterRestartDuplicate.body.world.crops.length,world.crops.length);
});

test('schema-1 saves without chunk metadata remain legacy worlds',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-chunk-legacy-')),port=await randomPort(),id='abcdef0123456789abcdef0123456789';let proc;
 await writeFile(join(saveDir,id+'.json'),JSON.stringify({schema:1,revision:7,inventory:{dirt:21,wood:4,stone:2,items:{workbench:1},tools:{},quickSlots:[],selectedSlot:0},edits:{'2,0,2':'dirt'},machines:[{id:'legacy-bench',type:'workbench',x:0,y:0,z:0}],trees:[{id:'legacy-tree',x:-2,y:0,z:-2}],harvestedTrees:[]}));
 try{
  proc=await boot(port,saveDir);const cookieId=id,sig=createHmac('sha256',secret).update(cookieId).digest('hex'),cookie=`terra_session=${cookieId}.${sig}`;
  const legacy=await request(port,'/api/world',{cookie});assert.equal(legacy.status,200);assert.equal(legacy.body.islandSize,16);assert.equal(legacy.body.worldVersion,1);
  assert.equal(legacy.body.worldSeed,undefined);assert.equal(legacy.body.worldGenVersion,undefined);assert.equal(legacy.body.worldAnchor,undefined);
  assert.equal(legacy.body.revision,7);assert.equal(legacy.body.inventory.dirt,21);assert.equal(legacy.body.edits['2,0,2'],'dirt');
  const place=await request(port,'/api/action',{cookie,method:'POST',body:{type:'place',x:3,y:0,z:2,revision:legacy.body.revision}});
  assert.equal(place.status,200,place.body.error);assert.equal(place.body.world.edits['3,0,2'],'dirt');assert.equal(place.body.world.worldGenVersion,undefined);
  await stop(proc);proc=await boot(port,saveDir);
  const reloaded=await request(port,'/api/world',{cookie});assert.equal(reloaded.body.islandSize,16);assert.equal(reloaded.body.worldGenVersion,undefined);assert.equal(reloaded.body.edits['2,0,2'],'dirt');assert.equal(reloaded.body.edits['3,0,2'],'dirt');
 }finally{await stop(proc);await rm(saveDir,{recursive:true,force:true});}
});
