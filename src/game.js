import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { createFarmerNpc } from './farmer-npc.js';
import { isFarmTileWatered } from './farming-rules.mjs';
import {CHUNK_SIZE,DEFAULT_CHUNK_RADIUS,MIN_CHUNK_RADIUS,MAX_CHUNK_RADIUS,WORLD_MIN_Y,WORLD_MAX_Y,blockAt,generateChunkColumns,chunkCoord,localCoord,planChunkWindow,isChunkJobCurrent,biomeAt,generatedWaterLevel,waterLevelAt} from './chunk-world.mjs';
import {generateTreesForChunk,treeDimensions} from './tree-world.mjs';
import {cropTypeOf,seedItemForCrop,productItemForCrop} from './crop-rules.mjs';
import {RESOURCE_LABELS,RESOURCE_KEYS,TOOL_NAMES,TREE_LOGS,TREE_SAPLINGS,CROP_TYPES,CROP_SEEDS} from './resource-catalog.mjs';
import { COAL_BLOCK_RECIPE } from './recipe-settings.mjs';
const $=id=>document.getElementById(id);
const SIZE=10;
// Simulation units are metres: one voxel grid cell measures 1 m on each axis.
// WORLD_SCALE is a renderer-only conversion; both blocks and the avatar share it.
const BLOCK_METERS=1;
const PLAYER_HEIGHT_METERS=1.78;
const PLAYER_HALF_WIDTH_METERS=0.34;
const WORLD_SCALE=3.75;
let world,meshes=[],terrain=null,gridVisible=false,mode='place',busy=false,placingMachine=null,machineRotation=0,selectedSlot=1,selectedTool='wood_axe',camYaw=.78,camPitch=.55,camDistance=14.5;
let devTimePanel=null,devTeleportVersion=0,hubRoots=[],farmerModel=null,nearInteraction=null,interactionBusy=false,shopRevision=0,shopQuantity='1',activeCraftStation='t0';
const scene=new THREE.Scene();scene.background=new THREE.Color('#94c5e7');scene.fog=new THREE.Fog('#94c5e7',90,240);
const worldRoot=new THREE.Group();worldRoot.scale.setScalar(WORLD_SCALE);scene.add(worldRoot);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.12,260);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf4fbff,0x536477,2.2));
const light=new THREE.DirectionalLight(0xffeed2,2.5);light.position.set(-22,40,20);light.castShadow=true;
light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-70;light.shadow.camera.right=70;light.shadow.camera.top=70;light.shadow.camera.bottom=-70;scene.add(light);
const colors={top:['#70ac69','#80b875','#669c61','#89bd7b'],side:['#8e694d','#956b50','#79583f','#9a7556'],bottom:['#6b4b36','#82583f']};
const terrainColors={top:colors.top.map(color=>new THREE.Color(color)),side:colors.side.map(color=>new THREE.Color(color)),sand:['#d9be81','#e9d39c','#c9ad72','#e0c68c'].map(color=>new THREE.Color(color)),stone:['#68737b','#737f86','#5c676e'].map(color=>new THREE.Color(color)),iron:['#8b6752','#b28464','#6f7780'].map(color=>new THREE.Color(color)),coal:['#333b40','#485156','#232a2e'].map(color=>new THREE.Color(color)),copper:['#ad7049','#c17e50','#6f8b82'].map(color=>new THREE.Color(color))};
function hash(x,y,z){let n=Math.imul(x+101,73856093)^Math.imul(y+211,19349663)^Math.imul(z+307,83492791);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
function has(x,y,z){if(world?.worldGenVersion){const block=blockAt(world,x,y,z);return block!==null&&block!==undefined&&block!=='air';}const k=x+','+y+','+z;if(Object.prototype.hasOwnProperty.call(world.edits,k))return world.edits[k]!==null;const half=(world?.islandSize||SIZE)/2;return x>=-half&&x<half&&z>=-half&&z<half&&y>=-3&&y<0;}
const faces=[
 {d:[0,1,0],n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]},
 {d:[0,-1,0],n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
 {d:[-1,0,0],n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},
 {d:[1,0,0],n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]},
 {d:[0,0,-1],n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]},
 {d:[0,0,1],n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]}
];
const grassMat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.FrontSide});
const edgesMat=new THREE.LineBasicMaterial({color:0x304b40,transparent:true,opacity:.32});
const blockPreviewMaterials=[0x6f9d62,0x7b5742,0x79583f,0x956e4f,0x79583f,0x956e4f].map(color=>new THREE.MeshLambertMaterial({color,transparent:true,opacity:.5,depthWrite:false}));
const blockPreviewEdgeMat=new THREE.LineBasicMaterial({color:0x8fe0b7,transparent:true,opacity:.95,depthTest:false});
const blockPreviewMarkMat=new THREE.LineBasicMaterial({color:0xff7770,transparent:true,opacity:.98,depthTest:false});
const blockPreview=new THREE.Group();blockPreview.visible=false;worldRoot.add(blockPreview);
const blockPreviewGeometry=new THREE.BoxGeometry(.96,.96,.96);
const blockPreviewMesh=new THREE.Mesh(blockPreviewGeometry,blockPreviewMaterials);blockPreviewMesh.renderOrder=20;blockPreview.add(blockPreviewMesh);
const blockPreviewEdges=new THREE.LineSegments(new THREE.EdgesGeometry(blockPreviewGeometry),blockPreviewEdgeMat);blockPreviewEdges.renderOrder=21;blockPreview.add(blockPreviewEdges);
const blockPreviewMarkGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.2,-.2,.487),new THREE.Vector3(.2,.2,.487),new THREE.Vector3(-.2,.2,.487),new THREE.Vector3(.2,-.2,.487)]);
const blockPreviewMark=new THREE.LineSegments(blockPreviewMarkGeometry,blockPreviewMarkMat);blockPreviewMark.visible=false;blockPreviewMark.renderOrder=22;blockPreview.add(blockPreviewMark);
let outlines;
// Seeded worlds use a mesh and GPU resource per 16x16 column chunk. Unloading
// only releases client geometry; edits remain in the authoritative world JSON.
const streamedTerrain=new Map(),columnCache=new Map(),desiredTerrainChunks=new Set(),dirtyTerrainChunks=new Set(),terrainEditedChunks=new Set();
let terrainWorkQueue=[],queuedTerrainChunks=new Set(),terrainGeneration=0,chunkWorldActive=false,activeChunkWorldKey='',terrainEditSnapshot=new Map(),terrainRequestSignature='';
let terrainBuildCount=0,terrainBuildTotalMs=0,terrainBuildLastMs=0,terrainBuildMaxMs=0,terrainFrameAvgMs=0,lastTerrainStatsAt=0;
// Water is drawn as one batched surface mesh per streamed chunk. Static ocean
// columns come from the shared deterministic generator; only dynamic fluid
// overrides travel over the wire and dirty the chunks they actually affect.
const streamedWater=new Map(),desiredWaterChunks=new Set(),dirtyWaterChunks=new Set();
let waterWorkQueue=[],waterGeneration=0,waterEditSnapshot=new Map(),waterWorldKey='',waterEditWindowKey='';
let indexedFluidCells=null,fluidCellsByChunk=new Map();
const waterMaterial=new THREE.MeshLambertMaterial({color:0x388eaa,transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide});
function terrainChunkKey(cx,cz){return `${cx},${cz}`;}
function disposeWaterChunk(entry){if(!entry?.mesh)return;worldRoot.remove(entry.mesh);entry.mesh.geometry.dispose();}
function waterWorld(snapshot=world){return snapshot?{...snapshot,fluidEdits:snapshot.fluidCells||snapshot.fluidEdits||{}}:null;}
function indexedWaterEdits(){
 const cells=world?.fluidCells||world?.fluidEdits||{};if(cells===indexedFluidCells)return fluidCellsByChunk;
 indexedFluidCells=cells;fluidCellsByChunk=new Map();
 for(const [cell,level]of Object.entries(cells)){const [x,,z]=cell.split(',').map(Number);if(!Number.isInteger(x)||!Number.isInteger(z))continue;const chunk=terrainChunkKey(chunkCoord(x),chunkCoord(z));let entries=fluidCellsByChunk.get(chunk);if(!entries)fluidCellsByChunk.set(chunk,entries=[]);entries.push([cell,level]);}
 return fluidCellsByChunk;
}
function markWaterChunk(cx,cz){const key=terrainChunkKey(cx,cz);if(desiredWaterChunks.has(key))dirtyWaterChunks.add(key);}
function waterWindowKey(snapshot){const x=Number(snapshot?.player?.x),z=Number(snapshot?.player?.z);return Number.isFinite(x)&&Number.isFinite(z)?`${chunkCoord(x)},${chunkCoord(z)}`:'unknown';}
function queueWaterBuilds(){waterGeneration++;waterWorkQueue=[];for(const key of desiredWaterChunks)if(!streamedWater.has(key)||dirtyWaterChunks.has(key)){const [cx,cz]=key.split(',').map(Number);waterWorkQueue.push({cx,cz,generation:waterGeneration});}}
function updateWaterStreaming(nextChunks=desiredTerrainChunks,force=false){
 const key=`${world?.worldId||''}|${world?.worldInstanceId||''}|${world?.worldSeed}|${world?.worldGenVersion}`;
 if(force||key!==waterWorldKey){waterGeneration++;waterWorkQueue=[];for(const entry of streamedWater.values())disposeWaterChunk(entry);streamedWater.clear();dirtyWaterChunks.clear();waterWorldKey=key;waterEditSnapshot=new Map(Object.entries(world?.fluidCells||{}));waterEditWindowKey=waterWindowKey(world);}
 const next=new Set(nextChunks);
 for(const [chunk,entry]of streamedWater)if(!next.has(chunk)){disposeWaterChunk(entry);streamedWater.delete(chunk);dirtyWaterChunks.delete(chunk);}
 for(const chunk of next)if(!streamedWater.has(chunk))dirtyWaterChunks.add(chunk);
 desiredWaterChunks.clear();for(const chunk of next)desiredWaterChunks.add(chunk);queueWaterBuilds();
}
function syncWaterEdits(previous,next){
 if(!next?.worldGenVersion)return;
 const key=`${next.worldId||''}|${next.worldInstanceId||''}|${next.worldSeed}|${next.worldGenVersion}`;
 if(key!==waterWorldKey){updateWaterStreaming(desiredTerrainChunks,true);return;}
 const nextWindow=waterWindowKey(next);if(previous&&previous.fluidRevision===next.fluidRevision&&nextWindow===waterEditWindowKey)return;
 const current=new Map(Object.entries(next.fluidCells||{})),changed=[];
 for(const [cell,value]of waterEditSnapshot)if(!current.has(cell)||current.get(cell)!==value)changed.push(cell);
 for(const [cell,value]of current)if(!waterEditSnapshot.has(cell)||waterEditSnapshot.get(cell)!==value)changed.push(cell);
 waterEditSnapshot=current;waterEditWindowKey=nextWindow;
 if(!changed.length&&previous?.fluidRevision===next.fluidRevision)return;
 for(const cell of changed){const [x,,z]=cell.split(',').map(Number);if(!Number.isInteger(x)||!Number.isInteger(z))continue;const cx=chunkCoord(x),cz=chunkCoord(z),lx=localCoord(x),lz=localCoord(z);markWaterChunk(cx,cz);if(lx===0)markWaterChunk(cx-1,cz);if(lx===CHUNK_SIZE-1)markWaterChunk(cx+1,cz);if(lz===0)markWaterChunk(cx,cz-1);if(lz===CHUNK_SIZE-1)markWaterChunk(cx,cz+1);}
 if(changed.length)queueWaterBuilds();
}
function waterQuad(arrays,a,b,c,d){const start=arrays.positions.length/3;for(const point of [a,b,c,d])arrays.positions.push(point[0],point[1],point[2]);arrays.indices.push(start,start+1,start+2,start,start+2,start+3);}
function buildWaterGeometry(cx,cz){
 const arrays={positions:[],indices:[]},source=waterWorld(),edits=source?.fluidEdits||{},chunkEdits=indexedWaterEdits().get(terrainChunkKey(cx,cz))||[],x0=cx*CHUNK_SIZE,z0=cz*CHUNK_SIZE,sea=Number.isInteger(world?.seaLevel)?world.seaLevel:0;
 const levelAt=(x,y,z)=>waterLevelAt(source,x,y,z)||0;
 // The static ocean/river body is compactly reconstructed from the shared seed.
 // Only one surface sample per X/Z column is needed for the stable sea plane.
 if(world?.worldGenVersion===2)for(let z=z0;z<z0+CHUNK_SIZE;z++)for(let x=x0;x<x0+CHUNK_SIZE;x++){
  const base=generatedWaterLevel(world,x,sea,z),override=Object.hasOwn(edits,`${x},${sea},${z}`),level=override?edits[`${x},${sea},${z}`]:base;
  if(level<=0)continue;const top=sea+level/8;
  waterQuad(arrays,[x,top,z],[x+1,top,z],[x+1,top,z+1],[x,top,z+1]);
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz,nkey=`${nx},${sea},${nz}`,nbase=generatedWaterLevel(world,nx,sea,nz),nlevel=Object.hasOwn(edits,nkey)?edits[nkey]:nbase;
   if(nlevel>0)continue;
   const bed=heightAt(world.worldSeed,x,z,world.worldGenVersion),land=heightAt(world.worldSeed,nx,nz,world.worldGenVersion),bottom=Math.max(bed,land);
   if(bottom>=top)continue;
   if(dx===1)waterQuad(arrays,[x+1,bottom,z+1],[x+1,bottom,z],[x+1,top,z],[x+1,top,z+1]);
   else if(dx===-1)waterQuad(arrays,[x,bottom,z],[x,bottom,z+1],[x,top,z+1],[x,top,z]);
   else if(dz===1)waterQuad(arrays,[x,bottom,z+1],[x+1,bottom,z+1],[x+1,top,z+1],[x,top,z+1]);
   else waterQuad(arrays,[x+1,bottom,z],[x,bottom,z],[x,top,z],[x+1,top,z]);
  }
 }
 // Sparse simulated cells add waterfalls, channels, and partial-height surfaces.
 for(const [cell,rawLevel]of chunkEdits){
  const [x,y,z]=cell.split(',').map(Number),level=Number(rawLevel);if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(z)||!Number.isFinite(level)||level<=0||level>8||chunkCoord(x)!==cx||chunkCoord(z)!==cz||y===sea)continue;
  const top=y+level/8;
  if(levelAt(x,y+1,z)===0)waterQuad(arrays,[x,top,z],[x+1,top,z],[x+1,top,z+1],[x,top,z+1]);
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
   const adjacent=levelAt(x+dx,y,z+dz),bottom=adjacent?Math.max(y,y+adjacent/8):y;if(bottom>=top)continue;
   if(dx===1)waterQuad(arrays,[x+1,bottom,z+1],[x+1,bottom,z],[x+1,top,z],[x+1,top,z+1]);
   else if(dx===-1)waterQuad(arrays,[x,bottom,z],[x,bottom,z+1],[x,top,z+1],[x,top,z]);
   else if(dz===1)waterQuad(arrays,[x,bottom,z+1],[x+1,bottom,z+1],[x+1,top,z+1],[x,top,z+1]);
   else waterQuad(arrays,[x+1,bottom,z],[x,bottom,z],[x,top,z],[x+1,top,z]);
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(arrays.positions,3));geometry.setIndex(arrays.indices);geometry.computeVertexNormals();return geometry;
}
function installWaterChunk(cx,cz,generation){
 const key=terrainChunkKey(cx,cz);if(generation!==waterGeneration||!desiredWaterChunks.has(key))return;
 const geometry=buildWaterGeometry(cx,cz);if(generation!==waterGeneration||!desiredWaterChunks.has(key)){geometry.dispose();return;}
 const previous=streamedWater.get(key);if(geometry.getAttribute('position').count===0){geometry.dispose();if(previous)disposeWaterChunk(previous);streamedWater.set(key,{cx,cz,key,mesh:null});dirtyWaterChunks.delete(key);return;}
 const mesh=new THREE.Mesh(geometry,waterMaterial);mesh.renderOrder=2;mesh.castShadow=false;mesh.receiveShadow=false;
 if(previous)disposeWaterChunk(previous);streamedWater.set(key,{cx,cz,key,mesh});worldRoot.add(mesh);dirtyWaterChunks.delete(key);
}
function pumpWaterWork(){const start=performance.now();while(waterWorkQueue.length&&performance.now()-start<1.8){const job=waterWorkQueue.shift(),key=terrainChunkKey(job.cx,job.cz);if(job.generation!==waterGeneration||!desiredWaterChunks.has(key))continue;try{installWaterChunk(job.cx,job.cz,job.generation);}catch(error){console.error('Water mesh build failed:',key,error);}}}
function configuredChunkRadius(){let requested=DEFAULT_CHUNK_RADIUS;try{const value=Number(localStorage.getItem('terra.chunkRadius'));if(Number.isFinite(value)&&value>0)requested=value;}catch{}return Math.max(MIN_CHUNK_RADIUS,Math.min(MAX_CHUNK_RADIUS,Math.trunc(requested)));}
function disposeTerrainChunk(entry){worldRoot.remove(entry.root);entry.root.traverse(object=>{if(object.geometry)object.geometry.dispose();});}
function chunkGeometry(positions,normals,colorsOut,indices){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colorsOut,3));geometry.setIndex(indices);return geometry;}
function chunkTint(block,topFace,x,y,z,faceNumber){const palette=block==='grass'?(topFace?terrainColors.top:terrainColors.side):block==='dirt'?terrainColors.side:block==='sand'?terrainColors.sand:block==='stone'?terrainColors.stone:block==='iron_ore'?terrainColors.iron:block==='coal_ore'?terrainColors.coal:block==='copper_ore'?terrainColors.copper:terrainColors.side;return palette[hash(x,y,z+faceNumber*17)%palette.length];}
function emitChunkFace(arrays,face,x,y,z,block,faceNumber){const tint=chunkTint(block,face.d[1]===1,x,y,z,faceNumber),start=arrays.positions.length/3;for(const corner of face.v){arrays.positions.push(x+corner[0],y+corner[1],z+corner[2]);arrays.normals.push(...face.n);arrays.colors.push(tint.r,tint.g,tint.b);}arrays.indices.push(start,start+1,start+2,start,start+2,start+3);}
function rebuildTerrainEditIndex(){terrainEditedChunks.clear();for(const key of terrainEditSnapshot.keys()){const [x,,z]=key.split(',').map(Number);if(Number.isInteger(x)&&Number.isInteger(z))terrainEditedChunks.add(terrainChunkKey(chunkCoord(x),chunkCoord(z)));}}
function hasNearbyTerrainEdits(cx,cz){for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(terrainEditedChunks.has(terrainChunkKey(cx+dx,cz+dz)))return true;return false;}
function makeHeightfieldChunk(cx,cz,columnMap){const arrays={positions:[],normals:[],colors:[],indices:[]},startX=cx*CHUNK_SIZE,startZ=cz*CHUNK_SIZE;
 const height=(x,z)=>columnMap.get(`${x},${z}`)?.surfaceY??0;
 for(let z=startZ;z<startZ+CHUNK_SIZE;z++)for(let x=startX;x<startX+CHUNK_SIZE;x++){
  const surfaceY=height(x,z),topBlock=surfaceY-1>=WORLD_MIN_Y?blockAt(world,x,surfaceY-1,z):null;if(topBlock)emitChunkFace(arrays,faces[0],x,surfaceY-1,z,topBlock,0);
  for(const [faceIndex,dx,dz] of [[2,-1,0],[3,1,0],[4,0,-1],[5,0,1]]){const neighborY=height(x+dx,z+dz),from=Math.max(WORLD_MIN_Y,neighborY);for(let y=from;y<surfaceY&&y<=WORLD_MAX_Y;y++){
   const block=blockAt(world,x,y,z);if(!block)continue;
   emitChunkFace(arrays,faces[faceIndex],x,y,z,block,faceIndex);
  }}
 }
 return chunkGeometry(arrays.positions,arrays.normals,arrays.colors,arrays.indices);
}
function clearStreamedTerrain(){terrainGeneration++;terrainWorkQueue=[];queuedTerrainChunks.clear();for(const entry of streamedTerrain.values())disposeTerrainChunk(entry);streamedTerrain.clear();desiredTerrainChunks.clear();dirtyTerrainChunks.clear();terrainEditedChunks.clear();columnCache.clear();updateWaterStreaming(new Set(),true);desiredWaterChunks.clear();chunkWorldActive=false;activeChunkWorldKey='';terrainEditSnapshot=new Map();terrainRequestSignature='';terrainBuildCount=0;terrainBuildTotalMs=0;terrainBuildLastMs=0;terrainBuildMaxMs=0;terrainFrameAvgMs=0;lastTerrainStatsAt=0;}
function chunkColumns(cx,cz){const key=terrainChunkKey(cx,cz);let columns=columnCache.get(key);if(!columns){columns=generateChunkColumns(world.worldSeed,cx,cz,world.worldGenVersion);columnCache.set(key,columns);if(columnCache.size>256)columnCache.delete(columnCache.keys().next().value);}return columns;}
function surfaceHeightAt(x,z){const columns=chunkColumns(chunkCoord(x),chunkCoord(z));const lx=localCoord(x),lz=localCoord(z);return columns[lz*CHUNK_SIZE+lx]?.surfaceY??0;}
function makeChunkTerrain(cx,cz){
 const startX=cx*CHUNK_SIZE,startZ=cz*CHUNK_SIZE,columns=[];let top= WORLD_MIN_Y;
 for(let z=startZ-1;z<=startZ+CHUNK_SIZE;z++)for(let x=startX-1;x<=startX+CHUNK_SIZE;x++){const surfaceY=surfaceHeightAt(x,z);columns.push({x,z,surfaceY});top=Math.max(top,surfaceY);}
 const columnMap=new Map(columns.map(column=>[`${column.x},${column.z}`,column]));
 if(!hasNearbyTerrainEdits(cx,cz))return makeHeightfieldChunk(cx,cz,columnMap);
 for(const key of Object.keys(world.edits||{})){const [x,y,z]=key.split(',').map(Number),editCx=chunkCoord(x),editCz=chunkCoord(z);if(Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&Math.abs(editCx-cx)<=1&&Math.abs(editCz-cz)<=1)top=Math.max(top,y+1);}
 const upper=Math.min(WORLD_MAX_Y+1,top+1),field=new Map(),cellKey=(x,y,z)=>`${x},${y},${z}`;
 for(const column of columns)for(let y=WORLD_MIN_Y;y<upper;y++)field.set(cellKey(column.x,y,column.z),blockAt(world,column.x,y,column.z));
 const positions=[],normals=[],colorsOut=[],indices=[],arrays={positions,normals,colors:colorsOut,indices};let faceIndex=0;
 for(let z=startZ;z<startZ+CHUNK_SIZE;z++)for(let x=startX;x<startX+CHUNK_SIZE;x++)for(let y=WORLD_MIN_Y;y<upper;y++){
  const block=field.get(cellKey(x,y,z));if(block===null||block===undefined||block==='air')continue;
  for(faceIndex=0;faceIndex<faces.length;faceIndex++){const face=faces[faceIndex],[dx,dy,dz]=face.d;if(field.get(cellKey(x+dx,y+dy,z+dz))!=null)continue;
   emitChunkFace(arrays,face,x,y,z,block,faceIndex);
  }
 }
 return chunkGeometry(positions,normals,colorsOut,indices);
}
function installChunkMesh(cx,cz,generation){
 if(!isChunkJobCurrent({cx,cz,generation},terrainGeneration,desiredTerrainChunks))return;
 const key=terrainChunkKey(cx,cz),buildStarted=performance.now(),geometry=makeChunkTerrain(cx,cz),buildMs=performance.now()-buildStarted;
 if(!isChunkJobCurrent({cx,cz,generation},terrainGeneration,desiredTerrainChunks)){geometry.dispose();return;}
 const root=new THREE.Group(),mesh=new THREE.Mesh(geometry,grassMat);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
 const entry={cx,cz,key,root,mesh,outline:null};if(gridVisible)createChunkOutline(entry);
 const old=streamedTerrain.get(key);if(old)disposeTerrainChunk(old);
 streamedTerrain.set(key,entry);worldRoot.add(root);dirtyTerrainChunks.delete(key);terrainBuildCount++;terrainBuildTotalMs+=buildMs;terrainBuildLastMs=buildMs;terrainBuildMaxMs=Math.max(terrainBuildMaxMs,buildMs);
 if(cx===chunkCoord(player.pos.x)&&cz===chunkCoord(player.pos.z))$('loading').hidden=true;
 if($('stats'))$('stats').textContent=`청크 ${streamedTerrain.size}/${desiredTerrainChunks.size} · 반경 ${configuredChunkRadius()} · 생성 ${terrainBuildLastMs.toFixed(1)}/${(terrainBuildTotalMs/terrainBuildCount).toFixed(1)}ms 평균 · 지오메트리 ${renderer.info.memory.geometries} · draw ${renderer.info.render.calls}`;
}
function createChunkOutline(entry){if(entry.outline)return;const geometry=new THREE.EdgesGeometry(entry.mesh.geometry,19);entry.outline=new THREE.LineSegments(geometry,edgesMat);entry.root.add(entry.outline);}
function setChunkOutlines(visible){for(const entry of streamedTerrain.values()){if(visible)createChunkOutline(entry);else if(entry.outline){entry.root.remove(entry.outline);entry.outline.geometry.dispose();entry.outline=null;}}}
function queueDesiredTerrain(){terrainGeneration++;terrainWorkQueue=[];queuedTerrainChunks.clear();for(const key of desiredTerrainChunks){if(!streamedTerrain.has(key)||dirtyTerrainChunks.has(key)){const [cx,cz]=key.split(',').map(Number);terrainWorkQueue.push({cx,cz,generation:terrainGeneration});queuedTerrainChunks.add(key);}}}
function updateTerrainStreaming(force=false){
 if(!world?.worldGenVersion)return;
 const pcx=chunkCoord(player.pos.x),pcz=chunkCoord(player.pos.z),radius=configuredChunkRadius(),signature=`${activeChunkWorldKey}|${pcx},${pcz}|${radius}`;
 if(!force&&signature===terrainRequestSignature)return;terrainRequestSignature=signature;terrainGeneration++;
 const nextPlan=planChunkWindow(pcx,pcz,radius),next=new Set(nextPlan.map(chunk=>chunk.key));
 for(const [key,entry]of streamedTerrain)if(!next.has(key)){disposeTerrainChunk(entry);streamedTerrain.delete(key);dirtyTerrainChunks.delete(key);}
 desiredTerrainChunks.clear();for(const chunk of nextPlan)desiredTerrainChunks.add(chunk.key);queueDesiredTerrain();updateWaterStreaming(desiredTerrainChunks);if($('stats'))$('stats').textContent=`청크 ${streamedTerrain.size}/${desiredTerrainChunks.size} · 반경 ${radius}`;if(world)rebuildResources();
}
function invalidateEditedTerrain(){
 const current=new Map(Object.entries(world.edits||{})),changed=[];
 for(const [key,value]of terrainEditSnapshot)if(!current.has(key)||current.get(key)!==value)changed.push(key);
 for(const [key,value]of current)if(!terrainEditSnapshot.has(key)||terrainEditSnapshot.get(key)!==value)changed.push(key);
 terrainEditSnapshot=current;if(!changed.length)return;rebuildTerrainEditIndex();
 for(const key of changed){const [x,,z]=key.split(',').map(Number);if(!Number.isInteger(x)||!Number.isInteger(z))continue;const cx=chunkCoord(x),cz=chunkCoord(z),lx=localCoord(x),lz=localCoord(z);dirtyTerrainChunks.add(terrainChunkKey(cx,cz));if(lx===0)dirtyTerrainChunks.add(terrainChunkKey(cx-1,cz));if(lx===CHUNK_SIZE-1)dirtyTerrainChunks.add(terrainChunkKey(cx+1,cz));if(lz===0)dirtyTerrainChunks.add(terrainChunkKey(cx,cz-1));if(lz===CHUNK_SIZE-1)dirtyTerrainChunks.add(terrainChunkKey(cx,cz+1));}
 queueDesiredTerrain();
}
function rebuildStreamedTerrain(){
 const key=`${world.worldId||''}|${world.worldInstanceId||''}|${world.worldSeed}|${world.worldGenVersion}`;
 if(!chunkWorldActive||key!==activeChunkWorldKey){clearStreamedTerrain();chunkWorldActive=true;activeChunkWorldKey=key;terrainEditSnapshot=new Map(Object.entries(world.edits||{}));rebuildTerrainEditIndex();terrainRequestSignature='';updateTerrainStreaming(true);return;}
 invalidateEditedTerrain();syncWaterEdits(null,world);updateTerrainStreaming();
}
function pumpTerrainWork(){const start=performance.now();while(terrainWorkQueue.length&&performance.now()-start<3){const job=terrainWorkQueue.shift(),key=terrainChunkKey(job.cx,job.cz);queuedTerrainChunks.delete(key);if(!isChunkJobCurrent(job,terrainGeneration,desiredTerrainChunks))continue;try{installChunkMesh(job.cx,job.cz,job.generation);}catch(error){console.error('Chunk mesh build failed:',key,error);}}}
function rebuild(){
 if(world?.worldGenVersion){if(world.worldGenVersion===2)$('stats').textContent='신규 생성 월드 · 중심 청크 준비 중…';if(terrain){worldRoot.remove(terrain);terrain.geometry.dispose();terrain=null;}if(outlines){worldRoot.remove(outlines);outlines.geometry.dispose();outlines=null;}rebuildStreamedTerrain();rebuildHubObjects();return;}
 if(chunkWorldActive)clearStreamedTerrain();
 if(terrain){worldRoot.remove(terrain);terrain.geometry.dispose();}
 if(outlines){worldRoot.remove(outlines);outlines.geometry.dispose();}
 const pos=[],norm=[],col=[],index=[],outlinePos=[];
 let count=0,facesCount=0;
 // Render the saved island size plus actual solid edits only.
 const solids=new Set();
 const half=world.islandSize/2;
 for(let x=-half;x<half;x++)for(let z=-half;z<half;z++)for(let y=-3;y<0;y++)solids.add(x+','+y+','+z);
 for(const [k,value] of Object.entries(world.edits)){if(value)solids.add(k);else solids.delete(k);}
 for(const k of solids){
 const [x,y,z]=k.split(',').map(Number);count++;
 for(const f of faces){
 const [dx,dy,dz]=f.d;if(has(x+dx,y+dy,z+dz))continue;
 const h=hash(x,y,z),shade=f.d[1]===1?colors.top:f.d[1]===-1?colors.bottom:colors.side;
 const rgb=new THREE.Color(shade[(h+facesCount)%shade.length]);
 // Surface is grassy only where an exposed top face exists.
 const start=pos.length/3;
 for(const v of f.v){pos.push(x+v[0],y+v[1],z+v[2]);norm.push(...f.n);col.push(rgb.r,rgb.g,rgb.b);}
 index.push(start,start+1,start+2,start,start+2,start+3);
 facesCount++;
 }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(index);
 terrain=new THREE.Mesh(g,grassMat);terrain.castShadow=true;terrain.receiveShadow=true;worldRoot.add(terrain);
 const edge= new THREE.EdgesGeometry(g,19);outlines=new THREE.LineSegments(edge,edgesMat);outlines.visible=gridVisible;worldRoot.add(outlines);
 $('stats').textContent=world.islandSize+'×'+world.islandSize+' 섬 · 블록 '+count.toLocaleString();
 if(world.worldKind==='shopHub')$('stats').textContent='상점 허브 · 보호 구역';
 rebuildHubObjects();
}
// Low-poly tree and crop parts are shared across generated entities.
const treeTrunk=new THREE.MeshLambertMaterial({color:0x74533a}),birchTrunk=new THREE.MeshLambertMaterial({color:0xd9d0ae}),rubberTrunk=new THREE.MeshLambertMaterial({color:0x533d32});
const treeCanopy=new THREE.MeshLambertMaterial({color:0x488469}),treeTop=new THREE.MeshLambertMaterial({color:0x66a17a}),birchCanopy=new THREE.MeshLambertMaterial({color:0x78a858}),rubberCanopy=new THREE.MeshLambertMaterial({color:0x315e4c});
const wheatStem=new THREE.MeshStandardMaterial({color:0x72954d,roughness:.9}),wheatGrain=new THREE.MeshStandardMaterial({color:0xd8b75b,roughness:.8}),carrotLeaf=new THREE.MeshLambertMaterial({color:0x5c9d50}),carrotRoot=new THREE.MeshLambertMaterial({color:0xe47a32}),potatoLeaf=new THREE.MeshLambertMaterial({color:0x54834a}),potatoRoot=new THREE.MeshLambertMaterial({color:0x987451});
const veinRock=new THREE.MeshStandardMaterial({color:0x606c72,roughness:.95}),veinRockLight=new THREE.MeshStandardMaterial({color:0x879196,roughness:.9}),veinCrystal=new THREE.MeshStandardMaterial({color:0x69b5cf,emissive:0x14566c,emissiveIntensity:.48,roughness:.4});
let treeGroups=[],cropGroups=[],oreGroups=[],resourceRoots=[];
function makeTree(tree){
 const {id,x,z}=tree,species=['oak','birch','rubber'].includes(tree.species)?tree.species:'oak',variant=Number.isFinite(tree.variant)?tree.variant:(Number.isFinite(tree.scale)?Math.max(0,Math.min(1,tree.scale)):0.5),dims=treeDimensions(species,variant),height=Number.isFinite(tree.height)?tree.height:dims.height,crownWidth=Math.min(4,Number.isFinite(tree.crownWidth)?tree.crownWidth:dims.crownWidth),trunkWidth=Math.min(1.5,Number.isFinite(tree.trunkWidth)?tree.trunkWidth:dims.trunkWidth),g=new THREE.Group();
 g.position.set(x+.5,tree.y||0,z+.5);g.userData.resourceId=id;g.userData.resourceTree=tree;treeGroups.push(g);worldRoot.add(g);resourceRoots.push(g);
 const stage=Number.isInteger(tree.stage)?tree.stage:3,trunkMat=species==='birch'?birchTrunk:species==='rubber'?rubberTrunk:treeTrunk,leafMat=species==='birch'?birchCanopy:species==='rubber'?rubberCanopy:treeCanopy,topMat=species==='birch'?treeTop:species==='rubber'?treeCanopy:treeTop;
 if(stage<3){const scale=.32+Math.max(0,stage)*.2,stem=new THREE.Mesh(new THREE.BoxGeometry(Math.min(.35,trunkWidth*.45)*scale,height*.12*scale,Math.min(.35,trunkWidth*.45)*scale),trunkMat);stem.position.y=stem.geometry.parameters.height/2;stem.castShadow=true;g.add(stem);for(let i=0;i<stage+1;i++){const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.18*scale,0),leafMat);leaf.scale.set(1,.75,1);leaf.position.set((i%2?.08:-.08)*scale,.22*scale+i*.08*scale,0);leaf.castShadow=true;g.add(leaf);}}
 else{
  const trunkHeight=height*(species==='rubber'?.68:species==='birch'?.82:.76),trunk=new THREE.Mesh(new THREE.CylinderGeometry(trunkWidth*.43,trunkWidth*.5,trunkHeight,6),trunkMat);trunk.position.y=trunkHeight/2;trunk.castShadow=true;trunk.receiveShadow=true;g.add(trunk);
  const crownY=height*.78,main=new THREE.Mesh(new THREE.IcosahedronGeometry(crownWidth*.35,0),leafMat);main.scale.y=species==='rubber'?.62:species==='birch'?1.25:.88;main.position.y=crownY;main.castShadow=true;g.add(main);
  for(const side of [-1,1]){const cluster=new THREE.Mesh(new THREE.IcosahedronGeometry(crownWidth*.19,0),side<0?topMat:leafMat);cluster.scale.y=species==='birch'?1.35:.88;cluster.position.set(side*crownWidth*.20,crownY-height*.04,0);cluster.castShadow=true;g.add(cluster);}
  if(species==='rubber'){const crown=new THREE.Mesh(new THREE.ConeGeometry(crownWidth*.43,height*.2,7),leafMat);crown.position.y=height*.89;crown.castShadow=true;g.add(crown);}
 }
}
function makeCrop(crop){
 const cropType=cropTypeOf(crop),g=new THREE.Group();g.position.set(crop.x+.5,crop.y,crop.z+.5);g.userData.resourceId=crop.id;g.userData.cropType=cropType;worldRoot.add(g);resourceRoots.push(g);cropGroups.push(g);
 const stage=Math.max(1,Math.min(4,crop.stage||4));const heights=[0,.20,.43,.68,1.02],hScale=heights[stage];
 if(cropType==='carrot'||cropType==='potato'){
  const leaves=cropType==='carrot'?carrotLeaf:potatoLeaf,rootMat=cropType==='carrot'?carrotRoot:potatoRoot,plantHeight=.9*hScale;
  for(let i=0;i<4;i++){const stalk=new THREE.Mesh(new THREE.ConeGeometry(.085*hScale,plantHeight,5),leaves);stalk.position.set((i%2?1:-1)*.09,plantHeight/2,(i<2?1:-1)*.08);stalk.rotation.z=(i%2?1:-1)*.17;stalk.castShadow=true;g.add(stalk);}
  if(stage===4){if(cropType==='carrot'){const root=new THREE.Mesh(new THREE.ConeGeometry(.12,.4,6),rootMat);root.rotation.x=Math.PI;root.position.y=-.12;root.castShadow=true;g.add(root);}else for(const [x,z]of [[-.13,-.07],[.12,.08],[.02,-.17]]){const tuber=new THREE.Mesh(new THREE.IcosahedronGeometry(.12,0),rootMat);tuber.scale.set(1,.7,.8);tuber.position.set(x,.07,z);tuber.castShadow=true;g.add(tuber);}}
  return g;
 }
 const stemMat=stage===3?new THREE.MeshStandardMaterial({color:0x9a9b43,roughness:.9}):wheatStem;
 for(const [x,z,baseH] of [[-.12,-.08,.56],[.11,-.04,.68],[0,.12,.49]]){
  const h=baseH*hScale;const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.018,.027,h,6),stemMat);stalk.position.set(x,h/2,z);stalk.castShadow=true;g.add(stalk);
  if(stage<4)continue;
  const head=new THREE.Group();head.position.set(x,h-.03,z);g.add(head);
  const seed=new THREE.Mesh(new THREE.ConeGeometry(.045,.21,6),wheatGrain);seed.position.y=.08;seed.castShadow=true;head.add(seed);
  for(let i=0;i<4;i++){const grain=new THREE.Mesh(new THREE.SphereGeometry(.025,6,5),wheatGrain);grain.position.set((i%2?1:-1)*.035,.015+Math.floor(i/2)*.055,0);head.add(grain);}
 }
}
const farmRoots=[];
function rebuildFarmVisuals(){for(const o of farmRoots){worldRoot.remove(o);o.geometry?.dispose();o.material?.dispose();}farmRoots.length=0;for(const [x,y,z] of world.tilled||[]){const wet=isFarmTileWatered(world.watered?.[[x,y,z].join(',')]);const m=new THREE.Mesh(new THREE.BoxGeometry(.91,.035,.91),new THREE.MeshLambertMaterial({color:wet?0x604d37:0x74583d}));m.position.set(x+.5,y+.018,z+.5);m.receiveShadow=true;worldRoot.add(m);farmRoots.push(m);}}
function makeOreNode(node){
 const g=new THREE.Group();g.position.set(node.x+.5,node.y,node.z+.5);g.userData.resourceId=node.id;worldRoot.add(g);resourceRoots.push(g);oreGroups.push(g);
 const stones=[[-.20,.31,0,.42,.58,.42], [.18,.25,.15,.40,.48,.38], [.03,.23,-.22,.46,.43,.37],[-.01,.48,.06,.38,.35,.39]];
 for(let i=0;i<stones.length;i++){const [x,y,z,sx,sy,sz]=stones[i];const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(.5,0),i%2?veinRockLight:veinRock);rock.scale.set(sx*1.45,sy*1.45,sz*1.45);rock.position.set(x,y,z);rock.rotation.set(i*.31,i*.67,i*.19);rock.castShadow=true;rock.receiveShadow=true;g.add(rock);}
 for(const [x,y,z,w,h] of [[-.18,.38,.335,.16,.29],[.08,.26,.318,.13,.22],[.23,.40,.12,.1,.18]]){const crystal=new THREE.Mesh(new THREE.BoxGeometry(w,h,.035),veinCrystal);crystal.position.set(x,y,z);crystal.rotation.z=-.28;crystal.castShadow=true;g.add(crystal);}
 g.userData.crystals=g.children.filter(o=>o.material===veinCrystal);updateOreVisual(g,node);
}
function makeWaterSource(source){const g=new THREE.Group();g.position.set(source.x,source.y,source.z);g.userData.waterSource=true;worldRoot.add(g);resourceRoots.push(g);const stone=new THREE.MeshLambertMaterial({color:0x65747a}),water=new THREE.MeshLambertMaterial({color:0x398fb0,transparent:true,opacity:.82});for(const [x,z] of [[.1,.1],[.69,.1],[.1,.69],[.69,.69]]){const wall=new THREE.Mesh(new THREE.BoxGeometry(.2,.24,.2),stone);wall.position.set(x,.12,z);wall.castShadow=true;g.add(wall);}for(const [x,z,w,d] of [[.4,.1,.6,.16],[.4,.69,.6,.16],[.1,.4,.16,.6],[.69,.4,.16,.6]]){const wall=new THREE.Mesh(new THREE.BoxGeometry(w,.28,d),stone);wall.position.set(x,.14,z);wall.castShadow=true;g.add(wall);}const surface=new THREE.Mesh(new THREE.BoxGeometry(.46,.035,.46),water);surface.position.set(.5,.12,.5);g.add(surface);}
function updateOreVisual(group,node){group.userData.remaining=node.remaining;group.traverse(o=>{if(o.material===veinCrystal)o.visible=node.remaining>0;});group.visible=true;}
function rebuildResources(){
 for(const root of resourceRoots){worldRoot.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
 resourceRoots=[];treeGroups=[];cropGroups=[];oreGroups=[];
 for(const tree of world.trees||[]){makeTree(tree);}
 if(world?.worldGenVersion){const harvested=new Set(world.harvestedTrees||[]);for(const key of desiredTerrainChunks){const [cx,cz]=key.split(',').map(Number);for(const tree of generateTreesForChunk(world.worldSeed,cx,cz,surfaceHeightAt,world.worldGenVersion))if(!harvested.has(tree.id))makeTree(tree);}}
 for(const crop of world.crops||[]){makeCrop(crop);}
 for(const node of world.oreNodes||[]){makeOreNode(node);}
 for(const source of world.waterSources||(world.worldVersion>=3?[{x:4,y:0,z:4}]:[])){makeWaterSource(source);}
 rebuildFarmVisuals();updateResources();
}
function updateResources(){
 for(const g of treeGroups){const tree=g.userData.resourceTree||world.trees.find(t=>t.id===g.userData.resourceId);g.visible=!(world.harvestedTrees||[]).includes(g.userData.resourceId)&&tree?.harvested!==true;}
 for(const g of cropGroups)g.visible=!(world.harvestedCrops||[]).includes(g.userData.resourceId);
 for(const g of oreGroups){const node=(world.oreNodes||[]).find(n=>n.id===g.userData.resourceId);if(node)updateOreVisual(g,node);}
}

// Craftable island machinery. Each model is assembled from detailed low-poly parts.
const machineMaterials={
 wood:new THREE.MeshStandardMaterial({color:0x72513a,roughness:.82}),woodLight:new THREE.MeshStandardMaterial({color:0x9a7049,roughness:.75}),
 metal:new THREE.MeshStandardMaterial({color:0x637785,metalness:.68,roughness:.38}),light:new THREE.MeshStandardMaterial({color:0xaebfc4,metalness:.72,roughness:.31}),
 dark:new THREE.MeshStandardMaterial({color:0x263944,metalness:.42,roughness:.58}),stone:new THREE.MeshStandardMaterial({color:0x6f7375,roughness:.95}),soil:new THREE.MeshStandardMaterial({color:0x554334,roughness:1}),leaf:new THREE.MeshStandardMaterial({color:0x5f965f,roughness:1}),water:new THREE.MeshStandardMaterial({color:0x397d9a,roughness:.25}),
 v2dark:new THREE.MeshStandardMaterial({color:0x273237,roughness:.9}),v2steel:new THREE.MeshStandardMaterial({color:0x667881,metalness:.45,roughness:.5}),v2silver:new THREE.MeshStandardMaterial({color:0xb2b8b4,metalness:.35,roughness:.55}),v2light:new THREE.MeshStandardMaterial({color:0xd5d6c6,roughness:.7}),v2iron:new THREE.MeshStandardMaterial({color:0x454f53,metalness:.25,roughness:.8}),v2wood:new THREE.MeshStandardMaterial({color:0x785337,roughness:.95}),v2woodlight:new THREE.MeshStandardMaterial({color:0xb08958,roughness:.9}),v2wooddark:new THREE.MeshStandardMaterial({color:0x503d31,roughness:.98}),v2stone:new THREE.MeshStandardMaterial({color:0x777777,roughness:1}),v2stoneDark:new THREE.MeshStandardMaterial({color:0x50545a,roughness:1}),v2tan:new THREE.MeshStandardMaterial({color:0x9a7452,roughness:.95}),v2soil:new THREE.MeshStandardMaterial({color:0x5b4634,roughness:1}),v2green:new THREE.MeshStandardMaterial({color:0x658b55,roughness:1}),v2lime:new THREE.MeshStandardMaterial({color:0x95b471,roughness:1}),v2leaf:new THREE.MeshStandardMaterial({color:0x3d725b,roughness:1}),v2gold:new THREE.MeshStandardMaterial({color:0xd6ab59,metalness:.55,roughness:.45}),v2copper:new THREE.MeshStandardMaterial({color:0xae724a,metalness:.5,roughness:.5}),v2rust:new THREE.MeshStandardMaterial({color:0x865540,roughness:.9}),v2blue:new THREE.MeshStandardMaterial({color:0x5aa8ad,roughness:.7}),v2water:new THREE.MeshStandardMaterial({color:0x387b9a,roughness:.3}),v2red:new THREE.MeshStandardMaterial({color:0xba7153,roughness:.9}),v2screen:new THREE.MeshStandardMaterial({color:0x8bd6ba,roughness:.5}),v2yellow:new THREE.MeshStandardMaterial({color:0xe7c875,roughness:.75}),v2black:new THREE.MeshStandardMaterial({color:0x1c2528,roughness:1}),belt:new THREE.MeshStandardMaterial({color:0x25343c,roughness:.9}),
 brass:new THREE.MeshStandardMaterial({color:0xc29248,metalness:.72,roughness:.34}),cyan:new THREE.MeshStandardMaterial({color:0x62c1c3,emissive:0x164d55,emissiveIntensity:.55}),
 ember:new THREE.MeshStandardMaterial({color:0xf48a45,emissive:0xb93d0c,emissiveIntensity:1.8}),
};
let machineRoots=[];const dropRoots=new Map();
function machineBox(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function machineCylinder(parent,r1,r2,h,mat,x,y,z,axis='y',segments=16){const o=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,segments),mat);o.position.set(x,y,z);if(axis==='x')o.rotation.z=Math.PI/2;if(axis==='z')o.rotation.x=Math.PI/2;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function machineBolt(parent,x,y,z){machineCylinder(parent,.035,.035,.025,machineMaterials.brass,x,y,z,'z',8);}
function makeT1Bench(root){
 const m=machineMaterials;
 machineBox(root,.94,.12,.78,m.dark,0,.82,0);machineBox(root,.84,.055,.7,m.woodLight,0,.91,0);
 for(const x of [-.38,.38])for(const z of [-.29,.29]){machineBox(root,.09,.75,.09,m.metal,x,.39,z);machineBox(root,.13,.07,.13,m.brass,x,.08,z);}
 machineBox(root,.78,.23,.58,m.dark,0,.62,.01);
 for(const x of [-.25,0,.25]){machineBox(root,.22,.12,.035,m.metal,x,.65,.31);machineBox(root,.075,.035,.025,m.brass,x,.65,.34);}
 // T1 control spine, recipe plate and illuminated work surface.
 machineBox(root,.58,.08,.09,m.dark,0,1.03,-.28);machineBox(root,.35,.22,.06,m.metal,0,1.17,-.28);
 machineBox(root,.25,.13,.018,m.cyan,0,1.17,-.24);
 machineCylinder(root,.19,.19,.055,m.brass,.29,1.02,.05,'y',20);machineCylinder(root,.135,.135,.06,m.cyan,.29,1.075,.05,'y',20);
 for(const x of [-.36,.36])machineBolt(root,x,.97,.34);
}
function makeWorkbench(root){
 const m=machineMaterials;
 for(const x of [-.39,.39])for(const z of [-.29,.29]){
  machineBox(root,.09,.77,.09,m.wood,x,.39,z);machineBox(root,.12,.08,.12,m.dark,x,.08,z);
 }
 machineBox(root,1,.12,.78,m.woodLight,0,.82,0);
 for(const x of [-.31,0,.31])machineBox(root,.29,.025,.75,m.wood, x,.89,0);
 machineBox(root,.78,.28,.58,m.wood,0,.61,.03);
 for(const y of [.57,.70]){
  machineBox(root,.7,.075,.025,m.woodLight,0,y,.335);
  machineCylinder(root,.025,.025,.09,m.brass,0,y,.365,'z',10);
 }
 // A functional-looking bench vise, threaded handle and jaws.
 machineBox(root,.22,.07,.22,m.dark,-.29,.96,-.22);machineBox(root,.25,.08,.1,m.light,-.29,1.02,-.22);
 machineBox(root,.055,.16,.1,m.brass,-.39,1.08,-.22);machineBox(root,.055,.16,.1,m.brass,-.19,1.08,-.22);
 machineCylinder(root,.024,.024,.31,m.light,-.29,.95,-.38,'x',12);machineCylinder(root,.045,.045,.055,m.brass,-.45,.95,-.38,'x',12);
 // Peg rail with a hammer and two hanging hand tools.
 machineBox(root,.7,.08,.07,m.wood,0,1.18,-.34);
 machineBox(root,.06,.26,.055,m.woodLight,-.22,1.04,-.31);machineBox(root,.24,.08,.10,m.light,-.22,1.17,-.31);
 machineBox(root,.06,.22,.05,m.brass,.05,1.02,-.31);machineBox(root,.24,.035,.05,m.light,.05,1.12,-.31);
 // A compact inspection lamp and green status lens.
 machineCylinder(root,.025,.025,.23,m.dark,.34,1.02,-.25);machineBox(root,.22,.09,.18,m.brass,.34,1.16,-.25);
 machineBox(root,.07,.045,.035,m.cyan,.34,1.11,-.15);
 for(const x of [-.44,.44])for(const z of [-.32,.32])machineBolt(root,x,.91,z);
}
// T0 station models translated from TERRA_T0_Workstations_3D_v2.html.
// The source parts share one uniform 0.54 scale, keeping the complete XZ bounds below 1 m.
function makeToolBench(root){
 const m=machineMaterials;
 for(const x of [-.68,.68])for(const z of [-.58,.58])machineBox(root,.15,.73,.15,m.v2wood,x,.38,z);
 machineBox(root,1.7,.18,1.43,m.v2woodlight,0,.82,0);machineBox(root,1.75,.05,1.47,m.v2wood,0,.88,0);
 machineBox(root,.58,.31,.42,m.v2dark,-.48,1.12,-.1);machineBox(root,.81,.1,.3,m.v2steel,-.48,1.32,-.1);machineBox(root,.25,.16,.2,m.v2silver,-.79,1.27,-.1);
 machineBox(root,.55,.25,.42,m.v2wood,.36,1.05,.05);machineBox(root,.45,.045,.36,m.v2dark,.36,1.23,.05);
 for(const x of [.6,-.48])machineBox(root,.11,.83,.13,m.v2wood,x,1.33,-.49);machineBox(root,1.18,.13,.13,m.v2woodlight,.07,1.7,-.49);
 machineBox(root,.06,.43,.05,m.v2woodlight,-.28,1.46,-.4);machineBox(root,.36,.07,.07,m.v2silver,-.28,1.63,-.4);
 machineBox(root,.07,.36,.05,m.v2woodlight,.03,1.45,-.4);machineBox(root,.23,.17,.1,m.v2steel,.03,1.6,-.4);
 machineBox(root,.06,.4,.05,m.v2gold,.34,1.45,-.4);machineBox(root,.44,.065,.15,m.v2silver,.34,1.53,-.4);
 for(const x of [-.6,.35]){machineBox(root,.45,.2,.1,m.v2wood,x,.53,.68);machineBox(root,.18,.055,.04,m.v2gold,x,.53,.74);}
}
function makeAgricultureBench(root){
 const m=machineMaterials;
 for(const x of [-.68,.68])for(const z of [-.58,.58])machineBox(root,.15,.73,.15,m.v2wood,x,.38,z);
 machineBox(root,1.73,.15,1.44,m.v2woodlight,0,.82,0);machineBox(root,1.6,.04,1.34,m.v2dark,0,.91,0);
 machineBox(root,.83,.23,.8,m.v2wood,-.43,1.02,0);machineBox(root,.74,.07,.72,m.v2soil,-.43,1.17,0);
 for(const x of [-.66,-.38,-.12])for(const z of [-.2,.2]){machineBox(root,.06,.32,.06,m.v2green,x,1.35,z);machineBox(root,.18,.1,.07,m.v2green,x-.1,1.41,z);machineBox(root,.15,.08,.08,m.v2green,x+.08,1.52,z);}
 machineBox(root,.5,.2,.75,m.v2dark,.51,1.02,.02);machineBox(root,.43,.04,.65,m.v2water,.51,1.14,.02);
 machineCylinder(root,.125,.125,.32,m.v2gold,.53,1.36,-.17,'y',10);machineBox(root,.16,.09,.1,m.v2silver,.7,1.38,-.17);
 machineBox(root,1.25,.12,.11,m.v2wood,.2,1.38,-.54);machineBox(root,1.25,.64,.1,m.v2wood,.2,1.72,-.54);
 for(let i=0;i<5;i++)machineBox(root,.12,.16,.035,i%2?m.v2woodlight:m.v2gold,-.29+i*.23,1.66,-.47);
 for(const x of [-.4,.35]){machineBox(root,.62,.28,.13,m.v2wood,x,.55,.7);machineBox(root,.1,.05,.04,m.v2gold,x,.55,.78);}
}
function makeBlockBench(root){
 const m=machineMaterials;
 for(const x of [-.68,.68])for(const z of [-.58,.58])machineBox(root,.15,.73,.15,m.v2wood,x,.38,z);
 machineBox(root,1.73,.15,1.43,m.v2dark,0,.82,0);machineBox(root,1.65,.05,1.34,m.v2stone,0,.91,0);
 machineBox(root,.68,.31,.8,m.v2stone,-.47,1.09,.04);machineBox(root,.61,.05,.73,m.v2silver,-.49,1.27,.03);
 for(let i=0;i<3;i++)machineBox(root,.55,.17,.47,i%2?m.v2stone:m.v2woodlight,.5,1.01+i*.20,-.13);
 machineBox(root,.55,.25,.35,m.v2wood,.5,1.11,.52);machineBox(root,.24,.05,.22,m.v2woodlight,.5,1.26,.52);
 machineBox(root,.13,.85,.12,m.v2steel,-.84,1.36,-.49);machineBox(root,1.45,.13,.13,m.v2dark,-.15,1.73,-.49);machineBox(root,.08,.53,.09,m.v2steel,.52,1.45,-.49);
 machineBox(root,.08,.63,.53,m.v2steel,-.08,1.39,-.27);machineBox(root,.045,.3,.35,m.v2silver,-.08,1.14,-.12);
 machineBox(root,.77,.04,.08,m.v2gold,.03,.96,.52);for(let i=0;i<8;i++)machineBox(root,.015,.02,.08,m.v2dark,-.33+i*.1,.99,.53);
}
function makeBasicAssembler(root){
 const m=machineMaterials;
 for(const x of [-.68,.68])for(const z of [-.58,.58])machineBox(root,.15,.73,.15,m.v2wood,x,.38,z);
 machineBox(root,1.74,.18,1.44,m.v2wood,0,.82,0);machineBox(root,1.8,.055,1.5,m.v2dark,0,.92,0);
 machineBox(root,.67,.43,.65,m.v2stone,-.49,1.13,-.05);machineBox(root,.43,.24,.045,m.v2dark,-.49,1.11,.285);machineBox(root,.26,.12,.022,m.v2rust,-.49,1.11,.312);
 for(const x of [-.78,-.2])machineBox(root,.08,.37,.67,m.v2stone,x,1.27,-.05);machineBox(root,.72,.1,.7,m.v2stone,.49,1.4,-.05);
 machineBox(root,.18,.33,.18,m.v2dark,-.49,1.59,-.26);machineBox(root,.28,.055,.28,m.v2stone,-.49,1.76,-.26);
 machineBox(root,.64,.18,.66,m.v2stone,.39,1.035,0);for(const x of [.1,.68])machineBox(root,.09,.58,.11,m.v2dark,x,1.37,-.24);
 machineBox(root,.72,.12,.13,m.v2wood,.39,1.67,-.24);machineBox(root,.12,.42,.12,m.v2steel,.39,1.42,-.24);machineBox(root,.4,.08,.36,m.v2dark,.39,1.22,0);
 machineBox(root,.12,.12,.48,m.v2wood,.69,1.44,.18);machineBox(root,.13,.35,.11,m.v2woodlight,.69,1.44,.4);machineCylinder(root,.07,.07,.09,m.v2steel,.7,1.58,.45,'z',10);
 machineBox(root,.28,.12,.22,m.v2woodlight,.05,1.05,.51);machineBox(root,.05,.19,.06,m.v2steel,.13,1.16,.51);
 for(const x of [-.72,.72])machineBox(root,.11,.66,.12,m.v2dark,x,1.28,-.62);machineBox(root,1.53,.1,.11,m.v2wood,0,1.65,-.62);
 machineBox(root,.08,.3,.07,m.v2woodlight,.17,1.47,-.58);machineBox(root,.25,.08,.08,m.v2steel,.17,1.6,-.58);
}
function makeDrill(root){
 const m=machineMaterials;
 machineBox(root,.92,.12,.88,m.dark,0,.12,0);
 for(const x of [-.36,.36])for(const z of [-.32,.32]){machineBox(root,.1,.27,.1,m.metal,x,.25,z);machineBox(root,.14,.05,.14,m.brass,x,.07,z);}
 machineBox(root,.56,.48,.59,m.metal,.12,.53,0);machineBox(root,.48,.10,.52,m.light,.12,.82,0);
 machineBox(root,.22,.21,.22,m.dark,.29,.46,.34);machineBox(root,.12,.08,.07,m.cyan,.29,.62,.47);
 // Exposed rotary head, auger helix and pointed cutting bit.
 machineCylinder(root,.15,.15,.28,m.dark,-.27,.55,0,'x',20);machineCylinder(root,.11,.11,.7,m.light,-.66,.55,0,'x',20);
 const rotor=new THREE.Group();rotor.position.set(-1.03,.55,0);root.add(rotor);
 const pts=[];for(let i=0;i<=64;i++){const t=i/64,a=t*Math.PI*6;pts.push(new THREE.Vector3(t*.42,.13*Math.cos(a),.13*Math.sin(a)));}
 const helix=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),96,.035,7,false),m.brass);helix.castShadow=true;rotor.add(helix);
 const bit=new THREE.Mesh(new THREE.ConeGeometry(.14,.25,12),m.light);bit.rotation.z=-Math.PI/2;bit.position.x=.51;bit.castShadow=true;rotor.add(bit);
 root.userData.rotors=[rotor];
 machineCylinder(root,.19,.19,.11,m.dark,.18,.79,.34,'z',18);
 for(let i=0;i<10;i++){const a=i*Math.PI/5;machineBox(root,.08,.08,.07,m.brass,.18+Math.cos(a)*.2,.79+Math.sin(a)*.2,.42);}
 machineBox(root,.26,.17,.2,m.dark,.34,.31,-.15);machineBox(root,.07,.08,.05,m.ember,.34,.32,-.26);
 for(const x of [-.4,.4])machineBolt(root,x,.2,.43);
}
function makeConveyor(root,uphill=false){
 const m=machineMaterials;
 machineBox(root,.98,.11,.92,m.dark,0,.25,0);
 if(uphill){const belt=machineBox(root,Math.SQRT2,.07,.74,m.belt,0,.9,0);belt.rotation.z=Math.PI/4;for(const z of [-.43,.43]){const rail=machineBox(root,Math.SQRT2,.14,.075,m.light,0,.9,z);rail.rotation.z=Math.PI/4;}}else{machineBox(root,.84,.07,.74,m.belt,0,.34,0);for(const z of [-.43,.43])machineBox(root,.98,.14,.075,m.light,0,.38,z);}
 for(const x of [-.38,-.13,.13,.38])machineCylinder(root,.045,.045,.74,m.metal,x,.31,0,'z',12);
 for(const x of [-.38,.38])for(const z of [-.34,.34])machineBox(root,.08,.20,.08,m.metal,x,.1,z);
 // Raised brass direction chevrons across the moving surface.
 for(const x of [-.2,.12]){const a=machineBox(root,.045,.018,.24,m.brass,x,.39,0);a.rotation.y=Math.PI/4;const b=machineBox(root,.045,.018,.24,m.brass,x,.39,0);b.rotation.y=-Math.PI/4;}
 machineBox(root,.14,.08,.06,m.cyan,-.39,.47,-.39);
 for(const x of [-.44,.44])for(const z of [-.38,.38])machineBolt(root,x,.47,z);
}
function makeSmelter(root){
 const m=machineMaterials;
 machineBox(root,.9,.16,.88,m.dark,0,.13,0);
 for(const x of [-.34,.34])for(const z of [-.31,.31])machineBox(root,.12,.18,.12,m.metal,x,.29,z);
 machineBox(root,.78,.78,.72,m.metal,0,.73,0);machineBox(root,.65,.61,.12,m.dark,0,.72,.39);
 machineBox(root,.38,.34,.035,m.ember,0,.70,.46);machineBox(root,.52,.055,.07,m.brass,0,.91,.45);machineBox(root,.52,.055,.07,m.brass,0,.49,.45);
 machineCylinder(root,.25,.25,.045,m.dark,0,.72,.50,'z',20);
 // Chimney stack, segmented collar and cooling fins.
 machineBox(root,.24,.45,.24,m.dark,-.22,1.31,-.18);machineBox(root,.32,.07,.32,m.brass,-.22,1.12,-.18);machineBox(root,.31,.08,.31,m.light,-.22,1.53,-.18);
 machineBox(root,.38,.06,.29,m.dark,.28,1.17,-.12);
 for(let i=0;i<5;i++)machineBox(root,.06,.27,.08,i%2?m.light:m.brass,.36+i*.075,.73,-.18);
 machineBox(root,.19,.16,.12,m.dark,.34,.40,.39);machineBox(root,.07,.06,.04,m.cyan,.34,.42,.46);
 machineCylinder(root,.055,.055,.12,m.brass,.34,.58,.44,'z',12);
 for(const x of [-.34,.34])for(const y of [.39,1.06])machineBolt(root,x,y,.38);
}
function makeMachineModel(type,options={}){
 const root=new THREE.Group();
 if(type==='t1_bench')makeT1Bench(root);else if(type==='tool_bench')makeToolBench(root);else if(type==='agriculture_bench')makeAgricultureBench(root);else if(type==='block_bench')makeBlockBench(root);else if(type==='basic_assembler')makeBasicAssembler(root);else if(type==='farming_bench'){makeT1Bench(root);machineBox(root,.58,.12,.48,machineMaterials.woodLight,0,1.28,.08);for(let x=-.18;x<=.19;x+=.36){machineBox(root,.14,.08,.14,machineMaterials.cyan,x,1.38,.08);}}else if(type==='workbench')makeWorkbench(root);else if(type==='drill')makeDrill(root);else if(type==='conveyor')makeConveyor(root,options.uphill===true);else if(type==='smelter')makeSmelter(root);
 if(['tool_bench','agriculture_bench','block_bench','basic_assembler'].includes(type)){
  root.scale.setScalar(.54);root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3());
  if(size.x>.98||size.z>.98)throw new Error(`${type} exceeds its one-tile footprint (${size.x.toFixed(3)} × ${size.z.toFixed(3)} m)`);
  root.userData.floorOffset=-bounds.min.y;root.userData.modelAabb={min:bounds.min.toArray(),max:bounds.max.toArray()};
 }
 if(type==='drill')root.scale.x=.68; // Keep the auger inside its one-tile footprint.
 return root;
}
function buildMachineMesh(machine){
 const [dx,dz]=[[1,0],[0,1],[-1,0],[0,-1]][machine.rotation]||[1,0];
 const uphill=machine.type==='conveyor'&&(world.machines||[]).some(m=>m.type==='conveyor'&&m.x===machine.x+dx&&m.y===machine.y+1&&m.z===machine.z+dz);
 const root=makeMachineModel(machine.type,{uphill});
 root.userData.machineType=machine.type;
 root.position.set(machine.x+.5,machine.y+(root.userData.floorOffset||0),machine.z+.5);root.rotation.y=machine.rotation*Math.PI/2;worldRoot.add(root);return root;
}
function syncWorldDrops(){
 const live=new Set((world?.drops||[]).map(d=>d.id));
 for(const [id,entry]of dropRoots)if(!live.has(id)){worldRoot.remove(entry.root);entry.root.traverse(o=>{if(o.geometry)o.geometry.dispose();});dropRoots.delete(id);}
 for(const drop of world?.drops||[]){let entry=dropRoots.get(drop.id);if(!entry){const root=makeItemModel(drop.item);root.scale.setScalar(.82);root.userData.dropId=drop.id;worldRoot.add(root);entry={root,target:new THREE.Vector3(),phase:(drop.id.charCodeAt(0)||0)*.17};dropRoots.set(drop.id,entry);}entry.target.set(drop.x,drop.y,drop.z);entry.conveyor=!!drop.conveyorId;entry.quantity=drop.quantity;}
}
let machinePreview=null,previewValid=false;
function clearMachinePreview(){if(!machinePreview)return;worldRoot.remove(machinePreview);machinePreview.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});machinePreview=null;}
function createMachinePreview(type){clearMachinePreview();machinePreview=makeMachineModel(type);machinePreview.traverse(o=>{if(!o.material)return;o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.58;m.depthWrite=false;}});machinePreview.visible=false;worldRoot.add(machinePreview);}
function updateMachinePreview(sx,sy){
 if(mode!=='machine'||!placingMachine||!machinePreview)return;const cell=targetBlock(sx,sy,'place');
 if(!cell){machinePreview.visible=false;return;}
 const {x,y,z}=cell,centerX=x+.5,centerY=y+.5,centerZ=z+.5;
 const portal=world.personalPortal,portalReserved=!!portal&&Math.abs(x-portal.x)<=1&&z===portal.z&&y>=0&&y<=2;
 const inWorldBounds=world?.worldGenVersion?x>=-4096&&x<4096&&z>=-4096&&z<4096&&y>=WORLD_MIN_Y&&y<=WORLD_MAX_Y:x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16;
 previewValid=inWorldBounds&&!portalReserved&&(world.inventory.items?.[placingMachine]||0)>0&&!has(x,y,z)&&has(x,y-1,z)&&!(world.machines||[]).some(m=>m.x===x&&m.y===y&&m.z===z)&&!(Math.abs(centerX-player.pos.x)<.65&&Math.abs(centerZ-player.pos.z)<.65&&centerY>=player.pos.y&&centerY<=player.pos.y+1.8);
 machinePreview.visible=true;machinePreview.position.set(x+.5,y+(machinePreview.userData.floorOffset||0),z+.5);machinePreview.rotation.y=machineRotation*Math.PI/2;
 $('placementHint').textContent=(previewValid?'✓ 배치 가능':'⊘ 배치 불가')+' · 방향 '+['북','동','남','서'][machineRotation]+' · R 회전 · Esc 취소';
 machinePreview.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.color.set(previewValid?0x77d6ac:0xe68070);m.emissive.set(previewValid?0x184c36:0x60251d);}});
}
function rebuildMachines(){
 for(const root of machineRoots){worldRoot.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
 machineRoots=(world?.machines||[]).map(buildMachineMesh);
}
function clearHubRoots(){for(const root of hubRoots){worldRoot.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}hubRoots=[];farmerModel=null;}
function hubBox(parent,w,h,d,color,x,y,z,glow=0){const mat=new THREE.MeshStandardMaterial({color,roughness:.9,emissive:glow,emissiveIntensity:glow?0.65:0});const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function portalModel(data){const root=new THREE.Group();root.position.set(data.x+.5,data.y,data.z+.5);root.rotation.y=data.rotation||0;root.userData.portal=data;worldRoot.add(root);hubRoots.push(root);
 hubBox(root,.25,2.3,.4,0x737d80,-.82,1.15,0);hubBox(root,.25,2.3,.4,0x737d80,.82,1.15,0);hubBox(root,1.95,.34,.45,0x9aa1a0,0,2.28,0);hubBox(root,1.22,1.75,.08,0x43bddd,0,1.17,0,0x137294);hubBox(root,2,.12,.65,0x666e70,0,.06,0);return root;}
function rebuildHubObjects(){clearHubRoots();if(!world)return;
 if(world.worldKind==='shopHub'){
  const tileMat=new THREE.MeshStandardMaterial({color:0xaaa891,roughness:1}),pathMat=new THREE.MeshStandardMaterial({color:0xc4b99b,roughness:1});
  const grass=new THREE.Group();worldRoot.add(grass);hubRoots.push(grass);for(let x=-8;x<8;x++)for(let z=-8;z<8;z++)hubBox(grass,.99,.035,.99,0x789b65,x+.5,.012,z+.5);
  for(let x=-4;x<=4;x++)for(let z=-5;z<=3;z++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.99,.05,.99),tileMat);mesh.position.set(x+.5,.045,z+.5);mesh.receiveShadow=true;worldRoot.add(mesh);hubRoots.push(mesh);}
  for(const [x,z] of [[0,5],[0,0],[0,-1]]){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.98,.055,.98),pathMat);mesh.position.set(x+.5,.075,z+.5);worldRoot.add(mesh);hubRoots.push(mesh);}
  for(const d of world.hub.layout.decorations){const g=new THREE.Group();g.position.set(d.x,d.y,d.z);worldRoot.add(g);hubRoots.push(g);if(d.type==='tree'){hubBox(g,.42,1.35,.42,0x795438,.5,.68,.5);for(const [x,y,z,s] of [[.5,1.65,.5,1.6],[.15,2.05,.5,1.15],[.83,1.95,.5,1.15]])hubBox(g,s,.75,s,0x5c946b,x,y,z);}else{hubBox(g,.12,2.5,.12,0x584a3b,.5,1.25,.5);hubBox(g,.42,.48,.42,0xf5d995,.5,2.6,.5,0xffc95e);}}
  for(const p of world.hub.layout.portals)portalModel(p);
  const npc=world.hub.layout.npcs.find(n=>n.type==='farmer');if(npc){farmerModel=createFarmerNpc(THREE);farmerModel.group.position.set(npc.x+.5,npc.y,npc.z+.5);farmerModel.group.rotation.y=Math.PI;worldRoot.add(farmerModel.group);hubRoots.push(farmerModel.group);}
 }else if(world.personalPortal)portalModel(world.personalPortal);
}
const humanoid=new THREE.Group();worldRoot.add(humanoid);const arms=[],legs=[];
const skin=new THREE.MeshLambertMaterial({color:0xe4c6a5}),suit=new THREE.MeshLambertMaterial({color:0x3e6c82}),visor=new THREE.MeshLambertMaterial({color:0x122f43}),boots=new THREE.MeshLambertMaterial({color:0x253d4a});
function box(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
// Shared low-poly item parts feed both the held model and the cached HUD thumbnails.
const itemMats={wood:new THREE.MeshStandardMaterial({color:0x815c3e,roughness:.9}),woodLight:new THREE.MeshStandardMaterial({color:0xb1875b,roughness:.86}),sand:new THREE.MeshStandardMaterial({color:0xd5bf83,roughness:.95}),stone:new THREE.MeshStandardMaterial({color:0x66747a,roughness:.92}),dark:new THREE.MeshStandardMaterial({color:0x293238,roughness:.9}),light:new THREE.MeshStandardMaterial({color:0xb8c5c6,metalness:.25,roughness:.52}),metal:new THREE.MeshStandardMaterial({color:0x9aabb0,metalness:.48,roughness:.5}),gold:new THREE.MeshStandardMaterial({color:0xd3ad59,metalness:.4,roughness:.48}),crystal:new THREE.MeshStandardMaterial({color:0x58a9be,metalness:.12,roughness:.32,emissive:0x123b50,emissiveIntensity:.35}),leaf:new THREE.MeshStandardMaterial({color:0x659552,roughness:.9}),food:new THREE.MeshStandardMaterial({color:0xd8b45b,roughness:.8}),carrot:new THREE.MeshLambertMaterial({color:0xe47a32}),potato:new THREE.MeshLambertMaterial({color:0x987451})};
const toolNames=TOOL_NAMES;
function makeItemModel(id){const g=new THREE.Group(),m=itemMats;const handle=()=>{const h=new THREE.Mesh(new THREE.BoxGeometry(.12,.78,.12),m.wood);h.position.y=-.04;h.castShadow=true;g.add(h);};
 if(['wood_pickaxe','stone_pickaxe','wood_axe','wood_shovel','hoe','scythe'].includes(id)){handle();if(id==='wood_pickaxe'||id==='stone_pickaxe'){box(g,.22,.25,.14,m.woodLight,0,.33,0);const headMat=id==='stone_pickaxe'?m.light:m.stone;box(g,.68,.19,.18,headMat,0,.43,0);box(g,.17,.16,.2,id==='stone_pickaxe'?m.metal:m.woodLight,-.27,.43,0);box(g,.17,.16,.2,id==='stone_pickaxe'?m.metal:m.woodLight,.27,.43,0);}else if(id==='wood_axe'){box(g,.23,.27,.18,m.woodLight,0,.34,0);const head=new THREE.Mesh(new THREE.BoxGeometry(.22,.48,.20),m.metal);head.position.set(.18,.42,0);head.castShadow=true;g.add(head);const edge=new THREE.Mesh(new THREE.BoxGeometry(.34,.12,.22),m.metal);edge.position.set(.24,.64,0);edge.rotation.z=-.24;g.add(edge);}else if(id==='wood_shovel'){box(g,.22,.26,.11,m.woodLight,0,.33,0);const blade=new THREE.Mesh(new THREE.BoxGeometry(.38,.34,.1),m.metal);blade.position.y=.62;blade.rotation.z=-.08;g.add(blade);box(g,.22,.08,.12,m.metal,0,.79,0);}else if(id==='hoe'){box(g,.2,.25,.13,m.woodLight,0,.34,0);box(g,.55,.11,.14,m.metal,0,.53,0);box(g,.18,.18,.16,m.metal,.22,.43,0);}else{box(g,.2,.25,.13,m.woodLight,0,.34,0);const blade=new THREE.Mesh(new THREE.TorusGeometry(.25,.045,5,8,Math.PI),m.metal);blade.position.set(.23,.47,0);blade.rotation.z=Math.PI/2;g.add(blade);}}
 else if(['stone','ore','iron_ore','coal_ore','copper_ore','coal','iron_vein_core','coal_vein_core','copper_vein_core'].includes(id)){if(id==='coal'){const coal=new THREE.Mesh(new THREE.DodecahedronGeometry(.27,0),m.dark);coal.scale.set(1,.7,.85);g.add(coal);}else for(let i=0;i<5;i++){const a=new THREE.Mesh(new THREE.IcosahedronGeometry(.19+(i%2)*.045,0),i%3===0?m.metal:m.stone);a.position.set((i-2)*.12,(i%2)*.16,((i*7)%3-1)*.09);a.rotation.set(i*.4,i*.7,i*.2);g.add(a);}if(id!=='stone'&&id!=='coal')for(const [x,y]of [[-.1,.12],[.12,.23]]){const gem=id.includes('iron')?m.gold:id.includes('copper')?m.woodLight:m.crystal,c=new THREE.Mesh(new THREE.OctahedronGeometry(.105,0),gem);c.position.set(x,y,.11);g.add(c);}}
 else if(id==='iron_ingot'||id==='ingot'){const a=new THREE.Mesh(new THREE.BoxGeometry(.62,.18,.32),m.metal);a.position.y=.05;g.add(a);const b=new THREE.Mesh(new THREE.BoxGeometry(.52,.18,.27),m.metal);b.position.y=.21;g.add(b);}
 else if(['dirt','sand','coal_block','block_dirt'].includes(id)){const a=new THREE.Mesh(new THREE.BoxGeometry(.62,.62,.62),id==='sand'?m.sand:id==='coal_block'?machineMaterials.dark:m.wood);g.add(a);if(!['sand','coal_block'].includes(id))for(const [x,y,z]of [[-.18,.2,.12],[.14,-.1,.2],[.12,.11,-.19]])box(g,.12,.1,.12,m.woodLight,x,y,z);}
 else if(id.includes('wheat')||id==='food'){for(let i=0;i<3;i++){const stem=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,.58,5),m.leaf);stem.position.set((i-1)*.12,.08,0);g.add(stem);const seed=new THREE.Mesh(new THREE.ConeGeometry(.075,.2,6),m.food);seed.position.set((i-1)*.12,.4,0);g.add(seed);}}
 else if(id.includes('carrot')){const root=new THREE.Mesh(new THREE.ConeGeometry(.2,.55,6),m.carrot);root.rotation.x=Math.PI;root.position.y=-.03;g.add(root);for(let i=0;i<3;i++){const leaf=new THREE.Mesh(new THREE.ConeGeometry(.055,.4,5),m.leaf);leaf.position.set((i-1)*.09,.3,0);leaf.rotation.z=(i-1)*.22;g.add(leaf);}}
 else if(id.includes('potato')){for(const [x,y,z]of [[-.14,0,0],[.08,.05,.1],[.02,-.07,-.1]]){const tuber=new THREE.Mesh(new THREE.IcosahedronGeometry(.16,0),m.potato);tuber.scale.set(1,.72,.8);tuber.position.set(x,y,z);g.add(tuber);}}
 else if(['oak_log','birch_log','rubberwood'].includes(id)){const bark=id==='birch_log'?birchTrunk:id==='rubberwood'?rubberTrunk:treeTrunk,woodEnd=id==='birch_log'?itemMats.light:itemMats.woodLight;const log=new THREE.Mesh(new THREE.CylinderGeometry(.20,.23,.56,7),bark);log.rotation.z=Math.PI/2;log.position.y=.02;g.add(log);const end=new THREE.Mesh(new THREE.CircleGeometry(.2,7),woodEnd);end.rotation.y=Math.PI/2;end.position.x=.281;end.position.y=.02;g.add(end);}
 else if(id==='rubber_sap'){const drop=new THREE.Mesh(new THREE.OctahedronGeometry(.22,0),m.gold);drop.scale.set(.8,1.2,.75);g.add(drop);}
 else if(id.includes('sapling')){const leaf=id.includes('birch')?birchCanopy:id.includes('rubber')?rubberCanopy:treeCanopy;box(g,.1,.48,.1,id.includes('birch')?birchTrunk:treeTrunk,0,0,0);for(const [x,y,z]of [[0,.25,0],[.13,.12,0],[-.13,.10,0]]){const l=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,0),leaf);l.position.set(x,y,z);g.add(l);}}
 else if(id==='drill'||id==='conveyor'){const machine=makeMachineModel(id);g.add(machine);machine.scale.setScalar(.45);machine.rotation.x=-.35;}
 else {const a=new THREE.Mesh(new THREE.IcosahedronGeometry(.3,0),m.stone);g.add(a);}
 g.rotation.x=-.16;return g;}
const itemThumbs=new Map();let thumbRenderer=null;const thumbScene=new THREE.Scene();thumbScene.add(new THREE.HemisphereLight(0xffffff,0x566677,2));const thumbLight=new THREE.DirectionalLight(0xffe3b5,2.3);thumbLight.position.set(-3,5,6);thumbScene.add(thumbLight);const thumbCamera=new THREE.PerspectiveCamera(34,1,.1,20);thumbCamera.position.set(1.45,1.25,2.2);thumbCamera.lookAt(0,.12,0);
function itemThumbnail(id){if(itemThumbs.has(id))return itemThumbs.get(id);if(!thumbRenderer){thumbRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});thumbRenderer.setPixelRatio(1);thumbRenderer.setSize(72,72);thumbRenderer.outputColorSpace=THREE.SRGBColorSpace;thumbRenderer.setClearColor(0x000000,0);}const model=makeItemModel(id);thumbScene.add(model);thumbRenderer.render(thumbScene,thumbCamera);const url=thumbRenderer.domElement.toDataURL('image/png');thumbScene.remove(model);model.traverse(o=>{if(o.geometry)o.geometry.dispose();});itemThumbs.set(id,url);return url;}
let heldToolModel=null;
function equipHeldTool(id){if(heldToolModel){heldToolModel.parent?.remove(heldToolModel);heldToolModel=null;}if(!toolNames[id]&&!RESOURCE_KEYS.includes(id))return;heldToolModel=makeItemModel(id);heldToolModel.scale.setScalar(['dirt','sand','coal_block'].includes(id)?.56:.72);heldToolModel.position.set(.13,-.49,-.19);heldToolModel.rotation.z=-.35;(arms[1]||humanoid).add(heldToolModel);}
// Ordinary adult proportions in metres: 1.78 m tall, ~0.68 m arm-to-arm width.
// Feet sit at y=0, and the top of the head is exactly PLAYER_HEIGHT_METERS.
box(humanoid,.44,.65,.25,suit,0,1.105,0); // torso: 0.78–1.43 m
box(humanoid,.28,.28,.27,skin,0,1.64,0); // head: 1.50–1.78 m
box(humanoid,.23,.09,.05,visor,0,1.65,-.16);
for(const side of [-1,1]){
 const arm=new THREE.Group();arm.position.set(side*.28,1.41,0);box(arm,.12,.60,.19,suit,0,-.30,0);arms.push(arm);humanoid.add(arm);
 const leg=new THREE.Group();leg.position.set(side*.125,.78,0);box(leg,.18,.78,.22,boots,0,-.39,0);legs.push(leg);humanoid.add(leg);
}
let gaitPhase=0;function animateWalk(dt,moving){if(moving)gaitPhase+=dt*8;const targetLeg=moving?Math.sin(gaitPhase)*.55:0,targetArm=-targetLeg*.75;for(let i=0;i<2;i++){legs[i].rotation.x=THREE.MathUtils.damp(legs[i].rotation.x,i===0?targetLeg:-targetLeg,10,dt);arms[i].rotation.x=THREE.MathUtils.damp(arms[i].rotation.x,i===0?targetArm:-targetArm,10,dt);}}
const player={pos:new THREE.Vector3(.5,0,.5),grounded:true};
let playerImmersed=false,playerSwimming=false;
function setAuthoritativeWaterState(state={}){playerImmersed=state.immersed===true;playerSwimming=state.swimming===true;humanoid.rotation.x=playerSwimming?-.12:0;scene.background.set(playerImmersed?'#527e98':'#94c5e7');if(scene.fog)scene.fog.color.set(playerImmersed?'#527e98':'#94c5e7');$('jump').setAttribute('aria-label',playerImmersed?'수영 상승':'점프');$('jump').title=playerImmersed?'수영 상승':'점프';}
const keys=new Set(),touchMove=new THREE.Vector2(0,0);let jumpQueued=false,swimQueued=false,movementBusy=false,lastMovementAt=0,lastCraftStationState='';
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Space'&&!e.repeat)jump();if(e.code==='KeyE'&&!e.repeat){if(nearInteraction)void interactWorld();else toggleInventory();return;}if(e.code==='Escape'){closeInventory();if(mode==='machine'){placingMachine=null;setMode('place');notice('배치 취소');}if(!$('shopPanel').hidden){$('shopPanel').hidden=true;updateInteractionUi();}}if(e.code==='KeyR'&&mode==='machine'){machineRotation=(machineRotation+1)%4;setMode('machine');}const slot=e.code.match(/^Digit([1-8])$/);if(slot){selectQuickSlot(Number(slot[1])-1);return;}keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
function setMode(s){cancelMine();mode=s;$('place').classList.toggle('selected',s==='place');$('mine').classList.toggle('selected',s==='mine');$('farm').classList.toggle('selected',s==='farm');$('craftToggle').classList.toggle('selected',s==='machine');$('farmSelectors').hidden=s!=='farm';const hint=$('placementHint');if(s!=='place')blockPreview.visible=false;if(s==='machine'){hint.hidden=false;if(!machinePreview)createMachinePreview(placingMachine);hint.textContent='설비 배치 중 · '+(recipeCards.find(r=>r.id===placingMachine)?.name||'기계')+' · 탭하여 놓기 · R 회전 · Esc 취소';}else{clearMachinePreview();hint.hidden=true;if(s==='place'&&lastBlockPreviewPoint)updateBlockPreview(lastBlockPreviewPoint.x,lastBlockPreviewPoint.y);}}
$('place').onclick=()=>{placingMachine=null;setMode('place');};$('mine').onclick=()=>{placingMachine=null;setMode('mine');};
$('farm').onclick=()=>{placingMachine=null;setMode(mode==='farm'?'place':'farm');notice('농사 도구를 선택하고 경작지나 작물을 탭해.');};
$('jump').onclick=jump;
function jump(){if(playerImmersed)swimQueued=true;else if(player.grounded)jumpQueued=true;}
function sendMovement(now){
 if(!world||movementBusy)return;
 if(world.worldGenVersion===2&&!streamedTerrain.has(terrainChunkKey(chunkCoord(player.pos.x),chunkCoord(player.pos.z))))return;
 const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMove.x;
 const dz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-touchMove.y;
 const moving=Math.hypot(dx,dz)>.05;if(!moving&&player.grounded&&!jumpQueued&&!swimQueued&&now-lastMovementAt<5000)return;if(now-lastMovementAt<50)return;
 lastMovementAt=now;
 const length=Math.hypot(dx,dz),sx=length>1?dx/length:dx,sz=length>1?dz/length:dz;
 const dirX=sx*Math.cos(camYaw)-sz*Math.sin(camYaw),dirZ=-sx*Math.sin(camYaw)-sz*Math.cos(camYaw);
 if(Math.hypot(dirX,dirZ)>.05)humanoid.rotation.y=Math.atan2(-dirX,-dirZ);
 const jump=jumpQueued,swim=swimQueued;jumpQueued=false;swimQueued=false;movementBusy=true;const teleportVersion=devTeleportVersion;
 void api('/api/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:dirX,z:dirZ,jump,swim})}).then(data=>{
  if(teleportVersion!==devTeleportVersion)return;
  const previousWorld=world;if(data.world)world=data.world;else if(data.fluidCells)world={...world,fluidCells:data.fluidCells,fluidRevision:data.fluidRevision,player:{...world.player,...data.player}};syncWaterEdits(previousWorld,world);
  player.pos.set(data.player.x,data.player.y,data.player.z);player.grounded=data.player.grounded;humanoid.position.copy(player.pos);
  setAuthoritativeWaterState(data.player);
  const stationState=(world?.machines||[]).filter(m=>['t1_bench','tool_bench','agriculture_bench','farming_bench','block_bench','basic_assembler','workbench','drill'].includes(m.type)).map(m=>m.type+':'+(Math.hypot(m.x+.5-player.pos.x,m.y+.6-(player.pos.y+1),m.z+.5-player.pos.z)<=4.5)).join('|');
  if(!$('craftPanel').hidden&&stationState!==lastCraftStationState){lastCraftStationState=stationState;updateCrafting();}
 }).catch(err=>{if(teleportVersion!==devTeleportVersion)return;if(jump)jumpQueued=true;if(swim)swimQueued=true;if(!movementBusy)return;notice('이동 동기화 실패: '+err.message);}).finally(()=>{if(teleportVersion===devTeleportVersion)movementBusy=false;});
}
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
const MINING_DURATION_MS=1200;
let pressStart=null,dragCam=false,lastPoint=null,touchZoom=0,holdMining=null;
let harvestRange=null;
function showHarvestRange(cell){if(harvestRange){worldRoot.remove(harvestRange);harvestRange.geometry.dispose();harvestRange.material.dispose();}harvestRange=new THREE.Mesh(new THREE.BoxGeometry(3,3,3),new THREE.MeshBasicMaterial({color:0xe8d675,wireframe:true,transparent:true,opacity:.42,depthWrite:false}));harvestRange.position.set(cell.x+.5,cell.y+.5,cell.z+.5);worldRoot.add(harvestRange);setTimeout(()=>{if(harvestRange){worldRoot.remove(harvestRange);harvestRange.geometry.dispose();harvestRange.material.dispose();harvestRange=null;}},900);}
const miningHud=$('mining'),miningFill=$('miningFill'),miningLabel=$('miningLabel');
function cancelMine(){
 const previous=holdMining;
 holdMining=null;
 miningHud.hidden=true;
 miningFill.style.width='0%';
 if(previous?.serverStarted){const path=previous.resourceType==='tree'||previous.resourceType==='wheat'||previous.resourceType==='crop'?'/api/harvest':'/api/mine';void api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'cancel'})}).catch(()=>{});}
}
function terrainRayTargets(){return world?.worldGenVersion?[...streamedTerrain.values()].map(entry=>entry.mesh):terrain?[terrain]:[];}
function targetBlock(sx,sy,action){
 const targets=terrainRayTargets();if(!world||!targets.length)return null;
 const rect=renderer.domElement.getBoundingClientRect();
 ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);
 ray.setFromCamera(ndc,camera);
 const hit=ray.intersectObjects(targets,false)[0];if(!hit||hit.distance>75)return null;
 const normal=hit.face.normal;
 const point=worldRoot.worldToLocal(hit.point.clone()).addScaledVector(normal,action==='place'?.015:-.015);
 const x=Math.floor(point.x),y=Math.floor(point.y),z=Math.floor(point.z);
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5)return null;
 return {x,y,z};
}
let lastBlockPreviewPoint=null,blockPlacementValid=false;
function blockPlacementError({x,y,z}){
 const generated=!!world?.worldGenVersion;
 if(generated?(x< -4096||x>=4096||z< -4096||z>=4096||y<WORLD_MIN_Y||y>WORLD_MAX_Y):(x< -64||x>=64||z< -64||z>=64||y< -8||y>16))return '설치 범위 밖';
 const portal=world?.personalPortal;if(portal&&Math.abs(x-portal.x)<=1&&z===portal.z&&y>=0&&y<=2)return '포털 보호 구역';
 if(has(x,y,z))return '이미 블록이 있음';
 const placeItem=['dirt','sand','coal_block'].includes(selectedTool)?selectedTool:'dirt';if((world?.inventory?.[placeItem]||0)<1)return `${RESOURCE_LABELS[placeItem]} 부족`;
 if(Object.keys(world?.edits||{}).length>=20000&&!Object.hasOwn(world.edits,`${x},${y},${z}`))return '월드 편집 한도';
 if(![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>has(x+dx,y+dy,z+dz)))return '붙일 면이 없음';
 const cx=x+.5,cy=y+.5,cz=z+.5;
 if(Math.abs(cx-player.pos.x)<.65&&Math.abs(cz-player.pos.z)<.65&&cy>=player.pos.y&&cy<=player.pos.y+1.8)return '플레이어와 겹침';
 return '';
}
function updateBlockPreview(sx,sy){
 lastBlockPreviewPoint={x:sx,y:sy};
 if(mode!=='place'||world?.worldKind==='shopHub'){blockPreview.visible=false;return;}
 const cell=targetBlock(sx,sy,'place');if(!cell){blockPreview.visible=false;$('placementHint').hidden=true;return;}
 const reason=blockPlacementError(cell);blockPlacementValid=!reason;blockPreview.visible=true;blockPreview.position.set(cell.x+.5,cell.y+.5,cell.z+.5);
 const color=blockPlacementValid?0x79d9ad:0xe66f68;
 for(const material of blockPreviewMaterials){material.color.setHex(blockPlacementValid?0x84aa72:0xe66f68);material.emissive.setHex(blockPlacementValid?0x173b27:0x4b1718);material.emissiveIntensity=.25;}
 blockPreviewEdgeMat.color.setHex(color);blockPreviewMark.visible=!blockPlacementValid;
 const hint=$('placementHint');hint.hidden=false;hint.textContent=blockPlacementValid?'✓ '+RESOURCE_LABELS[['dirt','sand','coal_block'].includes(selectedTool)?selectedTool:'dirt']+' 설치 가능':'⊘ '+reason;
}
function targetHarvestable(sx,sy){
 const rect=renderer.domElement.getBoundingClientRect();ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);ray.setFromCamera(ndc,camera);
 const targets=terrainRayTargets(),groundHit=targets.length?ray.intersectObjects(targets,false)[0]:null;let best=null;
 const consider=(group,type)=>{if(!group.visible)return;const hit=ray.intersectObject(group,true)[0];if(hit&&hit.distance<=75&&(!groundHit||hit.distance<groundHit.distance)&&(!best||hit.distance<best.distance))best={id:group.userData.resourceId,type,distance:hit.distance};};
 for(const group of cropGroups)consider(group,'crop');
 if(selectedTool==='wood_axe')for(const group of treeGroups)consider(group,'tree');
 if(selectedTool==='wood_pickaxe')for(const group of oreGroups)if((world.oreNodes.find(n=>n.id===group.userData.resourceId)?.remaining||0)>0)consider(group,'ore');
 return best;
}
function beginHoldMining(requestPath,payload,hold,label){
 const mining={...hold,tool:payload.tool||selectedTool,startedAt:performance.now(),done:false,serverStarted:false};holdMining=mining;
 miningHud.hidden=false;miningFill.style.width='0%';miningLabel.textContent=label+' 0%';
 void api(requestPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'start',...payload})}).then(()=>{
  if(holdMining===mining){mining.serverStarted=true;mining.startedAt=performance.now();}
  else void api(requestPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'cancel'})}).catch(()=>{});
 }).catch(err=>{if(holdMining===mining){cancelMine();notice('시작 실패: '+err.message);}});
}
function updateMine(now){
 if(!holdMining||holdMining.done)return;
 if(holdMining.resourceType){
  const {resourceType,resourceId}=holdMining;
  if(resourceType==='tree'&&(world?.harvestedTrees||[]).includes(resourceId)||(resourceType==='wheat'||resourceType==='crop')&&(world?.harvestedCrops||[]).includes(resourceId)||busy){cancelMine();return;}
  if(resourceType==='ore'&&!(world.oreNodes||[]).some(n=>n.id===resourceId&&n.remaining>0)){cancelMine();return;}
  const elapsed=Math.max(0,now-holdMining.startedAt);
  miningFill.style.width=Math.min(100,elapsed/MINING_DURATION_MS*100).toFixed(1)+'%';
  const label=resourceType==='tree'?'나무 채집':resourceType==='wheat'||resourceType==='crop'?'작물 수확':'돌 광맥 채굴';
  miningLabel.textContent=label+' '+Math.min(100,Math.floor(elapsed/MINING_DURATION_MS*100))+'%';
  if(elapsed>=MINING_DURATION_MS&&holdMining.serverStarted){const mining=holdMining;holdMining=null;miningHud.hidden=true;miningFill.style.width='0%';
   const request=resourceType==='ore'?api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'mine',targetType:'ore',resourceId,tool:mining.tool,revision:world.revision})}):api('/api/harvest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'collect',resourceType,resourceId,tool:mining.tool})});
   void request.then(data=>{world=data.world;inventory();updateResources();updateCrafting();if(resourceType==='ore')scheduleOreRegeneration();const reward=data.rewards||{};notice(resourceType==='tree'?'벌목 완료 · '+Object.entries(reward).map(([k,v])=>`${RESOURCE_LABELS[k]||k} +${v}`).join(' · '):resourceType==='wheat'||resourceType==='crop'?'수확 완료 · '+Object.entries(reward).map(([k,v])=>`${RESOURCE_LABELS[k]||k} +${v}`).join(' · '):'광물 +1 · 광맥 코어 추가 획득 가능');}).catch(err=>{if(err.world){world=err.world;inventory();updateResources();updateCrafting();}notice('수확 실패: '+err.message);});
  }return;
 }
 const {x,y,z}=holdMining.cell;
 if(!world||!has(x,y,z)||busy){cancelMine();return;}
 const elapsed=Math.max(0,now-holdMining.startedAt);
 miningFill.style.width=Math.min(100,elapsed/MINING_DURATION_MS*100).toFixed(1)+'%';
 miningLabel.textContent='채굴 중 '+Math.min(100,Math.floor(elapsed/MINING_DURATION_MS*100))+'%';
 if(elapsed>=MINING_DURATION_MS&&holdMining.serverStarted){
  const cell=holdMining.cell;
  const tool=holdMining.tool;holdMining.done=true;holdMining=null;miningHud.hidden=true;miningFill.style.width='0%';
  void interactCell(cell,'mine',tool);
 }
}
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'&&!e.isPrimary){cancelMine();return;}
 if(mode==='place')updateBlockPreview(e.clientX,e.clientY);else if(mode==='machine')updateMachinePreview(e.clientX,e.clientY);
 pressStart={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};
 lastPoint={x:e.clientX,y:e.clientY};dragCam=false;
 renderer.domElement.setPointerCapture(e.pointerId);
 if(mode==='mine'&&!busy){
  const resource=targetHarvestable(e.clientX,e.clientY);
  if(resource?.type==='wheat'||resource?.type==='crop'){
   const crop=world.crops.find(c=>c.id===resource.id);if(crop?.stage>=4&&!busy){busy=true;void api('/api/farm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'harvest',x:crop.x,y:crop.y,z:crop.z,tool:'hand',revision:world.revision})}).then(data=>{world=data.world;inventory();rebuildResources();const product=productItemForCrop(cropTypeOf(crop)),seed=seedItemForCrop(cropTypeOf(crop));notice(`수확 완료 · ${RESOURCE_LABELS[product]} +1 · ${RESOURCE_LABELS[seed]} +1`);}).catch(err=>{if(err.world){world=err.world;inventory();rebuildResources();}notice('수확 실패: '+err.message);}).finally(()=>busy=false);}else notice('작물이 아직 익지 않았어.');
  }else if(resource?.type==='tree'){
   const label=resource.type==='tree'?'나무 채집':'밀 수확';
   beginHoldMining('/api/harvest',{resourceType:resource.type,resourceId:resource.id,tool:selectedTool},{resourceType:resource.type,resourceId:resource.id},label);
  }else if(resource?.type==='ore'){
   beginHoldMining('/api/mine',{targetType:'ore',resourceId:resource.id,tool:selectedTool,revision:world.revision},{resourceType:'ore',resourceId:resource.id},'돌 광맥 채굴');
  }else{
   const cell=targetBlock(e.clientX,e.clientY,'mine');
   if(!cell)return;
   const blockType=world.worldGenVersion?blockAt(world,cell.x,cell.y,cell.z):(has(cell.x,cell.y,cell.z)?'dirt':null),soil=['dirt','grass'].includes(blockType);
   if(soil&&selectedTool!=='wood_shovel'){notice('흙은 나무 삽을 선택해야 캘 수 있어.');return;}
   if(!soil&&!['wood_pickaxe','stone_pickaxe'].includes(selectedTool)){notice('돌과 광석은 곡괭이를 선택해야 캘 수 있어.');return;}
   beginHoldMining('/api/mine',{targetType:'block',...cell,tool:selectedTool,revision:world.revision},{cell},soil?'흙 채굴':'광물 채굴');
  }
 }
});
renderer.domElement.addEventListener('pointermove',e=>{
 if(mode==='machine')updateMachinePreview(e.clientX,e.clientY);
 else if(mode==='place')updateBlockPreview(e.clientX,e.clientY);
 if(!pressStart||e.pointerId!==pressStart.id||!lastPoint)return;
 const dx=e.clientX-lastPoint.x,dy=e.clientY-lastPoint.y;
 lastPoint={x:e.clientX,y:e.clientY};
 if(Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>12){
  if(holdMining)cancelMine();
  dragCam=true;
 }
 if(dragCam){camYaw-=dx*.006;camPitch=Math.max(.15,Math.min(1.22,camPitch+dy*.006));}
});
renderer.domElement.addEventListener('pointerup',e=>{
 if(!pressStart||e.pointerId!==pressStart.id)return;
 if(world?.worldKind==='shopHub'){cancelMine();pressStart=null;lastPoint=null;return;}
 if(!dragCam&&performance.now()-pressStart.t<500){if(mode==='place')void interact(e.clientX,e.clientY);else if(mode==='farm')void interactFarm(e.clientX,e.clientY);else if(mode==='machine'&&placingMachine)void placeMachineAt(e.clientX,e.clientY);}
 cancelMine();pressStart=null;lastPoint=null;
});
renderer.domElement.addEventListener('pointercancel',e=>{
 if(pressStart?.id!==e.pointerId)return;
 cancelMine();pressStart=null;lastPoint=null;
});
renderer.domElement.addEventListener('lostpointercapture',e=>{
 if(pressStart?.id!==e.pointerId)return;
 cancelMine();pressStart=null;lastPoint=null;
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelMine();});
window.addEventListener('blur',cancelMine);
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();camDistance=Math.min(38,Math.max(8,camDistance+Math.sign(e.deltaY)*1.05));},{passive:false});
renderer.domElement.addEventListener('touchmove',e=>{if(e.touches.length===2){const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(touchZoom)camDistance=Math.max(8,Math.min(38,camDistance*touchZoom/d));touchZoom=d;}},{passive:true});
renderer.domElement.addEventListener('touchend',()=>touchZoom=0);
function notice(message){$('notice').textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').textContent='',3000);}
const toolDisplay={...Object.fromEntries(Object.entries(toolNames).map(([id,label])=>[id,{label}])),...Object.fromEntries(RESOURCE_KEYS.map(id=>[id,{label:RESOURCE_LABELS[id]}]))};
function updateQuickbar(){
 const slots=world?.inventory?.quickSlots||[];document.querySelectorAll('.quickSlot').forEach((button,i)=>{
 const id=slots[i],info=toolDisplay[id],count=id?(toolNames[id]?(world.inventory.tools?.[id]||0):(world.inventory[id]||0)):0;
 button.classList.toggle('active',i===selectedSlot&&!!info&&count>0);button.classList.toggle('empty',!info||count<1);button.disabled=!info||count<1;
 const image=button.querySelector('img');if(info&&count>0){image.src=itemThumbnail(id);image.alt='';image.setAttribute('aria-hidden','true');}else{image.removeAttribute('src');image.alt='';}button.querySelectorAll('small')[1].textContent=info&&count>0?'×'+count:'';
 button.setAttribute('aria-label',info?`슬롯 ${i+1}: ${info.label} ${count}개`:`슬롯 ${i+1}: 비어 있음`);button.title=info?info.label:'빈 슬롯';
 });
}
function selectQuickSlot(slot){const id=world?.inventory?.quickSlots?.[slot],count=id?(toolNames[id]?(world.inventory.tools?.[id]||0):(world.inventory[id]||0)):0;if(!id||!toolDisplay[id]||count<1)return;selectedSlot=slot;selectedTool=id;equipHeldTool(id);if(['dirt','sand','coal_block'].includes(id))setMode('place');updateQuickbar();void api('/api/slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:slot})}).then(data=>{if(data.world)world=data.world;}).catch(()=>{});}
document.querySelectorAll('.quickSlot').forEach((button,i)=>button.addEventListener('click',()=>selectQuickSlot(i)));
function closeInventory(){$('inventoryPanel').hidden=true;$('inventoryButton').setAttribute('aria-expanded','false');}
function toggleInventory(){const panel=$('inventoryPanel');panel.hidden=!panel.hidden;$('inventoryButton').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)renderInventory();}
$('inventoryButton').addEventListener('click',toggleInventory);$('inventoryClose').addEventListener('click',closeInventory);
function assignInventoryItem(id){const slots=world?.inventory?.quickSlots||[],existing=slots.indexOf(id),slot=existing>=0?existing:slots.findIndex((value,i)=>i>=3&&!value);if(slot<0){notice('빈 퀵슬롯이 없어. 기존 슬롯을 먼저 비워.');return;}void api('/api/slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:slot,item:id})}).then(data=>{world=data.world;selectedSlot=slot;selectedTool=id;equipHeldTool(id);if(['dirt','sand','coal_block'].includes(id))setMode('place');updateQuickbar();renderInventory();}).catch(err=>notice(err.message));}
function renderInventory(){if(!world)return;const list=$('inventoryItems');list.replaceChildren();for(const [id,info]of Object.entries(toolDisplay)){const count=toolNames[id]?(world.inventory.tools?.[id]||0):(world.inventory[id]||0);if(count<1)continue;const button=document.createElement('button');button.className='inventoryItem';button.innerHTML=`<img src="${itemThumbnail(id)}" alt=""><span>${info.label} · ×${count}</span>`;button.setAttribute('aria-label',`${info.label} ${count}개, 퀵슬롯에 장착`);button.onclick=()=>assignInventoryItem(id);list.append(button);}for(const id of RESOURCE_KEYS){const count=world.inventory[id]||0;if(count<1||toolDisplay[id])continue;const item=document.createElement('div');item.className='inventoryItem';item.innerHTML=`<img src="${itemThumbnail(id)}" alt=""><span>${RESOURCE_LABELS[id]} · ×${count}</span>`;list.append(item);}}
function inventory(){
 syncWorldDrops();const inv=world.inventory;$('dirt').textContent=inv.dirt;$('wood').textContent=inv.wood||0;
 const visibleResources=RESOURCE_KEYS.filter(id=>!['dirt','wood','sapling'].includes(id)&&(inv[id]||0)>0).map(id=>`${RESOURCE_LABELS[id]} ${inv[id]}`);
 $('resources').textContent=['코인 '+(world.coins||0),'목재 '+(inv.wood||0),'돌 '+(inv.stone||0),...visibleResources,'묘목 '+(inv.sapling||0),'물 '+(inv.wateringCanUses??10),'흙 '+inv.dirt].join(' · ');
 $('dirtSmall').textContent='×'+inv.dirt;$('revision').textContent='저장 버전 '+world.revision;updateQuickbar();renderInventory();updateObjective();
}
function scheduleOreRegeneration(){
 for(const node of world?.oreNodes||[])if(node.remaining===0&&node.regenAt){
  const delay=Math.max(0,node.regenAt-Date.now()+50);
  setTimeout(()=>{void api('/api/world').then(data=>{world=data;inventory();updateResources();updateCrafting();}).catch(()=>{});},delay);
 }
}
async function api(path,opts){const r=await fetch(path,{credentials:'same-origin',...opts});let payload;try{payload=await r.json()}catch{throw Error('서버 응답 오류');}if(!r.ok){const e=new Error(payload.error||'요청 실패');e.world=payload.world;throw e;}return payload;}
const postJson=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function tileDistance(o){return Math.hypot(o.x+.5-player.pos.x,o.y-(player.pos.y+1),o.z+.5-player.pos.z);}
function nearbyInteraction(){if(!world)return null;const all=[];if(world.worldKind!=='shopHub')for(const d of world.drops||[]){const distance=Math.hypot(d.x-player.pos.x,d.y-(player.pos.y+1),d.z-player.pos.z);all.push({kind:'item',id:d.id,item:d.item,quantity:d.quantity,label:`줍기 · ${d.item} ×${d.quantity}`,distance,radius:2.35});}if(world.worldKind==='shopHub'){for(const p of world.hub?.layout?.portals||[])all.push({kind:'portal',label:'개인 섬으로 돌아가기',destination:'personal',distance:tileDistance(p),radius:3.5});for(const n of world.hub?.layout?.npcs||[])all.push({kind:'farmer',id:n.id,label:'농부 상점 열기',distance:tileDistance(n),radius:n.interactionRadius});}else {for(const m of world.machines||[]){if(!stationLabels[m.type])continue;all.push({kind:'station',id:m.id,station:m.type,label:`${stationLabels[m.type]} 열기`,distance:tileDistance(m),radius:3.5});}if(world.personalPortal)all.push({kind:'portal',label:'상점 허브 입장',destination:'shopHub',distance:tileDistance(world.personalPortal),radius:world.personalPortal.interactionRadius});}return all.filter(x=>x.distance<=x.radius).sort((a,b)=>a.distance-b.distance)[0]||null;}
function updateInteractionUi(){nearInteraction=nearbyInteraction();const hub=world?.worldKind==='shopHub';$('worldInteract').hidden=!nearInteraction||!$('shopPanel').hidden;$('worldInteract').textContent=nearInteraction?.label||'상호작용';$('hotbar').hidden=hub;$('objective').hidden=hub;$('grid').hidden=hub;document.querySelector('#top h1 span').textContent=hub?'/ SHOP HUB':'/ MY ISLAND';if(hub)$('craftPanel').hidden=true;}
function loadWorld(next){const old=world?.worldKind,previous=world;world=next;syncWaterEdits(previous,next);if(world.player){player.pos.set(world.player.x,world.player.y,world.player.z);player.grounded=world.player.grounded===true;humanoid.position.copy(player.pos);setAuthoritativeWaterState(world.player);}if(old!==world.worldKind){$('shopPanel').hidden=true;setMode('place');rebuild();rebuildMachines();rebuildResources();}inventory();updateCrafting();updateInteractionUi();}
function rewardToast(item,amount){if(!amount)return;const line=document.createElement('div');line.className='pickup';line.textContent=(RESOURCE_LABELS[item]||item)+' ×'+amount;$('pickups').append(line);setTimeout(()=>line.remove(),2200);}
async function interactWorld(){if(!nearInteraction||interactionBusy)return;interactionBusy=true;const action=nearInteraction;try{if(action.kind==='item'){const data=await api('/api/items/pickup',postJson({dropId:action.id,revision:world.revision}));world=data.world;inventory();syncWorldDrops();rewardToast(action.item,action.quantity);notice(`${action.item} +${action.quantity} · 수동 획득`);}else if(action.kind==='portal'){const data=await api('/api/world/transition',postJson({destination:action.destination}));loadWorld(data.world);notice(action.destination==='shopHub'?'상점 허브에 도착했어.':'개인 섬으로 돌아왔어.');}else if(action.kind==='station'){activeCraftStation=action.station;updateCrafting();$('craftPanel').hidden=false;updateInteractionUi();}else{const data=await api('/api/shop/open',postJson({npcId:action.id}));shopRevision=data.revision;$('shopCoins').textContent='보유 코인 · '+data.coins.toLocaleString()+' 코인';$('shopPanel').hidden=false;refreshShopButtons();updateInteractionUi();}}catch(e){if(e.world)loadWorld(e.world);notice(e.message);}finally{interactionBusy=false;}}
$('worldInteract').addEventListener('click',()=>void interactWorld());
function refreshShopButtons(){const coins=world?.coins||0,stock=world?.inventory?.wheat||0,buyCount=shopQuantity==='max'?1:Number(shopQuantity),sellCount=shopQuantity==='max'?1:Number(shopQuantity);$('shopCoins').textContent='보유 코인 · '+coins.toLocaleString()+' 코인';document.querySelectorAll('[data-buy-seed]').forEach(button=>{const price=button.dataset.buySeed==='wheat_seed'?5:button.dataset.buySeed==='carrot_seed'?6:7;button.disabled=coins<price*buyCount;});$('sellWheat').disabled=stock<sellCount;}
document.querySelectorAll('[data-qty]').forEach(b=>b.addEventListener('click',()=>{shopQuantity=b.dataset.qty;document.querySelectorAll('[data-qty]').forEach(q=>q.classList.toggle('selected',q===b));refreshShopButtons();}));
async function trade(action,item){if(interactionBusy)return;interactionBusy=true;try{const result=await api('/api/shop/trade',postJson({action,item,quantity:shopQuantity,revision:shopRevision}));shopRevision=result.world.revision;loadWorld(result.world);refreshShopButtons();notice(action==='buy'?`${RESOURCE_LABELS[item]} 구매 완료`:'밀 판매 완료');}catch(e){if(e.world)loadWorld(e.world);notice(e.message);refreshShopButtons();}finally{interactionBusy=false;}}
document.querySelectorAll('[data-buy-seed]').forEach(button=>button.addEventListener('click',()=>void trade('buy',button.dataset.buySeed)));$('sellWheat').addEventListener('click',()=>void trade('sell','wheat'));$('shopClose').addEventListener('click',()=>{$('shopPanel').hidden=true;updateInteractionUi();});
const recipeCards=[
 {id:'tool_bench',name:'도구 제작대',description:'모루와 수공구 걸이, 서랍이 있는 설치형 제작대.',cost:{stone:10,wood:5},station:null},
 {id:'agriculture_bench',name:'농업 제작대',description:'모종 트레이와 물통, 씨앗 수납이 있는 설치형 제작대.',cost:{wheat:10,wood:5},station:null},
 {id:'block_bench',name:'블록 제작대',description:'절단 작업판과 가공 블록, 측정자가 있는 설치형 제작대.',cost:{stone:5,wood:5},station:null},
 {id:'basic_assembler',name:'초급 조합대',description:'거친 화덕과 수동 프레스, 손잡이 크랭크가 있는 설치형 제작대.',cost:{stone:20,iron_ore:10,wood:20,coal_block:5},station:null},
 {id:'stone_pickaxe',name:'돌 곡괭이',description:'돌과 철·석탄·구리 광석을 캘 수 있는 돌 곡괭이.',cost:{wood:3,stone:3},station:'tool_bench',tool:true},
 {id:'hoe',name:'나무 괭이',description:'일반 흙을 경작지로 바꿔.',cost:{wood:2,stone:1},station:'agriculture_bench',tool:true},
 {id:'watering_can',name:'물뿌리개',description:'경작지에 물을 줘 작물 성장을 두 배로 높여.',cost:{wood:2,stone:2},station:'agriculture_bench',tool:true},
 {id:'scythe',name:'낫',description:'선택한 작물 주변 3×3×3의 성숙한 작물을 수확해.',cost:{wood:2,stone:3},station:'agriculture_bench',tool:true},
 {id:'coal_block',name:'석탄 블록',description:'밸런스 확정 전 임시 비율을 적용한 블록.',cost:{[COAL_BLOCK_RECIPE.inputItem]:COAL_BLOCK_RECIPE.inputQuantity},station:'block_bench',output:true},
 {id:'farming_bench',name:'농업 작업대 (기존)',description:'기존 저장을 위한 T1 농업 작업대 레시피.',cost:{wood:2,stone:3},station:'t1_bench'},
 {id:'workbench',name:'목공 작업대',description:'기본 T1 제작대에서 만드는 기존 작업대.',cost:{wood:8,dirt:6},station:'t1_bench'},
 {id:'drill',name:'회전식 채굴 드릴',description:'광맥을 파낼 수 있는 중형 드릴 프레임.',cost:{wood:10,dirt:12},station:'basic_assembler'},
 {id:'conveyor',name:'롤러 컨베이어',description:'광물과 부품을 옮기는 방향 전환형 벨트 타일.',cost:{wood:4,dirt:5},station:'basic_assembler'},
 {id:'smelter',name:'제련로',description:'기존 구현된 제련 설비.',cost:{wood:6,dirt:10},station:'basic_assembler'}
];
const stationLabels={t0:'기본 조합대',tool_bench:'도구 제작대',agriculture_bench:'농업 제작대',farming_bench:'농업 작업대 (기존)',block_bench:'블록 제작대',basic_assembler:'초급 조합대',t1_bench:'T1 제작대'};
function updateObjective(){
 if(!world)return;const items=world.inventory.items||{},machines=world.machines||[],wood=world.inventory.wood||0,treesLeft=(world.trees||[]).filter(t=>!(world.harvestedTrees||[]).includes(t.id)).length;
 const built=type=>machines.some(m=>m.type===type),set=(title,text)=>{$('objectiveTitle').textContent=title;$('objectiveText').textContent=text;};
 if(!built('workbench')&&!items.workbench){if(wood<8)set('목표 1 · 목재 모으기',treesLeft?'나무에 가까이 가서 나무 도끼로 길게 눌러 벌목해. 목재와 묘목을 얻어.':'필요한 목재가 부족해.');else set('목표 1 · 작업대 제작','시작 지점 근처 T1 제작대에서 목공 작업대를 만들어.');return;}
 if(items.workbench){set('목표 2 · 작업대 배치','초록색 미리보기가 보이는 빈 바닥에 작업대를 놓아.');return;}
 if(!built('drill')){if(items.drill){set('목표 3 · 드릴 배치','작업대에서 떨어져 있지 않은 빈 타일에 드릴을 배치해.');return;}if(wood<10)set('목표 3 · 드릴 재료 모으기',treesLeft?'나무를 더 채집해 드릴 재료를 모아.':'목재가 부족해.');else set('목표 3 · 드릴 제작','작업대 가까이에서 제작 메뉴를 열어 드릴을 만들어.');return;}
 if(!built('conveyor')){if(items.conveyor){set('목표 4 · 컨베이어 배치','작업대 옆 빈 타일에 컨베이어를 놓아. R로 방향을 돌릴 수 있어.');return;}if(wood<4)set('목표 4 · 컨베이어 재료','나무를 채집해 롤러 컨베이어 재료를 모아.');else set('목표 4 · 컨베이어 제작','작업대 가까이에서 롤러 컨베이어를 제작해.');return;}
 if(!built('smelter')){if(items.smelter){set('목표 5 · 제련로 배치','드릴 근처 빈 타일에 제련로를 배치해.');return;}if(wood<6)set('목표 5 · 제련로 재료',treesLeft?'나무를 더 채집해 제련로 재료를 모아.':'목재가 부족해.');else set('목표 5 · 제련로 제작','드릴 가까이에서 제련로 설계도를 열어 제작해.');return;}
 set('제작 진행 완료','작업대와 세 설비를 배치했어. 다음 단계에서 실제 생산을 연결할 수 있어.');
}
function updateTrees(){updateResources();}
function updateCrafting(){
 if(!world)return;const container=$('recipes'),items=world.inventory.items||{},machines=world.machines||[];
 const workbench=machines.some(m=>m.type==='workbench');
 $('craftIntro').textContent=activeCraftStation==='t0'?'기본 조합대 · 전문 제작대를 만들어 월드에 설치하세요.':`${stationLabels[activeCraftStation]||'제작대'} · 이 제작대에서 만들 수 있는 항목만 표시합니다.`;
 container.replaceChildren();
 for(const recipe of recipeCards.filter(r=>activeCraftStation==='t0'?!r.station:r.station===activeCraftStation||(activeCraftStation==='farming_bench'&&r.station==='agriculture_bench'))){
  const card=document.createElement('div');card.className='recipe';const count=recipe.tool?(world.inventory.tools?.[recipe.id]||0):(items[recipe.id]||0);
  const stationTypes=recipe.station==='agriculture_bench'?['agriculture_bench','farming_bench']:[recipe.station];const requiredStation=recipe.station?machines.find(m=>stationTypes.includes(m.type)):null;
  const legacyT1Fallback=recipe.station==='t1_bench'&&world.worldVersion<2&&!requiredStation;
  const stationReady=!recipe.station||!!requiredStation||legacyT1Fallback;
  const stationNearby=!requiredStation||Math.hypot(requiredStation.x+.5-player.pos.x,requiredStation.y+.6-(player.pos.y+1),requiredStation.z+.5-player.pos.z)<=4.5;
  const already=recipe.id==='workbench'&&(workbench||count>0);
  const canAfford=Object.entries(recipe.cost).every(([r,n])=>(r==='wood'?(world.inventory.wood||0):world.inventory[r]||0)>=n);
  const head=document.createElement('div');head.className='recipeHead';const name=document.createElement('div');name.className='recipeName';name.textContent=recipe.name;const tag=document.createElement('span');tag.className='recipeTag';const stationName=stationLabels[recipe.station]||'제작대';tag.textContent=count?'제작품 ×'+count:already?'설치됨':!stationReady?stationName+' 필요':!stationNearby?stationName+' 가까이 가기':'설계도';head.append(name,tag);
  const desc=document.createElement('div');desc.className='recipeDesc';desc.textContent=recipe.description;
  const cost=document.createElement('div');cost.className='recipeCost';cost.textContent='필요 재료 · '+Object.entries(recipe.cost).map(([r,n])=>`${RESOURCE_LABELS[r]||r} ${n}`).join(' / ')+(recipe.id==='coal_block'&&COAL_BLOCK_RECIPE.provisional?` · ${COAL_BLOCK_RECIPE.inputQuantity}:1 비율은 임시 설정`:'' );
  const button=document.createElement('button');
  if(count&&recipe.tool){button.textContent='보유 중';button.disabled=true;}
  else if(recipe.output){button.textContent=!stationReady?'잠김':!stationNearby?stationName+'에 접근':canAfford?'제작하기':'재료 부족';button.disabled=!stationReady||!stationNearby||!canAfford;button.onclick=()=>void craftRecipe(recipe.id);}
  else if(count&&!recipe.tool&&!recipe.output){button.textContent='배치하기';button.disabled=false;button.onclick=()=>{placingMachine=recipe.id;machineRotation=0;setMode('machine');$('craftPanel').hidden=true;notice(recipe.name+' 배치 위치 선택 · 탭하여 놓기 · R 회전 · Esc 취소');};}
  else {button.textContent=already?'제작 완료':!stationReady?'잠김':!stationNearby?stationName+'에 접근':canAfford?'제작하기':'재료 부족';button.disabled=already||!stationReady||!stationNearby||!canAfford;button.onclick=()=>void craftRecipe(recipe.id);}
  if(!stationReady||!stationNearby)card.classList.add('locked');card.append(head,desc,cost,button);container.append(card);
 }
}
async function craftRecipe(recipe){
 try{const data=await api('/api/craft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipe,revision:world.revision})});world=data.world;inventory();updateCrafting();if(recipeCards.find(r=>r.id===recipe)?.tool){notice('도구 제작 완료 · 퀵슬롯에 추가됨');return;}if(recipeCards.find(r=>r.id===recipe)?.output){notice('석탄 블록 제작 완료');return;}placingMachine=recipe;machineRotation=0;setMode('machine');$('craftPanel').hidden=true;notice('제작 완료 · 설치할 타일을 탭해. R로 방향을 바꿀 수 있어.');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();}notice('제작 실패: '+e.message);}
}
async function placeMachineAt(sx,sy){
 if(!placingMachine||busy)return;const cell=targetBlock(sx,sy,'place');if(!cell){notice('섬 바닥의 가까운 타일을 선택해.');return;}
 updateMachinePreview(sx,sy);if(!previewValid){notice('초록색 설비 미리보기가 보이는 빈 바닥에 놓아.');return;}
 busy=true;try{const data=await api('/api/machine/place',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:placingMachine,...cell,rotation:machineRotation,revision:world.revision})});world=data.world;placingMachine=null;inventory();rebuildMachines();updateCrafting();setMode('place');notice('설비 배치 완료 · 서버에 저장됨');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();rebuildMachines();}notice('배치 실패: '+e.message);}finally{busy=false;}
}
function refreshCraftPanel(){const opening=$('craftPanel').hidden;activeCraftStation='t0';if(opening&&mode==='machine'){placingMachine=null;setMode('place');}updateCrafting();$('craftPanel').hidden=!opening;}
$('craftToggle').onclick=refreshCraftPanel;
async function interact(sx,sy){
 const cell=targetBlock(sx,sy,'place');
 if(!cell){notice('가까운 블록을 선택해줘.');return;}
 updateBlockPreview(sx,sy);if(!blockPlacementValid){notice(blockPlacementError(cell));return;}
 return interactCell(cell,'place');
}
function cropAt(sx,sy){const r=renderer.domElement.getBoundingClientRect();ndc.set(((sx-r.left)/r.width)*2-1,-((sy-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);let best=null;for(const group of cropGroups){if(!group.visible)continue;const hit=ray.intersectObject(group,true)[0];if(hit&&(!best||hit.distance<best.distance))best={crop:world.crops.find(c=>c.id===group.userData.resourceId),distance:hit.distance};}return best?.crop||null;}
async function interactFarm(sx,sy){
 const target=targetBlock(sx,sy,'mine');if(!target){notice('농지 또는 작물을 선택해.');return;}
 const crop=cropAt(sx,sy), tool=selectedTool;if(crop)Object.assign(target,{x:crop.x,y:crop.y,z:crop.z});else if(has(target.x,target.y,target.z)&&!has(target.x,target.y+1,target.z))target.y+=1;let action;
 const cropType=$('cropSelector').value,species=$('treeSelector').value,seedId=seedItemForCrop(cropType),saplingId=TREE_SAPLINGS[species];
 if(tool==='scythe'){const center=crop?{x:crop.x,y:crop.y,z:crop.z}:target;showHarvestRange(center);action='scythe';Object.assign(target,center);}
 else if(crop)action='harvest';
 else if(tool==='hoe'){const tilled=(world.tilled||[]).some(p=>p[0]===target.x&&p[1]===target.y&&p[2]===target.z),occupied=(world.crops||[]).some(c=>c.x===target.x&&c.y===target.y&&c.z===target.z);action=tilled&&!occupied&&(world.inventory[seedId]||0)>0?'plant':'till';}
 else if(tool==='watering_can'){const sources=world.waterSources||(world.worldVersion>=3?[{x:4,y:0,z:4}]:[]),atSource=sources.some(p=>p.x===target.x&&p.y===target.y&&p.z===target.z),uses=world.inventory.wateringCanUses??10;if(atSource&&uses<10)action='refill';else if(uses>0)action='water';else{notice('빈 물뿌리개는 파란 물통에서 채워.');return;}}else if(tool==='wood_axe'||tool==='sapling')action='plant_tree';
 if(!action){notice('괭이·물뿌리개·낫을 선택하거나 작물을 탭해.');return;}
 if(action==='plant_tree'&&!((world.inventory[saplingId]||0)>0||(species==='oak'&&(world.inventory.sapling||0)>(Object.values(TREE_SAPLINGS).reduce((n,id)=>n+(world.inventory[id]||0),0))))){notice('선택한 수종의 묘목이 없어.');return;}
 busy=true;try{const data=await api('/api/farm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...target,tool:action==='harvest'?'hand':tool,cropType,species,revision:world.revision})});world=data.world;inventory();rebuildResources();updateCrafting();const labels={harvest:'작물 수확 완료',scythe:'범위 작물 수확 완료',plant:`${RESOURCE_LABELS[seedId]} 파종 완료`,plant_tree:`${RESOURCE_LABELS[saplingId]} 식재 완료`};notice(labels[action]||'농사 작업 완료 · 서버 저장됨');}catch(e){if(e.world){world=e.world;inventory();rebuildResources();}notice('농사 작업 실패: '+e.message);}finally{busy=false;}
}
async function interactCell({x,y,z},action,tool=selectedTool){
 if(busy||!world)return;
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5){notice('가까운 블록만 편집할 수 있어.');return;}
 if(action==='place'&&Math.abs(center.x-player.pos.x)<.65&&Math.abs(center.z-player.pos.z)<.65&&center.y>=player.pos.y&&center.y<=player.pos.y+1.8){notice('플레이어 위치에는 설치할 수 없어.');return;}
 if(action==='place'){const reason=blockPlacementError({x,y,z});if(reason){blockPlacementValid=false;blockPreviewMark.visible=blockPreview.visible;notice(reason);return;}}
 if(action==='mine'&&!has(x,y,z))return;
 busy=true;
 try{const data=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:action,targetType:action==='mine'?'block':undefined,tool:action==='mine'?tool:undefined,item:action==='place'&&['dirt','sand','coal_block'].includes(selectedTool)?selectedTool:undefined,x,y,z,revision:world.revision})});
 world=data.world;inventory();rebuild();updateCrafting();notice(action==='place'?`${RESOURCE_LABELS[['dirt','sand','coal_block'].includes(selectedTool)?selectedTool:'dirt']} 블록 설치 완료 · 서버에 저장됨`:'흙 블록 회수 완료 · 서버에 저장됨');if(action==='place'&&lastBlockPreviewPoint)updateBlockPreview(lastBlockPreviewPoint.x,lastBlockPreviewPoint.y);
 }catch(e){if(e.world){world=e.world;inventory();rebuild();updateCrafting();if(action==='place'&&lastBlockPreviewPoint)updateBlockPreview(lastBlockPreviewPoint.x,lastBlockPreviewPoint.y);}notice('작업 실패: '+e.message);}finally{busy=false;}
}
function joystick(){
 const area=$('joystick'),knob=$('knob');let id=null;
 const update=e=>{const r=area.getBoundingClientRect();const rawX=(e.clientX-r.left-r.width/2)/(r.width*.34),rawY=(e.clientY-r.top-r.height/2)/(r.height*.34);const len=Math.hypot(rawX,rawY);const scale=len>1?1/len:1;const x=rawX*scale,y=rawY*scale;touchMove.set(x,y);knob.style.transform='translate('+(x*31)+'px,'+(y*31)+'px)';};
 area.addEventListener('pointerdown',e=>{id=e.pointerId;area.setPointerCapture(id);update(e);});
 area.addEventListener('pointermove',e=>{if(e.pointerId===id)update(e);});
 const stop=e=>{if(e.pointerId!==id)return;id=null;touchMove.set(0,0);knob.style.transform='translate(0,0)'};
 area.addEventListener('pointerup',stop);area.addEventListener('pointercancel',stop);
}joystick();
let lastFrameAt=performance.now();
function loop(now){requestAnimationFrame(loop);const rawFrameMs=Math.max(0,now-lastFrameAt),frameDt=Math.min(.05,rawFrameMs/1000);lastFrameAt=now;
 if(world?.worldGenVersion)terrainFrameAvgMs=terrainFrameAvgMs?terrainFrameAvgMs*.95+rawFrameMs*.05:rawFrameMs;
 const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD')||keys.has('ArrowUp')||keys.has('ArrowDown')||keys.has('ArrowLeft')||keys.has('ArrowRight')||touchMove.length()>.05;animateWalk(frameDt,moving);
 if(world){sendMovement(now);updateTerrainStreaming();pumpTerrainWork();pumpWaterWork();}
 farmerModel?.update(frameDt);updateInteractionUi();
 for(const machine of machineRoots)for(const rotor of machine.userData.rotors||[])rotor.rotation.x+=frameDt*2.6;
 for(const entry of dropRoots.values()){entry.root.position.lerp(entry.target,Math.min(1,frameDt*10));entry.root.rotation.y+=frameDt*(entry.conveyor?.45:.65);if(!entry.conveyor)entry.root.position.y=entry.target.y+.09+Math.sin(now*.0018+entry.phase)*.055;}
 if(machineRoots.some(m=>m.userData.machineType==='smelter'))machineMaterials.ember.emissiveIntensity=1.55+Math.sin(now*.006)*.28;
 updateMine(now);
 const target=player.pos.clone().add(new THREE.Vector3(0,PLAYER_HEIGHT_METERS*.54,0)).multiplyScalar(WORLD_SCALE);
 camera.position.set(target.x+camDistance*Math.sin(camYaw)*Math.cos(camPitch),target.y+camDistance*Math.sin(camPitch)+2.0,target.z+camDistance*Math.cos(camYaw)*Math.cos(camPitch));camera.lookAt(target);
 renderer.render(scene,camera);if(world?.worldGenVersion&&now-lastTerrainStatsAt>1000){lastTerrainStatsAt=now;const biome=biomeAt(world.worldSeed,Math.floor(player.pos.x),Math.floor(player.pos.z),world.worldGenVersion),waterMeshes=[...streamedWater.values()].filter(entry=>entry.mesh).length;$('stats').textContent=`${biome} · 청크 ${streamedTerrain.size}/${desiredTerrainChunks.size} · 물 메시 ${waterMeshes} · 반경 ${configuredChunkRadius()} · 청크 ${terrainBuildLastMs.toFixed(1)}/${(terrainBuildTotalMs/Math.max(1,terrainBuildCount)).toFixed(1)}ms 평균 · RAF 간격 ${terrainFrameAvgMs.toFixed(1)}ms EMA · GPU 지오메트리 ${renderer.info.memory.geometries} · draw ${renderer.info.render.calls}`;}
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
$('grid').onclick=()=>{gridVisible=!gridVisible;$('grid').classList.toggle('selected',gridVisible);$('grid').setAttribute('aria-pressed',String(gridVisible));if(outlines)outlines.visible=gridVisible;if(world?.worldGenVersion)setChunkOutlines(gridVisible);};
function applyDeveloperTeleport(next){
 if(!next?.player||!world?.devtoolsEnabled)return;
 devTeleportVersion++;const previousWorld=world;world=next;syncWaterEdits(previousWorld,next);
 player.pos.set(next.player.x,next.player.y,next.player.z);player.grounded=next.player.grounded===true;humanoid.position.copy(player.pos);
 setAuthoritativeWaterState(next.player);
 keys.clear();touchMove.set(0,0);$('knob').style.transform='translate(0,0)';jumpQueued=false;swimQueued=false;movementBusy=false;lastMovementAt=performance.now();
 $('loading').hidden=false;$('loading').textContent='새 좌표의 청크를 불러오는 중…';
 if(next.worldGenVersion){
  rebuild();
  if(streamedTerrain.has(terrainChunkKey(chunkCoord(player.pos.x),chunkCoord(player.pos.z))))$('loading').hidden=true;
 }else{$('loading').hidden=true;if(previousWorld.worldId!==next.worldId||previousWorld.worldInstanceId!==next.worldInstanceId)rebuild();}
 rebuildResources();updateInteractionUi();devTimePanel?.update(next);
}
async function init(){try{world=await api('/api/world');if(world.devtoolsEnabled===true){try{const devtools=await import('/devtools/time-control.js');devTimePanel=devtools.mountDevPanel(world);window.addEventListener('terra-dev-teleport',event=>applyDeveloperTeleport(event.detail));}catch(error){console.warn('Optional developer panel unavailable:',error);}}if(world.player){player.pos.set(world.player.x,world.player.y,world.player.z);player.grounded=world.player.grounded;humanoid.position.copy(player.pos);setAuthoritativeWaterState(world.player);}selectedSlot=Number.isInteger(world.inventory.selectedSlot)?world.inventory.selectedSlot:1;selectedTool=world.inventory.quickSlots[selectedSlot]||world.inventory.quickSlots.find(Boolean)||'wood_axe';equipHeldTool(selectedTool);rebuild();rebuildMachines();rebuildResources();inventory();updateCrafting();updateInteractionUi();if(!world.worldGenVersion||streamedTerrain.has(terrainChunkKey(chunkCoord(player.pos.x),chunkCoord(player.pos.z))))$('loading').hidden=true;notice(world.worldKind==='shopHub'?'농부에게 다가가 E 또는 상호작용 버튼을 눌러.':'밀·나무·돌을 도구로 수확하고 T1 제작대를 사용해봐.');}catch(e){$('loading').textContent='서버 연결 실패: '+e.message+' · node server.mjs로 실행해야 해.';}}
requestAnimationFrame(loop);init();
setInterval(()=>{if(!world||busy)return;const teleportVersion=devTeleportVersion;void api('/api/world').then(next=>{if(teleportVersion!==devTeleportVersion)return;const previous=world,changed=(next.crops||[]).some((c,i)=>c.stage!==world.crops?.[i]?.stage)||(next.trees||[]).some((t,i)=>t.stage!==world.trees?.[i]?.stage)||JSON.stringify(next.watered)!==JSON.stringify(world.watered);world=next;syncWaterEdits(previous,next);setAuthoritativeWaterState(next.player);devTimePanel?.update(next);syncWorldDrops();updateInteractionUi();if(changed){rebuildResources();inventory();}}).catch(()=>{});},500);
