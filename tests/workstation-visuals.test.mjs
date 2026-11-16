import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkstationVisuals } from '../src/workstation-visuals.js';

class Group {
  constructor() { this.children = []; this.userData = {}; this.parent = null; }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse?.(callback) ?? callback(child); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.disposed = false; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex(value) { this.index = value; }
  computeBoundingSphere() {}
  dispose() { this.disposed = true; }
}
class Float32BufferAttribute {
  constructor(array, itemSize) { this.array = Float32Array.from(array); this.itemSize = itemSize; this.count = this.array.length / itemSize; }
}
class MeshStandardMaterial { constructor(options) { this.options = options; this.disposed = false; } dispose() { this.disposed = true; } }
class Mesh extends Group { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
const THREE = { Group, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Mesh };
const TYPES = ['workbench','t1_bench','tool_bench','agriculture_bench','farming_bench','block_bench','basic_assembler'];
function assertOutwardWinding(mesh, type) {
  const positions=mesh.geometry.attributes.position.array,normals=mesh.geometry.attributes.normal.array,index=mesh.geometry.index;
  for(let i=0;i<index.length;i+=3){
    const ia=index[i],ib=index[i+1],ic=index[i+2],a=ia*3,b=ib*3,c=ic*3;
    const ab=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]],ac=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]];
    const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],dot=normal[0]*normals[a]+normal[1]*normals[a+1]+normal[2]*normals[a+2];
    assert.ok(dot>1e-9,`${type} ${mesh.name} has inward/degenerate triangle at index ${i}`);
  }
}
function componentBounds(root) {
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  root.traverse(object => {
    const values = object.geometry?.attributes?.position?.array;
    if (!values) return;
    for (let i=0;i<values.length;i+=3) for (let a=0;a<3;a++) { min[a]=Math.min(min[a],values[i+a]); max[a]=Math.max(max[a],values[i+a]); }
  });
  return { min, max };
}

test('all existing workstation types have distinct measurable models inside the 1m footprint', () => {
  const visuals = createWorkstationVisuals(THREE), signatures = new Map();
  for (const type of TYPES) {
    const root = visuals.create(type), box = root.userData.modelAabb;
    assert.equal(root.userData.facilityType, type);
    assert.ok(root.userData.footprint.width > 0 && root.userData.footprint.width <= .98, `${type} width ${root.userData.footprint.width}`);
    assert.ok(root.userData.footprint.depth > 0 && root.userData.footprint.depth <= .98, `${type} depth ${root.userData.footprint.depth}`);
    assert.ok(box.min[1] >= -1e-6, `${type} stays above the floor`);
    assert.ok(box.max[1] > .8, `${type} has a readable above-table silhouette`);
    const measured = componentBounds(root);
    for (let axis=0;axis<3;axis++) { assert.ok(Math.abs(measured.min[axis]-box.min[axis])<1e-5); assert.ok(Math.abs(measured.max[axis]-box.max[axis])<1e-5); }
    const signature = root.userData.visualSignature.join('|');
    signatures.set(type, signature);
    assert.ok(signature.length > 20);
    for (const mesh of root.children) {
      const position=mesh.geometry.attributes.position.array,index=mesh.geometry.index;
      assert.ok(position.length>0, `${type} ${mesh.name} contains authored geometry`);
      assert.ok(index.length>0, `${type} ${mesh.name} is a merged part batch`);
      assert.ok(Math.max(...index)<position.length/3, `${type} indices stay inside their own buffer`);
      assert.equal(mesh.geometry.attributes.normal.array.length,position.length);
      assertOutwardWinding(mesh,type);
    }
  }
  assert.ok(new Set(signatures.values()).size >= 6, 'the workstation silhouettes use different geometry signatures');
});

test('repeated instances reuse immutable geometry and safely detach without disposing shared buffers', () => {
  const visuals=createWorkstationVisuals(THREE), first=visuals.create('tool_bench'), geometry=first.children.map(mesh=>mesh.geometry);
  const many=Array.from({length:100},()=>visuals.create('tool_bench'));
  for (const root of many) assert.deepEqual(root.children.map(mesh=>mesh.geometry),geometry);
  visuals.dispose(first);
  assert.ok(geometry.every(item=>!item.disposed));
  visuals.dispose(many[0]);
  const next=visuals.create('tool_bench');
  assert.deepEqual(next.children.map(mesh=>mesh.geometry),geometry);
});

test('unsupported facility IDs fail clearly instead of silently rendering a cube', () => {
  assert.throws(()=>createWorkstationVisuals(THREE).create('unknown_machine'),/Unknown workstation type/);
});
