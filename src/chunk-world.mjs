import {mineralAt} from './mineral-world.mjs';

// Pure deterministic terrain primitives shared by the authoritative server and
// the WebGL client. Coordinates are world-space block coordinates (1 block=1m).
export const CHUNK_SIZE=16;
export const DEFAULT_CHUNK_RADIUS=4;
export const MIN_CHUNK_RADIUS=2;
export const MAX_CHUNK_RADIUS=6;
export const LEGACY_WORLD_GEN_VERSION=1;
export const WORLD_GEN_VERSION=2;
export const WORLD_MIN_Y=-32;
export const WORLD_MAX_Y=32;
export const HEIGHT_CACHE_MAX_ENTRIES=131072;

// LRU bounds memory while keeping height samples hot across a chunk's many
// vertical block queries. Cache contents never participate in terrain semantics.
const heightCache=new Map();

function finiteCoordinate(value,name){
 if(!Number.isFinite(value))throw new TypeError(`${name} must be a finite number`);
 return value;
}

/** Return the chunk index for one world-space X or Z coordinate. */
export function chunkCoord(worldCoordinate){
 return Math.floor(finiteCoordinate(worldCoordinate,'worldCoordinate')/CHUNK_SIZE);
}

/** Return the normalized local coordinate within a chunk, including negatives. */
export function localCoord(worldCoordinate){
 const value=finiteCoordinate(worldCoordinate,'worldCoordinate');
 return value-Math.floor(value/CHUNK_SIZE)*CHUNK_SIZE;
}

export function chunkKey(cx,cz){
 if(!Number.isInteger(cx)||!Number.isInteger(cz))throw new TypeError('chunk coordinates must be integers');
 return `${cx},${cz}`;
}

/** Build a Chebyshev-radius window with the player's chunk first, then outward. */
export function planChunkWindow(centerX,centerZ,radius=DEFAULT_CHUNK_RADIUS){
 if(!Number.isInteger(centerX)||!Number.isInteger(centerZ)||!Number.isInteger(radius)||radius<MIN_CHUNK_RADIUS||radius>MAX_CHUNK_RADIUS)throw new RangeError('invalid chunk window');
 const plan=[];
 for(let ring=0;ring<=radius;ring++)for(let dz=-ring;dz<=ring;dz++)for(let dx=-ring;dx<=ring;dx++)if(Math.max(Math.abs(dx),Math.abs(dz))===ring){const cx=centerX+dx,cz=centerZ+dz;plan.push({cx,cz,key:chunkKey(cx,cz),ring});}
 return plan;
}

/** Guard queued work against a moved player or replaced world generation. */
export function isChunkJobCurrent(job,generation,desiredKeys){
 return !!job&&job.generation===generation&&desiredKeys instanceof Set&&desiredKeys.has(chunkKey(job.cx,job.cz));
}

function seedHash(seed){
 const text=String(seed);let h=0x811c9dc5;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}
 h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;
 return h>>>0;
}

function lattice(seed,gx,gz){
 let h=seedHash(seed);
 h^=Math.imul(gx|0,0x9e3779b1);h=Math.imul(h^(h>>>16),0x85ebca6b);
 h^=Math.imul(gz|0,0xc2b2ae35);h=Math.imul(h^(h>>>13),0x27d4eb2f);h^=h>>>15;
 return (h>>>0)/0xffffffff*2-1;
}

const smooth=t=>t*t*(3-2*t);
function valueNoise(seed,x,z,scale){
 const sx=x/scale,sz=z/scale,x0=Math.floor(sx),z0=Math.floor(sz),tx=smooth(sx-x0),tz=smooth(sz-z0);
 const a=lattice(seed,x0,z0),b=lattice(seed,x0+1,z0),c=lattice(seed,x0,z0+1),d=lattice(seed,x0+1,z0+1);
 const north=a+(b-a)*tx,south=c+(d-c)*tx;
 return north+(south-north)*tz;
}

function validateGeneration(seed,x,z,genVersion){
 finiteCoordinate(x,'x');finiteCoordinate(z,'z');
 if(genVersion!==LEGACY_WORLD_GEN_VERSION&&genVersion!==WORLD_GEN_VERSION)throw new RangeError(`Unsupported world generation version: ${genVersion}`);
 // String conversion is intentional: numeric and textual seeds have distinct,
 // stable worlds, while all JS JSON-compatible seed values remain usable.
 return String(seed);
}

const BIOMES=Object.freeze(['plains','forest','beach','ocean','river']);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function forestValue(seed,x,z){return valueNoise(seed,x,z,144);}
function coastAt(seed,z){return -300+valueNoise(seed,0,z,768)*52;}
function riverAt(seed,x){return 38+valueNoise(seed,x,0,512)*54;}
function biomeV1(seed,x,z){
 if(x>=-8&&x<=7&&z>=-8&&z<=7)return 'plains';
 return forestValue(seed,x,z)>.15?'forest':'plains';
}
/** Deterministic original biome lookup. Version 1 is retained for existing saves. */
export function biomeAt(seed,x,z,genVersion=WORLD_GEN_VERSION){
 validateGeneration(seed,x,z,genVersion);
 if(genVersion===LEGACY_WORLD_GEN_VERSION)return biomeV1(seed,x,z);
 if(x>=-6&&x<=5&&z>=-6&&z<=5)return 'plains';
 const coast=coastAt(seed,z),riverX0=coast-8,riverX1=coast+900;
 if(x>=riverX0&&x<=riverX1&&Math.abs(z-riverAt(seed,x))<=2.5)return 'river';
 if(x<coast-8)return 'ocean';
 if(x<coast+18)return 'beach';
 return forestValue(seed,x,z)>.15?'forest':'plains';
}

function heightV2(seed,x,z){
 if(x>=-6&&x<=5&&z>=-6&&z<=5)return 0;
 const biome=biomeAt(seed,x,z,WORLD_GEN_VERSION);
 const broad=valueNoise(seed,x,z,160)*2.8;
 const detail=valueNoise(seed,x+7919,z-104729,36)*.65;
 if(biome==='ocean')return -5+Math.round(valueNoise(seed,x,z,72)*1.25);
 if(biome==='river')return -2+Math.max(-1,Math.min(0,Math.round(valueNoise(seed,x,z,48)*.35)));
 if(biome==='beach'){
  const coast=coastAt(seed,z),shore=(x-(coast-8))/26;
  return Math.round(-4+6*clamp(shore,0,1)+broad*.05+detail*.05);
 }
 return 6+Math.round(broad+detail);
}

/** Deterministic, globally sampled smooth field. The starter landing area is flat. */
export function heightAt(seed,x,z,genVersion=WORLD_GEN_VERSION){
 const worldSeed=validateGeneration(seed,x,z,genVersion);
 const cacheKey=JSON.stringify([worldSeed,genVersion,x,z]);
 if(heightCache.has(cacheKey)){
  const cached=heightCache.get(cacheKey);heightCache.delete(cacheKey);heightCache.set(cacheKey,cached);return cached;
 }
 let height;
 if(genVersion===WORLD_GEN_VERSION)height=heightV2(worldSeed,x,z);
 else if(x>=-6&&x<=5&&z>=-6&&z<=5)height=0;
 else{
  // Broad, low-amplitude value noise makes an open field. Both octaves sample
  // global coordinates, so chunk build order cannot introduce seams.
  const broad=valueNoise(worldSeed,x,z,64)*2.25;
  const detail=valueNoise(worldSeed,x+7919,z-104729,24)*.45;
  height=Math.round(broad+detail);
 }
 if(heightCache.size>=HEIGHT_CACHE_MAX_ENTRIES)heightCache.delete(heightCache.keys().next().value);
 heightCache.set(cacheKey,height);
 return height;
}

function editAt(world,x,y,z){
 const edits=world?.edits;
 if(!edits||typeof edits!=='object'||Array.isArray(edits))return {found:false,value:null};
 const key=`${x},${y},${z}`;
 return Object.hasOwn(edits,key)?{found:true,value:edits[key]}:{found:false,value:null};
}

/** Resolve edits first, then generated terrain only for versioned new worlds. */
export function blockAt(world,x,y,z){
 if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z))return null;
 const edit=editAt(world,x,y,z);if(edit.found)return edit.value;
 if(y<WORLD_MIN_Y||y>WORLD_MAX_Y||!world||![LEGACY_WORLD_GEN_VERSION,WORLD_GEN_VERSION].includes(world.worldGenVersion))return null;
 const surfaceY=heightAt(world.worldSeed,x,z,world.worldGenVersion);
 if(y>=surfaceY)return null;
 if(y===surfaceY-1){const biome=biomeAt(world.worldSeed,x,z,world.worldGenVersion);return biome==='beach'||biome==='ocean'||biome==='river'?'sand':'grass';}
 if(y>=surfaceY-4)return 'dirt';
 const mineral=mineralAt(world.worldSeed,x,y,z,surfaceY);if(mineral)return mineral;
 return 'stone';
}

const parseCellKey=value=>value.split(',').map(Number);
/** Static generated liquid, compactly derived from the biome and terrain. */
export function generatedWaterLevel(world,x,y,z){
 if(!world||world.worldGenVersion!==WORLD_GEN_VERSION||!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z)||x< -4096||x>=4096||z< -4096||z>=4096||y<WORLD_MIN_Y||y>WORLD_MAX_Y)return 0;
 if(blockAt(world,x,y,z)!==null)return 0;
 const biome=biomeAt(world.worldSeed,x,z,world.worldGenVersion),seaLevel=Number.isInteger(world.seaLevel)?world.seaLevel:0;
 if((biome!=='ocean'&&biome!=='beach'&&biome!=='river')||y<heightAt(world.worldSeed,x,z,world.worldGenVersion)||y>seaLevel)return 0;
 return 8;
}
/** Resolve persisted fluid edits over deterministic generated water. */
export function waterLevelAt(world,x,y,z){
 if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z)||x< -4096||x>=4096||z< -4096||z>=4096||y<WORLD_MIN_Y||y>WORLD_MAX_Y)return 0;
 if(blockAt(world,x,y,z)!==null)return 0;
 const cellKey=`${x},${y},${z}`,edits=world?.fluidEdits||world?.fluidCells;
 if(edits&&Object.hasOwn(edits,cellKey))return edits[cellKey];
 return generatedWaterLevel(world,x,y,z);
}
export function isWaterAt(world,x,y,z){return waterLevelAt(world,x,y,z)>0;}

/** Find one stable coordinate for each biome without depending on chunk order. */
export function findBiomeSamples(seed,{min=-2048,max=2048,step=16}={}){
 if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isSafeInteger(step)||step<1||min>max)throw new RangeError('invalid biome search range');
 const samples=Object.fromEntries(BIOMES.map(id=>[id,null]));
 for(let z=min;z<=max;z+=step){
  for(let x=min;x<=max;x+=step){
   const biome=biomeAt(seed,x,z,WORLD_GEN_VERSION);
   if(!samples[biome])samples[biome]={x,z,y:heightAt(seed,x,z,WORLD_GEN_VERSION)};
  }
  if(BIOMES.every(id=>samples[id]))break;
 }
 return samples;
}

/** Apply one bounded deterministic gravity-first fluid tick to sparse active cells.
 * `activeKeys` is an array of absolute x,y,z keys selected by the caller. Water
 * overrides are persisted in fluidEdits; generated sea cells stay implicit.
 */
export function stepFluid(world,activeKeys,{budget=2048}={}){
 if(!world||world.worldGenVersion!==WORLD_GEN_VERSION)throw new TypeError('Version 2 world required');
 if(!Array.isArray(activeKeys)||!Number.isSafeInteger(budget)||budget<1)throw new TypeError('active keys and positive budget required');
 if(!world.fluidEdits||typeof world.fluidEdits!=='object')world.fluidEdits={};
 const edits=world.fluidEdits,selected=[...new Set(activeKeys)].slice(0,budget),before=new Map(),next=new Map(),changedKeys=new Set();
 const original=key=>waterLevelAt(world,...parseCellKey(key));
 const get=key=>next.has(key)?next.get(key):original(key);
 const editCount=Object.keys(edits).length;
 const canRecord=(...keys)=>editCount+new Set([...changedKeys,...keys].filter(key=>!Object.hasOwn(edits,key))).size<=50000;
 for(const key of selected){if(!/^-?\d+,-?\d+,-?\d+$/.test(key))continue;const [x,y,z]=parseCellKey(key);if(x< -4096||x>=4096||z< -4096||z>=4096||y<WORLD_MIN_Y||y>WORLD_MAX_Y)continue;before.set(key,original(key));}
 let changed=0,processed=0;
 for(const key of selected){
  if(!before.has(key))continue;processed++;
  const [x,y,z]=parseCellKey(key),level=get(key);if(level<1)continue;
  const below=`${x},${y-1},${z}`;
  if(y-1>=WORLD_MIN_Y&&blockAt(world,x,y-1,z)===null&&get(below)<8&&canRecord(key,below)){
   const amount=Math.min(level,8-get(below));next.set(key,level-amount);next.set(below,get(below)+amount);changedKeys.add(key);changedKeys.add(below);continue;
  }
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz;if(nx< -4096||nx>=4096||nz< -4096||nz>=4096)continue;
   const neighbor=`${nx},${y},${nz}`,other=get(neighbor);
   if(blockAt(world,nx,y,nz)!==null||level-other<2||other>=8||!canRecord(key,neighbor))continue;
   next.set(key,level-1);next.set(neighbor,other+1);changedKeys.add(key);changedKeys.add(neighbor);break;
  }
 }
 for(const key of changedKeys){const level=next.get(key),old=original(key);if(level===old)continue;edits[key]=clamp(level,0,8);changed++;}
 const oldActive=Array.isArray(world.fluidActive)?world.fluidActive:[],pending=new Set(oldActive);
 for(const key of selected)pending.delete(key);
 for(const key of changedKeys){const [x,y,z]=parseCellKey(key);for(const [dx,dy,dz]of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){const nx=x+dx,ny=y+dy,nz=z+dz;if(waterLevelAt(world,nx,ny,nz)>0&&pending.size<50000)pending.add(`${nx},${ny},${nz}`);}}
 world.fluidActive=[...pending].sort();
 const queueChanged=oldActive.length!==world.fluidActive.length||oldActive.some((key,i)=>key!==world.fluidActive[i]);
 if(changed)world.fluidRevision=(world.fluidRevision||0)+1;
 return {processed,changed,queueChanged,remaining:Math.max(0,activeKeys.length-selected.length),revision:world.fluidRevision||0};
}

/** Generate one row-major X/Z column list with global coordinates. */
export function generateChunkColumns(seed,cx,cz,genVersion=WORLD_GEN_VERSION){
 if(!Number.isInteger(cx)||!Number.isInteger(cz))throw new TypeError('chunk coordinates must be integers');
 const worldSeed=String(seed),columns=[];
 for(let localZ=0;localZ<CHUNK_SIZE;localZ++)for(let localX=0;localX<CHUNK_SIZE;localX++){
  const x=cx*CHUNK_SIZE+localX,z=cz*CHUNK_SIZE+localZ;
  columns.push({x,z,surfaceY:heightAt(worldSeed,x,z,genVersion)});
 }
 return columns;
}
