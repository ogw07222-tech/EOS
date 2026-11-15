import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CROP_TYPES,CROP_STAGE_MS,MAX_CROP_STAGE,cropTypeOf,seedItemForCrop,
 productItemForCrop,harvestYield,advanceCrop
} from '../src/crop-rules.mjs';

test('legacy crop entities without cropType remain wheat',()=>{
 assert.equal(cropTypeOf({id:'old-save',stage:4}),'wheat');
 assert.equal(cropTypeOf({cropType:null}),'wheat');
 assert.equal(cropTypeOf({cropType:''}),'wheat');
 assert.equal(seedItemForCrop(cropTypeOf({})), 'wheat_seed');
 assert.deepEqual(advanceCrop({id:'old-save',stage:1,progress:0},0),{id:'old-save',stage:1,progress:0,cropType:'wheat'});
});

test('wheat, carrot, and potato use separate matching seed and product IDs with fixed one-plus-one yield',()=>{
 assert.deepEqual(CROP_TYPES,['wheat','carrot','potato']);
 for(const [type,product,seed] of [['wheat','wheat','wheat_seed'],['carrot','carrot','carrot_seed'],['potato','potato','potato_seed']]){
  assert.equal(productItemForCrop(type),product);assert.equal(seedItemForCrop(type),seed);
  assert.deepEqual(harvestYield(type),{productItem:product,seedItem:seed,productQuantity:1,seedQuantity:1});
 }
});

test('crop growth uses 60,000 game milliseconds per stage and wet duration doubles growth',()=>{
 assert.equal(CROP_STAGE_MS,60_000);assert.equal(MAX_CROP_STAGE,4);
 const dry=advanceCrop({cropType:'carrot',stage:1,progress:0},30_000,0);
 const wet=advanceCrop({cropType:'carrot',stage:1,progress:0},30_000,30_000);
 assert.deepEqual({stage:dry.stage,progress:dry.progress},{stage:1,progress:30_000});
 assert.deepEqual({stage:wet.stage,progress:wet.progress},{stage:2,progress:0});
 const split=advanceCrop({cropType:'potato',stage:2,progress:59_990},5,5);
 assert.deepEqual({stage:split.stage,progress:split.progress},{stage:3,progress:0});
});

test('growth preserves extra progress across stages and never exceeds maturity',()=>{
 const grown=advanceCrop({cropType:'potato',stage:1,progress:10_000},200_000,0);
 assert.equal(grown.stage,MAX_CROP_STAGE);assert.equal(grown.progress,30_000);
 const ripe=advanceCrop({cropType:'potato',stage:4,progress:12_345},500_000,100_000);
 assert.equal(ripe.stage,4);assert.equal(ripe.progress,12_345);
});

test('unknown crops and invalid growth input fail instead of silently becoming another crop',()=>{
 assert.throws(()=>cropTypeOf(null),TypeError);
 assert.throws(()=>cropTypeOf({cropType:'tomato'}),RangeError);
 for(const type of ['tomato',null,1])assert.throws(()=>seedItemForCrop(type),RangeError);
 assert.throws(()=>productItemForCrop('berry'),RangeError);
 assert.throws(()=>harvestYield('unknown'),RangeError);
 assert.throws(()=>advanceCrop({cropType:'wheat'},-1,0),RangeError);
 assert.throws(()=>advanceCrop({cropType:'wheat'},100,101),RangeError);
 assert.throws(()=>advanceCrop({cropType:'wheat',stage:5},0,0),RangeError);
 assert.throws(()=>advanceCrop({cropType:'wheat',progress:-1},0,0),RangeError);
});
