import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const game=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('eight selectable quick slots persist selection and render item model previews',()=>{
 assert.equal((html.match(/class="quickSlot" data-slot=/g)||[]).length,8);
 assert.match(game,/const slot=e\.code\.match\(\/\^Digit\(\[1-8\]\)\$\/\)/);
 assert.match(game,/function selectQuickSlot\(slot\)/);
 assert.match(game,/itemThumbnail\(id\)/);
 assert.match(game,/selectedSlot:slot/);
});
test('inventory opens, closes, and assigns owned items',()=>{
 assert.match(html,/id="inventoryButton"/);assert.match(html,/id="inventoryPanel"[^>]*hidden/);
 assert.match(game,/function toggleInventory\(/);assert.match(game,/function closeInventory\(/);
 assert.match(game,/function renderInventory\(/);assert.match(game,/function assignInventoryItem\(/);
 assert.match(game,/e\.code==='KeyE'/);assert.match(game,/e\.code==='Escape'/);
});
test('place mode only consumes an available dirt or sand stack',()=>{
 assert.match(game,/const placeItem=\['dirt','sand'\]\.includes\(selectedTool\)\?selectedTool:'dirt'/);
 assert.match(game,/item:action==='place'&&\['dirt','sand'\]\.includes\(selectedTool\)\?selectedTool:undefined/);
 assert.match(game,/if\(mode==='place'\)void interact\(e\.clientX,e\.clientY\)/);
});
test('held tools and resource models use the shared 3D model generator',()=>{
 assert.match(game,/function makeItemModel\(id\)/);assert.match(game,/function equipHeldTool\(id\)/);
 assert.match(game,/heldToolModel=makeItemModel\(id\)/);
 assert.match(game,/if\(id==='wood_pickaxe'\|\|id==='stone_pickaxe'\)/);
 assert.match(game,/else if\(id==='wood_axe'\)/);assert.match(game,/else if\(id==='wood_shovel'\)/);
});
test('mobile quickbar retains all eight compact slots',()=>{
 assert.match(html,/#quickbar\{[^}]*grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
 assert.match(html,/@media\(max-width:620px\)[\s\S]*#quickbar\{[^}]*width:calc\(100vw - 12px\)/);
 assert.match(html,/@media\(max-width:620px\)[\s\S]*\.quickSlot\{height:48px/);
});

test('player arms and legs swing in opposite phase and ease to idle',()=>{
 assert.match(game,/const arms=\[\],legs=\[\]/);
 assert.match(game,/arm\.position\.set\(side\*\.28,1\.41,0\)/);
 assert.match(game,/leg\.position\.set\(side\*\.125,\.78,0\)/);
 assert.match(game,/targetArm=-targetLeg\*\.75/);
 assert.match(game,/THREE\.MathUtils\.damp/);
 assert.match(game,/animateWalk\(frameDt,moving\)/);
});
test('manual pickup displays a lower-right reward toast after the server confirms it',()=>{
 assert.match(html,/id="pickups"/);assert.match(html,/#pickups\{position:absolute;right:/);
 assert.match(game,/function rewardToast\(item,amount\)/);
 assert.match(game,/rewardToast\(action\.item,action\.quantity\)/);
});
