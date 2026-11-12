import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const game=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('eight distinct hotbar slots and keyboard shortcuts',()=>{
 const slots=['pickaxe','shovel','axe','dirt','sand','stone','ironOre','wood'];
 assert.equal((html.match(/data-slot="/g)||[]).length,8);
 for(const slot of slots)assert.match(html,new RegExp('id="slot-'+slot+'"'));
 assert.match(game,/Digit\[1-8\]/);
 assert.match(game,/setMode\(hotbarSlots\[Number\(e\.code\.slice\(-1\)\)-1\]\)/);
});
test('inventory opens and closes and displays owned items',()=>{
 assert.match(html,/id="inventoryButton"/);
 assert.match(html,/id="inventoryPanel"[^>]*hidden/);
 assert.match(html,/id="inventoryItems"/);
 assert.match(game,/function toggleInventory\(/);
 assert.match(game,/function closeInventory\(/);
 assert.match(game,/function renderInventory\(/);
 assert.match(game,/e\.code==='KeyE'/);
 assert.match(game,/e\.code==='Escape'/);
});
test('block placement occurs only when holding a placeable block',()=>{
 assert.match(game,/mode=placeableSlots\.has\(s\)\?'place':toolSlots\.has\(s\)\?'mine':'none'/);
 assert.match(game,/if\(mode==='place'&&!dragCam/);
});
test('selected dirt or sand is visibly held as a block',()=>{
 assert.match(game,/if\(kind==='dirt'\|\|kind==='sand'\)/);
 assert.match(game,/new THREE\.BoxGeometry\(\.26,\.26,\.26\)/);
 assert.match(game,/kind==='sand'\?heldSandMat:heldDirtMat/);
 assert.match(game,/toolDisplay\.position\.set\(0,-\.49,-\.19\)/);
});
test('mining bar follows selected resource with no percentage readout',()=>{
 assert.match(html,/id="miningFill"/);
 assert.doesNotMatch(html,/id="miningLabel"/);
 assert.match(game,/function updateMiningMarker\(/);
 assert.match(game,/worldRoot\.localToWorld\(origin\)\.project\(camera\)/);
 assert.match(game,/updateMiningMarker\(\);/);
});
test('pickup notifications show real server inventory gains in lower-right',()=>{
 assert.match(html,/id="pickups"/);
 assert.match(html,/#pickups\{position:absolute;right:/);
 assert.match(game,/function rewardToast\(item,amount\)/);
 assert.match(game,/line\.textContent=slotNames\[item\]\+' ×'\+amount/);
 assert.match(game,/world\.inventory\[key\]\|\|0\)\-\(previous\[key\]\|\|0\)/);
});
test('Minecraft-style opposing leg and arm swing, damped when idle',()=>{
 assert.match(game,/const arms=\[\],legs=\[\]/);
 assert.match(game,/arm\.position\.set\(side\*\.28,1\.41,0\)/);
 assert.match(game,/leg\.position\.set\(side\*\.125,\.78,0\)/);
 assert.match(game,/const targetArm=-targetLeg\*\.75/);
 assert.match(game,/THREE\.MathUtils\.damp/);
 assert.match(game,/animateWalk\(dt,length>\.05\)/);
});
