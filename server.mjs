import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve, extname } from 'node:path';

const ROOT=resolve(process.cwd());
const SAVE_DIR=resolve(process.env.TERRA_SAVE_DIR || join(ROOT,'data','worlds'));
const PORT=Number(process.env.PORT || 3000);
const SECRET=process.env.TERRA_SESSION_SECRET || '';
if(SECRET.length<32) { console.error('Set TERRA_SESSION_SECRET (at least 32 characters).'); process.exit(1); }
const sessions=new Map();
const allowedFiles=new Map([['/','index.html'],['/index.html','index.html'],['/src/game.js','src/game.js']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const key=(x,y,z)=>[x,y,z].join(',');
const inBounds=(x,y,z)=>Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&x>=-64&&x<64&&z>=-64&&z<64&&y>=-8&&y<=16;
const nativeBlock=(x,y,z)=>x>=-8&&x<8&&z>=-8&&z<8&&y>=-3&&y<0?'dirt':null;
function block(world,x,y,z){const k=key(x,y,z);return Object.hasOwn(world.edits,k)?world.edits[k]:nativeBlock(x,y,z);}
function fresh(){return {schema:1,revision:0,inventory:{dirt:48},edits:{},createdAt:Date.now(),updatedAt:Date.now()};}
function validWorld(w){return w&&w.schema===1&&Number.isSafeInteger(w.revision)&&w.revision>=0&&w.inventory&&Number.isSafeInteger(w.inventory.dirt)&&w.inventory.dirt>=0&&w.inventory.dirt<=1000000&&w.edits&&typeof w.edits==='object'&&!Array.isArray(w.edits)&&Object.keys(w.edits).length<=20000;}
function cookieValue(id){return id+'.'+createHmac('sha256',SECRET).update(id).digest('hex');}
function identity(req){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('terra_session='))?.slice(14);
 if(value){const [id,sig]=value.split('.');if(/^[a-f0-9]{32}$/.test(id)&&/^[a-f0-9]{64}$/.test(sig||'')){const expected=cookieValue(id).split('.')[1];if(timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return {id,isNew:false};}}
 return {id:randomBytes(16).toString('hex'),isNew:true};
}
async function load(id){if(sessions.has(id))return sessions.get(id);
 let w;try{w=JSON.parse(await readFile(join(SAVE_DIR,id+'.json'),'utf8'));if(!validWorld(w))throw Error('Invalid save');}
 catch(e){if(e.code!=='ENOENT')throw e;w=fresh();}
 const session={world:w,queue:Promise.resolve()};sessions.set(id,session);return session;
}
async function save(id,w){await mkdir(SAVE_DIR,{recursive:true});const target=join(SAVE_DIR,id+'.json');const tmp=target+'.'+randomBytes(4).toString('hex')+'.tmp';await writeFile(tmp,JSON.stringify(w));await rename(tmp,target);}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function error(res,status,message){send(res,status,{error:message});}
async function jsonBody(req){let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>4096)throw Object.assign(Error('Request too large'),{status:413});}try{return JSON.parse(body);}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
function change(current,action){const {type,x,y,z,revision}=action||{};
 if(!inBounds(x,y,z))return {error:'Invalid coordinates'};
 if(!Number.isSafeInteger(revision)||revision!==current.revision)return {error:'Revision conflict',conflict:true};
 const existing=block(current,x,y,z);
 if(type==='place'){
  if(existing)return {error:'Space is occupied'};
  if(current.inventory.dirt<1)return {error:'Not enough dirt'};
  if(![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>block(current,x+dx,y+dy,z+dz)))return {error:'Must attach to existing terrain'};
 }else if(type==='mine'){
  if(!existing)return {error:'No block'};
  if(current.inventory.dirt>=1000000)return {error:'Inventory full'};
 }else return {error:'Unknown action'};
 if(Object.keys(current.edits).length>=20000&&!Object.hasOwn(current.edits,key(x,y,z)))return {error:'World edit limit'};
 // Never mutate the persisted object before the save succeeds.
 const next={...current,edits:{...current.edits},inventory:{...current.inventory},revision:current.revision+1,updatedAt:Date.now()};
 const original=nativeBlock(x,y,z),after=type==='place'?'dirt':null;
 if(after===original)delete next.edits[key(x,y,z)];else next.edits[key(x,y,z)]=after;
 next.inventory.dirt+=type==='place'?-1:1;
 return {next};
}
async function handler(req,res){
 if(req.method==='GET'&&allowedFiles.has(new URL(req.url,'http://localhost').pathname)){
  const file=allowedFiles.get(new URL(req.url,'http://localhost').pathname);
  try{const bytes=await readFile(join(ROOT,file));res.writeHead(200,{'Content-Type':mime[extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(bytes);}catch{error(res,404,'Not found');}return;
 }
 if(!['GET','POST'].includes(req.method)){error(res,405,'Method not allowed');return;}
 const path=new URL(req.url,'http://localhost').pathname;
 if(path!=='/api/world'&&path!=='/api/action'){error(res,404,'Not found');return;}
 // Cross-origin browser actions should not mutate a player's island.
 const origin=req.headers.origin;if(origin&&origin!== 'http://'+req.headers.host && origin!=='https://'+req.headers.host){error(res,403,'Origin denied');return;}
 const who=identity(req);
 if(who.isNew)res.setHeader('Set-Cookie','terra_session='+cookieValue(who.id)+'; HttpOnly; SameSite=Lax; Path=/'+(req.socket.encrypted?'; Secure':''));
 const session=await load(who.id);
 if(path==='/api/world'&&req.method==='GET'){send(res,200,session.world);return;}
 if(path==='/api/action'&&req.method==='POST'){
  const body=await jsonBody(req);
  // Sequentialize writes per identity; concurrent requests cannot duplicate resources.
  const job=session.queue.catch(()=>{}).then(async()=>{const outcome=change(session.world,body);
   if(outcome.error)return {status:outcome.conflict?409:400,data:{error:outcome.error,world:session.world}};
   await save(who.id,outcome.next);session.world=outcome.next;
   return {status:200,data:{world:session.world}};
  });
  session.queue=job;
  const result=await job;send(res,result.status,result.data);return;
 }
 error(res,405,'Method not allowed');
}
const server=http.createServer((req,res)=>{handler(req,res).catch(err=>{console.error(err);if(!res.headersSent)error(res,err.status||500,err.status?err.message:'Server error');else res.destroy();});});
server.listen(PORT,()=>console.log('TERRA prototype server: http://localhost:'+PORT));
