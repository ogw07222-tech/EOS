import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const $=id=>document.getElementById(id);
const SIZE=16;
// Simulation units are metres: one voxel grid cell measures 1 m on each axis.
// WORLD_SCALE is a renderer-only conversion; both blocks and the avatar share it.
const BLOCK_METERS=1;
const PLAYER_HEIGHT_METERS=1.78;
const PLAYER_HALF_WIDTH_METERS=0.34;
const WORLD_SCALE=3.75;
let world,meshes=[],terrain=null,gridVisible=false,mode='mine',equipped='shovel',busy=false,camYaw=.78,camPitch=.55,camDistance=14.5;
const scene=new THREE.Scene();scene.background=new THREE.Color('#94c5e7');scene.fog=new THREE.Fog('#94c5e7',90,240);
const worldRoot=new THREE.Group();worldRoot.scale.setScalar(WORLD_SCALE);scene.add(worldRoot);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.12,260);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf4fbff,0x536477,2.2));
const light=new THREE.DirectionalLight(0xffeed2,2.5);light.position.set(-22,40,20);light.castShadow=true;
light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-70;light.shadow.camera.right=70;light.shadow.camera.top=70;light.shadow.camera.bottom=-70;scene.add(light);
const colors={top:['#70ac69','#80b875','#669c61','#89bd7b'],side:['#8e694d','#956b50','#79583f','#9a7556'],bottom:['#6b4b36','#82583f'],sand:['#d9be81','#e9d39c','#c9ad72','#e0c68c']};
function hash(x,y,z){let n=Math.imul(x+101,73856093)^Math.imul(y+211,19349663)^Math.imul(z+307,83492791);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
function blockType(x,y,z){const k=x+','+y+','+z;if(Object.prototype.hasOwnProperty.call(world.edits,k))return world.edits[k];return x>=-8&&x<8&&z>=-8&&z<8&&y>=-3&&y<0?'dirt':null;}
function has(x,y,z){return blockType(x,y,z)!==null;}
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
let outlines;
function rebuild(){
 if(terrain){worldRoot.remove(terrain);terrain.geometry.dispose();}
 if(outlines){worldRoot.remove(outlines);outlines.geometry.dispose();}
 const pos=[],norm=[],col=[],index=[],outlinePos=[];
 let count=0,facesCount=0;
 // Render actual solid blocks only; avoid scanning the entire 128×128×25 edit envelope.
 const solids=new Set();
 for(let x=-8;x<8;x++)for(let z=-8;z<8;z++)for(let y=-3;y<0;y++)solids.add(x+','+y+','+z);
 for(const [k,value] of Object.entries(world.edits)){if(value==='dirt'||value==='sand')solids.add(k);else solids.delete(k);}
 for(const k of solids){
 const [x,y,z]=k.split(',').map(Number);count++;
 for(const f of faces){
 const [dx,dy,dz]=f.d;if(has(x+dx,y+dy,z+dz))continue;
 const h=hash(x,y,z),shade=blockType(x,y,z)==='sand'?colors.sand:f.d[1]===1?colors.top:f.d[1]===-1?colors.bottom:colors.side;
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
 $('stats').textContent='블록 '+count.toLocaleString()+' · 노출면 '+facesCount.toLocaleString();
}
// Harvestable trees are linked to server resource nodes.
const treeTrunk=new THREE.MeshLambertMaterial({color:0x74533a});
const treeCanopy=new THREE.MeshLambertMaterial({color:0x488469});
const treeTop=new THREE.MeshLambertMaterial({color:0x66a17a});
function makeTree(x,z,scale=1){
 const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(scale);worldRoot.add(g);
 const tr=new THREE.Mesh(new THREE.BoxGeometry(.63,2.4,.63),treeTrunk);tr.position.y=1.2;tr.castShadow=true;g.add(tr);
 for(const [dx,dy,dz,w,h,d,mat] of [[0,2.6,0,2.3,1.2,2.3,treeCanopy],[-.4,3.35,.2,1.7,1.1,1.9,treeTop],[.4,2.85,-.5,1.8,1,1.4,treeCanopy]]){
 const leaf=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);leaf.position.set(dx,dy,dz);leaf.castShadow=true;g.add(leaf);
 }
 return g;
}
const resourceGroups=[],resourceHitMeshes=[];
function syncNodes(){
 for(const g of resourceGroups){worldRoot.remove(g);if(g.userData.nodeId?.startsWith('stone')||g.userData.nodeId?.startsWith('iron'))g.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();obj.material.dispose();}});}
 resourceGroups.length=0;resourceHitMeshes.length=0;
 if(!world?.nodeDefs)return;
 for(const [id,def] of Object.entries(world.nodeDefs)){
  if((world.nodes[id]??def.capacity)<=0)continue;
  let group;
  if(def.kind==='wood')group=makeTree(def.x,def.z,id==='tree-a'?1:.9);
  else{
   group=new THREE.Group();group.position.set(def.x,0,def.z);
   const mat=new THREE.MeshLambertMaterial({color:def.kind==='ironOre'?0x927b68:0x858d8e});
   const ore=new THREE.Mesh(new THREE.DodecahedronGeometry(def.kind==='ironOre'?.6:.7,0),mat);
   ore.position.y=.63;ore.castShadow=true;group.add(ore);worldRoot.add(group);
  }
  group.userData.nodeId=id;
  group.traverse(obj=>{if(obj.isMesh){obj.userData.nodeId=id;resourceHitMeshes.push(obj);}});
  resourceGroups.push(group);
 }
}
const humanoid=new THREE.Group();worldRoot.add(humanoid);
const skin=new THREE.MeshLambertMaterial({color:0xe4c6a5}),suit=new THREE.MeshLambertMaterial({color:0x3e6c82}),visor=new THREE.MeshLambertMaterial({color:0x122f43}),boots=new THREE.MeshLambertMaterial({color:0x253d4a});
function box(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
// Ordinary adult proportions in metres: 1.78 m tall, ~0.68 m arm-to-arm width.
// Feet sit at y=0, and the top of the head is exactly PLAYER_HEIGHT_METERS.
box(humanoid,.44,.65,.25,suit,0,1.105,0); // torso: 0.78–1.43 m
box(humanoid,.28,.28,.27,skin,0,1.64,0); // head: 1.50–1.78 m
box(humanoid,.23,.09,.05,visor,0,1.65,-.16);
// Rotate arms around shoulders and legs around the hips (not around mesh centres).
const arms=[],legs=[];
for(const side of [-1,1]){
 const arm=new THREE.Group();arm.position.set(side*.28,1.41,0);humanoid.add(arm);
 box(arm,.12,.60,.19,suit,0,-.30,0);arms.push(arm);
 const leg=new THREE.Group();leg.position.set(side*.125,.78,0);humanoid.add(leg);
 box(leg,.18,.78,.22,boots,0,-.39,0);legs.push(leg);
}
// Tools follow the hand as its arm swings.
const toolDisplay=new THREE.Group();toolDisplay.position.set(0,-.49,-.19);arms[0].add(toolDisplay);
let gaitPhase=0;
function animateWalk(dt,moving){
 const amplitude=moving&&player.grounded?.36:0;
 if(amplitude)gaitPhase+=dt*9;
 for(let i=0;i<2;i++){
  const sign=i===0?1:-1;
  const targetLeg=Math.sin(gaitPhase)*amplitude*sign;
  const targetArm=-targetLeg*.75;
  legs[i].rotation.x=THREE.MathUtils.damp(legs[i].rotation.x,targetLeg,12,dt);
  arms[i].rotation.x=THREE.MathUtils.damp(arms[i].rotation.x,targetArm,12,dt);
 }
}
const shaftMat=new THREE.MeshLambertMaterial({color:0x8f643d}),metalMat=new THREE.MeshLambertMaterial({color:0xa7bcc5});
const shovelMat=new THREE.MeshLambertMaterial({color:0x85979d});
const heldDirtMat=new THREE.MeshLambertMaterial({color:0x866447}),heldSandMat=new THREE.MeshLambertMaterial({color:0xd5bf83});
function equipVisual(kind){
 while(toolDisplay.children.length){const child=toolDisplay.children[0];toolDisplay.remove(child);child.geometry?.dispose();}
 if(kind==='dirt'||kind==='sand'){
  toolDisplay.visible=true;
  const cube=new THREE.Mesh(new THREE.BoxGeometry(.26,.26,.26),kind==='sand'?heldSandMat:heldDirtMat);
  cube.castShadow=true;toolDisplay.add(cube);return;
 }
 if(!['pickaxe','shovel','axe'].includes(kind)){toolDisplay.visible=false;return;}
 toolDisplay.visible=true;
 const shaft=new THREE.Mesh(new THREE.BoxGeometry(.055,.58,.055),shaftMat);shaft.position.y=-.04;shaft.castShadow=true;toolDisplay.add(shaft);
 const head=kind==='pickaxe'?new THREE.BoxGeometry(.43,.08,.10):kind==='axe'?new THREE.BoxGeometry(.27,.24,.095):new THREE.BoxGeometry(.19,.24,.06);
 const tip=new THREE.Mesh(head,kind==='shovel'?shovelMat:metalMat);
 tip.position.set(kind==='shovel'?0:.075,.22,0);tip.castShadow=true;toolDisplay.add(tip);
}
equipVisual('shovel');
const player={pos:new THREE.Vector3(.5,0,.5),vy:0,grounded:true};
let yawMovement=0;
const keys=new Set(),touchMove=new THREE.Vector2(0,0);
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Space'&&!e.repeat)jump();keys.add(e.code);if(/^Digit[1-8]$/.test(e.code))setMode(hotbarSlots[Number(e.code.slice(-1))-1]);if(e.code==='KeyE'&&!e.repeat)toggleInventory();if(e.code==='Escape')closeInventory();});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
const hotbarSlots=['pickaxe','shovel','axe','dirt','sand','stone','ironOre','wood'];
const slotNames={pickaxe:'곡괭이',shovel:'삽',axe:'도끼',dirt:'흙',sand:'모래',stone:'돌',ironOre:'철광석',wood:'목재'};
const toolSlots=new Set(['pickaxe','shovel','axe']);
const placeableSlots=new Set(['dirt','sand']);
function setMode(s){
 if(!hotbarSlots.includes(s))return;
 cancelMine();equipped=s;
 mode=placeableSlots.has(s)?'place':toolSlots.has(s)?'mine':'none';
 for(const key of hotbarSlots)$('slot-'+key).classList.toggle('selected',key===s);
 $('equipName').textContent=slotNames[s];
 equipVisual(s);if(world)renderInventory();
}
for(const slot of hotbarSlots)$('slot-'+slot).onclick=()=>setMode(slot);
function closeInventory(){$('inventoryPanel').hidden=true;$('inventoryButton').setAttribute('aria-expanded','false');}
function toggleInventory(){
 const panel=$('inventoryPanel');panel.hidden=!panel.hidden;
 $('inventoryButton').setAttribute('aria-expanded',String(!panel.hidden));
 if(!panel.hidden)renderInventory();
}
$('inventoryButton').onclick=toggleInventory;
$('inventoryClose').onclick=closeInventory;
function renderInventory(){
 if(!world)return;
 const list=$('inventoryItems');list.replaceChildren();
 for(const key of hotbarSlots){
  const button=document.createElement('button');button.className='inventory-item';
  const amount=toolSlots.has(key)?(world.tools?.includes(key)?'보유':'없음'):'×'+(world.inventory[key]||0);
  button.textContent=slotNames[key]+'  '+amount;
  button.classList.toggle('selected',key===equipped);
  button.disabled=toolSlots.has(key)&&!world.tools?.includes(key);
  button.onclick=()=>{setMode(key);closeInventory();};
  list.append(button);
 }
}
$('jump').onclick=jump;
function jump(){if(player.grounded){player.vy=6.7;player.grounded=false;}}
function move(dt){
 const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMove.x;
 const dz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-touchMove.y;
 const length=Math.hypot(dx,dz);if(length>.05){
 const a=Math.min(length,1),sx=dx/length,sz=dz/length;
 const dirX=sx*Math.cos(camYaw)-sz*Math.sin(camYaw);
 const dirZ=-sx*Math.sin(camYaw)-sz*Math.cos(camYaw);
 const speed=4*a;
 const proposedX=player.pos.x+dirX*speed*dt,proposedZ=player.pos.z+dirZ*speed*dt;
 // Basic solid-volume collision near the player's waist and feet.
 if(!solidForBody(proposedX,player.pos.y,player.pos.z))player.pos.x=proposedX;
 if(!solidForBody(player.pos.x,player.pos.y,proposedZ))player.pos.z=proposedZ;
 humanoid.rotation.y=Math.atan2(-dirX,-dirZ);yawMovement+=dt*9;
 }
 
 player.vy-=17*dt;player.vy=Math.max(player.vy,-19);
 const oldY=player.pos.y,newY=oldY+player.vy*dt;
 if(player.vy<=0){
 const footX=Math.floor(player.pos.x),footZ=Math.floor(player.pos.z),blockY=Math.floor(newY-.03);
 if(oldY>=blockY+1-.1&&has(footX,blockY,footZ)&&newY<=blockY+1){player.pos.y=blockY+1;player.vy=0;player.grounded=true;}
 else{player.pos.y=newY;player.grounded=false;}
 }else{player.pos.y=newY;player.grounded=false;}
 if(player.pos.y < -13){player.pos.set(.5,3,.5);player.vy=0;notice('섬 아래로 떨어져 시작 위치로 복귀했어.');}
 humanoid.position.copy(player.pos);
 animateWalk(dt,length>.05);
}
function solidForBody(x,y,z){for(const oy of [.1,.9,PLAYER_HEIGHT_METERS-.08])for(const ox of [-PLAYER_HALF_WIDTH_METERS,PLAYER_HALF_WIDTH_METERS])for(const oz of [-.19,.19])if(has(Math.floor(x+ox),Math.floor(y+oy),Math.floor(z+oz)))return true;return false;}
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
const MINING_DURATION_MS=1200;
let pressStart=null,dragCam=false,lastPoint=null,touchZoom=0,holdMining=null;
const miningHud=$('mining'),miningFill=$('miningFill');
function updateMiningMarker(){
 if(!holdMining||!world)return;
 const cell=holdMining.cell;
 const origin=cell.kind==='node'?new THREE.Vector3(cell.x,cell.tool==='axe'?2.65:1.3,cell.z):new THREE.Vector3(cell.x+.5,cell.y+1.18,cell.z+.5);
 const projected=worldRoot.localToWorld(origin).project(camera);
 if(projected.z< -1||projected.z>1){miningHud.hidden=true;return;}
 const rect=renderer.domElement.getBoundingClientRect();
 miningHud.hidden=false;
 miningHud.style.left=(rect.left+(projected.x+1)*rect.width/2)+'px';
 miningHud.style.top=(rect.top+(1-projected.y)*rect.height/2)+'px';
}
function cancelMine(){
 holdMining=null;
 miningHud.hidden=true;
 miningFill.style.width='0%';
}
function targetBlock(sx,sy,action){
 if(!world||!terrain)return null;
 const rect=renderer.domElement.getBoundingClientRect();
 ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);
 ray.setFromCamera(ndc,camera);
 const hits=ray.intersectObjects([terrain,...resourceHitMeshes],false);
 const hit=hits[0];if(!hit||hit.distance>75)return null;
 if(hit.object.userData.nodeId){
  const nodeId=hit.object.userData.nodeId,def=world.nodeDefs[nodeId];
  if(action==='place')return null;
  return {kind:'node',nodeId,tool:def.tool,x:def.x,y:0,z:def.z};
 }
 const normal=hit.face.normal;
 const point=worldRoot.worldToLocal(hit.point.clone()).addScaledVector(normal,action==='place'?.015:-.015);
 const x=Math.floor(point.x),y=Math.floor(point.y),z=Math.floor(point.z);
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5)return null;
 return {kind:'block',x,y,z};
}
function updateMine(now){
 if(!holdMining||holdMining.done)return;
 const cell=holdMining.cell;
 if(!world||busy||cell.kind==='node'&&(world.nodes[cell.nodeId]??world.nodeDefs[cell.nodeId].capacity)<=0||cell.kind==='block'&&(!has(cell.x,cell.y,cell.z)||equipped!=='shovel')){cancelMine();return;}
 const elapsed=Math.max(0,now-holdMining.startedAt);
 miningFill.style.width=Math.min(100,elapsed/MINING_DURATION_MS*100).toFixed(1)+'%';
 updateMiningMarker();
 if(elapsed>=MINING_DURATION_MS){
  const cell=holdMining.cell;
  holdMining.done=true;cancelMine();
  void interactCell(cell,cell.kind==='node'?'harvest':'mine');
 }
}
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'&&!e.isPrimary){cancelMine();return;}
 pressStart={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};
 lastPoint={x:e.clientX,y:e.clientY};dragCam=false;
 renderer.domElement.setPointerCapture(e.pointerId);
 if(mode==='mine'&&!busy){
  const cell=targetBlock(e.clientX,e.clientY,'mine');
  if(cell){
   const needed=cell.kind==='node'?cell.tool:blockType(cell.x,cell.y,cell.z)==='dirt'||blockType(cell.x,cell.y,cell.z)==='sand'?'shovel':'pickaxe';
   if(equipped!==needed){notice('이 자원에는 '+slotNames[needed]+'가 필요해.');return;}
   holdMining={id:e.pointerId,cell,startedAt:performance.now(),done:false};
   miningHud.hidden=false;miningFill.style.width='0%';updateMiningMarker();
  }
 }
});
renderer.domElement.addEventListener('pointermove',e=>{
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
 if(mode==='place'&&!dragCam&&performance.now()-pressStart.t<500)void interact(e.clientX,e.clientY);
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
function inventory(){
 for(const item of ['dirt','sand','stone','ironOre','wood'])$('count-'+item).textContent=world.inventory[item]||0;
 renderInventory();
}
function rewardToast(item,amount){
 if(!item||amount<=0)return;
 const line=document.createElement('div');line.className='pickup';
 line.textContent=slotNames[item]+' ×'+amount;
 const tray=$('pickups');tray.append(line);
 while(tray.children.length>4)tray.firstElementChild.remove();
 setTimeout(()=>line.remove(),2100);
}
async function api(path,opts){const r=await fetch(path,{credentials:'same-origin',...opts});let payload;try{payload=await r.json()}catch{throw Error('서버 응답 오류');}if(!r.ok){const e=new Error(payload.error||'요청 실패');e.world=payload.world;throw e;}return payload;}
async function interact(sx,sy){
 const cell=targetBlock(sx,sy,'place');
 if(!cell){notice('가까운 블록을 선택해줘.');return;}
 return interactCell(cell,'place');
}
async function interactCell(cell,action){
 if(busy||!world)return;
 const {x,y,z}=cell;
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5){notice('가까운 블록만 편집할 수 있어.');return;}
 if(action==='place'&&Math.abs(center.x-player.pos.x)<.65&&Math.abs(center.z-player.pos.z)<.65&&center.y>=player.pos.y&&center.y<=player.pos.y+1.8){notice('플레이어 위치에는 설치할 수 없어.');return;}
 if(action==='mine'&&!has(x,y,z))return;
 if(action==='harvest'&&!world.nodeDefs[cell.nodeId])return;
 if(action==='harvest'&&equipped!==world.nodeDefs[cell.nodeId].tool){notice('올바른 도구를 장착해줘.');return;}
 busy=true;
 try{const data=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:action,x,y,z,nodeId:cell.nodeId,tool:['dirt','sand'].includes(equipped)?'shovel':equipped,item:['dirt','sand'].includes(equipped)?equipped:null,revision:world.revision})});
 const previous=world.inventory;world=data.world;inventory();rebuild();syncNodes();
 if(action!=='place')for(const key of ['dirt','sand','stone','ironOre','wood'])rewardToast(key,(world.inventory[key]||0)-(previous[key]||0));
 }catch(e){if(e.world){world=e.world;inventory();rebuild();syncNodes();}notice('작업 실패: '+e.message);}finally{busy=false;}
}
function joystick(){
 const area=$('joystick'),knob=$('knob');let id=null;
 const update=e=>{const r=area.getBoundingClientRect();const rawX=(e.clientX-r.left-r.width/2)/(r.width*.34),rawY=(e.clientY-r.top-r.height/2)/(r.height*.34);const len=Math.hypot(rawX,rawY);const scale=len>1?1/len:1;const x=rawX*scale,y=rawY*scale;touchMove.set(x,y);knob.style.transform='translate('+(x*31)+'px,'+(y*31)+'px)';};
 area.addEventListener('pointerdown',e=>{id=e.pointerId;area.setPointerCapture(id);update(e);});
 area.addEventListener('pointermove',e=>{if(e.pointerId===id)update(e);});
 const stop=e=>{if(e.pointerId!==id)return;id=null;touchMove.set(0,0);knob.style.transform='translate(0,0)'};
 area.addEventListener('pointerup',stop);area.addEventListener('pointercancel',stop);
}joystick();
let then=performance.now();
function loop(now){requestAnimationFrame(loop);const dt=Math.min(.033,(now-then)/1000);then=now;
 if(world)move(dt);
 updateMine(now);
 const target=player.pos.clone().add(new THREE.Vector3(0,PLAYER_HEIGHT_METERS*.54,0)).multiplyScalar(WORLD_SCALE);
 camera.position.set(target.x+camDistance*Math.sin(camYaw)*Math.cos(camPitch),target.y+camDistance*Math.sin(camPitch)+2.0,target.z+camDistance*Math.cos(camYaw)*Math.cos(camPitch));camera.lookAt(target);
 updateMiningMarker();
 renderer.render(scene,camera);
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
$('grid').onclick=()=>{gridVisible=!gridVisible;$('grid').classList.toggle('selected',gridVisible);if(outlines)outlines.visible=gridVisible;};
async function init(){try{world=await api('/api/world');rebuild();syncNodes();inventory();setMode('shovel');$('loading').hidden=true;}catch(e){$('loading').textContent='서버 연결 실패: '+e.message+' · node server.mjs로 실행해야 해.';}}
requestAnimationFrame(loop);init();
