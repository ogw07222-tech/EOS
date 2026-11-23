// Lightweight shared pixel atlas for terrain meshes. Chunks continue to use
// one merged mesh each; this module only supplies a shared texture and UVs.
export const TERRAIN_ATLAS_TILE_SIZE = 32;
export const TERRAIN_ATLAS_COLUMNS = 8;
export const TERRAIN_ATLAS_ROWS = 6;
export const TERRAIN_ATLAS_WIDTH = TERRAIN_ATLAS_COLUMNS * TERRAIN_ATLAS_TILE_SIZE;
export const TERRAIN_ATLAS_HEIGHT = TERRAIN_ATLAS_ROWS * TERRAIN_ATLAS_TILE_SIZE;

const tileNames = [
  'grass_top','grass_side','grass_bottom','dirt_top','dirt_side','dirt_bottom','stone_top','stone_side','stone_bottom',
  'sand_top','sand_side','sand_bottom','farmland_top','farmland_side','farmland_bottom','coal_top','coal_side','coal_bottom',
  'coal_ore_top','coal_ore_side','coal_ore_bottom','iron_ore_top','iron_ore_side','iron_ore_bottom','copper_ore_top','copper_ore_side','copper_ore_bottom',
  'wood_top','wood_side','wood_bottom','birch_wood_top','birch_wood_side','birch_wood_bottom','rubber_wood_top','rubber_wood_side','rubber_wood_bottom',
  'water_top','water_side','water_bottom','gravel_top','gravel_side','gravel_bottom','brick_top','brick_side','brick_bottom',
  'pale_stone_top','pale_stone_side','pale_stone_bottom',
];
export const TERRAIN_ATLAS_TILES = Object.freeze(Object.fromEntries(tileNames.map((name, index) => [name, Object.freeze({ x: index % TERRAIN_ATLAS_COLUMNS, y: Math.floor(index / TERRAIN_ATLAS_COLUMNS) })])));

const PALETTES = Object.freeze({
  grass: ['#587a4b','#78965c','#6f8f55','#8b9c62','#486e4b'], dirt: ['#76543d','#8b6547','#644933','#9a704e','#b18a61'],
  stone: ['#59656b','#727c7e','#818780','#485258','#9b9b8b'], sand: ['#d2ba83','#e2cc96','#c5a96e','#ead9a7','#bda36f'],
  farmland: ['#594735','#68513a','#745b3f','#493a2e','#98734b'], coal: ['#272e31','#3c4445','#505655','#1c2325','#74746a'],
  wood: ['#60432f','#805a3b','#976f49','#49392f','#b28a5d'], iron_ore: ['#626b6b','#89755f','#b17e5b','#746c61','#c1a27a'],
  copper_ore: ['#5c6865','#a56d48','#bf8051','#687b70','#d09a63'], water: ['#32748a','#418ba0','#5aa0ae','#28647c','#80b4b5'],
  gravel: ['#817d70','#9a907e','#6c6e68','#b4a58c','#686961'], brick: ['#885c49','#a56f56','#704a3c','#b77d5c','#584b40'],
  pale_stone: ['#999888','#b5b29c','#817f75','#c4bea5','#777b78'], birch_wood: ['#d8d0ae','#eee4c5','#aaa486','#55534b','#faf0d5'],
  rubber_wood: ['#47372e','#634638','#78543e','#372e29','#916849'],
});
const BASES = Object.freeze({ grass:'#6f8b55',dirt:'#79583f',stone:'#687176',sand:'#d9c28a',farmland:'#604b36',coal:'#333b3e',wood:'#76553a',iron_ore:'#74716a',copper_ore:'#77766a',water:'#3d8295',gravel:'#898374',brick:'#8a5e49',pale_stone:'#a6a38e',birch_wood:'#d8d0ae',rubber_wood:'#594234' });
const tileParts = name => {
  const match = /^(.*)_(top|side|bottom)$/.exec(name);
  if (!match) return { kind: name, face: 'side' };
  let kind = match[1];
  if (kind === 'coal_ore') kind = 'coal';
  return { kind, face: match[2] };
};
const shade = (hex, amount) => {
  const n = Number.parseInt(hex.slice(1), 16), scale = value => Math.max(0, Math.min(255, Math.round(value * amount)));
  return `#${[scale(n >> 16), scale((n >> 8) & 255), scale(n & 255)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
};
const paletteFor = name => {
  const { kind, face } = tileParts(name), colors = PALETTES[kind] || PALETTES.stone;
  const light = face === 'top' ? 1.08 : face === 'bottom' ? .76 : 1;
  return colors.map(color => shade(color, light));
};
const baseFor = name => {
  const { kind, face } = tileParts(name), light = face === 'top' ? 1.08 : face === 'bottom' ? .76 : 1;
  return shade(BASES[kind] || BASES.stone, light);
};

function coordHash(x, y, z, salt = 0) {
  let n = Math.imul((x | 0) + 101 + salt, 73856093) ^ Math.imul((y | 0) + 211, 19349663) ^ Math.imul((z | 0) + 307, 83492791);
  n = Math.imul(n ^ (n >>> 13), 1274126177); return (n ^ (n >>> 16)) >>> 0;
}

/** Face index follows the chunk mesher: 0 top, 1 bottom, 2–5 sides. */
export function terrainTileForBlock(block, faceIndex = 2) {
  const id = String(block || '').toLowerCase();
  const face = faceIndex === 0 ? 'top' : faceIndex === 1 ? 'bottom' : 'side';
  if (id === 'grass') return `grass_${face}`;
  if (id === 'dirt' || id === 'soil') return `dirt_${face}`;
  if (['farmland','tilled_soil','wet_farmland'].includes(id)) return `farmland_${face}`;
  if (id === 'coal') return `coal_${face}`;
  if (id.includes('coal')) return `coal_ore_${face}`;
  if (id.includes('iron')) return `iron_ore_${face}`;
  if (id.includes('copper')) return `copper_ore_${face}`;
  if (id.includes('sand')) return `sand_${face}`;
  if (id.includes('gravel')) return `gravel_${face}`;
  if (id.includes('water')) return `water_${face}`;
  if (id.includes('brick')) return `brick_${face}`;
  if (id.includes('birch')) return `birch_wood_${face}`;
  if (id.includes('rubber')) return `rubber_wood_${face}`;
  if (id.includes('log') || id.includes('wood') || id.includes('plank')) return `wood_${face}`;
  if (id.includes('pale_stone')) return `pale_stone_${face}`;
  return `stone_${face}`;
}

/** Stable coordinate-based orientation breaks up visible repeated patterns. */
export function terrainTileVariation(block, faceIndex, x, y, z) {
  const h = coordHash(x, y, z, faceIndex * 31);
  if (terrainTileForBlock(block, faceIndex) === 'grass_side') return { rotation: 0, mirrorX: !!(h & 1), mirrorY: false };
  if (terrainTileForBlock(block, faceIndex) === 'grass_top') return { rotation: (h >>> 1) & 3, mirrorX: !!(h & 1), mirrorY: !!(h & 4) };
  return { rotation: (h >>> 1) & 3, mirrorX: false, mirrorY: false };
}

/** UVs use a subpixel inset to avoid texture-atlas bleed on mobile GPUs. */
export function terrainAtlasUv(tileName, u, v, variation = {}, insetPixels = 0.65) {
  const tile = TERRAIN_ATLAS_TILES[tileName] || TERRAIN_ATLAS_TILES.stone;
  let px = variation.mirrorX ? 1 - u : u, py = variation.mirrorY ? 1 - v : v;
  const turns = ((variation.rotation || 0) % 4 + 4) % 4;
  for (let i = 0; i < turns; i++) [px, py] = [py, 1 - px];
  const inset = insetPixels / TERRAIN_ATLAS_TILE_SIZE;
  const localU = inset + px * (1 - inset * 2), localV = inset + py * (1 - inset * 2);
  return [
    (tile.x * TERRAIN_ATLAS_TILE_SIZE + localU * TERRAIN_ATLAS_TILE_SIZE) / (TERRAIN_ATLAS_COLUMNS * TERRAIN_ATLAS_TILE_SIZE),
    1 - (tile.y * TERRAIN_ATLAS_TILE_SIZE + localV * TERRAIN_ATLAS_TILE_SIZE) / (TERRAIN_ATLAS_ROWS * TERRAIN_ATLAS_TILE_SIZE),
  ];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function drawTile(ctx, name, x0, y0, seed) {
  const size = TERRAIN_ATLAS_TILE_SIZE, rand = seededRandom(seed), { kind, face } = tileParts(name), colors = paletteFor(name);
  ctx.fillStyle = baseFor(name); ctx.fillRect(x0, y0, size, size);
  const grassSurface=kind==='grass'&&face==='top';
  for (let y = 0; y < size; y += 4) for (let x = 0; x < size; x += 4) if (rand() < (grassSurface ? 0.09 : 0.28)) { ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(x0 + x, y0 + y, 4, 4); }
  for (let i = 0, n = grassSurface ? 20 : kind === 'sand' ? 48 : 44; i < n; i++) {
    const x = Math.floor(rand() * 16) * 2, y = Math.floor(rand() * 16) * 2;
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(x0 + x, y0 + y, 2, 2);
  }
  if (kind === 'grass' && face === 'top') {
    for (let i = 0; i < 7; i++) { const x = 2 + Math.floor(rand() * 27), y = 2 + Math.floor(rand() * 27),tone=i%3;ctx.fillStyle=tone===0?'#55784d':tone===1?'#82995e':'#6b8953';ctx.fillRect(x0+x,y0+y,3,3);ctx.fillRect(x0+x+2,y0+y-2,2,2);if(tone===1)ctx.fillRect(x0+x-2,y0+y+2,2,2); }
  } else if (kind === 'grass' && face === 'side') {
    ctx.fillStyle = '#658451'; ctx.fillRect(x0, y0, size, 5);
    for (let x = 0; x < size; x += 2) { ctx.fillStyle = rand() > .3 ? '#78965c' : '#4c7048'; ctx.fillRect(x0 + x, y0 + 5, 2, 1 + Math.floor(rand() * 3)); }
    for (let i = 0; i < 10; i++) { ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(x0 + Math.floor(rand() * 15) * 2, y0 + 8 + Math.floor(rand() * 11) * 2, 2, 2); }
  } else if (['stone','iron_ore','copper_ore','pale_stone'].includes(kind)) {
    for (let i = 0; i < 3; i++) { const x = 4 + Math.floor(rand() * 20), y = 4 + Math.floor(rand() * 20); ctx.fillStyle = '#4d585d'; ctx.fillRect(x0 + x, y0 + y, 5, 2); ctx.fillRect(x0 + x + 3, y0 + y + 2, 2, 3); ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(x0 + x + 1, y0 + y - 2, 4, 2); }
    if (kind !== 'stone' && kind !== 'pale_stone') for (let i = 0; i < 8; i++) { ctx.fillStyle = colors[1 + Math.floor(rand() * (colors.length - 1))]; ctx.fillRect(x0 + 4 + Math.floor(rand() * 24), y0 + 4 + Math.floor(rand() * 24), 2, 2); }
  } else if (kind === 'farmland') {
    ctx.fillStyle = '#46382c'; for (let y = 5; y < size; y += 8) ctx.fillRect(x0, y0 + y, size, 2);
    ctx.fillStyle = '#806343'; for (let y = 2; y < size; y += 8) ctx.fillRect(x0, y0 + y, size, 1);
  } else if (kind === 'sand' || kind === 'gravel') {
    for (let i = 0; i < 7; i++) { const x = Math.floor(rand() * 14) * 2, y = Math.floor(rand() * 14) * 2; ctx.fillStyle = colors[Math.floor(rand() * colors.length)]; ctx.fillRect(x0 + x, y0 + y, 3 + Math.floor(rand() * 3), 2); }
  } else if (kind === 'coal') {
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#161d20' : '#66706c'; ctx.fillRect(x0 + 2 + Math.floor(rand() * 26), y0 + 2 + Math.floor(rand() * 26), 3, 2); }
  } else if (['wood','birch_wood','rubber_wood'].includes(kind)) {
    for (let x = 4; x < size; x += 8) { ctx.fillStyle = colors[(x / 4) % colors.length | 0]; ctx.fillRect(x0 + x, y0, 1, size); }
  } else if (kind === 'water') {
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#70aeb2' : '#286b81'; ctx.fillRect(x0 + 3 + Math.floor(rand() * 4), y0 + 4 + i * 7 + Math.floor(rand() * 2), 15 + Math.floor(rand() * 9), 2); }
  } else if (kind === 'brick') {
    ctx.fillStyle = '#5b463c'; ctx.fillRect(x0, y0 + 10, size, 2); ctx.fillRect(x0, y0 + 22, size, 2); ctx.fillRect(x0 + 15, y0, 2, 10); ctx.fillRect(x0 + 7, y0 + 12, 2, 10); ctx.fillRect(x0 + 23, y0 + 12, 2, 10); ctx.fillRect(x0 + 15, y0 + 24, 2, 8);
  }
}

/** Create one shared 256×192 texture. The atlas is about 192 KiB uncompressed. */
export function createTerrainAtlas(THREE, canvasFactory) {
  const makeCanvas = canvasFactory || (() => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(TERRAIN_ATLAS_WIDTH, TERRAIN_ATLAS_HEIGHT);
    if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = TERRAIN_ATLAS_WIDTH; canvas.height = TERRAIN_ATLAS_HEIGHT; return canvas; }
    throw new Error('Terrain atlas needs Canvas or OffscreenCanvas support');
  });
  const canvas = makeCanvas(TERRAIN_ATLAS_WIDTH, TERRAIN_ATLAS_HEIGHT); canvas.width = TERRAIN_ATLAS_WIDTH; canvas.height = TERRAIN_ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('Could not create 2D context for terrain atlas');
  for (const [name, cell] of Object.entries(TERRAIN_ATLAS_TILES)) drawTile(ctx, name, cell.x * TERRAIN_ATLAS_TILE_SIZE, cell.y * TERRAIN_ATLAS_TILE_SIZE, coordHash(cell.x, cell.y, 17));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping; texture.needsUpdate = true;
  return Object.freeze({ texture, canvas, uv: terrainAtlasUv, tileForBlock: terrainTileForBlock, variation: terrainTileVariation, dispose() { texture.dispose(); } });
}
