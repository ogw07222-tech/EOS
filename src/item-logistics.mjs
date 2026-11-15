import { randomBytes } from 'node:crypto';

export const ITEM_PRODUCTION_MS = 5000;
export const CONVEYOR_SPEED = 1.2;
const direction = rotation => [[1,0],[0,1],[-1,0],[0,-1]][rotation] || [1,0];
const tileKey = (x,y,z) => `${x},${y},${z}`;
const conveyorMap = world => new Map((world.machines || []).filter(m => m.type === 'conveyor').map(m => [tileKey(m.x,m.y,m.z),m]));
const dropId = () => randomBytes(12).toString('hex');

function beltNext(belt, belts) {
  const [dx,dz]=direction(belt.rotation), x=belt.x+dx, z=belt.z+dz;
  return belts.get(tileKey(x,belt.y,z)) || belts.get(tileKey(x,belt.y+1,z)) || null;
}
function beltSurface(belt, progress, belts) {
  const next=beltNext(belt,belts);
  return belt.y+.4+(next?.y===belt.y+1?Math.min(1,progress/Math.SQRT2):0);
}
function conveyorAt(world,x,y,z){return conveyorMap(world).get(tileKey(x,y,z))||null;}
function drillOutputTile(machine){
  const [dx,dz]=direction(machine.rotation);
  return {x:machine.x+dx,y:machine.y,z:machine.z+dz};
}
function makeOutput(world,machine,belts){
  const node=(world.oreNodes||[]).filter(n=>n.remaining>0).sort((a,b)=>Math.hypot(a.x-machine.x,a.y-machine.y,a.z-machine.z)-Math.hypot(b.x-machine.x,b.y-machine.y,b.z-machine.z))[0];
  if(!node || Math.hypot(node.x-machine.x,node.y-machine.y,node.z-machine.z)>5)return false;
  node.remaining--;node.regenAt=node.remaining===0?Date.now()+60_000:null;
  const out=drillOutputTile(machine),belt=conveyorAt(world,out.x,out.y,out.z);
  const drop={id:dropId(),item:'stone',quantity:1,x:machine.x+.5,y:machine.y+.48,z:machine.z+.5,conveyorId:null,progress:0};
  if(belt){drop.conveyorId=belt.id;drop.x=belt.x+.5;drop.z=belt.z+.5;drop.y=beltSurface(belt,0,belts);}
  world.drops.push(drop);return true;
}
function advanceDrop(drop,seconds,belts){
  let remaining=seconds*CONVEYOR_SPEED,guard=0;
  while(drop.conveyorId&&remaining>0&&guard++<32){
    const belt=( [...belts.values()] ).find(m=>m.id===drop.conveyorId);
    if(!belt){drop.conveyorId=null;drop.progress=0;break;}
    const next=beltNext(belt,belts),segment=next?(next.y===belt.y+1?Math.SQRT2:1):.5;
    const used=Math.min(remaining,segment-drop.progress);drop.progress+=used;remaining-=used;
    const [dx,dz]=direction(belt.rotation),baseX=belt.x+.5,baseZ=belt.z+.5;
    drop.x=baseX+dx*(drop.progress/segment)*(next?1:.5);
    drop.z=baseZ+dz*(drop.progress/segment)*(next?1:.5);
    drop.y=beltSurface(belt,drop.progress,belts);
    if(drop.progress+1e-8>=segment){
      if(next){drop.conveyorId=next.id;drop.progress=0;drop.x=next.x+.5;drop.z=next.z+.5;drop.y=beltSurface(next,0,belts);}
      else{drop.conveyorId=null;drop.progress=0;}
    }
  }
}

// Mutates a session-owned world snapshot; caller serializes and persists it atomically.
export function advanceItemLogistics(world, elapsedMs) {
  if(!Array.isArray(world.drops))world.drops=[];
  const elapsed=Math.max(0,Math.min(60_000,Number(elapsedMs)||0));
  if(!elapsed)return false;
  let changed=false;
  const belts=conveyorMap(world),existingDrops=new Set(world.drops.map(d=>d.id));
  for(const machine of world.machines||[]){
    if(machine.type!=='drill')continue;
    machine.productionMs=Math.min(ITEM_PRODUCTION_MS,Math.max(0,Number(machine.productionMs)||0)+elapsed);changed=true;
    while(machine.productionMs>=ITEM_PRODUCTION_MS){
      if(!makeOutput(world,machine,belts))break;
      machine.productionMs-=ITEM_PRODUCTION_MS;changed=true;
    }
  }
  const seconds=elapsed/1000;
  for(const drop of world.drops){if(existingDrops.has(drop.id)&&drop.conveyorId){advanceDrop(drop,seconds,belts);changed=true;}}
  return changed;
}

export function normalizeDrops(world){
  if(!Array.isArray(world.drops))world.drops=[];
  const seen=new Set();world.drops=world.drops.filter(d=>{if(!d||typeof d!=='object'||typeof d.id!=='string'||seen.has(d.id)||typeof d.item!=='string'||!Number.isSafeInteger(d.quantity)||d.quantity<1||![d.x,d.y,d.z].every(Number.isFinite))return false;seen.add(d.id);return true;});
  for(const d of world.drops){if(typeof d.conveyorId!=='string')d.conveyorId=null;if(!Number.isFinite(d.progress)||d.progress<0)d.progress=0;}
  for(const m of world.machines||[])if(m.type==='drill'&&(!Number.isFinite(m.productionMs)||m.productionMs<0))m.productionMs=0;
}
