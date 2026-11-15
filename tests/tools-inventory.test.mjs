import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('eight persistent quick slots show cached 3D item thumbnails and quantities',()=>{
 assert.equal((html.match(/class="quickSlot" data-slot=/g)||[]).length,8);
 assert.match(client,/const itemThumbs=new Map\(\)/);
 assert.match(client,/function itemThumbnail\(id\)/);
 assert.match(client,/image\.src=itemThumbnail\(id\)/);
 assert.match(client,/querySelectorAll\('small'\)\[1\]\.textContent=info&&count>0\?'×'\+count/);
 assert.doesNotMatch(html,/😀|⛏️|🪓|🪏/u);
});
test('legacy remote tool, resource, and node fields migrate without changing IDs',()=>{
 assert.match(server,/if\(!w\.inventory\.tools&&Array\.isArray\(w\.tools\)\)/);
 assert.match(server,/w\.inventory\.iron_ore=w\.inventory\.ironOre/);
 assert.match(server,/LEGACY_NODE_DEFS/);
 assert.match(server,/legacyYield:node\.yield/);
 assert.match(server,/w\.oreNodes\.push\(\{id,x:node\.x,y:0,z:node\.z,remaining,max:node\.capacity,regenAt:null,legacyNode:true/);
});
test('sand placement and shovel mining are server validated and use the selected item',()=>{
 assert.match(server,/\['dirt','grass','sand'\]\.includes\(blockType\)/);
 assert.match(server,/const item=\['dirt','sand'\]\.includes\(action\.item\)\?action\.item:'dirt'/);
 assert.match(server,/RESOURCE_KEYS\.includes\(body\.item\)/);
 assert.match(client,/item:action==='place'&&\['dirt','sand'\]\.includes\(selectedTool\)\?selectedTool:undefined/);
 assert.match(client,/if\(\['dirt','sand'\]\.includes\(id\)\)setMode\('place'\)/);
});
test('inventory panel assigns owned resources to quick slots and preserves explicit world interactions',()=>{
 assert.match(html,/id="inventoryPanel"[^>]*hidden/);
 assert.match(client,/function renderInventory\(\)/);
 assert.match(client,/body:JSON\.stringify\(\{selectedSlot:slot,item:id\}\)/);
 assert.match(client,/if\(nearInteraction\)void interactWorld\(\);else toggleInventory\(\)/);
 assert.match(client,/async function interactWorld\(\)/);
});

test('legacy save migrates into persistent slots and preserves sand through placement and shovel mining',async()=>{
 const {spawn}=await import('node:child_process');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const net=await import('node:net');const {once}=await import('node:events');const {createHmac}=await import('node:crypto');
 const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'terra-main-migration-'));
 const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const id='1123456789abcdef0123456789abcdef',secret='testing_secret_for_terra_game_1234567890';let proc;
 const request=async(path,options={})=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,options);return {status:response.status,cookie:response.headers.get('set-cookie'),body:await response.json()};};
 try{
  await writeFile(join(dir,id+'.json'),JSON.stringify({schema:1,revision:4,islandSize:16,inventory:{dirt:20,sand:2,wood:10,stone:0,ironOre:3},tools:['pickaxe','shovel','axe'],nodes:{'tree-a':0,'tree-b':1,'stone-a':4,'stone-b':24,'iron-a':5},edits:{'3,0,3':'sand'},player:{x:.5,y:0,z:.5,grounded:true}}));
  proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:secret},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('server did not start')),6000);proc.stdout.on('data',b=>{out+=b;if(out.includes('TERRA prototype server:')){clearTimeout(timeout);resolve();}});proc.once('exit',code=>{clearTimeout(timeout);reject(Error('server exited '+code));});});
  const signature=createHmac('sha256',secret).update(id).digest('hex'),cookie=`terra_session=${id}.${signature}`,headers={Cookie:cookie,'Content-Type':'application/json'};
  const loaded=await request('/api/world',{headers});assert.equal(loaded.status,200);assert.equal(loaded.body.inventory.iron_ore,3);assert.equal(loaded.body.inventory.tools.wood_pickaxe,1);assert.equal(loaded.body.inventory.quickSlots.length,8);
  assert.equal(loaded.body.trees.find(t=>t.id==='tree-a').harvested,true);assert.equal(loaded.body.oreNodes.find(n=>n.id==='iron-a').remaining,5);assert.equal(loaded.body.oreNodes.find(n=>n.id==='stone-a').remaining,4);assert.equal(loaded.body.edits['3,0,3'],'sand');
  const placed=await request('/api/action',{method:'POST',headers,body:JSON.stringify({type:'place',item:'sand',x:1,y:0,z:0,revision:loaded.body.revision})});assert.equal(placed.status,200);assert.equal(placed.body.world.inventory.sand,1);assert.equal(placed.body.world.edits['1,0,0'],'sand');
  const equipped=await request('/api/slot',{method:'POST',headers,body:JSON.stringify({selectedSlot:2})});assert.equal(equipped.status,200);
  const start=await request('/api/mine',{method:'POST',headers,body:JSON.stringify({type:'start',targetType:'block',tool:'wood_shovel',x:1,y:0,z:0,revision:equipped.body.world.revision})});assert.equal(start.status,200);await new Promise(r=>setTimeout(r,1220));
  const mined=await request('/api/action',{method:'POST',headers,body:JSON.stringify({type:'mine',targetType:'block',tool:'wood_shovel',x:1,y:0,z:0,revision:equipped.body.world.revision})});assert.equal(mined.status,200);assert.equal(mined.body.world.inventory.sand,2);assert.equal(mined.body.world.drops.length,0);
 }finally{if(proc&&proc.exitCode===null){proc.kill('SIGTERM');await once(proc,'exit');}await rm(dir,{recursive:true,force:true});}
});
