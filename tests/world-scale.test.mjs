import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
test('island renders at 3.75x while avatar stays 2.5x',()=>{
 assert.match(source,/const WORLD_SCALE=3\.75;/);
 assert.match(source,/worldRoot\.scale\.setScalar\(WORLD_SCALE\)/);
 assert.match(source,/worldRoot\.add\(terrain\)/);
 assert.match(source,/worldRoot\.add\(outlines\)/);
 assert.match(source,/worldRoot\.add\(humanoid\)/);
 assert.match(source,/const AVATAR_SCALE=2\.5 \/ WORLD_SCALE;/);
 assert.match(source,/humanoid\.scale\.setScalar\(AVATAR_SCALE\)/);
 assert.equal(3.75*(2.5/3.75),2.5);
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
 assert.match(source,/const target=player\.pos\.clone\(\)\.add\(new THREE\.Vector3\(0,0\.9,0\)\)\.multiplyScalar\(WORLD_SCALE\)/);
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
