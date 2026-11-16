import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndustrialVisuals } from '../src/industrial-visuals.js';

class Group {
  constructor(){this.children=[];this.userData={};this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={x:0,y:0,z:0};this.name='';this.parent=null;}
  add(child){child.parent=this;this.children.push(child);}
  remove(child){this.children=this.children.filter(value=>value!==child);child.parent=null;}
}
class Geometry {
  constructor(){this.attributes={};this.userData={};this.disposeCount=0;}
  setAttribute(name,value){this.attributes[name]=value;}
  setIndex(value){this.index=value;}
  dispose(){this.disposeCount++;}
}
class Material { constructor(options){Object.assign(this,options);this.userData={};} }
class Mesh { constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};this.rotation={x:0,y:0,z:0};this.castShadow=false;this.receiveShadow=false;this.parent=null;} }
class Attribute { constructor(array,itemSize){this.array=array;this.itemSize=itemSize;} }
class CylinderGeometry extends Geometry { constructor(...parameters){super();this.parameters=parameters;} }
class ConeGeometry extends Geometry { constructor(...parameters){super();this.parameters=parameters;} }
const THREE={Group,BufferGeometry:Geometry,MeshStandardMaterial:Material,Mesh,Float32BufferAttribute:Attribute,CylinderGeometry,ConeGeometry};

function childrenOf(root){const output=[];const visit=node=>{for(const child of node.children||[]){output.push(child);visit(child);}};visit(root);return output;}

test('industrial factory builds only existing drill, conveyor, and smelter IDs',()=>{
  const factory=createIndustrialVisuals(THREE);
  for(const id of ['drill','conveyor','smelter']){
    const model=factory.create(id);
    assert.equal(model.userData.machineType,id);
    assert.equal(model.userData.terraIndustrialModel,true);
    assert.ok(childrenOf(model).some(child=>child.geometry instanceof Geometry));
  }
  assert.throws(()=>factory.create('portal'),/Unsupported industrial model/);
});

test('all industrial silhouettes fit within a one metre X/Z footprint',()=>{
  const factory=createIndustrialVisuals(THREE);
  for(const id of ['drill','conveyor','smelter']){
    for(const model of [factory.create(id),...(id==='conveyor'?[factory.create(id,{uphill:true})]:[])]){
      const {min,max}=model.userData.modelAabb;
      assert.ok(max[0]-min[0]<=1,`${id} width ${max[0]-min[0]}`);
      assert.ok(max[2]-min[2]<=1,`${id} depth ${max[2]-min[2]}`);
      assert.ok(max[1]>min[1]);
    }
  }
});

test('drill auger is a distinct movable assembly, separated from the static gantry',()=>{
  const factory=createIndustrialVisuals(THREE),model=factory.create('drill');
  assert.equal(model.userData.rotors.length,1);
  const rotor=model.userData.rotors[0];
  assert.equal(rotor.name,'drill-auger');
  assert.ok(rotor.children.length>=3,'shaft, helical flights, and cutting tip remain separately animated as one assembly');
  assert.ok(model.children.some(child=>child!==rotor&&child.geometry instanceof Geometry),'static chassis stays independent');
});

test('flat and uphill conveyors expose their own roller motion groups and share geometry',()=>{
  const factory=createIndustrialVisuals(THREE),flat=factory.create('conveyor'),uphill=factory.create('conveyor',{uphill:true});
  assert.equal(flat.userData.belts.length,1);assert.equal(uphill.userData.belts.length,1);
  assert.equal(flat.userData.belts[0].rollers.length,4);assert.equal(flat.userData.belts[0].speed,2.2);
  assert.equal(uphill.children.find(child=>child.name==='conveyor-rollers').rotation.z,Math.PI/4);
  assert.equal(flat.userData.modelAabb.max[1],.535);assert.equal(uphill.userData.modelAabb.max[1],1.22);
  const flatRoller=flat.userData.belts[0].rollers[0],uphillRoller=uphill.userData.belts[0].rollers[0];
  assert.equal(flatRoller.geometry,uphillRoller.geometry,'roller geometry is cached across both belt inclines');
});

test('smelter exposes a single state-controlled hot window and shared idle intensity',()=>{
  const factory=createIndustrialVisuals(THREE),model=factory.create('smelter');
  assert.equal(model.userData.activeParts.length,1);
  assert.equal(model.userData.idleEmissiveIntensity,.18);
  assert.equal(model.userData.activeParts[0].material,factory.materials.hot);
});

test('removing one repeated machine retains factory-shared resources for siblings',()=>{
  const factory=createIndustrialVisuals(THREE),parent=new Group(),first=factory.create('smelter'),second=factory.create('smelter');
  parent.add(first);parent.add(second);
  const firstGeometry=first.children[0].geometry,secondGeometry=second.children[0].geometry;
  assert.equal(firstGeometry,secondGeometry);
  factory.dispose(first);
  assert.equal(parent.children.length,1);assert.equal(parent.children[0],second);
  assert.equal(firstGeometry.disposeCount,0,'shared geometry must remain alive for the second machine');
  assert.equal(factory.materials.body.userData.terraIndustrialShared,true);
});
