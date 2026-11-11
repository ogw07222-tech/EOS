import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';

const root=resolve(import.meta.dirname,'..');
async function randomPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(port,dir){
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),TERRA_SAVE_DIR:dir,TERRA_SESSION_SECRET:'testing_secret_for_terra_game_1234567890'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
 const started=await new Promise((resolve,reject)=>{
 let output='';let timeout=setTimeout(()=>reject(Error('Timed out starting server: '+stderr)),5000);
 child.stdout.on('data',b=>{output+=b.toString();if(output.includes('TERRA prototype server:')){clearTimeout(timeout);resolve(true);}});
 child.on('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code+': '+stderr));});
 });
 return child;
}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await once(child,'exit');}
async function request(port,path,options={}){const res=await fetch('http://127.0.0.1:'+port+path,options);return {status:res.status,cookie:res.headers.get('set-cookie'),body:await res.json()};}

test('independent guest island edits are validated and persist across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'terra-eos-test-'));const port=await randomPort();let proc;
 try{
 proc=await boot(port,dir);
 const alice=await request(port,'/api/world');assert.equal(alice.status,200);
 assert.equal(alice.body.inventory.dirt,48);assert.equal(alice.body.revision,0);
 const cookie=alice.cookie.split(';')[0];assert.match(cookie,/^terra_session=/);
 const bob=await request(port,'/api/world');const bCookie=bob.cookie.split(';')[0];
 assert.notEqual(cookie,bCookie);
 const build=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:0,y:0,z:0,revision:0})});
 assert.equal(build.status,200);assert.equal(build.body.world.inventory.dirt,47);assert.equal(build.body.world.edits['0,0,0'],'dirt');
 const stale=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:1,y:0,z:0,revision:0})});
 assert.equal(stale.status,409);
 const unsupported=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'place',x:12,y:5,z:12,revision:1})});
 assert.equal(unsupported.status,400);
 const bobWorld=await request(port,'/api/world',{headers:{Cookie:bCookie}});
 assert.equal(bobWorld.body.revision,0);
 await stop(proc);proc=await boot(port,dir);
 const persisted=await request(port,'/api/world',{headers:{Cookie:cookie}});
 assert.equal(persisted.body.revision,1);
 assert.equal(persisted.body.inventory.dirt,47);
 assert.equal(persisted.body.edits['0,0,0'],'dirt');
 const take=await request(port,'/api/action',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'mine',x:0,y:0,z:0,revision:1})});
 assert.equal(take.status,200);assert.equal(take.body.world.inventory.dirt,48);
 assert.equal(Object.hasOwn(take.body.world.edits,'0,0,0'),false);
 }finally{await stop(proc);await rm(dir,{recursive:true,force:true});}
});
