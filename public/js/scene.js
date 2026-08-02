// Построение 3D-сцены магазина: пол, стены, стеллажи, кассы, склад, улица.

import * as THREE from 'three';
import * as L from '/shared/layout.js';
import { SHELF_CAPACITY } from '/shared/config.js';
import { PRODUCT_BY_ID } from '/shared/products.js';

export const ITEM_ROWS = 4;
export const ITEM_COLS = 12;

// ------------------------------------------------------------- утилиты

function canvasTexture(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

function floorTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#e8e6df';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#dedbd2';
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.strokeStyle = 'rgba(0,0,0,.10)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
    g.moveTo(0, h / 2); g.lineTo(w, h / 2);
    g.stroke();
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, [14, 15]);
}

function concreteTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9c9a94';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, [10, 6]);
}

function asphaltTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, [24, 24]);
}

export function makeLabel(width, height, pxPerUnit = 128) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(width * pxPerUnit);
  cv.height = Math.round(height * pxPerUnit);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.renderOrder = 2;
  return {
    mesh,
    ctx: cv.getContext('2d'),
    cv,
    update() { tex.needsUpdate = true; },
  };
}

export function drawPriceTag(label, product, count, price) {
  const { ctx: g, cv } = label;
  const w = cv.width;
  const h = cv.height;
  g.clearRect(0, 0, w, h);
  roundRect(g, 0, 0, w, h, 10);
  g.fillStyle = product ? '#fdfdfb' : '#e3e6ea';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.25)';
  g.lineWidth = 3;
  g.stroke();

  if (!product) {
    g.fillStyle = '#8b98a5';
    g.font = `600 ${h * 0.34}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('пусто', w / 2, h / 2);
    label.update();
    return;
  }

  g.fillStyle = '#111';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `700 ${h * 0.3}px Inter, sans-serif`;
  g.fillText(product.name, h * 0.18, h * 0.32);

  g.font = `800 ${h * 0.42}px Inter, sans-serif`;
  g.fillStyle = '#c62828';
  g.fillText(`$${price.toFixed(2)}`, h * 0.18, h * 0.72);

  g.textAlign = 'right';
  g.font = `600 ${h * 0.24}px Inter, sans-serif`;
  g.fillStyle = count > 0 ? '#2e7d32' : '#c62828';
  g.fillText(`${count}/${SHELF_CAPACITY}`, w - h * 0.18, h * 0.72);
  label.update();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function textLabel(text, opts = {}) {
  const width = opts.width || 2.2;
  const height = opts.height || 0.5;
  const label = makeLabel(width, height, opts.px || 128);
  const { ctx: g, cv } = label;
  g.clearRect(0, 0, cv.width, cv.height);
  if (opts.bg !== false) {
    roundRect(g, 0, 0, cv.width, cv.height, 12);
    g.fillStyle = opts.bg || 'rgba(12,18,26,.82)';
    g.fill();
  }
  g.fillStyle = opts.color || '#e6edf3';
  g.font = `${opts.weight || 700} ${cv.height * (opts.size || 0.45)}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cv.width / 2, cv.height / 2);
  label.update();
  return label;
}

// ------------------------------------------------------------- сцена

export function buildWorld(scene) {
  const refs = {
    shelves: new Map(),
    checkouts: new Map(),
    interactables: [],
    switchLight: null,
    doorSign: null,
    actorRoot: new THREE.Group(),
  };
  scene.add(refs.actorRoot);

  scene.background = new THREE.Color('#8fb6d8');
  scene.fog = new THREE.Fog('#8fb6d8', 40, 130);

  // --- свет ---
  scene.add(new THREE.HemisphereLight('#ffffff', '#9aa1ab', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e0', 0.85);
  sun.position.set(-30, 45, -25);
  scene.add(sun);
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));

  const lampPositions = [
    [-7, -6], [7, -6], [-7, 2], [7, 2], [0, 12],
  ];
  for (const [x, z] of lampPositions) {
    const l = new THREE.PointLight('#fff6e8', 34, 26, 2);
    l.position.set(x, 3.1, z);
    scene.add(l);
  }

  // --- улица ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  buildParking(scene);

  // --- полы ---
  const salesFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(L.STORE.maxX - L.STORE.minX, L.DIVIDER_Z - L.STORE.minZ),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.02 }),
  );
  salesFloor.rotation.x = -Math.PI / 2;
  salesFloor.position.set(0, 0, (L.DIVIDER_Z + L.STORE.minZ) / 2);
  scene.add(salesFloor);

  const storageFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(L.STORE.maxX - L.STORE.minX, L.STORE.maxZ - L.DIVIDER_Z),
    new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 }),
  );
  storageFloor.rotation.x = -Math.PI / 2;
  storageFloor.position.set(0, 0.001, (L.STORE.maxZ + L.DIVIDER_Z) / 2);
  scene.add(storageFloor);

  // --- потолок ---
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(L.STORE.maxX - L.STORE.minX + 1, L.STORE.maxZ - L.STORE.minZ + 1),
    new THREE.MeshStandardMaterial({ color: '#e9edf2', side: THREE.DoubleSide, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, L.WALL_H, (L.STORE.maxZ + L.STORE.minZ) / 2);
  scene.add(ceiling);

  const lampGeo = new THREE.PlaneGeometry(2.6, 0.5);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fffdf5' });
  for (const [x, z] of lampPositions) {
    for (const dz of [-2.5, 0, 2.5]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.material.side = THREE.DoubleSide;
      lamp.position.set(x, L.WALL_H - 0.02, z + dz);
      scene.add(lamp);
    }
  }

  // --- стены ---
  const wallMat = new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.9 });
  const wallOutMat = new THREE.MeshStandardMaterial({ color: '#cfd6dd', roughness: 0.9 });
  for (const w of L.WALLS) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w.w, w.h, w.d),
      [wallOutMat, wallOutMat, wallMat, wallMat, wallMat, wallMat],
    );
    mesh.position.set(w.x, w.h / 2, w.z);
    scene.add(mesh);
  }

  // цветная полоса по стенам зала
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(L.STORE.maxX - L.STORE.minX - 0.4, 0.5, 0.02),
    new THREE.MeshStandardMaterial({ color: '#2f9e5e' }),
  );
  stripe.position.set(0, 2.4, L.DIVIDER_Z - 0.22);
  scene.add(stripe);

  // --- витрина/вход ---
  buildEntrance(scene, refs);

  // --- стеллажи ---
  for (const def of L.SHELVES) refs.shelves.set(def.id, buildShelf(scene, def, refs));

  // --- кассы ---
  for (const def of L.CHECKOUTS) refs.checkouts.set(def.id, buildCheckout(scene, def, refs));

  // --- склад ---
  buildStorage(scene, refs);

  return refs;
}

function buildParking(scene) {
  const lineMat = new THREE.MeshBasicMaterial({ color: '#d9d9c8' });
  for (let i = -5; i <= 5; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 5), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * 3.2, 0.01, -21);
    scene.add(line);
  }
  const carColors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#7f8c8d'];
  for (let i = 0; i < 7; i++) {
    const car = new THREE.Group();
    const c = carColors[i % carColors.length];
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.75, 4.2),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.35 }),
    );
    body.position.y = 0.62;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.6, 2.0),
      new THREE.MeshStandardMaterial({ color: '#20262e', roughness: 0.2, metalness: 0.6 }),
    );
    cabin.position.set(0, 1.22, -0.25);
    car.add(body, cabin);
    for (const [wx, wz] of [[-0.92, 1.3], [0.92, 1.3], [-0.92, -1.3], [0.92, -1.3]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12),
        new THREE.MeshStandardMaterial({ color: '#15181c' }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.32, wz);
      car.add(wheel);
    }
    car.position.set(-14 + (i % 7) * 3.2 + (i > 3 ? 1 : 0), 0, -21.5);
    if (i === 3) car.position.x = -30; // одно место свободно
    scene.add(car);
  }

  // деревья по краям
  for (const [x, z] of [[-22, -6], [-24, 4], [22, -8], [25, 6], [-20, -26], [20, -26]]) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: '#5d4037' }),
    );
    trunk.position.set(x, 1.1, z);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5, 0),
      new THREE.MeshStandardMaterial({ color: '#3e7d3a', flatShading: true }),
    );
    crown.position.set(x, 2.9, z);
    scene.add(trunk, crown);
  }
}

function buildEntrance(scene, refs) {
  // стеклянная витрина по бокам от двери
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#bcd7e8', transparent: true, opacity: 0.28,
    roughness: 0.05, metalness: 0, transmission: 0.6,
  });
  const doorGlass = new THREE.Mesh(
    new THREE.BoxGeometry(L.ENTRANCE.maxX - L.ENTRANCE.minX, 2.6, 0.06),
    glassMat,
  );
  doorGlass.position.set(L.ENTRANCE_X, 1.35, L.STORE.minZ);
  doorGlass.visible = false; // дверь «открыта», стекло только как деталь рамы
  scene.add(doorGlass);

  const frameMat = new THREE.MeshStandardMaterial({ color: '#37414c', metalness: 0.5, roughness: 0.4 });
  for (const x of [L.ENTRANCE.minX, L.ENTRANCE.maxX]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.5), frameMat);
    post.position.set(x, 1.45, L.STORE.minZ);
    scene.add(post);
  }
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(L.ENTRANCE.maxX - L.ENTRANCE.minX + 0.3, 0.4, 0.5),
    frameMat,
  );
  lintel.position.set(L.ENTRANCE_X, 3.05, L.STORE.minZ);
  scene.add(lintel);

  // вывеска магазина
  const sign = textLabel('🛒 МАРКЕТ ТАЙКУН', {
    width: 9, height: 1.5, px: 128, bg: '#0f5132', color: '#eafff3', size: 0.5,
  });
  sign.mesh.position.set(0, 4.3, L.STORE.minZ - 0.35);
  sign.mesh.rotation.y = Math.PI;
  scene.add(sign.mesh);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(L.STORE.maxX - L.STORE.minX, 1.9, 0.3),
    new THREE.MeshStandardMaterial({ color: '#0f5132' }),
  );
  back.position.set(0, 4.3, L.STORE.minZ - 0.2);
  scene.add(back);

  // табличка ОТКРЫТО/ЗАКРЫТО
  const doorSign = textLabel('ЗАКРЫТО', {
    width: 1.6, height: 0.6, bg: '#4a1d1d', color: '#fca5a5',
  });
  doorSign.mesh.position.set(L.ENTRANCE_X - 2.9, 2.1, L.STORE.minZ - 0.26);
  doorSign.mesh.rotation.y = Math.PI;
  scene.add(doorSign.mesh);
  refs.doorSign = doorSign;

  // рубильник внутри у входа
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.14),
    new THREE.MeshStandardMaterial({ color: '#2b3440' }),
  );
  panel.position.set(L.SWITCH.x, 1.5, L.SWITCH.z);
  panel.userData.interact = { kind: 'switch' };
  scene.add(panel);
  refs.interactables.push(panel);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 12),
    new THREE.MeshBasicMaterial({ color: '#f87171' }),
  );
  bulb.position.set(L.SWITCH.x, 1.72, L.SWITCH.z - 0.1);
  scene.add(bulb);
  refs.switchLight = bulb;

  const swLabel = textLabel('РУБИЛЬНИК', { width: 1.1, height: 0.3, size: 0.5 });
  swLabel.mesh.position.set(L.SWITCH.x, 1.05, L.SWITCH.z - 0.09);
  scene.add(swLabel.mesh);
}

const SHELF_ITEM_GEO = new THREE.BoxGeometry(0.21, 0.27, 0.26);

function buildShelf(scene, def, refs) {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  scene.add(group);

  const metal = new THREE.MeshStandardMaterial({ color: '#b9c2cb', metalness: 0.55, roughness: 0.45 });
  const backMat = new THREE.MeshStandardMaterial({ color: '#8e99a4', metalness: 0.3, roughness: 0.7 });

  const frame = new THREE.Group();
  for (const sx of [-def.w / 2 + 0.03, def.w / 2 - 0.03]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, def.h, def.d), metal);
    side.position.set(sx, def.h / 2, 0);
    frame.add(side);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, 0.05), backMat);
  back.position.set(0, def.h / 2, def.d / 2 - 0.03);
  frame.add(back);

  const rowY = [];
  for (let r = 0; r < ITEM_ROWS; r++) {
    const y = 0.28 + r * 0.42;
    rowY.push(y);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(def.w - 0.1, 0.05, def.d - 0.04), metal);
    plank.position.set(0, y, 0);
    frame.add(plank);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(def.w, 0.18, def.d), metal);
  base.position.set(0, 0.09, 0);
  frame.add(base);
  group.add(frame);

  // товары (инстансы)
  const mat = new THREE.MeshStandardMaterial({ color: '#cccccc', roughness: 0.65 });
  const items = new THREE.InstancedMesh(SHELF_ITEM_GEO, mat, ITEM_ROWS * ITEM_COLS);
  items.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < ITEM_ROWS * ITEM_COLS; i++) {
    const row = Math.floor(i / ITEM_COLS);
    const col = i % ITEM_COLS;
    const x = -def.w / 2 + 0.32 + col * ((def.w - 0.64) / (ITEM_COLS - 1));
    dummy.position.set(x, rowY[row] + 0.17, -0.05);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    items.setMatrixAt(i, dummy.matrix);
  }
  items.count = 0;
  items.frustumCulled = false;
  group.add(items);

  // ценник
  const label = makeLabel(1.5, 0.5, 160);
  label.mesh.position.set(0, def.h + 0.28, -def.d / 2 + 0.02);
  label.mesh.rotation.y = Math.PI;
  group.add(label.mesh);
  drawPriceTag(label, null, 0, 0);

  // хитбокс для взаимодействия
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(def.w, def.h, def.d + 0.6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.set(0, def.h / 2, -0.2);
  hit.userData.interact = { kind: 'shelf', id: def.id };
  group.add(hit);
  refs.interactables.push(hit);

  // «место под стеллаж», если не куплен
  const locked = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(def.w, def.d),
    new THREE.MeshBasicMaterial({ color: '#4b5563', transparent: true, opacity: 0.35 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  const lockLabel = textLabel(`СТЕЛЛАЖ · $${def.cost}`, { width: 1.5, height: 0.32, color: '#fbbf24' });
  lockLabel.mesh.position.set(0, 0.62, -def.d / 2 - 0.02);
  lockLabel.mesh.rotation.y = Math.PI;
  locked.add(pad, lockLabel.mesh);
  group.add(locked);

  return { group, frame, items, mat, label, locked, def, product: null, count: -1 };
}

function buildCheckout(scene, def, refs) {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  scene.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.6 });
  const topMat = new THREE.MeshStandardMaterial({ color: '#5b6775', roughness: 0.4, metalness: 0.2 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h - 0.06, def.d), bodyMat);
  body.position.y = (def.h - 0.06) / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(def.w + 0.1, 0.08, def.d + 0.12), topMat);
  top.position.y = def.h;
  group.add(body, top);

  // лента
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(def.w - 0.5, 0.02, def.d - 0.25),
    new THREE.MeshStandardMaterial({ color: '#1b2027', roughness: 0.9 }),
  );
  belt.position.set(0, def.h + 0.05, 0);
  group.add(belt);

  // кассовый аппарат
  const reg = new THREE.Group();
  const regBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.34),
    new THREE.MeshStandardMaterial({ color: '#2b3440' }),
  );
  regBody.position.y = 0.13;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.2),
    new THREE.MeshBasicMaterial({ color: '#0f2f22' }),
  );
  screen.position.set(0, 0.3, -0.02);
  screen.rotation.x = -0.35;
  const screenBack = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.24, 0.05),
    new THREE.MeshStandardMaterial({ color: '#2b3440' }),
  );
  screenBack.position.set(0, 0.3, 0.01);
  screenBack.rotation.x = -0.35;
  reg.add(regBody, screenBack, screen);
  reg.position.set(def.w / 2 - 0.35, def.h + 0.06, -0.1);
  group.add(reg);

  const regLabel = makeLabel(0.7, 0.3, 200);
  regLabel.mesh.position.set(def.w / 2 - 0.35, def.h + 0.62, -0.28);
  regLabel.mesh.rotation.y = Math.PI;
  group.add(regLabel.mesh);

  // товары на ленте
  const beltItems = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.24, 0.22),
      new THREE.MeshStandardMaterial({ color: '#ccc' }),
    );
    m.position.set(-def.w / 2 + 0.4 + i * 0.2, def.h + 0.18, 0.05);
    m.visible = false;
    group.add(m);
    beltItems.push(m);
  }

  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(def.w, 1.6, def.d + 1.0),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.set(0, 0.8, -0.2);
  hit.userData.interact = { kind: 'checkout', id: def.id };
  group.add(hit);
  refs.interactables.push(hit);

  // метка места кассира
  const spot = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.44, 24),
    new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.02, -1.15);
  group.add(spot);

  const locked = new THREE.Group();
  const lockLabel = textLabel(`КАССА · $${def.cost}`, { width: 1.5, height: 0.32, color: '#fbbf24' });
  lockLabel.mesh.position.set(0, 0.62, -def.d / 2 - 0.02);
  const lockPad = new THREE.Mesh(
    new THREE.BoxGeometry(def.w, 0.06, def.d),
    new THREE.MeshBasicMaterial({ color: '#4b5563', transparent: true, opacity: 0.35 }),
  );
  lockPad.position.y = 0.03;
  locked.add(lockPad);
  lockLabel.mesh.rotation.y = Math.PI;
  locked.add(lockLabel.mesh);
  group.add(locked);

  return { group, body, top, belt, reg, regLabel, beltItems, locked, def, employee: null };
}

function buildStorage(scene, refs) {
  // стол с ноутбуком
  const deskMat = new THREE.MeshStandardMaterial({ color: '#6d5540', roughness: 0.8 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(L.DESK.w, 0.08, L.DESK.d), deskMat);
  desk.position.set(L.DESK.x, L.DESK.h, L.DESK.z);
  scene.add(desk);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, L.DESK.h, 0.08), deskMat);
      leg.position.set(L.DESK.x + dx * (L.DESK.w / 2 - 0.1), L.DESK.h / 2, L.DESK.z + dz * (L.DESK.d / 2 - 0.1));
      scene.add(leg);
    }
  }

  const laptop = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.03, 0.36),
    new THREE.MeshStandardMaterial({ color: '#2b3440', metalness: 0.6, roughness: 0.3 }),
  );
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.34, 0.02),
    new THREE.MeshStandardMaterial({ color: '#2b3440', metalness: 0.6, roughness: 0.3 }),
  );
  lid.position.set(0, 0.17, 0.17);
  lid.rotation.x = -0.28;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, 0.28),
    new THREE.MeshBasicMaterial({ color: '#5eead4' }),
  );
  glow.position.set(0, 0.165, 0.145);
  glow.rotation.x = -0.28;
  laptop.add(base, lid, glow);
  laptop.position.set(L.DESK.x, L.DESK.h + 0.05, L.DESK.z);
  laptop.rotation.y = Math.PI;
  scene.add(laptop);

  const deskHit = new THREE.Mesh(
    new THREE.BoxGeometry(L.DESK.w + 0.4, 1.6, L.DESK.d + 1.4),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  deskHit.position.set(L.DESK.x, 0.8, L.DESK.z - 0.4);
  deskHit.userData.interact = { kind: 'laptop' };
  scene.add(deskHit);
  refs.interactables.push(deskHit);

  const deskLabel = textLabel('💻 УПРАВЛЕНИЕ МАГАЗИНОМ', { width: 3.4, height: 0.5, color: '#5eead4' });
  deskLabel.mesh.position.set(L.DESK.x, 2.2, L.DESK.z - 0.55);
  deskLabel.mesh.rotation.y = Math.PI;
  scene.add(deskLabel.mesh);

  // мусорка
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.36, L.TRASH.h, 16),
    new THREE.MeshStandardMaterial({ color: '#2f6f46', roughness: 0.7 }),
  );
  bin.position.set(L.TRASH.x, L.TRASH.h / 2, L.TRASH.z);
  bin.userData.interact = { kind: 'trash' };
  scene.add(bin);
  refs.interactables.push(bin);
  const binLabel = textLabel('♻️ КОРОБКИ', { width: 1.7, height: 0.4, color: '#a7f3d0' });
  binLabel.mesh.position.set(L.TRASH.x, 1.7, L.TRASH.z - 0.5);
  scene.add(binLabel.mesh);

  // зона разгрузки
  const zone = new THREE.Mesh(
    new THREE.PlaneGeometry(L.DELIVERY.maxX - L.DELIVERY.minX + 1.6, L.DELIVERY.maxZ - L.DELIVERY.minZ + 1.6),
    new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.12 }),
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.set(
    (L.DELIVERY.minX + L.DELIVERY.maxX) / 2, 0.015,
    (L.DELIVERY.minZ + L.DELIVERY.maxZ) / 2,
  );
  scene.add(zone);
  const zoneLabel = textLabel('🚚 ЗОНА РАЗГРУЗКИ', { width: 3.2, height: 0.5, color: '#fde68a' });
  zoneLabel.mesh.position.set((L.DELIVERY.minX + L.DELIVERY.maxX) / 2, 2.0, L.DELIVERY.minZ - 0.9);
  scene.add(zoneLabel.mesh);

  // ворота склада
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 3.0, 6),
    new THREE.MeshStandardMaterial({ color: '#98a3ae', metalness: 0.4, roughness: 0.6 }),
  );
  gate.position.set(L.STORE.minX + 0.2, 1.5, 12);
  scene.add(gate);

  // стеллажи-паллеты (декор)
  for (const [x, z] of [[6.5, 16.4], [9.5, 16.4]]) {
    const rack = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.6, 0.9),
      new THREE.MeshStandardMaterial({ color: '#8b6a3d', roughness: 0.9 }),
    );
    rack.position.set(x, 1.3, z);
    scene.add(rack);
  }
}

// ---------------------------------------------------- обновление стеллажей

export function updateShelfVisual(ref, data, price) {
  const product = data.p ? PRODUCT_BY_ID[data.p] : null;
  const unlocked = !!data.u;
  ref.frame.visible = unlocked;
  ref.items.visible = unlocked;
  ref.label.mesh.visible = unlocked;
  ref.locked.visible = !unlocked;

  if (ref.product !== data.p) {
    ref.product = data.p;
    ref.mat.color.set(product ? product.color : '#cccccc');
  }
  const count = Math.min(data.c, ITEM_ROWS * ITEM_COLS);
  if (ref.items.count !== count) ref.items.count = count;
  if (ref.count !== data.c || ref.lastPrice !== price) {
    ref.count = data.c;
    ref.lastPrice = price;
    drawPriceTag(ref.label, product, data.c, price ?? (product ? product.market : 0));
  }
}

export function updateCheckoutVisual(ref, data) {
  const unlocked = !!data.u;
  ref.group.children.forEach((c) => { if (c !== ref.locked) c.visible = unlocked; });
  ref.locked.visible = !unlocked;
  if (!unlocked) return;

  let idx = 0;
  for (const item of data.items) {
    const product = PRODUCT_BY_ID[item.p];
    const qty = Math.min(item.q, 3);
    for (let k = 0; k < qty && idx < ref.beltItems.length; k++, idx++) {
      const m = ref.beltItems[idx];
      m.visible = !item.s;
      m.material.color.set(product ? product.color : '#ccc');
    }
  }
  for (; idx < ref.beltItems.length; idx++) ref.beltItems[idx].visible = false;

  const g = ref.regLabel.ctx;
  const cv = ref.regLabel.cv;
  g.clearRect(0, 0, cv.width, cv.height);
  roundRect(g, 0, 0, cv.width, cv.height, 8);
  g.fillStyle = data.st === 'payment' ? '#14532d' : '#0b1620';
  g.fill();
  g.fillStyle = data.st === 'payment' ? '#86efac' : '#5eead4';
  g.font = `800 ${cv.height * 0.42}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = data.st === 'idle' ? '—'
    : data.st === 'unloading' ? '...'
      : data.st === 'scanning' ? `${data.items.filter((i) => !i.s).length} поз.`
        : `$${data.total.toFixed(2)}`;
  g.fillText(text, cv.width / 2, cv.height / 2);
  ref.regLabel.update();
}
