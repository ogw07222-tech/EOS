// Isolated deterministic fluid prototype. This module is intentionally not imported by server.mjs or src/game.js.
export const CHUNK_SIZE=16;
export const MIN_LEVEL=1;
export const MAX_LEVEL=8;
const SIDE_DIRECTIONS=Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);
const keyOf=({x,y,z})=>`${x},${y},${z}`;
const parseKey=key=>key.split(',').map(Number);
const compareCells=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x;
const chunkOf=(x,z)=>`${Math.floor(x/CHUNK_SIZE)},${Math.floor(z/CHUNK_SIZE)}`;
const inRange=(p,b)=>p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY&&p.z>=b.minZ&&p.z<=b.maxZ;
const clampLevel=n=>Math.max(0,Math.min(MAX_LEVEL,n));
function heapPush(heap,key){heap.push(key);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(compareCells(parseKey(heap[p]),parseKey(heap[i]))<=0)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}}
function siftDown(heap,start){let i=start;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<heap.length&&compareCells(parseKey(heap[l]),parseKey(heap[m]))<0)m=l;if(r<heap.length&&compareCells(parseKey(heap[r]),parseKey(heap[m]))<0)m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];i=m;}}
function heapify(heap){for(let i=(heap.length>>1)-1;i>=0;i--)siftDown(heap,i);}
function heapPop(heap){if(!heap.length)return null;const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;siftDown(heap,0);}return first;}
function hash32(seed,x,z){let h=(seed^Math.imul(x+0x9e3779b9,0x85ebca6b)^Math.imul(z+0x7f4a7c15,0xc2b2ae35))>>>0;h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return (h^(h>>>16))>>>0;}
function stableHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}

export class FluidEngine{
 constructor({bounds,refillNeighbors=3,activeCellBudget=2048}={}){
  if(!bounds||![bounds.minX,bounds.maxX,bounds.minY,bounds.maxY,bounds.minZ,bounds.maxZ].every(Number.isInteger)||bounds.minX>bounds.maxX||bounds.minY>bounds.maxY||bounds.minZ>bounds.maxZ)throw new TypeError('Finite integer bounds are required');
  if(![2,3].includes(refillNeighbors))throw new RangeError('Compare only the two documented refill candidates (2 or 3 neighbors)');
  if(!Number.isSafeInteger(activeCellBudget)||activeCellBudget<1)throw new RangeError('activeCellBudget must be positive');
  this.bounds={...bounds};this.refillNeighbors=refillNeighbors;this.activeCellBudget=activeCellBudget;
  this.solids=new Set();this.water=new Map();this.waterByChunk=new Map();this.active=new Set();this.activeHeap=[];this.loadedChunks=null;this.pendingByChunk=new Map();this.seenTickIds=new Set();this.tickNumber=0;this.revision=0;this.metrics={ticks:0,processedCells:0,maxCellsPerTick:0,createdUnits:0,pendingHighWater:0,maxActiveCells:0};this.environment={};
 }
 #valid(p){return inRange(p,this.bounds);}
 #waterLevel(p,map=this.water){return map.get(keyOf(p))||0;}
 #isSolid(p){return !this.#valid(p)||this.solids.has(keyOf(p));}
 #isLoaded(p){return !this.loadedChunks||this.loadedChunks.has(chunkOf(p.x,p.z));}
 #enqueue(p){if(!this.#valid(p))return;const key=keyOf(p);if(!this.water.has(key))return;if(!this.#isLoaded(p)){const c=chunkOf(p.x,p.z);let q=this.pendingByChunk.get(c);if(!q)this.pendingByChunk.set(c,q=new Set());q.add(key);this.metrics.pendingHighWater=Math.max(this.metrics.pendingHighWater,this.pendingByChunk.size);return;}if(!this.active.has(key)){this.active.add(key);heapPush(this.activeHeap,key);this.metrics.maxActiveCells=Math.max(this.metrics.maxActiveCells,this.active.size);}}
 #wakeAround(p){this.#enqueue(p);for(const [dx,dy,dz]of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]])this.#enqueue({x:p.x+dx,y:p.y+dy,z:p.z+dz});}
 seedSolid(p){if(!this.#valid(p))return false;if(this.water.has(keyOf(p)))throw new Error(`solid/water overlap at ${keyOf(p)}`);this.solids.add(keyOf(p));return true;}
 seedWaterBatch(entries){const added=[];for(const [p,level=MAX_LEVEL]of entries){if(!this.#valid(p)||this.#isSolid(p))throw new Error(`invalid water cell ${keyOf(p)}`);if(!Number.isInteger(level)||level<MIN_LEVEL||level>MAX_LEVEL)throw new RangeError('water level must be 1..8');const key=keyOf(p);if(!this.water.has(key)){this.water.set(key,level);const c=chunkOf(p.x,p.z);let chunk=this.waterByChunk.get(c);if(!chunk)this.waterByChunk.set(c,chunk=new Set());chunk.add(key);added.push(key);}else this.water.set(key,Math.max(this.water.get(key),level));}for(const key of added)if(this.#isLoaded(Object.fromEntries(['x','y','z'].map((name,i)=>[name,parseKey(key)[i]]))))this.active.add(key);else{const [x,,z]=parseKey(key),c=chunkOf(x,z);let q=this.pendingByChunk.get(c);if(!q)this.pendingByChunk.set(c,q=new Set());q.add(key);}this.activeHeap=[...this.active];heapify(this.activeHeap);this.metrics.maxActiveCells=Math.max(this.metrics.maxActiveCells,this.active.size);return added.length;}
 seedWater(p,level=MAX_LEVEL){if(!this.#valid(p)||this.#isSolid(p))throw new Error(`invalid water cell ${keyOf(p)}`);if(!Number.isInteger(level)||level<MIN_LEVEL||level>MAX_LEVEL)throw new RangeError('water level must be 1..8');const key=keyOf(p);this.water.set(key,level);const c=chunkOf(p.x,p.z);let chunk=this.waterByChunk.get(c);if(!chunk)this.waterByChunk.set(c,chunk=new Set());chunk.add(key);this.#wakeAround(p);return true;}
 drainWater(p,units=1){const key=keyOf(p),level=this.water.get(key)||0;if(!Number.isSafeInteger(units)||units<1||!level)return 0;const removed=Math.min(units,level),next=level-removed;if(next)this.water.set(key,next);else{this.water.delete(key);const [x,,z]=parseKey(key),c=chunkOf(x,z),chunk=this.waterByChunk.get(c);chunk?.delete(key);if(chunk&&!chunk.size)this.waterByChunk.delete(c);}this.revision++;this.#wakeAround(p);return removed;}
 levelAt(p){return this.#waterLevel(p);}
 solidAt(p){return this.#isSolid(p);}
 placeSolid(p){if(!this.#valid(p)||this.water.has(keyOf(p))||this.solids.has(keyOf(p)))return false;this.solids.add(keyOf(p));this.revision++;this.#wakeAround(p);return true;}
 mineSolid(p){if(!this.#valid(p)||!this.solids.delete(keyOf(p)))return false;this.revision++;this.#wakeAround(p);return true;}
 denyPlayerWaterAction(){return {status:400,error:'Direct player water placement/mining is disabled',revision:this.revision};}
 setLoadedChunks(chunks){this.loadedChunks=chunks===null?null:new Set(chunks);if(this.loadedChunks){for(const c of this.loadedChunks){const pending=this.pendingByChunk.get(c);if(pending){for(const key of pending){const [x,y,z]=parseKey(key);this.#wakeAround({x,y,z});}this.pendingByChunk.delete(c);}for(const key of this.waterByChunk.get(c)||[]){const [x,y,z]=parseKey(key);this.#wakeAround({x,y,z});}}}else for(const key of this.water.keys()){const [x,y,z]=parseKey(key);this.#enqueue({x,y,z});}}
 unloadChunk(cx,cz){const c=`${cx},${cz}`;if(!this.loadedChunks)return;this.loadedChunks.delete(c);for(const key of this.waterByChunk.get(c)||[])this.active.delete(key);}
 loadChunk(cx,cz){if(!this.loadedChunks)this.loadedChunks=new Set();this.loadedChunks.add(`${cx},${cz}`);const pending=this.pendingByChunk.get(`${cx},${cz}`);if(pending){for(const key of pending){const [x,y,z]=parseKey(key);this.#wakeAround({x,y,z});}this.pendingByChunk.delete(`${cx},${cz}`);}for(const key of this.waterByChunk.get(`${cx},${cz}`)||[]){const [x,y,z]=parseKey(key);this.#wakeAround({x,y,z});}}
 tick({tickId=null,budget=this.activeCellBudget}={}){
  if(tickId!==null){if(typeof tickId!=='string'||!tickId)throw new TypeError('tickId must be a nonempty string');if(this.seenTickIds.has(tickId))return {duplicate:true,processed:0,changed:0,createdUnits:0,revision:this.revision};}
  if(!Number.isSafeInteger(budget)||budget<1)throw new RangeError('tick budget must be positive');
  const batch=[],selected=new Set();while(batch.length<budget&&this.activeHeap.length){const key=heapPop(this.activeHeap);if(this.active.has(key)&&!selected.has(key)){batch.push(key);selected.add(key);}}const before=this.water,changes=new Map();let changed=0,created=0;
  const get=key=>changes.has(key)?changes.get(key):before.get(key)||0;
  const set=(key,level)=>{const prev=get(key);if(prev===level)return;changes.set(key,level);};
  // Gravity proposals are processed before side flow. Each source transfers only available capacity.
  for(const key of batch){const [x,y,z]=parseKey(key),p={x,y,z},level=before.get(key)||0;if(!level||!this.#isLoaded(p))continue;
   const below={x,y:y-1,z},bk=keyOf(below),target=get(bk);
   if(this.#valid(below)&&!this.solids.has(bk)&&target<MAX_LEVEL){const amount=Math.min(level,MAX_LEVEL-target);set(key,get(key)-amount);set(bk,target+amount);this.#wakeAround(below);this.#wakeAround(p);continue;}
   // A level drop is a conserved one-unit transfer; cells uphill are never considered.
   const start=hash32(this.tickNumber,x,z)%SIDE_DIRECTIONS.length;
   for(let i=0;i<SIDE_DIRECTIONS.length;i++){const [dx,dz]=SIDE_DIRECTIONS[(start+i)%SIDE_DIRECTIONS.length],q={x:x+dx,y,z:z+dz},qk=keyOf(q),neighbor=get(qk);
    if(!this.#valid(q)||this.solids.has(qk)||neighbor>=MAX_LEVEL||level-neighbor<2)continue;
    set(key,get(key)-1);set(qk,neighbor+1);this.#wakeAround(q);this.#wakeAround(p);break;
   }
  }
  // Candidate refill is neighborhood-only and position-agnostic. Only an existing residual cell
  // on support may refill; empty space cannot be filled by a source tag or an ocean exception.
  for(const key of batch){const [x,y,z]=parseKey(key),p={x,y,z},level=get(key);if(level<1||level>=MAX_LEVEL)continue;
   if(!this.#isSolid({x,y:y-1,z}))continue;
   let full=0;for(const [dx,dz]of SIDE_DIRECTIONS)if(get(keyOf({x:x+dx,y,z:z+dz}))===MAX_LEVEL)full++;
   if(full>=this.refillNeighbors){created+=MAX_LEVEL-level;set(key,MAX_LEVEL);}
  }
  for(const [key,level]of changes){const old=before.get(key)||0;if(old===level)continue;changed++;const [x,,z]=parseKey(key),c=chunkOf(x,z);if(level===0){this.water.delete(key);const chunk=this.waterByChunk.get(c);chunk?.delete(key);if(chunk&&!chunk.size)this.waterByChunk.delete(c);}else{this.water.set(key,level);let chunk=this.waterByChunk.get(c);if(!chunk)this.waterByChunk.set(c,chunk=new Set());chunk.add(key);}}
  this.tickNumber++;this.metrics.ticks++;this.metrics.processedCells+=batch.length;this.metrics.maxCellsPerTick=Math.max(this.metrics.maxCellsPerTick,batch.length);this.metrics.createdUnits+=created;
  for(const key of batch){this.active.delete(key);if(this.water.has(key)){const [x,y,z]=parseKey(key),p={x,y,z};if(!this.#isLoaded(p))this.#enqueue(p);}}
  if(changed){this.revision++;for(const key of batch){const [x,y,z]=parseKey(key);this.#wakeAround({x,y,z});}}
  if(tickId!==null){this.seenTickIds.add(tickId);if(this.seenTickIds.size>4096)this.seenTickIds.delete(this.seenTickIds.values().next().value);}
  return {duplicate:false,processed:batch.length,changed,createdUnits:created,revision:this.revision};
 }
 run(ticks,{budget=this.activeCellBudget}={}){if(!Number.isSafeInteger(ticks)||ticks<0)throw new RangeError('ticks must be nonnegative');const results=[];for(let i=0;i<ticks;i++)results.push(this.tick({budget}));return results;}
 snapshot(){return {tickNumber:this.tickNumber,revision:this.revision,solids:[...this.solids].sort(),water:[...this.water.entries()].sort(([a],[b])=>compareCells(parseKey(a),parseKey(b))),active:[...this.active].sort((a,b)=>compareCells(parseKey(a),parseKey(b))),pendingByChunk:[...this.pendingByChunk.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([c,q])=>[c,[...q].sort()]),metrics:{...this.metrics}};}
 stateHash(){return stableHash(JSON.stringify({solids:[...this.solids].sort(),water:this.snapshot().water,active:this.snapshot().active,pending:this.snapshot().pendingByChunk,tickNumber:this.tickNumber}));}
 serialize(){return {version:1,bounds:{...this.bounds},refillNeighbors:this.refillNeighbors,activeCellBudget:this.activeCellBudget,solids:[...this.solids].sort(),water:[...this.water.entries()].sort(([a],[b])=>a.localeCompare(b)),active:[...this.active].sort(),loadedChunks:this.loadedChunks?[...this.loadedChunks].sort():null,pendingByChunk:[...this.pendingByChunk.entries()].map(([c,q])=>[c,[...q].sort()]),tickNumber:this.tickNumber,revision:this.revision,metrics:{...this.metrics}};}
 static restore(data){if(data?.version!==1)throw new Error('Unsupported fluid prototype save');const e=new FluidEngine(data);e.solids=new Set(data.solids);e.water=new Map(data.water);e.waterByChunk=new Map();for(const key of e.water.keys()){const [x,,z]=parseKey(key),c=chunkOf(x,z);let q=e.waterByChunk.get(c);if(!q)e.waterByChunk.set(c,q=new Set());q.add(key);}e.active=new Set();e.activeHeap=[];for(const key of data.active){e.active.add(key);heapPush(e.activeHeap,key);}e.loadedChunks=data.loadedChunks===null?null:new Set(data.loadedChunks);e.pendingByChunk=new Map(data.pendingByChunk.map(([c,q])=>[c,new Set(q)]));e.tickNumber=data.tickNumber;e.revision=data.revision;e.metrics={...data.metrics};return e;}
}

export function generateTerrain(seed,{minX=-24,maxX=24,minZ=-24,maxZ=24,minY=-8,maxY=8,seaLevel=0,startRadius=5,refillNeighbors=3}={}){
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('seed must be uint32');
 const engine=new FluidEngine({bounds:{minX,maxX,minY,maxY,minZ,maxZ},refillNeighbors});engine.environment={seed,seaLevel,startRadius};
 const coast=-14+(seed%7),riverOffset=((seed>>>4)%9)-4;
 const surfaceAt=(x,z)=>{const undulation=(hash32(seed,x,z)%5)-2;const riverZ=Math.round(Math.sin((x+riverOffset)/5)*3+riverOffset);const river=Math.abs(z-riverZ)<=1;return river?-2+Math.min(1,undulation):3+undulation;};
 for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
  let surface=surfaceAt(x,z);if(Math.abs(x)<=startRadius&&Math.abs(z)<=startRadius)surface=Math.max(surface,2);
  for(let y=minY;y<surface;y++){
   // Deterministic caves remain dry unless the surface opening is actually carved by gameplay.
   const cave=y<surface-2&&hash32(seed^0xa5a5a5a5,x+y,z)%31===0;
   if(!cave)engine.seedSolid({x,y,z});
  }
  const ocean=x<coast,river=Math.abs(z-Math.round(Math.sin((x+riverOffset)/5)*3+riverOffset))<=1;
  if(!(Math.abs(x)<=startRadius&&Math.abs(z)<=startRadius)&&(ocean||river)&&surface<=seaLevel){for(let y=surface;y<=seaLevel;y++)engine.seedWater({x,y,z},MAX_LEVEL);}
 }
 return {engine,seaLevel,surfaceAt,coast,riverOffset};
}

export function surfacePlan(engine){
 const tops=[],sides=[];
 for(const [key,level]of engine.water){const [x,y,z]=parseKey(key),top=y+level/MAX_LEVEL;
  if(!engine.water.has(keyOf({x,y:y+1,z})))tops.push({x,y:top,z,level});
  for(const [dx,dz]of SIDE_DIRECTIONS){const neighbor=engine.levelAt({x:x+dx,y,z:z+dz}),neighborTop=neighbor?y+neighbor/MAX_LEVEL:y;if(top>neighborTop)sides.push({x,yBottom:neighborTop,yTop:top,z,dx,dz});}
 }
 tops.sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);sides.sort((a,b)=>a.yBottom-b.yBottom||a.z-b.z||a.x-b.x||a.dx-b.dx||a.dz-b.dz);return {tops,sides};
}

export function activatePlayerWaterGuard(engine,action){if(action==='place-water'||action==='mine-water'||action==='bucket-place'||action==='bucket-pickup')return engine.denyPlayerWaterAction();return {status:200,revision:engine.revision};}
