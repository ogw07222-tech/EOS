import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function rules(){
 const a=server.indexOf('const key='),b=server.indexOf('function cookieValue'),c=server.indexOf('function change('),d=server.indexOf('async function handler');
 assert.ok(a>=0&&b>a&&c>b&&d>c);
 return Function(server.slice(a,b)+server.slice(c,d)+'return {fresh,validWorld,change,block,NODE_DEFS};')();
}
test('starter inventory contains three tool types and placeable material',()=>{
 const {fresh,validWorld}=rules(),w=fresh();
 assert.deepEqual(w.tools,['pickaxe','shovel','axe']);
 assert.equal(w.inventory.dirt,48);assert.equal(w.inventory.sand,8);
 assert.ok(validWorld(w));
});
test('only shovel mines dirt and sand; pickaxe mines stone/iron nodes; axe chops trees',()=>{
 const {fresh,change}=rules();let w=fresh();
 assert.match(change(w,{type:'mine',x:0,y:-1,z:0,tool:'pickaxe',revision:0}).error,/shovel/i);
 assert.match(change(w,{type:'harvest',nodeId:'tree-a',tool:'pickaxe',revision:0}).error,/Wrong tool/);
 assert.match(change(w,{type:'harvest',nodeId:'stone-a',tool:'axe',revision:0}).error,/Wrong tool/);
 const stone=change(w,{type:'harvest',nodeId:'stone-a',tool:'pickaxe',revision:0});
 assert.equal(stone.next.inventory.stone,1);assert.equal(stone.next.nodes['stone-a'],23);w=stone.next;
 const iron=change(w,{type:'harvest',nodeId:'iron-a',tool:'pickaxe',revision:1});
 assert.equal(iron.next.inventory.ironOre,1);w=iron.next;
 const wood=change(w,{type:'harvest',nodeId:'tree-a',tool:'axe',revision:2});
 assert.equal(wood.next.inventory.wood,5);w=wood.next;
 assert.match(change(w,{type:'harvest',nodeId:'tree-a',tool:'axe',revision:3}).error,/depleted/);
 assert.match(change(w,{type:'harvest',nodeId:'stone-a',tool:'fake',revision:3}).error,/Tool not owned/);
});
test('sand placement and shovel recovery preserve quantity',()=>{
 const {fresh,change}=rules();let w=fresh();
 w=change(w,{type:'place',x:0,y:0,z:0,item:'sand',tool:'shovel',revision:0}).next;
 assert.equal(w.inventory.sand,7);assert.equal(w.edits['0,0,0'],'sand');
 assert.match(change(w,{type:'mine',x:0,y:0,z:0,tool:'axe',revision:1}).error,/shovel/);
 w=change(w,{type:'mine',x:0,y:0,z:0,tool:'shovel',revision:1}).next;
 assert.equal(w.inventory.sand,8);assert.equal(Object.hasOwn(w.edits,'0,0,0'),false);
});
test('legacy saves without tools/nodes remain usable',()=>{
 const {validWorld,change}=rules();
 const legacy={schema:1,revision:0,inventory:{dirt:48},edits:{},createdAt:0,updatedAt:0};
 assert.ok(validWorld(legacy));
 const action=change(legacy,{type:'harvest',nodeId:'stone-b',tool:'pickaxe',revision:0});
 assert.equal(action.next.inventory.stone,1);
 assert.deepEqual(action.next.tools,['pickaxe','shovel','axe']);
});
test('client renders selected equipment and requires sustained harvesting',()=>{
 for(const slot of ['pickaxe','shovel','axe','dirtSlot','sandSlot'])assert.match(html,new RegExp('id="'+slot+'"'));
 assert.match(client,/function equipVisual\(kind\)/);
 assert.match(client,/const slotNames=\{pickaxe:/);
 assert.match(client,/function syncNodes\(\)/);
 assert.match(client,/void interactCell\(cell,cell\.kind==='node'\?'harvest':'mine'\)/);
 assert.match(client,/const MINING_DURATION_MS=1200/);
});
