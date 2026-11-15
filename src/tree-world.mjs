// Deterministic tree and biome primitives. Coordinates are block-space meters;
// tree x/z locate the trunk center at an integer tile coordinate and y is the
// generated terrain surface supplied by the caller.
import {biomeAt as generatedBiomeAt,LEGACY_WORLD_GEN_VERSION,WORLD_GEN_VERSION} from './chunk-world.mjs';
export const TREE_CHUNK_SIZE=16;
export const FOREST_SHARE_TARGET=.4;
export const FOREST_REGION_METERS=144; // 9 chunks across, within 5–15 chunk goal.
const CANDIDATE_SPACING=6;
const STARTER_TREE={x:-12,z:0,species:'oak',variant:.48};

function hash32(seed,x,z,salt=''){
 let h=0x811c9dc5;const text=String(seed)+'|'+salt;
 for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}
 h^=Math.imul(x|0,0x9e3779b1);h=Math.imul(h^(h>>>16),0x85ebca6b);
 h^=Math.imul(z|0,0xc2b2ae35);h=Math.imul(h^(h>>>13),0x27d4eb2f);h^=h>>>15;
 return h>>>0;
}
const rand=(seed,x,z,salt='')=>hash32(seed,x,z,salt)/0x100000000;
const smooth=t=>t*t*(3-2*t);
const lerp=(a,b,t)=>a+(b-a)*t;
function lattice(seed,x,z,salt){return rand(seed,x,z,salt)*2-1;}
function valueNoise(seed,x,z,scale,salt){
 const sx=x/scale,sz=z/scale,x0=Math.floor(sx),z0=Math.floor(sz),tx=smooth(sx-x0),tz=smooth(sz-z0);
 const a=lattice(seed,x0,z0,salt),b=lattice(seed,x0+1,z0,salt),c=lattice(seed,x0,z0+1,salt),d=lattice(seed,x0+1,z0+1,salt);
 return lerp(lerp(a,b,tx),lerp(c,d,tx),tz);
}
function forestField(seed,x,z){return valueNoise(seed,x,z,FOREST_REGION_METERS,'biome');}
function validatePoint(x,z){if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('tree coordinates must be finite');}

/** Smooth seed-based Forest/Plains field. The anchor neighborhood is reserved as plains. */
export function biomeAt(seed,x,z){
 validatePoint(x,z);
 if(x>=-8&&x<=7&&z>=-8&&z<=7)return 'plains';
 // Smooth value noise has a compact, symmetric distribution. This threshold
 // yields approximately 40% forest over broad windows; only the small spawn
 // reservation departs from the field.
 return forestField(seed,x,z)>.15?'forest':'plains';
}

function regionSpecies(seed,regionX,regionZ){
 const value=rand(seed,regionX,regionZ,'forest-species');
 if(value<.45)return 'birch';
 if(value<.80)return 'oak';
 if(value<.90)return 'rubber';
 return 'mixed';
}
function speciesRegion(seed,x,z){
 const size=FOREST_REGION_METERS,gx=Math.floor(x/size),gz=Math.floor(z/size);let nearest=null;
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
  const rx=gx+dx,rz=gz+dz,jx=(rand(seed,rx,rz,'species-jx')-.5)*size*.34,jz=(rand(seed,rx,rz,'species-jz')-.5)*size*.34;
  const px=(rx+.5)*size+jx,pz=(rz+.5)*size+jz,d=(x-px)**2+(z-pz)**2;
  if(!nearest||d<nearest.d)nearest={rx,rz,d};
 }
 return regionSpecies(seed,nearest.rx,nearest.rz);
}

/** Forest grove type for a coordinate, including the designated mixed-grove share. */
export function treeSpeciesAt(seed,x,z){
 validatePoint(x,z);return speciesRegion(seed,x,z);
}

function unitVariant(variant){if(!Number.isFinite(variant))return .5;return Math.max(0,Math.min(0.999999,variant));}
/** Species dimensions in meters. crownWidth is the full horizontal envelope. */
export function treeDimensions(species,variant=.5){
 const v=unitVariant(variant);
 if(species==='oak')return {height:7+Math.floor(v*4),crownWidth:3.2+v*.8,trunkWidth:1+v*.5};
 if(species==='birch')return {height:7+Math.floor(v*4),crownWidth:2.8+v*.9,trunkWidth:.45+v*.4};
 if(species==='rubber')return {height:5+Math.floor(v*4),crownWidth:2.6+v*.9,trunkWidth:.8+v*.55};
 throw new RangeError(`Unknown tree species: ${species}`);
}

function naturalTree(seed,x,z,surfaceAt,speciesOverride=null,variantOverride=null){
 const variant=variantOverride??rand(seed,x,z,'tree-variant');
 const grove=treeSpeciesAt(seed,x,z),species=speciesOverride??(grove==='mixed'?(rand(seed,x,z,'mixed-tree')<.55?'oak':'birch'):grove),dimensions=treeDimensions(species,variant),surfaceY=surfaceAt(x,z);
 if(!Number.isFinite(surfaceY))throw new TypeError(`surfaceAt(${x},${z}) must return a finite height`);
 return {id:`natural-tree:${String(seed)}:${x},${z}`,source:'natural',x,y:surfaceY,z,species,grove,...dimensions,stage:3,progress:0,harvested:false};
}

/**
 * Generate trees owned by one 16×16 chunk. Each root belongs to exactly one
 * chunk by floor(x/16),floor(z/16), so overlapping crowns do not duplicate
 * entities when adjacent chunks are generated. surfaceAt must be deterministic.
 */
export function generateTreesForChunk(seed,cx,cz,surfaceAt,genVersion=LEGACY_WORLD_GEN_VERSION){
 if(!Number.isInteger(cx)||!Number.isInteger(cz))throw new TypeError('chunk coordinates must be integers');
 if(typeof surfaceAt!=='function')throw new TypeError('surfaceAt must be a function');
 const minX=cx*TREE_CHUNK_SIZE,minZ=cz*TREE_CHUNK_SIZE,maxX=minX+TREE_CHUNK_SIZE,maxZ=minZ+TREE_CHUNK_SIZE,out=[];
 // A single deterministic starter tree remains just outside the reserved flat pad.
 if(Math.floor(STARTER_TREE.x/TREE_CHUNK_SIZE)===cx&&Math.floor(STARTER_TREE.z/TREE_CHUNK_SIZE)===cz)
  out.push(naturalTree(seed,STARTER_TREE.x,STARTER_TREE.z,surfaceAt,STARTER_TREE.species,STARTER_TREE.variant));
 const minCellX=Math.floor(minX/CANDIDATE_SPACING)-1,maxCellX=Math.floor((maxX-1)/CANDIDATE_SPACING)+1;
 const minCellZ=Math.floor(minZ/CANDIDATE_SPACING)-1,maxCellZ=Math.floor((maxZ-1)/CANDIDATE_SPACING)+1;
 for(let cellZ=minCellZ;cellZ<=maxCellZ;cellZ++)for(let cellX=minCellX;cellX<=maxCellX;cellX++){
  const x=cellX*CANDIDATE_SPACING+2+Math.floor(rand(seed,cellX,cellZ,'tree-x')*3);
  const z=cellZ*CANDIDATE_SPACING+2+Math.floor(rand(seed,cellX,cellZ,'tree-z')*3);
  if(x<minX||x>=maxX||z<minZ||z>=maxZ||Math.hypot(x,z)<15||Math.hypot(x-STARTER_TREE.x,z-STARTER_TREE.z)<4.1)continue;
  const biome=genVersion===WORLD_GEN_VERSION?generatedBiomeAt(seed,x,z,genVersion):biomeAt(seed,x,z),density=rand(seed,cellX,cellZ,'tree-presence');
  if(genVersion===WORLD_GEN_VERSION&&!['plains','forest'].includes(biome))continue;
  const localDensity=.68+.22*(valueNoise(seed,x,z,72,'forest-density')+1)/2;
  const probability=biome==='forest'?localDensity:.025;
  if(density>=probability)continue;
  const region=speciesRegion(seed,x,z);let species;
  if(region==='mixed')species=rand(seed,cellX,cellZ,'mixed-tree')<.55?'oak':'birch';
  else species=region;
  out.push(naturalTree(seed,x,z,surfaceAt,species,rand(seed,cellX,cellZ,'tree-variant')));
 }
 return out.sort((a,b)=>a.x-b.x||a.z-b.z||a.id.localeCompare(b.id));
}
