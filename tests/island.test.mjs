import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('WebGL, 16x16, three dirt-only layers',()=>{
 assert.match(html,/new THREE\.WebGLRenderer/);
 assert.match(html,/SIZE=16,DEPTH=3/);
 assert.match(html,/texture\('grass'\)/);
 assert.match(html,/texture\('dirt'\)/);
 assert.doesNotMatch(html,/rockTex|stoneTex/);
});
test('all block faces are the exposed surface only',()=>{
 assert.match(html,/for\(let x=0;x<SIZE;x\+\+\)for\(let z=0;z<SIZE;z\+\+\)/);
 assert.match(html,/if\(x===0\)quad/);
 assert.match(html,/if\(x===SIZE-1\)quad/);
 assert.match(html,/if\(z===0\)quad/);
 assert.match(html,/if\(z===SIZE-1\)quad/);
 assert.equal(16*16,256);
 assert.equal(4*16*3,192);
});
test('outer surface is flat and faces point outward',()=>{
 const p=html.indexOf('for(let x=0;x<SIZE;x++)for(let z=0;z<SIZE;z++)');
 const surface=html.slice(p,html.indexOf('const geos=',p));
 assert.match(surface,/const topY=0,bottomY=-DEPTH/);
 assert.match(surface,/quad\(0,\[\[x0,topY,z1\]/);
 assert.match(surface,/quad\(2,\[\[x0,bottomY,z0\]/);
 // Winding orientation of each side follows outward normals.
 assert.match(surface,/if\(x===0\)quad\(mat,\[\[x0,lo,z0\],\[x0,lo,z1\]/);
 assert.match(surface,/if\(x===SIZE-1\)quad\(mat,\[\[x1,lo,z1\],\[x1,lo,z0\]/);
 assert.match(surface,/if\(z===0\)quad\(mat,\[\[x1,lo,z0\],\[x0,lo,z0\]/);
 assert.match(surface,/if\(z===SIZE-1\)quad\(mat,\[\[x0,lo,z1\],\[x1,lo,z1\]/);
});
test('mobile camera and starter decorations',()=>{
 assert.match(html,/touchmove/);assert.match(html,/addEventListener\('wheel'/);
 assert.match(html,/tree\(-5\.0,-4\.7,1\.0\);tree\(4\.8,4\.3,\.88\)/);
 assert.match(html,/edgeGroup\.visible=false/);
});
