import http from 'node:http';
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const output=resolve(process.env.EOS_FLUID_QA_OUT||resolve(root,'../evidence-device-qa-2026-11-15'));
const routes=new Map([['/','index.html'],['/index.html','index.html'],['/app.mjs','app.mjs'],['/engine.mjs','../engine.mjs']]);
const server=http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname,file=routes.get(path)||(path.startsWith('/qa/')?'index.html':null);
 if(path==='/qa-result'&&req.method==='POST'){
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>100_000)throw new Error('report too large');}const report=JSON.parse(body);if(!report||typeof report.scenario!=='string'||!Number.isFinite(report.fluidTickMs?.mean))throw new Error('invalid report');await mkdir(output,{recursive:true});await appendFile(resolve(output,'fluid-runs.jsonl'),JSON.stringify(report)+'\n');res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({saved:true}));console.log(`QA ${report.scenario} ${report.speed}tps settle=${report.settleTicks} q=${report.queueLength}`);}
  catch(error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({saved:false,error:error.message}));}return;
 }
 if(!file){res.writeHead(404,{'content-type':'text/plain'});res.end('not found');return;}
 try{const body=await readFile(resolve(root,file));res.writeHead(200,{'content-type':path.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);}
 catch{res.writeHead(500);res.end('preview file unavailable');}
});
server.listen(38173,'127.0.0.1',()=>console.log('fluid preview listening at http://127.0.0.1:38173/'));
