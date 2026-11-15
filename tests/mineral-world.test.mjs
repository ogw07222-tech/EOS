import test from 'node:test';
import assert from 'node:assert/strict';
import {mineralAt,mineralDrop,mineralTier,pickaxeTier,canMineMineral,mineralCore,isCoreDrop} from '../src/mineral-world.mjs';

const block=(seed,x,y,z,surfaceY=0)=>mineralAt(seed,x,y,z,surfaceY);
const scan=(seed)=>{
 const out=[];
 for(let cz=-1;cz<=2;cz++)for(let cx=-1;cx<=2;cx++)for(let z=cz*16;z<(cz+1)*16;z++)for(let x=cx*16;x<(cx+1)*16;x++)for(let y=-31;y<=-4;y++){
  const type=block(seed,x,y,z);if(type)out.push([x,y,z,type]);
 }
 return out;
};

test('seed and absolute coordinates produce deterministic veins independent of chunk traversal order',()=>{
 const forward=scan('minerals-alpha'),reverse=[];
 for(let cz=2;cz>=-1;cz--)for(let cx=2;cx>=-1;cx--)for(let z=(cz+1)*16-1;z>=cz*16;z--)for(let x=(cx+1)*16-1;x>=cx*16;x--)for(let y=-4;y>=-31;y--){const type=block('minerals-alpha',x,y,z);if(type)reverse.push([x,y,z,type]);}
 assert.deepEqual([...forward].sort((a,b)=>a[2]-b[2]||a[0]-b[0]||a[1]-b[1]),[...reverse].sort((a,b)=>a[2]-b[2]||a[0]-b[0]||a[1]-b[1]));
 assert.notDeepEqual(scan('minerals-alpha'),scan('minerals-beta'),'seed changes natural veins');
 assert.ok(forward.some(v=>v[3]==='iron_ore'));assert.ok(forward.some(v=>v[3]==='coal_ore'));assert.ok(forward.some(v=>v[3]==='copper_ore'));
});

test('starter landing pad remains clear and a guaranteed coal vein crosses the X chunk edge',()=>{
 for(let z=-6;z<=5;z++)for(let x=-6;x<=5;x++)for(let y=-31;y<=-4;y++)assert.equal(block('seed-any',x,y,z),null,`landing pad ${x},${y},${z}`);
 const across=[];for(let y=-12;y<=-4;y++)if(block('seed-any',15,y,-1)==='coal_ore'&&block('seed-any',16,y,-1)==='coal_ore')across.push(y);
 assert.ok(across.length>0,'coal is guaranteed near spawn and the same global vein spans x=15/16');
 assert.equal(block('seed-any',15,-8,-1),'coal_ore');
});

test('mineral drop IDs and T0/T1 pickaxe gates are stable',()=>{
 assert.equal(mineralDrop('iron_ore'),'iron_ore');assert.equal(mineralDrop('coal_ore'),'coal');assert.equal(mineralDrop('copper_ore'),'copper_ore');assert.equal(mineralDrop('stone'),null);
 assert.equal(mineralTier('stone'),0);for(const type of ['iron_ore','coal_ore','copper_ore'])assert.equal(mineralTier(type),1);
 assert.equal(pickaxeTier('wood_pickaxe'),0);assert.equal(pickaxeTier('stone_pickaxe'),1);
 assert.equal(canMineMineral('stone','wood_pickaxe'),true);assert.equal(canMineMineral('stone','stone_pickaxe'),true);
 for(const type of ['iron_ore','coal_ore','copper_ore']){assert.equal(canMineMineral(type,'wood_pickaxe'),false);assert.equal(canMineMineral(type,'stone_pickaxe'),true);}
 assert.equal(canMineMineral('grass','wood_pickaxe'),false);assert.equal(canMineMineral('coal_ore','wood_axe'),false);
});

test('core chance is a separate exact one-in-two-hundred mining roll',()=>{
 assert.equal(mineralCore('iron_ore'),'iron_vein_core');assert.equal(mineralCore('coal_ore'),'coal_vein_core');assert.equal(mineralCore('copper_ore'),'copper_vein_core');assert.equal(mineralCore('stone'),null);
 for(const type of ['iron_ore','coal_ore','copper_ore']){
  assert.equal(isCoreDrop(type,0),true);assert.equal(isCoreDrop(type,.004999999),true);
  assert.equal(isCoreDrop(type,.005),false);assert.equal(isCoreDrop(type,.5),false);assert.equal(isCoreDrop(type,1),false);
 }
 assert.equal(isCoreDrop('stone',0),false);assert.equal(isCoreDrop('coal_ore',NaN),false);assert.equal(isCoreDrop('coal_ore',-0.1),false);
});

