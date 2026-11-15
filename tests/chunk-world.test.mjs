import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 CHUNK_SIZE,DEFAULT_CHUNK_RADIUS,MIN_CHUNK_RADIUS,MAX_CHUNK_RADIUS,LEGACY_WORLD_GEN_VERSION,WORLD_GEN_VERSION,WORLD_MIN_Y,WORLD_MAX_Y,HEIGHT_CACHE_MAX_ENTRIES,
 chunkCoord,localCoord,chunkKey,heightAt,blockAt,generateChunkColumns,planChunkWindow,isChunkJobCurrent
} from '../src/chunk-world.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('chunk helpers use floor division and normalized negative local coordinates',()=>{
 assert.equal(CHUNK_SIZE,16);assert.equal(DEFAULT_CHUNK_RADIUS,4);assert.equal(MIN_CHUNK_RADIUS,2);assert.equal(MAX_CHUNK_RADIUS,6);
 assert.equal(chunkCoord(-1),-1);assert.equal(localCoord(-1),15);
 assert.equal(chunkCoord(-16),-1);assert.equal(localCoord(-16),0);
 assert.equal(chunkCoord(-17),-2);assert.equal(localCoord(-17),15);
 assert.equal(chunkCoord(16),1);assert.equal(localCoord(16),0);
 assert.equal(chunkKey(-2,3),'-2,3');
});

test('new world terrain is versioned, layered, and leaves legacy worlds ungenerated',()=>{
 assert.equal(LEGACY_WORLD_GEN_VERSION,1);assert.equal(WORLD_GEN_VERSION,2);assert.equal(WORLD_MIN_Y,-32);assert.equal(WORLD_MAX_Y,32);
 const world={worldSeed:'starter-seed',worldGenVersion:LEGACY_WORLD_GEN_VERSION,edits:{}};
 assert.equal(heightAt(world.worldSeed,0,0,LEGACY_WORLD_GEN_VERSION),0);
 assert.equal(blockAt(world,0,-1,0),'grass');
 assert.equal(blockAt(world,0,-2,0),'dirt');assert.equal(blockAt(world,0,-3,0),'dirt');assert.equal(blockAt(world,0,-4,0),'dirt');
 assert.equal(blockAt(world,0,-5,0),'stone');assert.equal(blockAt(world,0,-32,0),'stone');
 assert.equal(blockAt(world,0,0,0),null);assert.equal(blockAt(world,0,33,0),null);
 assert.equal(blockAt({edits:{}},0,-1,0),null,'legacy saves must not receive an invented terrain base');
 assert.equal(blockAt({edits:{'4,2,-3':'dirt'}},4,2,-3),'dirt','legacy saved edits remain addressable');
});

test('safe landing plateau is exactly flat over its inclusive 12 by 12 footprint',()=>{
 for(let z=-6;z<=5;z++)for(let x=-6;x<=5;x++)assert.equal(heightAt('any-seed',x,z),0,`${x},${z}`);
});

test('seeded global noise is reproducible and independent of chunk generation order',()=>{
 const chunks=[[-2,-1],[-1,0],[0,0],[1,2],[0,-1]];
 const forward=chunks.map(([cx,cz])=>generateChunkColumns('seed-A',cx,cz));
 const reverse=[...chunks].reverse().map(([cx,cz])=>generateChunkColumns('seed-A',cx,cz)).reverse();
 assert.deepEqual(forward,reverse);
 assert.equal(hash(forward),hash(chunks.map(([cx,cz])=>generateChunkColumns('seed-A',cx,cz))));
 assert.notEqual(hash(generateChunkColumns('seed-A',2,-3)),hash(generateChunkColumns('seed-B',2,-3)),'different seeds should change terrain outside the landing plateau');
});

test('generated chunks contain 256 unique global columns and meet continuously at X/Z borders',()=>{
 const columns=generateChunkColumns('continuity',0,0),byKey=new Map(columns.map(c=>[`${c.x},${c.z}`,c]));
 assert.equal(columns.length,256);assert.equal(byKey.size,256);
 for(const [cx,cz] of [[0,0],[-1,0],[0,-1],[-1,-1]]){
  const a=generateChunkColumns('continuity',cx,cz),b=generateChunkColumns('continuity',cx+1,cz),south=generateChunkColumns('continuity',cx,cz+1);
  const amap=new Map(a.map(c=>[`${c.x},${c.z}`,c]));const bmap=new Map(b.map(c=>[`${c.x},${c.z}`,c]));const smap=new Map(south.map(c=>[`${c.x},${c.z}`,c]));
  for(let i=0;i<CHUNK_SIZE;i++){
   const east=amap.get(`${cx*16+15},${cz*16+i}`).surfaceY,west=bmap.get(`${(cx+1)*16},${cz*16+i}`).surfaceY;
   const north=amap.get(`${cx*16+i},${cz*16+15}`).surfaceY,southHeight=smap.get(`${cx*16+i},${(cz+1)*16}`).surfaceY;
   assert.ok(Math.abs(east-west)<=1,`X seam ${cx},${cz},${i}: ${east}/${west}`);
   assert.ok(Math.abs(north-southHeight)<=1,`Z seam ${cx},${cz},${i}: ${north}/${southHeight}`);
  }
 }
});

test('saved edits take precedence over generated blocks and air edits remove terrain',()=>{
 const world={worldSeed:42,worldGenVersion:1,edits:{'2,-1,2':null,'3,0,2':'dirt'}};
 assert.equal(blockAt(world,2,-1,2),null);
 assert.equal(blockAt(world,3,0,2),'dirt');
 assert.equal(blockAt(world,2,-1,2),null);
});

test('height cache stays bounded and eviction preserves deterministic samples',()=>{
 assert.equal(HEIGHT_CACHE_MAX_ENTRIES,131072);
 const expected=heightAt('cache-eviction',123456,-76543,1);
 for(let i=0;i<HEIGHT_CACHE_MAX_ENTRIES;i++)heightAt('cache-churn',i+100000,-500000,1);
 assert.equal(heightAt('cache-eviction',123456,-76543,1),expected,'recomputing an evicted sample must preserve terrain');
});

test('stream plan loads 81 radius-4 chunks center first and unload diff is a 9-tile strip',()=>{
 const initial=planChunkWindow(-1,2,DEFAULT_CHUNK_RADIUS);
 assert.equal(initial.length,81);assert.deepEqual(initial[0],{cx:-1,cz:2,key:'-1,2',ring:0});
 assert.equal(initial.at(-1).ring,4);assert.equal(new Set(initial.map(c=>c.key)).size,81);
 const moved=planChunkWindow(0,2,DEFAULT_CHUNK_RADIUS),oldKeys=new Set(initial.map(c=>c.key)),newKeys=new Set(moved.map(c=>c.key));
 assert.equal([...newKeys].filter(key=>!oldKeys.has(key)).length,9,'moving east requests one new 9-chunk column');
 assert.equal([...oldKeys].filter(key=>!newKeys.has(key)).length,9,'the distant 9-chunk column can be released');
 assert.equal(planChunkWindow(0,0,2).length,25);assert.equal(planChunkWindow(0,0,6).length,169);
});

test('queued chunk work is rejected after movement, unload, or generation replacement',()=>{
 const desired=new Set(planChunkWindow(0,0,2).map(c=>c.key)),job={cx:1,cz:-1,generation:7};
 assert.equal(isChunkJobCurrent(job,7,desired),true);
 assert.equal(isChunkJobCurrent(job,8,desired),false,'old generation is stale');
 desired.delete('1,-1');assert.equal(isChunkJobCurrent(job,7,desired),false,'unloaded chunk is not rebuilt');
});
