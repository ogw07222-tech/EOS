import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
test('hub has real 3D portal and farmer models plus keyboard and touch interaction controls',async()=>{
 const game=await readFile(resolve(root,'src/game.js'),'utf8'),npc=await readFile(resolve(root,'src/farmer-npc.js'),'utf8'),html=await readFile(resolve(root,'index.html'),'utf8');
 assert.match(game,/hubBox\(root,1\.22,1\.75,\.08/);assert.match(game,/createFarmerNpc\(THREE\)/);assert.match(npc,/new T\.Mesh\(new T\.BoxGeometry/);
 assert.match(game,/addEventListener\('click',\(\)=>void interactWorld\(\)\)/);assert.match(game,/e\.code==='KeyE'/);
 assert.match(html,/id="worldInteract"/);assert.match(html,/data-qty="max"/);assert.match(html,/safe-area-inset-bottom/);
});
