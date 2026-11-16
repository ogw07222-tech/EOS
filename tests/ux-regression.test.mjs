import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const game=await readFile(new URL('../src/game.js',import.meta.url),'utf8');
const workstationModels=await readFile(new URL('../src/workstation-visuals.js',import.meta.url),'utf8');

test('quickbar keeps eight accessible 3D thumbnail slots with compact quantities',()=>{
 assert.equal((html.match(/class="quickSlot" data-slot=/g)||[]).length,8);
 assert.match(html,/\.quickSlot img\{width:30px;height:30px/);
 assert.match(game,/image\.src=itemThumbnail\(id\)/);
 assert.match(game,/textContent=info&&count>0\?'×'\+count:''/);
 assert.match(game,/슬롯 \$\{i\+1\}: \$\{info\.label\} \$\{count\}개/);
 assert.match(html,/\.quickSlot\{height:48px;min-height:48px/);
});

test('touch devices default to a lighter chunk window while saved quality preference remains available',()=>{
 assert.match(game,/function configuredChunkRadius\(\)\{let requested=\(navigator\.maxTouchPoints\|\|0\)>0\?MIN_CHUNK_RADIUS:DEFAULT_CHUNK_RADIUS/);
 assert.match(game,/localStorage\.getItem\('terra\.chunkRadius'\)/);
 assert.match(game,/Math\.max\(MIN_CHUNK_RADIUS,Math\.min\(MAX_CHUNK_RADIUS,Math\.trunc\(requested\)\)\)/);
 assert.match(game,/const touchHardware=\(navigator\.maxTouchPoints\|\|0\)>0/);
 assert.match(game,/renderer\.shadowMap\.enabled=!touchHardware/);
 assert.match(game,/light\.castShadow=!touchHardware/);
 assert.match(game,/light\.shadow\.mapSize\.set\(touchHardware\?512:1024,touchHardware\?512:1024\)/);
});

test('icon controls retain accessible names and default debug stats stay hidden',()=>{
 assert.match(html,/id="jump" class="iconButton" aria-label="점프"/);
 assert.match(html,/id="grid" class="iconButton" aria-label="블록 윤곽 표시"/);
 assert.match(html,/#stats,#revision\{display:none\}body\.debug-mode #stats,body\.debug-mode #revision\{display:block\}/);
 assert.doesNotMatch(html,/🌾|🪓|⛏|🪏/);
});

test('resource expansion exposes crop and tree selectors, T1 pickaxe, and no emoji substitute',()=>{
 assert.match(html,/id="farmSelectors" hidden/);assert.match(html,/id="cropSelector"[\s\S]*value="carrot"[\s\S]*value="potato"/);assert.match(html,/id="treeSelector"[\s\S]*value="birch"[\s\S]*value="rubber"/);
 assert.match(html,/data-buy-seed="carrot_seed"/);assert.match(html,/data-buy-seed="potato_seed"/);
 assert.match(game,/id:'stone_pickaxe',name:'돌 곡괭이'/);assert.match(game,/seedItemForCrop\(cropType\)/);assert.match(game,/productItemForCrop\(cropTypeOf\(crop\)\)/);
 assert.match(game,/blockType=world\.worldGenVersion\?blockAt\(world,cell\.x,cell\.y,cell\.z\)/);assert.match(game,/!\['wood_pickaxe','stone_pickaxe'\]\.includes\(selectedTool\)/);
});

test('machine placement preview mirrors portal protection and inventory ownership',()=>{
 assert.match(game,/const portal=world\.personalPortal,portalReserved=!!portal&&Math\.abs\(x-portal\.x\)<=1&&z===portal\.z&&y>=0&&y<=2/);
 assert.match(game,/\(world\.inventory\.items\?\.\[placingMachine\]\|\|0\)>0/);
 assert.match(game,/async function placeMachineAt\(sx,sy\)[\s\S]*?updateMachinePreview\(sx,sy\);if\(!previewValid\)\{notice/);
});

test('block placement preview is cached, matches server placement rules, and never commits before a tap',()=>{
 assert.match(game,/const blockPreviewGeometry=new THREE\.BoxGeometry\(\.96,\.96,\.96\)/);
 assert.match(game,/new THREE\.EdgesGeometry\(blockPreviewGeometry\)/);
 assert.match(game,/function blockPlacementError\(/);
 for(const rule of ['포털 보호 구역','이미 블록이 있음','부족','월드 편집 한도','붙일 면이 없음','플레이어와 겹침'])assert.ok(game.includes(rule),`missing preview rule: ${rule}`);
 assert.match(game,/\[\[1,0,0\],\[-1,0,0\],\[0,1,0\],\[0,-1,0\],\[0,0,1\],\[0,0,-1\]\]/);
 assert.match(game,/async function interact\(sx,sy\)[\s\S]*?updateBlockPreview\(sx,sy\);if\(!blockPlacementValid\)/);
 assert.match(game,/renderer\.domElement\.addEventListener\('pointermove',e=>\{[\s\S]*?updateBlockPreview\(e\.clientX,e\.clientY\)/);
});

test('resource selection obeys server reach and farm taps stay on the selected tile',()=>{
 const resources=game.slice(game.indexOf('function targetHarvestable(sx,sy){'),game.indexOf('function beginHoldMining('));
 assert.match(resources,/const inReach=point=>Math\.hypot\(point\.x-player\.pos\.x,point\.y-\(player\.pos\.y\+1\),point\.z-player\.pos\.z\)<=5\.5/);
 assert.match(resources,/crop\.x\+\.5,y:crop\.y\+\.45,z:crop\.z\+\.5/);
 assert.match(resources,/tree\.y\+Math\.max\(1\.7,\(tree\.height\|\|5\)\*\.55\)/);
 const farming=game.slice(game.indexOf('function cropAt('),game.indexOf('async function interactFarm('));
 assert.match(farming,/function cropAt\(sx,sy,groundCell\)/);
 assert.match(farming,/crop\.x!==groundCell\.x\|\|crop\.z!==groundCell\.z\|\|Math\.abs\(crop\.y-groundCell\.y\)>1/);
 assert.match(farming,/Math\.hypot\(center\.x-player\.pos\.x,center\.y-\(player\.pos\.y\+1\),center\.z-player\.pos\.z\)>5\.5/);
 assert.match(game,/const crop=cropAt\(sx,sy,target\)/);
});

test('T0 workshops use dedicated cached V2-style part models within the one metre footprint',()=>{
 for(const id of ['workbench','t1_bench','tool_bench','agriculture_bench','block_bench','basic_assembler'])assert.ok(workstationModels.includes(id),`missing workstation model ${id}`);
 assert.match(game,/function makeMachineModel\(type,options=\{\}\)[\s\S]*?workstationVisuals\.create\(type,options\)/);
 assert.match(workstationModels,/0\.98/);
 const assembler=workstationModels.slice(workstationModels.indexOf('basic_assembler'),workstationModels.indexOf('function createRoot'));
 assert.match(assembler,/crank|handle|gear/i);assert.doesNotMatch(assembler,/screen|display/i);
});
