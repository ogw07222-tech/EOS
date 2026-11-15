import {mineralAt} from './mineral-world.mjs';

// Pure deterministic terrain primitives shared by the authoritative server and
// the WebGL client. Coordinates are world-space block coordinates (1 block=1m).
export const CHUNK_SIZE=16;
export const DEFAULT_CHUNK_RADIUS=4;
export const MIN_CHUNK_RADIUS=2;
export const MAX_CHUNK_RADIUS=6;
export const WORLD_GEN_VERSION=1;
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
 if(genVersion!==WORLD_GEN_VERSION)throw new RangeError(`Unsupported world generation version: ${genVersion}`);
 // String conversion is intentional: numeric and textual seeds have distinct,
 // stable worlds, while all JS JSON-compatible seed values remain usable.
 return String(seed);
}

/** Deterministic, globally sampled smooth field. The starter landing area is flat. */
export function heightAt(seed,x,z,genVersion=WORLD_GEN_VERSION){
 const worldSeed=validateGeneration(seed,x,z,genVersion);
 const cacheKey=JSON.stringify([worldSeed,genVersion,x,z]);
 if(heightCache.has(cacheKey)){
  const cached=heightCache.get(cacheKey);heightCache.delete(cacheKey);heightCache.set(cacheKey,cached);return cached;
 }
 let height;
 if(x>=-6&&x<=5&&z>=-6&&z<=5)height=0;
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
 if(y<WORLD_MIN_Y||y>WORLD_MAX_Y||!world||world.worldGenVersion!==WORLD_GEN_VERSION)return null;
 const surfaceY=heightAt(world.worldSeed,x,z,world.worldGenVersion);
 if(y>=surfaceY)return null;
 if(y===surfaceY-1)return 'grass';
 if(y>=surfaceY-4)return 'dirt';
 const mineral=mineralAt(world.worldSeed,x,y,z,surfaceY);if(mineral)return mineral;
 return 'stone';
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
