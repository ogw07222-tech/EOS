import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const assets=readFileSync(new URL('../src/model-assets.js',import.meta.url),'utf8');
test('one logical voxel is one metre and the avatar uses the same world scale',()=>{
 assert.match(source,/const WORLD_SCALE=3\.75;/);
 assert.match(source,/worldRoot\.scale\.setScalar\(WORLD_SCALE\)/);
 assert.match(source,/worldRoot\.add\(terrain\)/);
 assert.match(source,/worldRoot\.add\(outlines\)/);
 assert.match(source,/worldRoot\.add\(humanoid\)/);
 assert.match(source,/const BLOCK_METERS=1;/);
 assert.match(source,/const PLAYER_HEIGHT_METERS=1\.78;/);
 assert.match(source,/const PLAYER_HALF_WIDTH_METERS=0\.34;/);
 assert.doesNotMatch(source,/humanoid\.scale\.setScalar/);
 assert.match(source,/function makeTree\(tree\)\{const group=createTreeVisual\(THREE,tree,natureMaterials\);treeGroups\.push\(group\);worldRoot\.add\(group\);resourceRoots\.push\(group\);\}/);
 const nature=readFileSync(new URL('../src/nature-visuals.js',import.meta.url),'utf8');
 assert.match(nature,/groupAt\(THREE, tree\.x \+ 0\.5, tree\.y \|\| 0, tree\.z \+ 0\.5\)/);
 assert.match(nature,/group\.userData\.resourceId = tree\.id/);
 assert.match(nature,/group\.userData\.resourceTree = tree/);
});
test('selection resolves scaled world intersections back into unscaled grid coordinates',()=>{
 assert.match(source,/worldRoot\.worldToLocal\(hit\.point\.clone\(\)\)\.addScaledVector/);
 assert.match(source,/const x=Math\.floor\(point\.x\),y=Math\.floor\(point\.y\),z=Math\.floor\(point\.z\)/);
 const scale=3.75;
 for(const [x,y,z] of [[0,0,0],[7,-3,-8],[-12,3,10]]){
  const render=[(x+.5)*scale,(y+.5)*scale,(z+.5)*scale];
  assert.deepEqual(render.map(n=>Math.floor(n/scale)),[x,y,z]);
 }
});
test('follow camera and projection use rendered coordinates and wider distances',()=>{
 assert.match(source,/const cameraTarget=new THREE\.Vector3\(\)/);
 assert.match(source,/cameraTarget\.copy\(humanoid\.position\);cameraTarget\.y\+=PLAYER_HEIGHT_METERS\*\.54;cameraTarget\.multiplyScalar\(WORLD_SCALE\)/);
 assert.match(source,/camera\.lookAt\(cameraTarget\)/);
 assert.match(source,/camDistance=9\.5;/);
 assert.match(source,/camDistance\*WORLD_SCALE\*Math\.sin\(camYaw\)/);
 assert.match(source,/Math\.min\(38,Math\.max\(8,camDistance\+/);
 assert.match(source,/hit\.distance>75/);
 assert.match(source,/PerspectiveCamera\(65,innerWidth\/innerHeight,\.12,260\)/);
});
test('simulation grid and player physics remain in original block coordinates',()=>{
 assert.match(source,/const SIZE=10/);
 assert.match(source,/for\(let x=-half;x<half;x\+\+\)for\(let z=-half;z<half;z\+\+\)for\(let y=-3;y<0;y\+\+\)/);
 assert.match(source,/const player=\{pos:new THREE\.Vector3\(\.5,0,\.5\)/);
 assert.match(source,/api\('\/api\/move'/);
});

test('human height and arm span fit one-metre voxel dimensions',()=>{
 assert.match(assets,/box\(humanoid,\.28,\.28,\.27,skin,0,1\.64,0\)/);
 assert.match(assets,/arm\.position\.set\(side\*\.28,1\.41,0\)/);
 assert.match(assets,/box\(arm,\.12,\.60,\.19,suit,0,-\.30,0\)/);
 assert.match(assets,/leg\.position\.set\(side\*\.125,\.78,0\)/);
 assert.match(assets,/box\(leg,\.18,\.78,\.22,boots,0,-\.39,0\)/);
 const headTop=1.64+.28/2,armHalfSpan=.28+.12/2;
 assert.ok(Math.abs(headTop-1.78)<1e-12);
 assert.ok(Math.abs(armHalfSpan-.34)<1e-12);
 assert.match(readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),/for\(const oy of \[\.1,\.9,PLAYER_HEIGHT-\.08\]\)/);
});
