import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRAIN_ATLAS_COLUMNS, TERRAIN_ATLAS_ROWS, TERRAIN_ATLAS_TILE_SIZE, TERRAIN_ATLAS_TILES,
  terrainAtlasUv, terrainTileForBlock, terrainTileVariation,
} from '../src/terrain-atlas.js';

test('terrain material atlas covers the complete compact 256×192 grid', () => {
  assert.equal(Object.keys(TERRAIN_ATLAS_TILES).length, 48);
  assert.equal(TERRAIN_ATLAS_COLUMNS * TERRAIN_ATLAS_TILE_SIZE, 256);
  assert.equal(TERRAIN_ATLAS_ROWS * TERRAIN_ATLAS_TILE_SIZE, 192);
  assert.equal(new Set(Object.values(TERRAIN_ATLAS_TILES).map(({x,y}) => `${x},${y}`)).size, 48);
});

test('block faces select distinct grass turf, soil, stone, sand, and ore tiles', () => {
  assert.equal(terrainTileForBlock('grass', 0), 'grass_top');
  assert.equal(terrainTileForBlock('grass', 1), 'grass_bottom');
  assert.equal(terrainTileForBlock('grass', 4), 'grass_side');
  assert.equal(terrainTileForBlock('dirt', 0), 'dirt_top');
  assert.equal(terrainTileForBlock('dirt', 1), 'dirt_bottom');
  assert.equal(terrainTileForBlock('stone', 0), 'stone_top');
  assert.equal(terrainTileForBlock('stone', 1), 'stone_bottom');
  assert.equal(terrainTileForBlock('sand', 3), 'sand_side');
  assert.equal(terrainTileForBlock('sand', 0), 'sand_top');
  assert.equal(terrainTileForBlock('stone', 2), 'stone_side');
  assert.equal(terrainTileForBlock('coal_ore', 2), 'coal_ore_side');
  assert.equal(terrainTileForBlock('iron_ore', 2), 'iron_ore_side');
  assert.equal(terrainTileForBlock('copper_ore', 2), 'copper_ore_side');
});

test('atlas UV coordinates stay inset within the requested tile', () => {
  for (const [name, tile] of Object.entries(TERRAIN_ATLAS_TILES)) {
    for (const [u,v] of [[0,0],[1,0],[1,1],[0,1]]) {
      const [atlasU, atlasV] = terrainAtlasUv(name, u, v);
      assert.ok(atlasU > tile.x / TERRAIN_ATLAS_COLUMNS && atlasU < (tile.x + 1) / TERRAIN_ATLAS_COLUMNS, `${name} U`);
      assert.ok(atlasV > 1 - (tile.y + 1) / TERRAIN_ATLAS_ROWS && atlasV < 1 - tile.y / TERRAIN_ATLAS_ROWS, `${name} V`);
    }
  }
});

test('terrain texture orientation is deterministic from world coordinates', () => {
  assert.deepEqual(terrainTileVariation('stone', 2, -9, -3, 22), terrainTileVariation('stone', 2, -9, -3, 22));
  const orientations = new Set();
  for (let x = 0; x < 16; x++) orientations.add(JSON.stringify(terrainTileVariation('grass', 2, x, 0, 1)));
  assert.ok(orientations.size > 1, 'coordinate hashing produces visible orientation variants');
  assert.equal(terrainTileVariation('grass', 2, 1, 0, 1).rotation, 0, 'grass turf remains upright');
});
