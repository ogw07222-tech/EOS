/** Crop identifiers persisted on crop entities and in the inventory. */
export const CROP_TYPES=Object.freeze(['wheat','carrot','potato']);
export const CROP_STAGE_MS=60_000;
export const MAX_CROP_STAGE=4;

const CROP_ITEMS=Object.freeze({
 wheat:Object.freeze({productItem:'wheat',seedItem:'wheat_seed'}),
 carrot:Object.freeze({productItem:'carrot',seedItem:'carrot_seed'}),
 potato:Object.freeze({productItem:'potato',seedItem:'potato_seed'})
});

function requireCropType(type){
 if(typeof type!=='string'||!Object.hasOwn(CROP_ITEMS,type))throw new RangeError(`Unknown crop type: ${String(type)}`);
 return type;
}

/** Resolve legacy crop entities without cropType as wheat; reject unknown explicit types. */
export function cropTypeOf(crop){
 if(!crop||typeof crop!=='object'||Array.isArray(crop))throw new TypeError('crop must be an object');
 return crop.cropType===undefined||crop.cropType===null||crop.cropType===''?'wheat':requireCropType(crop.cropType);
}

/** Inventory key for the one seed consumed to plant the requested crop. */
export function seedItemForCrop(type){return CROP_ITEMS[requireCropType(type)].seedItem;}

/** Inventory key for the one mature crop item harvested. */
export function productItemForCrop(type){return CROP_ITEMS[requireCropType(type)].productItem;}

/** Fixed anti-inflation yield: exactly one product and one matching seed. */
export function harvestYield(type){
 const items=CROP_ITEMS[requireCropType(type)];
 return {productItem:items.productItem,seedItem:items.seedItem,productQuantity:1,seedQuantity:1};
}

/**
 * Advance one crop using game-time milliseconds. `wetGameMs` is the portion of
 * this tick for which the tile remains watered, so it adds an equal amount of
 * growth and preserves the established 2x watered rate. The input is not
 * mutated; legacy entities get a normalized cropType in the returned object.
 */
export function advanceCrop(crop,gameDeltaMs,wetGameMs=0){
 const cropType=cropTypeOf(crop);
 if(!Number.isFinite(gameDeltaMs)||gameDeltaMs<0)throw new RangeError('gameDeltaMs must be finite and non-negative');
 if(!Number.isFinite(wetGameMs)||wetGameMs<0||wetGameMs>gameDeltaMs)throw new RangeError('wetGameMs must be between zero and gameDeltaMs');
 const stage=crop.stage===undefined?1:crop.stage,progress=crop.progress===undefined?0:crop.progress;
 if(!Number.isInteger(stage)||stage<1||stage>MAX_CROP_STAGE)throw new RangeError(`stage must be an integer from 1 to ${MAX_CROP_STAGE}`);
 if(!Number.isFinite(progress)||progress<0)throw new RangeError('progress must be finite and non-negative');
 let nextStage=stage,nextProgress=progress;
 if(stage<MAX_CROP_STAGE&&gameDeltaMs>0){
  nextProgress+=gameDeltaMs+wetGameMs;
  while(nextProgress>=CROP_STAGE_MS&&nextStage<MAX_CROP_STAGE){nextProgress-=CROP_STAGE_MS;nextStage++;}
 }
 return {...crop,cropType,stage:nextStage,progress:nextProgress};
}
