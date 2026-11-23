import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { createIndustrialVisuals } from './industrial-visuals.js';
import { createWorkstationVisuals } from './workstation-visuals.js';
const treeTrunk=new THREE.MeshLambertMaterial({color:0x74533a}),birchTrunk=new THREE.MeshLambertMaterial({color:0xd9d0ae}),rubberTrunk=new THREE.MeshLambertMaterial({color:0x533d32});
const treeCanopy=new THREE.MeshLambertMaterial({color:0x488469}),treeTop=new THREE.MeshLambertMaterial({color:0x66a17a}),birchCanopy=new THREE.MeshLambertMaterial({color:0x78a858}),rubberCanopy=new THREE.MeshLambertMaterial({color:0x315e4c});
const veinRock=new THREE.MeshStandardMaterial({color:0x606c72,roughness:.95}),veinRockLight=new THREE.MeshStandardMaterial({color:0x879196,roughness:.9}),veinCrystal=new THREE.MeshStandardMaterial({color:0x69b5cf,emissive:0x14566c,emissiveIntensity:.48,roughness:.4});

function createOreNode(node){
 const g=new THREE.Group();g.position.set(node.x+.5,node.y,node.z+.5);g.userData.resourceId=node.id;
 const stones=[[-.20,.31,0,.42,.58,.42], [.18,.25,.15,.40,.48,.38], [.03,.23,-.22,.46,.43,.37],[-.01,.48,.06,.38,.35,.39]];
 for(let i=0;i<stones.length;i++){const [x,y,z,sx,sy,sz]=stones[i];const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(.5,0),i%2?veinRockLight:veinRock);rock.scale.set(sx*1.45,sy*1.45,sz*1.45);rock.position.set(x,y,z);rock.rotation.set(i*.31,i*.67,i*.19);rock.castShadow=true;rock.receiveShadow=true;g.add(rock);}
 for(const [x,y,z,w,h] of [[-.18,.38,.335,.16,.29],[.08,.26,.318,.13,.22],[.23,.40,.12,.1,.18]]){const crystal=new THREE.Mesh(new THREE.CylinderGeometry(w*.18,w*.52,h,5),veinCrystal);crystal.position.set(x,y,z);crystal.rotation.z=-.28;crystal.castShadow=true;g.add(crystal);}
 g.userData.crystals=g.children.filter(o=>o.material===veinCrystal);return g;
}
function createWaterSource(source){
 const g=new THREE.Group();g.position.set(source.x+.5,source.y,source.z+.5);g.userData.waterSource=true;
 const rim=new THREE.Mesh(new THREE.TorusGeometry(.34,.065,4,8),veinRockLight);
 rim.rotation.x=Math.PI/2;rim.position.y=.20;g.add(rim);
 const well=new THREE.Mesh(new THREE.CylinderGeometry(.38,.43,.19,8),veinRock);
 well.position.y=.095;g.add(well);
 const water=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.03,8),itemMats.crystal);
 water.position.y=.19;g.add(water);return g;
}

const machineMaterials={dark:new THREE.MeshStandardMaterial({color:0x263944,metalness:.42,roughness:.58})};
const workstationVisuals=createWorkstationVisuals(THREE),industrialVisuals=createIndustrialVisuals(THREE);

function makeMachineModel(type,options={}){
 return ['drill','conveyor','smelter'].includes(type)?industrialVisuals.create(type,options):workstationVisuals.create(type,options);
}

function hubBox(parent,w,h,d,color,x,y,z,glow=0){const mat=new THREE.MeshStandardMaterial({color,roughness:.9,emissive:glow,emissiveIntensity:glow?0.65:0});const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function portalModel(data){const root=new THREE.Group();root.position.set(data.x+.5,data.y,data.z+.5);root.rotation.y=data.rotation||0;root.userData.portal=data;
 hubBox(root,2.5,.16,1.6,0x263c49,0,.08,0);hubBox(root,2.15,.08,1.3,0x79aeb4,0,.18,0,0x237e91);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(1.08,.135,5,8),new THREE.MeshStandardMaterial({color:0x8ae3df,metalness:.45,roughness:.28,emissive:0x14758a,emissiveIntensity:1.2}));ring.position.set(0,1.35,-.1);ring.castShadow=true;root.add(ring);
 const veil=new THREE.Mesh(new THREE.CircleGeometry(.98,8),new THREE.MeshBasicMaterial({color:0x40b9cf,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false}));veil.position.set(0,1.35,-.12);root.add(veil);
 for(const side of [-1,1]){const jaw=hubBox(root,.22,1.65,.38,0xcc8651,side*1.09,1.02,-.12);jaw.rotation.z=-side*.15;}return root;}
function starshipPortalModel(data,surfaceHeightAt){
 const root=new THREE.Group();root.position.set(data.x+.5,data.y,data.z+.5);const east=surfaceHeightAt(data.x+4,data.z),west=surfaceHeightAt(data.x-4,data.z),north=surfaceHeightAt(data.x,data.z-5),south=surfaceHeightAt(data.x,data.z+5);root.rotation.order='YXZ';root.rotation.set(-Math.atan2(south-north,10),data.rotation||0,Math.atan2(east-west,8),'YXZ');root.userData.portal=data;
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
 const palettes=[0x53a7ad,0xd6a85d,0x71a56c,0x8b82ba],accent=palettes[index%palettes.length],g=new THREE.Group();g.position.set(shop.x,0,shop.z);
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
 return g;
}
function createStationStructure(layout){
 const {minX,maxX,minZ,maxZ}=layout.floor;
 const structure=new THREE.Group();
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
 return structure;
}
function stationLamp(d){const g=new THREE.Group();g.position.set(d.x,d.y,d.z);hubBox(g,.2,4.2,.2,0x697c7e,.5,2.1,.5);hubBox(g,1.2,.17,.42,0xe3d394,.78,4.18,.5,0x8a723c).rotation.z=.17;hubBox(g,.55,.12,.55,0x80dae1,.5,3.92,.5,0x2d7b86);return g;}

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

function createPlayerModel(){
const humanoid=new THREE.Group(),arms=[],legs=[];
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
 return {humanoid,arms,legs};
}

import { COAL_BLOCK_RECIPE } from './recipe-settings.mjs';
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

export { createPlayerModel,createOreNode,createWaterSource,makeMachineModel,makeItemModel,portalModel,starshipPortalModel,stationKiosk,stationLamp,createStationStructure,recipeCards,industrialVisuals,workstationVisuals,veinCrystal };