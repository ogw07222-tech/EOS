import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const $=id=>document.getElementById(id);
const SIZE=16;
let world,meshes=[],terrain=null,gridVisible=false,mode='place',busy=false,camYaw=.78,camPitch=.55,camDistance=8;
const scene=new THREE.Scene();scene.background=new THREE.Color('#94c5e7');scene.fog=new THREE.Fog('#94c5e7',28,68);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,110);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf4fbff,0x536477,2.2));
const light=new THREE.DirectionalLight(0xffeed2,2.5);light.position.set(-9,16,8);light.castShadow=true;
light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-19;light.shadow.camera.right=19;light.shadow.camera.top=19;light.shadow.camera.bottom=-19;scene.add(light);
const colors={top:['#70ac69','#80b875','#669c61','#89bd7b'],side:['#8e694d','#956b50','#79583f','#9a7556'],bottom:['#6b4b36','#82583f']};
function hash(x,y,z){let n=Math.imul(x+101,73856093)^Math.imul(y+211,19349663)^Math.imul(z+307,83492791);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
function has(x,y,z){const k=x+','+y+','+z;if(Object.prototype.hasOwnProperty.call(world.edits,k))return world.edits[k]==='dirt';return x>=-8&&x<8&&z>=-8&&z<8&&y>=-3&&y<0;}
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
 if(terrain){scene.remove(terrain);terrain.geometry.dispose();}
 if(outlines){scene.remove(outlines);outlines.geometry.dispose();}
 const pos=[],norm=[],col=[],index=[],outlinePos=[];
 let count=0,facesCount=0;
 for(let x=-64;x<64;x++)for(let z=-64;z<64;z++)for(let y=-8;y<=16;y++){
 if(!has(x,y,z))continue;count++;
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
 terrain=new THREE.Mesh(g,grassMat);terrain.castShadow=true;terrain.receiveShadow=true;scene.add(terrain);
 const edge= new THREE.EdgesGeometry(g,19);outlines=new THREE.LineSegments(edge,edgesMat);outlines.visible=gridVisible;scene.add(outlines);
 $('stats').textContent='블록 '+count.toLocaleString()+' · 노출면 '+facesCount.toLocaleString();
}
const humanoid=new THREE.Group();scene.add(humanoid);
const skin=new THREE.MeshLambertMaterial({color:0xe4c6a5}),suit=new THREE.MeshLambertMaterial({color:0x3e6c82}),visor=new THREE.MeshLambertMaterial({color:0x122f43}),boots=new THREE.MeshLambertMaterial({color:0x253d4a});
function box(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
box(humanoid,.62,.75,.34,suit,0,1.05,0);box(humanoid,.53,.52,.51,skin,0,1.72,0);
box(humanoid,.55,.19,.14,visor,0,1.74,-.32);for(const s of [-1,1]){box(humanoid,.20,.64,.25,suit,s*.48,1.06,0);box(humanoid,.23,.60,.27,boots,s*.18,.35,0);}
const player={pos:new THREE.Vector3(.5,0,.5),vy:0,grounded:true};
let yawMovement=0;
const keys=new Set(),touchMove=new THREE.Vector2(0,0);
window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Digit1')setMode('place');if(e.code==='Digit2')setMode('mine');});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
function setMode(s){mode=s;$('place').classList.toggle('selected',s==='place');$('mine').classList.toggle('selected',s==='mine');$('mode').textContent=s==='place'?'설치':'파괴';}
$('place').onclick=()=>setMode('place');$('mine').onclick=()=>setMode('mine');
$('jump').onclick=jump;
function jump(){if(player.grounded){player.vy=6.7;player.grounded=false;}}
function move(dt){
 const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMove.x;
 const dz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-touchMove.y;
 const length=Math.hypot(dx,dz);if(length>.05){
 const a=Math.min(length,1),sx=dx/length,sz=dz/length;
 const dirX=sx*Math.cos(camYaw)+sz*Math.sin(camYaw);
 const dirZ=sx*(-Math.sin(camYaw))+sz*Math.cos(camYaw);
 const speed=4*a;
 const proposedX=player.pos.x+dirX*speed*dt,proposedZ=player.pos.z-dirZ*speed*dt;
 // Basic solid-volume collision near the player's waist and feet.
 if(!solidForBody(proposedX,player.pos.y,player.pos.z))player.pos.x=proposedX;
 if(!solidForBody(player.pos.x,player.pos.y,proposedZ))player.pos.z=proposedZ;
 humanoid.rotation.y=Math.atan2(-dirX,dirZ);yawMovement+=dt*9;
 }
 if(keys.has('Space'))jump();
 player.vy-=17*dt;player.vy=Math.max(player.vy,-19);
 const oldY=player.pos.y,newY=oldY+player.vy*dt;
 if(player.vy<=0){
 const footX=Math.floor(player.pos.x),footZ=Math.floor(player.pos.z),blockY=Math.floor(newY-.03);
 if(oldY>=blockY+1-.1&&has(footX,blockY,footZ)&&newY<=blockY+1){player.pos.y=blockY+1;player.vy=0;player.grounded=true;}
 else{player.pos.y=newY;player.grounded=false;}
 }else{player.pos.y=newY;player.grounded=false;}
 if(player.pos.y < -13){player.pos.set(.5,3,.5);player.vy=0;notice('섬 아래로 떨어져 시작 위치로 복귀했어.');}
 humanoid.position.copy(player.pos);
}
function solidForBody(x,y,z){for(const oy of [.15,1.0])for(const ox of [-.18,.18])for(const oz of [-.18,.18])if(has(Math.floor(x+ox),Math.floor(y+oy),Math.floor(z+oz)))return true;return false;}
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
let pressStart,dragCam=false,lastPoint,touchZoom=0;
renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&e.isPrimary===false)return;pressStart={x:e.clientX,y:e.clientY,t:Date.now()};lastPoint={x:e.clientX,y:e.clientY};dragCam=false;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(!lastPoint)return;const dx=e.clientX-lastPoint.x,dy=e.clientY-lastPoint.y;lastPoint={x:e.clientX,y:e.clientY};if(Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>7)dragCam=true;if(dragCam){camYaw-=dx*.006;camPitch=Math.max(.15,Math.min(1.22,camPitch+dy*.006));}});
renderer.domElement.addEventListener('pointerup',e=>{if(pressStart&&!dragCam&&Date.now()-pressStart.t<500)interact(e.clientX,e.clientY);pressStart=null;lastPoint=null;});
renderer.domElement.addEventListener('pointercancel',()=>{pressStart=null;lastPoint=null});
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();camDistance=Math.min(17,Math.max(4,camDistance+Math.sign(e.deltaY)*.65));},{passive:false});
renderer.domElement.addEventListener('touchmove',e=>{if(e.touches.length===2){const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(touchZoom)camDistance=Math.max(4,Math.min(17,camDistance*touchZoom/d));touchZoom=d;}},{passive:true});
renderer.domElement.addEventListener('touchend',()=>touchZoom=0);
function notice(message){$('notice').textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>$('notice').textContent='',3000);}
function inventory(){ $('dirt').textContent=world.inventory.dirt;$('revision').textContent='저장 버전 '+world.revision; }
async function api(path,opts){const r=await fetch(path,{credentials:'same-origin',...opts});let payload;try{payload=await r.json()}catch{throw Error('서버 응답 오류');}if(!r.ok){const e=new Error(payload.error||'요청 실패');e.world=payload.world;throw e;}return payload;}
async function interact(sx,sy){
 if(busy||!terrain)return;
 const rect=renderer.domElement.getBoundingClientRect();
 ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);ray.setFromCamera(ndc,camera);
 const hit=ray.intersectObject(terrain,false)[0];if(!hit)return;
 if(hit.distance>20){notice('너무 먼 블록이야.');return;}
 const normal=hit.face.normal.clone();const point=hit.point.clone().addScaledVector(normal,mode==='place'?.015:-.015);
 const x=Math.floor(point.x),y=Math.floor(point.y),z=Math.floor(point.z);
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5){notice('가까운 블록만 편집할 수 있어.');return;}
 if(mode==='place'&&Math.abs(center.x-player.pos.x)<.65&&Math.abs(center.z-player.pos.z)<.65&&center.y>=player.pos.y&&center.y<=player.pos.y+1.8){notice('플레이어 위치에는 설치할 수 없어.');return;}
 busy=true;
 try{const data=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:mode,x,y,z,revision:world.revision})});
 world=data.world;inventory();rebuild();notice(mode==='place'?'흙 블록 설치 완료 · 서버에 저장됨':'흙 블록 회수 완료 · 서버에 저장됨');
 }catch(e){if(e.world){world=e.world;inventory();rebuild();}notice('작업 실패: '+e.message);}finally{busy=false;}
}
function joystick(){
 const area=$('joystick'),knob=$('knob');let id=null;
 const update=e=>{const r=area.getBoundingClientRect();const x=Math.max(-1,Math.min(1,(e.clientX-r.left-r.width/2)/(r.width*.34))),y=Math.max(-1,Math.min(1,(e.clientY-r.top-r.height/2)/(r.height*.34)));touchMove.set(x,y);knob.style.transform='translate('+(x*31)+'px,'+(y*31)+'px)';};
 area.addEventListener('pointerdown',e=>{id=e.pointerId;area.setPointerCapture(id);update(e);});
 area.addEventListener('pointermove',e=>{if(e.pointerId===id)update(e);});
 const stop=e=>{if(e.pointerId!==id)return;id=null;touchMove.set(0,0);knob.style.transform='translate(0,0)'};
 area.addEventListener('pointerup',stop);area.addEventListener('pointercancel',stop);
}joystick();
let then=performance.now();
function loop(now){requestAnimationFrame(loop);const dt=Math.min(.033,(now-then)/1000);then=now;
 if(world)move(dt);
 const target=player.pos.clone().add(new THREE.Vector3(0,1.15,0));
 camera.position.set(target.x+camDistance*Math.sin(camYaw)*Math.cos(camPitch),target.y+camDistance*Math.sin(camPitch)+1.2,target.z+camDistance*Math.cos(camYaw)*Math.cos(camPitch));camera.lookAt(target);
 renderer.render(scene,camera);
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
$('grid').onclick=()=>{gridVisible=!gridVisible;$('grid').classList.toggle('selected',gridVisible);if(outlines)outlines.visible=gridVisible;};
async function init(){try{world=await api('/api/world');rebuild();inventory();$('loading').hidden=true;notice('개인 섬을 불러왔어. 블록을 눌러 설치·파괴해봐.');}catch(e){$('loading').textContent='서버 연결 실패: '+e.message+' · node server.mjs로 실행해야 해.';}}
requestAnimationFrame(loop);init();
