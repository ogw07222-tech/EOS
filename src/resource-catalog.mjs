// Stable inventory identifiers shared by save normalization, server rewards,
// and the browser HUD. Existing resource aliases remain part of save schema 1.
export const RESOURCE_LABELS=Object.freeze({
 wood:'목재',stone:'돌',dirt:'흙',sand:'모래',wheat:'밀',wheat_seed:'밀 씨앗',sapling:'묘목',
 iron_ore:'철 원석',coal:'석탄',coal_block:'석탄 블록',copper_ore:'구리 원석',
 iron_vein_core:'철 광맥 코어',coal_vein_core:'석탄 광맥 코어',copper_vein_core:'구리 광맥 코어',
 oak_log:'참나무 원목',birch_log:'자작나무 원목',rubberwood:'고무나무 원목',
 oak_sapling:'참나무 묘목',birch_sapling:'자작나무 묘목',rubber_sapling:'고무나무 묘목',rubber_sap:'고무 수액',
 carrot:'당근',carrot_seed:'당근 씨앗',potato:'감자',potato_seed:'감자 씨앗'
});
export const RESOURCE_KEYS=Object.freeze(Object.keys(RESOURCE_LABELS));
export const WOOD_LOG_KEYS=Object.freeze(['oak_log','birch_log','rubberwood']);
export const SAPLING_KEYS=Object.freeze(['oak_sapling','birch_sapling','rubber_sapling']);
export const TOOL_NAMES=Object.freeze({
 wood_pickaxe:'나무 곡괭이',stone_pickaxe:'돌 곡괭이',wood_axe:'나무 도끼',wood_shovel:'나무 삽',
 hoe:'나무 괭이',watering_can:'물뿌리개',scythe:'낫'
});
export const MINERAL_TYPES=Object.freeze(['iron_ore','coal_ore','copper_ore']);
export const MINERAL_ITEMS=Object.freeze({iron_ore:'iron_ore',coal_ore:'coal',copper_ore:'copper_ore'});
export const MINERAL_CORES=Object.freeze({iron_ore:'iron_vein_core',coal_ore:'coal_vein_core',copper_ore:'copper_vein_core'});
export const TREE_SPECIES=Object.freeze(['oak','birch','rubber']);
export const TREE_LOGS=Object.freeze({oak:'oak_log',birch:'birch_log',rubber:'rubberwood'});
export const TREE_SAPLINGS=Object.freeze({oak:'oak_sapling',birch:'birch_sapling',rubber:'rubber_sapling'});
export const CROP_TYPES=Object.freeze(['wheat','carrot','potato']);
export const CROP_SEEDS=Object.freeze({wheat:'wheat_seed',carrot:'carrot_seed',potato:'potato_seed'});
export const CROP_PRODUCTS=Object.freeze({wheat:'wheat',carrot:'carrot',potato:'potato'});

export function normalizeResourceInventory(inventory,cap=1_000_000){
 const next={...(inventory&&typeof inventory==='object'&&!Array.isArray(inventory)?inventory:{})};
 for(const id of RESOURCE_KEYS)if(!Number.isSafeInteger(next[id])||next[id]<0||next[id]>cap)next[id]=0;
 return next;
}

// `wood` and `sapling` are legacy aggregate counters. New species counters are
// subtypes of those totals and must be adjusted together when spent/planted.
export function speciesWoodTotal(inventory){return (inventory.wood||0);}
export function speciesSaplingTotal(inventory){return (inventory.sapling||0);}
