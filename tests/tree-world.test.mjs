import test from 'node:test';
import assert from 'node:assert/strict';
import {
 FOREST_REGION_METERS,TREE_CHUNK_SIZE,biomeAt,generateTreesForChunk,treeDimensions,treeSpeciesAt
} from '../src/tree-world.mjs';

const surface=(x,z)=>Math.round(Math.sin(x/24)+Math.cos(z/27));
const key=t=>`${t.x},${t.y},${t.z},${t.species},${t.id}`;

test('biome and tree generation are deterministic across negative coordinates and load order',()=>{
 const points=[[-1,-17],[-16,0],[-17,-16],[20,-40],[0,0]];
 const a=points.map(([x,z])=>biomeAt(91234,x,z));
 assert.deepEqual(points.map(([x,z])=>biomeAt(91234,x,z)),a);
 const forward=[[0,0],[-1,0],[0,-1],[-1,-1],[1,2]].map(([cx,cz])=>generateTreesForChunk(91234,cx,cz,surface));
 const reverse=[[1,2],[-1,-1],[0,-1],[-1,0],[0,0]].map(([cx,cz])=>generateTreesForChunk(91234,cx,cz,surface)).reverse();
 assert.deepEqual(forward,reverse);
 assert.notDeepEqual(generateTreesForChunk(91234,-1,0,surface),generateTreesForChunk(91235,-1,0,surface));
});

test('forest and plains distribution is close to the 40/60 target over a broad seeded field',()=>{
 let forest=0,total=0;
 for(let z=-1024;z<1024;z+=8)for(let x=-1024;x<1024;x+=8){total++;if(biomeAt('forest-share-test',x,z)==='forest')forest++;}
 const share=forest/total;
 assert.ok(share>=.37&&share<=.43,`expected broad forest share near 40%, received ${(share*100).toFixed(2)}%`);
 assert.equal(biomeAt('forest-share-test',0,0),'plains','the anchor pad stays plains for every seed');
 assert.ok(FOREST_REGION_METERS/TREE_CHUNK_SIZE>=5&&FOREST_REGION_METERS/TREE_CHUNK_SIZE<=15);
});

test('forest grove ratios target birch 45%, oak 35%, rubber 10%, mixed 10%',()=>{
 const counts={birch:0,oak:0,rubber:0,mixed:0};let n=0;
 for(let z=-4096;z<4096;z+=32)for(let x=-4096;x<4096;x+=32){const species=treeSpeciesAt('grove-distribution',x,z);counts[species]++;n++;}
 for(const [species,target] of Object.entries({birch:.45,oak:.35,rubber:.10,mixed:.10})){
  const share=counts[species]/n;assert.ok(Math.abs(share-target)<.035,`${species} grove share ${(share*100).toFixed(2)}% should be near ${target*100}%`);
 }
});

test('natural entities have stable root-owned chunk IDs and no duplicates at adjacent chunk seams',()=>{
 const chunks=[[-2,-1],[-1,-1],[0,-1],[-2,0],[-1,0],[0,0],[1,0]];
 const all=chunks.flatMap(([cx,cz])=>generateTreesForChunk('seam-test',cx,cz,surface));
 const ids=new Set(all.map(t=>t.id));assert.equal(ids.size,all.length,'tree IDs must be unique across loaded adjacent chunks');
 for(const [cx,cz] of chunks){for(const tree of generateTreesForChunk('seam-test',cx,cz,surface)){
  assert.equal(Math.floor(tree.x/TREE_CHUNK_SIZE),cx);assert.equal(Math.floor(tree.z/TREE_CHUNK_SIZE),cz);
  assert.equal(tree.y,surface(tree.x,tree.z));assert.equal(tree.source,'natural');
 }}
 assert.ok(all.some(t=>t.x===-12&&t.z===0),'a nearby starter tree is guaranteed outside the protected pad');
 const same=chunks.flatMap(([cx,cz])=>generateTreesForChunk('seam-test',cx,cz,surface));
 assert.deepEqual(all.map(key),same.map(key));
});

test('tree sizes meet species height and full crown/trunk width caps without overlap',()=>{
 for(const species of ['oak','birch','rubber'])for(let i=0;i<1000;i++){
  const v=i/1000,d=treeDimensions(species,v);
  if(species==='rubber')assert.ok(d.height>=5&&d.height<=8);else assert.ok(d.height>=7&&d.height<=10);
  assert.ok(d.crownWidth<=4&&d.crownWidth>0);assert.ok(d.trunkWidth<=1.5&&d.trunkWidth>0);
 }
 const trees=[];for(let cz=-10;cz<=10;cz++)for(let cx=-10;cx<=10;cx++)trees.push(...generateTreesForChunk('spacing-test',cx,cz,surface));
 trees.sort((a,b)=>a.x-b.x||a.z-b.z);
 for(let i=0;i<trees.length;i++)for(let j=i+1;j<trees.length&&trees[j].x-trees[i].x<4;j++){
  const a=trees[i],b=trees[j],dx=a.x-b.x,dz=a.z-b.z;
  assert.ok(Math.hypot(dx,dz)>=(a.crownWidth+b.crownWidth)/2,`crowns overlap: ${a.id} / ${b.id}`);
 }
});
