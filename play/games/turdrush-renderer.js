import * as THREE from '../assets/vendor/three/three.module.js?v=ec93c99b7463aa75';

// Original procedural artwork. The simulation owns positions and collisions;
// these pooled models only present its state.
const COLORS = { mint: 0x72f4c3, teal: 0x188f89, navy: 0x123e4b, gold: 0xffd36b,
  pink: 0xff689d, orange: 0xff9957, paper: 0xfff5da, ink: 0x16303a, brown: 0x98512d };
const materials = new Map();
function material(color, extra = {}) {
  const key = `${color}:${JSON.stringify(extra)}`;
  if (!materials.has(key)) {materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...extra }));}
  return materials.get(key);
}
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 18);
const signTextures = new Map();
function box(parent, color, x, y, z, w, h, d, extra) {
  const mesh = new THREE.Mesh(boxGeometry, material(color, extra));
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh;
}
function ball(parent, color, x, y, z, w, h = w, d = w, extra) {
  const mesh = new THREE.Mesh(sphereGeometry, material(color, extra));
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh;
}
function tube(parent, color, points, radius, extra = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 7, false), material(color, extra));
  parent.add(mesh); return mesh;
}
function cylinder(parent, color, x, y, z, radius, height, extra) {
  const mesh = new THREE.Mesh(cylinderGeometry, material(color, extra));
  mesh.position.set(x, y, z); mesh.scale.set(radius, height, radius); parent.add(mesh); return mesh;
}
function labelTexture(text, color = '#fff5da', background = '#123e4b', w = 512, h = 128) {
  const key = `${text}:${color}:${background}:${w}:${h}`;
  if (signTextures.has(key)) {return signTextures.get(key);}
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = color; ctx.font = `900 ${Math.floor(h * 0.56)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 2, w - 40);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; signTextures.set(key, texture); return texture;
}
function sign(parent, text, x, y, z, width, color, background) {
  const map = labelTexture(text, color, background);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map }));
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function floorTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#18555c'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) {for (let x = 0; x < 4; x++) {
    ctx.fillStyle = ['#278e8b', '#2a9790', '#25827f', '#329c95'][(x + y * 3) % 4];
    ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    ctx.fillStyle = 'rgba(137,255,221,.12)'; ctx.fillRect(x * 64 + 4, y * 64 + 4, 55, 2);
  }}
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 48); return texture;
}
function checkerTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f1e9c9'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#173b45'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1, 25); return texture;
}

// A whole repeating set moves as one root. Common unit geometry/materials
// become instanced draws rather than one GPU call per tile/pipe/scenery box.
function instanceStatic(group) {
  group.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert(), buckets = new Map();
  group.traverse(object => {
    if (!object.isMesh) {return;}
    const key = `${object.geometry.uuid}:${object.material.uuid}`;
    if (!buckets.has(key)) {buckets.set(key, { geometry: object.geometry, material: object.material, transforms: [] });}
    buckets.get(key).transforms.push(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
  });
  group.clear();
  for (const bucket of buckets.values()) {
    const instances = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.transforms.length);
    bucket.transforms.forEach((matrix, index) => instances.setMatrixAt(index, matrix));
    instances.instanceMatrix.needsUpdate = true; instances.computeBoundingSphere(); group.add(instances);
  }
}

function mascot() {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  // Warm soft-serve silhouette, with a hand-shaped curl and small glossy highlights.
  ball(body, COLORS.brown, 0, 0.81, 0, 0.73, 0.51, 0.61);
  ball(body, 0xa95d35, -0.02, 1.18, 0, 0.59, 0.4, 0.5);
  ball(body, 0xb56a3d, 0.04, 1.49, 0, 0.43, 0.34, 0.37);
  tube(body, 0xb56a3d, [[0, 1.56, 0], [-0.12, 1.78, 0], [0.08, 1.97, 0], [0.2, 1.99, 0]], 0.16);
  tube(body, 0xc77c48, [[-0.43, 1.31, 0.23], [-0.15, 1.43, 0.38], [0.13, 1.44, 0.36]], 0.035);
  // Face glances back at the player. No emoji/third-party sprite assets.
  for (const x of [-0.23, 0.23]) {
    ball(body, 0x5b3426, x, 1.25, 0.445, 0.195, 0.23, 0.1);
    ball(body, COLORS.paper, x, 1.26, 0.51, 0.17, 0.2, 0.08);
    ball(body, COLORS.ink, x + 0.015, 1.26, 0.575, 0.081, 0.11, 0.04);
    ball(body, 0xffffff, x - 0.012, 1.31, 0.61, 0.026);
  }
  tube(body, 0x4e3025, [[-0.36, 1.52, 0.46], [-0.2, 1.57, 0.49], [-0.09, 1.54, 0.46]], 0.035);
  tube(body, 0x4e3025, [[0.09, 1.57, 0.46], [0.23, 1.6, 0.48], [0.37, 1.54, 0.43]], 0.035);
  tube(body, 0x4b2c26, [[-0.22, 0.98, 0.54], [0, 0.9, 0.61], [0.23, 0.99, 0.53]], 0.042);
  box(body, COLORS.paper, 0, 0.95, 0.613, 0.18, 0.065, 0.025);
  const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.09, 7, 28), material(COLORS.mint));
  bandana.rotation.x = Math.PI / 2; bandana.scale.set(1.15, 0.9, 1); bandana.position.y = 0.76; body.add(bandana);
  ball(body, COLORS.mint, 0.66, 0.78, 0, 0.13);
  const tail = box(body, COLORS.mint, 0.8, 0.71, -0.1, 0.35, 0.13, 0.08); tail.rotation.z = -0.4;
  const arms = [], feet = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.67, 0.93, 0); body.add(arm);
    tube(arm, 0x6a3d29, [[0, 0, 0], [side * 0.16, -0.18, 0.04], [side * 0.2, -0.3, 0.18]], 0.075);
    ball(arm, COLORS.paper, side * 0.21, -0.3, 0.18, 0.13, 0.14, 0.12); arms.push(arm);
    const foot = new THREE.Group(); foot.position.set(side * 0.32, 0.19, 0); group.add(foot);
    ball(foot, COLORS.paper, 0, 0, 0.05, 0.23, 0.17, 0.36);
    ball(foot, COLORS.pink, 0, 0.07, -0.03, 0.22, 0.15, 0.27);
    box(foot, COLORS.ink, 0, -0.1, 0.04, 0.42, 0.07, 0.57);
    box(foot, COLORS.paper, 0, 0.13, 0.13, 0.2, 0.025, 0.15); feet.push(foot);
  }
  return { group, body, arms, feet };
}

function hazard(kind) {
  const group = new THREE.Group();
  if (kind === 'barrier') {
    // A tall wheeled speaker stack: dodge it, don't try to jump it.
    box(group, COLORS.ink, 0, 1.19, 0, 1.7, 2.34, 0.9);
    box(group, 0x5c416d, 0, 1.22, 0.47, 1.55, 2.16, 0.08);
    for (const y of [0.69, 1.63]) {
      const rim = cylinder(group, 0x242b40, 0, y, 0.54, 0.48, 0.09); rim.rotation.x = Math.PI / 2;
      const cone = cylinder(group, 0x423a55, 0, y, 0.6, 0.36, 0.08); cone.rotation.x = Math.PI / 2;
      ball(group, 0x161e2d, 0, y, 0.66, 0.13, 0.13, 0.06);
    }
    for (const x of [-0.69, 0.69]) { box(group, COLORS.gold, x, 1.2, 0.535, 0.07, 2.1, 0.04); ball(group, COLORS.ink, x, 0.12, 0, 0.17); }
    sign(group, 'DODGE', 0, 2.59, 0.12, 1.85, '#ffe1a0', '#243443');
  } else if (kind === 'crate') {
    box(group, 0xd4743c, 0, 0.43, 0, 1.6, 0.8, 1.05);
    for (const x of [-0.62, 0.62]) {box(group, COLORS.gold, x, 0.44, 0.54, 0.11, 0.78, 0.055);}
    box(group, 0xf6b961, 0, 0.83, 0, 1.69, 0.1, 1.12);
    for (let i = 0; i < 3; i++) {
      const roll = cylinder(group, COLORS.paper, (i - 1) * 0.44, 0.98, 0, 0.19, 0.24);
      cylinder(group, 0x9e7454, roll.position.x, 1.105, 0, 0.065, 0.01);
    }
    sign(group, 'JUMP', 0, 0.45, 0.572, 1.05, '#24343b', '#ffd36b');
  } else if (kind === 'beam') {
    for (const x of [-0.88, 0.88]) {
      cylinder(group, 0x607b85, x, 1.0, 0, 0.1, 2);
      cylinder(group, COLORS.ink, x, 0.11, 0, 0.22, 0.16);
    }
    const pipe = cylinder(group, 0xefb750, 0, 1.53, 0, 0.23, 1.95); pipe.rotation.z = Math.PI / 2;
    for (const x of [-0.6, 0, 0.6]) { const ring = cylinder(group, COLORS.ink, x, 1.53, 0, 0.24, 0.14); ring.rotation.z = Math.PI / 2; }
    sign(group, 'SLIDE', 0, 1.92, 0.12, 1.7, '#fff5da', '#763b55');
  } else if (kind === 'pick') {
    const shape = new THREE.Shape(); shape.moveTo(0, -0.31); shape.bezierCurveTo(-0.75, 0.35, -0.21, 0.54, 0, 0.34); shape.bezierCurveTo(0.21, 0.54, 0.75, 0.35, 0, -0.31);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, steps: 1 }), material(COLORS.gold, { metalness: 0.32, emissive: 0x6b3b09, emissiveIntensity: 0.24 }));
    mesh.rotation.z = Math.PI; group.add(mesh); ball(group, 0xfff3a7, -0.1, 0.2, 0.09, 0.065, 0.1, 0.025);
  } else if (kind === 'shield') {
    ball(group, COLORS.mint, 0, 0, 0, 0.45, 0.55, 0.16, { emissive: 0x226c60, emissiveIntensity: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.065, 7, 24), material(COLORS.paper)); group.add(ring);
    sign(group, '+', 0, 0, 0.19, 0.55, '#153c46', '#72f4c3');
  } else if (kind === 'magnet') {
    tube(group, COLORS.pink, [[-0.32, 0.35, 0], [-0.32, -0.15, 0], [0, -0.36, 0], [0.32, -0.15, 0], [0.32, 0.35, 0]], 0.14);
    for (const x of [-0.32, 0.32]) {box(group, COLORS.paper, x, 0.32, 0, 0.3, 0.22, 0.3);}
  }
  return group;
}

export class TurdRushRenderer {
  constructor(canvas, { reducedMotion = false, onLost = () => {} } = {}) {
    this.canvas = canvas; this.reducedMotion = reducedMotion; this.onLost = onLost;
    const context = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!context) {throw new Error('WebGL 2 is unavailable');}
    this.renderer = new THREE.WebGLRenderer({ canvas, context, alpha: false, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x7ccfcb);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x7ccfcb); this.scene.fog = new THREE.Fog(0x7ccfcb, 35, 112);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
    this.scene.add(new THREE.HemisphereLight(0xbffff1, 0x345557, 2.7));
    const sun = new THREE.DirectionalLight(0xffe6bf, 3.3); sun.position.set(-8, 14, 8); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xa8ffff, 1.8); rim.position.set(8, 5, -16); this.scene.add(rim);
    this.floorMap = floorTexture(); this.checkerMap = checkerTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 170), new THREE.MeshStandardMaterial({ map: this.floorMap, roughness: 0.83 }));
    this.floorMaterial = floor.material;
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -66); this.scene.add(floor);
    for (const x of [-4.45, 4.45]) {
      box(this.scene, 0x245b62, x, 0.11, -66, 0.35, 0.24, 170);
      box(this.scene, 0x58d8bf, x, 0.245, -66, 0.08, 0.035, 170, { emissive: 0x328f7d, emissiveIntensity: 0.4 });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 170), new THREE.MeshStandardMaterial({ map: this.checkerMap, roughness: 1 }));
      strip.rotation.x = -Math.PI / 2; strip.position.set(x * 0.88, 0, -66); this.scene.add(strip);
    }
    // A continuous vaulted ceiling fills the upper view with real depth rather
    // than empty sky. Supports and light fixtures repeat below this shell.
    const roofPositions = [], roofNormals = [];
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24;
      const point = (angle, z) => [Math.cos(angle) * 5.65, 0.25 + Math.sin(angle) * 5.65, z];
      for (const [angle, z] of [[a, 18], [b, -150], [a, -150], [a, 18], [b, 18], [b, -150]]) {
        roofPositions.push(...point(angle, z)); roofNormals.push(-Math.cos(angle), -Math.sin(angle), 0);
      }
    }
    const roofGeometry = new THREE.BufferGeometry();
    roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
    roofGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(roofNormals, 3));
    this.scene.add(new THREE.Mesh(roofGeometry, material(0x4b9894, { side: THREE.DoubleSide, emissive: 0x28796f, emissiveIntensity: 0.75 })));
    this.scenery = []; this.sceneryRoot = new THREE.Group(); this.scene.add(this.sceneryRoot);
    const archGeometry = new THREE.TorusGeometry(5.45, 0.18, 7, 28, Math.PI);
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group(); this.sceneryRoot.add(group); group.position.z = 12 - i * 16; this.scenery.push(group);
      for (const side of [-1, 1]) {
        box(group, i % 2 ? 0x23767b : 0x2e8589, side * 5.7, 1.85, -5, 1.25, 3.7, 15.6);
        box(group, 0x225565, side * 5.03, 0.32, -5, 0.14, 0.64, 15.6);
        const pipe = cylinder(group, 0x4e9b98, side * 4.97, 2.8, -5, 0.14, 16); pipe.rotation.x = Math.PI / 2;
        for (const z of [-10, -2]) {
          const flange = cylinder(group, 0xadc6ae, side * 4.97, 2.8, z, 0.2, 0.12); flange.rotation.x = Math.PI / 2;
          box(group, 0x274d5d, side * 4.85, 2.1, z, 0.32, 0.52, 0.56);
          box(group, COLORS.gold, side * 4.64, 2.1, z, 0.09, 0.28, 0.38, { emissive: COLORS.gold, emissiveIntensity: 0.8 });
        }
        // Backstage cases, drum silhouettes and playful wall posters.
        if (i % 2 === 0) {
          box(group, 0x3b465c, side * 5, 0.64, -8, 0.58, 1.2, 1.4);
          box(group, COLORS.pink, side * 4.69, 0.62, -8, 0.035, 0.78, 0.1);
          const poster = sign(group, i % 4 ? 'LOUD!' : 'ENCORE', side * 4.98, 1.65, -4.5, 1.9, '#ffe3a2', '#344458');
          poster.rotation.y = -side * Math.PI / 2;
        }
      }
      const arch = new THREE.Mesh(archGeometry, material(0x77b4ac));
      arch.position.set(0, 0.25, -12); group.add(arch);
      for (const side of [-1, 1]) {box(group, 0x8bbdb1, side * 5.45, 0.3, -12, 0.38, 0.6, 0.38);}
    }
    instanceStatic(this.sceneryRoot);
    this.dashes = []; this.dashRoot = new THREE.Group(); this.scene.add(this.dashRoot);
    for (let i = 0; i < 32; i++) {for (const x of [-1.2, 1.2]) {
      const dash = box(this.dashRoot, 0xabe1c6, x, 0.005, 8 - i * 4, 0.055, 0.008, 1.2); this.dashes.push({ dash, at: i * 4 });
    }}
    instanceStatic(this.dashRoot);
    this.runner = mascot(); this.scene.add(this.runner.group);
    const shadowMap = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 60); g.addColorStop(0, 'rgba(7,31,39,.56)'); g.addColorStop(1, 'rgba(7,31,39,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
    })();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.015; this.scene.add(this.shadow);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({ color: COLORS.mint, transparent: true, opacity: 0.14, depthWrite: false }));
    this.bubble.position.y = 1; this.runner.group.add(this.bubble); this.bubble.visible = false;
    this.bubbleRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.025, 5, 36), new THREE.MeshBasicMaterial({ color: COLORS.mint }));
    this.bubbleRing.position.y = 1; this.runner.group.add(this.bubbleRing); this.bubbleRing.visible = false;
    this.sparkMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: COLORS.gold }), 36);
    this.sparkMesh.count = 0; this.scene.add(this.sparkMesh); this.sparks = []; this.sparkTransform = new THREE.Object3D();
    this.pool = new Map(); this.elapsed = 0; this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.65); this.slowFrames = 0;
    this.contextLost = event => { event.preventDefault(); this.onLost(); };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.7 ? 65 : this.camera.aspect > 1.6 ? 49 : 58;
    this.camera.updateProjectionMatrix();
  }
  model(kind, slot) {
    if (!this.pool.has(kind)) {this.pool.set(kind, []);}
    const pool = this.pool.get(kind);
    if (!pool[slot]) {
      pool[slot] = hazard(kind); instanceStatic(pool[slot]); this.scene.add(pool[slot]);
      if (['barrier', 'crate', 'beam'].includes(kind)) {
        const edge = new THREE.Group(), height = kind === 'barrier' ? 2.95 : kind === 'crate' ? 1.2 : 2.3;
        const middle = height / 2;
        for (const side of [-1, 1]) {
          box(edge, 0xffffff, side * 0.96, middle, 0.75, 0.08, height, 0.08);
          box(edge, 0xffffff, 0, middle + side * height / 2, 0.75, 2.0, 0.08, 0.08);
        }
        instanceStatic(edge); pool[slot].add(edge); pool[slot].userData.contrastEdge = edge;
      }
    }
    return pool[slot];
  }
  render(state, dt = 0, events = []) {
    this.elapsed += Math.min(dt, 0.1);
    if (this.floorMaterial.map !== (this.highContrast ? null : this.floorMap)) { this.floorMaterial.map = this.highContrast ? null : this.floorMap; this.floorMaterial.color.setHex(this.highContrast ? 0x296a76 : 0xffffff); this.floorMaterial.needsUpdate = true; }
    if (dt > 0.025 && state.phase === 'running') {this.slowFrames++;} else {this.slowFrames = Math.max(0, this.slowFrames - 0.25);}
    if (this.slowFrames > 100 && this.pixelRatio > 1) { this.pixelRatio = Math.max(1, this.pixelRatio - 0.25); this.slowFrames = 0; this.resize(); }
    const distance = state.distance, running = state.phase === 'running';
    if (!this.reducedMotion) {for (const event of events) {
      if (event.type !== 'pickup') {continue;}
      for (let i = 0; i < 6; i++) {
        if (this.sparks.length >= 36) {this.sparks.shift();}
        const angle = i * Math.PI / 3 + this.elapsed;
        this.sparks.push({ x: state.player.x, y: 1.0 + state.player.y, z: 0, vx: Math.cos(angle) * 1.8, vy: 1.5 + (i % 2), vz: Math.sin(angle) * 1.8, life: 0.42 });
      }
    }}
    this.sparks = this.reducedMotion ? [] : this.sparks.filter(spark => spark.life > 0);
    let sparkCount = 0;
    for (const spark of this.sparks) {
      const step = Math.min(dt, 0.1); spark.life -= step; spark.x += spark.vx * step; spark.y += spark.vy * step; spark.z += spark.vz * step; spark.vy -= step * 5;
      this.sparkTransform.position.set(spark.x, spark.y, spark.z); this.sparkTransform.scale.setScalar(Math.max(0.001, spark.life * 0.2)); this.sparkTransform.updateMatrix(); this.sparkMesh.setMatrixAt(sparkCount++, this.sparkTransform.matrix);
    }
    this.sparkMesh.count = sparkCount; this.sparkMesh.instanceMatrix.needsUpdate = true; this.sparkMesh.frustumCulled = false;
    this.floorMap.offset.y = distance / 3.54;
    this.checkerMap.offset.y = distance / 6.8;
    this.sceneryRoot.position.z = distance % 16;
    this.dashRoot.position.z = distance % 4;
    const counts = {};
    for (const entity of state.entities) {
      const ahead = entity.at - distance;
      if (ahead < -5 || ahead > 105) {continue;}
      const slot = counts[entity.kind] || 0, model = this.model(entity.kind, slot); counts[entity.kind] = slot + 1;
      model.visible = true; if (model.userData.contrastEdge) {model.userData.contrastEdge.visible = !!this.highContrast;} model.position.set((entity.lane - 1) * 2.4, 0, -ahead);
      if (['pick', 'shield', 'magnet'].includes(entity.kind)) {
        model.position.y = 1.0 + (this.reducedMotion ? 0 : Math.sin(this.elapsed * 3 + entity.id) * 0.1);
        model.rotation.y = this.reducedMotion ? 0 : this.elapsed * 1.8;
      }
    }
    for (const [kind, pool] of this.pool) {for (let i = counts[kind] || 0; i < pool.length; i++) {pool[i].visible = false;}}
    const runner = this.runner, player = state.player, stride = running ? Math.sin(state.elapsed * 15) : this.reducedMotion ? 0 : Math.sin(this.elapsed * 2) * 0.06;
    runner.group.position.set(player.x, player.y, 0);
    runner.body.position.y = running && player.y === 0 && !player.slide ? Math.abs(stride) * 0.06 : 0;
    runner.body.scale.y = player.slide ? 0.42 : 1; runner.body.position.z = player.slide ? 0.15 : 0;
    runner.body.rotation.z = THREE.MathUtils.clamp(((player.lane - 1) * 2.4 - player.x) * -0.09, -0.18, 0.18);
    runner.feet.forEach((foot, i) => {
      const direction = i ? -1 : 1; foot.position.z = player.slide ? 0.44 : stride * 0.24 * direction;
      foot.position.y = 0.19 + (running && !player.slide && player.y === 0 ? Math.max(0, stride * direction) * 0.23 : 0);
      foot.rotation.x = running && !player.slide ? stride * 0.34 * direction : 0;
    });
    runner.arms.forEach((arm, i) => { arm.rotation.x = player.slide ? -0.6 : stride * (i ? -0.55 : 0.55); });
    this.shadow.position.x = player.x; this.shadow.scale.setScalar(Math.max(0.6, 1 - player.y * 0.15));
    this.bubble.visible = this.bubbleRing.visible = player.shield > 0;
    this.bubbleRing.rotation.y = this.reducedMotion ? 0 : this.elapsed * 1.2;
    if (events.some(event => event.type === 'hit') && !this.reducedMotion) {this.shake = 0.18;}
    this.shake = Math.max(0, (this.shake || 0) - dt);
    const shake = this.shake && !this.reducedMotion ? Math.sin(this.elapsed * 70) * this.shake : 0;
    const landscape = this.camera.aspect > 1.6;
    this.camera.position.set((this.reducedMotion ? 0 : player.x * 0.15) + shake, landscape ? 5.7 : 4.6, landscape ? 10.3 : 8.8);
    this.camera.lookAt(this.reducedMotion ? 0 : player.x * 0.08, landscape ? 0.4 : 0.5, landscape ? -12 : -11);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    const geometries = new Set(), textures = new Set(), mats = new Set();
    this.scene.traverse(object => { if (object.geometry) {geometries.add(object.geometry);} if (object.material) {for (const mat of Array.isArray(object.material) ? object.material : [object.material]) { mats.add(mat); if (mat.map) {textures.add(mat.map);} }} });
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose()); this.renderer.dispose();
  }
}
