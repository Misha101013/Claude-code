// Весь DOM-интерфейс: HUD, ноутбук управления, чат, карта, модалки.

import * as L from '/shared/layout.js';
import { PRODUCTS, PRODUCT_BY_ID, CATEGORIES, priceAppeal } from '/shared/products.js';
import {
  money, formatClock, SHELF_CAPACITY, CASHIER_WAGE, RENT_BASE, RENT_PER_SHELF,
  DELIVERY_FEE, LEVEL_XP,
} from '/shared/config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(send) {
    this.send = send;
    this.store = null;
    this.cart = new Map();
    this.laptopOpen = false;
    this.tab = 'order';
    this.mapVisible = true;
    this.players = [];
    this.self = null;
    this.onCloseLaptop = null;

    this.el = {
      money: $('hudMoney'), day: $('hudDay'), clock: $('hudClock'), open: $('hudOpen'),
      rating: $('hudRating'), stars: $('hudStars'), level: $('hudLevel'), xp: $('hudXp'),
      delivery: $('hudDelivery'), deliveryText: $('hudDeliveryText'),
      task: $('hudTask'), taskText: $('hudTaskText'),
      prompt: $('prompt'), held: $('held'), restock: $('restockBar'),
      chatLog: $('chatLog'), chatInput: $('chatInput'), toasts: $('toasts'),
      playerList: $('playerList'), minimap: $('minimap'),
      laptop: $('laptop'), pause: $('pause'), summary: $('summary'),
      cartInfo: $('cartInfo'), orderBtn: $('orderBtn'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');

    this.bindLaptop();
  }

  bindLaptop() {
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-panel').forEach((p) => {
          p.classList.toggle('hidden', p.id !== `tab-${this.tab}`);
        });
        this.renderLaptop();
      });
    });
    $('laptopClose').addEventListener('click', () => this.closeLaptop());
    $('orderBtn').addEventListener('click', () => this.submitOrder());
    $('summaryClose').addEventListener('click', () => this.el.summary.classList.add('hidden'));
  }

  // ------------------------------------------------------------- состояние

  setStore(store) {
    this.store = store;
    this.updateHud();
    if (this.laptopOpen) this.renderLaptop();
  }

  setPlayers(list, selfId) {
    this.players = list;
    this.selfId = selfId;
    const html = list.map((p) => `
      <div class="p-row">
        <span class="dot" style="background:${p.c}"></span>
        <span>${escapeHtml(p.n)}${p.i === selfId ? ' <span class="muted">(ты)</span>' : ''}</span>
        ${p.h ? `<span class="muted">📦</span>` : ''}
      </div>`).join('');
    this.el.playerList.innerHTML = `<div class="muted small">В смене: ${list.length}</div>${html}`;
  }

  updateHud() {
    const s = this.store;
    if (!s) return;
    this.el.money.textContent = money(s.money);
    this.el.day.textContent = s.day;
    this.el.clock.textContent = formatClock(s.clock);
    this.el.open.textContent = s.open ? 'ОТКРЫТ' : (s.dayOver ? 'ДЕНЬ ЗАКРЫТ' : 'ЗАКРЫТ');
    this.el.open.className = `badge ${s.open ? 'open' : 'closed'}`;
    this.el.rating.textContent = s.rating.toFixed(1);
    this.el.stars.textContent = stars(s.rating);
    this.el.level.textContent = s.level;
    const prev = LEVEL_XP[s.level - 1] ?? 0;
    const next = s.nextXp ?? (prev + 1);
    this.el.xp.style.width = `${Math.max(2, Math.min(100, ((s.xp - prev) / (next - prev)) * 100))}%`;

    if (s.deliveries.length) {
      this.el.delivery.classList.remove('hidden');
      const d = s.deliveries[0];
      this.el.deliveryText.textContent = `Фура: ${d.boxes} кор. через ${d.eta}с`
        + (s.deliveries.length > 1 ? ` (+${s.deliveries.length - 1})` : '');
    } else {
      this.el.delivery.classList.add('hidden');
    }
  }

  // Подсказка «что делать дальше» — маленький встроенный туториал.
  setTask(ctx) {
    const s = this.store;
    if (!s) return;
    let text = null;
    const stocked = s.shelves.some((x) => x.u && x.c > 0);
    if (s.dayOver) text = 'День окончен — закрой его на ноутбуке (склад)';
    else if (ctx.held && ctx.held.c > 0) text = 'Подойди к стеллажу и удерживай E, чтобы выложить товар';
    else if (ctx.held) text = 'Коробка пуста — сдай её в бак на складе (E)';
    else if (ctx.boxes > 0 && !s.open) text = 'Возьми коробку на складе (E) и выложи товар на стеллаж';
    else if (!stocked && !s.deliveries.length && ctx.boxes === 0) text = 'Закажи товар на ноутбуке на складе (Tab)';
    else if (s.deliveries.length && !stocked) text = 'Жди фуру — она разгрузится в жёлтой зоне склада';
    else if (!s.open) text = 'Включи рубильник у входа, чтобы открыть магазин';
    else if (ctx.queue > 0) text = 'Встань за кассу и пробивай товар (E)';
    else text = 'Магазин работает — следи за полками и кассой';
    this.el.taskText.textContent = text;
  }

  setHeld(held) {
    if (!held) { this.el.held.classList.add('hidden'); return; }
    const p = PRODUCT_BY_ID[held.p];
    this.el.held.classList.remove('hidden');
    this.el.held.innerHTML = `<span class="emoji">${p.emoji}</span>
      <span>${escapeHtml(p.name)}<br><b>${held.c}</b> <span class="muted">шт в коробке</span></span>`;
  }

  setRestock(fraction) {
    if (fraction == null) { this.el.restock.classList.add('hidden'); return; }
    this.el.restock.classList.remove('hidden');
    this.el.restock.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
  }

  setPrompt(html) {
    if (!html) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    this.el.prompt.innerHTML = html;
  }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  chatLine(text, opts = {}) {
    const el = document.createElement('div');
    el.className = `line ${opts.sys ? 'sys' : ''}`;
    el.innerHTML = opts.sys
      ? escapeHtml(text)
      : `<b style="color:${opts.color || '#fff'}">${escapeHtml(opts.from)}:</b> ${escapeHtml(text)}`;
    this.el.chatLog.appendChild(el);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.firstChild.remove();
    setTimeout(() => el.remove(), 12000);
  }

  showSummary(s) {
    $('summaryTitle').textContent = `Итоги дня ${s.day}`;
    $('summaryBody').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="k">Выручка</div><div class="v tagline-good">${money(s.revenue)}</div></div>
        <div class="stat"><div class="k">Закупки</div><div class="v">${money(s.spent)}</div></div>
        <div class="stat"><div class="k">Аренда</div><div class="v">${money(s.rent)}</div></div>
        <div class="stat"><div class="k">Зарплаты</div><div class="v">${money(s.wages)}</div></div>
        <div class="stat"><div class="k">Обслужено</div><div class="v">${s.served}</div></div>
        <div class="stat"><div class="k">Ушли без покупки</div><div class="v tagline-bad">${s.lost}</div></div>
      </div>
      <p style="margin:14px 0 0;font-size:18px">Прибыль за день:
        <b class="${s.profit >= 0 ? 'tagline-good' : 'tagline-bad'}">${money(s.profit)}</b></p>
      <p class="muted small">Баланс: ${money(s.money)}</p>`;
    this.el.summary.classList.remove('hidden');
  }

  // --------------------------------------------------------------- ноутбук

  openLaptop() {
    this.laptopOpen = true;
    this.el.laptop.classList.remove('hidden');
    this.renderLaptop();
  }

  closeLaptop() {
    this.laptopOpen = false;
    this.el.laptop.classList.add('hidden');
    // снимаем фокус с кнопок ноутбука, иначе клавиши уходят в них
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    this.onCloseLaptop?.();
  }

  get modalOpen() {
    return this.laptopOpen
      || !this.el.pause.classList.contains('hidden')
      || !this.el.summary.classList.contains('hidden');
  }

  renderLaptop() {
    if (!this.store) return;
    if (this.tab === 'order') this.renderOrder();
    if (this.tab === 'price') this.renderPrices();
    if (this.tab === 'shop') this.renderShop();
    if (this.tab === 'staff') this.renderStaff();
    if (this.tab === 'stats') this.renderStats();
    this.updateCartInfo();
  }

  renderOrder() {
    const s = this.store;
    const host = $('tab-order');
    let html = `<div class="muted small">Баланс: <b class="tagline-good">${money(s.money)}</b> ·
      доставка ${money(DELIVERY_FEE)} за заказ · фура едет ~40 сек.</div>`;
    for (const cat of CATEGORIES) {
      const items = PRODUCTS.filter((p) => p.cat === cat.id);
      if (!items.length) continue;
      html += `<div class="cat-title" style="color:${cat.color}">${cat.name}</div><div class="grid">`;
      for (const p of items) {
        const locked = p.level > s.level;
        const n = this.cart.get(p.id) || 0;
        html += `<div class="row order" ${locked ? 'style="opacity:.4"' : ''}>
          <div style="font-size:19px">${p.emoji}</div>
          <div>
            <div class="name">${p.name}</div>
            <div class="sub">${locked ? `откроется на ур. ${p.level}` : `${p.perBox} шт · ${money(p.cost)}/шт`}</div>
          </div>
          <div class="num box-cost">${money(p.boxCost)}<div class="sub">коробка</div></div>
          <div class="num">${money(s.prices[p.id] ?? p.market)}<div class="sub">цена</div></div>
          <div class="qty">
            <button data-dec="${p.id}" ${locked || !n ? 'disabled' : ''}>−</button>
            <span>${n}</span>
            <button data-inc="${p.id}" ${locked ? 'disabled' : ''}>+</button>
          </div>
        </div>`;
      }
      html += '</div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.inc;
      this.cart.set(id, Math.min(30, (this.cart.get(id) || 0) + 1));
      this.renderOrder();
    }));
    host.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.dec;
      const n = (this.cart.get(id) || 0) - 1;
      if (n <= 0) this.cart.delete(id); else this.cart.set(id, n);
      this.renderOrder();
    }));
  }

  updateCartInfo() {
    let total = 0;
    let boxes = 0;
    for (const [id, n] of this.cart) {
      total += PRODUCT_BY_ID[id].boxCost * n;
      boxes += n;
    }
    if (boxes) total += DELIVERY_FEE;
    this.el.cartInfo.innerHTML = boxes
      ? `Корзина: <b>${boxes}</b> кор. на <b class="tagline-good">${money(total)}</b>`
      : 'Корзина пуста';
    this.el.orderBtn.disabled = !boxes || (this.store && this.store.money < total);
  }

  submitOrder() {
    const lines = [...this.cart.entries()].map(([productId, b]) => ({ productId, boxes: b }));
    if (!lines.length) return;
    this.send({ t: 'act', a: 'order', lines });
    this.cart.clear();
    this.renderLaptop();
  }

  renderPrices() {
    const s = this.store;
    const host = $('tab-price');
    if (host.querySelector('input:focus')) return;
    let html = `<div class="muted small">Чем выше цена относительно рыночной — тем чаще покупатели
      уходят без товара и роняют рейтинг. Ниже рынка — берут охотнее.</div>`;
    for (const cat of CATEGORIES) {
      const items = PRODUCTS.filter((p) => p.cat === cat.id && p.level <= s.level);
      if (!items.length) continue;
      html += `<div class="cat-title" style="color:${cat.color}">${cat.name}</div><div class="grid">`;
      for (const p of items) {
        const price = s.prices[p.id] ?? p.market;
        const appeal = priceAppeal(price, p.market);
        const margin = ((price - p.cost) / price) * 100;
        const cls = appeal > 0.75 ? 'tagline-good' : appeal > 0.35 ? 'tagline-mid' : 'tagline-bad';
        html += `<div class="row price">
          <div style="font-size:19px">${p.emoji}</div>
          <div><div class="name">${p.name}</div>
            <div class="sub">закупка ${money(p.cost)} · маржа ${margin.toFixed(0)}%</div></div>
          <div class="num market">${money(p.market)}<div class="sub">рынок</div></div>
          <div><input type="number" step="0.05" min="0.01" data-price="${p.id}" value="${price.toFixed(2)}" /></div>
          <div class="num appeal ${cls}">${Math.round(appeal * 100)}%<div class="sub">спрос</div></div>
          <div><button data-market="${p.id}">=рынок</button></div>
        </div>`;
      }
      html += '</div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-price]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) this.send({ t: 'act', a: 'setPrice', productId: inp.dataset.price, price: v });
      });
    });
    host.querySelectorAll('[data-market]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = PRODUCT_BY_ID[b.dataset.market];
        this.send({ t: 'act', a: 'setPrice', productId: p.id, price: p.market });
      });
    });
  }

  renderShop() {
    const s = this.store;
    const host = $('tab-shop');
    const shelves = s.shelves;
    const lockedShelves = shelves.filter((x) => !x.u);
    const lockedCo = s.checkouts.filter((c) => !c.u);
    let html = `<div class="muted small">Стеллажей работает: ${shelves.length - lockedShelves.length} из ${shelves.length}
      · Касс: ${s.checkouts.length - lockedCo.length} из ${s.checkouts.length}</div><div class="cards" style="margin-top:10px">`;

    for (const sh of lockedShelves.slice(0, 6)) {
      const def = L.SHELVES.find((d) => d.id === sh.id);
      html += `<div class="card">
        <div><b>Стеллаж ${def.row + 1}-${def.col + 1}</b>
          <div class="sub muted">${SHELF_CAPACITY} товаров · +${money(RENT_PER_SHELF)} к аренде</div></div>
        <button data-buyshelf="${sh.id}" ${s.money < def.cost ? 'disabled' : ''}>Купить ${money(def.cost)}</button>
      </div>`;
    }
    for (const co of lockedCo) {
      const def = L.CHECKOUTS.find((d) => d.id === co.id);
      html += `<div class="card">
        <div><b>Касса</b><div class="sub muted">ещё одна очередь — меньше злых покупателей</div></div>
        <button data-buyco="${co.id}" ${s.money < def.cost ? 'disabled' : ''}>Купить ${money(def.cost)}</button>
      </div>`;
    }
    if (!lockedShelves.length && !lockedCo.length) {
      html += '<div class="card">Всё куплено. Ты король ритейла 👑</div>';
    }
    html += `</div><div class="cat-title">Расходы за день</div>
      <div class="card">Аренда ${money(RENT_BASE)} + ${money(RENT_PER_SHELF)} за каждый купленный стеллаж
      + ${money(CASHIER_WAGE)} за каждого кассира</div>`;
    host.innerHTML = html;

    host.querySelectorAll('[data-buyshelf]').forEach((b) => b.addEventListener('click', () => {
      this.send({ t: 'act', a: 'buyShelf', shelfId: b.dataset.buyshelf });
    }));
    host.querySelectorAll('[data-buyco]').forEach((b) => b.addEventListener('click', () => {
      this.send({ t: 'act', a: 'buyCheckout', checkoutId: b.dataset.buyco });
    }));
  }

  renderStaff() {
    const s = this.store;
    const host = $('tab-staff');
    let html = `<div class="muted small">Кассир сам пробивает товар и принимает оплату,
      но берёт ${money(CASHIER_WAGE)} за день. Пока он на кассе — вы выкладываете товар.</div>
      <div class="cards" style="margin-top:10px">`;
    for (const co of s.checkouts) {
      html += `<div class="card">
        <div><b>Касса ${co.id.slice(1) * 1 + 1}</b>
          <div class="sub muted">${co.u ? (co.e ? '🧑‍💼 работает кассир' : 'на кассе стоит игрок') : 'не куплена'}</div></div>
        ${co.u ? `<button data-hire="${co.id}" data-on="${co.e ? 0 : 1}">${co.e ? 'Уволить' : `Нанять ${money(CASHIER_WAGE)}/день`}</button>` : ''}
      </div>`;
    }
    html += '</div>';
    host.innerHTML = html;
    host.querySelectorAll('[data-hire]').forEach((b) => b.addEventListener('click', () => {
      this.send({ t: 'act', a: 'hire', checkoutId: b.dataset.hire, on: b.dataset.on === '1' });
    }));
  }

  renderStats() {
    const s = this.store;
    const host = $('tab-stats');
    const stocked = s.shelves.filter((x) => x.u && x.c > 0).length;
    const empty = s.shelves.filter((x) => x.u && x.c === 0).length;
    host.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="k">Выручка за день</div><div class="v tagline-good">${money(s.stats.revenue)}</div></div>
        <div class="stat"><div class="k">Потрачено</div><div class="v">${money(s.stats.spent)}</div></div>
        <div class="stat"><div class="k">Покупателей обслужено</div><div class="v">${s.stats.served}</div></div>
        <div class="stat"><div class="k">Ушли недовольными</div><div class="v tagline-bad">${s.stats.lost}</div></div>
        <div class="stat"><div class="k">Рейтинг</div><div class="v">${s.rating.toFixed(2)} ${stars(s.rating)}</div></div>
        <div class="stat"><div class="k">Уровень</div><div class="v">${s.level} <span class="muted small">${s.xp} XP</span></div></div>
        <div class="stat"><div class="k">Полки с товаром</div><div class="v">${stocked}</div></div>
        <div class="stat"><div class="k">Пустые полки</div><div class="v ${empty ? 'tagline-mid' : ''}">${empty}</div></div>
      </div>
      <div class="cards" style="margin-top:12px">
        <div class="card">
          <div><b>${s.open ? 'Магазин открыт' : 'Магазин закрыт'}</b>
            <div class="sub muted">${formatClock(s.clock)} · день ${s.day}</div></div>
          <button id="btnToggleOpen">${s.open ? 'Закрыть магазин' : 'Открыть магазин'}</button>
        </div>
        ${s.dayOver ? `<div class="card">
          <div><b>День окончен</b><div class="sub muted">спишем аренду и зарплаты, начнём новый день</div></div>
          <button id="btnNextDay" class="primary">Начать день ${s.day + 1}</button></div>` : ''}
      </div>`;
    host.querySelector('#btnToggleOpen')?.addEventListener('click', () => {
      this.send({ t: 'act', a: 'toggleOpen' });
    });
    host.querySelector('#btnNextDay')?.addEventListener('click', () => {
      this.send({ t: 'act', a: 'nextDay' });
    });
  }

  // ----------------------------------------------------------------- карта

  drawMinimap(self, entities) {
    if (!this.mapVisible || !this.store) return;
    const g = this.mapCtx;
    const W = this.el.minimap.width;
    const H = this.el.minimap.height;
    const minX = L.STORE.minX - 1;
    const maxX = L.STORE.maxX + 1;
    const minZ = L.STORE.minZ - 3;
    const maxZ = L.STORE.maxZ + 1;
    const sx = W / (maxX - minX);
    const sz = H / (maxZ - minZ);
    const px = (x) => (maxX - x) * sx;
    const pz = (z) => (z - minZ) * sz;

    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,28,38,.9)';
    g.fillRect(0, 0, W, H);

    // зал / склад
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.fillRect(px(L.STORE.minX), pz(L.STORE.minZ), (L.STORE.maxX - L.STORE.minX) * sx, (L.DIVIDER_Z - L.STORE.minZ) * sz);
    g.fillStyle = 'rgba(255,255,255,.03)';
    g.fillRect(px(L.STORE.minX), pz(L.DIVIDER_Z), (L.STORE.maxX - L.STORE.minX) * sx, (L.STORE.maxZ - L.DIVIDER_Z) * sz);
    g.strokeStyle = 'rgba(255,255,255,.25)';
    g.lineWidth = 1;
    g.strokeRect(px(L.STORE.minX), pz(L.STORE.minZ), (L.STORE.maxX - L.STORE.minX) * sx, (L.STORE.maxZ - L.STORE.minZ) * sz);

    // стеллажи
    for (const sh of this.store.shelves) {
      const def = L.SHELVES.find((d) => d.id === sh.id);
      const w = def.w * sx;
      const h = def.d * sz;
      if (!sh.u) g.fillStyle = 'rgba(255,255,255,.07)';
      else if (!sh.c) g.fillStyle = '#7f1d1d';
      else g.fillStyle = sh.c < SHELF_CAPACITY * 0.25 ? '#b45309' : '#15803d';
      g.fillRect(px(def.x) - w / 2, pz(def.z) - h / 2, w, h);
    }
    // кассы
    for (const co of this.store.checkouts) {
      const def = L.CHECKOUTS.find((d) => d.id === co.id);
      g.fillStyle = co.u ? '#38bdf8' : 'rgba(255,255,255,.08)';
      g.fillRect(px(def.x) - (def.w * sx) / 2, pz(def.z) - (def.d * sz) / 2, def.w * sx, def.d * sz);
    }
    // ноутбук и мусорка
    g.fillStyle = '#5eead4';
    g.fillRect(px(L.DESK.x) - 4, pz(L.DESK.z) - 3, 8, 6);

    // коробки
    g.fillStyle = '#c89b6a';
    for (const b of entities.boxes.values()) {
      g.fillRect(px(b.mesh.position.x) - 1.5, pz(b.mesh.position.z) - 1.5, 3, 3);
    }
    // покупатели
    for (const c of entities.customers.values()) {
      g.fillStyle = c.bubbleText === '😡' ? '#f87171' : '#fbbf24';
      g.beginPath();
      g.arc(px(c.interp.x), pz(c.interp.z), 2.4, 0, Math.PI * 2);
      g.fill();
    }
    // другие игроки
    for (const [id, p] of entities.players) {
      const info = this.players.find((x) => x.i === id);
      g.fillStyle = info ? info.c : '#fff';
      g.beginPath();
      g.arc(px(p.interp.x), pz(p.interp.z), 3.4, 0, Math.PI * 2);
      g.fill();
    }
    // сам игрок + конус зрения
    g.save();
    g.translate(px(self.x), pz(self.z));
    g.rotate(self.yaw);
    g.fillStyle = 'rgba(74,222,128,.25)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 22, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = '#4ade80';
    g.beginPath();
    g.arc(0, 0, 3.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  toggleMap() {
    this.mapVisible = !this.mapVisible;
    this.el.minimap.classList.toggle('hidden', !this.mapVisible);
  }
}

function stars(r) {
  const full = Math.round(r);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
