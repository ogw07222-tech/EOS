/**
 * Lightweight, material-batched industrial models in TERRA block-space metres.
 * Uses injected THREE so the browser entry can keep its existing runtime/version.
 * Geometry and materials are shared for this factory's lifetime; call dispose(root)
 * to detach an instance, not to release factory resources used by sibling machines.
 */
export function createIndustrialVisuals(THREE) {
  if (!THREE?.Group || !THREE?.BufferGeometry || !THREE?.MeshStandardMaterial) {
    throw new TypeError('createIndustrialVisuals requires the active THREE runtime');
  }

  const materials = {
    frame: new THREE.MeshStandardMaterial({ color: 0x39464a, roughness: 0.88, metalness: 0.16 }),
    body: new THREE.MeshStandardMaterial({ color: 0xb9c5b6, roughness: 0.78, metalness: 0.25 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa7a4, roughness: 0.61, metalness: 0.34 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x202a2d, roughness: 0.9, metalness: 0.12 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xe58b47, roughness: 0.62, metalness: 0.38 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x956044, roughness: 0.72, metalness: 0.22 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x303c3d, roughness: 0.96, metalness: 0.04 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x59c4c1, roughness: 0.38, metalness: 0.12 }),
    hot: new THREE.MeshStandardMaterial({ color: 0xd76330, emissive: 0x301509, emissiveIntensity: 0.18, roughness: 0.72 })
  };
  for (const material of Object.values(materials)) material.userData.terraIndustrialShared = true;

  const geometryCache = new Map();
  function sharedGeometry(key, create) {
    let geometry = geometryCache.get(key);
    if (!geometry) {
      geometry = create();
      geometry.userData ||= {};
      geometry.userData.terraIndustrialShared = true;
      geometryCache.set(key, geometry);
    }
    return geometry;
  }

  function makeBoxBatch(parts) {
    const batches = new Map();
    const faces = [
      { n: [0,0,1], p: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
      { n: [0,0,-1], p: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
      { n: [1,0,0], p: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]] },
      { n: [-1,0,0], p: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]] },
      { n: [0,1,0], p: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]] },
      { n: [0,-1,0], p: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] }
    ];
    for (const part of parts) {
      let batch = batches.get(part.material);
      if (!batch) { batch = { positions: [], normals: [], indices: [] }; batches.set(part.material, batch); }
      const [w,h,d] = part.size, [cx,cy,cz] = part.center, rz = part.rotationZ || 0;
      const cr = Math.cos(rz), sr = Math.sin(rz), base = batch.positions.length / 3;
      for (const face of faces) for (let i = 0; i < 4; i++) {
        const [px,py,pz] = face.p[i], x = px*w/2, y = py*h/2, z = pz*d/2;
        const rx = x*cr-y*sr, ry = x*sr+y*cr;
        batch.positions.push(cx+rx,cy+ry,cz+z);
        const nx = face.n[0]*cr-face.n[1]*sr, ny = face.n[0]*sr+face.n[1]*cr;
        batch.normals.push(nx,ny,face.n[2]);
        const vertex = base + Math.floor(i / 4) * 4;
      }
      for (let f = 0; f < faces.length; f++) {
        const q = base + f*4;
        batch.indices.push(q,q+1,q+2,q,q+2,q+3);
      }
    }
    return [...batches].map(([material, data]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions,3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals,3));
      geometry.setIndex(data.indices);
      return { material, geometry };
    });
  }

  function box(parts, material, x,y,z, w,h,d, rotationZ=0) {
    parts.push({ material, center:[x,y,z], size:[w,h,d], rotationZ });
  }

  function drillParts() {
    const p=[];
    box(p,'frame',0,.12,0,.94,.20,.94);
    box(p,'dark',0,.25,0,.76,.12,.78);
    // Two cast uprights and a top cross beam make the hand-built gantry read clearly.
    for (const x of [-.37,.37]) {
      box(p,'steel',x,.73,-.31,.09,.78,.11);
      box(p,'brass',x,.73,.31,.075,.78,.075);
      box(p,'brass',x,.94,0,.085,.07,.63);
    }
    box(p,'body',0,.96,-.03,.64,.38,.56);
    box(p,'dark',0,1.17,-.03,.7,.08,.62);
    box(p,'steel',0,1.23,-.03,.44,.035,.42);
    // Distinct front drive plate, guard, and guarded service port.
    // Split guards leave the rotating auger visible from the front.
    for (const side of [-1,1]) {
      box(p,'frame',side*.245,.66,.37,.10,.52,.09,side*-.22);
      box(p,'steel',side*.30,.46,-.20,.10,.39,.10,side*.24);
    }
    box(p,'copper',-.27,.72,.46,.13,.33,.035);
    box(p,'copper',.27,.72,.46,.13,.33,.035);
    box(p,'dark',0,.93,.27,.36,.17,.10);
    box(p,'glass',0,.93,.329,.22,.055,.018);
    box(p,'brass',-.39,.29,.39,.10,.06,.11);
    box(p,'brass',.39,.29,.39,.10,.06,.11);
    return p;
  }

  function conveyorParts(uphill) {
    const p=[];
    box(p,'frame',0,.13,0,.94,.20,.88);
    box(p,'dark',0,.25,0,.86,.10,.78);
    const angle = uphill ? Math.PI/4 : 0;
    const centerY = uphill ? .76 : .39;
    const length = uphill ? .88 : .84;
    // The belt assembly remains within a one metre square after the local incline.
    box(p,'belt',0,centerY,0,length,.075,.58,angle);
    for (const z of [-.34,.34]) box(p,'steel',0,centerY+.08,z,length,.13,.075,angle);
    for (const x of [-.37,.37]) for (const z of [-.31,.31]) box(p,'steel',x,.27,z,.075,.22,.075);
    // Raised direction marks help read the travel direction from above.
    for (const x of [-.24,-.08,.08,.24]) {
      box(p,'body',x*Math.cos(angle),centerY+.046+x*Math.sin(angle),0,.028,.018,.53,angle);
    }
    box(p,'glass',-.39,.39,-.39,.10,.06,.07);
    return p;
  }

  function smelterParts() {
    const p=[];
    box(p,'dark',0,.12,0,.94,.19,.92);
    for (const x of [-.34,.34]) for (const z of [-.31,.31]) box(p,'steel',x,.27,z,.12,.15,.12);
    box(p,'body',0,.61,0,.80,.56,.76);
    box(p,'steel',0,.91,0,.72,.12,.68);
    box(p,'frame',0,1.01,0,.58,.10,.54);
    for (const x of [-.13,0,.13]) box(p,'frame',x,.65,.49,.025,.24,.018);
    box(p,'frame',0,.68,.405,.70,.58,.075);
    box(p,'dark',0,.69,.45,.54,.43,.035);
    box(p,'hot',0,.69,.475,.37,.29,.022);
    // Forged lip and door handles provide a readable furnace front.
    box(p,'brass',0,.94,.478,.50,.045,.04);
    box(p,'brass',0,.44,.478,.50,.045,.04);
    for (const x of [-.30,.30]) box(p,'steel',x,.69,.48,.035,.12,.03);
    // Offset chimney, segmented collar, and side cooling ribs.
    box(p,'dark',-.24,1.12,-.18,.23,.36,.23);
    box(p,'brass',-.24,.94,-.18,.31,.065,.31);
    box(p,'steel',-.24,1.31,-.18,.29,.075,.29);
    box(p,'dark',.42,.69,-.12,.10,.50,.32);
    for (let i=0;i<4;i++) box(p,i%2?'steel':'brass',.445,.49+i*.11,-.12,.05,.035,.36);
    box(p,'dark',.35,.40,.42,.22,.15,.14);
    box(p,'glass',.35,.42,.475,.09,.045,.018);
    box(p,'brass',0,.26,.43,.12,.045,.05);
    return p;
  }

  const staticMeshes = new Map();
  function staticFor(key, parts) {
    let entries = staticMeshes.get(key);
    if (!entries) { entries = makeBoxBatch(parts); staticMeshes.set(key, entries); }
    return entries;
  }

  const rollerGeometry = sharedGeometry('conveyor-roller', () => new THREE.CylinderGeometry(.045,.045,.61,8));
  const drillShaftGeometry = sharedGeometry('drill-shaft', () => new THREE.CylinderGeometry(.075,.09,.42,8));
  const drillTipGeometry = sharedGeometry('drill-tip', () => new THREE.ConeGeometry(.15,.26,8));
  const drillFinGeometry = sharedGeometry('drill-fins', () => {
    const p=[];
    for (let i=0;i<5;i++) {
      const y=.05+i*.067, a=i*.95;
      box(p,'steel',Math.cos(a)*.105,y,Math.sin(a)*.105,.23,.045,.07,a);
    }
    const batch=makeBoxBatch(p).find(v=>v.material==='steel');
    return batch.geometry;
  });

  const specs = {
    drill: { parts:drillParts, aabb:{min:[-.47,.02,-.47],max:[.47,1.25,.50]} },
    smelter: { parts:smelterParts, aabb:{min:[-.47,.025,-.47],max:[.47,1.35,.50]} }
  };
  function create(type, options={}) {
    const uphill = type==='conveyor' && options.uphill===true;
    if (!['drill','conveyor','smelter'].includes(type)) throw new RangeError(`Unsupported industrial model: ${type}`);
    const key = type==='conveyor' ? `conveyor:${uphill?'uphill':'flat'}` : type;
    const parts = type==='conveyor' ? conveyorParts(uphill) : specs[type].parts();
    const root = new THREE.Group();
    root.userData.machineType=type;
    root.userData.terraIndustrialModel=true;
    root.userData.modelAabb=type==='conveyor'
      ? {min:[-.47,.03,-.44],max:[.47,uphill?1.22:.535,.44]}
      : specs[type].aabb;
    for (const entry of staticFor(key,parts)) {
      const mesh = new THREE.Mesh(entry.geometry,materials[entry.material]);
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.terraIndustrialShared=true;root.add(mesh);
    }
    if (type==='drill') {
      const rotor=new THREE.Group();rotor.name='drill-auger';rotor.position.set(0,.24,0);
      const shaft=new THREE.Mesh(drillShaftGeometry,materials.steel);shaft.position.y=.23;shaft.castShadow=true;rotor.add(shaft);
      const fins=new THREE.Mesh(drillFinGeometry,materials.steel);fins.position.y=.04;fins.castShadow=true;rotor.add(fins);
      const tip=new THREE.Mesh(drillTipGeometry,materials.brass);tip.position.y=-.055;tip.rotation.x=Math.PI;tip.castShadow=true;rotor.add(tip);
      root.add(rotor);root.userData.rotors=[rotor];
    }
    if (type==='conveyor') {
      const belt=new THREE.Group();belt.name='conveyor-rollers';
      if (uphill) { belt.position.y=.40; belt.rotation.z=Math.PI/4; }
      else belt.position.y=.30;
      const rollers=[];
      for (const x of [-.30,-.10,.10,.30]) {
        const roller=new THREE.Mesh(rollerGeometry,materials.steel);
        roller.position.set(x,0,0);roller.rotation.x=Math.PI/2;roller.castShadow=true;belt.add(roller);rollers.push(roller);
      }
      root.add(belt);root.userData.belts=[{group:belt,rollers,speed:2.2}];
    }
    if (type==='smelter') {
      root.userData.activeParts=root.children.filter(child=>child.material===materials.hot);
      root.userData.idleEmissiveIntensity=.18;
    }
    return root;
  }

  function dispose(root) {
    if (!root) return;
    root.parent?.remove(root);
    // All mesh geometry/materials are factory-shared. Retain them for siblings and previews.
  }

  return { create, dispose, materials, geometryCount:()=>geometryCache.size + [...staticMeshes.values()].reduce((sum,items)=>sum+items.length,0) };
}
