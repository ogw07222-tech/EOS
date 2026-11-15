import { TERRAIN_ATLAS_TILES, TERRAIN_ATLAS_TILE_SIZE, TERRAIN_ATLAS_COLUMNS, TERRAIN_ATLAS_ROWS, terrainTileForBlock, terrainTileVariation } from './terrain-atlas.js';

const AXES = [[0,1,2],[1,2,0],[2,0,1]]; // (normal, u, v), cyclic for outward winding
const DIRECTIONS = Object.freeze({ '+0': 3, '-0': 2, '+1': 0, '-1': 1, '+2': 5, '-2': 4 });
const solid = value => value !== null && value !== undefined && value !== false && value !== 'air';
const coordKey = p => `${p[0]},${p[1]},${p[2]}`;

function tileRect(name, insetPixels = 0.65) {
  const tile = TERRAIN_ATLAS_TILES[name] || TERRAIN_ATLAS_TILES.stone;
  const inset = insetPixels / TERRAIN_ATLAS_TILE_SIZE;
  const w = 1 / TERRAIN_ATLAS_COLUMNS, h = 1 / TERRAIN_ATLAS_ROWS;
  // Rect order: lower-left UV, then width/height, matching Three's UV origin.
  return [tile.x * w + inset * w, 1 - (tile.y + 1) * h + inset * h, w * (1 - inset * 2), h * (1 - inset * 2)];
}
function transformedUv(u, v, variation) {
  if (variation.mirrorX) u = -u;
  if (variation.mirrorY) v = -v;
  switch (variation.rotation & 3) {
    case 1: return [v, -u];
    case 2: return [-u, -v];
    case 3: return [-v, u];
    default: return [u, v];
  }
}

/**
 * Build exposed voxel faces into greedy, coplanar rectangles.
 *
 * getBlock(x,y,z) MUST read neighboring columns beyond this chunk as well as
 * the chunk's own cells. That neighbor halo avoids fake seam faces. `min` is
 * the world-space cell origin and `size` is the owned cell extent. Output is
 * plain typed arrays for easy conversion to THREE.BufferGeometry.
 *
 * Returned `uv` values repeat in block units. `atlasRect` is the inset atlas
 * rectangle repeated per vertex. Use installGreedyAtlasShader(material) to
 * sample `fract(vMapUv)` inside that rectangle without stretching or bleeding.
 */
export function buildGreedyChunkMesh({ getBlock, min = [0,0,0], size, tileForBlock = terrainTileForBlock, variationForFace = terrainTileVariation }) {
  if (typeof getBlock !== 'function') throw new TypeError('getBlock(x,y,z) callback is required');
  if (!Array.isArray(min) || min.length !== 3 || !Array.isArray(size) || size.length !== 3 || size.some(n => !Number.isInteger(n) || n < 1)) throw new TypeError('min and positive integer size [x,y,z] are required');
  const positions = [], normals = [], uvs = [], atlasRects = [], indices = [], faces = [];
  const dims = size;
  for (let d = 0; d < 3; d++) {
    const [axis, uAxis, vAxis] = AXES[d], uSize = dims[uAxis], vSize = dims[vAxis];
    for (let slice = -1; slice < dims[axis]; slice++) {
      const mask = new Array(uSize * vSize).fill(null);
      for (let j = 0; j < vSize; j++) for (let i = 0; i < uSize; i++) {
        const low = [...min], high = [...min]; low[axis] += slice; high[axis] += slice + 1; low[uAxis] += i; high[uAxis] += i; low[vAxis] += j; high[vAxis] += j;
        const a = getBlock(...low), b = getBlock(...high), aSolid = solid(a), bSolid = solid(b);
        if (aSolid === bSolid) continue;
        const sign = aSolid ? 1 : -1, block = aSolid ? a : b;
        const tile = tileForBlock(block, DIRECTIONS[`${sign > 0 ? '+' : '-'}${axis}`], ...(aSolid ? low : high));
        mask[j * uSize + i] = { block, tile, sign };
      }
      for (let j = 0; j < vSize; j++) for (let i = 0; i < uSize;) {
        const entry = mask[j * uSize + i]; if (!entry) { i++; continue; }
        let w = 1;
        while (i + w < uSize && sameFace(entry, mask[j * uSize + i + w])) w++;
        let h = 1, canGrow = true;
        while (j + h < vSize && canGrow) {
          for (let x = 0; x < w; x++) if (!sameFace(entry, mask[(j + h) * uSize + i + x])) { canGrow = false; break; }
          if (canGrow) h++;
        }
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) mask[(j + yy) * uSize + i + xx] = null;
        const plane = [...min]; plane[axis] += slice + 1; plane[uAxis] += i; plane[vAxis] += j;
        const du = [0,0,0], dv = [0,0,0]; du[uAxis] = w; dv[vAxis] = h;
        const corners = [plane, add(plane, du), add(add(plane, du), dv), add(plane, dv)];
        if (entry.sign < 0) corners.reverse();
        const faceIndex = DIRECTIONS[`${entry.sign > 0 ? '+' : '-'}${axis}`], origin = [...min]; origin[axis] += slice + 1; origin[uAxis] += i; origin[vAxis] += j;
        const variation = variationForFace(entry.block, faceIndex, ...origin) || { rotation: 0 };
        const rect = tileRect(entry.tile), base = positions.length / 3;
        for (let c = 0; c < 4; c++) {
          const corner = corners[c], localU = corner[uAxis] - plane[uAxis], localV = corner[vAxis] - plane[vAxis];
          const [tu,tv] = transformedUv(faceIndex === 2 || faceIndex === 3 ? localV : localU, faceIndex === 2 || faceIndex === 3 ? localU : localV, variation);
          positions.push(...corner); normals.push(...(axis === 0 ? [entry.sign,0,0] : axis === 1 ? [0,entry.sign,0] : [0,0,entry.sign]));
          uvs.push(tu,tv); atlasRects.push(...rect);
        }
        indices.push(base,base+1,base+2,base,base+2,base+3);
        faces.push({ block: entry.block, tile: entry.tile, faceIndex, min: origin, width: w, height: h, indexStart: indices.length - 6 });
        i += w;
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), atlasRects: new Float32Array(atlasRects), indices: new Uint32Array(indices), faces };
}
function sameFace(a,b) { return !!a && !!b && a.sign === b.sign && a.tile === b.tile && a.block === b.block; }
function add(a,b) { return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }

/** Attach atlas-aware repeat sampling to a MeshLambert/Standard/Phong material. */
export function installGreedyAtlasShader(material) {
  if (!material || typeof material !== 'object') throw new TypeError('A Three.js material is required');
  if (material.userData?.terraGreedyAtlas) return material;
  material.userData ||= {}; material.userData.terraGreedyAtlas = true;
  const priorCompile = material.onBeforeCompile;
  material.onBeforeCompile = function(shader, renderer) {
    priorCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 atlasRect;\nvarying vec4 vAtlasRect;');
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvAtlasRect = atlasRect;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vAtlasRect;');
    const mapChunk = '#include <map_fragment>';
    const tiled = `#ifdef USE_MAP
	vec2 terraTileUv = fract(vMapUv);
	terraTileUv = vAtlasRect.xy + terraTileUv * vAtlasRect.zw;
	vec4 sampledDiffuseColor = texture2D( map, terraTileUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`;
    if (!shader.fragmentShader.includes(mapChunk)) throw new Error('Three.js map fragment chunk was not found; greedy atlas UV repeat cannot be installed');
    shader.fragmentShader = shader.fragmentShader.replace(mapChunk, tiled);
  };
  const oldKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${oldKey ? oldKey() : ''}|terra-greedy-atlas-v1`;
  material.needsUpdate = true;
  return material;
}

/** Convert the returned arrays into a standard indexed Three.js geometry. */
export function createGreedyChunkGeometry(THREE, meshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
  geometry.setAttribute('atlasRect', new THREE.Float32BufferAttribute(meshData.atlasRects, 4));
  if (meshData.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
  return geometry;
}
