// Авторитетная симуляция одного магазина (комнаты).
// Клиенты только рисуют состояние и шлют свои намерения.

import * as C from '../shared/config.js';
import {
  PRODUCTS, PRODUCT_BY_ID, priceAppeal, CATEGORY_WEIGHT, productsForLevel,
} from '../shared/products.js';
import * as L from '../shared/layout.js';
import { findPath, navBoxes } from './nav.js';
import { resolveCircle, dist } from '../shared/physics.js';

const S = {
  ENTER: 'enter',
  SHELF: 'shelf',
  BROWSE: 'browse',
  TO_QUEUE: 'toqueue',
  QUEUE: 'queue',
  UNLOAD: 'unload',
  WAIT: 'wait',
  LEAVE: 'leave',
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round2 = (v) => Math.round(v * 100) / 100;

export class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.customers = new Map();
    this.boxes = new Map();
    this.nextPlayerId = 1;
    this.nextCustomerId = 1;
    this.nextBoxId = 1;
    this.nextDeliveryId = 1;
    this.colorCursor = 0;
    this.storeDirty = true;
    this.spawnTimer = 4;
    this.lastActivity = Date.now();

    this.state = {
      money: C.START_MONEY,
      xp: 0,
      level: 1,
      rating: C.RATING_START,
      day: 1,
      clock: 0,
      open: false,
      dayOver: false,
      prices: {},
      stats: { revenue: 0, spent: 0, served: 0, lost: 0 },
      summary: null,
      deliveries: [],
    };

    for (const p of PRODUCTS) this.state.prices[p.id] = p.market;

    this.ratings = [C.RATING_START, C.RATING_START, C.RATING_START];

    this.shelves = new Map();
    for (const s of L.SHELVES) {
      this.shelves.set(s.id, {
        id: s.id, def: s, unlocked: s.free, productId: null, count: 0,
      });
    }

    this.checkouts = new Map();
    for (const c of L.CHECKOUTS) {
      this.checkouts.set(c.id, {
        id: c.id, def: c, unlocked: c.free, employee: false,
        state: 'idle', items: [], total: 0, busy: null, queue: [],
        timer: 0, doneTimer: 0,
      });
    }
  }

  // ---------------------------------------------------------------- игроки

  addPlayer(ws, rawName) {
    const id = this.nextPlayerId++;
    const name = sanitizeName(rawName) || `Игрок ${id}`;
    const color = C.PLAYER_COLORS[this.colorCursor++ % C.PLAYER_COLORS.length];
    const player = {
      id, ws, name, color,
      x: L.SPAWN.x + rnd(-1.2, 1.2), z: L.SPAWN.z + rnd(-1, 1), yaw: L.SPAWN.yaw,
      moving: false, sprint: false,
      held: null,
      restockShelf: null,
      restockTimer: 0,
    };
    this.players.set(id, player);
    this.send(player, {
      t: 'init',
      you: { id, name, color },
      code: this.code,
      store: this.serializeStore(),
    });
    this.broadcast({ t: 'sys', text: `${name} зашёл в смену` });
    this.storeDirty = true;
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.held) this.dropHeld(p);
    this.players.delete(id);
    this.broadcast({ t: 'sys', text: `${p.name} ушёл со смены` });
  }

  get empty() { return this.players.size === 0; }

  send(player, msg) {
    if (player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p === except) continue;
      if (p.ws && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  toast(player, text, kind = 'info') {
    this.send(player, { t: 'toast', text, kind });
  }

  // -------------------------------------------------------------- сообщения

  handle(player, msg) {
    this.lastActivity = Date.now();
    switch (msg.t) {
      case 'input': {
        const x = Number(msg.x);
        const z = Number(msg.z);
        const yaw = Number(msg.yaw);
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
        player.x = clampNum(x, L.STORE.minX - 4, L.STORE.maxX + 4);
        player.z = clampNum(z, L.STORE.minZ - 8, L.STORE.maxZ + 4);
        player.yaw = yaw;
        player.moving = !!msg.m;
        player.sprint = !!msg.s;
        break;
      }
      case 'act':
        this.action(player, msg);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 160).replace(/[<>]/g, '');
        if (text.trim()) {
          this.broadcast({ t: 'chat', from: player.name, color: player.color, text });
        }
        break;
      }
      default:
        break;
    }
  }

  near(player, point, range = C.INTERACT_RANGE) {
    return dist(player.x, player.z, point.x, point.z) <= range;
  }

  action(player, msg) {
    const a = msg.a;
    switch (a) {
      case 'takeBox': return this.actTakeBox(player, msg.id);
      case 'dropBox': return this.actDropBox(player);
      case 'trashBox': return this.actTrashBox(player);
      case 'restock': return this.actRestock(player, msg.shelfId, !!msg.on);
      case 'clearShelf': return this.actClearShelf(player, msg.shelfId);
      case 'scan': return this.actScan(player, msg.checkoutId);
      case 'pay': return this.actPay(player, msg.checkoutId);
      case 'order': return this.actOrder(player, msg.lines);
      case 'setPrice': return this.actSetPrice(player, msg.productId, msg.price);
      case 'buyShelf': return this.actBuyShelf(player, msg.shelfId);
      case 'buyCheckout': return this.actBuyCheckout(player, msg.checkoutId);
      case 'hire': return this.actHire(player, msg.checkoutId, !!msg.on);
      case 'toggleOpen': return this.actToggleOpen(player);
      case 'nextDay': return this.actNextDay(player);
      default: return undefined;
    }
  }

  atDesk(player) {
    return this.near(player, L.DESK_SPOT, 3.6);
  }

  // --------------------------------------------------------------- коробки

  actTakeBox(player, id) {
    if (player.held) return this.toast(player, 'Руки заняты', 'warn');
    const box = this.boxes.get(id);
    if (!box) return;
    if (!this.near(player, box, 2.2)) return;
    this.boxes.delete(id);
    player.held = { boxId: id, productId: box.productId, count: box.count };
    this.storeDirty = true;
  }

  dropHeld(player, x = player.x, z = player.z) {
    if (!player.held) return;
    const h = player.held;
    player.held = null;
    player.restockShelf = null;
    this.boxes.set(h.boxId, {
      id: h.boxId, productId: h.productId, count: h.count,
      x: clampNum(x, L.STORE.minX + 1, L.STORE.maxX - 1),
      z: clampNum(z, L.STORE.minZ + 1, L.STORE.maxZ - 1),
    });
  }

  actDropBox(player) {
    if (!player.held) return;
    const fx = player.x + Math.sin(player.yaw) * 0.9;
    const fz = player.z + Math.cos(player.yaw) * 0.9;
    this.dropHeld(player, fx, fz);
  }

  actTrashBox(player) {
    if (!player.held) return;
    if (!this.near(player, L.TRASH, 2.6)) return;
    const h = player.held;
    if (h.count > 0) {
      this.toast(player, 'Коробка не пустая — выложи товар', 'warn');
      return;
    }
    player.held = null;
    this.state.money += C.EMPTY_BOX_REFUND;
    this.storeDirty = true;
    this.broadcast({ t: 'fx', kind: 'trash', x: L.TRASH.x, z: L.TRASH.z });
  }

  actRestock(player, shelfId, on) {
    if (!on) { player.restockShelf = null; return; }
    if (!player.held || player.held.count <= 0) return;
    const shelf = this.shelves.get(shelfId);
    if (!shelf || !shelf.unlocked) return;
    if (!this.near(player, shelf.def, 2.4)) return;
    if (shelf.productId && shelf.productId !== player.held.productId) {
      return this.toast(player, 'На стеллаже другой товар', 'warn');
    }
    if (shelf.count >= C.SHELF_CAPACITY) {
      return this.toast(player, 'Стеллаж заполнен', 'warn');
    }
    player.restockShelf = shelfId;
    player.restockTimer = 0;
  }

  actClearShelf(player, shelfId) {
    const shelf = this.shelves.get(shelfId);
    if (!shelf || !this.near(player, shelf.def, 2.4)) return;
    if (shelf.count > 0) return this.toast(player, 'Сначала распродай товар', 'warn');
    shelf.productId = null;
    this.storeDirty = true;
  }

  // ------------------------------------------------------------------ касса

  actScan(player, checkoutId) {
    const co = this.checkouts.get(checkoutId);
    if (!co || !co.unlocked) return;
    if (!this.near(player, co.def.staff, 2.2)) return;
    if (co.state !== 'scanning') return;
    this.scanOne(co);
  }

  scanOne(co) {
    const item = co.items.find((i) => !i.scanned);
    if (!item) return;
    item.scanned = true;
    this.broadcast({ t: 'fx', kind: 'beep', x: co.def.x, z: co.def.z });
    if (co.items.every((i) => i.scanned)) {
      co.state = 'payment';
      co.total = round2(co.items.reduce((s, i) => s + i.price * i.qty, 0));
    }
    this.storeDirty = true;
  }

  actPay(player, checkoutId) {
    const co = this.checkouts.get(checkoutId);
    if (!co || !co.unlocked) return;
    if (!this.near(player, co.def.staff, 2.2)) return;
    this.takePayment(co);
  }

  takePayment(co) {
    if (co.state !== 'payment') return;
    const total = co.total;
    this.state.money += total;
    this.state.stats.revenue += total;
    this.state.xp += Math.round(total * 2);
    this.state.stats.served += 1;
    this.checkLevel();
    co.state = 'done';
    co.doneTimer = 0.9;
    this.broadcast({ t: 'fx', kind: 'cash', x: co.def.x, z: co.def.z, amount: total });
    this.storeDirty = true;
  }

  // ---------------------------------------------------------------- ноутбук

  actOrder(player, lines) {
    if (!this.atDesk(player)) return this.toast(player, 'Подойди к ноутбуку', 'warn');
    if (!Array.isArray(lines) || !lines.length) return;
    const level = this.state.level;
    let cost = 0;
    const clean = [];
    for (const line of lines.slice(0, 40)) {
      const p = PRODUCT_BY_ID[line.productId];
      const n = Math.floor(Number(line.boxes));
      if (!p || !Number.isFinite(n) || n <= 0 || n > 30) continue;
      if (p.level > level) continue;
      clean.push({ productId: p.id, boxes: n });
      cost += p.boxCost * n;
    }
    if (!clean.length) return;
    cost = round2(cost + C.DELIVERY_FEE);
    if (this.state.money < cost) return this.toast(player, 'Не хватает денег', 'error');
    this.state.money -= cost;
    this.state.stats.spent += cost;
    this.state.deliveries.push({
      id: this.nextDeliveryId++,
      eta: C.DELIVERY_DELAY,
      lines: clean,
      cost,
    });
    this.storeDirty = true;
    this.broadcast({ t: 'sys', text: `${player.name} заказал товар на ${C.money(cost)} — фура через ${C.DELIVERY_DELAY} сек.` });
  }

  actSetPrice(player, productId, price) {
    const p = PRODUCT_BY_ID[productId];
    if (!p) return;
    const v = Number(price);
    if (!Number.isFinite(v) || v < 0.01 || v > 999) return;
    this.state.prices[p.id] = round2(v);
    this.storeDirty = true;
  }

  actBuyShelf(player, shelfId) {
    if (!this.atDesk(player)) return this.toast(player, 'Покупки — через ноутбук на складе', 'warn');
    const shelf = this.shelves.get(shelfId);
    if (!shelf || shelf.unlocked) return;
    if (this.state.money < shelf.def.cost) return this.toast(player, 'Не хватает денег', 'error');
    this.state.money -= shelf.def.cost;
    this.state.stats.spent += shelf.def.cost;
    shelf.unlocked = true;
    this.storeDirty = true;
    this.broadcast({ t: 'sys', text: `${player.name} купил новый стеллаж` });
  }

  actBuyCheckout(player, checkoutId) {
    if (!this.atDesk(player)) return this.toast(player, 'Покупки — через ноутбук на складе', 'warn');
    const co = this.checkouts.get(checkoutId);
    if (!co || co.unlocked) return;
    if (this.state.money < co.def.cost) return this.toast(player, 'Не хватает денег', 'error');
    this.state.money -= co.def.cost;
    this.state.stats.spent += co.def.cost;
    co.unlocked = true;
    this.storeDirty = true;
    this.broadcast({ t: 'sys', text: `${player.name} открыл новую кассу` });
  }

  actHire(player, checkoutId, on) {
    if (!this.atDesk(player)) return this.toast(player, 'Наём — через ноутбук на складе', 'warn');
    const co = this.checkouts.get(checkoutId);
    if (!co || !co.unlocked) return;
    co.employee = on;
    this.storeDirty = true;
    this.broadcast({
      t: 'sys',
      text: on
        ? `${player.name} нанял кассира (${C.money(C.CASHIER_WAGE)}/день)`
        : `${player.name} уволил кассира`,
    });
  }

  actToggleOpen(player) {
    const nearSwitch = this.near(player, L.SWITCH, 3) || this.atDesk(player);
    if (!nearSwitch) return this.toast(player, 'Рубильник у входа', 'warn');
    if (this.state.dayOver) return this.toast(player, 'День закрыт — начни новый', 'warn');
    this.state.open = !this.state.open;
    this.storeDirty = true;
    this.broadcast({ t: 'sys', text: this.state.open ? '🟢 Магазин открыт!' : '🔴 Магазин закрыт' });
  }

  actNextDay(player) {
    if (!this.state.dayOver) return;
    const st = this.state;
    const shelvesOwned = [...this.shelves.values()].filter((s) => s.unlocked && !s.def.free).length;
    const cashiers = [...this.checkouts.values()].filter((c) => c.employee).length;
    const rent = C.RENT_BASE + shelvesOwned * C.RENT_PER_SHELF;
    const wages = cashiers * C.CASHIER_WAGE;
    st.money -= rent + wages;
    st.summary = {
      day: st.day,
      revenue: round2(st.stats.revenue),
      spent: round2(st.stats.spent),
      rent, wages,
      served: st.stats.served,
      lost: st.stats.lost,
      profit: round2(st.stats.revenue - st.stats.spent - rent - wages),
      money: round2(st.money),
    };
    this.broadcast({ t: 'summary', summary: st.summary });
    st.day += 1;
    st.clock = 0;
    st.open = false;
    st.dayOver = false;
    st.stats = { revenue: 0, spent: 0, served: 0, lost: 0 };
    this.storeDirty = true;
  }

  checkLevel() {
    const lvl = C.levelFromXp(this.state.xp);
    if (lvl > this.state.level) {
      this.state.level = lvl;
      const unlocked = PRODUCTS.filter((p) => p.level === lvl).map((p) => p.name);
      this.broadcast({
        t: 'sys',
        text: `⭐ Уровень ${lvl}!${unlocked.length ? ' Новые товары: ' + unlocked.join(', ') : ''}`,
      });
    }
  }

  // ------------------------------------------------------------------- тик

  tick(dt) {
    const st = this.state;

    if (st.open) {
      st.clock += dt * C.CLOCK_SCALE;
      const dayLen = (C.DAY_END_HOUR - C.DAY_START_HOUR) * 3600;
      if (st.clock >= dayLen) {
        st.clock = dayLen;
        st.open = false;
        this.broadcast({ t: 'sys', text: '🌙 22:00 — магазин закрылся автоматически' });
        this.storeDirty = true;
      }
    }

    this.updateDeliveries(dt);
    this.updateRestock(dt);
    this.updateCheckouts(dt);
    this.updateSpawning(dt);
    this.updateCustomers(dt);

    if (!st.open && !st.dayOver && this.customers.size === 0 && st.clock > 5) {
      st.dayOver = true;
      this.storeDirty = true;
      this.broadcast({ t: 'sys', text: 'Все покупатели ушли. Можно закрывать день (ноутбук на складе).' });
    }
  }

  updateDeliveries(dt) {
    const st = this.state;
    if (!st.deliveries.length) return;
    for (const d of st.deliveries) d.eta -= dt;
    const arrived = st.deliveries.filter((d) => d.eta <= 0);
    st.deliveries = st.deliveries.filter((d) => d.eta > 0);
    for (const d of arrived) {
      let spawned = 0;
      for (const line of d.lines) {
        const p = PRODUCT_BY_ID[line.productId];
        for (let i = 0; i < line.boxes; i++) {
          if (this.boxes.size >= C.MAX_FLOOR_BOXES) break;
          const spot = L.deliverySpot(this.boxes.size);
          const id = `b${this.nextBoxId++}`;
          this.boxes.set(id, {
            id, productId: p.id, count: p.perBox,
            x: spot.x + rnd(-0.18, 0.18), z: spot.z + rnd(-0.18, 0.18),
          });
          spawned++;
        }
      }
      this.broadcast({ t: 'sys', text: `🚚 Фура приехала: ${spawned} коробок на складе` });
      this.broadcast({ t: 'fx', kind: 'truck' });
    }
    this.storeDirty = true;
  }

  updateRestock(dt) {
    for (const p of this.players.values()) {
      if (!p.restockShelf || !p.held) continue;
      const shelf = this.shelves.get(p.restockShelf);
      if (!shelf || !this.near(p, shelf.def, 2.7)) { p.restockShelf = null; continue; }
      if (p.held.count <= 0 || shelf.count >= C.SHELF_CAPACITY) { p.restockShelf = null; continue; }
      if (shelf.productId && shelf.productId !== p.held.productId) { p.restockShelf = null; continue; }
      p.restockTimer += dt;
      while (p.restockTimer >= C.RESTOCK_INTERVAL && p.held.count > 0 && shelf.count < C.SHELF_CAPACITY) {
        p.restockTimer -= C.RESTOCK_INTERVAL;
        if (!shelf.productId) shelf.productId = p.held.productId;
        shelf.count += 1;
        p.held.count -= 1;
        this.storeDirty = true;
      }
      if (p.held.count <= 0 || shelf.count >= C.SHELF_CAPACITY) p.restockShelf = null;
    }
  }

  updateCheckouts(dt) {
    for (const co of this.checkouts.values()) {
      if (co.state === 'done') {
        co.doneTimer -= dt;
        if (co.doneTimer <= 0) {
          co.state = 'idle';
          co.items = [];
          co.total = 0;
          co.busy = null;
          this.storeDirty = true;
        }
        continue;
      }
      if (!co.employee) continue;
      if (co.state === 'scanning') {
        co.timer += dt;
        while (co.timer >= C.SCAN_INTERVAL && co.state === 'scanning') {
          co.timer -= C.SCAN_INTERVAL;
          this.scanOne(co);
        }
      } else if (co.state === 'payment') {
        co.timer += dt;
        if (co.timer > 0.7) { co.timer = 0; this.takePayment(co); }
      } else {
        co.timer = 0;
      }
    }
  }

  // ------------------------------------------------------------- покупатели

  stockedShelves() {
    return [...this.shelves.values()].filter((s) => s.unlocked && s.productId && s.count > 0);
  }

  updateSpawning(dt) {
    const st = this.state;
    if (!st.open) return;
    // мягкий потолок: маленький магазин не заваливает новичка толпой
    const openCheckouts = [...this.checkouts.values()].filter((c) => c.unlocked).length;
    const cap = Math.min(C.CUSTOMER_MAX, 5 + st.level * 3 + openCheckouts * 3);
    if (this.customers.size >= cap) return;
    if (!this.stockedShelves().length) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const hour = C.DAY_START_HOUR + st.clock / 3600;
    // два пика посещаемости: обед и вечер
    const curve = 0.55
      + 0.45 * Math.exp(-((hour - 12.5) ** 2) / 4.5)
      + 0.6 * Math.exp(-((hour - 18.5) ** 2) / 4.0);
    const pull = 0.35 + st.rating * 0.34 + st.level * 0.16;
    const interval = clampNum(8.5 / (pull * curve), 1.6, 18);
    this.spawnTimer = interval * rnd(0.7, 1.3);
    this.spawnCustomer();
  }

  spawnCustomer() {
    const stocked = this.stockedShelves();
    if (!stocked.length) return;

    const wants = [];
    const used = new Set();
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const pool = stocked.filter((s) => !used.has(s.productId));
      if (!pool.length) break;
      const weighted = [];
      for (const s of pool) {
        const w = Math.ceil((CATEGORY_WEIGHT[PRODUCT_BY_ID[s.productId].cat] || 1) * 3);
        for (let k = 0; k < w; k++) weighted.push(s);
      }
      const shelf = pick(weighted);
      used.add(shelf.productId);
      wants.push({ productId: shelf.productId, qty: 1 + Math.floor(Math.random() * 3) });
    }
    // иногда покупатель ищет то, чего нет на полках — это бьёт по рейтингу
    const missing = productsForLevel(this.state.level).filter((p) => !used.has(p.id));
    if (missing.length && Math.random() < 0.22) {
      wants.push({ productId: pick(missing).id, qty: 1 });
    }
    if (!wants.length) return;

    const id = this.nextCustomerId++;
    const c = {
      id,
      x: L.ENTRANCE_OUTSIDE.x + rnd(-0.8, 0.8),
      z: L.ENTRANCE_OUTSIDE.z + rnd(-1.5, 0.5),
      yaw: 0,
      speed: C.CUSTOMER_SPEED * rnd(0.85, 1.2),
      skin: Math.floor(Math.random() * 5),
      shirt: Math.floor(Math.random() * 8),
      scale: rnd(0.92, 1.08),
      wants,
      wantIndex: 0,
      basket: [],
      state: S.ENTER,
      timer: 0,
      path: [],
      shelfId: null,
      checkoutId: null,
      patience: C.QUEUE_PATIENCE * rnd(0.8, 1.3),
      upset: 0,
      mood: 1,
    };
    this.customers.set(id, c);
    c.path = findPath(c.x, c.z, L.ENTRANCE_INSIDE.x, L.ENTRANCE_INSIDE.z);
  }

  updateCustomers(dt) {
    for (const c of [...this.customers.values()]) {
      this.stepCustomer(c, dt);
    }
    this.separateCustomers();
  }

  stepCustomer(c, dt) {
    // после закрытия магазина терпение тает быстрее, иначе день не закончится
    const impatience = this.state.open ? 1 : 3;
    switch (c.state) {
      case S.ENTER:
        if (this.moveAlong(c, dt)) this.chooseNextGoal(c);
        break;

      case S.SHELF:
        if (this.moveAlong(c, dt)) {
          c.state = S.BROWSE;
          c.timer = C.SHELF_LOOK_TIME * rnd(0.8, 1.4);
          const shelf = this.shelves.get(c.shelfId);
          if (shelf) c.yaw = Math.atan2(shelf.def.x - c.x, shelf.def.z - c.z);
        }
        break;

      case S.BROWSE:
        c.timer -= dt;
        if (c.timer <= 0) {
          this.takeFromShelf(c);
          c.wantIndex += 1;
          this.chooseNextGoal(c);
        }
        break;

      case S.TO_QUEUE: {
        const done = this.moveAlong(c, dt);
        c.patience -= dt * impatience;
        if (c.patience <= 0) { this.leaveAngry(c); break; }
        if (!c.checkoutId) {
          // все кассы заняты — походим кругами и попробуем снова
          c.timer -= dt;
          if (done && c.timer <= 0) { c.timer = 1.5; this.goToQueue(c); }
          break;
        }
        const co = this.checkouts.get(c.checkoutId);
        if (!co || co.queue.indexOf(c.id) === -1) { this.goToQueue(c); break; }
        if (done) c.state = S.QUEUE;
        break;
      }

      case S.QUEUE: {
        const co = this.checkouts.get(c.checkoutId);
        if (!co) { this.goToQueue(c); break; }
        const idx = co.queue.indexOf(c.id);
        if (idx === -1) { this.goToQueue(c); break; }
        const slot = L.queueSlot(co.def, idx);
        this.stepToward(c, slot.x, slot.z, dt);
        c.patience -= dt * impatience;
        if (c.patience <= 0) { this.leaveAngry(c); break; }
        if (idx === 0 && co.state === 'idle' && dist(c.x, c.z, slot.x, slot.z) < 0.45) {
          c.state = S.UNLOAD;
          c.timer = 0.9;
          c.yaw = Math.atan2(co.def.x - c.x, co.def.z - c.z);
          co.busy = c.id;
          co.state = 'unloading';
          this.storeDirty = true;
        }
        break;
      }

      case S.UNLOAD: {
        c.timer -= dt;
        if (c.timer <= 0) {
          const co = this.checkouts.get(c.checkoutId);
          if (!co) { this.goToQueue(c); break; }
          co.items = c.basket.map((b) => ({
            productId: b.productId, qty: b.qty, price: b.price, scanned: false,
          }));
          co.total = round2(co.items.reduce((s, i) => s + i.price * i.qty, 0));
          co.state = 'scanning';
          co.timer = 0;
          c.state = S.WAIT;
          this.storeDirty = true;
        }
        break;
      }

      case S.WAIT: {
        const co = this.checkouts.get(c.checkoutId);
        if (!co) { this.finishCustomer(c, 3); break; }
        c.patience -= dt * 0.5 * impatience;
        if (co.state === 'done' && co.busy === c.id) {
          const satisfaction = this.satisfactionOf(c);
          co.queue = co.queue.filter((q) => q !== c.id);
          this.finishCustomer(c, satisfaction);
        } else if (c.patience <= 0) {
          this.leaveAngry(c);
        }
        break;
      }

      case S.LEAVE:
        c.timer -= dt;
        // страховка от «залипания» в дверях: уходящий покупатель живёт ограниченно
        if (this.moveAlong(c, dt) || c.z < L.STORE.minZ - 1.2 || c.timer <= 0) {
          this.customers.delete(c.id);
        }
        break;

      default:
        break;
    }
  }

  satisfactionOf(c) {
    const wanted = c.wants.reduce((s, w) => s + w.qty, 0);
    const got = c.basket.reduce((s, b) => s + b.qty, 0);
    let v = 2 + 3 * (wanted ? Math.min(1, got / wanted) : 1);
    v -= c.upset * 0.5;
    return clampNum(v, 0, 5);
  }

  finishCustomer(c, satisfaction) {
    this.pushRating(satisfaction);
    c.state = S.LEAVE;
    c.timer = 40;
    c.mood = satisfaction >= 3.5 ? 1 : satisfaction >= 2 ? 0 : -1;
    c.path = findPath(c.x, c.z, ...exitPoint());
  }

  leaveAngry(c) {
    const co = c.checkoutId ? this.checkouts.get(c.checkoutId) : null;
    if (co) {
      co.queue = co.queue.filter((q) => q !== c.id);
      if (co.busy === c.id) {
        co.busy = null;
        co.state = 'idle';
        co.items = [];
        co.total = 0;
      }
    }
    // товар возвращается на полки (иначе он пропадает из экономики)
    for (const b of c.basket) {
      const shelf = [...this.shelves.values()].find((s) => s.productId === b.productId);
      if (shelf) shelf.count = Math.min(C.SHELF_CAPACITY, shelf.count + b.qty);
    }
    c.basket = [];
    this.state.stats.lost += 1;
    this.pushRating(0.4);
    this.broadcast({ t: 'fx', kind: 'angry', x: c.x, z: c.z });
    c.mood = -1;
    c.state = S.LEAVE;
    c.timer = 40;
    c.path = findPath(c.x, c.z, ...exitPoint());
    this.storeDirty = true;
  }

  pushRating(v) {
    this.ratings.push(v);
    if (this.ratings.length > C.RATING_MEMORY) this.ratings.shift();
    const avg = this.ratings.reduce((s, x) => s + x, 0) / this.ratings.length;
    this.state.rating = Math.round(clampNum(avg, 0.5, 5) * 100) / 100;
    this.storeDirty = true;
  }

  takeFromShelf(c) {
    const want = c.wants[c.wantIndex];
    if (!want) return;
    const shelf = this.shelves.get(c.shelfId);
    if (!shelf || shelf.productId !== want.productId || shelf.count <= 0) {
      c.upset += 1;
      return;
    }
    const price = this.state.prices[want.productId] ?? PRODUCT_BY_ID[want.productId].market;
    const appeal = priceAppeal(price, PRODUCT_BY_ID[want.productId].market);
    if (Math.random() > appeal) {
      c.upset += 1;
      this.broadcast({ t: 'fx', kind: 'expensive', x: c.x, z: c.z });
      return;
    }
    const qty = Math.min(want.qty, shelf.count);
    shelf.count -= qty;
    const line = c.basket.find((b) => b.productId === want.productId);
    if (line) line.qty += qty;
    else c.basket.push({ productId: want.productId, qty, price });
    this.storeDirty = true;
  }

  chooseNextGoal(c) {
    // ищем следующий товар из списка, который реально есть на полках
    while (c.wantIndex < c.wants.length) {
      const want = c.wants[c.wantIndex];
      const shelf = [...this.shelves.values()]
        .filter((s) => s.unlocked && s.productId === want.productId && s.count > 0)
        .sort((a, b) => dist(c.x, c.z, a.def.x, a.def.z) - dist(c.x, c.z, b.def.x, b.def.z))[0];
      if (!shelf) {
        c.upset += 1;
        c.wantIndex += 1;
        continue;
      }
      c.shelfId = shelf.id;
      c.state = S.SHELF;
      const fx = shelf.def.front.x + rnd(-0.7, 0.7);
      c.path = findPath(c.x, c.z, fx, shelf.def.front.z);
      return;
    }

    if (!c.basket.length) {
      this.finishCustomer(c, c.upset > 0 ? 1.2 : 2.5);
      return;
    }
    this.goToQueue(c);
  }

  goToQueue(c) {
    const open = [...this.checkouts.values()]
      .filter((co) => co.unlocked && co.queue.length < C.QUEUE_SLOTS)
      .sort((a, b) => a.queue.length - b.queue.length);
    if (!open.length) {
      // все очереди забиты — потолкаемся у касс
      c.state = S.TO_QUEUE;
      c.checkoutId = null;
      c.path = findPath(c.x, c.z, rnd(-11, -2), rnd(-7.5, -6.5));
      return;
    }
    const co = open[0];
    co.queue.push(c.id);
    c.checkoutId = co.id;
    c.state = S.TO_QUEUE;
    const slot = L.queueSlot(co.def, co.queue.length - 1);
    c.path = findPath(c.x, c.z, slot.x, slot.z);
    this.storeDirty = true;
  }

  moveAlong(c, dt) {
    let budget = c.speed * dt;
    while (budget > 0 && c.path.length) {
      const t = c.path[0];
      const d = dist(c.x, c.z, t.x, t.z);
      if (d <= budget) {
        c.x = t.x; c.z = t.z;
        budget -= d;
        c.path.shift();
      } else {
        const nx = (t.x - c.x) / d;
        const nz = (t.z - c.z) / d;
        c.x += nx * budget;
        c.z += nz * budget;
        c.yaw = Math.atan2(nx, nz);
        budget = 0;
      }
    }
    return c.path.length === 0;
  }

  stepToward(c, tx, tz, dt) {
    const d = dist(c.x, c.z, tx, tz);
    if (d < 0.06) return true;
    const step = Math.min(d, c.speed * dt);
    const nx = (tx - c.x) / d;
    const nz = (tz - c.z) / d;
    c.x += nx * step;
    c.z += nz * step;
    if (d > 0.3) c.yaw = Math.atan2(nx, nz);
    return false;
  }

  separateCustomers() {
    const list = [...this.customers.values()];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === S.LEAVE && a.z < L.STORE.minZ) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === S.LEAVE && b.z < L.STORE.minZ) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        const min = C.CUSTOMER_RADIUS * 2;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
      if (a.state !== S.LEAVE || a.z > L.STORE.minZ) {
        const r = resolveCircle(a.x, a.z, C.CUSTOMER_RADIUS, navBoxes);
        a.x = r.x; a.z = r.z;
      }
    }
  }

  // ------------------------------------------------------------ сериализация

  serializeStore() {
    const st = this.state;
    return {
      money: round2(st.money),
      xp: st.xp,
      level: st.level,
      nextXp: C.xpForNextLevel(st.xp),
      rating: st.rating,
      day: st.day,
      clock: Math.floor(st.clock),
      open: st.open,
      dayOver: st.dayOver,
      stats: {
        revenue: round2(st.stats.revenue),
        spent: round2(st.stats.spent),
        served: st.stats.served,
        lost: st.stats.lost,
      },
      prices: st.prices,
      deliveries: st.deliveries.map((d) => ({
        id: d.id,
        eta: Math.max(0, Math.ceil(d.eta)),
        boxes: d.lines.reduce((s, l) => s + l.boxes, 0),
      })),
      shelves: [...this.shelves.values()].map((s) => ({
        id: s.id, u: s.unlocked ? 1 : 0, p: s.productId, c: s.count,
      })),
      checkouts: [...this.checkouts.values()].map((c) => ({
        id: c.id, u: c.unlocked ? 1 : 0, e: c.employee ? 1 : 0,
        st: c.state, total: round2(c.total), q: c.queue.length,
        items: c.items.map((i) => ({ p: i.productId, q: i.qty, pr: i.price, s: i.scanned ? 1 : 0 })),
      })),
    };
  }

  // Сохранение прогресса магазина между перезапусками сервера
  serializeSave() {
    return {
      code: this.code,
      state: {
        money: this.state.money,
        xp: this.state.xp,
        level: this.state.level,
        rating: this.state.rating,
        day: this.state.day,
        prices: this.state.prices,
      },
      ratings: this.ratings,
      nextBoxId: this.nextBoxId,
      shelves: [...this.shelves.values()].map((s) => ({
        id: s.id, unlocked: s.unlocked, productId: s.productId, count: s.count,
      })),
      checkouts: [...this.checkouts.values()].map((c) => ({
        id: c.id, unlocked: c.unlocked, employee: c.employee,
      })),
      boxes: [...this.boxes.values()].map((b) => ({
        id: b.id, productId: b.productId, count: b.count, x: b.x, z: b.z,
      })),
    };
  }

  restoreSave(save) {
    if (!save) return;
    Object.assign(this.state, {
      money: save.state?.money ?? this.state.money,
      xp: save.state?.xp ?? 0,
      level: save.state?.level ?? 1,
      rating: save.state?.rating ?? C.RATING_START,
      day: save.state?.day ?? 1,
      clock: 0,
      open: false,
      dayOver: false,
    });
    if (save.state?.prices) {
      for (const [id, v] of Object.entries(save.state.prices)) {
        if (PRODUCT_BY_ID[id] && Number.isFinite(v)) this.state.prices[id] = v;
      }
    }
    if (Array.isArray(save.ratings) && save.ratings.length) this.ratings = save.ratings;
    for (const s of save.shelves || []) {
      const shelf = this.shelves.get(s.id);
      if (!shelf) continue;
      shelf.unlocked = !!s.unlocked || shelf.def.free;
      shelf.productId = PRODUCT_BY_ID[s.productId] ? s.productId : null;
      shelf.count = clampNum(Number(s.count) || 0, 0, C.SHELF_CAPACITY);
    }
    for (const c of save.checkouts || []) {
      const co = this.checkouts.get(c.id);
      if (!co) continue;
      co.unlocked = !!c.unlocked || co.def.free;
      co.employee = !!c.employee;
    }
    this.nextBoxId = Math.max(1, Number(save.nextBoxId) || 1);
    for (const b of save.boxes || []) {
      if (!PRODUCT_BY_ID[b.productId]) continue;
      this.boxes.set(b.id, {
        id: b.id, productId: b.productId,
        count: clampNum(Number(b.count) || 0, 0, 999),
        x: Number(b.x) || 0, z: Number(b.z) || 0,
      });
    }
    this.storeDirty = true;
  }

  serializeDynamic() {
    return {
      t: 'sync',
      players: [...this.players.values()].map((p) => ({
        i: p.id, n: p.name, c: p.color,
        x: r2(p.x), z: r2(p.z), y: r2(p.yaw),
        m: p.moving ? 1 : 0,
        h: p.held ? { p: p.held.productId, c: p.held.count } : null,
        r: p.restockShelf ? 1 : 0,
      })),
      customers: [...this.customers.values()].map((c) => ({
        i: c.id, x: r2(c.x), z: r2(c.z), y: r2(c.yaw),
        s: c.state, k: c.skin, sh: c.shirt, sc: r2(c.scale),
        b: c.basket.reduce((s, b) => s + b.qty, 0),
        m: c.mood,
      })),
      boxes: [...this.boxes.values()].map((b) => ({
        i: b.id, x: r2(b.x), z: r2(b.z), p: b.productId, c: b.count,
      })),
    };
  }
}

// Точка выхода слегка разная у каждого — иначе толпа толкается в дверях.
function exitPoint() {
  return [L.ENTRANCE_OUTSIDE.x + rnd(-1.6, 1.6), L.ENTRANCE_OUTSIDE.z + rnd(-1.5, 0.5)];
}

function r2(v) { return Math.round(v * 100) / 100; }
function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }

function sanitizeName(name) {
  return String(name || '').replace(/[<>]/g, '').trim().slice(0, 18);
}
