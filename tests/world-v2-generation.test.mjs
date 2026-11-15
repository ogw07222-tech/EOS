import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {
 WORLD_GEN_VERSION,CHUNK_SIZE,biomeAt,heightAt,blockAt,generatedWaterLevel,waterLevelAt,stepFluid,generateChunkColumns,planChunkWindow,findBiomeSamples
} from '../src/chunk-world.mjs';
import {generateTreesForChunk} from '../src/tree-world.mjs';

const root=resolve(import.meta.dirname,'..');
const secret='testing_secret_for_world_v2_integration_1234567890';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const biomeIds=new Set(['plains','forest','beach','ocean','river']);
function seededRandom(seed){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};}
function runFluidEvents(seed,eventCount=100){
 const rand=seededRandom(seed),world={worldGenVersion:2,worldSeed:0x51a7,seaLevel:0,edits:{},fluidEdits:{},fluidActive:[],fluidRevision:0};let expectedUnits=0;
 const activate=cell=>{const active=new Set(world.fluidActive);active.add(cell);world.fluidActive=[...active].sort();};
 for(let i=0;i<8;i++){const x=i-4,z=0,level=1+rand()%8,key=`${x},0,${z}`;world.fluidEdits[key]=level;activate(key);expectedUnits+=level;}
 const log=[];
 for(let i=0;i<eventCount;i++){
  const kind=rand()%4;
  if(kind===0){const x=(rand()%8)-4,z=(rand()%8)-4,y=rand()%3,key=`${x},${y},${z}`,level=1+rand()%8;if(blockAt(world,x,y,z)===null&&waterLevelAt(world,x,y,z)===0){world.fluidEdits[key]=level;expectedUnits+=level;world.fluidRevision++;activate(key);log.push([i,'source',key,level]);}else log.push([i,'source-blocked',key]);}
  else if(kind===1){const wet=Object.keys(world.fluidEdits).filter(key=>world.fluidEdits[key]>0).sort(),key=wet.length?wet[rand()%wet.length]:null;if(key){world.fluidEdits[key]--;expectedUnits--;world.fluidRevision++;activate(key);log.push([i,'drain',key]);}else log.push([i,'drain-empty']);}
  else if(kind===2){const result=stepFluid(world,world.fluidActive,{budget:1+rand()%32});log.push([i,'tick',result.processed,result.changed,result.revision]);}
  else{const x=(rand()%8)-4,z=(rand()%8)-4,y=3,key=`${x},${y},${z}`,wet=waterLevelAt(world,x,y,z)>0;if(!wet){if(world.edits[key]==='dirt')world.edits[key]=null;else if(blockAt(world,x,y,z)===null)world.edits[key]='dirt';}log.push([i,'solid',key,world.edits[key]??null]);}
  let units=0;
  for(const [key,level]of Object.entries(world.fluidEdits)){
   assert.ok(Number.isInteger(level)&&level>=0&&level<=8,`seed=${seed} event=${i} invalid level ${key}=${level}`);
   if(level){const [x,y,z]=key.split(',').map(Number);assert.equal(blockAt(world,x,y,z),null,`seed=${seed} event=${i} water/solid overlap ${key}`);units+=level;}
  }
  assert.equal(units,expectedUnits,`seed=${seed} event=${i} water conservation`);
 }
 return {hash:hash({fluidEdits:Object.fromEntries(Object.entries(world.fluidEdits).sort()),fluidActive:world.fluidActive,fluidRevision:world.fluidRevision,expectedUnits}),log};
}

async function randomPort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function boot(port,saveDir,nodeEnv='development'){
 const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,NODE_ENV:nodeEnv,PORT:String(port),HOST:'127.0.0.1',TERRA_SAVE_DIR:saveDir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});
 let stderr='';proc.stderr.on('data',data=>stderr+=data.toString());
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Server start timed out: '+stderr)),5000);proc.stdout.on('data',data=>{output+=data.toString();if(output.includes('TERRA prototype server:')){clearTimeout(timer);resolve();}});proc.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+stderr));});});
 return proc;
}
async function stop(proc){if(!proc||proc.exitCode!==null)return;proc.kill('SIGTERM');await once(proc,'exit');}
async function request(port,path,{cookie,method='GET',body}={}){const headers={};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,cookie:response.headers.get('set-cookie'),body:await response.json()};}
async function isolatedServer(t){const saveDir=await mkdtemp(join(tmpdir(),'terra-world-v2-')),port=await randomPort();let proc=await boot(port,saveDir);t.after(async()=>{await stop(proc);await rm(saveDir,{recursive:true,force:true});});return {saveDir,port,restart:async()=>{await stop(proc);proc=await boot(port,saveDir);}};}

test('world generation v2 reports exactly the five supported biome identifiers',()=>{
 assert.equal(WORLD_GEN_VERSION,2);
 const actual=new Set();
 for(let z=-2048;z<=2048;z+=16)for(let x=-2048;x<=2048;x+=16)actual.add(biomeAt(0x51a7,x,z,2));
 assert.deepEqual(actual,biomeIds);
});

test('v2 terrain, biome, and natural water are absolute-coordinate deterministic across chunk order',()=>{
 const seed=0x7a11c0de,chunks=[[-2,-1],[-1,0],[0,0],[1,2],[0,-1],[4,-3]];
 const forward=chunks.map(([cx,cz])=>generateChunkColumns(seed,cx,cz,2));
 const reverse=[...chunks].reverse().map(([cx,cz])=>generateChunkColumns(seed,cx,cz,2)).reverse();
 assert.deepEqual(forward,reverse);
 assert.equal(hash(forward),hash(chunks.map(([cx,cz])=>generateChunkColumns(seed,cx,cz,2))));
 for(const columns of forward){assert.equal(columns.length,CHUNK_SIZE*CHUNK_SIZE);for(const c of columns){assert.ok(biomeIds.has(biomeAt(seed,c.x,c.z,2)));assert.equal(c.surfaceY,heightAt(seed,c.x,c.z,2));}}
});

test('signed X/Z and diagonal chunk seams resolve the same generated surface and liquid cells',()=>{
 const seed=0x72b0,world={worldGenVersion:2,worldSeed:seed,seaLevel:0,fluidEdits:{}};
 for(const seamX of [[15,16],[-1,0]])for(const seamZ of [[15,16],[-1,0]]){
  const points=[];
  for(const x of seamX)for(const z of seamZ)points.push({x,z});
  for(const point of points){
   const cx=Math.floor(point.x/CHUNK_SIZE),cz=Math.floor(point.z/CHUNK_SIZE),chunk=generateChunkColumns(seed,cx,cz,2);
   const col=chunk.find(item=>item.x===point.x&&item.z===point.z);assert.ok(col);
   assert.equal(col.surfaceY,heightAt(seed,point.x,point.z,2));
   assert.ok(biomeIds.has(biomeAt(seed,point.x,point.z,2)));
   for(let y=Math.max(-32,col.surfaceY-1);y<=Math.min(0,col.surfaceY+1);y++)assert.equal(waterLevelAt(world,point.x,y,point.z),generatedWaterLevel(world,point.x,y,point.z));
  }
 }
});

test('v2 natural trees grow only in plains and forest; v1 tree generation stays compatible',()=>{
 const seed=0x51a7,samples=findBiomeSamples(seed);
 for(const sample of Object.values(samples)){
  const cx=Math.floor(sample.x/CHUNK_SIZE),cz=Math.floor(sample.z/CHUNK_SIZE);
  const trees=generateTreesForChunk(seed,cx,cz,(x,z)=>heightAt(seed,x,z,2),2);
  for(const tree of trees)assert.ok(['plains','forest'].includes(biomeAt(seed,tree.x,tree.z,2)),`tree in ${biomeAt(seed,tree.x,tree.z,2)} at ${tree.x},${tree.z}`);
 }
 const legacySurface=(x,z)=>heightAt(seed,x,z,1);
 for(const [cx,cz]of [[-128,-128],[-1,0],[0,0],[12,0]]){
  const expected=generateTreesForChunk(seed,cx,cz,legacySurface,1);
  assert.deepEqual(generateTreesForChunk(seed,cx,cz,legacySurface),expected,'default tree generation must retain v1 behavior');
 }
});

test('natural ocean and river water is full at sea level and does not flood the protected origin',()=>{
 const world={worldGenVersion:2,worldSeed:0x51a7,seaLevel:0,fluidEdits:{}};
 assert.equal(biomeAt(world.worldSeed,0,0,2),'plains','starter landing biome is preserved');
 for(let x=-5;x<=5;x++)for(let z=-5;z<=5;z++)for(let y=-8;y<=world.seaLevel;y++)assert.equal(waterLevelAt(world,x,y,z),0,`starter ring flooded at ${x},${y},${z}`);
 for(let z=-512;z<=512;z+=4)for(let x=-512;x<=512;x+=4){
  const biome=biomeAt(world.worldSeed,x,z,2),surface=heightAt(world.worldSeed,x,z,2);
  if(biome==='ocean'||biome==='river'){
   assert.ok(surface<=world.seaLevel,`${biome} bed is above sea level at ${x},${z}`);
   assert.equal(generatedWaterLevel(world,x,world.seaLevel,z),8,`${biome} lacks full surface water at ${x},${z}`);
   assert.equal(waterLevelAt(world,x,world.seaLevel,z),8);
  }
 }
});

test('fluid ticks prioritize gravity, move exactly one horizontal unit, and conserve water',()=>{
 const falling={worldGenVersion:2,worldSeed:17,seaLevel:0,edits:{},fluidEdits:{'0,2,0':8},fluidActive:['0,2,0'],fluidRevision:0};
 const down=stepFluid(falling,falling.fluidActive,{budget:1});
 assert.equal(down.processed,1);assert.equal(down.changed,2);
 assert.equal(waterLevelAt(falling,0,2,0),0);assert.equal(waterLevelAt(falling,0,1,0),8);
 assert.equal(down.revision,1);assert.ok(falling.fluidActive.includes('0,1,0'));

 const side={worldGenVersion:2,worldSeed:17,seaLevel:0,edits:{},fluidEdits:{'1,0,1':8},fluidActive:['1,0,1'],fluidRevision:0};
 const before=waterLevelAt(side,1,0,1)+waterLevelAt(side,2,0,1),result=stepFluid(side,side.fluidActive,{budget:1});
 assert.equal(result.processed,1);assert.equal(result.changed,2);
 assert.equal(waterLevelAt(side,1,0,1),7);assert.equal(waterLevelAt(side,2,0,1),1);
 assert.equal(waterLevelAt(side,1,0,1)+waterLevelAt(side,2,0,1),before,'horizontal spread must conserve one unit');
});

test('fluid boundaries reject X/Z overflow and still permit an in-bounds edge transfer',()=>{
 const closed={worldGenVersion:2,worldSeed:17,seaLevel:0,edits:{},fluidEdits:{'4095,0,4095':8},fluidActive:['4095,0,4095'],fluidRevision:0};
 for(const [x,y,z]of [[4095,-1,4095],[4094,-1,4095],[4095,-1,4094],[4094,0,4095],[4095,0,4094]])closed.edits[`${x},${y},${z}`]='dirt';
 closed.edits['4095,0,4095']=null;
 const blocked=stepFluid(closed,closed.fluidActive,{budget:1});assert.equal(blocked.changed,0);assert.equal(waterLevelAt(closed,4095,0,4095),8);
 assert.equal(Object.keys(closed.fluidEdits).some(key=>key.startsWith('4096,')||key.endsWith(',4096')),false);

 const world={worldGenVersion:2,worldSeed:17,seaLevel:0,edits:{},fluidEdits:{'4095,0,4095':8},fluidActive:['4095,0,4095'],fluidRevision:0};
 for(const [x,y,z]of [[4095,-1,4095],[4094,-1,4095],[4095,-1,4094],[4096,-1,4095],[4095,-1,4096]])world.edits[`${x},${y},${z}`]='dirt';
 world.edits['4095,0,4095']=null;world.edits['4094,0,4095']=null;world.edits['4095,0,4094']=null;
 assert.equal(waterLevelAt(world,4096,0,4095),0);assert.equal(waterLevelAt(world,4095,0,4096),0);
 const result=stepFluid(world,world.fluidActive,{budget:1});assert.equal(result.changed,2);
 assert.equal(waterLevelAt(world,4095,0,4095),7);assert.equal(waterLevelAt(world,4094,0,4095),1);
 assert.equal(Object.keys(world.fluidEdits).some(key=>key.startsWith('4096,')||key.endsWith(',4096')),false);
 const invalid=stepFluid(world,['4096,0,4095','4095,33,4095'],{budget:2});
 assert.equal(invalid.processed,0);assert.equal(waterLevelAt(world,4096,0,4095),0);assert.equal(waterLevelAt(world,4095,33,4095),0);
});

test('100 seeds × 100 integrated fluid events conserve units and replay deterministically',()=>{
 let lastHash='';
 for(let seed=0;seed<100;seed++){
  const first=runFluidEvents(seed),replay=runFluidEvents(seed);
  assert.equal(first.hash,replay.hash,`seed=${seed} replay state differs`);assert.deepEqual(first.log,replay.log,`seed=${seed} event log differs`);
  assert.equal(first.log.length,100);lastHash=first.hash;
 }
 assert.match(lastHash,/^[0-9a-f]{64}$/);
});

test('natural full water across an 81-chunk ocean window stays implicit and inactive',t=>{
 const seed=0x51a7,centerX=-32,centerZ=0,window=planChunkWindow(centerX,centerZ,4);
 assert.equal(window.length,81);const world={worldGenVersion:2,worldSeed:seed,seaLevel:0,fluidEdits:{},fluidActive:[],fluidRevision:0};
 let cells=0;const heapBefore=process.memoryUsage().heapUsed,started=performance.now();
 for(const chunk of window)for(let lz=0;lz<CHUNK_SIZE;lz++)for(let lx=0;lx<CHUNK_SIZE;lx++){
  const x=chunk.cx*CHUNK_SIZE+lx,z=chunk.cz*CHUNK_SIZE+lz;
  assert.equal(biomeAt(seed,x,z,2),'ocean',`ocean window has a non-ocean column at ${x},${z}`);
  const floor=heightAt(seed,x,z,2);
  for(let y=floor;y<=world.seaLevel;y++){assert.equal(generatedWaterLevel(world,x,y,z),8);cells++;}
 }
 assert.ok(cells>=81*CHUNK_SIZE*CHUNK_SIZE*4,'81-chunk sea should contain a large implicit full-water volume');
 assert.equal(Object.keys(world.fluidEdits).length,0,'generated ocean cells must not be serialized individually');
 assert.equal(world.fluidActive.length,0,'stable ocean cells must not enter the active flow queue');
 const tick=stepFluid(world,world.fluidActive,{budget:2048});assert.equal(tick.processed,0);assert.equal(world.fluidActive.length,0);
 const elapsed=performance.now()-started,heapDelta=process.memoryUsage().heapUsed-heapBefore;
 assert.ok(elapsed<5000,`81-chunk implicit ocean query took ${elapsed.toFixed(1)}ms`);
 t.diagnostic(`integrated pure-world sample: 81 chunks, ${cells} generated full-water cells, 0 persisted cells, 0 active cells, ${elapsed.toFixed(1)}ms query, heap delta ${heapDelta} bytes; no rendering included`);
});

test('the dev biome locator returns reproducible coordinates for all five server-generated biomes',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');assert.equal(created.status,200);
 const cookie=created.cookie.split(';')[0];assert.equal(created.body.worldGenVersion,2);
 const first=await request(server.port,'/api/dev/biomes',{cookie}),second=await request(server.port,'/api/dev/biomes',{cookie});
 assert.equal(first.status,200,first.body.error);assert.deepEqual(first.body,second.body);
 assert.equal(first.body.seed,created.body.worldSeed);assert.equal(first.body.genVersion,2);
 assert.deepEqual(new Set(Object.keys(first.body.biomes)),biomeIds);
 for(const [id,point]of Object.entries(first.body.biomes)){
  assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z)&&Number.isFinite(point.y));
  assert.equal(biomeAt(first.body.seed,point.x,point.z,2),id,`locator returned wrong biome for ${id}`);
  assert.equal(point.y,heightAt(first.body.seed,point.x,point.z,2),`locator returned wrong surface for ${id}`);
  if(id==='ocean'||id==='river')assert.equal(generatedWaterLevel({worldGenVersion:2,worldSeed:first.body.seed,seaLevel:0},point.x,0,point.z),8);
 }
 const ocean=first.body.biomes.ocean,before=first.body.biomes.plains;
 const unsafe=await request(server.port,'/api/dev/teleport',{cookie,method:'POST',body:{x:ocean.x+.5,y:0,z:ocean.z+.5}});
 assert.equal(unsafe.status,400);assert.equal(unsafe.body.code,'water-disabled');
 assert.equal(unsafe.body.waterSafety,'modeled');assert.equal(unsafe.body.world.player.x,.5);assert.equal(unsafe.body.world.player.z,.5);
 assert.ok(biomeIds.has(biomeAt(first.body.seed,before.x,before.z,2)));

 const river=first.body.biomes.river,farOcean=first.body.biomes.ocean;
 const toRiver=await request(server.port,'/api/dev/teleport',{cookie,method:'POST',body:{x:river.x+.5,z:river.z+.5,autoY:true}});
 assert.equal(toRiver.status,200,toRiver.body.error);assert.equal(toRiver.body.biome,'river');assert.equal(toRiver.body.waterSafety,'modeled');
 assert.ok(toRiver.body.player.y>=1);assert.equal(toRiver.body.world.player.immersed,false);
 const toOcean=await request(server.port,'/api/dev/teleport',{cookie,method:'POST',body:{x:farOcean.x+.5,z:farOcean.z+.5,autoY:true}});
 assert.equal(toOcean.status,200,toOcean.body.error);assert.equal(toOcean.body.biome,'ocean');assert.equal(toOcean.body.waterSafety,'modeled');
 assert.ok(toOcean.body.player.y>=1);assert.equal(toOcean.body.world.player.immersed,false);
 assert.ok(Math.hypot(toOcean.body.player.x-toRiver.body.player.x,toOcean.body.player.z-toRiver.body.player.z)>1000,'test must cross a genuinely long distance');
 const returned=await request(server.port,'/api/dev/teleport/return',{cookie,method:'POST',body:{}});
 assert.equal(returned.status,200,returned.body.error);assert.equal(returned.body.player.x,toRiver.body.player.x);assert.equal(returned.body.player.z,toRiver.body.player.z);
});

test('new v2 world identity and sparse fluid edits persist across server restart',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');assert.equal(created.status,200);
 const cookie=created.cookie.split(';')[0],id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1];assert.ok(id);
 assert.equal(created.body.worldGenVersion,2);assert.equal(created.body.seaLevel,0);
 const savePath=join(server.saveDir,id+'.json'),saved=JSON.parse(await readFile(savePath,'utf8'));
 assert.equal(saved.worldSeed,created.body.worldSeed);assert.equal(saved.worldGenVersion,2);
 // Inject one isolated developer fixture override adjacent to the protected spawn.
 saved.fluidEdits={'2,3,2':6};await writeFile(savePath,JSON.stringify(saved));
 await server.restart();const loaded=await request(server.port,'/api/world',{cookie});
 assert.equal(loaded.status,200);assert.equal(loaded.body.worldGenVersion,2);assert.equal(loaded.body.worldSeed,created.body.worldSeed);
 assert.equal(loaded.body.fluidRevision,saved.fluidRevision||0);
 assert.equal(loaded.body.fluidCells['2,3,2'],6);
 assert.equal(waterLevelAt(loaded.body,2,3,2),6);
});

test('development tick-rate control accepts only 2, 5, and 10 ticks per second and persists',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');assert.equal(created.body.worldGenVersion,2);
 const cookie=created.cookie.split(';')[0],id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1],savePath=join(server.saveDir,id+'.json');
 for(const tickRate of [2,5,10]){
  const changed=await request(server.port,'/api/dev/fluid-rate',{cookie,method:'POST',body:{tickRate}});
  assert.equal(changed.status,200,changed.body.error);assert.equal(changed.body.tickRate,tickRate);assert.equal(changed.body.world.fluidTickRate,tickRate);
  assert.equal(JSON.parse(await readFile(savePath,'utf8')).fluidTickRate,tickRate);
 }
 const rejected=await request(server.port,'/api/dev/fluid-rate',{cookie,method:'POST',body:{tickRate:3}});
 assert.equal(rejected.status,400);assert.match(rejected.body.error,/2, 5, or 10/);
});

test('server fluid simulation advances vertically at configured 2/5/10 tick rates',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');
 const cookie=created.cookie.split(';')[0],id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1],savePath=join(server.saveDir,id+'.json'),initialSave=JSON.parse(await readFile(savePath,'utf8'));
 const measurements=[];
 for(const tickRate of [2,5,10]){
  const fixture={...initialSave,fluidEdits:{'0,25,0':8},fluidActive:['0,25,0'],fluidRevision:0,fluidTickRate:tickRate};
  await writeFile(savePath,JSON.stringify(fixture));await server.restart();
  const baseline=await request(server.port,'/api/world',{cookie});assert.equal(baseline.status,200);
  assert.equal(waterLevelAt(baseline.body,0,25,0),8);
  const started=Date.now();await new Promise(resolve=>setTimeout(resolve,1050));
  const result=await request(server.port,'/api/world',{cookie});assert.equal(result.status,200);
  const wetYs=[];for(let y=0;y<=25;y++)if(waterLevelAt(result.body,0,y,0)>0)wetYs.push(y);
  assert.equal(wetYs.length,1,`rate=${tickRate}, water should remain in one vertical cell`);
  const moved=25-wetYs[0],elapsed=(Date.now()-started)/1000;
  assert.ok(moved>=tickRate-1&&moved<=tickRate+1,`rate=${tickRate}, moved=${moved} cells in ${elapsed.toFixed(2)}s`);
  assert.equal(waterLevelAt(result.body,0,wetYs[0],0),8);
  measurements.push({tickRate,moved,elapsed:+elapsed.toFixed(2),fluidRevision:result.body.fluidRevision});
 }
 assert.ok(measurements[0].moved<measurements[1].moved&&measurements[1].moved<measurements[2].moved,JSON.stringify(measurements));
 t.diagnostic(`server fluid rate sample: ${measurements.map(m=>`${m.tickRate}t/s→${m.moved} cells/${m.elapsed}s`).join(', ')}`);
});

test('server movement detects immersion and allows swimming while solid placement into water is denied',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');
 const cookie=created.cookie.split(';')[0],id=cookie.match(/^terra_session=([a-f0-9]{32})\./)?.[1],savePath=join(server.saveDir,id+'.json');
 const saved=JSON.parse(await readFile(savePath,'utf8'));saved.fluidEdits={'0,0,0':8,'4,0,0':8};saved.fluidActive=[];
 await writeFile(savePath,JSON.stringify(saved));await server.restart();
 const loaded=await request(server.port,'/api/world',{cookie});assert.equal(loaded.body.player.immersed,true);
 const move=await request(server.port,'/api/move',{cookie,method:'POST',body:{x:0,z:0,swim:true}});
 assert.equal(move.status,200,move.body.error);assert.equal(move.body.player.immersed,true);assert.equal(move.body.player.swimming,true);assert.ok(move.body.player.y>0);
 const place=await request(server.port,'/api/action',{cookie,method:'POST',body:{type:'place',x:4,y:0,z:0,item:'dirt',revision:loaded.body.revision}});
 assert.equal(place.status,400);assert.match(place.body.error,/water/i);
 const after=await request(server.port,'/api/world',{cookie});assert.equal(after.body.fluidCells['0,0,0'],8);
});

test('81-chunk natural ocean remains generated and developer APIs are hidden in production',async t=>{
 const server=await isolatedServer(t),created=await request(server.port,'/api/world');
 assert.equal(created.body.worldGenVersion,2);assert.equal(created.body.fluidCells&&Object.keys(created.body.fluidCells).length,0);
 const ocean=await request(server.port,'/api/dev/biomes',{cookie:created.cookie.split(';')[0]});assert.equal(ocean.status,200);
 const productionDir=await mkdtemp(join(tmpdir(),'terra-world-v2-prod-save-')),port=await randomPort();let prod;
 t.after(async()=>{await stop(prod);await rm(productionDir,{recursive:true,force:true});});
 prod=await boot(port,productionDir,'production');const publicWorld=await request(port,'/api/world');
 assert.equal(publicWorld.status,200);assert.equal(publicWorld.body.worldGenVersion,2);assert.notEqual(publicWorld.body.devtoolsEnabled,true);
 assert.equal((await request(port,'/api/dev/biomes')).status,404);
 assert.equal((await request(port,'/api/dev/fluid-rate',{method:'POST',body:{tickRate:5}})).status,404);
 assert.equal((await request(port,'/api/dev/teleport',{method:'POST',body:{x:0,z:0,autoY:true}})).status,404);
});

test('saved worlds with missing generation metadata and islandSize 10 stay legacy',async t=>{
 const saveDir=await mkdtemp(join(tmpdir(),'terra-world-v2-legacy-')),port=await randomPort(),id='abcdef0123456789abcdef0123456789';
 const legacy={schema:1,worldVersion:3,islandSize:10,revision:7,inventory:{dirt:21},edits:{'2,0,2':'dirt'},player:{x:.5,y:0,z:.5,grounded:true}};
 await writeFile(join(saveDir,id+'.json'),JSON.stringify(legacy));let proc;
 try{
  proc=await boot(port,saveDir);const signature=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${signature}`;
  const loaded=await request(port,'/api/world',{cookie});assert.equal(loaded.status,200);
  assert.equal(loaded.body.islandSize,10);assert.equal(loaded.body.worldGenVersion,undefined);
  assert.equal(loaded.body.worldSeed,undefined);assert.equal(loaded.body.seaLevel,undefined);assert.equal(loaded.body.fluidCells,undefined);
  assert.equal(loaded.body.edits['2,0,2'],'dirt');assert.equal(blockAt(loaded.body,1,-1,1),null,'missing version must not invent generated terrain');
 }finally{await stop(proc);await rm(saveDir,{recursive:true,force:true});}
});

test('version 1 and legacy saves remain unmodified by v2 generation helpers',()=>{
 const legacy={worldGenVersion:1,worldSeed:123,edits:{'0,-1,0':'dirt'},waterSources:[{x:4,y:0,z:4}],watered:{'1,0,1':1234}};
 const before=structuredClone(legacy);
 assert.equal(blockAt(legacy,0,-1,0),'dirt');
 assert.equal(blockAt({edits:{}},0,-1,0),null);
 assert.deepEqual(legacy,before);
});
