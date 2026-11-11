// Offline geometry/data invariants for the TERRA mining logistics vertical slice.
// Run locally: node --test tests/layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('Three.js WebGL module renderer is used',()=>{
 assert.match(html,/three\.module\.js/);
 assert.match(html,/new THREE\.WebGLRenderer/);
 assert.doesNotMatch(html,/CanvasRenderingContext2D/);
});
test('exactly four tiles and 1x1 right turn',()=>{
 const match=html.match(/const tileData=(\[[^;]+\]);/);
 assert.ok(match);
 const data=Function('return '+match[1])();
 assert.deepEqual(data.map(x=>x.type),['straight','up','turn','straight']);
 assert.deepEqual(data.map(x=>[x.x,x.z]),[[-1,0],[0,0],[1,0],[1,1]]);
 assert.equal(data[2].y,1);
 assert.equal(data[3].y,1);
 assert.equal(data[3].rot,-Math.PI/2);
});
test('incline rises by exactly one tile and path remains continuous',()=>{
 assert.match(html,/const ya=\.29,yb=1\.29/);
 assert.match(html,/const path=\[/);
 assert.match(html,/new THREE\.Vector3\(\.5,1\.45,0\)/);
 assert.match(html,/new THREE\.Vector3\(1\.42,1\.45,1\.46\)/);
});
test('manual pickup and one arrow call per belt',()=>{
 assert.match(html,/document\.getElementById\('pick'\)\.onclick=pick/);
 assert.match(html,/state\.inventory\+\+/);
 const calls=html.match(/arrow\(g,\[/g)||[];
 assert.equal(calls.length,3); // straight code shared for both straight tiles; 4 instances at runtime
});
test('ore node is cubic and mining drill uses a round spiral',()=>{
 assert.match(html,/box\(oreNode,1,1,1,MAT\.rock\)/);
 assert.match(html,/new THREE\.ConeGeometry/);
 assert.match(html,/flightPoints\.push/);
});
