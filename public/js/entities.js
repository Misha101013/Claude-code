// Динамические объекты: другие игроки, покупатели, коробки на полу.

import * as THREE from 'three';
import { PRODUCT_BY_ID } from '/shared/products.js';
import { textLabel } from './scene.js';

const SKIN = ['#f2c9a0', '#e0ac81', '#c68863', '#8d5524', '#5b3a21'];
const SHIRT = ['#e74c3c', '#3498db', '#27ae60', '#9b59b6', '#f1c40f', '#1abc9c', '#e67e22', '#95a5a6'];

const boxTexCache = new Map();
const BOX_GEO = new THREE.BoxGeometry(0.52, 0.44, 0.52);
const SHADOW_GEO = new THREE.CircleGeometry(0.4, 16);
const SHADOW_MAT = new THREE.MeshBasicMaterial({
  color: '#000000', transparent: true, opacity: 0.22, depthWrite: false,
});

export function boxTexture(productId) {
  if (boxTexCache.has(productId)) return boxTexCache.get(productId);
  const p = PRODUCT_BY_ID[productId];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#c89b6a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,.06)';
  for (let i = 0; i < 260; i += 8) g.fillRect(0, i, 256, 3);
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.fillRect(0, 108, 256, 40);
  g.font = '96px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(p ? p.emoji : '📦', 128, 78);
  g.fillStyle = '#3b2b1b';
  g.font = 'bold 30px Inter, sans-serif';
  g.fillText(p ? p.name.toUpperCase() : 'КОРОБКА', 128, 128);
  g.font = '22px Inter, sans-serif';
  g.fillStyle = '#5a4630';
  g.fillText(p ? `${p.perBox} шт` : '', 128, 180);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  boxTexCache.set(productId, tex);
  return tex;
}

export function makeBoxMesh(productId) {
  const mat = new THREE.MeshStandardMaterial({ map: boxTexture(productId), roughness: 0.85 });
  return new THREE.Mesh(BOX_GEO, mat);
}

function makeCharacter({ shirt = 0, skin = 0, scale = 1, color = null }) {
  const group = new THREE.Group();
  // body крутится по yaw, group остаётся невращаемым — чтобы таблички
  // над головой всегда смотрели в камеру
  const body = new THREE.Group();
  group.add(body);
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN[skin % SKIN.length], roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: color || SHIRT[shirt % SHIRT.length], roughness: 0.75,
  });
  const pantsMat = new THREE.MeshStandardMaterial({ color: '#33404f', roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), shirtMat);
  torso.position.y = 1.12;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.y = 1.57;
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.09, 0.28),
    new THREE.MeshStandardMaterial({ color: ['#2b2118', '#5d4037', '#c9a227', '#9e9e9e'][skin % 4] }),
  );
  hair.position.y = 1.73;
  for (const ex of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 0.02),
      new THREE.MeshBasicMaterial({ color: '#1b1b1b' }),
    );
    eye.position.set(ex, 1.6, 0.135);
    body.add(eye);
  }

  // рукава чуть темнее корпуса, иначе руки сливаются с торсом
  const sleeveMat = shirtMat.clone();
  sleeveMat.color.multiplyScalar(0.78);
  const arms = [];
  for (const ax of [-0.3, 0.3]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.16), sleeveMat);
    arm.geometry.translate(0, -0.24, 0);
    arm.position.set(ax, 1.36, 0);
    arms.push(arm);
    body.add(arm);
  }

  const legs = [];
  for (const lx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.2), pantsMat);
    leg.geometry.translate(0, -0.34, 0);
    leg.position.set(lx, 0.78, 0);
    legs.push(leg);
    body.add(leg);
  }

  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;

  body.add(torso, head, hair);
  group.add(shadow);
  group.scale.setScalar(scale);
  return { group, body, torso, head, arms, legs };
}

class Interp {
  constructor(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.tx = x; this.tz = z; this.tyaw = yaw;
    this.speed = 0;
  }

  set(x, z, yaw) { this.tx = x; this.tz = z; this.tyaw = yaw; }

  step(dt) {
    const k = 1 - Math.exp(-14 * dt);
    const px = this.x;
    const pz = this.z;
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    let d = this.tyaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * k;
    const moved = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-4);
    this.speed += (moved - this.speed) * 0.25;
  }
}

export class Entities {
  constructor(root, selfIdRef) {
    this.root = root;
    this.selfIdRef = selfIdRef;
    this.players = new Map();
    this.customers = new Map();
    this.boxes = new Map();
    this.time = 0;
  }

  syncPlayers(list) {
    const seen = new Set();
    for (const p of list) {
      if (p.i === this.selfIdRef.id) continue;
      seen.add(p.i);
      let e = this.players.get(p.i);
      if (!e) {
        const model = makeCharacter({ shirt: p.i, skin: p.i % 5, color: p.c });
        const tag = textLabel(p.n, { width: 1.8, height: 0.36, size: 0.5, color: p.c });
        tag.mesh.position.y = 2.05;
        model.group.add(tag.mesh);
        this.root.add(model.group);
        e = { model, tag, interp: new Interp(p.x, p.z, p.y), held: null };
        this.players.set(p.i, e);
      }
      e.interp.set(p.x, p.z, p.y);
      e.moving = !!p.m;
      e.tagMesh = e.tag.mesh;

      // коробка в руках
      const heldId = p.h ? p.h.p : null;
      if (heldId !== (e.heldId || null)) {
        if (e.held) { e.model.body.remove(e.held); e.held.material.dispose(); }
        e.held = null;
        e.heldId = heldId;
        if (heldId) {
          const mesh = makeBoxMesh(heldId);
          mesh.position.set(0, 1.15, 0.42);
          e.model.body.add(mesh);
          e.held = mesh;
        }
      }
    }
    for (const [id, e] of this.players) {
      if (!seen.has(id)) {
        this.root.remove(e.model.group);
        this.players.delete(id);
      }
    }
  }

  syncCustomers(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.i);
      let e = this.customers.get(c.i);
      if (!e) {
        const model = makeCharacter({ shirt: c.sh, skin: c.k, scale: c.sc });
        const basket = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.22, 0.24),
          new THREE.MeshStandardMaterial({ color: '#c0392b' }),
        );
        basket.position.set(0.34, 0.95, 0.16);
        basket.visible = false;
        model.body.add(basket);
        const bubble = textLabel('', { width: 0.6, height: 0.6, bg: false, size: 0.8 });
        bubble.mesh.position.y = 2.05;
        bubble.mesh.visible = false;
        model.group.add(bubble.mesh);
        this.root.add(model.group);
        e = { model, basket, bubble, interp: new Interp(c.x, c.z, c.y), mood: 1, bubbleText: '' };
        this.customers.set(c.i, e);
      }
      e.interp.set(c.x, c.z, c.y);
      e.basket.visible = c.b > 0;
      e.state = c.s;

      const face = c.m < 0 ? '😡' : c.s === 'queue' || c.s === 'toqueue' ? '🧾' : c.s === 'shelf' || c.s === 'browse' ? '🤔' : '';
      if (face !== e.bubbleText) {
        e.bubbleText = face;
        e.bubble.mesh.visible = !!face;
        if (face) {
          const g = e.bubble.ctx;
          const cv = e.bubble.cv;
          g.clearRect(0, 0, cv.width, cv.height);
          g.font = `${cv.height * 0.75}px serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(face, cv.width / 2, cv.height / 2);
          e.bubble.update();
        }
      }
    }
    for (const [id, e] of this.customers) {
      if (!seen.has(id)) {
        this.root.remove(e.model.group);
        this.customers.delete(id);
      }
    }
  }

  syncBoxes(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.i);
      let e = this.boxes.get(b.i);
      if (!e || e.productId !== b.p) {
        if (e) this.root.remove(e.mesh);
        const mesh = makeBoxMesh(b.p);
        mesh.rotation.y = (hashCode(b.i) % 100) / 100 * 0.6 - 0.3;
        this.root.add(mesh);
        const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -0.2;
        shadow.scale.setScalar(0.8);
        mesh.add(shadow);
        // отдельный увеличенный хитбокс — чтобы коробку было легко «поймать»
        // прицелом, не утыкаясь носом в пол
        const hit = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 1.3, 0.9),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hit.position.y = 0.35;
        mesh.add(hit);
        e = { mesh, hit, productId: b.p };
        this.boxes.set(b.i, e);
      }
      e.mesh.position.set(b.x, 0.23, b.z);
      e.count = b.c;
      e.hit.userData.interact = { kind: 'box', id: b.i, count: b.c, productId: b.p };
    }
    for (const [id, e] of this.boxes) {
      if (!seen.has(id)) {
        this.root.remove(e.mesh);
        this.boxes.delete(id);
      }
    }
  }

  get boxMeshes() {
    return [...this.boxes.values()].map((b) => b.hit);
  }

  update(dt, camera) {
    this.time += dt;
    const animate = (e) => {
      e.interp.step(dt);
      const g = e.model.group;
      g.position.set(e.interp.x, 0, e.interp.z);
      e.model.body.rotation.y = e.interp.yaw;
      const speed = e.interp.speed;
      const swing = Math.min(speed / 3, 1.2);
      const phase = this.time * 9 * Math.min(1, speed / 1.5 + 0.001);
      const s = Math.sin(phase) * 0.5 * swing;
      e.model.legs[0].rotation.x = s;
      e.model.legs[1].rotation.x = -s;
      e.model.arms[0].rotation.x = -s * 0.8;
      e.model.arms[1].rotation.x = s * 0.8;
      g.position.y = Math.abs(Math.sin(phase)) * 0.03 * swing;
    };
    for (const e of this.players.values()) {
      animate(e);
      if (e.tagMesh && camera) e.tagMesh.quaternion.copy(camera.quaternion);
    }
    for (const e of this.customers.values()) {
      animate(e);
      if (e.bubble.mesh.visible && camera) e.bubble.mesh.quaternion.copy(camera.quaternion);
    }
  }
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
