import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const game=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
test('browser entry point loads active game module',()=>{
 assert.match(html,/src="\/src\/game.js"/);
 assert.match(html,/id="joystick"/);assert.match(html,/id="jump"/);
 assert.match(html,/id="place"/);assert.match(html,/id="mine"/);
});
test('client uses Three.js WebGL and exposed voxel faces',()=>{
 assert.match(game,/three\.module\.js/);
 assert.match(game,/new THREE\.WebGLRenderer/);
 assert.match(game,/const SIZE=10/);
 assert.match(game,/const half=world\.islandSize\/2/);
 assert.match(game,/for\(let x=-half;x<half;x\+\+\)for\(let z=-half;z<half;z\+\+\)for\(let y=-3;y<0;y\+\+\)/);
 assert.match(game,/if\(has\(x\+dx,y\+dy,z\+dz\)\)continue/);
 assert.match(game,/const solids=new Set\(\)/);
 assert.doesNotMatch(game,/stoneTex|rockTex/);
});
test('cube winding is outward on all six normals',()=>{
 const slice=game.substring(game.indexOf('const faces=['),game.indexOf('const grassMat='));
 // Extract constant face definitions without running browser code.
 const faces=Function(slice.replace('const faces=','return '))();
 assert.equal(faces.length,6);
 for(const face of faces){
  const [a,b,c]=face.v;
  const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  assert.deepEqual(cross.map(n=>Object.is(n,-0)?0:n),face.n,face.d.join(','));
 }
});
test('movement, interaction and server save are connected',()=>{
 assert.match(game,/function sendMovement\(now\)/);assert.match(game,/function jump\(\)/);
 assert.match(game,/function interact\(sx,sy\)/);assert.match(game,/fetch\(path/);
 assert.match(game,/\/api\/world/);assert.match(game,/\/api\/action/);
 assert.match(game,/world\.revision/);assert.match(game,/for\(const tree of world\.trees\|\|\[\]\)\{makeTree\(tree\);\}/);
 assert.match(server,/async function save\(/);
 assert.match(server,/timingSafeEqual/);
 assert.match(server,/if\(\(current\.inventory\[item\]\|\|0\)<1\)/);
 assert.match(server,/function stepPlayer\(session,input\)/);
 assert.match(server,/path==='\/api\/move'/);
});
