import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkstationVisuals } from '../src/workstation-visuals.js';
import { createIndustrialVisuals } from '../src/industrial-visuals.js';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
const assets = await readFile(new URL('../src/model-assets.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const world = await readFile(new URL('../src/chunk-world.mjs', import.meta.url), 'utf8');

class Vector3 {
  set(x, y, z) { this.x=x; this.y=y; this.z=z; return this; }
}
class Group {
  constructor() { this.children=[]; this.userData={}; this.position=new Vector3(); this.rotation=new Vector3(); this.scale=new Vector3().set(1,1,1); }
  add(child) { child.parent=this; this.children.push(child); }
  remove(child) { this.children=this.children.filter(value=>value!==child); if(child.parent===this)child.parent=null; }
  traverse(fn) { fn(this); for(const child of this.children)child.traverse(fn); }
}
class Mesh extends Group {
  constructor(geometry, material) { super(); this.geometry=geometry; this.material=material; this.userData={}; }
}
class Geometry {
  constructor(...parameters) { this.parameters=parameters; this.userData={}; this.attributes={}; this.index=null; }
  setAttribute(name, attribute) { this.attributes[name]=attribute; }
  setIndex(index) { this.index=index; }
  computeBoundingSphere() {}
}
class BufferGeometry extends Geometry {}
class PrimitiveGeometry extends Geometry {}
class Float32BufferAttribute {
  constructor(array,itemSize) { this.array=array; this.itemSize=itemSize; this.count=array.length/itemSize; }
}
class Material {
  constructor(options={}) { this.options=options; this.userData={}; this.color={value:options.color}; }
}
const THREE={Group,Mesh,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial:Material,CylinderGeometry:PrimitiveGeometry,ConeGeometry:PrimitiveGeometry};
const meshList=root=>{const values=[];root.traverse(node=>{if(node instanceof Mesh)values.push(node);});return values;};
const visualSignature=root=>meshList(root).map(mesh=>{
  const positions=mesh.geometry.attributes.position?.array;
  const geometry=positions?Array.from(positions,number=>Math.round(number*1000)).join(','):`${mesh.geometry.constructor.name}:${mesh.geometry.parameters.join(',')}`;
  return `${mesh.material.options.color}:${geometry}`;
}).sort().join('|');
const boundsSpan=(bounds,axis)=>bounds.max[axis]-bounds.min[axis];

const workstationTypes=['workbench','t1_bench','tool_bench','agriculture_bench','farming_bench','block_bench','basic_assembler'];
test('workstation visuals create distinct, bounded one-metre models with valid merged buffers',()=>{
  const factory=createWorkstationVisuals(THREE),signatures=new Map();
  for(const type of workstationTypes){
    const root=factory.create(type),meshes=meshList(root),data=root.userData;
    assert.ok(root instanceof Group,`${type} is a 3D root`);
    assert.equal(data.facilityType,type);
    assert.ok(meshes.length>0,`${type} contains rendered mesh parts`);
    assert.ok(Number.isFinite(data.floorOffset));
    assert.ok(data.modelAabb.min.every(Number.isFinite)&&data.modelAabb.max.every(Number.isFinite));
    assert.ok(boundsSpan(data.modelAabb,0)<=1&&boundsSpan(data.modelAabb,2)<=1,`${type} stays in its 1×1m placement footprint`);
    assert.ok(data.modelAabb.min[1]>=-1e-6&&data.modelAabb.max[1]<2,`${type} has a grounded, reviewable height`);
    assert.ok(data.footprint.width<=1&&data.footprint.depth<=1);
    assert.ok(Array.isArray(data.visualSignature)&&data.visualSignature.length>0);
    for(const mesh of meshes){
      const positions=mesh.geometry.attributes.position?.array,normals=mesh.geometry.attributes.normal?.array,indices=mesh.geometry.index;
      assert.ok(positions?.length>0,`${type} position buffer exists`);
      assert.ok(normals?.length===positions.length,`${type} normals match vertices`);
      assert.ok(indices?.length>0,`${type} has indexed triangles`);
      assert.ok(Math.max(...indices)<positions.length/3,`${type} indices remain in range`);
      assert.ok(Array.from(positions).every(Number.isFinite));
    }
    signatures.set(type,visualSignature(root));
  }
  const unique=['workbench','t1_bench','tool_bench','agriculture_bench','block_bench','basic_assembler'].map(type=>signatures.get(type));
  assert.equal(new Set(unique).size,unique.length,'each actual station has a distinct geometry silhouette signature');
  assert.equal(signatures.get('farming_bench'),signatures.get('agriculture_bench'),'legacy farming bench remains a visual alias');
});

test('industrial visuals keep shared geometry bounded and expose only meaningful moving parts',()=>{
  const factory=createIndustrialVisuals(THREE),initial=factory.geometryCount();
  const drill=factory.create('drill'),drillSibling=factory.create('drill');
  const flat=factory.create('conveyor'),uphill=factory.create('conveyor',{uphill:true});
  const smelter=factory.create('smelter');
  for(const [type,root] of [['drill',drill],['drill',drillSibling],['conveyor',flat],['conveyor',uphill],['smelter',smelter]]){
    assert.equal(root.userData.machineType,type);
    const aabb=root.userData.modelAabb;
    assert.ok(aabb.min.every(Number.isFinite)&&aabb.max.every(Number.isFinite));
    assert.ok(boundsSpan(aabb,0)<=1&&boundsSpan(aabb,2)<=1,`${type} footprint is one metre or smaller`);
    assert.ok(meshList(root).length>0);
  }
  assert.ok(drill.userData.rotors?.length>0,'drill auger is isolated for state-gated motion');
  assert.ok(flat.userData.belts?.[0]?.rollers?.length>0,'flat conveyor exposes roller motion parts');
  assert.ok(uphill.userData.belts?.[0]?.group.rotation.z,'uphill conveyor has an inclined roller group');
  assert.ok(smelter.userData.activeParts?.length>0,'smelter hot parts can be switched by state');
  assert.ok(meshList(drill).some(a=>meshList(drillSibling).some(b=>a.geometry===b.geometry)),'same-type drill instances share cached geometry');
  const countAfterFirstTypes=factory.geometryCount();
  for(let i=0;i<25;i++){factory.create('drill');factory.create('conveyor');factory.create('smelter');}
  assert.equal(factory.geometryCount(),countAfterFirstTypes,'repeated placement reuses factory geometry');
  assert.ok(countAfterFirstTypes>initial);
  const sharedDrillMesh=meshList(drill).find(a=>meshList(drillSibling).some(b=>a.geometry===b.geometry));
  assert.ok(sharedDrillMesh);
  const drillGeometry=sharedDrillMesh.geometry;
  factory.dispose(drill);
  assert.ok(!drill.parent);
  assert.ok(meshList(drillSibling).some(mesh=>mesh.geometry===drillGeometry),'disposing one instance preserves shared geometry for siblings');
  assert.ok(factory.geometryCount()>0,'instance removal does not tear down live shared assets');
});

test('game integration preserves existing type IDs, rotation, save contract, and distinct portal model',()=>{
  for(const type of ['t1_bench','workbench','farming_bench','tool_bench','agriculture_bench','block_bench','basic_assembler','drill','conveyor','smelter']){
    assert.ok(game.includes(`'${type}'`)||server.includes(`${type}:`),`${type} remains represented in client/server`);
  }
  assert.match(assets,/createWorkstationVisuals/);
  assert.match(assets,/createIndustrialVisuals/);
  assert.match(server,/\/src\/workstation-visuals\.js/,'the station module must be allowlisted for the browser');
  assert.match(server,/\/src\/industrial-visuals\.js/,'the machine module must be allowlisted for the browser');
  assert.match(assets,/workstationVisuals\.create\(type,options\)/);
  assert.match(assets,/industrialVisuals\.create\(type,options\)/);
  assert.match(game,/function disposeMachineVisual\(/);
  assert.match(game,/function machineOperating\(/);
  assert.match(game,/function updateMachineVisuals\(/);
  assert.match(game,/rotor\.rotation\.y\+=frameDt\*2\.6/,'drill auger spins around its modeled Y-axis shaft');
  assert.doesNotMatch(game,/rotor\.rotation\.x\+=frameDt/,'drill auger must not spin around the perpendicular X axis');
  assert.match(game,/drop\.conveyorId/,'conveyor motion is coupled to a live transported item');
  assert.match(game,/Math\.hypot\([^;]+\)<=5/,'drill motion is limited to an active nearby ore vein');
  assert.match(game,/machine\.rotation\*Math\.PI\/2/);
  assert.match(server,/rotation<0\|\|body\.rotation>3/,'server still validates four right-angle rotations');
  assert.match(server,/next\.machines\.push\(\{id:randomBytes\(8\)\.toString\('hex'\),type,x,y,z,rotation:body\.rotation\}\)/,'existing machine IDs/types/rotation remain persisted');
  assert.match(assets,/function portalModel\(/,'world transition portal remains a separate visual');
  assert.doesNotMatch(server,/RECIPES\s*=\s*\{[^}]*spaceship|RECIPES\s*=\s*\{[^}]*space_station/s,'no unrequested spaceship recipe was introduced');
});

test('open-world fixture still exposes the five implemented biome identifiers',()=>{
  for(const id of ['plains','forest','beach','river','ocean'])assert.ok(world.includes(`'${id}'`),`${id} is represented by the world generator`);
  assert.match(server,/api\/dev\/biomes|devBiomesPath/,'QA can obtain seed-specific biome samples from the dev server');
});
