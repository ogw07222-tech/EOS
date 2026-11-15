/** Stable block and inventory identifiers for the first mineral tier. */
export const MINERAL_BLOCKS=Object.freeze(['iron_ore','coal_ore','copper_ore']);
const MINERAL_DROPS=Object.freeze({iron_ore:'iron_ore',coal_ore:'coal',copper_ore:'copper_ore'});
const MINERAL_CORES=Object.freeze({iron_ore:'iron_vein_core',coal_ore:'coal_vein_core',copper_ore:'copper_vein_core'});
const MINERAL_LAYER=Object.freeze({
 iron_ore:{minDepth:9,maxDepth:24,threshold:.685,salt:0x31a4f21d},
 coal_ore:{minDepth:4,maxDepth:19,threshold:.675,salt:0x6b8b4567},
 copper_ore:{minDepth:15,maxDepth:31,threshold:.69,salt:0x2c9277b5}
});

function hashText(value){let h=0x811c9dc5;for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,0x01000193);}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return h>>>0;}
function hash3(seed,x,y,z,salt=0){let h=hashText(seed)^salt;h=Math.imul(h^(Math.imul(x|0,0x9e3779b1)),0x85ebca6b);h=Math.imul(h^(Math.imul(y|0,0xc2b2ae35)),0x27d4eb2f);h=Math.imul(h^(Math.imul(z|0,0x165667b1)),0x85ebca6b);h^=h>>>16;return (h>>>0)/0xffffffff*2-1;}
const fade=t=>t*t*(3-2*t);
function valueNoise3(seed,x,y,z,sx,sy,sz,salt){
 const ax=x/sx,ay=y/sy,az=z/sz,x0=Math.floor(ax),y0=Math.floor(ay),z0=Math.floor(az),tx=fade(ax-x0),ty=fade(ay-y0),tz=fade(az-z0);
 const lerp=(a,b,t)=>a+(b-a)*t;
 const zPlane=iz=>{
  const a=lerp(hash3(seed,x0,y0,iz,salt),hash3(seed,x0+1,y0,iz,salt),tx);
  const b=lerp(hash3(seed,x0,y0+1,iz,salt),hash3(seed,x0+1,y0+1,iz,salt),tx);
  return lerp(a,b,ty);
 };
 return lerp(zPlane(z0),zPlane(z0+1),tz);
}

const inLandingPad=(x,z)=>x>=-6&&x<=5&&z>=-6&&z<=5;

/**
 * Deterministic 3D noise-vein lookup in global block coordinates. Noise is
 * sampled without chunk-local state, so ore bodies cross chunk boundaries.
 * `surfaceY` comes from the shared terrain generator for this X/Z column.
 */
export function mineralAt(seed,x,y,z,surfaceY=0){
 if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!Number.isSafeInteger(z)||!Number.isFinite(surfaceY))return null;
 if(inLandingPad(x,z)||y>=surfaceY-4)return null;

 // A fixed, seed-stable starter coal vein lies just east of the protected
 // landing pad. It straddles the X=16 chunk edge and is reachable by digging.
 const dx=(x-15)/2.65,dz=(z+1)/2.55,depth=(surfaceY-y-8)/3.4;
 const starterShape=dx*dx+dz*dz+depth*depth;
 const starterRoughness=valueNoise3(seed,x,y,z,2.2,2,2.2,0x4f1bbcdc)*.07;
 if(starterShape<=1+starterRoughness)return 'coal_ore';

 const depthBelowSurface=surfaceY-y;
 for(const type of MINERAL_BLOCKS){
  const layer=MINERAL_LAYER[type];if(depthBelowSurface<layer.minDepth||depthBelowSurface>layer.maxDepth)continue;
  // A second fine field roughens the vein margins while the broad field keeps
  // multi-block connected bodies. Both are evaluated at absolute coordinates.
  const broad=valueNoise3(seed,x,y,z,5.4,3.3,5.4,layer.salt);
  const detail=valueNoise3(seed,x+73,y-41,z+109,2.6,1.8,2.6,layer.salt^0x7f4a7c15);
  if(broad+detail*.17>layer.threshold)return type;
 }
 return null;
}

/** Natural ore block -> immediate inventory item. */
export function mineralDrop(blockType){return MINERAL_DROPS[blockType]||null;}

/** Stone is the T0 pickaxe tier; all new minerals require T1. */
export function mineralTier(blockType){if(blockType==='stone')return 0;return Object.hasOwn(MINERAL_LAYER,blockType)?1:null;}
export function pickaxeTier(toolId){if(toolId==='wood_pickaxe')return 0;if(toolId==='stone_pickaxe')return 1;return -1;}
export function canMineMineral(blockType,toolId){const tier=mineralTier(blockType),tool=pickaxeTier(toolId);return tier!==null&&tool>=tier;}

/** Same-type core chance is an independent per-mining-event Bernoulli roll. */
export function mineralCore(blockType){return MINERAL_CORES[blockType]||null;}
export function isCoreDrop(blockType,roll){return !!MINERAL_CORES[blockType]&&Number.isFinite(roll)&&roll>=0&&roll<.005;}
