import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const $=id=>document.getElementById(id);
const SIZE=10;
// Simulation units are metres: one voxel grid cell measures 1 m on each axis.
// WORLD_SCALE is a renderer-only conversion; both blocks and the avatar share it.
const BLOCK_METERS=1;
const PLAYER_HEIGHT_METERS=1.78;
const PLAYER_HALF_WIDTH_METERS=0.34;
const WORLD_SCALE=3.75;
let world,meshes=[],terrain=null,gridVisible=false,mode='place',busy=false,placingMachine=null,machineRotation=0,selectedSlot=1,selectedTool='wood_axe',camYaw=.78,camPitch=.55,camDistance=14.5;
let devTimePanel=null;
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
function hash(x,y,z){let n=Math.imul(x+101,73856093)^Math.imul(y+211,19349663)^Math.imul(z+307,83492791);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
function has(x,y,z){const k=x+','+y+','+z;if(Object.prototype.hasOwnProperty.call(world.edits,k))return world.edits[k]==='dirt';const half=(world?.islandSize||SIZE)/2;return x>=-half&&x<half&&z>=-half&&z<half&&y>=-3&&y<0;}
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
 // Render the saved island size plus actual solid edits only.
 const solids=new Set();
 const half=world.islandSize/2;
 for(let x=-half;x<half;x++)for(let z=-half;z<half;z++)for(let y=-3;y<0;y++)solids.add(x+','+y+','+z);
 for(const [k,value] of Object.entries(world.edits)){if(value==='dirt')solids.add(k);else solids.delete(k);}
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
}
// Lightweight stylized voxel trees; decoration only, no resource collection yet.
const treeTrunk=new THREE.MeshLambertMaterial({color:0x74533a});
const treeCanopy=new THREE.MeshLambertMaterial({color:0x488469});
const treeTop=new THREE.MeshLambertMaterial({color:0x66a17a});
const wheatStem=new THREE.MeshStandardMaterial({color:0x72954d,roughness:.9}),wheatGrain=new THREE.MeshStandardMaterial({color:0xd8b75b,roughness:.8});
const veinRock=new THREE.MeshStandardMaterial({color:0x606c72,roughness:.95}),veinRockLight=new THREE.MeshStandardMaterial({color:0x879196,roughness:.9}),veinCrystal=new THREE.MeshStandardMaterial({color:0x69b5cf,emissive:0x14566c,emissiveIntensity:.48,roughness:.4});
let treeGroups=[],cropGroups=[],oreGroups=[],resourceRoots=[];
function makeTree(tree){
 const {id,x,z,scale=1}=tree;const g=new THREE.Group();g.position.set(x,tree.y||0,z);g.scale.setScalar(scale);worldRoot.add(g);resourceRoots.push(g);
 g.userData.resourceId=id;treeGroups.push(g);
 const stage=Number.isInteger(tree.stage)?tree.stage:3;
 if(stage<3){const seedStage=Math.max(0,stage);const stem=new THREE.Mesh(new THREE.BoxGeometry(.09+seedStage*.04,.28+seedStage*.25,.09+seedStage*.04),treeTrunk);stem.position.y=stem.geometry.parameters.height/2;stem.castShadow=true;g.add(stem);for(let i=0;i<seedStage+1;i++){const leaf=new THREE.Mesh(new THREE.BoxGeometry(.18+seedStage*.1,.12+seedStage*.08,.18+seedStage*.1),i%2?treeTop:treeCanopy);leaf.position.set((i%2-.5)*.12,.18+seedStage*.22+i*.1,0);leaf.castShadow=true;g.add(leaf);}return;}
 const tr=new THREE.Mesh(new THREE.BoxGeometry(.63,2.4,.63),treeTrunk);tr.position.y=1.2;tr.castShadow=true;g.add(tr);
 for(const [dx,dy,dz,w,h,d,mat] of [[0,2.6,0,2.3,1.2,2.3,treeCanopy],[-.4,3.35,.2,1.7,1.1,1.9,treeTop],[.4,2.85,-.5,1.8,1,1.4,treeCanopy]]){
 const leaf=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);leaf.position.set(dx,dy,dz);leaf.castShadow=true;g.add(leaf);
 }
}
function makeWheat(crop){
 const g=new THREE.Group();g.position.set(crop.x+.5,crop.y,crop.z+.5);g.userData.resourceId=crop.id;worldRoot.add(g);resourceRoots.push(g);cropGroups.push(g);
 const stage=Math.max(1,Math.min(4,crop.stage||4));const heights=[0,.20,.43,.68,1.02],hScale=heights[stage];
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
function rebuildFarmVisuals(){for(const o of farmRoots){worldRoot.remove(o);o.geometry?.dispose();o.material?.dispose();}farmRoots.length=0;for(const [x,y,z] of world.tilled||[]){const wet=(world.watered?.[[x,y,z].join(',')]||0)>Date.now();const m=new THREE.Mesh(new THREE.BoxGeometry(.91,.035,.91),new THREE.MeshLambertMaterial({color:wet?0x604d37:0x74583d}));m.position.set(x+.5,y+.018,z+.5);m.receiveShadow=true;worldRoot.add(m);farmRoots.push(m);}}
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
 for(const crop of world.crops||[]){makeWheat(crop);}
 for(const node of world.oreNodes||[]){makeOreNode(node);}
 for(const source of world.waterSources||(world.worldVersion>=3?[{x:4,y:0,z:4}]:[])){makeWaterSource(source);}
 rebuildFarmVisuals();updateResources();
}
function updateResources(){
 for(const g of treeGroups){const tree=world.trees.find(t=>t.id===g.userData.resourceId);g.visible=!(world.harvestedTrees||[]).includes(g.userData.resourceId)&&tree?.harvested!==true;}
 for(const g of cropGroups)g.visible=!(world.harvestedCrops||[]).includes(g.userData.resourceId);
 for(const g of oreGroups){const node=(world.oreNodes||[]).find(n=>n.id===g.userData.resourceId);if(node)updateOreVisual(g,node);}
}

// Craftable island machinery. Each model is assembled from detailed low-poly parts.
const machineMaterials={
 wood:new THREE.MeshStandardMaterial({color:0x72513a,roughness:.82}),woodLight:new THREE.MeshStandardMaterial({color:0x9a7049,roughness:.75}),
 metal:new THREE.MeshStandardMaterial({color:0x637785,metalness:.68,roughness:.38}),light:new THREE.MeshStandardMaterial({color:0xaebfc4,metalness:.72,roughness:.31}),
 dark:new THREE.MeshStandardMaterial({color:0x263944,metalness:.42,roughness:.58}),belt:new THREE.MeshStandardMaterial({color:0x25343c,roughness:.9}),
 brass:new THREE.MeshStandardMaterial({color:0xc29248,metalness:.72,roughness:.34}),cyan:new THREE.MeshStandardMaterial({color:0x62c1c3,emissive:0x164d55,emissiveIntensity:.55}),
 ember:new THREE.MeshStandardMaterial({color:0xf48a45,emissive:0xb93d0c,emissiveIntensity:1.8}),
};
let machineRoots=[];
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
function makeConveyor(root){
 const m=machineMaterials;
 machineBox(root,.98,.11,.92,m.dark,0,.25,0);machineBox(root,.84,.07,.74,m.belt,0,.34,0);
 for(const z of [-.43,.43])machineBox(root,.98,.14,.075,m.light,0,.38,z);
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
function makeMachineModel(type){
 const root=new THREE.Group();
 if(type==='t1_bench')makeT1Bench(root);else if(type==='farming_bench'){makeT1Bench(root);machineBox(root,.58,.12,.48,machineMaterials.woodLight,0,1.28,.08);for(let x=-.18;x<=.19;x+=.36){machineBox(root,.14,.08,.14,machineMaterials.cyan,x,1.38,.08);}}else if(type==='workbench')makeWorkbench(root);else if(type==='drill')makeDrill(root);else if(type==='conveyor')makeConveyor(root);else if(type==='smelter')makeSmelter(root);
 if(type==='drill')root.scale.x=.68; // Keep the auger inside its one-tile footprint.
 return root;
}
function buildMachineMesh(machine){
 const root=makeMachineModel(machine.type);
 root.userData.machineType=machine.type;
 root.position.set(machine.x+.5,machine.y,machine.z+.5);root.rotation.y=machine.rotation*Math.PI/2;worldRoot.add(root);return root;
}
let machinePreview=null,previewValid=false;
function clearMachinePreview(){if(!machinePreview)return;worldRoot.remove(machinePreview);machinePreview.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});machinePreview=null;}
function createMachinePreview(type){clearMachinePreview();machinePreview=makeMachineModel(type);machinePreview.traverse(o=>{if(!o.material)return;o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.58;m.depthWrite=false;}});machinePreview.visible=false;worldRoot.add(machinePreview);}
function updateMachinePreview(sx,sy){
 if(mode!=='machine'||!placingMachine||!machinePreview)return;const cell=targetBlock(sx,sy,'place');
 if(!cell){machinePreview.visible=false;return;}
 const {x,y,z}=cell,centerX=x+.5,centerY=y+.5,centerZ=z+.5;
 previewValid=x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16&&!has(x,y,z)&&has(x,y-1,z)&&!(world.machines||[]).some(m=>m.x===x&&m.y===y&&m.z===z)&&!(Math.abs(centerX-player.pos.x)<.65&&Math.abs(centerZ-player.pos.z)<.65&&centerY>=player.pos.y&&centerY<=player.pos.y+1.8);
 machinePreview.visible=true;machinePreview.position.set(x+.5,y,z+.5);machinePreview.rotation.y=machineRotation*Math.PI/2;
 machinePreview.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.color.set(previewValid?0x77d6ac:0xe68070);m.emissive.set(previewValid?0x184c36:0x60251d);}});
}
function rebuildMachines(){
 for(const root of machineRoots){worldRoot.remove(root);root.traverse(o=>{if(o.geometry)o.geometry.dispose();});}
 machineRoots=(world?.machines||[]).map(buildMachineMesh);
}
const humanoid=new THREE.Group();worldRoot.add(humanoid);
const skin=new THREE.MeshLambertMaterial({color:0xe4c6a5}),suit=new THREE.MeshLambertMaterial({color:0x3e6c82}),visor=new THREE.MeshLambertMaterial({color:0x122f43}),boots=new THREE.MeshLambertMaterial({color:0x253d4a});
function box(parent,w,h,d,mat,x,y,z){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
// Ordinary adult proportions in metres: 1.78 m tall, ~0.68 m arm-to-arm width.
// Feet sit at y=0, and the top of the head is exactly PLAYER_HEIGHT_METERS.
box(humanoid,.44,.65,.25,suit,0,1.105,0); // torso: 0.78–1.43 m
box(humanoid,.28,.28,.27,skin,0,1.64,0); // head: 1.50–1.78 m
box(humanoid,.23,.09,.05,visor,0,1.65,-.16);
for(const side of [-1,1]){
 box(humanoid,.12,.60,.19,suit,side*.28,1.12,0); // shoulders/arms, outside x=±0.34 m
 box(humanoid,.18,.78,.22,boots,side*.125,.39,0); // legs: 0–0.78 m
}
const player={pos:new THREE.Vector3(.5,0,.5),grounded:true};
const keys=new Set(),touchMove=new THREE.Vector2(0,0);let jumpQueued=false,movementBusy=false,lastMovementAt=0,lastCraftStationState='';
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Space'&&!e.repeat)jump();if(e.code==='KeyR'&&mode==='machine'){machineRotation=(machineRotation+1)%4;setMode('machine');}if(e.code==='Escape'&&mode==='machine'){placingMachine=null;setMode('place');notice('배치 취소');}const slot=e.code.match(/^Digit([1-8])$/);if(slot){selectQuickSlot(Number(slot[1])-1);return;}keys.add(e.code);});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
function setMode(s){cancelMine();mode=s;$('place').classList.toggle('selected',s==='place');$('mine').classList.toggle('selected',s==='mine');$('farm').classList.toggle('selected',s==='farm');$('craftToggle').classList.toggle('selected',s==='machine');const hint=$('placementHint');hint.hidden=s!=='machine';if(s==='machine'){if(!machinePreview)createMachinePreview(placingMachine);hint.textContent='설비 배치 중 · '+(recipeCards.find(r=>r.id===placingMachine)?.name||'기계')+' · 탭하여 놓기 · R 회전 · Esc 취소';}else clearMachinePreview();}
$('place').onclick=()=>{placingMachine=null;setMode('place');};$('mine').onclick=()=>{placingMachine=null;setMode('mine');};
$('farm').onclick=()=>{placingMachine=null;setMode(mode==='farm'?'place':'farm');notice('농사 도구를 선택하고 경작지나 작물을 탭해.');};
$('jump').onclick=jump;
function jump(){if(player.grounded)jumpQueued=true;}
function sendMovement(now){
 if(!world||movementBusy)return;
 const dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+touchMove.x;
 const dz=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-touchMove.y;
 const moving=Math.hypot(dx,dz)>.05;if(!moving&&player.grounded&&!jumpQueued&&now-lastMovementAt<5000)return;if(now-lastMovementAt<50)return;
 lastMovementAt=now;
 const length=Math.hypot(dx,dz),sx=length>1?dx/length:dx,sz=length>1?dz/length:dz;
 const dirX=sx*Math.cos(camYaw)-sz*Math.sin(camYaw),dirZ=-sx*Math.sin(camYaw)-sz*Math.cos(camYaw);
 if(Math.hypot(dirX,dirZ)>.05)humanoid.rotation.y=Math.atan2(-dirX,-dirZ);
 const jump=jumpQueued;jumpQueued=false;movementBusy=true;
 void api('/api/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:dirX,z:dirZ,jump})}).then(data=>{
  player.pos.set(data.player.x,data.player.y,data.player.z);player.grounded=data.player.grounded;humanoid.position.copy(player.pos);
  const stationState=(world?.machines||[]).filter(m=>m.type==='t1_bench'||m.type==='workbench'||m.type==='drill').map(m=>m.type+':'+(Math.hypot(m.x+.5-player.pos.x,m.y+.6-(player.pos.y+1),m.z+.5-player.pos.z)<=4.5)).join('|');
  if(!$('craftPanel').hidden&&stationState!==lastCraftStationState){lastCraftStationState=stationState;updateCrafting();}
 }).catch(err=>{if(jump)jumpQueued=true;if(!movementBusy)return;notice('이동 동기화 실패: '+err.message);}).finally(()=>{movementBusy=false;});
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
 if(previous?.serverStarted){const path=previous.resourceType==='tree'||previous.resourceType==='wheat'?'/api/harvest':'/api/mine';void api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'cancel'})}).catch(()=>{});}
}
function targetBlock(sx,sy,action){
 if(!world||!terrain)return null;
 const rect=renderer.domElement.getBoundingClientRect();
 ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);
 ray.setFromCamera(ndc,camera);
 const hit=ray.intersectObject(terrain,false)[0];if(!hit||hit.distance>75)return null;
 const normal=hit.face.normal;
 const point=worldRoot.worldToLocal(hit.point.clone()).addScaledVector(normal,action==='place'?.015:-.015);
 const x=Math.floor(point.x),y=Math.floor(point.y),z=Math.floor(point.z);
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5)return null;
 return {x,y,z};
}
function targetHarvestable(sx,sy){
 const rect=renderer.domElement.getBoundingClientRect();ndc.set(((sx-rect.left)/rect.width)*2-1,-((sy-rect.top)/rect.height)*2+1);ray.setFromCamera(ndc,camera);
 const groundHit=terrain&&ray.intersectObject(terrain,false)[0];let best=null;
 const consider=(group,type)=>{if(!group.visible)return;const hit=ray.intersectObject(group,true)[0];if(hit&&hit.distance<=75&&(!groundHit||hit.distance<groundHit.distance)&&(!best||hit.distance<best.distance))best={id:group.userData.resourceId,type,distance:hit.distance};};
 for(const group of cropGroups)consider(group,'wheat');
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
  if(resourceType==='tree'&&(world?.harvestedTrees||[]).includes(resourceId)||resourceType==='wheat'&&(world?.harvestedCrops||[]).includes(resourceId)||busy){cancelMine();return;}
  if(resourceType==='ore'&&!(world.oreNodes||[]).some(n=>n.id===resourceId&&n.remaining>0)){cancelMine();return;}
  const elapsed=Math.max(0,now-holdMining.startedAt);
  miningFill.style.width=Math.min(100,elapsed/MINING_DURATION_MS*100).toFixed(1)+'%';
  const label=resourceType==='tree'?'나무 채집':resourceType==='wheat'?'밀 수확':'돌 광맥 채굴';
  miningLabel.textContent=label+' '+Math.min(100,Math.floor(elapsed/MINING_DURATION_MS*100))+'%';
  if(elapsed>=MINING_DURATION_MS&&holdMining.serverStarted){const mining=holdMining;holdMining=null;miningHud.hidden=true;miningFill.style.width='0%';
   const request=resourceType==='ore'?api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'mine',targetType:'ore',resourceId,tool:mining.tool,revision:world.revision})}):api('/api/harvest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'collect',resourceType,resourceId,tool:mining.tool})});
   void request.then(data=>{world=data.world;inventory();updateResources();updateCrafting();if(resourceType==='ore')scheduleOreRegeneration();notice(resourceType==='tree'?'목재 +'+data.yield:resourceType==='wheat'?'밀 +'+data.yield:'돌 +1 · 광맥이 일정 시간 뒤 재생돼.');}).catch(err=>{if(err.world){world=err.world;inventory();updateResources();updateCrafting();}notice('수확 실패: '+err.message);});
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
 pressStart={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};
 lastPoint={x:e.clientX,y:e.clientY};dragCam=false;
 renderer.domElement.setPointerCapture(e.pointerId);
 if(mode==='mine'&&!busy){
  const resource=targetHarvestable(e.clientX,e.clientY);
  if(resource?.type==='wheat'){
   const crop=world.crops.find(c=>c.id===resource.id);if(crop?.stage>=4&&!busy){busy=true;void api('/api/farm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'harvest',x:crop.x,y:crop.y,z:crop.z,tool:'hand',revision:world.revision})}).then(data=>{world=data.world;inventory();rebuildResources();notice('밀 +1 · 씨앗 +1');}).catch(err=>{if(err.world){world=err.world;inventory();rebuildResources();}notice('수확 실패: '+err.message);}).finally(()=>busy=false);}else notice('밀이 아직 익지 않았어.');
  }else if(resource?.type==='tree'){
   const label=resource.type==='tree'?'나무 채집':'밀 수확';
   beginHoldMining('/api/harvest',{resourceType:resource.type,resourceId:resource.id,tool:selectedTool},{resourceType:resource.type,resourceId:resource.id},label);
  }else if(resource?.type==='ore'){
   beginHoldMining('/api/mine',{targetType:'ore',resourceId:resource.id,tool:selectedTool,revision:world.revision},{resourceType:'ore',resourceId:resource.id},'돌 광맥 채굴');
  }else{
   const cell=targetBlock(e.clientX,e.clientY,'mine');
   if(!cell)return;
   if(selectedTool!=='wood_shovel'){notice('흙은 나무 삽을 선택해야 캘 수 있어.');return;}
   beginHoldMining('/api/mine',{targetType:'block',...cell,tool:selectedTool,revision:world.revision},{cell},'흙 채굴');
  }
 }
});
renderer.domElement.addEventListener('pointermove',e=>{
 if(mode==='machine')updateMachinePreview(e.clientX,e.clientY);
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
const toolDisplay={wood_pickaxe:{icon:'⛏',label:'나무 곡괭이'},wood_axe:{icon:'🪓',label:'나무 도끼'},wood_shovel:{icon:'🪏',label:'나무 삽'},hoe:{icon:'⚒️',label:'나무 괭이'},watering_can:{icon:'🚿',label:'물뿌리개'},scythe:{icon:'🌾',label:'낫'}};
function updateQuickbar(){
 const slots=world?.inventory?.quickSlots||[];document.querySelectorAll('.quickSlot').forEach((button,i)=>{
 const id=slots[i],info=toolDisplay[id],count=id?(world.inventory.tools?.[id]||0):0;
  button.classList.toggle('active',i===selectedSlot&&!!info&&count>0);button.classList.toggle('empty',!info||count<1);button.disabled=!info||count<1;
  button.querySelector('span').textContent=info?info.icon:'·';button.querySelectorAll('small')[1].textContent=info?(info.label.replace('나무 ','')+' '+count):'빈 슬롯';
  button.setAttribute('aria-label',info?`슬롯 ${i+1}: ${info.label} ${count}개`:`슬롯 ${i+1}: 비어 있음`);button.title=info?info.label:'빈 슬롯';
 });
}
function selectQuickSlot(slot){const id=world?.inventory?.quickSlots?.[slot];if(!id||!toolDisplay[id]||(world.inventory.tools?.[id]||0)<1)return;selectedSlot=slot;selectedTool=id;updateQuickbar();void api('/api/slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectedSlot:slot})}).then(data=>{if(data.world)world=data.world;}).catch(()=>{});}
document.querySelectorAll('.quickSlot').forEach((button,i)=>button.addEventListener('click',()=>selectQuickSlot(i)));
function inventory(){
 const inv=world.inventory;$('dirt').textContent=inv.dirt;$('wood').textContent=inv.wood||0;
 $('resources').textContent='목재 '+(inv.wood||0)+' · 돌 '+(inv.stone||0)+' · 묘목 '+(inv.sapling||0)+' · 밀 '+(inv.wheat||0)+' · 씨앗 '+(inv.wheat_seed||0)+' · 물 '+(inv.wateringCanUses??10)+' · 흙 '+inv.dirt;
 $('dirtSmall').textContent='×'+inv.dirt;$('revision').textContent='저장 버전 '+world.revision;updateQuickbar();updateObjective();
}
function scheduleOreRegeneration(){
 for(const node of world?.oreNodes||[])if(node.remaining===0&&node.regenAt){
  const delay=Math.max(0,node.regenAt-Date.now()+50);
  setTimeout(()=>{void api('/api/world').then(data=>{world=data;inventory();updateResources();updateCrafting();}).catch(()=>{});},delay);
 }
}
async function api(path,opts){const r=await fetch(path,{credentials:'same-origin',...opts});let payload;try{payload=await r.json()}catch{throw Error('서버 응답 오류');}if(!r.ok){const e=new Error(payload.error||'요청 실패');e.world=payload.world;throw e;}return payload;}
const recipeCards=[
 {id:'farming_bench',name:'농업 작업대',description:'T1 제작대에서 농기구를 만드는 작업대.',cost:{wood:2,stone:3},station:'t1_bench'},
 {id:'hoe',name:'나무 괭이',description:'일반 흙을 경작지로 바꿔.',cost:{wood:2,stone:1},station:'farming_bench',tool:true},
 {id:'watering_can',name:'물뿌리개',description:'경작지에 물을 줘 작물 성장을 두 배로 높여.',cost:{wood:2,stone:2},station:'farming_bench',tool:true},
 {id:'scythe',name:'낫',description:'선택한 작물 주변 3×3×3의 성숙한 밀을 수확해.',cost:{wood:2,stone:3},station:'farming_bench',tool:true},
 {id:'workbench',name:'목공 작업대',description:'기본 T1 제작대에서 만드는 첫 전문 제작대.',cost:{wood:8,dirt:6},station:'t1_bench'},
 {id:'drill',name:'회전식 채굴 드릴',description:'광맥을 파낼 수 있는 중형 드릴 프레임.',cost:{wood:10,dirt:12},station:'workbench'},
 {id:'conveyor',name:'롤러 컨베이어',description:'광물과 부품을 옮기는 방향 전환형 벨트 타일.',cost:{wood:4,dirt:5},station:'workbench'},
 {id:'smelter',name:'제련로',description:'광석을 금속 재료로 가공하는 고온 용광로.',cost:{wood:6,dirt:10},station:'drill'}
];
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
 $('craftIntro').textContent='T1 제작대는 섬에 기본 배치되어 있습니다. 농업 작업대와 농기구를 제작하세요. 제작은 필요한 작업대 가까이에서 가능합니다.';
 container.replaceChildren();
 for(const recipe of recipeCards){
  const card=document.createElement('div');card.className='recipe';const count=recipe.tool?(world.inventory.tools?.[recipe.id]||0):(items[recipe.id]||0);
  const requiredStation=recipe.station?machines.find(m=>m.type===recipe.station):null;
  const legacyT1Fallback=recipe.station==='t1_bench'&&world.worldVersion<2&&!requiredStation;
  const stationReady=!recipe.station||!!requiredStation||legacyT1Fallback;
  const stationNearby=!requiredStation||Math.hypot(requiredStation.x+.5-player.pos.x,requiredStation.y+.6-(player.pos.y+1),requiredStation.z+.5-player.pos.z)<=4.5;
  const already=recipe.id==='workbench'&&(workbench||count>0);
  const canAfford=Object.entries(recipe.cost).every(([r,n])=>(world.inventory[r]||0)>=n);
  const head=document.createElement('div');head.className='recipeHead';const name=document.createElement('div');name.className='recipeName';name.textContent=recipe.name;const tag=document.createElement('span');tag.className='recipeTag';const stationName=recipe.station==='t1_bench'?'T1 제작대':recipe.station==='drill'?'드릴':'목공 작업대';tag.textContent=count?'제작품 ×'+count:already?'설치됨':!stationReady?stationName+' 필요':!stationNearby?stationName+' 가까이 가기':'설계도';head.append(name,tag);
  const desc=document.createElement('div');desc.className='recipeDesc';desc.textContent=recipe.description;
  const cost=document.createElement('div');cost.className='recipeCost';cost.textContent='필요 재료 · '+Object.entries(recipe.cost).map(([r,n])=>(r==='wood'?'목재':r==='stone'?'돌':'흙')+' '+n).join(' / ');
  const button=document.createElement('button');
  if(count&&recipe.tool){button.textContent='보유 중';button.disabled=true;}
  else if(count){button.textContent='배치하기';button.disabled=false;button.onclick=()=>{placingMachine=recipe.id;machineRotation=0;setMode('machine');$('craftPanel').hidden=true;notice(recipe.name+' 배치 위치 선택 · 탭하여 놓기 · R 회전 · Esc 취소');};}
  else {button.textContent=already?'제작 완료':!stationReady?'잠김':!stationNearby?stationName+'에 접근':canAfford?'제작하기':'재료 부족';button.disabled=already||!stationReady||!stationNearby||!canAfford;button.onclick=()=>void craftRecipe(recipe.id);}
  if(!stationReady||!stationNearby)card.classList.add('locked');card.append(head,desc,cost,button);container.append(card);
 }
}
async function craftRecipe(recipe){
 try{const data=await api('/api/craft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipe})});world=data.world;inventory();updateCrafting();if(recipeCards.find(r=>r.id===recipe)?.tool){notice('도구 제작 완료 · 퀵슬롯에 추가됨');return;}placingMachine=recipe;machineRotation=0;setMode('machine');$('craftPanel').hidden=true;notice('제작 완료 · 설치할 타일을 탭해. R로 방향을 바꿀 수 있어.');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();}notice('제작 실패: '+e.message);}
}
async function placeMachineAt(sx,sy){
 if(!placingMachine||busy)return;const cell=targetBlock(sx,sy,'place');if(!cell){notice('섬 바닥의 가까운 타일을 선택해.');return;}
 updateMachinePreview(sx,sy);if(!previewValid){notice('초록색 설비 미리보기가 보이는 빈 바닥에 놓아.');return;}
 busy=true;try{const data=await api('/api/machine/place',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:placingMachine,...cell,rotation:machineRotation})});world=data.world;placingMachine=null;inventory();rebuildMachines();updateCrafting();setMode('place');notice('설비 배치 완료 · 서버에 저장됨');}
 catch(e){if(e.world){world=e.world;inventory();updateCrafting();rebuildMachines();}notice('배치 실패: '+e.message);}finally{busy=false;}
}
function refreshCraftPanel(){const opening=$('craftPanel').hidden;if(opening&&mode==='machine'){placingMachine=null;setMode('place');}updateCrafting();$('craftPanel').hidden=!opening;}
$('craftToggle').onclick=refreshCraftPanel;
async function interact(sx,sy){
 const cell=targetBlock(sx,sy,'place');
 if(!cell){notice('가까운 블록을 선택해줘.');return;}
 return interactCell(cell,'place');
}
function cropAt(sx,sy){const r=renderer.domElement.getBoundingClientRect();ndc.set(((sx-r.left)/r.width)*2-1,-((sy-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);let best=null;for(const group of cropGroups){if(!group.visible)continue;const hit=ray.intersectObject(group,true)[0];if(hit&&(!best||hit.distance<best.distance))best={crop:world.crops.find(c=>c.id===group.userData.resourceId),distance:hit.distance};}return best?.crop||null;}
async function interactFarm(sx,sy){
 const target=targetBlock(sx,sy,'mine');if(!target){notice('농지 또는 작물을 선택해.');return;}
 const crop=cropAt(sx,sy), tool=selectedTool;if(crop)Object.assign(target,{x:crop.x,y:crop.y,z:crop.z});else if(has(target.x,target.y,target.z)&&!has(target.x,target.y+1,target.z))target.y+=1;let action;
 if(tool==='scythe'){const center=crop?{x:crop.x,y:crop.y,z:crop.z}:target;showHarvestRange(center);action='scythe';Object.assign(target,center);}
 else if(tool==='hoe'){const tilled=(world.tilled||[]).some(p=>p[0]===target.x&&p[1]===target.y&&p[2]===target.z),occupied=(world.crops||[]).some(c=>c.x===target.x&&c.y===target.y&&c.z===target.z);action=tilled&&!occupied&&(world.inventory.wheat_seed||0)>0?'plant':'till';}
 else if(tool==='watering_can'){const sources=world.waterSources||(world.worldVersion>=3?[{x:4,y:0,z:4}]:[]),atSource=sources.some(p=>p.x===target.x&&p.y===target.y&&p.z===target.z),uses=world.inventory.wateringCanUses??10;if(atSource&&uses<10)action='refill';else if(uses>0)action='water';else{notice('빈 물뿌리개는 파란 물통에서 채워.');return;}}else if(tool==='wood_axe'&&world.inventory.sapling>0)action='plant_tree';else if(crop)action='harvest';else if(tool==='sapling')action='plant_tree';else if(tool==='wood_axe')action='plant_tree';
 if(!action){notice('괭이·물뿌리개·낫을 선택하거나 작물을 탭해.');return;}
 if(action==='plant_tree'&&!(world.inventory.sapling>0)){notice('심을 묘목이 없어.');return;}
 busy=true;try{const data=await api('/api/farm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...target,tool,revision:world.revision})});world=data.world;inventory();rebuildResources();updateCrafting();notice(action==='harvest'||action==='scythe'?'밀과 씨앗을 수확했어.':action==='plant'?'밀 씨앗을 심었어.':'농사 작업 완료 · 서버 저장됨');}catch(e){if(e.world){world=e.world;inventory();rebuildResources();}notice('농사 작업 실패: '+e.message);}finally{busy=false;}
}
async function interactCell({x,y,z},action,tool=selectedTool){
 if(busy||!world)return;
 const center=new THREE.Vector3(x+.5,y+.5,z+.5);
 if(center.distanceTo(new THREE.Vector3(player.pos.x,player.pos.y+1,player.pos.z))>5.5){notice('가까운 블록만 편집할 수 있어.');return;}
 if(action==='place'&&Math.abs(center.x-player.pos.x)<.65&&Math.abs(center.z-player.pos.z)<.65&&center.y>=player.pos.y&&center.y<=player.pos.y+1.8){notice('플레이어 위치에는 설치할 수 없어.');return;}
 if(action==='mine'&&!has(x,y,z))return;
 busy=true;
 try{const data=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:action,targetType:action==='mine'?'block':undefined,tool:action==='mine'?tool:undefined,x,y,z,revision:world.revision})});
 world=data.world;inventory();rebuild();updateCrafting();notice(action==='place'?'흙 블록 설치 완료 · 서버에 저장됨':'흙 블록 회수 완료 · 서버에 저장됨');
 }catch(e){if(e.world){world=e.world;inventory();rebuild();updateCrafting();}notice('작업 실패: '+e.message);}finally{busy=false;}
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
function loop(now){requestAnimationFrame(loop);const frameDt=Math.min(.05,Math.max(0,(now-lastFrameAt)/1000));lastFrameAt=now;
 if(world)sendMovement(now);
 for(const machine of machineRoots)for(const rotor of machine.userData.rotors||[])rotor.rotation.x+=frameDt*2.6;
 if(machineRoots.some(m=>m.userData.machineType==='smelter'))machineMaterials.ember.emissiveIntensity=1.55+Math.sin(now*.006)*.28;
 updateMine(now);
 const target=player.pos.clone().add(new THREE.Vector3(0,PLAYER_HEIGHT_METERS*.54,0)).multiplyScalar(WORLD_SCALE);
 camera.position.set(target.x+camDistance*Math.sin(camYaw)*Math.cos(camPitch),target.y+camDistance*Math.sin(camPitch)+2.0,target.z+camDistance*Math.cos(camYaw)*Math.cos(camPitch));camera.lookAt(target);
 renderer.render(scene,camera);
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
$('grid').onclick=()=>{gridVisible=!gridVisible;$('grid').classList.toggle('selected',gridVisible);if(outlines)outlines.visible=gridVisible;};
async function init(){try{world=await api('/api/world');if(world.devtoolsEnabled===true){try{const devtools=await import('/devtools/time-control.js');devTimePanel=devtools.mountDevPanel(world);}catch(error){console.warn('Optional developer panel unavailable:',error);}}if(world.player){player.pos.set(world.player.x,world.player.y,world.player.z);player.grounded=world.player.grounded;humanoid.position.copy(player.pos);}selectedSlot=Number.isInteger(world.inventory.selectedSlot)?world.inventory.selectedSlot:1;selectedTool=world.inventory.quickSlots[selectedSlot]||world.inventory.quickSlots.find(Boolean)||'wood_axe';rebuild();rebuildMachines();rebuildResources();inventory();updateCrafting();$('loading').hidden=true;notice('밀·나무·돌을 도구로 수확하고 T1 제작대를 사용해봐.');}catch(e){$('loading').textContent='서버 연결 실패: '+e.message+' · node server.mjs로 실행해야 해.';}}
requestAnimationFrame(loop);init();
setInterval(()=>{if(!world||busy)return;void api('/api/world').then(next=>{const changed=(next.crops||[]).some((c,i)=>c.stage!==world.crops?.[i]?.stage)||(next.trees||[]).some((t,i)=>t.stage!==world.trees?.[i]?.stage)||JSON.stringify(next.watered)!==JSON.stringify(world.watered);world=next;devTimePanel?.update(next);if(changed){rebuildResources();inventory();}}).catch(()=>{});},3000);
