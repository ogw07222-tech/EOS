import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { RESOURCE_LABELS, TOOL_NAMES, TREE_SPECIES } from './resource-catalog.mjs';
import { CROP_TYPES, MAX_CROP_STAGE } from './crop-rules.mjs';
import { SHOP_HUB_LAYOUT } from './hub-world.mjs';
import { createCropVisual, createTreeVisual } from './nature-visuals.js';
import { createFarmerNpc } from './farmer-npc.js';
import { blockIds, createPlayerModel, createOreNode, createWaterSource, makeMachineModel, makeItemModel, portalModel, starshipPortalModel, stationKiosk, stationLamp, createStationStructure, recipeCards } from './model-assets.js';

const $=id=>document.getElementById(id);
const canvas=document.querySelector('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(38,1,.01,1000);
scene.add(new THREE.HemisphereLight(0xfff9e8,0x9aafa9,2.1));
const key=new THREE.DirectionalLight(0xffeedb,2.5);key.position.set(-3,5,4);scene.add(key);
const origin={x:0,y:0,z:0},entries=[];
function add(category,id,name,build){entries.push({category,id,name:name||id,build});}
const blockLabels={grass:'잔디',farmland:'경작지',water:'물',gravel:'자갈',brick:'벽돌',pale_stone:'밝은 석재',coal_ore:'석탄 광석',birch_wood:'자작나무 목재',rubber_wood:'고무나무 목재'};
for(const id of blockIds)add('블록',id,blockLabels[id]||RESOURCE_LABELS[id],()=>makeItemModel(id));
for(const [id,name] of Object.entries(TOOL_NAMES))add('도구',id,name,()=>makeItemModel(id));
for(const [id,name] of Object.entries({...RESOURCE_LABELS,iron_ingot:'철 주괴'}))if(!blockIds.has(id))add('아이템',id,name,()=>makeItemModel(id));
for(const {id,name} of [...recipeCards.filter(r=>!r.tool&&!r.output),{id:'t1_bench',name:'T1 제작대'}])add('설비',id,name,()=>makeMachineModel(id));
add('설비','conveyor_uphill','경사 컨베이어',()=>makeMachineModel('conveyor',{uphill:true}));
for(const species of TREE_SPECIES)for(let stage=0;stage<=3;stage++)add('자연물',species+'_'+stage,({oak:'참나무',birch:'자작나무',rubber:'고무나무'}[species]||species)+' · '+(stage+1)+'단계',()=>createTreeVisual(THREE,{...origin,species,stage}));
for(const cropType of CROP_TYPES)for(let stage=1;stage<=MAX_CROP_STAGE;stage++)add('자연물',cropType+'_'+stage,RESOURCE_LABELS[cropType]+' · '+stage+'단계',()=>createCropVisual(THREE,{...origin,cropType,stage}));
add('자연물','ore_node','채굴 광맥',()=>createOreNode({...origin,remaining:1}));
add('자연물','well','급수원',()=>createWaterSource(origin));
add('인물','player','탐사 대원',()=>createPlayerModel().humanoid);
add('인물','farmer','농부',()=>createFarmerNpc(THREE).group);
add('허브','starship','케스트렐 탐사선',()=>starshipPortalModel(origin,()=>0));
add('허브','portal','귀환 포탈',()=>portalModel(origin));
add('허브','station','우주정거장',()=>createStationStructure(SHOP_HUB_LAYOUT));
for(const [i,shop] of SHOP_HUB_LAYOUT.shops.entries())add('허브',shop.id,({market:'농부 시장',exchange:'제작품 거래소',greenhouse:'온실',expedition:'탐사 갑판'})[shop.type],()=>stationKiosk(shop,i));
add('허브','lamp','정거장 조명',()=>stationLamp(origin));

const pivot=new THREE.Group();scene.add(pivot);
let selected=null,radius=1,yaw=.72,pitch=.32,zoom=1;
let renderPending=false,lastWidth=0,lastHeight=0;
function requestDraw(){
 if(renderPending)return;
 renderPending=true;
 requestAnimationFrame(()=>{renderPending=false;draw();});
}
function draw(){
 const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
 if(w!==lastWidth||h!==lastHeight){
  renderer.setSize(w,h,false);camera.aspect=w/h;lastWidth=w;lastHeight=h;
 }
 const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
 const distance=radius*1.13/Math.sin(halfFov)/zoom;
 camera.near=radius*.007;camera.far=distance+radius*6;camera.updateProjectionMatrix();
 camera.position.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(distance);
 camera.lookAt(0,0,0);renderer.render(scene,camera);
}
function reset(){yaw=.72;pitch=.32;zoom=1;requestDraw();}
function select(entry){
 // Release instance buffers. Facility batches are owned by their factories.
 for(const root of [...pivot.children]){
  pivot.remove(root);
  root.traverse(o=>{const g=o.geometry;if(g&&!g.userData.terraIndustrialShared&&!g.userData.terraWorkstationShared)g.dispose();
   if(['허브','인물'].includes(selected?.category)&&selected?.id!=='player')o.material?.dispose();
  });
 }
 selected=entry;
 if(!entry){$('kind').textContent=$('title').textContent=$('modelId').textContent='';$('status').textContent='검색 결과가 없습니다.';requestDraw();return;}
 const model=entry.build();
 const bounds=new THREE.Box3().setFromObject(model);
 const center=bounds.getCenter(new THREE.Vector3());
 model.position.sub(center);pivot.add(model);radius=Math.max(.03,bounds.getSize(new THREE.Vector3()).length()/2);
 $('kind').textContent=entry.category;$('title').textContent=entry.name;$('modelId').textContent=entry.id;$('status').textContent='';
 for(const button of $('list').children)button.setAttribute('aria-pressed',String(button.dataset.key===entry.category+'/'+entry.id));
 reset();
}
for(const category of new Set(entries.map(e=>e.category)))$('category').add(new Option(category,category));
function filter(){
 const q=$('search').value.trim().toLowerCase(),category=$('category').value;
 const matches=entries.filter(e=>(!category||e.category===category)&&(e.name+' '+e.id).toLowerCase().includes(q));
 $('list').replaceChildren();$('count').textContent=matches.length+' / '+entries.length;
 for(const e of matches){const b=document.createElement('button');b.textContent=e.name;b.dataset.key=e.category+'/'+e.id;b.onclick=()=>select(e);$('list').append(b);}
 select(matches.includes(selected)?selected:matches.find(e=>e.id==='starship')||matches[0]);
}
const fingers=new Map();
function spread(){const [a,b]=fingers.values();return Math.hypot(a.x-b.x,a.y-b.y);}
function scale(ratio){zoom=THREE.MathUtils.clamp(zoom*ratio,.45,4);}
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});};
canvas.onpointermove=e=>{const p=fingers.get(e.pointerId);if(!p)return;
 const before=fingers.size===2?spread():0;fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(fingers.size===1){yaw-=(e.clientX-p.x)*.009;pitch=THREE.MathUtils.clamp(pitch+(e.clientY-p.y)*.009,-1.52,1.52);}
 else if(before>0)scale(spread()/before);requestDraw();
};
canvas.onlostpointercapture=e=>fingers.delete(e.pointerId);
canvas.addEventListener('wheel',e=>{e.preventDefault();scale(Math.exp(-.001*e.deltaY));requestDraw();},{passive:false});
$('search').oninput=$('category').onchange=filter;$('reset').onclick=reset;
new ResizeObserver(requestDraw).observe(canvas);filter();
