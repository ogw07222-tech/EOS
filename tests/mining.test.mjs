import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function miningModule(){
 const section=(a,b)=>{const i=code.indexOf(a),j=code.indexOf(b,i);assert.ok(i>=0&&j>i,'missing '+a);return code.slice(i,j);};
 const script=\`
 const MINING_DURATION_MS=1200;let holdMining=null,busy=false,world={};
 const miningHud={hidden:true},miningFill={style:{width:''}},miningLabel={textContent:''};
 const requests=[];function has(){return true}
 function interactCell(cell,type){requests.push([cell,type])}
 \`+section('function cancelMine(){','function targetBlock(')+section('function updateMine(now){',"renderer.domElement.addEventListener('contextmenu'")+\`
 return {start:(t)=>{holdMining={cell:{x:0,y:-1,z:0},startedAt:t,done:false};miningHud.hidden=false;},cancelMine,updateMine,requests,miningHud,miningFill,miningLabel};
 \`;
 return Function(script)();
}
test('holding a block requires 1200ms, shows progress, and completes once',()=>{
 const game=miningModule();game.start(1000);game.updateMine(1400);
 assert.equal(game.requests.length,0);assert.equal(game.miningLabel.textContent,'채굴 중 33%');
 game.updateMine(2199);assert.equal(game.requests.length,0);
 game.updateMine(2200);assert.equal(game.requests.length,1);
 assert.equal(game.requests[0][1],'mine');
 game.updateMine(2400);assert.equal(game.requests.length,1);
 assert.equal(game.miningHud.hidden,true);
});
test('releasing early cancels and resets mining progress',()=>{
 const game=miningModule();game.start(1000);game.updateMine(1500);
 game.cancelMine();game.updateMine(3000);
 assert.equal(game.requests.length,0);assert.equal(game.miningHud.hidden,true);assert.equal(game.miningFill.style.width,'0%');
});
test('drag, lost capture, hidden browser and mode change cancel mining',()=>{
 assert.match(code,/if\(holdMining\)cancelMine\(\)/);
 assert.match(code,/addEventListener\('lostpointercapture'/);
 assert.match(code,/document\.hidden\)cancelMine\(\)/);
 assert.match(code,/function setMode\(s\)\{cancelMine\(\)/);
});
test('mine uses hold, place remains click, HUD components exist',()=>{
 assert.match(code,/if\(mode==='mine'&&!busy\)/);
 assert.match(code,/if\(mode==='place'&&!dragCam/);
 assert.match(code,/void interactCell\(cell,'mine'\)/);
 assert.match(html,/id="mining" hidden/);assert.match(html,/id="miningFill"/);assert.match(html,/길게 누르기/);
});
