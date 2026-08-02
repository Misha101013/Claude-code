// Точка входа клиента: сцена, цикл, ввод, склейка сети и интерфейса.

import * as THREE from 'three';
import * as L from '/shared/layout.js';
import { PRODUCT_BY_ID } from '/shared/products.js';
import { INTERACT_RANGE, SHELF_CAPACITY, EMPTY_BOX_REFUND, money } from '/shared/config.js';
import { buildWorld, updateShelfVisual, updateCheckoutVisual } from './scene.js';
import { Entities } from './entities.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { initAudio, sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------- стартовый экран

const savedName = localStorage.getItem('mt_name') || '';
const savedRoom = localStorage.getItem('mt_room') || '';
$('nameInput').value = savedName;
$('roomInput').value = new URLSearchParams(location.search).get('room') || savedRoom;

async function loadRooms() {
  const list = $('roomList');
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    if (!data.rooms.length) {
      list.innerHTML = '<span class="muted">Пока никто не играет — создай свой магазин.</span>';
      return;
    }
    list.innerHTML = data.rooms.map((r) => `
      <div class="room-chip" data-room="${r.code}">
        <b>${r.code}</b> · 👥 ${r.players} · день ${r.day} ${r.open ? '🟢' : '🔴'}
      </div>`).join('');
    list.querySelectorAll('[data-room]').forEach((el) => el.addEventListener('click', () => {
      $('roomInput').value = el.dataset.room;
    }));
  } catch {
    list.innerHTML = '<span class="muted">Не удалось получить список.</span>';
  }
}
loadRooms();
$('refreshRooms').addEventListener('click', loadRooms);

$('playBtn').addEventListener('click', () => start());
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('roomInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

// ------------------------------------------------------------------ игра

let started = false;

function start() {
  if (started) return;
  started = true;
  const name = ($('nameInput').value || 'Менеджер').trim().slice(0, 18);
  const room = ($('roomInput').value || 'MAIN').trim().toUpperCase().slice(0, 8) || 'MAIN';
  localStorage.setItem('mt_name', name);
  localStorage.setItem('mt_room', room);
  $('splash').classList.add('hidden');
  $('game').classList.remove('hidden');
  initAudio();
  new Game(name, room);
}

class Game {
  constructor(name, room) {
    const canvas = $('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 250);
    this.scene.add(this.camera);

    this.refs = buildWorld(this.scene);
    this.selfRef = { id: -1 };
    this.entities = new Entities(this.refs.actorRoot, this.selfRef);
    this.player = new Player(this.camera, canvas);
    this.player.onStep = () => sfx.step();

    this.net = new Net();
    this.ui = new UI((msg) => this.net.send(msg));
    this.ui.onCloseLaptop = () => this.player.lock();

    this.store = null;
    this.target = null;
    this.restocking = false;
    this.scanAcc = 0;
    this.chatOpen = false;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = INTERACT_RANGE;
    this.pointer = new THREE.Vector2(0, 0);
    this.lastFrame = performance.now();

    this.bindNet();
    this.bindInput(canvas);
    this.net.connect(name, room);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.renderer.setAnimationLoop(() => this.frame());
    window.game = this;
  }

  // ------------------------------------------------------------------ сеть

  bindNet() {
    const net = this.net;

    net.on('init', (msg) => {
      this.selfRef.id = msg.you.id;
      this.selfName = msg.you.name;
      this.applyStore(msg.store);
      this.ui.chatLine(`Ты в магазине «${msg.code}». Нажми на экран, чтобы начать.`, { sys: true });
    });

    net.on('store', (msg) => this.applyStore(msg.store));

    net.on('sync', (msg) => {
      this.entities.syncPlayers(msg.players);
      this.entities.syncCustomers(msg.customers);
      this.entities.syncBoxes(msg.boxes);
      this.ui.setPlayers(msg.players, this.selfRef.id);
      const me = msg.players.find((p) => p.i === this.selfRef.id);
      this.ui.setTask({
        held: me ? me.h : null,
        boxes: msg.boxes.length,
        queue: this.store ? this.store.checkouts.reduce((n, c) => n + c.q, 0) : 0,
      });
      if (me) {
        this.myHeld = me.h;
        this.player.setHeld(me.h ? me.h.p : null);
        this.ui.setHeld(me.h);
        if (!me.h) this.restocking = false;
      }
    });

    net.on('chat', (msg) => this.ui.chatLine(msg.text, { from: msg.from, color: msg.color }));
    net.on('sys', (msg) => {
      this.ui.chatLine(msg.text, { sys: true });
      if (msg.text.includes('Уровень')) sfx.levelUp();
    });
    net.on('toast', (msg) => {
      this.ui.toast(msg.text, msg.kind);
      if (msg.kind === 'error' || msg.kind === 'warn') sfx.error();
    });
    net.on('summary', (msg) => {
      this.ui.showSummary(msg.summary);
      this.player.unlock();
    });

    net.on('fx', (msg) => {
      const d = msg.x != null ? Math.hypot(msg.x - this.player.x, msg.z - this.player.z) : 0;
      if (d > 22) return;
      if (msg.kind === 'beep') sfx.beep();
      else if (msg.kind === 'cash') sfx.cash();
      else if (msg.kind === 'truck') sfx.truck();
      else if (msg.kind === 'angry') sfx.angry();
      else if (msg.kind === 'trash') sfx.drop();
      else if (msg.kind === 'expensive') sfx.error();
    });

    net.on('close', () => $('disconnected').classList.remove('hidden'));
  }

  applyStore(store) {
    const wasOpen = this.store?.open;
    this.store = store;
    this.shelfById = new Map(store.shelves.map((s) => [s.id, s]));
    this.checkoutById = new Map(store.checkouts.map((c) => [c.id, c]));
    this.ui.setStore(store);

    for (const s of store.shelves) {
      const ref = this.refs.shelves.get(s.id);
      if (ref) updateShelfVisual(ref, s, store.prices[s.p]);
    }
    for (const c of store.checkouts) {
      const ref = this.refs.checkouts.get(c.id);
      if (ref) updateCheckoutVisual(ref, c);
    }

    this.refs.switchLight.material.color.set(store.open ? '#4ade80' : '#f87171');
    if (wasOpen !== store.open) {
      const sign = this.refs.doorSign;
      const g = sign.ctx;
      const cv = sign.cv;
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = store.open ? '#0f5132' : '#4a1d1d';
      g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = store.open ? '#6ee7b7' : '#fca5a5';
      g.font = `800 ${cv.height * 0.45}px Inter, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(store.open ? 'ОТКРЫТО' : 'ЗАКРЫТО', cv.width / 2, cv.height / 2);
      sign.update();
      if (store.open && wasOpen === false) sfx.open();
    }
  }

  // ------------------------------------------------------------------ ввод

  bindInput(canvas) {
    canvas.addEventListener('click', () => {
      if (!this.ui.modalOpen && !this.chatOpen) this.player.lock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && !this.ui.modalOpen && !this.chatOpen) {
        $('pause').classList.remove('hidden');
      }
    });
    $('resumeBtn').addEventListener('click', () => {
      $('pause').classList.add('hidden');
      this.player.lock();
    });

    const chatInput = $('chatInput');
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) this.net.send({ t: 'chat', text });
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });

    addEventListener('keydown', (e) => {
      if (this.chatOpen) return;
      if (e.target instanceof HTMLInputElement) return;
      this.player.keys.add(e.code);

      switch (e.code) {
        case 'KeyE':
          if (!e.repeat) this.pressInteract();
          break;
        case 'KeyF':
          if (this.myHeld) { this.net.send({ t: 'act', a: 'dropBox' }); sfx.drop(); }
          break;
        case 'Tab':
          e.preventDefault();
          this.toggleLaptop();
          break;
        case 'KeyT':
          e.preventDefault();
          this.openChat();
          break;
        case 'KeyM':
          this.ui.toggleMap();
          break;
        case 'Escape':
          if (this.ui.laptopOpen) this.ui.closeLaptop();
          break;
        default:
          break;
      }
    });

    addEventListener('keyup', (e) => {
      this.player.keys.delete(e.code);
      if (e.code === 'KeyE' && this.restocking) {
        this.restocking = false;
        this.net.send({ t: 'act', a: 'restock', on: false });
      }
    });

    addEventListener('blur', () => this.player.keys.clear());
  }

  openChat() {
    this.chatOpen = true;
    this.player.keys.clear();
    const input = $('chatInput');
    input.classList.remove('hidden');
    input.value = '';
    input.focus();
  }

  closeChat() {
    this.chatOpen = false;
    const input = $('chatInput');
    input.value = '';
    input.classList.add('hidden');
    input.blur();
  }

  toggleLaptop() {
    if (this.ui.laptopOpen) { this.ui.closeLaptop(); return; }
    const d = Math.hypot(this.player.x - L.DESK_SPOT.x, this.player.z - L.DESK_SPOT.z);
    if (d > 3.6) { this.ui.toast('Ноутбук стоит на складе', 'warn'); sfx.error(); return; }
    this.player.unlock();
    $('pause').classList.add('hidden');
    this.ui.openLaptop();
  }

  pressInteract() {
    const t = this.target;
    if (!t) return;
    const kind = t.kind;

    if (kind === 'box' && !this.myHeld) {
      this.net.send({ t: 'act', a: 'takeBox', id: t.id });
      sfx.pickup();
    } else if (kind === 'shelf') {
      const shelf = this.shelfById?.get(t.id);
      if (!shelf || !shelf.u) return;
      if (this.myHeld && this.myHeld.c > 0) {
        this.restocking = true;
        this.net.send({ t: 'act', a: 'restock', shelfId: t.id, on: true });
      } else if (shelf.p && shelf.c === 0) {
        this.net.send({ t: 'act', a: 'clearShelf', shelfId: t.id });
      }
    } else if (kind === 'checkout') {
      const co = this.checkoutById?.get(t.id);
      if (!co || !co.u) return;
      if (co.st === 'scanning') this.net.send({ t: 'act', a: 'scan', checkoutId: t.id });
      else if (co.st === 'payment') this.net.send({ t: 'act', a: 'pay', checkoutId: t.id });
    } else if (kind === 'laptop') {
      this.toggleLaptop();
    } else if (kind === 'trash') {
      this.net.send({ t: 'act', a: 'trashBox' });
    } else if (kind === 'switch') {
      this.net.send({ t: 'act', a: 'toggleOpen' });
    }
  }

  // --------------------------------------------------------- прицел и цикл

  updateTarget() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objs = [...this.refs.interactables, ...this.entities.boxMeshes];
    const hits = this.raycaster.intersectObjects(objs, false);
    let found = null;
    for (const hit of hits) {
      const info = hit.object.userData.interact;
      if (!info) continue;
      if (hit.distance > INTERACT_RANGE) break;
      found = { ...info, distance: hit.distance };
      break;
    }
    this.target = found;
    this.ui.setPrompt(this.promptFor(found));
  }

  promptFor(t) {
    if (!t || !this.store) return null;
    const key = (k) => `<kbd>${k}</kbd>`;
    if (t.kind === 'box') {
      if (this.myHeld) return `<span class="muted">Руки заняты</span><span class="sub">${key('F')} бросить коробку</span>`;
      const p = PRODUCT_BY_ID[t.productId];
      return `${key('E')} Взять коробку — ${p ? p.name : ''} <b>${t.count}</b> шт`;
    }
    if (t.kind === 'shelf') {
      const shelf = this.shelfById?.get(t.id);
      if (!shelf) return null;
      if (!shelf.u) return `<span class="muted">Стеллаж не куплен</span><span class="sub">купи в ноутбуке на складе</span>`;
      const product = shelf.p ? PRODUCT_BY_ID[shelf.p] : null;
      if (this.myHeld && this.myHeld.c > 0) {
        const held = PRODUCT_BY_ID[this.myHeld.p];
        if (product && shelf.p !== this.myHeld.p) {
          return `<span class="muted">Здесь ${product.name}</span><span class="sub">в руках ${held.name} — нужен другой стеллаж</span>`;
        }
        if (shelf.c >= SHELF_CAPACITY) return '<span class="muted">Стеллаж полный</span>';
        return `${key('E')} <b>Удерживай</b> — выложить ${held.name}<span class="sub">${shelf.c}/${SHELF_CAPACITY} на полке</span>`;
      }
      if (!product) return `<span class="muted">Пустой стеллаж</span><span class="sub">принеси коробку со склада</span>`;
      const price = this.store.prices[shelf.p] ?? product.market;
      const line = `${product.emoji} ${product.name} — ${money(price)} · ${shelf.c}/${SHELF_CAPACITY}`;
      if (shelf.c === 0) return `${key('E')} Освободить стеллаж<span class="sub">${line}</span>`;
      return `<span class="muted">${line}</span>`;
    }
    if (t.kind === 'checkout') {
      const co = this.checkoutById?.get(t.id);
      if (!co) return null;
      if (!co.u) return `<span class="muted">Касса не куплена</span><span class="sub">купи в ноутбуке на складе</span>`;
      if (co.e) return `<span class="muted">🧑‍💼 Работает кассир</span>`;
      if (co.st === 'scanning') {
        const left = co.items.filter((i) => !i.s).length;
        return `${key('E')} Пробить товар <span class="sub">осталось позиций: ${left}</span>`;
      }
      if (co.st === 'payment') return `${key('E')} Принять оплату <b>${money(co.total)}</b>`;
      if (co.st === 'unloading') return '<span class="muted">Покупатель выкладывает товар…</span>';
      return `<span class="muted">Касса свободна</span><span class="sub">очередь: ${co.q}</span>`;
    }
    if (t.kind === 'laptop') return `${key('E')} Ноутбук — заказы, цены, апгрейды`;
    if (t.kind === 'trash') {
      if (this.myHeld && this.myHeld.c === 0) return `${key('E')} Сдать пустую коробку <b>+${money(EMPTY_BOX_REFUND)}</b>`;
      return '<span class="muted">Сюда сдают пустые коробки</span>';
    }
    if (t.kind === 'switch') {
      return `${key('E')} ${this.store.open ? 'Закрыть магазин' : 'Открыть магазин'}`;
    }
    return null;
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const uiFocused = this.ui.modalOpen || this.chatOpen;

    this.player.update(dt, uiFocused);
    this.entities.update(dt, this.camera);
    this.net.sendInput(dt, this.player);
    this.updateTarget();

    // удержание E: сканирование и выкладка
    if (!uiFocused && this.player.keys.has('KeyE') && this.target?.kind === 'checkout') {
      this.scanAcc += dt;
      if (this.scanAcc > 0.22) {
        this.scanAcc = 0;
        const co = this.checkoutById?.get(this.target.id);
        if (co?.st === 'scanning') this.net.send({ t: 'act', a: 'scan', checkoutId: this.target.id });
      }
    }

    if (this.restocking && this.myHeld) {
      const p = PRODUCT_BY_ID[this.myHeld.p];
      this.ui.setRestock(p ? this.myHeld.c / p.perBox : 0);
    } else {
      this.ui.setRestock(null);
    }

    this.ui.drawMinimap(this.player, this.entities);
    this.renderer.render(this.scene, this.camera);
  }
}
