export const SHOP_HUB_WORLD_ID='terra:shop-hub';
export const PERSONAL_ISLAND_PORTAL=Object.freeze({id:'to_shop_hub',x:-2,y:0,z:0,interactionRadius:6.5,shape:'starship'});
export const WORLD_RULES=Object.freeze({personal:Object.freeze({allowMining:true,allowBuilding:true,allowFarming:true,allowCombat:true,allowInteraction:true,allowDrop:true}),shopHub:Object.freeze({allowMining:false,allowBuilding:false,allowFarming:false,allowCombat:false,allowInteraction:true,allowDrop:false})});
const line=(x0,z0,x1,z1)=>{const out=[];const dx=Math.sign(x1-x0),dz=Math.sign(z1-z0);let x=x0,z=z0;for(;;){out.push({x,y:0,z});if(x===x1&&z===z1)break;if(x!==x1)x+=dx;if(z!==z1)z+=dz;}return out;};
export const SHOP_HUB_LAYOUT=Object.freeze({
 size:{x:96,z:64},floor:{minX:-48,maxX:47,minZ:-32,maxZ:31,y:-1,material:'station'},
 path:{material:'pale_stone',tiles:line(0,13,0,25)},spawn:{x:.5,y:0,z:12.5},
 portals:[{id:'return_to_island',direction:'toPersonal',x:0,y:0,z:25,rotation:0}],
 npcs:[{id:'farmer',type:'farmer',x:-18,y:0,z:-3,interactionRadius:3.2}],
 shops:[{id:'farmer_market',type:'market',x:-18,z:-3},{id:'craft_exchange',type:'exchange',x:18,z:-3},{id:'greenhouse',type:'greenhouse',x:-18,z:11},{id:'expedition_deck',type:'expedition',x:18,z:11}],
 decorations:[{id:'lamp_west',type:'lamp',x:-37,y:0,z:0},{id:'lamp_east',type:'lamp',x:37,y:0,z:0},{id:'lamp_north',type:'lamp',x:0,y:0,z:-26},{id:'lamp_south',type:'lamp',x:0,y:0,z:27}]
});
export function hubInstanceId(playerId,mode='private'){if(mode==='shared')return `${SHOP_HUB_WORLD_ID}:shared`;const id=String(playerId??'');if(!/^[a-f0-9]{32}$/.test(id))throw new TypeError('A valid player id is required');return `${SHOP_HUB_WORLD_ID}:private:${id}`;}
export function createShopHubInstance(playerId,mode='private'){return Object.freeze({worldId:SHOP_HUB_WORLD_ID,instanceId:hubInstanceId(playerId,mode),kind:'shopHub',ownerId:mode==='shared'?null:playerId,rules:WORLD_RULES.shopHub,layout:SHOP_HUB_LAYOUT});}
export function worldRules(kind){return WORLD_RULES[kind]||null;}
export function isWorldActionAllowed(kind,action){const cap={mine:'allowMining',place:'allowBuilding',build:'allowBuilding',farm:'allowFarming',harvest:'allowFarming',combat:'allowCombat',drop:'allowDrop',interact:'allowInteraction',portal:'allowInteraction',trade:'allowInteraction',equip:'allowInteraction'}[action];return !!cap&&worldRules(kind)?.[cap]===true;}
