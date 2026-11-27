import * as THREE from '../assets/vendor/three/three.module.js?v=ec93c99b7463aa75';

// Original procedural artwork. The simulation owns positions and collisions;
// these pooled models only present its state.
const COLORS = { mint: 0x72f4c3, teal: 0x188f89, navy: 0x123e4b, gold: 0xffd36b,
  pink: 0xff689d, orange: 0xff9957, paper: 0xfff5da, ink: 0x16303a, brown: 0x98512d };
const materials = new Map();
// Shared finishes keep every existing colour on its current material key.
// Brass hardware catches the key light; stone and ink stay matte.
const FINISH = new Map([
  [0xffd36b, [0.34, 0.62]], [0xe7c27a, [0.36, 0.58]], [0xc4a574, [0.4, 0.48]],
  [0xf6b961, [0.42, 0.26]], [0xefb750, [0.32, 0.64]], [0xd8c4a4, [0.45, 0.34]],
  [0x8a7356, [0.5, 0.3]], [0xe7c9a0, [0.55, 0.12]], [0xffe3a8, [0.58, 0.08]],
  [0xfff5da, [0.62, 0.04]], [0xf3e6c4, [0.7, 0.04]], [0xffffff, [0.45, 0.02]]
]);
function material(color, extra = {}) {
  const key = `${color}:${JSON.stringify(extra)}`;
  if (!materials.has(key)) {
    const [roughness, metalness] = FINISH.get(color) || [0.9, 0.02];
    materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  }
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
// Real turdrush-core.js rules: crates are cleared by a jump, low pipes (beams)
// by a slide, and speaker stacks (barriers) only by changing lanes.
export const RUSH_HAZARD_ACTIONS = Object.freeze({ crate: 'jump', beam: 'slide', barrier: 'dodge' });
export const RUSH_CUE_COPY = Object.freeze({
  jump: Object.freeze({ icon: '↑', noun: 'Crates', verb: 'Jump' }),
  slide: Object.freeze({ icon: '↓', noun: 'Pipes', verb: 'Slide' }),
  dodge: Object.freeze({ icon: '← →', noun: 'Speakers', verb: 'Change lanes' })
});
// Vector arrows, not font glyphs: the same shape on every device's canvas.
export function drawRushActionIcon(ctx, action, cx, cy, size, color) {
  const s = size, path = action === 'dodge'
    ? [[-.55, 0], [-.18, -.34], [-.18, -.12], [.18, -.12], [.18, -.34], [.55, 0], [.18, .34], [.18, .12], [-.18, .12], [-.18, .34]]
    : [[0, -.5], [.42, -.02], [.16, -.02], [.16, .5], [-.16, .5], [-.16, -.02], [-.42, -.02]];
  if (action !== 'dodge' && action !== 'jump' && action !== 'slide') {return;}
  const flip = action === 'slide' ? -1 : 1;
  ctx.save(); ctx.fillStyle = color; ctx.beginPath();
  path.forEach(([px, py], index) => ctx[index ? 'lineTo' : 'moveTo'](cx + px * s, cy + py * s * flip));
  ctx.closePath(); ctx.fill(); ctx.restore();
}
// Nearest hazard still ahead in the runner's target lane, within a short
// reaction window. Uses only existing run state; never mutates it.
export function rushHazardCue(run, near = 0.62) {
  if (!run?.player || !Array.isArray(run.entities)) {return null;}
  const lane = run.player.lane, speed = Number(run.speed) || 0, far = Math.max(22, speed * 1.1);
  let best = null;
  for (const entity of run.entities) {
    const action = ['crate', 'beam', 'barrier'].includes(entity.kind) ? RUSH_HAZARD_ACTIONS[entity.kind] : null;
    const gap = entity.at - run.distance;
    if (!action || entity.lane !== lane || !(gap > near) || gap > far || (best && gap >= best.gap)) {continue;}
    best = { action, kind: entity.kind, lane, gap };
  }
  if (best) {best.urgency = best.gap <= Math.max(6, speed * 0.45) ? 'now' : 'soon';}
  return best;
}
export function rushHitText(kind, shielded) {
  const copy = RUSH_CUE_COPY[RUSH_HAZARD_ACTIONS[kind]], lead = shielded ? 'Shield hit!' : 'Crash!';
  return copy ? `${lead} ${copy.noun}: ${copy.verb}` : lead;
}
// Shared DOM cue painters. Each expects an element with two children: an
// aria-hidden icon span and a text span. Writes only when the cue changes.
const cueKeys = new WeakMap();
export function paintRushHazardCue(node, cue) {
  if (!node) {return;}
  const key = cue ? `${cue.action}:${cue.kind}:${cue.urgency}` : '';
  if (cueKeys.get(node) === key) {return;}
  cueKeys.set(node, key);
  if (!cue) {
    node.hidden = true;
    for (const name of ['action', 'kind', 'urgency']) {delete node.dataset[name];}
    return;
  }
  const copy = RUSH_CUE_COPY[cue.action];
  const text = `${copy.verb} ${cue.urgency}`;
  node.dataset.action = cue.action; node.dataset.kind = cue.kind; node.dataset.urgency = cue.urgency;
  if (node.children[0].textContent !== copy.icon) {node.children[0].textContent = copy.icon;}
  if (node.children[1].textContent !== text) {node.children[1].textContent = text;}
  node.hidden = false;
}
export function paintRushHitCue(node, hit) {
  if (!node) {return;}
  if (!hit) { node.hidden = true; return; }
  node.dataset.kind = hit.kind; node.dataset.action = RUSH_HAZARD_ACTIONS[hit.kind] || '';
  node.dataset.shielded = String(!!hit.shielded); node.dataset.hitCount = String(hit.count);
  node.children[0].textContent = '!';
  node.children[1].textContent = rushHitText(hit.kind, hit.shielded);
  // Restart the brief pop for a second hit while the first is still shown.
  node.hidden = true; node.getBoundingClientRect(); node.hidden = false;
}
function labelTexture(text, color = '#fff5da', background = '#123e4b', w = 512, h = 128, icon = null) {
  const key = `${text}:${color}:${background}:${w}:${h}:${icon}`;
  if (signTextures.has(key)) {return signTextures.get(key);}
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
  // Dark outer frame, then a bold inner rule in the text colour: the plate
  // separates from teal walls, orange wood and the bright fog alike.
  ctx.strokeStyle = '#08141a'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
  if (icon) {
    // Actionable plates (JUMP, SLIDE, DODGE) get yellow/black hazard stripes
    // inside the dark frame band only; posters and pickups keep the plain frame.
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(12, 12, w - 24, h - 24); ctx.clip('evenodd');
    ctx.fillStyle = '#ffc629';
    for (let x = 0; x < w + h; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 16 - h, h); ctx.lineTo(x - h, h); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#08141a'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3); ctx.strokeRect(12, 12, w - 24, h - 24);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = color; ctx.font = `900 ${Math.floor(h * 0.56)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (icon) {
    // The action arrow reads without colour or language; the word follows it.
    drawRushActionIcon(ctx, icon, h * 0.62, h / 2, h * 0.66, color);
    ctx.fillText(text, (h * 1.1 + w) / 2, h / 2 + 2, w - h * 1.1 - 26);
  } else {ctx.fillText(text, w / 2, h / 2 + 2, w - 40);}
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; signTextures.set(key, texture); return texture;
}
function sign(parent, text, x, y, z, width, color, background, icon) {
  const map = labelTexture(text, color, background, 512, 128, icon);
  // Signs keep their authored colours: ACES at 1.25 exposure washed the
  // yellow/cream plates toward white and flattened the arrow contrast.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function floorTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0e1218'; ctx.fillRect(0, 0, 256, 256);
  // One horizontal repeat is exactly one 2.4-unit lane (see repeat/offset
  // below), so the texture's side edges are the lane seams. A dark gutter with
  // a brass lip lands under each dash line and at both outer lane edges. The
  // centre tread stays even, which is where jump, slide and lane-change read;
  // rivets and drainage sit on the shoulders and fall to tone with distance.
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 12, 256); ctx.fillRect(244, 0, 12, 256);
  ctx.fillStyle = '#c4a574'; ctx.fillRect(12, 0, 3, 256); ctx.fillRect(241, 0, 3, 256);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(15, 0, 2, 256); ctx.fillRect(239, 0, 2, 256);
  for (let y = 0; y < 4; y++) {
    const py = y * 64;
    ctx.fillStyle = '#20262e'; ctx.fillRect(17, py + 3, 46, 58); ctx.fillRect(193, py + 3, 46, 58);
    ctx.fillStyle = '#3e464e'; ctx.fillRect(66, py + 3, 124, 58);
    ctx.fillStyle = 'rgba(232,214,180,.1)'; ctx.fillRect(108, py + 5, 40, 54);
    ctx.fillStyle = 'rgba(8,10,14,.6)'; ctx.fillRect(63, py + 3, 3, 58); ctx.fillRect(190, py + 3, 3, 58);
    ctx.fillStyle = 'rgba(255,236,210,.18)'; ctx.fillRect(17, py + 2, 222, 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(17, py + 59, 222, 3);
    if (y % 2 === 0) {
      ctx.fillStyle = 'rgba(12,10,8,.4)';
      ctx.beginPath(); ctx.ellipse(40, py + 40, 6, 11, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(216, py + 24, 6, 11, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    for (const [rx, ry] of [[24, 12], [24, 52], [56, 12], [56, 52], [200, 12], [200, 52], [232, 12], [232, 52]]) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(rx, py + ry + 1, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c4a574'; ctx.beginPath(); ctx.arc(rx, py + ry, 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff1d0'; ctx.fillRect(rx - 0.5, py + ry - 0.8, 1, 0.8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // 9.8-wide floor / 2.4 lane pitch; the offset centres a repeat on lane x = 0.
  texture.repeat.set(9.8 / 2.4, 48); texture.offset.x = 0.5 - (4.9 / 2.4) % 1; return texture;
}

function vaultTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // U runs springing, crown, springing. Wide voussoirs and the soot crown read
  // at the vanishing point; courses and rivets read on the arch overhead.
  ctx.fillStyle = '#1a1612'; ctx.fillRect(0, 0, 256, 128);
  for (const [x, w, color] of [[0, 32, '#3a3228'], [32, 28, '#2a241c'], [60, 40, '#4a4036'], [100, 22, '#241e18'], [122, 12, '#100e0c'], [134, 22, '#241e18'], [156, 40, '#4a4036'], [196, 28, '#2a241c'], [224, 32, '#3a3228']]) {
    ctx.fillStyle = color; ctx.fillRect(x, 0, w, 128);
    ctx.fillStyle = 'rgba(255,228,190,.08)'; ctx.fillRect(x, 0, 2, 128);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x + w - 3, 0, 3, 128);
  }
  ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(108, 0, 40, 128);
  ctx.fillStyle = '#100e0c'; ctx.fillRect(0, 0, 256, 7);
  ctx.fillStyle = '#8a7356'; ctx.fillRect(0, 7, 256, 3);
  ctx.fillStyle = '#e7c27a'; ctx.fillRect(0, 8, 256, 1);
  for (let y = 18; y < 124; y += 16) {
    ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(0, y, 256, 2);
    ctx.fillStyle = 'rgba(255,232,196,.07)'; ctx.fillRect(0, y + 2, 256, 1);
  }
  for (const x of [16, 44, 78, 178, 212, 240]) {
    ctx.fillStyle = '#14110e'; ctx.fillRect(x, 14, 3, 108);
    ctx.fillStyle = '#e7c27a'; ctx.fillRect(x, 18, 3, 2); ctx.fillRect(x, 112, 3, 2);
  }
  for (const x of [48, 208]) {
    ctx.fillStyle = 'rgba(255,210,140,.1)'; ctx.fillRect(x - 18, 22, 36, 86);
    ctx.fillStyle = '#1a120c'; ctx.fillRect(x - 7, 34, 14, 52);
    ctx.fillStyle = '#c47a3a'; ctx.fillRect(x - 3, 40, 6, 40);
    ctx.fillStyle = '#ffe6b0'; ctx.fillRect(x - 1, 44, 2, 28);
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x - 9, 32, 18, 3); ctx.fillRect(x - 9, 84, 18, 3);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1, 12); return texture;
}

function checkerTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#12100e'; ctx.fillRect(0, 0, 64, 64);
  const tile = (x, y, fill, light) => {
    ctx.fillStyle = fill; ctx.fillRect(x, y, 30, 30);
    ctx.fillStyle = light; ctx.fillRect(x, y, 30, 2);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x, y + 28, 30, 2);
  };
  tile(1, 1, '#f3e6c8', 'rgba(255,250,236,.7)');
  tile(33, 33, '#f3e6c8', 'rgba(255,250,236,.7)');
  tile(33, 1, '#1c1814', 'rgba(255,236,210,.14)');
  tile(1, 33, '#1c1814', 'rgba(255,236,210,.14)');
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
  // Lower roughness gives the tiers a glazed sheen that catches the key light
  // and separates them from the matte tunnel; same meshes, same draws.
  const glaze = { roughness: 0.42, metalness: 0.06 };
  // Offset tiers make an S in profile so the runner stays a cutout at speed.
  ball(body, 0x6a381c, 0.07, 0.8, 0, 0.78, 0.52, 0.66, glaze);
  ball(body, 0xb56a3a, -0.08, 1.16, 0.02, 0.58, 0.4, 0.5, glaze);
  ball(body, 0xe4b47e, 0.1, 1.46, 0.04, 0.4, 0.3, 0.34, glaze);
  tube(body, 0xc4844e, [[0.12, 1.56, 0.02], [0.02, 1.76, 0.04], [0.18, 1.94, 0.02], [0.3, 1.9, -0.02]], 0.15, glaze);
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
  const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.09, 7, 28), material(0xffe3a8));
  bandana.rotation.x = Math.PI / 2; bandana.scale.set(1.15, 0.9, 1); bandana.position.y = 0.76; body.add(bandana);
  ball(body, 0xffe3a8, 0.66, 0.78, 0, 0.13);
  const tail = box(body, 0xffe3a8, 0.8, 0.71, -0.1, 0.35, 0.13, 0.08); tail.rotation.z = -0.4;
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
  // Each hazard keeps its previous count of colour x geometry buckets, so the
  // instanced draw-call budget is unchanged. Silhouettes separate by height
  // and openness at phone size: crate = low solid block with a bumpy top,
  // pipe = open striped gate, speaker = tall closed tower with two rings.
  // Lit brass trim: metal without an env map reads dark, so a modest emissive
  // keeps the hazard trim bright against the slate tread and the grey fog.
  const litBrass = { emissive: 0x7a4e0c, emissiveIntensity: 0.55 };
  if (kind === 'barrier') {
    // A tall wheeled speaker stack: dodge it, don't try to jump it. The cap and
    // plinth join the existing brass box bucket, so the draw count is unchanged.
    box(group, COLORS.ink, 0, 1.19, 0, 1.48, 2.34, 0.9);
    box(group, COLORS.gold, 0, 2.4, 0, 1.86, 0.14, 1.0, litBrass);
    box(group, COLORS.gold, 0, 0.08, 0, 1.86, 0.12, 1.0, litBrass);
    box(group, 0x7a2f55, 0, 1.22, 0.47, 1.32, 2.16, 0.08);
    for (const y of [0.69, 1.63]) {
      // Bright surrounds make two big rings the speaker's unmistakable mark.
      const rim = cylinder(group, 0xee7f9d, 0, y, 0.55, 0.62, 0.1, {
        emissive: 0x5a1830, emissiveIntensity: 0.72,
      });
      rim.rotation.x = Math.PI / 2;
      const cone = cylinder(group, 0x2a2233, 0, y, 0.6, 0.44, 0.08);
      cone.rotation.x = Math.PI / 2;
      ball(group, 0x161e2d, 0, y, 0.67, 0.16, 0.16, 0.06);
    }
    for (const x of [-0.58, 0.58]) { box(group, COLORS.gold, x, 1.2, 0.535, 0.07, 2.1, 0.04, litBrass); ball(group, COLORS.ink, x, 0.12, 0, 0.17); }
    box(group, COLORS.gold, 0, 2.24, 0.535, 1.2, 0.06, 0.04, litBrass);
    sign(group, 'DODGE', 0, 2.72, 0.12, 1.85, '#ffe1a0', '#3a1c34', 'dodge');
  } else if (kind === 'crate') {
    box(group, 0xd4743c, 0, 0.43, 0, 1.6, 0.8, 1.05, { emissive: 0x5a2008, emissiveIntensity: 0.4 });
    // Dark hardwood frame: corner posts and rails outline a squat box.
    for (const x of [-0.76, 0.76]) {box(group, 0x3b2414, x, 0.43, 0.5, 0.12, 0.84, 0.1);}
    for (const y of [0.08, 0.76]) {box(group, 0x3b2414, 0, y, 0.5, 1.6, 0.1, 0.1);}
    for (const x of [-0.76, 0.76]) {box(group, 0x3b2414, x, 0.43, -0.5, 0.12, 0.84, 0.1);}
    box(group, 0xf6b961, 0, 0.83, 0, 1.69, 0.1, 1.12);
    for (let i = 0; i < 3; i++) {
      const roll = cylinder(group, COLORS.paper, (i - 1) * 0.44, 0.98, 0, 0.23, 0.28);
      cylinder(group, 0x9e7454, roll.position.x, 1.17, 0, 0.08, 0.012);
    }
    sign(group, 'JUMP', 0, 0.43, 0.572, 1.24, '#24343b', '#ffd36b', 'jump');
  } else if (kind === 'beam') {
    for (const x of [-0.88, 0.88]) {
      cylinder(group, 0x6d6254, x, 1.0, 0, 0.13, 2);
      cylinder(group, COLORS.ink, x, 0.11, 0, 0.24, 0.16);
      // Clamp collars where the pipe meets each post.
      cylinder(group, COLORS.ink, x, 1.53, 0, 0.19, 0.42);
    }
    const pipe = cylinder(group, 0xefb750, 0, 1.53, 0, 0.25, 1.95, litBrass); pipe.rotation.z = Math.PI / 2;
    // Dense hazard banding: a striped bar with open floor beneath it.
    for (const x of [-0.56, -0.28, 0, 0.28, 0.56]) { const ring = cylinder(group, COLORS.ink, x, 1.53, 0, 0.31, 0.13); ring.rotation.z = Math.PI / 2; }
    sign(group, 'SLIDE', 0, 1.96, 0.12, 1.7, '#fff5da', '#763b55', 'slide');
  } else if (kind === 'pick') {
    const shape = new THREE.Shape(); shape.moveTo(0, -0.36);
    shape.bezierCurveTo(-0.1, -0.31, -0.42, 0.12, -0.36, 0.31);
    shape.bezierCurveTo(-0.28, 0.47, 0.28, 0.47, 0.36, 0.31);
    shape.bezierCurveTo(0.42, 0.12, 0.1, -0.31, 0, -0.36);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, steps: 1 }), material(COLORS.gold, { metalness: 0.32, roughness: 0.42, emissive: 0x6b3b09, emissiveIntensity: 0.42 }));
    group.add(mesh); ball(group, 0xfff3a7, -0.1, 0.2, 0.09, 0.065, 0.1, 0.025);
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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x7f8c9e);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x7f8c9e); this.scene.fog = new THREE.Fog(0x7f8c9e, 35, 112);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
    this.scene.add(new THREE.HemisphereLight(0xffe6c4, 0x1c2430, 2.4));
    const sun = new THREE.DirectionalLight(0xfff0d4, 2.8); sun.position.set(-8, 14, 8); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xb7c6dc, 1.5); rim.position.set(8, 5, -16); this.scene.add(rim);
    this.floorMap = floorTexture(); this.checkerMap = checkerTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 170), new THREE.MeshStandardMaterial({ map: this.floorMap, roughness: 0.76, metalness: 0.08 }));
    this.floorMaterial = floor.material;
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -66); this.scene.add(floor);
    for (const x of [-4.45, 4.45]) {
      box(this.scene, 0x3a3228, x, 0.11, -66, 0.35, 0.24, 170);
      box(this.scene, 0xe7c27a, x, 0.245, -66, 0.08, 0.035, 170, { emissive: 0x8a5a28, emissiveIntensity: 0.35 });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 170), new THREE.MeshStandardMaterial({ map: this.checkerMap, roughness: 1 }));
      strip.rotation.x = -Math.PI / 2; strip.position.set(x * 0.88, 0, -66); this.scene.add(strip);
    }
    // A stone vault closes the culvert. Supports and paper lanterns repeat under it.
    const roofPositions = [], roofUvs = [];
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24;
      const point = (angle, z) => [Math.cos(angle) * 5.65, 0.25 + Math.sin(angle) * 5.65, z];
      for (const [angle, z] of [[a, 18], [b, -150], [a, -150], [a, 18], [b, 18], [b, -150]]) {
        roofPositions.push(...point(angle, z));
        roofUvs.push(angle / Math.PI, (18 - z) / 168);
      }
    }
    const roofGeometry = new THREE.BufferGeometry();
    roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
    roofGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(roofUvs, 2));
    this.roofMap = vaultTexture();
    this.roofMaterial = new THREE.MeshBasicMaterial({ map: this.roofMap, side: THREE.DoubleSide, toneMapped: false });
    this.scene.add(new THREE.Mesh(roofGeometry, this.roofMaterial));
    this.scenery = []; this.sceneryRoot = new THREE.Group(); this.scene.add(this.sceneryRoot);
    const archGeometry = new THREE.TorusGeometry(5.45, 0.18, 7, 28, Math.PI);
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group(); this.sceneryRoot.add(group); group.position.z = 12 - i * 16; this.scenery.push(group);
      for (const side of [-1, 1]) {
        box(group, i % 2 ? 0x3a322c : 0x4a3a32, side * 5.7, 1.85, -5, 1.25, 3.7, 15.6);
        box(group, 0x241c16, side * 5.03, 0.32, -5, 0.14, 0.64, 15.6);
        const pipe = cylinder(group, 0x8a7356, side * 4.97, 2.8, -5, 0.14, 16); pipe.rotation.x = Math.PI / 2;
        for (const z of [-10, -2]) {
          const flange = cylinder(group, 0xd8c4a4, side * 4.97, 2.8, z, 0.2, 0.12); flange.rotation.x = Math.PI / 2;
          box(group, 0x2a241c, side * 4.85, 2.1, z, 0.32, 0.52, 0.56);
          box(group, COLORS.gold, side * 4.64, 2.1, z, 0.09, 0.28, 0.38, { emissive: COLORS.gold, emissiveIntensity: 0.55 });
        }
        // Road cases and wall posters sit in the same bays as before.
        if (i % 2 === 0) {
          box(group, 0x2c2824, side * 5, 0.64, -8, 0.58, 1.2, 1.4);
          box(group, 0xe7c9a0, side * 4.69, 0.62, -8, 0.035, 0.78, 0.1);
          const poster = sign(group, i % 4 ? 'LOUD!' : 'ENCORE', side * 4.98, 1.65, -4.5, 1.9, '#ffe3a2', '#344458');
          poster.rotation.y = -side * Math.PI / 2;
        }
      }
      const arch = new THREE.Mesh(archGeometry, material(0xc4a574));
      arch.position.set(0, 0.25, -12); group.add(arch);
      for (const side of [-1, 1]) {box(group, 0x8a7356, side * 5.45, 0.3, -12, 0.38, 0.6, 0.38);}
    }
    instanceStatic(this.sceneryRoot);
    this.dashes = []; this.dashRoot = new THREE.Group(); this.scene.add(this.dashRoot);
    for (let i = 0; i < 32; i++) {for (const x of [-1.2, 1.2]) {
      // Self-lit lane lines sit centred in the floor's lane-seam gutters.
      const dash = box(this.dashRoot, 0xf3e6c4, x, 0.005, 8 - i * 4, 0.055, 0.008, 1.2, { emissive: 0xc8b48a, emissiveIntensity: 0.55 }); this.dashes.push({ dash, at: i * 4 });
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
    this.pool = new Map(); this.elapsed = 0; this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.65); this.slowSeconds = 0; this.slowSamples = 0; this.renderedFrames = 0;
    this.contextLost = event => { event.preventDefault(); this.onLost(); };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.calmApplied = false;
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    const sizeKey = `${width}:${height}:${this.pixelRatio}`;
    if (sizeKey === this.sizeKey) {return false;}
    this.sizeKey = sizeKey;
    this.minimumPixelRatio = width * height > 700000 ? 0.6 : 0.85;
    this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 0.7 ? 65 : this.camera.aspect > 1.6 ? 49 : 58;
    this.camera.updateProjectionMatrix();
    return true;
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
    // High contrast drops the plates and lanterns for one flat slate field.
    const calm = !!this.highContrast;
    if (this.calmApplied !== calm) {
      this.calmApplied = calm;
      this.floorMaterial.map = calm ? null : this.floorMap;
      this.floorMaterial.color.setHex(calm ? 0x343c46 : 0xffffff);
      this.floorMaterial.needsUpdate = true;
      this.roofMaterial.map = calm ? null : this.roofMap;
      this.roofMaterial.color.setHex(calm ? 0x2c343c : 0xffffff);
      this.roofMaterial.needsUpdate = true;
      const fog = calm ? 0x3a424c : 0x7f8c9e;
      this.scene.background.setHex(fog);
      this.scene.fog.color.setHex(fog);
      this.renderer.setClearColor(fog);
    }
    // Sample elapsed slow time, not100 frames: at2fps a frame-count gate
    // takes50s to help. Three slow samples ignore a lone shader warm-up spike.
    if (state.phase === 'running' && dt > 0.028) {
      this.slowSeconds += Math.min(dt, 0.5); this.slowSamples++;
    } else {
      this.slowSeconds = Math.max(0, this.slowSeconds - dt * 2);
      this.slowSamples = Math.max(0, this.slowSamples - 1);
    }
    if (this.slowSeconds >= 1 && this.slowSamples >= 3 && this.pixelRatio > this.minimumPixelRatio) {
      this.pixelRatio = Math.max(this.minimumPixelRatio, this.pixelRatio * 0.75);
      this.slowSeconds = 0; this.slowSamples = 0; this.resize();
    }
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
    this.roofMap.offset.y = distance / 14;
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
    // Stay below the vaulted supports even when an arch passes the camera.
    this.camera.position.set((this.reducedMotion ? 0 : player.x * 0.15) + shake, 4.6, landscape ? 10.3 : 8.8);
    this.camera.lookAt(this.reducedMotion ? 0 : player.x * 0.08, landscape ? 0.4 : 0.5, landscape ? -12 : -11);
    this.renderer.render(this.scene, this.camera);
    this.renderedFrames++;
  }
  resetRun() {
    // A fresh attempt inherits rendering quality, never the previous crash's
    // frozen shake/particles or its cosmetic clock.
    this.sparks.length = 0;
    this.sparkMesh.count = 0;
    this.shake = 0;
    this.elapsed = 0;
    this.slowSeconds = 0;
    this.slowSamples = 0;
  }
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    const geometries = new Set(), textures = new Set([this.floorMap, this.roofMap]), mats = new Set();
    this.scene.traverse(object => { if (object.geometry) {geometries.add(object.geometry);} if (object.material) {for (const mat of Array.isArray(object.material) ? object.material : [object.material]) { mats.add(mat); if (mat.map) {textures.add(mat.map);} }} });
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose()); this.renderer.dispose();
  }
}
