import { treeDimensions } from './tree-world.mjs';
import { cropTypeOf } from './crop-rules.mjs';

const natureMaterialCache = new WeakMap();

/** Create once per THREE runtime; visual groups share materials on every rebuild. */
export function createNatureMaterials(THREE) {
  const cached = natureMaterialCache.get(THREE);
  if (cached) return cached;
  const material = (color, roughness = 0.94) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
  const materials = {
    oakBark: material(0x70503a), oakBarkLight: material(0x8c6647),
    birchBark: material(0xe0d7b9), birchMark: material(0x4a4a3e),
    rubberBark: material(0x514039), rubberTap: material(0xb78346, 0.68),
    oakLeaf: material(0x527b55), oakLeafLight: material(0x6d9360),
    birchLeaf: material(0x76935b), birchLeafLight: material(0x92a96b),
    rubberLeaf: material(0x365e4c), rubberLeafLight: material(0x4b7558),
    wheatGreen: material(0x66864b), wheatGreenLight: material(0x85a858),
    wheatRipe: material(0xc6a449), wheatRipeLight: material(0xe0bf61),
    carrotLeaf: material(0x55874b), carrotLeafLight: material(0x76a75b),
    carrotRoot: material(0xd97635), potatoLeaf: material(0x547c4a),
    potatoLeafLight: material(0x719551), potatoRoot: material(0x9a7651)
  };
  natureMaterialCache.set(THREE, materials);
  return materials;
}

function addBox(THREE, parent, material, width, height, depth, x, y, z, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rz;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function groupAt(THREE, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  return group;
}

/** Build one grouped tree visual in block-space metres; caller owns its placement. */
export function createTreeVisual(THREE, tree, materials = createNatureMaterials(THREE)) {
  if (!tree || !Number.isFinite(tree.x) || !Number.isFinite(tree.z)) throw new TypeError('tree visual requires finite x/z coordinates');
  const species = ['oak', 'birch', 'rubber'].includes(tree.species) ? tree.species : 'oak';
  const variant = Number.isFinite(tree.variant) ? tree.variant : Number.isFinite(tree.scale) ? tree.scale : 0.5;
  const dimensions = treeDimensions(species, variant);
  const height = Number.isFinite(tree.height) ? tree.height : dimensions.height;
  const crownWidth = Math.min(4, Number.isFinite(tree.crownWidth) ? tree.crownWidth : dimensions.crownWidth);
  const trunkWidth = Math.min(1.5, Number.isFinite(tree.trunkWidth) ? tree.trunkWidth : dimensions.trunkWidth);
  const group = groupAt(THREE, tree.x + 0.5, tree.y || 0, tree.z + 0.5);
  group.userData.resourceId = tree.id;
  group.userData.resourceTree = tree;
  group.userData.natureSpecies = species;

  const stage = Number.isInteger(tree.stage) ? Math.max(0, Math.min(3, tree.stage)) : 3;
  const bark = species === 'birch' ? materials.birchBark : species === 'rubber' ? materials.rubberBark : materials.oakBark;
  const leaves = species === 'birch' ? materials.birchLeaf : species === 'rubber' ? materials.rubberLeaf : materials.oakLeaf;
  const leavesLight = species === 'birch' ? materials.birchLeafLight : species === 'rubber' ? materials.rubberLeafLight : materials.oakLeafLight;

  if (stage < 3) {
    const scale = 0.72 + stage * 0.2;
    const stemHeight = Math.min(0.72, height * 0.12) * scale;
    const stemWidth = Math.max(0.11, Math.min(0.24, trunkWidth * 0.22));
    addBox(THREE, group, bark, stemWidth, stemHeight, stemWidth, 0, stemHeight / 2, 0);
    const leafW = 0.26 + stage * 0.12;
    addBox(THREE, group, leaves, leafW, leafW * 0.74, leafW, 0, stemHeight + leafW * 0.18, 0, Math.PI / 4);
    if (stage > 0) addBox(THREE, group, leavesLight, leafW * 0.68, leafW * 0.62, leafW * 0.68, 0.11, stemHeight + leafW * 0.48, 0.04, -Math.PI / 5);
    return group;
  }

  const trunkHeight = height * (species === 'rubber' ? 0.68 : species === 'birch' ? 0.82 : 0.74);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkWidth * 0.43, trunkWidth * 0.5, trunkHeight, 6), bark);
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  if (species === 'birch') {
    for (const [y, side, width] of [[0.24, 1, 0.16], [0.48, -1, 0.12], [0.67, 1, 0.13]]) {
      addBox(THREE, group, materials.birchMark, width, 0.055, 0.018, side * trunkWidth * 0.2, trunkHeight * y, trunkWidth * 0.43, side * 0.1);
    }
  }

  const crownY = height * (species === 'rubber' ? 0.76 : species === 'birch' ? 0.79 : 0.77);
  if (species === 'oak') {
    const coreW = crownWidth * 0.56, coreH = height * 0.23;
    addBox(THREE, group, leaves, coreW, coreH, coreW * 0.92, 0, crownY, 0, Math.PI / 4);
    for (const [x, z, mat, angle] of [[-0.23, 0, leavesLight, -0.08], [0.23, 0, leaves, 0.08], [0, -0.2, leaves, -0.05], [0, 0.2, leavesLight, 0.05]]) {
      addBox(THREE, group, mat, crownWidth * 0.48, height * 0.20, crownWidth * 0.43, x * crownWidth, crownY - height * 0.025, z * crownWidth, angle);
    }
    addBox(THREE, group, leavesLight, crownWidth * 0.34, height * 0.16, crownWidth * 0.33, -0.11 * crownWidth, crownY + height * 0.15, 0.02 * crownWidth, Math.PI / 4);
  } else if (species === 'birch') {
    for (const [y, width, mat, depth] of [[crownY - height * 0.10, 0.54, leaves, 0.48], [crownY + height * 0.07, 0.47, leavesLight, 0.43], [crownY + height * 0.22, 0.37, leaves, 0.35]]) {
      addBox(THREE, group, mat, crownWidth * width, height * 0.19, crownWidth * depth, 0, y, 0, Math.PI / 4);
    }
    addBox(THREE, group, leavesLight, crownWidth * 0.30, height * 0.15, crownWidth * 0.28, 0, crownY + height * 0.34, 0, Math.PI / 4);
  } else {
    addBox(THREE, group, leaves, crownWidth * 0.78, height * 0.18, crownWidth * 0.74, 0, crownY, 0, Math.PI / 4);
    addBox(THREE, group, leavesLight, crownWidth * 0.58, height * 0.13, crownWidth * 0.55, 0, crownY + height * 0.09, 0, Math.PI / 4);
    addBox(THREE, group, leaves, crownWidth * 0.38, height * 0.16, crownWidth * 0.36, 0, crownY + height * 0.20, 0, Math.PI / 4);
    const tapY = trunkHeight * 0.36;
    addBox(THREE, group, materials.rubberTap, 0.12, 0.10, 0.07, trunkWidth * 0.34, tapY, 0.04);
    addBox(THREE, group, materials.rubberTap, 0.08, 0.08, 0.08, trunkWidth * 0.34, tapY - 0.09, 0.04);
  }
  return group;
}

function addLeaf(THREE, group, material, x, y, z, length, width, angle) {
  addBox(THREE, group, material, width, length, width * 0.42, x, y, z, angle);
}

/** Build a crop-stage visual at the crop tile origin; does not alter stage data. */
export function createCropVisual(THREE, crop, materials = createNatureMaterials(THREE)) {
  if (!crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || !Number.isFinite(crop.z)) throw new TypeError('crop visual requires finite x/y/z coordinates');
  const type = cropTypeOf(crop);
  const group = groupAt(THREE, crop.x + 0.5, crop.y, crop.z + 0.5);
  group.userData.resourceId = crop.id;
  group.userData.cropType = type;
  const stage = Math.max(1, Math.min(4, Number.isInteger(crop.stage) ? crop.stage : 4));
  const heights = [0, 0.24, 0.48, 0.72, 1.0];
  const scale = heights[stage];

  if (type === 'wheat') {
    const ripe = stage === 4, transitional = stage === 3;
    const stemMat = ripe ? materials.wheatRipe : transitional ? materials.wheatGreen : materials.wheatGreen;
    const leafMat = ripe ? materials.wheatRipeLight : materials.wheatGreenLight;
    for (const [x, z, fullHeight] of [[-0.13, -0.08, 0.60], [0.11, -0.04, 0.70], [0, 0.13, 0.53]]) {
      const h = fullHeight * scale;
      addBox(THREE, group, stemMat, 0.045, h, 0.045, x, h / 2, z, x * 0.42);
      if (stage === 1) continue;
      addLeaf(THREE, group, leafMat, x - 0.075, h * 0.42, z, h * 0.33, 0.07, -0.55);
      addLeaf(THREE, group, leafMat, x + 0.07, h * 0.63, z, h * 0.28, 0.065, 0.52);
      if (stage === 4) {
        addBox(THREE, group, materials.wheatRipeLight, 0.085, 0.23, 0.09, x + 0.025, h + 0.09, z, -0.18);
        for (let i = 0; i < 3; i++) addBox(THREE, group, materials.wheatRipeLight, 0.07, 0.075, 0.075, x + (i - 1) * 0.047, h + 0.07 + i * 0.055, z + 0.01);
      }
    }
    return group;
  }

  const carrot = type === 'carrot';
  const leaf = carrot ? materials.carrotLeaf : materials.potatoLeaf;
  const leafLight = carrot ? materials.carrotLeafLight : materials.potatoLeafLight;
  const plantHeight = (carrot ? 0.72 : 0.62) * scale;
  const leafCount = stage === 1 ? 2 : stage === 2 ? 4 : stage === 3 ? 5 : 6;
  for (let i = 0; i < leafCount; i++) {
    const angle = (i / leafCount) * Math.PI * 2;
    const radius = stage === 1 ? 0.035 : 0.10;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const length = plantHeight * (0.74 + ((i % 3) * 0.08));
    addLeaf(THREE, group, i % 2 ? leaf : leafLight, x, length * 0.47, z, length, carrot ? 0.09 : 0.13, Math.cos(angle) * 0.52);
  }

  if (stage === 4 && carrot) {
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 5), materials.carrotRoot);
    root.rotation.x = Math.PI;
    root.position.set(0, 0.11, 0);
    root.castShadow = true;
    group.add(root);
  } else if (stage === 4) {
    for (const [x, z] of [[-0.14, -0.07], [0.08, 0.12], [0.12, -0.12]]) {
      const tuber = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), materials.potatoRoot);
      tuber.scale.set(1, 0.7, 0.85);
      tuber.position.set(x, 0.065, z);
      tuber.castShadow = true;
      group.add(tuber);
    }
  }
  return group;
}
