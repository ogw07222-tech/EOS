import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGreedyChunkMesh, installGreedyAtlasShader } from '../src/greedy-chunk-mesh.js';

function cubeSet(values) { const cells = new Set(values); return (x,y,z) => cells.has(`${x},${y},${z}`) ? 'stone' : null; }
function quadCount(mesh) { return mesh.positions.length / 12; }

test('one isolated voxel emits six correctly oriented exposed quads', () => {
  const mesh = buildGreedyChunkMesh({ getBlock: cubeSet(['0,0,0']), min: [0,0,0], size: [1,1,1] });
  assert.equal(quadCount(mesh), 6);
  assert.equal(mesh.indices.length, 36);
  assert.deepEqual(new Set(mesh.faces.map(face => face.faceIndex)), new Set([0,1,2,3,4,5]));
  assert.equal(mesh.atlasRects.length, mesh.positions.length / 3 * 4);
  assert.equal(mesh.uvs.length, mesh.positions.length / 3 * 2);
});

test('adjacent coplanar cells merge while interior faces are removed', () => {
  const mesh = buildGreedyChunkMesh({ getBlock: cubeSet(['0,0,0','1,0,0']), min: [0,0,0], size: [2,1,1] });
  assert.equal(quadCount(mesh), 6, 'a 2×1×1 prism has six merged exterior rectangles');
  assert.equal(mesh.faces.reduce((sum,face) => sum + face.width * face.height, 0), 10, 'the six rectangles cover ten visible unit faces');
});

test('cavity walls remain exposed and are meshed', () => {
  const cells = [];
  for (let x=0;x<3;x++) for (let y=0;y<3;y++) for (let z=0;z<3;z++) if (!(x===1&&y===1&&z===1)) cells.push(`${x},${y},${z}`);
  const mesh = buildGreedyChunkMesh({ getBlock: cubeSet(cells), min: [0,0,0], size: [3,3,3] });
  assert.equal(quadCount(mesh), 12, 'six outside rectangles plus six cavity walls');
  assert.equal(mesh.faces.reduce((sum,face) => sum + face.width * face.height, 0), 60);
});

test('neighbor halo prevents false chunk seam faces', () => {
  const getBlock = cubeSet(['0,0,0','1,0,0']);
  const westChunk = buildGreedyChunkMesh({ getBlock, min: [0,0,0], size: [1,1,1] });
  assert.equal(quadCount(westChunk), 5, 'the face against the neighboring chunk is culled');
  assert.ok(!westChunk.faces.some(face => face.faceIndex === 3));
});

test('atlas shader repeats UVs within each tile rectangle', () => {
  const material = { userData: {}, onBeforeCompile() {}, customProgramCacheKey() { return 'base'; } };
  installGreedyAtlasShader(material);
  const shader = {
    vertexShader: '#include <common>\nvoid main(){\n#include <uv_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main(){\n#include <map_fragment>\n}',
  };
  material.onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /attribute vec4 atlasRect/);
  assert.match(shader.vertexShader, /vAtlasRect = atlasRect/);
  assert.match(shader.fragmentShader, /fract\(vMapUv\)/);
  assert.match(shader.fragmentShader, /vAtlasRect\.xy \+ terraTileUv \* vAtlasRect\.zw/);
  assert.match(material.customProgramCacheKey(), /terra-greedy-atlas-v1/);
});
