import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
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
 assert.match(source,/g\.scale\.setScalar\(scale\);worldRoot\.add\(g\)/);
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
 assert.match(source,/const target=player\.pos\.clone\(\)\.add\(new THREE\.Vector3\(0,PLAYER_HEIGHT_METERS\*\.54,0\)\)\.multiplyScalar\(WORLD_SCALE\)/);
 assert.match(source,/camDistance=14\.5;/);
 assert.match(source,/Math\.min\(38,Math\.max\(8,camDistance\+/);
 assert.match(source,/hit\.distance>75/);
 assert.match(source,/PerspectiveCamera\(65,innerWidth\/innerHeight,\.12,260\)/);
});
test('simulation grid and player physics remain in original block coordinates',()=>{
 assert.match(source,/for\(let x=-8;x<8;x\+\+\)for\(let z=-8;z<8;z\+\+\)for\(let y=-3;y<0;y\+\+\)/);
 assert.match(source,/const player=\{pos:new THREE\.Vector3\(\.5,0,\.5\)/);
 assert.match(source,/function solidForBody\(x,y,z\)/);
 assert.match(source,/const proposedX=player\.pos\.x\+dirX\*speed\*dt/);
});

test('human height and arm span fit one-metre voxel dimensions',()=>{
 assert.match(source,/box\(humanoid,\.28,\.28,\.27,skin,0,1\.64,0\)/);
 assert.match(source,/box\(arm,\.12,\.60,\.19,suit,0,-\.30,0\)/);
 assert.match(source,/arm\.position\.set\(side\*\.28,1\.41,0\)/);
 const headTop=1.64+.28/2,armHalfSpan=.28+.12/2;
 assert.ok(Math.abs(headTop-1.78)<1e-12);
 assert.ok(Math.abs(armHalfSpan-.34)<1e-12);
 assert.match(source,/for\(const oy of \[\.1,\.9,PLAYER_HEIGHT_METERS-\.08\]\)/);
});
