import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
test('island and player render in the same 2.5x visual world',()=>{
 assert.match(source,/const WORLD_SCALE=2\.5;/);
 assert.match(source,/worldRoot\.scale\.setScalar\(WORLD_SCALE\)/);
 assert.match(source,/worldRoot\.add\(terrain\)/);
 assert.match(source,/worldRoot\.add\(outlines\)/);
 assert.match(source,/worldRoot\.add\(humanoid\)/);
 assert.match(source,/g\.scale\.setScalar\(scale\);worldRoot\.add\(g\)/);
});
test('selection resolves scaled world intersections back into unscaled grid coordinates',()=>{
 assert.match(source,/worldRoot\.worldToLocal\(hit\.point\.clone\(\)\)\.addScaledVector/);
 assert.match(source,/const x=Math\.floor\(point\.x\),y=Math\.floor\(point\.y\),z=Math\.floor\(point\.z\)/);
 const scale=2.5;
 for(const [x,y,z] of [[0,0,0],[7,-3,-8],[-12,3,10]]){
  const render=[(x+.5)*scale,(y+.5)*scale,(z+.5)*scale];
  assert.deepEqual(render.map(n=>Math.floor(n/scale)),[x,y,z]);
 }
});
test('follow camera and projection use rendered coordinates and wider distances',()=>{
 assert.match(source,/const target=player\.pos\.clone\(\)\.add\(new THREE\.Vector3\(0,1\.15,0\)\)\.multiplyScalar\(WORLD_SCALE\)/);
 assert.match(source,/camDistance=12;/);
 assert.match(source,/Math\.min\(30,Math\.max\(7,camDistance\+/);
 assert.match(source,/hit\.distance>50/);
 assert.match(source,/PerspectiveCamera\(65,innerWidth\/innerHeight,\.12,260\)/);
});
test('simulation grid and player physics remain in original block coordinates',()=>{
 assert.match(source,/for\(let x=-8;x<8;x\+\+\)for\(let z=-8;z<8;z\+\+\)for\(let y=-3;y<0;y\+\+\)/);
 assert.match(source,/const player=\{pos:new THREE\.Vector3\(\.5,0,\.5\)/);
 assert.match(source,/function solidForBody\(x,y,z\)/);
 assert.match(source,/const proposedX=player\.pos\.x\+dirX\*speed\*dt/);
});
