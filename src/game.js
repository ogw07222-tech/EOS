import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { createFarmerNpc } from './farmer-npc.js';
import { isFarmTileWatered } from './farming-rules.mjs';
import {CHUNK_SIZE,DEFAULT_CHUNK_RADIUS,MIN_CHUNK_RADIUS,MAX_CHUNK_RADIUS,WORLD_MIN_Y,WORLD_MAX_Y,blockAt,generateChunkColumns,chunkCoord,localCoord,planChunkWindow,isChunkJobCurrent,biomeAt,heightAt,generatedWaterLevel,waterLevelAt} from './chunk-world.mjs';
import {generateTreesForChunk} from './tree-world.mjs';
import {cropTypeOf,seedItemForCrop,productItemForCrop} from './crop-rules.mjs';
import {RESOURCE_LABELS,RESOURCE_KEYS,TOOL_NAMES,TREE_LOGS,TREE_SAPLINGS,CROP_TYPES,CROP_SEEDS} from './resource-catalog.mjs';
import { COAL_BLOCK_RECIPE } from './recipe-settings.mjs';
import { createNatureMaterials, createTreeVisual, createCropVisual } from './nature-visuals.js';
import { createTerrainAtlas } from './terrain-atlas.js';
import { buildGreedyChunkMesh, createGreedyChunkGeometry, installGreedyAtlasShader } from './greedy-chunk-mesh.js';
import { createWorkstationVisuals } from './workstation-visuals.js';
import { createIndustrialVisuals } from './industrial-visuals.js';
const $=id=>document.getElementById(id);
const terraDebug=new URLSearchParams(location.search).get('terraDebug')==='1';
if(terraDebug)document.body.classList.add('debug-mode');
const terraDebugFps=terraDebug&&['30','60'].includes(new URLSearchParams(location.search).get('terraFps'))?Number(new URLSearchParams(location.search).get('terraFps')):0;
const touchHardware=(navigator.maxTouchPoints||0)>0;
const SIZE=10;
const surfaceHeightAt=(x,z)=>heightAt(world.worldSeed,x,z,world.worldGenVersion);
// Simulation units are metres: one voxel grid cell measures 1 m on each axis.
// WORLD_SCALE is a renderer-only conversion; both blocks and the avatar share it.
const BLOCK_METERS=1;
const PLAYER_HEIGHT_METERS=1.78;
const PLAYER_HALF_WIDTH_METERS=0.34;
const WORLD_SCALE=3.75;
let world,meshes=[],terrain=null,gridVisible=false,busy=false,placingMachine=null,machineRotation=0,selectedSlot=1,selectedTool='wood_axe',camYaw=.78,camPitch=.55,camDistance=9.5;
let devTimePanel=null,devTeleportVersion=0,hubRoots=[],farmerModel=null,nearInteraction=null,interactionBusy=false,shopRevision=0,shopQuantity='1',activeCraftStation='t0';
const scene=new THREE.Scene();scene.background=new THREE.Color('#94c5e7');scene.fog=new THREE.Fog('#94c5e7',90,240);
const hubStars=new Float32Array(2200*3);let starSeed=0x7e22a;
for(let i=0;i<hubStars.length;i+=3){starSeed=(Math.imul(starSeed,1664525)+1013904223)>>>0;const u=starSeed/4294967296;starSeed=(Math.imul(starSeed,1664525)+1013904223)>>>0;const v=starSeed/4294967296,theta=u*Math.PI*2,cosPhi=2*v-1,sinPhi=Math.sqrt(1-cosPhi*cosPhi),radius=430;hubStars[i]=radius*sinPhi*Math.cos(theta);hubStars[i+1]=radius*cosPhi;hubStars[i+2]=radius*sinPhi*Math.sin(theta);}
const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(hubStars,3));const starfield=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xa6d7e4,size:1.15,sizeAttenuation:false,transparent:true,opacity:.82,depthWrite:false,fog:false}));starfield.visible=false;scene.add(starfield);
const worldRoot=new THREE.Group();worldRoot.scale.setScalar(WORLD_SCALE);scene.add(worldRoot);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.12,260);
const cameraTarget=new THREE.Vector3();
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
// Keep high-density Android screens sharp without rendering four device pixels per CSS pixel.
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=!touchHardware;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf4fbff,0x536477,2.2));
const light=new THREE.DirectionalLight(0xffeed2,2.5);light.position.set(-22,40,20);light.castShadow=!touchHardware;
light.shadow.mapSize.set(touchHardware?512:1024,touchHardware?512:1024);light.shadow.camera.left=-70;light.shadow.camera.right=70;light.shadow.camera.top=70;light.shadow.camera.bottom=-70;scene.add(light);
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
const terrainAtlas=createTerrainAtlas(THREE);
const grassMat=new THREE.MeshLambertMaterial({map:terrainAtlas.texture,vertexColors:true,side:THREE.FrontSide});
installGreedyAtlasShader(grassMat);
const legacyTerrainMat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.FrontSide});
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
const waterMaterial=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.82,depthWrite:false,side:THREE.DoubleSide});
const waterShaderClock={time:0};
waterMaterial.onBeforeCompile=shader=>{
 shader.uniforms.terraWaterTime=waterShaderClock;
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float terraWaterTime;');
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfloat terraWaterTop=step(0.78,normal.y);\nfloat terraWaterWave=sin(position.x*0.73+terraWaterTime*1.1)*cos(position.z*0.61-terraWaterTime*0.82);\ntransformed.y += terraWaterTop*terraWaterWave*0.035;');
};
waterMaterial.customProgramCacheKey=()=> 'terra-water-wave-v1';
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
function clearStreamedTerrain(){
 terrainGeneration++;terrainWorkQueue=[];queuedTerrainChunks.clear();for(const entry of streamedTerrain.values())disposeTerrainChunk(entry);streamedTerrain.clear();desiredTerrainChunks.clear();dirtyTerrainChunks.clear();terrainEditedChunks.clear();chunkWorldActive=false;activeChunkWorldKey='';terrainRequestSignature='';
 waterGeneration++;waterWorkQueue=[];for(const entry of streamedWater.values())disposeWaterChunk(entry);streamedWater.clear();desiredWaterChunks.clear();dirtyWaterChunks.clear();waterWorldKey='';waterEditSnapshot=new Map();waterEditWindowKey='';indexedFluidCells=null;fluidCellsByChunk=new Map();
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
const waterTintCache=new Map();
function waterTintAt(x,z,side){const key=`${world.worldSeed}:${x},${z}`;let tint=waterTintCache.get(key);if(!tint){if(waterTintCache.size>4096)waterTintCache.clear();const biome=biomeAt(world.worldSeed,x,z,world.worldGenVersion),base=biome==='river'?0x4e9cac:biome==='beach'?0x579cac:0x347f9b,jitter=(hash(x,0,z)%5-2)*.0125,color=new THREE.Color(base);color.offsetHSL(0,jitter*.3,jitter);tint=[color.r,color.g,color.b];waterTintCache.set(key,tint);}return side?[tint[0]*.76,tint[1]*.78,tint[2]*.8]:tint;}
function waterQuad(arrays,a,b,c,d){const start=arrays.positions.length/3,points=[a,b,c,d],x=Math.floor(points.reduce((sum,p)=>sum+p[0],0)/4),z=Math.floor(points.reduce((sum,p)=>sum+p[2],0)/4),ys=points.map(p=>p[1]),side=Math.max(...ys)-Math.min(...ys)>.01,tint=waterTintAt(x,z,side);for(const point of points){arrays.positions.push(point[0],point[1],point[2]);arrays.colors.push(...tint);}arrays.indices.push(start,start+1,start+2,start,start+2,start+3);}
function buildWaterGeometry(cx,cz){
 const arrays={positions:[],colors:[],indices:[]},source=waterWorld(),edits=source?.fluidEdits||{},chunkEdits=indexedWaterEdits().get(terrainChunkKey(cx,cz))||[],x0=cx*CHUNK_SIZE,z0=cz*CHUNK_SIZE,sea=Number.isInteger(world?.seaLevel)?world.seaLevel:0;
 const levelAt=(x,y,z)=>waterLevelAt(source,x,y,z)||0;
 // The static ocean/river body is compactly reconstructed from the shared seed.
 // Only one surface sample per X/Z column is needed for the stable sea plane.
 if(world?.worldGenVersion>=2)for(let z=z0;z<z0+CHUNK_SIZE;z++)for(let x=x0;x<x0+CHUNK_SIZE;x++){
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
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(arrays.positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(arrays.colors,3));geometry.setIndex(arrays.indices);geometry.computeVertexNormals();return geometry;
}
function installWaterChunk(cx,cz,generation){
 const key=terrainChunkKey(cx,cz);if(generation!==waterGeneration||!desiredWaterChunks.has(key))return;
 const geometry=buildWaterGeometry(cx,cz);if(generation!==waterGeneration||!desiredWaterChunks.has(key)){geometry.dispose();return;}
 const previous=streamedWater.get(key);if(geometry.getAttribute('position').count===0){geometry.dispose();if(previous)disposeWaterChunk(previous);streamedWater.set(key,{cx,cz,key,mesh:null});dirtyWaterChunks.delete(key);return;}
 const mesh=new THREE.Mesh(geometry,waterMaterial);mesh.renderOrder=2;mesh.castShadow=false;mesh.receiveShadow=false;
 if(previous)disposeWaterChunk(previous);streamedWater.set(key,{cx,cz,key,mesh});worldRoot.add(mesh);dirtyWaterChunks.delete(key);
}
function pumpWaterWork(){const start=performance.now();while(waterWorkQueue.length&&performance.now()-start<1.8){const job=waterWorkQueue.shift(),key=terrainChunkKey(job.cx,job.cz);if(job.generation!==waterGeneration||!desiredWaterChunks.has(key))continue;try{installWaterChunk(job.cx,job.cz,job.generation);}catch(error){console.error('Water mesh build failed:',key,error);}}}
function configuredChunkRadius(){let requested=(navigator.maxTouchPoints||0)>0?MIN_CHUNK_RADIUS:DEFAULT_CHUNK_RADIUS;try{const value=Number(localStorage.getItem('terra.chunkRadius'));if(Number.isFinite(value)&&value>0)requested=value;}catch{}return Math.max(MIN_CHUNK_RADIUS,Math.min(MAX_CHUNK_RADIUS,Math.trunc(requested)));}
function disposeTerrainChunk(entry){worldRoot.remove(entry.root);entry.root.traverse(object=>{if(object.geometry)object.geometry.dispose();});}
const terrainTintCache=new Map(),terrainTintHex={plains:'#c9dbb8',forest:'#bed5c0',beach:'#e0cfad',side:'#b79878',dirt:'#ba9676',stone:'#b9c2bd',sand:'#ddc696',ore:'#d0bc9c'};
function chunkTint(block,topFace,x,y,z,faceNumber){const cacheKey=`${world.worldSeed}:${world.worldGenVersion}`,biome=biomeAt(world.worldSeed,x,z,world.worldGenVersion);let sets=terrainTintCache.get(cacheKey);if(!sets){sets={};terrainTintCache.set(cacheKey,sets);}let set=sets[biome];if(!set){const grass=biome==='forest'?'forest':biome==='beach'?'beach':'plains';set={grass:[new THREE.Color(terrainTintHex[grass]),new THREE.Color(terrainTintHex.side)],dirt:[new THREE.Color(terrainTintHex.dirt)],sand:[new THREE.Color(terrainTintHex.sand)],ore:[new THREE.Color(terrainTintHex.ore)],stone:[new THREE.Color(terrainTintHex.stone)]};for(const values of Object.values(set)){const base=values[0];values[1]??=base.clone();values[2]=values[0].clone().multiplyScalar(.88);values[3]=values[0].clone().multiplyScalar(.68);}sets[biome]=set;}const kind=block==='grass'?'grass':block==='dirt'?'dirt':block==='sand'?'sand':['iron_ore','coal_ore','copper_ore'].includes(block)?'ore':'stone';return set[kind][faceNumber===0?0:faceNumber===1?3:kind==='grass'?1:2];}
function rebuildTerrainEditIndex(){terrainEditedChunks.clear();for(const key of terrainEditSnapshot.keys()){const [x,,z]=key.split(',').map(Number);if(Number.isInteger(x)&&Number.isInteger(z))terrainEditedChunks.add(terrainChunkKey(chunkCoord(x),chunkCoord(z)));}}
function hasNearbyTerrainEdits(cx,cz){for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(terrainEditedChunks.has(terrainChunkKey(cx+dx,cz+dz)))return true;return false;}
function greedyChunkGeometry(getBlock,cx,cz,upper){
 const min=[cx*CHUNK_SIZE,WORLD_MIN_Y,cz*CHUNK_SIZE],size=[CHUNK_SIZE,Math.max(1,upper-WORLD_MIN_Y),CHUNK_SIZE];
 // Greedy meshing asks for the same voxel from several face directions.
 // Resolve each world cell once per chunk instead of repeating terrain/noise
 // and edit lookups for every adjacent face test.
 const rawGetBlock=getBlock,startX=min[0]-1,startZ=min[2]-1,startY=WORLD_MIN_Y-1,width=CHUNK_SIZE+2,height=size[1]+2,blockCache=new Array(width*height*width);
 getBlock=(x,y,z)=>{
  const ix=x-startX,iy=y-startY,iz=z-startZ;
  if(ix<0||ix>=width||iy<0||iy>=height||iz<0||iz>=width)return rawGetBlock(x,y,z);
  const index=(iy*width+iz)*width+ix,cached=blockCache[index];
  if(cached!==undefined)return cached;
  return blockCache[index]=rawGetBlock(x,y,z);
 };
 const meshData=buildGreedyChunkMesh({getBlock,min,size});
 const colorsOut=new Float32Array(meshData.positions.length);
 for(const face of meshData.faces){const tint=chunkTint(face.block,face.faceIndex===0,face.min[0],face.min[1],face.min[2],face.faceIndex);const vertex=face.indexStart/6*4;for(let corner=0;corner<4;corner++){const offset=(vertex+corner)*3;colorsOut[offset]=tint.r;colorsOut[offset+1]=tint.g;colorsOut[offset+2]=tint.b;}}
 meshData.colors=colorsOut;return createGreedyChunkGeometry(THREE,meshData);
}
function makeHeightfieldChunk(cx,cz,columnMap){
 const startX=cx*CHUNK_SIZE,startZ=cz*CHUNK_SIZE;let top=WORLD_MIN_Y;
 for(const column of columnMap.values())top=Math.max(top,column.surfaceY);
 const getBlock=(x,y,z)=>{
  if(y<WORLD_MIN_Y)return 'stone';if(y>WORLD_MAX_Y)return null;
  const column=columnMap.get(`${x},${z}`);if(!column)return blockAt(world,x,y,z);
  if(y>=column.surfaceY)return null;
  const depth=column.surfaceY-1-y;if(depth===0)return blockAt(world,x,y,z);if(depth<=3)return 'dirt';return blockAt(world,x,y,z);
 };
 return greedyChunkGeometry(getBlock,cx,cz,Math.min(WORLD_MAX_Y+1,top+1));
}
function makeChunkTerrain(cx,cz){
 const startX=cx*CHUNK_SIZE,startZ=cz*CHUNK_SIZE,columns=[];let top=WORLD_MIN_Y;
 for(let z=startZ-1;z<=startZ+CHUNK_SIZE;z++)for(let x=startX-1;x<=startX+CHUNK_SIZE;x++){const surfaceY=surfaceHeightAt(x,z);columns.push({x,z,surfaceY});top=Math.max(top,surfaceY);}
 const columnMap=new Map(columns.map(column=>[`${column.x},${column.z}`,column]));
 if(!hasNearbyTerrainEdits(cx,cz))return makeHeightfieldChunk(cx,cz,columnMap);
 for(const key of Object.keys(world.edits||{})){const [x,y,z]=key.split(',').map(Number),editCx=chunkCoord(x),editCz=chunkCoord(z);if(Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&Math.abs(editCx-cx)<=1&&Math.abs(editCz-cz)<=1)top=Math.max(top,y+1);}
 const upper=Math.min(WORLD_MAX_Y+1,top+1),getBlock=(x,y,z)=>y<WORLD_MIN_Y?'stone':y>WORLD_MAX_Y?null:blockAt(world,x,y,z);
 return greedyChunkGeometry(getBlock,cx,cz,upper);
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
 if(world?.worldKind==='shopHub'){if(chunkWorldActive)clearStreamedTerrain();if(terrain){worldRoot.remove(terrain);terrain.geometry.dispose();terrain=null;}if(outlines){worldRoot.remove(outlines);outlines.geometry.dispose();outlines=null;}rebuildHubObjects();$('stats').textContent='우주정거장 · 공용 허브';return;}
 if(world?.worldGenVersion){if(world.worldGenVersion>=2)$('stats').textContent='오픈월드 · 주변 지형 준비 중…';if(terrain){worldRoot.remove(terrain);terrain.geometry.dispose();terrain=null;}if(outlines){worldRoot.remove(outlines);outlines.geometry.dispose();outlines=null;}rebuildStreamedTerrain();rebuildHubObjects();return;}
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
 terrain=new THREE.Mesh(g,legacyTerrainMat);terrain.castShadow=true;terrain.receiveShadow=true;worldRoot.add(terrain);
 const edge= new THREE.EdgesGeometry(g,19);outlines=new THREE.LineSegments(edge,edgesMat);outlines.visible=gridVisible;worldRoot.add(outlines);
 $('stats').textContent=world.islandSize+'×'+world.islandSize+' 섬 · 블록 '+count.toLocaleString();
 if(world.worldKind==='shopHub')$('stats').textContent='우주정거장 · 공용 허브';
 rebuildHubObjects();
}
// Low-poly tree and crop parts are shared across generated entities.
const treeTrunk=new THREE.MeshLambertMaterial({color:0x74533a}),birchTrunk=new THREE.MeshLambertMaterial({color:0xd9d0ae}),rubberTrunk=new THREE.MeshLambertMaterial({color:0x533d32});
const treeCanopy=new THREE.MeshLambertMaterial({color:0x488469}),treeTop=new THREE.MeshLambertMaterial({color:0x66a17a}),birchCanopy=new THREE.MeshLambertMaterial({color:0x78a858}),rubberCanopy=new THREE.MeshLambertMaterial({color:0x315e4c});
const veinRock=new THREE.MeshStandardMaterial({color:0x606c72,roughness:.95}),veinRockLight=new THREE.MeshStandardMaterial({color:0x879196,roughness:.9}),veinCrystal=new THREE.MeshStandardMaterial({color:0x69b5cf,emissive:0x14566c,emissiveIntensity:.48,roughness:.4});
let treeGroups=[],cropGroups=[],oreGroups=[],resourceRoots=[];
let interactionRefreshAt=0,worldPollInFlight=false;
const natureMaterials=createNatureMaterials(THREE);
function makeTree(tree){const group=createTreeVisual(THREE,tree,natureMaterials);treeGroups.push(group);worldRoot.add(group);resourceRoots.push(group);}
function makeCrop(crop){const group=createCropVisual(THREE,crop,natureMaterials);worldRoot.add(group);resourceRoots.push(group);cropGroups.push(group);}
let farmMesh=null;const farmMaterial=new THREE.MeshLambertMaterial({map:terrainAtlas.texture,vertexColors:true,side:THREE.DoubleSide});
function rebuildFarmVisuals(){
 if(farmMesh){worldRoot.remove(farmMesh);farmMesh.geometry.dispose();farmMesh=null;}
 const positions=[],normals=[],colorsOut=[],uvs=[],indices=[];
 for(const [x,y,z] of world.tilled||[]){
  const wet=isFarmTileWatered(world.watered?.[[x,y,z].join(',')]),base=positions.length/3,tint=new THREE.Color(wet?'#a18e6a':'#e4cfaa'),variation=terrainAtlas.variation(wet?'wet_farmland':'farmland',0,x,y,z);
  const corners=[[x+.045,y+.055,z+.045],[x+.955,y+.055,z+.045],[x+.955,y+.055,z+.955],[x+.045,y+.055,z+.955]];
  for(const [i,p] of corners.entries()){positions.push(...p);normals.push(0,1,0);colorsOut.push(tint.r,tint.g,tint.b);const [u,v]=terrainAtlas.uv('farmland_top',[0,1,1,0][i],[0,0,1,1][i],variation);uvs.push(u,v);}
  indices.push(base,base+1,base+2,base,base+2,base+3);
 }
 if(!positions.length)return;
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colorsOut,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);farmMesh=new THREE.Mesh(geometry,farmMaterial);farmMesh.receiveShadow=true;worldRoot.add(farmMesh);
}
function makeOreNode(node){
 const g=new THREE.Group();g.position.set(node.x+.5,node.y,node.z+.5);g.userData.resourceId=node.id;worldRoot.add(g);resourceRoots.push(g);oreGroups.push(g);
 const stones=[[-.20,.31,0,.42,.58,.42], [.18,.25,.15,.40,.48,.38], [.03,.23,-.22,.46,.43,.37],[-.01,.48,.06,.38,.35,.39]];
 for(let i=0;i<stones.length;i++){const [x,y,z,sx,sy,sz]=stones[i];const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(.5,0),i%2?veinRockLight:veinRock);rock.scale.set(sx*1.45,sy*1.45,sz*1.45);rock.position.set(x,y,z);rock.rotation.set(i*.31,i*.67,i*.19);rock.castShadow=true;rock.receiveShadow=true;g.add(rock);}
 for(const [x,y,z,w,h] of [[-.18,.38,.335,.16,.29],[.08,.26,.318,.13,.22],[.23,.40,.12,.1,.18]]){const crystal=new THREE.Mesh(new THREE.CylinderGeometry(w*.18,w*.52,h,5),veinCrystal);crystal.position.set(x,y,z);crystal.rotation.z=-.28;crystal.castShadow=true;g.add(crystal);}
 g.userData.crystals=g.children.filter(o=>o.material===veinCrystal);updateOreVisual(g,node);
}
function makeWaterSource(source){
 const g=new THREE.Group();g.position.set(source.x+.5,source.y,source.z+.5);g.userData.waterSource=true;worldRoot.add(g);resourceRoots.push(g);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(.34,.065,4,8),veinRockLight);
 rim.rotation.x=Math.PI/2;rim.position.y=.20;g.add(rim);
 const well=new THREE.Mesh(new THREE.CylinderGeometry(.38,.43,.19,8),veinRock);
 well.position.y=.095;g.add(well);
 const water=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.03,8),itemMats.crystal);
 water.position.y=.19;g.add(water);
}
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

// Facility appearance is isolated from placement and world-state rules.
const machineMaterials={dark:new THREE.MeshStandardMaterial({color:0x263944,metalness:.42,roughness:.58})};
const workstationVisuals=createWorkstationVisuals(THREE),industrialVisuals=createIndustrialVisuals(THREE);
let machineRoots=[];const dropRoots=new Map();
function makeMachineModel(type,options={}){
 return ['drill','conveyor','smelter'].includes(type)?industrialVisuals.create(type,options):workstationVisuals.create(type,options);
}
function disposeMachineVisual(root){
 if(!root)return;
 if(root.userData.terraIndustrialModel)industrialVisuals.dispose(root);
 else workstationVisuals.dispose(root);
}
function buildMachineMesh(machine){
 const [dx,dz]=[[1,0],[0,1],[-1,0],[0,-1]][machine.rotation]||[1,0];
 const uphill=machine.type==='conveyor'&&(world.machines||[]).some(m=>m.type==='conveyor'&&m.x===machine.x+dx&&m.y===machine.y+1&&m.z===machine.z+dz);
 const root=makeMachineModel(machine.type,{uphill});
 root.userData.machine=machine;root.userData.machineType=machine.type;root.userData.machineId=machine.id;root.userData.machineRotation=machine.rotation;
 root.position.set(machine.x+.5,machine.y+(root.userData.floorOffset||0),machine.z+.5);root.rotation.y=machine.rotation*Math.PI/2;worldRoot.add(root);return root;
}
function machineOperating(machine){
 if(machine.type==='drill')return (world?.oreNodes||[]).some(node=>node.remaining>0&&Math.hypot(node.x-machine.x,node.y-machine.y,node.z-machine.z)<=5);
 if(machine.type==='conveyor')return (world?.drops||[]).some(drop=>drop.conveyorId===machine.id);
 // There is no smelting simulation/state yet, so the furnace stays visibly idle.
 return false;
}
function updateMachineVisuals(frameDt){
 for(const root of machineRoots){
  const active=root.userData.operating===true,wasActive=active;
  if(active)for(const rotor of root.userData.rotors||[])rotor.rotation.y+=frameDt*2.6;
  for(const belt of root.userData.belts||[])if(active)for(const roller of belt.rollers||[])roller.rotation.z+=frameDt*(belt.speed||1.8);
 }
}
function refreshMachineOperating(){for(const root of machineRoots)root.userData.operating=machineOperating(root.userData.machine);}
function syncWorldDrops(){
 const live=new Set((world?.drops||[]).map(d=>d.id));
 for(const [id,entry]of dropRoots)if(!live.has(id)){worldRoot.remove(entry.root);entry.root.traverse(o=>{if(o.geometry&&!o.geometry.userData?.terraIndustrialShared&&!o.geometry.userData?.terraWorkstationShared)o.geometry.dispose();});dropRoots.delete(id);}
 for(const drop of world?.drops||[]){let entry=dropRoots.get(drop.id);if(!entry){const root=makeItemModel(drop.item);root.scale.setScalar(.82);root.userData.dropId=drop.id;worldRoot.add(root);entry={root,target:new THREE.Vector3(),phase:(drop.id.charCodeAt(0)||0)*.17};dropRoots.set(drop.id,entry);}entry.target.set(drop.x,drop.y,drop.z);entry.conveyor=!!drop.conveyorId;entry.quantity=drop.quantity;}
}
let machinePreview=null,previewValid=false;
function clearMachinePreview(){if(!machinePreview)return;const root=machinePreview;machinePreview=null;if(root.userData.terraIndustrialModel){root.traverse(o=>{if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])if(!m.userData?.terraIndustrialShared&&!m.userData?.terraWorkstationShared)m.dispose();}});industrialVisuals.dispose(root);}else workstationVisuals.dispose(root);}
function createMachinePreview(type){clearMachinePreview();machinePreview=makeMachineModel(type);machinePreview.traverse(o=>{if(!o.material)return;const clone=m=>{const copy=m.clone();copy.userData={...copy.userData};delete copy.userData.terraIndustrialShared;delete copy.userData.terraWorkstationShared;return copy;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.58;m.depthWrite=false;}});machinePreview.visible=false;worldRoot.add(machinePreview);}
function updateMachinePreview(sx,sy){
 if(!placingMachine||!machinePreview)return;const cell=targetBlock(sx,sy,'place');
 if(!cell){machinePreview.visible=false;return;}
 const {x,y,z}=cell,centerX=x+.5,centerY=y+.5,centerZ=z+.5;
 const portal=world.personalPortal,portalReserved=!!portal&&Math.abs(x-portal.x)<=4&&Math.abs(z-portal.z)<=5&&y>=portal.y&&y<=portal.y+4;
 const inWorldBounds=world?.worldGenVersion?x>=-4096&&x<4096&&z>=-4096&&z<4096&&y>=WORLD_MIN_Y&&y<=WORLD_MAX_Y:x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16;
 previewValid=inWorldBounds&&!portalReserved&&(world.inventory.items?.[placingMachine]||0)>0&&!has(x,y,z)&&has(x,y-1,z)&&!(world.machines||[]).some(m=>m.x===x&&m.y===y&&m.z===z)&&!(Math.abs(centerX-player.pos.x)<.65&&Math.abs(centerZ-player.pos.z)<.65&&centerY>=player.pos.y&&centerY<=player.pos.y+1.8);
 machinePreview.visible=true;machinePreview.position.set(x+.5,y+(machinePreview.userData.floorOffset||0),z+.5);machinePreview.rotation.y=machineRotation*Math.PI/2;
 $('placementHint').textContent=(previewValid?'✓ 배치 가능':'⊘ 배치 불가')+' · 방향 '+['북','동','남','서'][machineRotation]+' · R 회전 · Esc 취소';
 machinePreview.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.color.set(previewValid?0x77d6ac:0xe68070);m.emissive.set(previewValid?0x184c36:0x60251d);}});
}
function rebuildMachines(){
 for(const root of machineRoots)disposeMachineVisual(root);
 machineRoots=(world?.machines||[]).map(buildMachineMesh);
}
function clearHubRoots(){for(const root of hubRoots){worldRoot.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}hubRoots=[];farmerModel=null;}
function hubBox(parent,w,h,d,color,x,y,z,glow=0){const mat=new THREE.MeshStandardMaterial({color,roughness:.9,emissive:glow,emissiveIntensity:glow?0.65:0});const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function portalModel(data){const root=new THREE.Group();root.position.set(data.x+.5,data.y,data.z+.5);root.rotation.y=data.rotation||0;root.userData.portal=data;worldRoot.add(root);hubRoots.push(root);
 hubBox(root,2.5,.16,1.6,0x263c49,0,.08,0);hubBox(root,2.15,.08,1.3,0x79aeb4,0,.18,0,0x237e91);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(1.08,.135,5,8),new THREE.MeshStandardMaterial({color:0x8ae3df,metalness:.45,roughness:.28,emissive:0x14758a,emissiveIntensity:1.2}));ring.position.set(0,1.35,-.1);ring.castShadow=true;root.add(ring);
 const veil=new THREE.Mesh(new THREE.CircleGeometry(.98,8),new THREE.MeshBasicMaterial({color:0x40b9cf,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false}));veil.position.set(0,1.35,-.12);root.add(veil);
 for(const side of [-1,1]){const jaw=hubBox(root,.22,1.65,.38,0xcc8651,side*1.09,1.02,-.12);jaw.rotation.z=-side*.15;}return root;}
function starshipPortalModel(data){
 const root=new THREE.Group();root.position.set(data.x+.5,data.y,data.z+.5);const east=surfaceHeightAt(data.x+4,data.z),west=surfaceHeightAt(data.x-4,data.z),north=surfaceHeightAt(data.x,data.z-5),south=surfaceHeightAt(data.x,data.z+5);root.rotation.order='YXZ';root.rotation.set(-Math.atan2(south-north,10),data.rotation||0,Math.atan2(east-west,8),'YXZ');root.userData.portal=data;worldRoot.add(root);hubRoots.push(root);
 const metal=new THREE.MeshStandardMaterial({color:0xc0d0cf,metalness:.58,roughness:.34}),dark=new THREE.MeshStandardMaterial({color:0x263a48,metalness:.46,roughness:.42}),gold=new THREE.MeshStandardMaterial({color:0xd4b66d,metalness:.5,roughness:.32}),glass=new THREE.MeshStandardMaterial({color:0x55c6d2,metalness:.2,roughness:.18,emissive:0x126878,emissiveIntensity:.8}),engine=new THREE.MeshBasicMaterial({color:0x70e7f2});
 // Loft octagonal sections along the flight axis for a faceted pressure hull.
 function hull(x, sections, material){
  const corners=[[-.62,1],[.62,1],[1,.68],[1,.24],[.62,0],[-.62,0],[-1,.24],[-1,.68]];
  const rings=sections.map(([z,w,lo,hi])=>corners.map(([u,v])=>[x+w*u,lo+(hi-lo)*v,z]));
  const vertices=[];
  for(let j=1;j<rings.length;j++)for(let i=0;i<8;i++){
   const n=(i+1)%8,a=rings[j-1],b=rings[j];
   vertices.push(...a[i],...b[n],...a[n],...a[i],...b[i],...b[n]);
  }
  for(let i=1;i<7;i++){const first=rings[0],last=rings.at(-1);vertices.push(...first[0],...first[i],...first[i+1],...last[0],...last[i+1],...last[i]);}
  // Cross-section traces clockwise looking down the flight axis.
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();
  const part=new THREE.Mesh(geometry,material);part.castShadow=part.receiveShadow=true;root.add(part);
 }
 hull(0,[[-4.15,.07,.51,.61],[-3.15,.55,.32,.92],[-1.45,.98,.25,1.22],[1.60,1.04,.28,1.22],[3.05,.65,.38,.91]],metal);
 hull(0,[[-2.95,.10,.80,.97],[-1.96,.50,.93,1.57],[-1.11,.56,1.05,1.68],[-.62,.40,1.11,1.31]],glass);
 for(const side of [-1,1]){
  const wing=new THREE.Shape();
  wing.moveTo(.70,-1.73);wing.lineTo(3.50,1.46);wing.lineTo(3.38,2.43);wing.lineTo(1.78,1.94);wing.lineTo(.82,2.58);wing.closePath();
  const foil=new THREE.Mesh(new THREE.ExtrudeGeometry(wing,{depth:.11,bevelEnabled:true,bevelSize:.045,bevelThickness:.035,bevelSegments:1}),metal);
  foil.rotation.x=Math.PI/2;foil.scale.x=side;foil.position.y=.70;foil.castShadow=true;root.add(foil);
  const x=side*1.53;
  hull(x,[[-1.24,.15,.54,.72],[-.62,.34,.36,.96],[2.71,.43,.33,1.04],[3.14,.38,.39,.98]],dark);
  hull(x,[[.21,.36,.35,.99],[.45,.37,.35,1.0]],gold);
  hull(x,[[3.15,.30,.48,.90],[3.19,.25,.52,.87]],engine);
  const fin=hubBox(root,.13,1.07,.72,0xd07b43,x,1.32,2.46);
  fin.rotation.set(.34,0,-side*.35);
 }
 const portalRing=new THREE.Mesh(new THREE.TorusGeometry(1.02,.15,9,36),new THREE.MeshStandardMaterial({color:0x91f2ed,metalness:.35,roughness:.22,emissive:0x1aa5b3,emissiveIntensity:1.6}));portalRing.position.set(0,1.45,-.04);root.add(portalRing);
 const veil=new THREE.Mesh(new THREE.CircleGeometry(.87,32),new THREE.MeshBasicMaterial({color:0x42c5dc,transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false}));veil.position.set(0,1.45,-.07);root.add(veil);
 hubBox(root,7.2,.12,9.4,0x304a54,0,.05,.1);for(const z of [-3.7,3.8])for(const x of [-2.8,2.8])hubBox(root,.15,.22,.15,0x80dfe0,x,.17,z,0x167783);
 return root;
}
function stationKiosk(shop,index){
 const palettes=[0x53a7ad,0xd6a85d,0x71a56c,0x8b82ba],accent=palettes[index%palettes.length],g=new THREE.Group();g.position.set(shop.x,0,shop.z);worldRoot.add(g);hubRoots.push(g);
 hubBox(g,9,.14,7,0x29414b,0,0,0);hubBox(g,8,.22,5.8,0x415d63,0,.2,-.25);
 for(const x of [-3.65,3.65]){hubBox(g,.24,3.1,.3,0xb2c2bd,x,1.78,-2.55);hubBox(g,.22,2.8,.3,0x8c9c99,x,1.65,2.1);}
 for(const side of [-1,1]){const roof=hubBox(g,3.9,.21,5.4,0xc7cbb9,side*1.84,3.44,-.1);roof.rotation.z=-side*(.09+index*.045);}hubBox(g,5.8,1.25,.24,accent,0,2.52,-2.48,accent);
 hubBox(g,5.1,.12,.18,0xd9e5d8,0,2.52,-2.31);hubBox(g,4.5,.12,.18,0xd9e5d8,0,2.17,-2.31);
 hubBox(g,3.5,.72,1.15,0x273943,0,.68,.2);hubBox(g,2.5,.12,.72,accent,0,1.1,.05,accent);
 if(shop.type==='greenhouse'){
  const pane=new THREE.MeshStandardMaterial({color:0x5fbdba,transparent:true,opacity:.24,metalness:.18,roughness:.2,side:THREE.DoubleSide});
  for(const [x,z,w,d]of [[0,-2.1,7.2,.08],[0,2.1,7.2,.08],[-3.6,0,.08,4],[3.6,0,.08,4]]){const m=new THREE.Mesh(new THREE.BoxGeometry(w,1.8,d),pane);m.position.set(x,4.12,z);g.add(m);}
  for(const x of [-2.4,0,2.4]){hubBox(g,.12,1.5,.12,0x719c86,x,1,.65);hubBox(g,.65,.44,.62,0x80b874,x,1.9,.65);}
 }
}
function buildSpaceStation(){
 const layout=world.hub.layout,{minX,maxX,minZ,maxZ}=layout.floor;
 const structure=new THREE.Group();worldRoot.add(structure);hubRoots.push(structure);
 const base=new THREE.Mesh(new THREE.BoxGeometry(maxX-minX+1,.96,maxZ-minZ+1),new THREE.MeshStandardMaterial({color:0x283942,metalness:.42,roughness:.72}));base.position.set((minX+maxX+1)/2,-.5,(minZ+maxZ+1)/2);base.receiveShadow=true;structure.add(base);
 const floorMat=new THREE.MeshStandardMaterial({color:0x54676b,metalness:.25,roughness:.7}),darkMat=new THREE.MeshStandardMaterial({color:0x35484f,metalness:.32,roughness:.62});
 for(let x=minX+4;x<=maxX-4;x+=8)for(let z=minZ+4;z<=maxZ-4;z+=8){const m=new THREE.Mesh(new THREE.BoxGeometry(7.82,.035,7.82),((Math.floor(x/8)+Math.floor(z/8))&1)?floorMat:darkMat);m.position.set(x,0,z);m.receiveShadow=true;structure.add(m);}
 // The illuminated central concourse connects the arrival plaza, markets and return gate.
 hubBox(structure,5.2,.045,48,0x34717a,0,.045,-1,0x164d5d);
 for(let z=-24;z<=22;z+=4){hubBox(structure,.12,.06,1.5,0x8ad3c8,0,.08,z,0x256a70);}
 for(const x of [-3,3])hubBox(structure,.16,.07,48,0xd1b66f,x,.08,-1,0x716038);
 // Structural ribs and observation windows frame the large public concourse.
 const frameMat=new THREE.MeshStandardMaterial({color:0x73888a,metalness:.64,roughness:.35}),glassMat=new THREE.MeshStandardMaterial({color:0x367f90,metalness:.2,roughness:.2,transparent:true,opacity:.22,side:THREE.DoubleSide});
 for(const z of [-25,-15,-5,5,15,25])for(const x of [-43,43]){const post=new THREE.Mesh(new THREE.BoxGeometry(.72,9,.72),frameMat);post.position.set(x,4.5,z);post.castShadow=true;structure.add(post);hubBox(structure,1.6,.2,1.6,0x78c8c2,x,8.8,z,0x276c70);}
 for(const x of [-43,43]){hubBox(structure,.55,.52,52,0x879a96,x,9.15,0,0x202d32);const pane=new THREE.Mesh(new THREE.BoxGeometry(.12,5.4,48),glassMat);pane.position.set(x,4.9,0);structure.add(pane);}
 for(const z of [-28,28])hubBox(structure,86,.44,.55,0x879a96,0,9.15,z,0x202d32);
 // A glazed botanical rotunda breaks the long concourse with a rounded landmark.
 const rotunda=new THREE.Group();rotunda.position.set(0,0,-14);structure.add(rotunda);
 const rotundaBase=new THREE.Mesh(new THREE.CylinderGeometry(9.2,9.5,.48,40),new THREE.MeshStandardMaterial({color:0x465d63,metalness:.56,roughness:.36}));rotundaBase.position.y=.26;rotundaBase.castShadow=true;rotunda.add(rotundaBase);
 const lowerRing=new THREE.Mesh(new THREE.TorusGeometry(9.25,.28,8,48),new THREE.MeshStandardMaterial({color:0x91cfc3,metalness:.48,roughness:.28,emissive:0x1b5552,emissiveIntensity:.65}));lowerRing.rotation.x=Math.PI/2;lowerRing.position.y=.56;rotunda.add(lowerRing);
 const dome=new THREE.Mesh(new THREE.SphereGeometry(8.8,12,5,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0x3f9ba4,metalness:.16,roughness:.2,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}));dome.scale.y=.92;dome.position.y=.55;rotunda.add(dome);
 const halo=new THREE.Mesh(new THREE.TorusGeometry(11,.34,5,12),new THREE.MeshStandardMaterial({color:0xc5ac69,metalness:.56,roughness:.3,emissive:0x57461e,emissiveIntensity:.35}));halo.rotation.x=Math.PI/2;halo.position.y=9.4;rotunda.add(halo);
 for(let i=0;i<8;i++){const a=i*Math.PI/4,x=Math.cos(a)*7.4,z=Math.sin(a)*7.4,pillar=new THREE.Mesh(new THREE.CylinderGeometry(.2,.32,4.8,10),frameMat);pillar.position.set(x,2.75,z);pillar.castShadow=true;rotunda.add(pillar);const leaf=new THREE.Mesh(new THREE.ConeGeometry(.55,1.8,7),new THREE.MeshStandardMaterial({color:i%2?0x719d73:0x89b37b,roughness:.8}));leaf.position.set(x*.58,1.35,z*.58);leaf.scale.set(1,.75,1);rotunda.add(leaf);}
 // Market wing awnings and modular public counters.
 for(const [x,z]of [[-18,-3],[18,-3],[-18,11],[18,11]]){const awning=hubBox(structure,9,.24,7,0x718c8e,x,6.1,z,0x263e42);awning.rotation.z=Math.sign(x)*.13;awning.material.roughness=.6;}
 layout.shops.forEach(stationKiosk);
 for(const d of layout.decorations){const g=new THREE.Group();g.position.set(d.x,d.y,d.z);worldRoot.add(g);hubRoots.push(g);hubBox(g,.2,4.2,.2,0x697c7e,.5,2.1,.5);hubBox(g,1.2,.17,.42,0xe3d394,.78,4.18,.5,0x8a723c).rotation.z=.17;hubBox(g,.55,.12,.55,0x80dae1,.5,3.92,.5,0x2d7b86);}
 const portal=layout.portals[0];portalModel(portal);
 const npc=layout.npcs.find(n=>n.id==='farmer');if(npc){farmerModel=createFarmerNpc(THREE);farmerModel.group.position.set(npc.x+.5,npc.y,npc.z+.5);farmerModel.group.rotation.y=Math.PI;worldRoot.add(farmerModel.group);hubRoots.push(farmerModel.group);}
}
function rebuildHubObjects(){clearHubRoots();if(!world)return;
 if(world.worldKind==='shopHub'){
  buildSpaceStation();
 }else if(world.personalPortal){if(world.personalPortal.shape==='starship')starshipPortalModel(world.personalPortal);else portalModel(world.personalPortal);}
}
const humanoid=new THREE.Group();worldRoot.add(humanoid);const arms=[],legs=[];
const skin=new THREE.MeshLambertMaterial({color:0xe4c6a5}),suit=new THREE.MeshLambertMaterial({color:0x3e6c82}),visor=new THREE.MeshLambertMaterial({color:0x122f43}),boots=new THREE.MeshLambertMaterial({color:0x253d4a});
function box(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
// Shared low-poly item parts feed both the held model and the cached HUD thumbnails.
const itemMats={copper:new THREE.MeshStandardMaterial({color:0xc27849,roughness:.72}),wood:new THREE.MeshStandardMaterial({color:0x815c3e,roughness:.9}),woodLight:new THREE.MeshStandardMaterial({color:0xb1875b,roughness:.86}),sand:new THREE.MeshStandardMaterial({color:0xd5bf83,roughness:.95}),stone:new THREE.MeshStandardMaterial({color:0x66747a,roughness:.92}),dark:new THREE.MeshStandardMaterial({color:0x293238,roughness:.9}),light:new THREE.MeshStandardMaterial({color:0xb8c5c6,metalness:.25,roughness:.52}),metal:new THREE.MeshStandardMaterial({color:0x9aabb0,metalness:.48,roughness:.5}),gold:new THREE.MeshStandardMaterial({color:0xd3ad59,metalness:.4,roughness:.48}),crystal:new THREE.MeshStandardMaterial({color:0x58a9be,metalness:.12,roughness:.32,emissive:0x123b50,emissiveIntensity:.35}),leaf:new THREE.MeshStandardMaterial({color:0x659552,roughness:.9}),food:new THREE.MeshStandardMaterial({color:0xd8b45b,roughness:.8}),carrot:new THREE.MeshLambertMaterial({color:0xe47a32}),potato:new THREE.MeshLambertMaterial({color:0x987451})};
// A seamless grain tile runs along the wooden haft and across carved head faces.
const grainCanvas=document.createElement('canvas');
grainCanvas.width=64;grainCanvas.height=64;
const grain=grainCanvas.getContext('2d');
grain.fillStyle='#fff5da';grain.fillRect(0,0,64,64);
for(let row=0;row<8;row++){
 grain.strokeStyle=row%3===0?'#ab784a':'#d7ae78';grain.lineWidth=row%3===0?1.6:1;
 grain.beginPath();
 for(let x=0;x<=64;x++){
  const y=row*8+4+2*Math.sin(x*Math.PI/32+row);
  if(x===0)grain.moveTo(x,y);else grain.lineTo(x,y);
 }
 grain.stroke();
}
const timberGrain=new THREE.CanvasTexture(grainCanvas);
timberGrain.colorSpace=THREE.SRGBColorSpace;
timberGrain.wrapS=timberGrain.wrapT=THREE.RepeatWrapping;
itemMats.wood.map=itemMats.woodLight.map=timberGrain;
const toolNames=TOOL_NAMES;
function toolModel(id, model, m) {
 // Profiles are drawn in the plane of the swing, with a bevel on the cutting edge.
 const blade = (outline, depth, material) => {
  const shape = new THREE.Shape();
  outline.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.012,bevelThickness:.012,bevelSegments:1});
  geometry.translate(0,0,-depth/2);
  const part = new THREE.Mesh(geometry,material);
  part.castShadow = true;
  model.add(part);
 };
 const haft = new THREE.Mesh(new THREE.CylinderGeometry(.052,.067,.78,7),m.wood);
 haft.position.y=-.04;haft.castShadow=true;model.add(haft);
 if(id==='wood_pickaxe'||id==='stone_pickaxe') {
  const stone=id==='stone_pickaxe';
  blade([[-.38,.28],[-.24,.43],[-.05,.49],[.15,.47],[.32,.40],[.39,.28],[.17,.36],[-.08,.37]],stone?.14:.095,stone?m.stone:m.woodLight);
 } else if(id==='wood_axe') {
  blade([[-.09,.34],[-.07,.52],[.09,.49],[.27,.58],[.32,.49],[.29,.34],[.21,.26],[.10,.34]],.14,m.woodLight);
 } else if(id==='wood_shovel') {
  blade([[-.055,.30],[-.16,.36],[-.18,.56],[-.11,.70],[0,.77],[.13,.66],[.18,.51],[.14,.36],[.055,.30]],.07,m.woodLight);
 } else if(id==='hoe') {
  blade([[-.07,.33],[-.06,.47],[.20,.48],[.28,.42],[.28,.19],[.20,.24],[.16,.37]],.10,m.woodLight);
 } else {
  blade([[-.04,.33],[.02,.47],[.21,.49],[.41,.40],[.53,.24],[.36,.34],[.20,.37]],.035,m.metal);
 }
 // A darker end-grain peg and long grain inlay read even at HUD size.
 box(model,.068,.044,.16,m.wood,0,.405,0);
 box(model,.016,.44,.012,m.woodLight,.015,-.06,.052);
}
function makeItemModel(id){
 const g=new THREE.Group(),m=itemMats;
 if(['wood_pickaxe','stone_pickaxe','wood_axe','wood_shovel','hoe','scythe'].includes(id)) toolModel(id,g,m);
 else if(id==='watering_can'){
  const can=new THREE.Mesh(new THREE.CylinderGeometry(.22,.25,.40,10),m.crystal);g.add(can);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.16,.034,5,12),m.wood);handle.position.set(-.19,.09,0);g.add(handle);
  const spout=new THREE.Mesh(new THREE.CylinderGeometry(.045,.075,.36,7),m.metal);spout.position.set(.31,.05,0);spout.rotation.z=-.85;g.add(spout);
 } else if(id.endsWith('_seed')){
  const seedMat=id==='carrot_seed'?m.wood:id==='potato_seed'?m.potato:m.food;
  for(const [x,y,z,r] of [[-.13,0,.02,-.7],[.10,.03,.12,.5],[.03,.09,-.12,-.23]]){
   const seed=new THREE.Mesh(new THREE.IcosahedronGeometry(.14,0),seedMat);
   seed.position.set(x,y,z);seed.scale.set(.61,1.25,.63);seed.rotation.z=r;g.add(seed);
  }
 } else if(id==='wood'){
  for(const [y,z] of [[0,-.12],[0,.12],[.14,0]])box(g,.60,.12,.19,m.woodLight,0,y,z);
 } else if(['stone','ore','iron_ore','coal_ore','copper_ore','coal','iron_vein_core','coal_vein_core','copper_vein_core'].includes(id)){if(id==='coal'){const coal=new THREE.Mesh(new THREE.DodecahedronGeometry(.27,0),m.dark);coal.scale.set(1,.7,.85);g.add(coal);}else for(let i=0;i<5;i++){const a=new THREE.Mesh(new THREE.IcosahedronGeometry(.19+(i%2)*.045,0),i%3===0?m.metal:m.stone);a.position.set((i-2)*.12,(i%2)*.16,((i*7)%3-1)*.09);a.rotation.set(i*.4,i*.7,i*.2);g.add(a);}if(id.includes('vein_core')){const core=new THREE.Mesh(new THREE.OctahedronGeometry(.25),id.includes('coal')?m.dark:id.includes('iron')?m.metal:m.woodLight);core.position.y=.23;g.add(core);}if(id!=='stone'&&id!=='coal')for(const [x,y]of [[-.1,.12],[.12,.23]]){const gem=id.includes('iron')?m.metal:id.includes('copper')?m.copper:id.includes('coal')?m.dark:m.crystal,c=new THREE.Mesh(new THREE.OctahedronGeometry(.105,0),gem);c.position.set(x,y,.11);g.add(c);}}
 else if(id==='iron_ingot'||id==='ingot'){const a=new THREE.Mesh(new THREE.CylinderGeometry(.30,.36,.17,4),m.metal);a.scale.z=.68;a.rotation.y=Math.PI/4;a.position.y=.05;g.add(a);const b=a.clone();b.scale.multiplyScalar(.85);b.position.y=.21;g.add(b);}
 else if(['dirt','sand','coal_block','block_dirt'].includes(id)){const a=new THREE.Mesh(new THREE.CylinderGeometry(.4,.415,.57,4),id==='sand'?m.sand:id==='coal_block'?machineMaterials.dark:m.wood);a.rotation.y=Math.PI/4;g.add(a);if(!['sand','coal_block'].includes(id))for(const [x,y,z]of [[-.18,.2,.12],[.14,-.1,.2],[.12,.11,-.19]])box(g,.12,.1,.12,m.woodLight,x,y,z);}
 else if(id.includes('wheat')||id==='food'){for(let i=0;i<3;i++){const stem=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,.58,5),m.leaf);stem.position.set((i-1)*.12,.08,0);g.add(stem);const seed=new THREE.Mesh(new THREE.OctahedronGeometry(.105),m.food);seed.scale.set(.65,1.5,.65);seed.rotation.z=(i-1)*.25;seed.position.set((i-1)*.12,.4,0);g.add(seed);}}
 else if(id.includes('carrot')){const root=new THREE.Mesh(new THREE.ConeGeometry(.17,.65,7),m.carrot);root.rotation.x=Math.PI;root.position.y=-.03;g.add(root);for(let i=0;i<3;i++){const leaf=new THREE.Mesh(new THREE.ConeGeometry(.055,.4,5),m.leaf);leaf.position.set((i-1)*.09,.3,0);leaf.rotation.z=(i-1)*.22;g.add(leaf);}}
 else if(id.includes('potato')){for(const [x,y,z]of [[-.14,0,0],[.08,.05,.1],[.02,-.07,-.1]]){const tuber=new THREE.Mesh(new THREE.IcosahedronGeometry(.16,0),m.potato);tuber.scale.set(1.23,.70,.82);tuber.rotation.z=x;tuber.position.set(x,y,z);g.add(tuber);}}
 else if(['oak_log','birch_log','rubberwood'].includes(id)){const bark=id==='birch_log'?birchTrunk:id==='rubberwood'?rubberTrunk:treeTrunk,woodEnd=id==='birch_log'?itemMats.light:itemMats.woodLight;const log=new THREE.Mesh(new THREE.CylinderGeometry(.18,.23,.56,9),bark);log.rotation.z=Math.PI/2;log.position.y=.02;g.add(log);const end=new THREE.Mesh(new THREE.CircleGeometry(.18,9),woodEnd);end.rotation.y=Math.PI/2;end.position.x=.281;end.position.y=.02;g.add(end);}
 else if(id==='rubber_sap'){const drop=new THREE.Mesh(new THREE.OctahedronGeometry(.22,0),m.gold);drop.scale.set(.92,1.55,.85);g.add(drop);}
 else if(id.includes('sapling')){const leaf=id.includes('birch')?birchCanopy:id.includes('rubber')?rubberCanopy:treeCanopy;box(g,.1,.48,.1,id.includes('birch')?birchTrunk:treeTrunk,0,0,0);for(const [x,y,z]of [[0,.25,0],[.13,.12,0],[-.13,.10,0]]){const l=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,0),leaf);l.scale.set(1.25,.65,.85);l.rotation.z=x*3;l.position.set(x,y,z);g.add(l);}}
 else if(['drill','conveyor','smelter','workbench','t1_bench','tool_bench','agriculture_bench','farming_bench','block_bench','basic_assembler'].includes(id)){const machine=makeMachineModel(id);g.add(machine);machine.scale.setScalar(.45);machine.rotation.x=-.35;}
 else {const a=new THREE.Mesh(new THREE.IcosahedronGeometry(.3,0),m.stone);g.add(a);}
 g.rotation.x=-.16;return g;}
const itemThumbs=new Map();let thumbRenderer=null;const thumbScene=new THREE.Scene();thumbScene.add(new THREE.HemisphereLight(0xffffff,0x566677,2));const thumbLight=new THREE.DirectionalLight(0xffe3b5,2.3);thumbLight.position.set(-3,5,6);thumbScene.add(thumbLight);const thumbCamera=new THREE.PerspectiveCamera(34,1,.1,20);thumbCamera.position.set(1.45,1.25,2.2);thumbCamera.lookAt(0,.12,0);
function itemThumbnail(id){if(itemThumbs.has(id))return itemThumbs.get(id);if(!thumbRenderer){thumbRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});thumbRenderer.setPixelRatio(1);thumbRenderer.setSize(72,72);thumbRenderer.outputColorSpace=THREE.SRGBColorSpace;thumbRenderer.setClearColor(0x000000,0);}const model=makeItemModel(id);thumbScene.add(model);thumbRenderer.render(thumbScene,thumbCamera);const url=thumbRenderer.domElement.toDataURL('image/png');thumbScene.remove(model);model.traverse(o=>{if(o.geometry&&!o.geometry.userData.terraIndustrialShared&&!o.geometry.userData.terraWorkstationShared)o.geometry.dispose();});itemThumbs.set(id,url);return url;}
let heldToolModel=null;
function equipHeldTool(id){if(heldToolModel){heldToolModel.parent?.remove(heldToolModel);heldToolModel=null;}if(!toolNames[id]&&!RESOURCE_KEYS.includes(id))return;heldToolModel=makeItemModel(id);heldToolModel.scale.setScalar(['dirt','sand','coal_block'].includes(id)?.56:.72);heldToolModel.position.set(.13,-.49,-.19);heldToolModel.rotation.z=-.35;(arms[1]||humanoid).add(heldToolModel);}
// Ordinary adult proportions in metres: 1.78 m tall, ~0.68 m arm-to-arm width.
// Feet sit at y=0, and the top of the head is exactly PLAYER_HEIGHT_METERS.
box(humanoid,.44,.65,.25,suit,0,1.105,0); // torso: 0.78–1.43 m
box(humanoid,.28,.28,.27,skin,0,1.64,0); // head: 1.50–1.78 m
box(humanoid,.28,.105,.10,visor,0,1.65,-.125);
box(humanoid,.30,.39,.16,boots,0,1.19,.17);
box(humanoid,.34,.20,.055,itemMats.light,0,1.28,-.143);
box(humanoid,.13,.038,.02,itemMats.crystal,-.055,1.29,-.178);
for(const side of [-1,1]){
 const arm=new THREE.Group();arm.position.set(side*.28,1.41,0);box(arm,.12,.60,.19,suit,0,-.30,0);box(arm,.125,.16,.20,itemMats.light,0,-.09,0);arms.push(arm);humanoid.add(arm);
 const leg=new THREE.Group();leg.position.set(side*.125,.78,0);box(leg,.18,.78,.22,boots,0,-.39,0);box(leg,.19,.14,.28,visor,0,-.71,-.025);legs.push(leg);humanoid.add(leg);
}
let gaitPhase=0;function animateWalk(dt,moving){if(moving||playerSwimming)gaitPhase+=dt*(playerSwimming?5:8);const targetLeg=playerSwimming?Math.sin(gaitPhase)*.34:moving?Math.sin(gaitPhase)*.55:0,targetArm=playerSwimming?-.45+Math.sin(gaitPhase+Math.PI)*.42:-targetLeg*.75;for(let i=0;i<2;i++){legs[i].rotation.x=THREE.MathUtils.damp(legs[i].rotation.x,i===0?targetLeg:-targetLeg,10,dt);arms[i].rotation.x=THREE.MathUtils.damp(arms[i].rotation.x,i===0?targetArm:-targetArm,10,dt);}}
const player={pos:new THREE.Vector3(.5,0,.5),grounded:true};
let playerImmersed=false,playerSwimming=false;
function setAuthoritativeWaterState(state={}){playerImmersed=state.immersed===true;playerSwimming=state.swimming===true;humanoid.rotation.x=playerSwimming?-.12:0;const inHub=world?.worldKind==='shopHub',sky=playerImmersed?'#527e98':inHub?'#07131f':'#94c5e7';scene.background.set(sky);if(scene.fog){scene.fog.color.set(sky);scene.fog.near=inHub?500:90;scene.fog.far=inHub?920:240;}starfield.visible=inHub;$('jump').setAttribute('aria-label',playerImmersed?'수영 상승':'점프');$('jump').title=playerImmersed?'누르고 상승 · Shift로 잠수':'점프';$('dive').hidden=!playerImmersed;}
const keys=new Set(),touchMove=new THREE.Vector2(0,0);let jumpQueued=false,swimQueued=false,movementBusy=false,lastMovementAt=0,lastCraftStationState='';
let swimHeld=false,diveHeld=false,diveQueued=false;
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Space'&&!e.repeat)jump();if(e.code==='KeyE'&&!e.repeat){if(nearInteraction)void interactWorld();else toggleInventory();return;}if(e.code==='Escape'){closeInventory();if(placingMachine){placingMachine=null;refreshActionPreview();notice('배치 취소');}if(!$('shopPanel').hidden){$('shopPanel').hidden=true;updateInteractionUi();}}if(e.code==='KeyR'&&placingMachine){machineRotation=(machineRotation+1)%4;refreshActionPreview();}const slot=e.code.match(/^Digit([1-8])$/);if(slot){selectQuickSlot(Number(slot[1])-1);return;}keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();swimHeld=false;diveHeld=false;});
const PLACEABLE_BLOCKS=new Set(['dirt','sand','coal_block']);
const FARM_TOOLS=new Set(['hoe','watering_can','scythe','sapling']);
function isBlockEquipped(){return PLACEABLE_BLOCKS.has(selectedTool);}
function isFarmEquipped(){return FARM_TOOLS.has(selectedTool);}
function refreshActionPreview(){
 const hint=$('placementHint');
 $('farmSelectors').hidden=!isFarmEquipped();
 if(placingMachine){blockPreview.visible=false;hint.hidden=false;if(!machinePreview)createMachinePreview(placingMachine);hint.textContent='설비 배치 중 · '+(recipeCards.find(r=>r.id===placingMachine)?.name||'기계')+' · 탭하여 놓기 · R 회전 · Esc 취소';}
 else{clearMachinePreview();hint.hidden=true;if(!isBlockEquipped())blockPreview.visible=false;else if(lastBlockPreviewPoint)updateBlockPreview(lastBlockPreviewPoint.x,lastBlockPreviewPoint.y);}
}
$('jump').onclick=jump;
$('jump').addEventListener('pointerdown',()=>{if(playerImmersed)swimHeld=true;});
for(const eventName of ['pointerup','pointercancel','pointerleave'])$('jump').addEventListener(eventName,()=>{swimHeld=false;});
$('dive').addEventListener('pointerdown',()=>{if(playerImmersed)diveHeld=true;});
$('dive').addEventListener('click',()=>{if(playerImmersed)diveQueued=true;});
for(const eventName of ['pointerup','pointercancel','pointerleave'])$('dive').addEventListener(eventName,()=>{diveHeld=false;});
function jump(){if(playerImmersed)swimQueued=true;else if(player.grounded)jumpQueued=true;}
function sendMovement(now){
 if(!world||movementBusy)return;
 if(world.worldGenVersion>=2&&!streamedTerrain.has(terrainChunkKey(chunkCoord(player.pos.x),chunkCoord(player.pos.z))))return;
 const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMove.x;
 const dz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-touchMove.y;
 const moving=Math.hypot(dx,dz)>.05;if(!moving&&player.grounded&&!jumpQueued&&!swimQueued&&now-lastMovementAt<5000)return;if(now-lastMovementAt<50)return;
 lastMovementAt=now;
 const length=Math.hypot(dx,dz),sx=length>1?dx/length:dx,sz=length>1?dz/length:dz;
 const dirX=sx*Math.cos(camYaw)-sz*Math.sin(camYaw),dirZ=-sx*Math.sin(camYaw)-sz*Math.cos(camYaw);
 if(Math.hypot(dirX,dirZ)>.05)humanoid.rotation.y=Math.atan2(-dirX,-dirZ);
 const jump=jumpQueued,swim=swimQueued||(playerImmersed&&(keys.has('Space')||swimHeld)),dive=diveQueued||(playerImmersed&&(keys.has('ShiftLeft')||keys.has('ShiftRight')||diveHeld));jumpQueued=false;swimQueued=false;diveQueued=false;movementBusy=true;const teleportVersion=devTeleportVersion;
 void api('/api/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:dirX,z:dirZ,jump,swim,dive})}).then(data=>{
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
 const portal=world?.personalPortal;if(portal&&Math.abs(x-portal.x)<=4&&Math.abs(z-portal.z)<=5&&y>=portal.y&&y<=portal.y+4)return '우주선 포털 보호 구역';
 if(has(x,y,z))return '이미 블록이 있음';
 const placeItem=['dirt','sand','coal_block'].includes(selectedTool)?selectedTool:'dirt';if((world?.inventory?.[placeItem]||0)<1)return `${RESOURCE_LABELS[placeItem]} 부족`;
 if(Object.keys(world?.edits||{}).length>=20000&&!Object.hasOwn(world.edits,`${x},${y},${z}`))return '월드 편집 한도';
 if(!(generated&&waterLevelAt(world,x,y,z)>0)&&![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>has(x+dx,y+dy,z+dz)))return '붙일 면이 없음';
 const cx=x+.5,cy=y+.5,cz=z+.5;
 if(Math.abs(cx-player.pos.x)<.65&&Math.abs(cz-player.pos.z)<.65&&cy>=player.pos.y&&cy<=player.pos.y+1.8)return '플레이어와 겹침';
 return '';
}
function updateBlockPreview(sx,sy){
 lastBlockPreviewPoint={x:sx,y:sy};
 if(placingMachine||!isBlockEquipped()||world?.worldKind==='shopHub'){blockPreview.visible=false;return;}
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
 const inReach=point=>Math.hypot(point.x-player.pos.x,point.y-(player.pos.y+1),point.z-player.pos.z)<=5.5;
 const consider=(group,type)=>{if(!group.visible)return;const id=group.userData.resourceId;let point;
  if(type==='crop'){const crop=world?.crops?.find(item=>item.id===id);if(!crop||crop.stage<4)return;point={x:crop.x+.5,y:crop.y+.45,z:crop.z+.5};}
  else if(type==='tree'){const tree=group.userData.resourceTree||world?.trees?.find(item=>item.id===id);if(!tree||tree.stage<3||tree.harvested)return;point={x:tree.x+.5,y:tree.y+Math.max(1.7,(tree.height||5)*.55),z:tree.z+.5};}
  else{const node=world?.oreNodes?.find(item=>item.id===id);if(!node||node.remaining<1)return;point={x:node.x+.5,y:node.y+.5,z:node.z+.5};}
  if(!inReach(point))return;const hit=ray.intersectObject(group,true)[0];if(hit&&hit.distance<=75&&(!groundHit||hit.distance<groundHit.distance)&&(!best||hit.distance<best.distance))best={id,type,distance:hit.distance};
 };
 for(const group of cropGroups)consider(group,'crop');
 if(selectedTool==='wood_axe')for(const group of treeGroups)consider(group,'tree');
 if(selectedTool==='wood_pickaxe')for(const group of oreGroups)consider(group,'ore');
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
 if(placingMachine)updateMachinePreview(e.clientX,e.clientY);else if(isBlockEquipped())updateBlockPreview(e.clientX,e.clientY);
 pressStart={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};
 lastPoint={x:e.clientX,y:e.clientY};dragCam=false;
 renderer.domElement.setPointerCapture(e.pointerId);
 if(!placingMachine&&!isBlockEquipped()&&!isFarmEquipped()&&!busy){
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
 if(placingMachine)updateMachinePreview(e.clientX,e.clientY);
 else if(isBlockEquipped())updateBlockPreview(e.clientX,e.clientY);
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
 if(!dragCam&&performance.now()-pressStart.t<500){if(placingMachine)void placeMachineAt(e.clientX,e.clientY);else if(isBlockEquipped())void interact(e.clientX,e.clientY);else if(isFarmEquipped())void interactFarm(e.clientX,e.clientY);}
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
function selectQuickSlot(slot){const id=world?.inventory?.quickSlots?.[slot],count=id?(toolNames[id]?(world.inventory.tools?.[id]||0):(world.inventory[id]||0)):0;if(!id||!toolDisplay[id]||count<1)return;selectedSlot=slot;selectedTool=id;equipHeldTool(id);refreshActionPreview();updateQuickbar();void api('/api/slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:slot})}).then(data=>{if(data.world)world=data.world;}).catch(()=>{});}
document.querySelectorAll('.quickSlot').forEach((button,i)=>button.addEventListener('click',()=>selectQuickSlot(i)));
function closeInventory(){$('inventoryPanel').hidden=true;$('inventoryButton').setAttribute('aria-expanded','false');}
function toggleInventory(){const panel=$('inventoryPanel');panel.hidden=!panel.hidden;$('inventoryButton').setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)renderInventory();}
$('inventoryButton').addEventListener('click',toggleInventory);$('inventoryClose').addEventListener('click',closeInventory);
function assignInventoryItem(id){const slots=world?.inventory?.quickSlots||[],existing=slots.indexOf(id),slot=existing>=0?existing:slots.findIndex((value,i)=>i>=3&&!value);if(slot<0){notice('빈 퀵슬롯이 없어. 기존 슬롯을 먼저 비워.');return;}void api('/api/slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:slot,item:id})}).then(data=>{world=data.world;selectedSlot=slot;selectedTool=id;equipHeldTool(id);refreshActionPreview();updateQuickbar();renderInventory();}).catch(err=>notice(err.message));}
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
function considerInteraction(best,kind,id,item,quantity,station,destination,distance,radius){
 if(!(distance<=radius)||(best&&distance>=best.distance))return best;
 const label=kind==='item'?`줍기 · ${item} ×${quantity}`:kind==='station'?`${stationLabels[station]} 열기`:kind==='farmer'?'농부 상점 열기':destination==='personal'?'개인 섬으로 돌아가기':kind==='portal'?'우주정거장 입장':'상호작용';
 return {kind,id,item,quantity,station,destination,distance,radius,label};
}
function nearbyInteraction(){
 if(!world)return null;let best=null;
 if(world.worldKind!=='shopHub')for(const d of world.drops||[]){const distance=Math.hypot(d.x-player.pos.x,d.y-(player.pos.y+1),d.z-player.pos.z);best=considerInteraction(best,'item',d.id,d.item,d.quantity,null,null,distance,2.35);}
 if(world.worldKind==='shopHub'){
  for(const p of world.hub?.layout?.portals||[])best=considerInteraction(best,'portal',null,null,null,null,'personal',tileDistance(p),3.5);
  for(const n of world.hub?.layout?.npcs||[])best=considerInteraction(best,'farmer',n.id,null,null,null,null,tileDistance(n),n.interactionRadius);
 }else{
  for(const m of world.machines||[])if(stationLabels[m.type])best=considerInteraction(best,'station',m.id,null,null,m.type,null,tileDistance(m),3.5);
  if(world.personalPortal)best=considerInteraction(best,'portal',null,null,null,null,'shopHub',tileDistance(world.personalPortal),world.personalPortal.interactionRadius);
 }
 return best;
}
const interactionUi={button:$('worldInteract'),hotbar:$('hotbar'),objective:$('objective'),grid:$('grid'),heading:document.querySelector('#top h1 span'),shopPanel:$('shopPanel'),craftPanel:$('craftPanel')};
function updateInteractionUi(){const hub=world?.worldKind==='shopHub',interact=interactionUi.button,title=hub?'/ ORBITAL COMMONS':'/ OPEN WORLD';if(interact.hidden!==(!nearInteraction||!interactionUi.shopPanel.hidden))interact.hidden=!nearInteraction||!interactionUi.shopPanel.hidden;if(interact.textContent!==(nearInteraction?.label||'상호작용'))interact.textContent=nearInteraction?.label||'상호작용';if(interactionUi.hotbar.hidden!==hub)interactionUi.hotbar.hidden=hub;if(interactionUi.objective.hidden!==hub)interactionUi.objective.hidden=hub;if(interactionUi.grid.hidden!==hub)interactionUi.grid.hidden=hub;if(interactionUi.heading.textContent!==title)interactionUi.heading.textContent=title;if(hub&&!interactionUi.craftPanel.hidden)interactionUi.craftPanel.hidden=true;}
function loadWorld(next){const old=world?.worldKind,previous=world;world=next;syncWaterEdits(previous,next);if(world.player){player.pos.set(world.player.x,world.player.y,world.player.z);player.grounded=world.player.grounded===true;humanoid.position.copy(player.pos);setAuthoritativeWaterState(world.player);}if(old!==world.worldKind){$('shopPanel').hidden=true;placingMachine=null;refreshActionPreview();rebuild();rebuildMachines();rebuildResources();}inventory();updateCrafting();nearInteraction=nearbyInteraction();updateInteractionUi();}
function rewardToast(item,amount){if(!amount)return;const line=document.createElement('div');line.className='pickup';line.textContent=(RESOURCE_LABELS[item]||item)+' ×'+amount;$('pickups').append(line);setTimeout(()=>line.remove(),2200);}
async function interactWorld(){if(!nearInteraction||interactionBusy)return;interactionBusy=true;const action=nearInteraction;try{if(action.kind==='item'){const data=await api('/api/items/pickup',postJson({dropId:action.id,revision:world.revision}));world=data.world;inventory();syncWorldDrops();rewardToast(action.item,action.quantity);notice(`${action.item} +${action.quantity} · 수동 획득`);}else if(action.kind==='portal'){const data=await api('/api/world/transition',postJson({destination:action.destination}));loadWorld(data.world);notice(action.destination==='shopHub'?'우주정거장 공용 허브에 도착했어.':'개인 섬으로 돌아왔어.');}else if(action.kind==='station'){activeCraftStation=action.station;updateCrafting();$('craftPanel').hidden=false;updateInteractionUi();}else{const data=await api('/api/shop/open',postJson({npcId:action.id}));shopRevision=data.revision;$('shopCoins').textContent='보유 코인 · '+data.coins.toLocaleString()+' 코인';$('shopPanel').hidden=false;refreshShopButtons();updateInteractionUi();}}catch(e){if(e.world)loadWorld(e.world);notice(e.message);}finally{interactionBusy=false;}}
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
  else if(count&&!recipe.tool&&!recipe.output){button.textContent='배치하기';button.disabled=false;button.onclick=()=>{placingMachine=recipe.id;machineRotation=0;refreshActionPreview();$('craftPanel').hidden=true;notice(recipe.name+' 배치 위치 선택 · 탭하여 놓기 · R 회전 · Esc 취소');};}
  else {button.textContent=already?'제작 완료':!stationReady?'잠김':!stationNearby?stationName+'에 접근':canAfford?'제작하기':'재료 부족';button.disabled=already||!stationReady||!stationNearby||!canAfford;button.onclick=()=>void craftRecipe(recipe.id);}
  if(!stationReady||!stationNearby)card.classList.add('locked');card.append(head,desc,cost,button);container.append(card);
 }
}
async function craftRecipe(recipe){
 try{const data=await api('/api/craft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipe,revision:world.revision})});world=data.world;inventory();updateCrafting();if(recipeCards.find(r=>r.id===recipe)?.tool){notice('도구 제작 완료 · 퀵슬롯에 추가됨');return;}if(recipeCards.find(r=>r.id===recipe)?.output){notice('석탄 블록 제작 완료');return;}placingMachine=recipe;machineRotation=0;refreshActionPreview();$('craftPanel').hidden=true;notice('제작 완료 · 설치할 타일을 탭해. R로 방향을 바꿀 수 있어.');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();}notice('제작 실패: '+e.message);}
}
async function placeMachineAt(sx,sy){
 if(!placingMachine||busy)return;const cell=targetBlock(sx,sy,'place');if(!cell){notice('지면의 가까운 타일을 선택해.');return;}
 updateMachinePreview(sx,sy);if(!previewValid){notice('초록색 설비 미리보기가 보이는 빈 바닥에 놓아.');return;}
 busy=true;try{const data=await api('/api/machine/place',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:placingMachine,...cell,rotation:machineRotation,revision:world.revision})});world=data.world;placingMachine=null;inventory();rebuildMachines();updateCrafting();refreshActionPreview();notice('설비 배치 완료 · 서버에 저장됨');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();rebuildMachines();}notice('배치 실패: '+e.message);}finally{busy=false;}
}
function refreshCraftPanel(){const opening=$('craftPanel').hidden;activeCraftStation='t0';if(opening&&placingMachine){placingMachine=null;refreshActionPreview();}updateCrafting();$('craftPanel').hidden=!opening;}
$('craftToggle').onclick=refreshCraftPanel;
async function interact(sx,sy){
 const cell=targetBlock(sx,sy,'place');
 if(!cell){notice('가까운 블록을 선택해줘.');return;}
 updateBlockPreview(sx,sy);if(!blockPlacementValid){notice(blockPlacementError(cell));return;}
 return interactCell(cell,'place');
}
function cropAt(sx,sy,groundCell){
 if(!groundCell)return null;const r=renderer.domElement.getBoundingClientRect();ndc.set(((sx-r.left)/r.width)*2-1,-((sy-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);
 const terrain=terrainRayTargets(),groundHit=terrain.length?ray.intersectObjects(terrain,false)[0]:null;let best=null;
 for(const group of cropGroups){if(!group.visible)continue;const crop=world.crops.find(c=>c.id===group.userData.resourceId);if(!crop||crop.x!==groundCell.x||crop.z!==groundCell.z||Math.abs(crop.y-groundCell.y)>1)continue;
  const center={x:crop.x+.5,y:crop.y+.45,z:crop.z+.5};if(Math.hypot(center.x-player.pos.x,center.y-(player.pos.y+1),center.z-player.pos.z)>5.5)continue;
  const hit=ray.intersectObject(group,true)[0];if(hit&&(!groundHit||hit.distance<groundHit.distance)&&(!best||hit.distance<best.distance))best={crop,distance:hit.distance};
 }return best?.crop||null;
}
async function interactFarm(sx,sy){
 const target=targetBlock(sx,sy,'mine');if(!target){notice('농지 또는 작물을 선택해.');return;}
 const crop=cropAt(sx,sy,target), tool=selectedTool;if(crop)Object.assign(target,{x:crop.x,y:crop.y,z:crop.z});else if(has(target.x,target.y,target.z)&&!has(target.x,target.y+1,target.z))target.y+=1;let action;
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
let lastFrameAt=performance.now(),lastRenderedAt=0,frameSampleCount=0,frameSampleIndex=0;const renderedFrameIntervals=new Float64Array(3600);
function loop(now){requestAnimationFrame(loop);const rawFrameMs=Math.max(0,now-lastFrameAt),frameDt=Math.min(.05,rawFrameMs/1000);lastFrameAt=now;waterShaderClock.time=now*.001;
 if(world?.worldGenVersion)terrainFrameAvgMs=terrainFrameAvgMs?terrainFrameAvgMs*.95+rawFrameMs*.05:rawFrameMs;
 const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD')||keys.has('ArrowUp')||keys.has('ArrowDown')||keys.has('ArrowLeft')||keys.has('ArrowRight')||touchMove.length()>.05;animateWalk(frameDt,moving);
 if(world){sendMovement(now);updateTerrainStreaming();pumpTerrainWork();pumpWaterWork();}
 farmerModel?.update(frameDt);if(now>=interactionRefreshAt){interactionRefreshAt=now+100;nearInteraction=nearbyInteraction();updateInteractionUi();}
 updateMachineVisuals(frameDt);
 for(const entry of dropRoots.values()){entry.root.position.lerp(entry.target,Math.min(1,frameDt*10));entry.root.rotation.y+=frameDt*(entry.conveyor?.45:.65);if(!entry.conveyor)entry.root.position.y=entry.target.y+.09+Math.sin(now*.0018+entry.phase)*.055;}
 updateMine(now);
 cameraTarget.copy(player.pos);cameraTarget.y+=PLAYER_HEIGHT_METERS*.54;cameraTarget.multiplyScalar(WORLD_SCALE);
 camera.position.set(cameraTarget.x+camDistance*WORLD_SCALE*Math.sin(camYaw)*Math.cos(camPitch),cameraTarget.y+camDistance*WORLD_SCALE*Math.sin(camPitch)+2.0,cameraTarget.z+camDistance*WORLD_SCALE*Math.cos(camYaw)*Math.cos(camPitch));camera.lookAt(cameraTarget);
 const renderInterval=terraDebugFps?1000/terraDebugFps:0;if(!renderInterval||!lastRenderedAt||now-lastRenderedAt>=renderInterval){renderer.render(scene,camera);if(terraDebug){if(lastRenderedAt){renderedFrameIntervals[frameSampleIndex]=now-lastRenderedAt;frameSampleIndex=(frameSampleIndex+1)%renderedFrameIntervals.length;frameSampleCount=Math.min(frameSampleCount+1,renderedFrameIntervals.length);}lastRenderedAt=now;}}
 if(world?.worldGenVersion&&now-lastTerrainStatsAt>1000){lastTerrainStatsAt=now;const biome=biomeAt(world.worldSeed,Math.floor(player.pos.x),Math.floor(player.pos.z),world.worldGenVersion),waterMeshes=[...streamedWater.values()].filter(entry=>entry.mesh).length;let frameMetrics='';if(terraDebug&&frameSampleCount){const sorted=Array.from(renderedFrameIntervals.subarray(0,frameSampleCount)).sort((a,b)=>a-b),percentile=q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))],mean=sorted.reduce((sum,value)=>sum+value,0)/sorted.length;frameMetrics=` · 렌더 FPS ${(1000/mean).toFixed(1)} · 프레임 p50/p95 ${percentile(.5).toFixed(1)}/${percentile(.95).toFixed(1)}ms · 삼각형 ${renderer.info.render.triangles} · 텍스처 ${renderer.info.memory.textures}`;}$('stats').textContent=`${biome} · 청크 ${streamedTerrain.size}/${desiredTerrainChunks.size} · 물 메시 ${waterMeshes} · 반경 ${configuredChunkRadius()} · 청크 생성 ${terrainBuildLastMs.toFixed(1)}/${(terrainBuildTotalMs/Math.max(1,terrainBuildCount)).toFixed(1)}ms 평균 · RAF 간격 ${terrainFrameAvgMs.toFixed(1)}ms EMA · GPU 지오메트리 ${renderer.info.memory.geometries} · draw ${renderer.info.render.calls}${frameMetrics}`;}
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
setInterval(()=>{if(!world||busy||worldPollInFlight)return;worldPollInFlight=true;const teleportVersion=devTeleportVersion;void api('/api/world').then(next=>{if(teleportVersion!==devTeleportVersion)return;const previous=world,changed=(next.crops||[]).some(c=>{const old=previous.crops?.find(item=>item.id===c.id);return !old||old.stage!==c.stage||old.progress!==c.progress;})||(next.trees||[]).some(t=>{const old=previous.trees?.find(item=>item.id===t.id);return !old||old.stage!==t.stage||old.harvested!==t.harvested;})||JSON.stringify(next.harvestedTrees||[])!==JSON.stringify(previous.harvestedTrees||[])||JSON.stringify(next.harvestedCrops||[])!==JSON.stringify(previous.harvestedCrops||[])||JSON.stringify(next.watered||{})!==JSON.stringify(previous.watered||{})||JSON.stringify(next.tilled||[])!==JSON.stringify(previous.tilled||[])||JSON.stringify(next.oreNodes||[])!==JSON.stringify(previous.oreNodes||[])||JSON.stringify(next.waterSources||[])!==JSON.stringify(previous.waterSources||[]);world=next;syncWaterEdits(previous,next);setAuthoritativeWaterState(next.player);devTimePanel?.update(next);syncWorldDrops();refreshMachineOperating();if(changed){rebuildResources();inventory();}updateInteractionUi();}).catch(()=>{}).finally(()=>{worldPollInFlight=false;});},500);
