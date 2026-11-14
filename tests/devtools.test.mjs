import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {createTimeControl,DEV_TIME_MULTIPLIERS,BASE_GAME_MINUTES_PER_REAL_MINUTE} from '../devtools/time-control-server.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_terra_game_1234567890';

async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function boot(cwd,port,saveDir,nodeEnv){
 const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:saveDir,TERRA_SESSION_SECRET:secret,NODE_ENV:nodeEnv},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('server startup timed out: '+stderr)),5000);child.stdout.on('data',b=>{out+=b.toString();if(out.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${stderr}`));});});
 return child;
}
async function stop(child){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function request(port,path,{cookie,body,origin}={}){
 const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
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

test('development server exposes and validates local time controls, production does not',async()=>{
 const port=await randomPort(),saveDir=await mkdtemp(join(tmpdir(),'terra-dev-prod-save-'));let proc;
 try{
  proc=await boot(root,port,saveDir,'production');
  const world=await request(port,'/api/world');assert.equal(world.status,200);assert.notEqual(world.body.devtoolsEnabled,true);assert.equal(world.body.gameClock,undefined);
  assert.equal((await request(port,'/api/dev/time')).status,404);assert.equal((await request(port,'/devtools/time-control.js')).status,404);
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
  const id='10203040506070801020304050607080',port=await randomPort();
  await writeFile(join(saveDir,id+'.json'),JSON.stringify({schema:1,worldVersion:3,islandSize:10,revision:0,inventory:{dirt:0,wood:0,stone:0,wheat:0,wheat_seed:0,sapling:0,wateringCanUses:10,items:{},tools:{},quickSlots:[],selectedSlot:0},edits:{},machines:[],trees:[{id:'offline-sapling',x:3,y:0,z:1,stage:0,progress:179000}],harvestedTrees:[],tilled:[[0,0,3]],crops:[{id:'base-wheat',x:0,y:0,z:3,stage:1,progress:59000}],watered:{},waterSources:[],harvestedCrops:[],oreNodes:[],player:{x:.5,y:0,z:.5,grounded:true}}));
  proc=await boot(fixture,port,saveDir,'development');const signature=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${signature}`;
  let world=await request(port,'/api/world',{cookie});assert.equal(world.status,200);assert.notEqual(world.body.devtoolsEnabled,true);
  assert.equal((await request(port,'/api/dev/time')).status,404);assert.equal((await request(port,'/devtools/time-control.js')).status,404);assert.equal((await request(port,'/')).status,200);
  await new Promise(resolve=>setTimeout(resolve,1000));world=await request(port,'/api/world',{cookie});assert.equal(world.body.crops[0].stage,2,'the base 12× game clock still grows wheat without devtools');assert.equal(world.body.trees[0].stage,1,'the base 12× game clock still grows saplings without devtools');
 }finally{await stop(proc);await rm(fixture,{recursive:true,force:true});await rm(saveDir,{recursive:true,force:true});}
});
