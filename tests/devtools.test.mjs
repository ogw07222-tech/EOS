import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir,writeFile,rename} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {createTimeControl,DEV_TIME_MULTIPLIERS,BASE_GAME_MINUTES_PER_REAL_MINUTE} from '../devtools/time-control-server.mjs';
import {createTeleportService} from '../devtools/teleport-server.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_game_1234567890';

async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function boot(cwd,port,saveDir,nodeEnv,host='127.0.0.1'){
 const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(port),HOST:host,TERRA_SAVE_DIR:saveDir,TERRA_SESSION_SECRET:secret,NODE_ENV:nodeEnv},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('server startup timed out: '+stderr)),5000);child.stdout.on('data',b=>{out+=b.toString();if(out.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${stderr}`));});});
 return child;
}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function request(port,path,{cookie,body,origin,host='127.0.0.1'}={}){
 const r=await fetch(`http://${host}:${port}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 let payload;try{payload=await r.json();}catch{payload=null;}return {status:r.status,cookie:r.headers.get('set-cookie'),body:payload};
}

test('developer clock applies each allowed multiplier and settles at the previous rate',()=>{
 assert.deepEqual(DEV_TIME_MULTIPLIERS,[1,2,5,10,50]);assert.equal(BASE_GAME_MINUTES_PER_REAL_MINUTE,12);
 for(const multiplier of DEV_TIME_MULTIPLIERS){
  const clock=createTimeControl({now:1000});
  assert.equal(clock.snapshot().multiplier,1);
  clock.setMultiplier(multiplier,1000);
  const tick=clock.tick(2000);
  assert.equal(tick.deltaGameMs,12_000*multiplier);
  assert.equal(tick.gameMinutesPerRealMinute,12*multiplier);
 }
 const clock=createTimeControl({now:0});clock.tick(1000);const changed=clock.setMultiplier(5,2000);
 assert.equal(changed.deltaGameMs,12_000);assert.equal(changed.gameTimeMs,24_000);
 assert.equal(clock.tick(3000).deltaGameMs,60_000);
 assert.equal(clock.snapshot().gameTimeMs,84_000);
});

test('developer clock rejects unsupported rates, excludes inactive gaps, and restarts at 1×',()=>{
 const clock=createTimeControl({now:10});for(const invalid of [0,3,4,20,100,'5'])assert.throws(()=>clock.setMultiplier(invalid,10),RangeError);
 assert.equal(clock.snapshot().multiplier,1);
 clock.setMultiplier(50,20);assert.equal(clock.tick(21,{active:false}).deltaGameMs,0);
 assert.equal(clock.tick(7000).deltaGameMs,0,'long disconnected interval is discarded');
 assert.equal(clock.tick(8000).deltaGameMs,600_000);
 const restarted=createTimeControl({now:8000});assert.equal(restarted.snapshot().multiplier,1);assert.equal(restarted.snapshot().gameTimeMs,0);
});

test('teleport water safety is modeled only for generation v2; legacy worlds remain unmodeled',()=>{
 const teleport=createTeleportService({worldMinY:-32,worldMaxY:32,surfaceAt:()=>0,isSolidForPlayer:()=>false,hasGroundSupport:()=>true});
 const player={x:.5,y:0,z:.5,grounded:true},body={x:1.5,z:.5,autoY:true};
 assert.equal(teleport.resolve({worldGenVersion:2,worldSeed:1},player,body).waterSafety,'modeled');
 assert.equal(teleport.resolve({islandSize:10},player,body).waterSafety,'not-modeled');
});

test('development server exposes and validates local time controls, production does not',async()=>{
 const port=await randomPort(),saveDir=await mkdtemp(join(tmpdir(),'terra-dev-prod-save-'));let proc;
 try{
  proc=await boot(root,port,saveDir,'production');
  const world=await request(port,'/api/world');assert.equal(world.status,200);assert.notEqual(world.body.devtoolsEnabled,true);assert.equal(world.body.gameClock,undefined);
  assert.equal((await request(port,'/api/dev/time')).status,404);assert.equal((await request(port,'/api/dev/teleport',{body:{x:1,z:1,autoY:true}})).status,404);assert.equal((await request(port,'/api/dev/teleport/return',{body:{}})).status,404);assert.equal((await request(port,'/devtools/time-control.js')).status,404);
 }finally{await stop(proc);await rm(saveDir,{recursive:true,force:true});}
 const devPort=await randomPort(),devSave=await mkdtemp(join(tmpdir(),'terra-dev-enabled-save-'));
 try{
  proc=await boot(root,devPort,devSave,'development');
  let response=await request(devPort,'/api/world');assert.equal(response.status,200);assert.equal(response.body.devtoolsEnabled,true);assert.equal(response.body.gameClock.multiplier,1);
  assert.equal((await request(devPort,'/devtools/time-control.js')).status,200);assert.equal((await request(devPort,'/devtools/dev-panel.css')).status,200);
  const cookie=response.cookie.split(';')[0];
  for(const multiplier of DEV_TIME_MULTIPLIERS){response=await request(devPort,'/api/dev/time',{cookie,body:{multiplier}});assert.equal(response.status,200,response.body?.error);assert.equal(response.body.gameClock.multiplier,multiplier);assert.equal(response.body.gameClock.gameMinutesPerRealMinute,multiplier*12);}
  const invalid=await request(devPort,'/api/dev/time',{cookie,body:{multiplier:3}});assert.equal(invalid.status,400);assert.equal(invalid.body.gameClock.multiplier,50);
  await stop(proc);proc=await boot(root,devPort,devSave,'development');
  const restarted=await request(devPort,'/api/dev/time',{cookie});assert.equal(restarted.status,200);assert.equal(restarted.body.gameClock.multiplier,1);
 }finally{await stop(proc);await rm(devSave,{recursive:true,force:true});}
});

test('developer acceleration combines with watering for crop growth, water duration, and sapling stages',async()=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-growth-save-')),port=await randomPort(),id='fedcba9876543210fedcba9876543210';let proc;
 const world={schema:1,worldVersion:3,islandSize:10,revision:0,inventory:{dirt:0,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,wateringCanUses:10,items:{},tools:{wood_pickaxe:1,wood_axe:1,wood_shovel:1,watering_can:1},quickSlots:['wood_pickaxe','wood_axe','wood_shovel','watering_can',null,null,null,null],selectedSlot:3},edits:{},machines:[],trees:[{id:'seedling',x:3,y:0,z:1,stage:0,progress:179000,harvested:false}],harvestedTrees:[],tilled:[[0,0,3],[1,0,3],[2,0,3],[3,0,3]],crops:[{id:'wet-test',x:0,y:0,z:3,stage:1,progress:59000},{id:'dry-test',x:1,y:0,z:3,stage:1,progress:59000},{id:'wet-rate',x:2,y:0,z:3,stage:1,progress:0},{id:'dry-rate',x:3,y:0,z:3,stage:1,progress:0}],watered:{},waterSources:[{x:4,y:0,z:4}],harvestedCrops:[],oreNodes:[],player:{x:.5,y:0,z:.5,grounded:true}};
 const sig=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${sig}`;
 try{
  await writeFile(join(saveDir,id+'.json'),JSON.stringify(world));proc=await boot(root,port,saveDir,'development');
  let response=await request(port,'/api/world',{cookie});assert.equal(response.body.devtoolsEnabled,true);
  response=await request(port,'/api/dev/time',{cookie,body:{multiplier:5}});assert.equal(response.status,200);
  response=await request(port,'/api/farm',{cookie,body:{action:'water',x:0,y:0,z:3,tool:'watering_can',revision:response.body.world?.revision??0}});
  // /api/dev/time returns its snapshot; fetch a fresh world to obtain the revision.
  if(response.status===409){const latest=await request(port,'/api/world',{cookie});response=await request(port,'/api/farm',{cookie,body:{action:'water',x:0,y:0,z:3,tool:'watering_can',revision:latest.body.revision}});}
  assert.equal(response.status,200,response.body?.error);
  response=await request(port,'/api/farm',{cookie,body:{action:'water',x:2,y:0,z:3,tool:'watering_can',revision:response.body.world.revision}});assert.equal(response.status,200,response.body?.error);
  const waterBefore=response.body.world.watered['0,0,3'];
  const before=new Map(response.body.world.crops.map(c=>[c.id,c.progress]));
  await new Promise(resolve=>setTimeout(resolve,100));response=await request(port,'/api/world',{cookie});assert.equal(response.status,200);
  const wet=response.body.crops.find(c=>c.id==='wet-test'),dry=response.body.crops.find(c=>c.id==='dry-test');
  assert.ok(wet.stage>=2,'high developer rate plus watering should advance a near-ripe crop');assert.ok(dry.stage>=2,'developer rate advances dry crops too');
  assert.equal(response.body.trees.find(t=>t.id==='seedling').stage,1,'sapling growth uses developer game time');
  const wetDelta=response.body.crops.find(c=>c.id==='wet-rate').progress-before.get('wet-rate'),dryDelta=response.body.crops.find(c=>c.id==='dry-rate').progress-before.get('dry-rate');
  assert.ok(Math.abs(wetDelta/dryDelta-2)<0.3,`dev time and watering should compound to 2× the dry growth rate: ${wetDelta}/${dryDelta}`);
  assert.ok(response.body.watered['0,0,3']<waterBefore,'watering duration must also run on accelerated game time');
  assert.ok(wet.progress>=0&&dry.progress>=0);assert.ok(before.get('wet-test')>=0);
 }finally{await stop(proc);await rm(saveDir,{recursive:true,force:true});}
});

test('development server without devtools folder boots the base game and has no dev UI or API',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'terra-no-devtools-')),saveDir=await mkdtemp(join(tmpdir(),'terra-no-devtools-save-'));let proc;
 try{
  await mkdir(join(fixture,'src'),{recursive:true});
  await writeFile(join(fixture,'server.mjs'),await readFile(join(root,'server.mjs')));
  await writeFile(join(fixture,'index.html'),await readFile(join(root,'index.html')));
  await writeFile(join(fixture,'src','game.js'),await readFile(join(root,'src','game.js')));
  await writeFile(join(fixture,'src','farming-rules.mjs'),await readFile(join(root,'src','farming-rules.mjs')));
  for(const module of ['hub-world.mjs','economy-rules.mjs','item-logistics.mjs','chunk-world.mjs','crop-rules.mjs','mineral-world.mjs','resource-catalog.mjs','recipe-settings.mjs','tree-world.mjs'])await writeFile(join(fixture,'src',module),await readFile(join(root,'src',module)));
  const id='10203040506070801020304050607080',port=await randomPort();
  await writeFile(join(saveDir,id+'.json'),JSON.stringify({schema:1,worldVersion:3,islandSize:10,revision:0,inventory:{dirt:0,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,wateringCanUses:10,items:{},tools:{},quickSlots:[],selectedSlot:0},edits:{},machines:[],trees:[{id:'offline-sapling',x:3,y:0,z:1,stage:0,progress:179000}],harvestedTrees:[],tilled:[[0,0,3]],crops:[{id:'base-wheat',x:0,y:0,z:3,stage:1,progress:59000}],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],player:{x:.5,y:0,z:.5,grounded:true}}));
  proc=await boot(fixture,port,saveDir,'development');const signature=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${signature}`;
  let world=await request(port,'/api/world',{cookie});assert.equal(world.status,200);assert.notEqual(world.body.devtoolsEnabled,true);
  assert.equal((await request(port,'/api/dev/time')).status,404);assert.equal((await request(port,'/api/dev/biomes',{cookie})).status,404);assert.equal((await request(port,'/api/dev/fluid-rate',{cookie,method:'POST',body:{tickRate:5}})).status,404);assert.equal((await request(port,'/api/dev/teleport',{body:{x:1,z:1,autoY:true}})).status,404);assert.equal((await request(port,'/api/dev/teleport/return',{body:{}})).status,404);assert.equal((await request(port,'/devtools/time-control.js')).status,404);assert.equal((await request(port,'/devtools/dev-panel.css')).status,404);assert.equal((await request(port,'/')).status,200);
  await new Promise(resolve=>setTimeout(resolve,1000));world=await request(port,'/api/world',{cookie});assert.equal(world.body.crops[0].stage,2,'the base 12× game clock still grows wheat without devtools');assert.equal(world.body.trees[0].stage,1,'the base 12× game clock still grows saplings without devtools');
 }finally{await stop(proc);await rm(fixture,{recursive:true,force:true});await rm(saveDir,{recursive:true,force:true});}
});

test('developer teleport uses server coordinates across positive, negative, and Z/X chunk seams',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-save-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world');assert.equal(initial.status,200);assert.equal(initial.body.devtoolsEnabled,true);
 const cookie=initial.cookie.split(';')[0],id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 const savePath=join(saveDir,id+'.json'),fixture=JSON.parse(await readFile(savePath,'utf8'));
 fixture.worldSeed=0;fixture.trees=[];fixture.harvestedTrees=[];fixture.machines=[];
 await writeFile(savePath,JSON.stringify(fixture));await stop(proc);proc=await boot(root,port,saveDir,'development');
 for(const point of [
  {x:15.5,z:.5}, {x:16.5,z:.5}, // X=15 -> 16
  {x:-.5,z:.5}, {x:.5,z:.5}, // X=-1 -> 0
  {x:.5,z:15.5}, {x:.5,z:16.5}, // Z=15 -> 16
  {x:.5,z:-.5}, {x:.5,z:.5} // Z=-1 -> 0
 ]){
  const response=await request(port,'/api/dev/teleport',{cookie,body:{...point,autoY:true}});
  assert.equal(response.status,200,response.body?.error);
  assert.equal(response.body.player.x,point.x);assert.equal(response.body.player.z,point.z);
  assert.equal(response.body.player.grounded,true);assert.ok(Number.isFinite(response.body.player.y));
  assert.equal(response.body.world.player.x,point.x,'the world snapshot must match server-authoritative player coordinates');
  assert.ok(['forest','plains',null].includes(response.body.biome));
  assert.equal(response.body.waterSafety,'modeled');
 }
});

test('developer teleport rejects invalid, out-of-world, and solid-interior targets without moving the player',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-invalid-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0],before=initial.body.player;
 for(const body of [
  {x:'',z:0,autoY:true},{x:'NaN',z:0,autoY:true},{x:'Infinity',z:0,autoY:true},
  {x:4096,z:0,autoY:true},{x:-4097,z:0,autoY:true},{x:0,z:4096,autoY:true},
  {x:0,z:0,y:33,autoY:false},{x:0,z:0,y:-33,autoY:false}
 ]){
  const response=await request(port,'/api/dev/teleport',{cookie,body});assert.equal(response.status,400,JSON.stringify(body));
 }
 const solid=await request(port,'/api/dev/teleport',{cookie,body:{x:.5,z:.5,y:-6,autoY:false,allowWater:true}});
 assert.equal(solid.status,400);assert.match(solid.body.error,/solid|blocked|safe|collision|고체|충돌/i);
 const latest=await request(port,'/api/world',{cookie});
 assert.deepEqual({x:latest.body.player.x,y:latest.body.player.y,z:latest.body.player.z},{x:before.x,y:before.y,z:before.z});
});

test('developer teleport exposes modeled water status, and previous location returns and persists',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-return-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0];
 const first=await request(port,'/api/dev/teleport',{cookie,body:{x:2.5,z:.5,autoY:true}});
 assert.equal(first.status,200,first.body?.error);assert.deepEqual({x:first.body.previousPosition.x,y:first.body.previousPosition.y,z:first.body.previousPosition.z},{x:initial.body.player.x,y:initial.body.player.y,z:initial.body.player.z});
 assert.equal(first.body.waterSafety,'modeled');
 const second=await request(port,'/api/dev/teleport',{cookie,body:{x:3.5,z:.5,autoY:true}});
 assert.equal(second.status,200,second.body?.error);assert.deepEqual({x:second.body.previousPosition.x,y:second.body.previousPosition.y,z:second.body.previousPosition.z},{x:first.body.player.x,y:first.body.player.y,z:first.body.player.z});
 const returned=await request(port,'/api/dev/teleport/return',{cookie,body:{}});
 assert.equal(returned.status,200,returned.body?.error);assert.equal(returned.body.player.x,first.body.player.x);assert.equal(returned.body.player.y,first.body.player.y);assert.equal(returned.body.player.z,first.body.player.z);
 await stop(proc);proc=await boot(root,port,saveDir,'development');
 const reloaded=await request(port,'/api/world',{cookie});assert.equal(reloaded.status,200);
 assert.equal(reloaded.body.player.x,first.body.player.x);assert.equal(reloaded.body.player.y,first.body.player.y);assert.equal(reloaded.body.player.z,first.body.player.z);
});

test('ordinary movement cannot bypass developer teleport validation or set absolute coordinates',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-bypass-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0];
 const response=await request(port,'/api/move',{cookie,body:{x:1000,y:1000,z:-1000,grounded:true}});
 assert.equal(response.status,200);
 assert.ok(Math.abs(response.body.player.x-initial.body.player.x)<1,'move.x remains normalized velocity, not an absolute teleport coordinate');
 assert.ok(Math.abs(response.body.player.z-initial.body.player.z)<1,'move.z remains normalized velocity, not an absolute teleport coordinate');
 assert.notEqual(response.body.player.y,1000,'move.y cannot set server-authoritative height');
});

test('development teleport and time APIs stay hidden on non-loopback clients even when bound publicly',async t=>{
 const address=Object.values(networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal)?.address;
 if(!address){t.skip('no non-loopback IPv4 interface is available for the localAddress integration check');return;}
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-local-only-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development','0.0.0.0');
 const local=await request(port,'/api/world');assert.equal(local.status,200);assert.equal(local.body.devtoolsEnabled,true);
 const cookie=local.cookie.split(';')[0];
 assert.equal((await request(port,'/api/dev/teleport',{host:address,body:{x:2.5,z:.5,autoY:true}})).status,404,'an unauthenticated non-loopback client is hidden before session creation');
 assert.equal((await request(port,'/api/dev/teleport',{host:address,cookie,body:{x:2.5,z:.5,autoY:true}})).status,404);
 assert.equal((await request(port,'/api/dev/teleport/return',{host:address,cookie,body:{}})).status,404);
 assert.equal((await request(port,'/api/dev/time',{host:address,cookie,body:{multiplier:50}})).status,404);
 assert.equal((await request(port,'/devtools/time-control.js',{host:address,cookie})).status,404);
 const unchanged=await request(port,'/api/world',{cookie});assert.equal(unchanged.body.player.x,local.body.player.x);assert.equal(unchanged.body.player.z,local.body.player.z);
});

test('developer teleport supports a validated direct Y landing and returns current player state',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-direct-y-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0];
 const moved=await request(port,'/api/dev/teleport',{cookie,body:{x:1.5,y:0,z:.5,autoY:false}});
 assert.equal(moved.status,200,moved.body?.error);assert.equal(moved.body.player.x,1.5);assert.equal(moved.body.player.y,0);assert.equal(moved.body.player.z,.5);
 assert.equal(moved.body.player.grounded,true);
 assert.deepEqual({x:moved.body.world.player.x,y:moved.body.world.player.y,z:moved.body.world.player.z,grounded:moved.body.world.player.grounded},{x:moved.body.player.x,y:moved.body.player.y,z:moved.body.player.z,grounded:moved.body.player.grounded});
 const current=await request(port,'/api/world',{cookie});assert.deepEqual({x:current.body.player.x,y:current.body.player.y,z:current.body.player.z,grounded:current.body.player.grounded},{x:moved.body.player.x,y:moved.body.player.y,z:moved.body.player.z,grounded:moved.body.player.grounded});
});

test('returning to the previous teleport origin clears the one-shot return target',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-one-shot-')),port=await randomPort();let proc;
 t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0];
 const moved=await request(port,'/api/dev/teleport',{cookie,body:{x:2.5,z:.5,autoY:true}});
 assert.equal(moved.status,200,moved.body?.error);assert.equal(moved.body.world.devTeleport.previousAvailable,true);
 const returned=await request(port,'/api/dev/teleport/return',{cookie,body:{}});
 assert.equal(returned.status,200,returned.body?.error);assert.equal(returned.body.previousPosition,null);
 assert.equal(returned.body.world.devTeleport.previousAvailable,false);
 const duplicate=await request(port,'/api/dev/teleport/return',{cookie,body:{}});
 assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'no-previous-position');
});

test('failed teleport save restores the session player and leaves the persisted save unchanged',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-dev-teleport-save-failure-')),parkedDir=saveDir+'-preserved',port=await randomPort();let proc,parked=false;
 t.after(async()=>{
  await stop(proc);
  await rm(saveDir,{recursive:true,force:true});
  if(parked){await rename(parkedDir,saveDir);parked=false;}
  await rm(saveDir,{recursive:true,force:true});
  await rm(parkedDir,{recursive:true,force:true});
 });
 proc=await boot(root,port,saveDir,'development');
 const initial=await request(port,'/api/world'),cookie=initial.cookie.split(';')[0];
 const id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 const savedPath=join(saveDir,id+'.json'),before=JSON.parse(await readFile(savedPath,'utf8'));
 await rename(saveDir,parkedDir);parked=true;
 await writeFile(saveDir,'temporary file blocks the save directory');
 const failed=await request(port,'/api/dev/teleport',{cookie,body:{x:2.5,z:.5,autoY:true}});
 assert.equal(failed.status,500);
 await rm(saveDir);await rename(parkedDir,saveDir);parked=false;
 const current=await request(port,'/api/world',{cookie});
 assert.deepEqual({x:current.body.player.x,y:current.body.player.y,z:current.body.player.z},{x:initial.body.player.x,y:initial.body.player.y,z:initial.body.player.z});
 const persisted=JSON.parse(await readFile(savedPath,'utf8'));
 assert.deepEqual(persisted.player,before.player,'failed teleport must not modify the persisted player position');
});
