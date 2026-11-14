import test from 'node:test';
import assert from 'node:assert/strict';
import {applyShopTrade,resolveShopQuantity,ITEM_CAP} from '../src/economy-rules.mjs';

test('farmer shop quantities use server prices and reject unaffordable or full inventory trades',()=>{
 const player={coins:100,inventory:{wheat:12,wheat_seed:0}};
 assert.equal(resolveShopQuantity({selection:'max',action:'buy',item:'wheat_seed',inventory:player.inventory,coins:player.coins}),20);
 assert.equal(resolveShopQuantity({selection:'max',action:'sell',item:'wheat',inventory:player.inventory,coins:player.coins}),12);
 assert.equal(applyShopTrade({player,action:'buy',item:'wheat_seed',quantity:21}).ok,false);
 assert.equal(applyShopTrade({player,action:'buy',item:'wheat_seed',quantity:1}).player.coins,95);
 const full={coins:100,inventory:{wheat_seed:ITEM_CAP}};
 assert.match(applyShopTrade({player:full,action:'buy',item:'wheat_seed',quantity:1}).error,/full/i);
 assert.equal(player.coins,100,'failed/preview trades do not mutate player data');
});

test('wheat sells for catalog value and inventory shortage is rejected atomically',()=>{
 const p={coins:2,inventory:{wheat:1}};
 const sale=applyShopTrade({player:p,action:'sell',item:'wheat',quantity:1});
 assert.equal(sale.ok,true);assert.equal(sale.player.coins,4);assert.equal(sale.player.inventory.wheat,0);
 assert.equal(applyShopTrade({player:p,action:'sell',item:'wheat',quantity:2}).ok,false);
 assert.equal(p.coins,2);assert.equal(p.inventory.wheat,1);
});
