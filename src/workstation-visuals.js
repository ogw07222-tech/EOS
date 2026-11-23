const workstationMaterials = new WeakMap();

const PALETTE = Object.freeze({
  timber: { color: 0x70513a, roughness: 0.94 }, timberLight: { color: 0xbb9160, roughness: 0.9 },
  timberDark: { color: 0x48362b, roughness: 0.98 }, iron: { color: 0x314c50, metalness: 0.18, roughness: 0.84 },
  steel: { color: 0x719995, metalness: 0.32, roughness: 0.62 }, silver: { color: 0xb7b9ae, metalness: 0.28, roughness: 0.58 },
  brass: { color: 0xb88b4b, metalness: 0.24, roughness: 0.72 }, stone: { color: 0x77766d, roughness: 1 },
  stoneDark: { color: 0x50534f, roughness: 1 }, soil: { color: 0x554333, roughness: 1 }, leaf: { color: 0x668753, roughness: 1 },
  leafLight: { color: 0x91a966, roughness: 1 }, water: { color: 0x4f91a0, roughness: 0.42 }, clay: { color: 0xa45f42, roughness: 0.92 }
});

const BOX_FACES = [
  { n: [0,0,1], p: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
  { n: [0,0,-1], p: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
  { n: [0,1,0], p: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]] },
  { n: [0,-1,0], p: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] },
  { n: [1,0,0], p: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]] },
  { n: [-1,0,0], p: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]] }
];

/** Create static station models with geometry merged by material. */
export function createWorkstationVisuals(THREE) {
  if (!THREE?.Group || !THREE?.BufferGeometry || !THREE?.MeshStandardMaterial || !THREE?.Mesh) throw new TypeError('A Three.js namespace is required');
  let materials = workstationMaterials.get(THREE);
  if (!materials) {
    materials = Object.fromEntries(Object.entries(PALETTE).map(([name, config]) => { const material = new THREE.MeshStandardMaterial(config); material.userData ||= {}; material.userData.terraWorkstationShared = true; return [name, material]; }));
    workstationMaterials.set(THREE, materials);
  }
  const geometryCache = new Map();
  const sharedGeometries = new WeakSet();
  const createRoot = spec => {
    const root = new THREE.Group();
    for (const batch of spec.batches) {
      const mesh = new THREE.Mesh(batch.geometry, materials[batch.material]);
      mesh.name = `workstation-${batch.material}`; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    }
    root.userData.facilityType = spec.type;
    root.userData.floorOffset = -spec.modelAabb.min[1];
    root.userData.modelAabb = { min: [...spec.modelAabb.min], max: [...spec.modelAabb.max] };
    root.userData.footprint = { width: spec.modelAabb.max[0] - spec.modelAabb.min[0], depth: spec.modelAabb.max[2] - spec.modelAabb.min[2] };
    root.userData.sharedWorkstationMaterials = true;
    root.userData.sharedWorkstationGeometry = true;
    root.userData.visualSignature = [...spec.visualSignature];
    return root;
  };
  const create = type => {
    if (geometryCache.has(type)) return createRoot(geometryCache.get(type));
    const builders = new Map();
    const target = material => {
      if (!builders.has(material)) builders.set(material, { positions: [], normals: [], indices: [], partCount: 0 });
      return builders.get(material);
    };
    const pushVertex = (out, p, n) => { out.positions.push(...p); out.normals.push(...n); };
    const rotate = (v, rz = 0, ry = 0) => {
      const cz = Math.cos(rz), sz = Math.sin(rz), cy = Math.cos(ry), sy = Math.sin(ry);
      const xz = v[0] * cz - v[1] * sz, yz = v[0] * sz + v[1] * cz;
      return [xz * cy + v[2] * sy, yz, -xz * sy + v[2] * cy];
    };
    const box = (material, x, y, z, w, h, d, rz = 0, ry = 0) => {
      const out = target(material), base = out.positions.length / 3; out.partCount++;
      for (let faceIndex = 0; faceIndex < BOX_FACES.length; faceIndex++) {
        const face = BOX_FACES[faceIndex];
        const n = rotate(face.n, rz, ry);
        for (const v of face.p) {
          const r = rotate([v[0] * w / 2, v[1] * h / 2, v[2] * d / 2], rz, ry);
          pushVertex(out, [x + r[0], y + r[1], z + r[2]], n);
        }
        const faceBase = base + faceIndex * 4;
        out.indices.push(faceBase, faceBase + 1, faceBase + 2, faceBase, faceBase + 2, faceBase + 3);
      }
    };
    const cylinder = (material, x, y, z, radiusTop, radiusBottom, height, axis = 'y', segments = 10) => {
      const out = target(material), start = out.positions.length / 3; out.partCount++;
      const point = (r, a, axial) => axis === 'x' ? [axial, r * Math.cos(a), r * Math.sin(a)] : axis === 'z' ? [r * Math.cos(a), r * Math.sin(a), axial] : [r * Math.cos(a), axial, r * Math.sin(a)];
      const normal = (a, axial) => axis === 'x' ? [axial, Math.cos(a), Math.sin(a)] : axis === 'z' ? [Math.cos(a), Math.sin(a), axial] : [Math.cos(a), axial, Math.sin(a)];
      for (let i = 0; i <= segments; i++) {
        const a = i / segments * Math.PI * 2;
        for (const [r, axial] of [[radiusBottom, -height / 2], [radiusTop, height / 2]]) {
          const p = point(r, a, axial), n = normal(a, 0);
          pushVertex(out, [x + p[0], y + p[1], z + p[2]], n);
        }
      }
      for (let i = 0; i < segments; i++) {
        const a = start + i * 2, b = a + 2;
        if (axis !== 'y') out.indices.push(a, b + 1, a + 1, a, b, b + 1);
        else out.indices.push(a, a + 1, b + 1, a, b + 1, b);
      }
      for (const top of [false, true]) {
        const capStart = out.positions.length / 3, axial = top ? height / 2 : -height / 2, r = top ? radiusTop : radiusBottom, n = axis === 'x' ? [top ? 1 : -1,0,0] : axis === 'z' ? [0,0,top ? 1 : -1] : [0,top ? 1 : -1,0];
        const center = axis === 'x' ? [x + axial, y, z] : axis === 'z' ? [x, y, z + axial] : [x, y + axial, z];
        pushVertex(out, center, n);
        for (let i = 0; i <= segments; i++) {
          const p = point(r, i / segments * Math.PI * 2, axial);
          pushVertex(out, [x + p[0], y + p[1], z + p[2]], n);
        }
        for (let i = 0; i < segments; i++) {
          const positiveWinding = axis === 'y' ? !top : top;
          if (positiveWinding) out.indices.push(capStart, capStart + i + 1, capStart + i + 2);
          else out.indices.push(capStart, capStart + i + 2, capStart + i + 1);
        }
      }
    };
    const legs = () => {
      for (const x of [-0.39, 0.39]) for (const z of [-0.34, 0.34]) {
        box('timberDark', x*.94, 0.31, z, 0.085, 0.60, 0.10, Math.sign(x)*.11);
        box('timberLight', x, 0.08, z, 0.14, 0.09, 0.14);
      }
      for (const z of [-.30,0,.30]) box('timberLight', 0, .64, z, .94, .09, .28);
      for (const x of [-.36,.36]) box('iron', x, .29, 0, .055, .065, .71);
      box('timber', 0, 0.70, 0, 0.90, 0.035, 0.78);
    };
    const toolRack = (material = 'timberDark') => {
      for (const x of [-0.37, 0.37]) box(material, x, 0.91, -0.34, 0.055, 0.45, 0.06);
      box('timberLight', 0, 1.12, -0.34, 0.80, 0.07, 0.06);
      // Hanging hammer, pick and hand saw read from their outlines.
      box('timber', -0.21, 0.90, -0.28, 0.035, 0.26, 0.035, 0, -0.08);
      box('steel', -0.21, 1.01, -0.28, 0.20, 0.055, 0.07);
      box('timber', 0.02, 0.89, -0.28, 0.035, 0.22, 0.035);
      box('steel', 0.02, 0.99, -0.28, 0.19, 0.035, 0.055);
      box('timber', 0.23, 0.88, -0.28, 0.035, 0.24, 0.035, 0, 0.12);
      box('silver', 0.23, 0.97, -0.28, 0.20, 0.045, 0.035, 0, 0.12);
    };
    const maker = {
      workbench() {
        legs();
        box('timberDark', 0, 0.45, 0.05, 0.74, 0.22, 0.64);
        for (const y of [0.40, 0.51]) {
          box('timberLight', 0, y, 0.378, 0.65, 0.065, 0.018);
          box('brass', 0, y, 0.392, 0.045, 0.025, 0.022);
        }
        box('timberLight', .22,.77,.03,.26,.10,.31);
        // Open-front joiner's vise, screw and jaw, made as tactile metal parts.
        box('iron', -0.26, 0.79, 0.22, 0.23, 0.07, 0.20);
        box('silver', -0.26, 0.84, 0.22, 0.28, 0.055, 0.09);
        box('brass', -0.37, 0.91, 0.22, 0.045, 0.15, 0.08);
        box('brass', -0.15, 0.91, 0.22, 0.045, 0.15, 0.08);
        cylinder('steel', -0.26, 0.77, 0.11, 0.018, 0.018, 0.28, 'z', 8);
        cylinder('brass', -0.40, 0.77, 0.11, 0.04, 0.04, 0.055, 'z', 8);
        toolRack();
      },
      t1_bench() {
        legs();
        // A rough carpenter's bench with a central planing jig and hand-crank.
        box('timberDark', 0, 0.46, 0, 0.76, 0.23, 0.62);
        box('stone', -0.22, 0.82, -0.02, 0.33, 0.12, 0.38);
        box('timberLight', -0.22, 0.90, -0.02, 0.36, 0.04, 0.42);
        box('iron', 0.20, 0.83, -0.02, 0.09, 0.32, 0.11);
        box('timber', 0.20, 1.01, -0.02, 0.36, 0.055, 0.07);
        cylinder('iron', 0.36, 0.83, 0.02, 0.09, 0.09, 0.045, 'z', 12);
        cylinder('timberLight', 0.36, 0.83, 0.02, 0.025, 0.025, 0.17, 'z', 8);
        box('timber', 0,.38,-.32,.73,.09,.08);
        // One low peg rail adds a different silhouette while keeping the tool handmade.
        for (const x of [-0.35, 0.35]) box('timberDark', x, 0.91, -0.32, 0.05, 0.40, 0.05);
        box('timberLight', 0, 1.10, -0.32, 0.74, 0.06, 0.06);
      },
      tool_bench() {
        legs();
        cylinder('stone', .23,1.01,.02,.16,.16,.09,'x',12);
        // Faceted anvil on the left and a hand-worked tool rail on the right.
        box('timberDark', 0, 0.47, 0.04, 0.75, 0.23, 0.65);
        box('iron', -0.25, 0.78, 0.03, 0.24, 0.18, 0.30);
        box('steel', -0.25, 0.89, 0.03, 0.34, 0.07, 0.27);
        box('silver', -0.43, 0.90, 0.03, 0.09, 0.09, 0.20);
        cylinder('iron', -0.25, 0.70, 0.03, 0.07, 0.10, 0.23, 'y', 8);
        box('timber', 0.27, 0.82, 0.03, 0.34, 0.22, 0.35);
        box('stoneDark', 0.27, 0.94, 0.03, 0.30, 0.035, 0.30);
        toolRack();
      },
      agriculture_bench() {
        legs();
        box('timberDark', -0.19, 0.48, 0.02, 0.48, 0.22, 0.60);
        for (const x of [-.34,.34]) box('timberLight', x,1.01,-.34,.05,.55,.05);
        box('leafLight',0,1.26,-.26,.8,.055,.24);
        // Divided propagation tray and seedlings.
        box('timber', -0.21, 0.80, -0.01, 0.45, 0.13, 0.55);
        box('soil', -0.21, 0.87, -0.01, 0.41, 0.035, 0.50);
        for (const x of [-0.34, -0.21, -0.08]) for (const z of [-0.14, 0.10]) {
          box('leaf', x, 0.94, z, 0.035, 0.14, 0.035);
          box('leafLight', x - 0.035, 0.96, z, 0.11, 0.035, 0.045, 0, -0.42);
          box('leafLight', x + 0.035, 1.00, z, 0.10, 0.035, 0.045, 0, 0.42);
        }
        // Water trough, a small watering can, and visible seed drawers.
        box('stoneDark', 0.27, 0.79, 0.04, 0.28, 0.16, 0.48);
        box('water', 0.27, 0.88, 0.04, 0.23, 0.02, 0.40);
        cylinder('brass', 0.26, 0.96, 0.04, 0.065, 0.075, 0.13, 'y', 10);
        box('silver', 0.34, 0.96, 0.04, 0.17, 0.025, 0.025, 0, -0.18);
        for (const x of [-0.29, 0.13]) {
          box('timberDark', x, 0.48, 0.40, 0.26, 0.15, 0.12);
          box('brass', x, 0.48, 0.47, 0.07, 0.025, 0.02);
        }
      },
      farming_bench() { this.agriculture_bench(); },
      block_bench() {
        legs();
        box('stoneDark', 0, 0.65, 0, 0.92, 0.10, 0.80);
        box('stone', 0, 0.71, 0, 0.85, 0.035, 0.72);
        cylinder('silver',-.21,.98,-.06,.20,.20,.045,'z',12);
        // Three prepared masonry samples and a broad diamond-cut slab.
        for (const [x,y,z,material] of [[0.29,0.79,-0.18,'stone'],[0.34,0.86,-0.18,'timberLight'],[0.28,0.92,-0.18,'stoneDark']]) box(material, x, y, z, 0.29, 0.12, 0.26);
        box('stone', -0.25, 0.81, 0.02, 0.35, 0.18, 0.44);
        box('silver', -0.25, 0.92, 0.02, 0.31, 0.045, 0.40);
        // Saw bow and toothed cutting bed, recognizable from a distance.
        box('steel', -0.40, 0.94, -0.31, 0.045, 0.47, 0.045);
        box('iron', -0.10, 1.14, -0.31, 0.58, 0.045, 0.045);
        box('steel', 0.20, 0.94, -0.31, 0.045, 0.42, 0.045);
        box('silver', -0.10, 0.86, 0.31, 0.45, 0.025, 0.055);
        for (let i = 0; i < 7; i++) box('iron', -0.29 + i * 0.065, 0.89, 0.31, 0.012, 0.018, 0.05);
      },
      basic_assembler() {
        legs();
        cylinder('iron',.25,1.02,.18,.16,.16,.06,'z',10);
        // Hand-built firebox and manual press. No electronics or glowing panels.
        box('stoneDark', -0.21, 0.73, 0.02, 0.43, 0.45, 0.49);
        box('iron', -0.21, 0.73, 0.275, 0.32, 0.31, 0.028);
        box('clay', -0.21, 0.73, 0.295, 0.22, 0.20, 0.012);
        box('timberDark', 0.21, 0.74, 0, 0.42, 0.36, 0.48);
        for (const x of [0.08, 0.34]) box('iron', x, 0.97, -0.22, 0.05, 0.50, 0.05);
        box('timberLight', 0.21, 1.23, -0.22, 0.34, 0.06, 0.06);
        box('steel', 0.21, 1.05, -0.22, 0.065, 0.35, 0.065);
        box('iron', 0.21, 0.86, 0.02, 0.32, 0.06, 0.30);
        // Hand crank with a toothed, non-emissive brass wheel.
        cylinder('brass', 0.35, 0.93, 0.18, 0.11, 0.11, 0.045, 'z', 12);
        cylinder('iron', 0.35, 0.93, 0.207, 0.032, 0.032, 0.035, 'z', 10);
        box('timber', 0.35, 1.09, 0.18, 0.045, 0.30, 0.045);
        cylinder('timberLight', 0.35, 1.23, 0.18, 0.035, 0.035, 0.10, 'z', 8);
        // Short rough chimney stays inside the single-tile footprint.
        box('stone', -0.21, 1.04, -0.08, 0.22, 0.18, 0.23);
        box('iron', -0.21, 1.17, -0.08, 0.28, 0.06, 0.28);
        for (const x of [-0.38, 0.38]) box('timberDark', x, 0.93, -0.36, 0.045, 0.40, 0.05);
        box('timber', 0, 1.12, -0.36, 0.80, 0.055, 0.05);
      }
    };
    const build = maker[type];
    if (!build) throw new RangeError(`Unknown workstation type: ${type}`);
    build.call(maker);
    const positions = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [material, data] of builders) {
      for (let i = 0; i < data.positions.length; i += 3) {
        const x = data.positions[i], y = data.positions[i + 1], z = data.positions[i + 2];
        positions.push(x,y,z); minX = Math.min(minX,x); minY = Math.min(minY,y); minZ = Math.min(minZ,z); maxX = Math.max(maxX,x); maxY = Math.max(maxY,y); maxZ = Math.max(maxZ,z);
      }
    }
    const modelAabb = { min: [minX,minY,minZ], max: [maxX,maxY,maxZ] };
    const footprint = { width: maxX - minX, depth: maxZ - minZ };
    if (footprint.width > 0.98 + 1e-6 || footprint.depth > 0.98 + 1e-6) throw new RangeError(`${type} exceeds the 1 m install footprint (${footprint.width.toFixed(3)} x ${footprint.depth.toFixed(3)}; ${minX}..${maxX}, ${minZ}..${maxZ})`);
    const batches = [];
    for (const [material, data] of builders) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      geometry.setIndex(data.indices); geometry.userData ||= {}; geometry.userData.terraWorkstationShared = true; geometry.computeBoundingSphere?.(); sharedGeometries.add(geometry);
      batches.push({ material, geometry });
    }
    const spec = { type, batches, modelAabb, visualSignature: [...builders.entries()].map(([material, data]) => `${material}:${data.partCount}`).sort() };
    geometryCache.set(type, spec);
    return createRoot(spec);
  };
  const dispose = root => {
    root?.parent?.remove(root);
    root?.traverse?.(object => {
      if (object.geometry && !sharedGeometries.has(object.geometry)) object.geometry.dispose();
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) if (!Object.values(materials).includes(material)) material.dispose?.();
    });
  };
  const disposeAll = () => {
    for (const spec of geometryCache.values()) for (const batch of spec.batches) batch.geometry.dispose();
    geometryCache.clear();
    for (const material of Object.values(materials)) material.dispose?.();
  };
  return { create, dispose, disposeAll, materials };
}
