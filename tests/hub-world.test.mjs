import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOP_HUB_LAYOUT,SHOP_HUB_WORLD_ID,PERSONAL_ISLAND_PORTAL,createShopHubInstance,isWorldActionAllowed} from '../src/hub-world.mjs';

test('hub has a private world instance, spawn, interaction points and protected capabilities',()=>{
 const a=createShopHubInstance('0123456789abcdef0123456789abcdef'),b=createShopHubInstance('abcdef0123456789abcdef0123456789');
 assert.equal(a.worldId,SHOP_HUB_WORLD_ID);assert.notEqual(a.instanceId,b.instanceId);assert.equal(a.kind,'shopHub');
 assert.equal(SHOP_HUB_LAYOUT.size.x,16);assert.equal(SHOP_HUB_LAYOUT.npcs[0].type,'farmer');assert.equal(SHOP_HUB_LAYOUT.portals[0].direction,'toPersonal');
 assert.equal(PERSONAL_ISLAND_PORTAL.interactionRadius>0,true);
 for(const action of ['mine','place','farm','combat','drop'])assert.equal(isWorldActionAllowed('shopHub',action),false);
 for(const action of ['interact','portal','trade'])assert.equal(isWorldActionAllowed('shopHub',action),true);
});

test('shared instance identity can be selected later without changing the private default',()=>{
 assert.equal(createShopHubInstance('0123456789abcdef0123456789abcdef','shared').instanceId,'terra:shop-hub:shared');
});
