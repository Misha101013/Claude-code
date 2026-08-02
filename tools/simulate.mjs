// Прогон игрового цикла на сервере без клиента: заказ -> фура -> выкладка ->
// открытие -> покупатели -> касса -> закрытие дня.
import { Room } from '../server/room.js';
import * as L from '../shared/layout.js';
import { PRODUCT_BY_ID } from '../shared/products.js';

const room = new Room('SIM');
const fakeWs = { readyState: 1, send: () => {} };
const p = room.addPlayer(fakeWs, 'Tester');
const log = [];
room.broadcast = (msg) => { if (msg.t === 'sys' || msg.t === 'summary') log.push(JSON.stringify(msg).slice(0, 160)); };

const move = (x, z) => { p.x = x; p.z = z; };
const tick = (seconds, step = 1 / 20) => {
  for (let i = 0; i < seconds / step; i++) room.tick(step);
};

// 1. заказ товара
move(L.DESK_SPOT.x, L.DESK_SPOT.z);
room.action(p, {
  a: 'order',
  lines: [
    { productId: 'banana', boxes: 3 },
    { productId: 'milk', boxes: 4 },
    { productId: 'bread', boxes: 4 },
    { productId: 'water', boxes: 3 },
    { productId: 'chips', boxes: 3 },
  ],
});
console.log('после заказа money =', room.state.money.toFixed(2), '| доставок:', room.state.deliveries.length);

// 2. ждём фуру
tick(45);
console.log('коробок на складе:', room.boxes.size);
if (!room.boxes.size) throw new Error('коробки не приехали');

// 3. переносим коробки на стеллажи
const freeShelves = [...room.shelves.values()].filter((s) => s.unlocked);
let shelfIdx = 0;
for (const box of [...room.boxes.values()]) {
  const shelf = freeShelves.find((s) => !s.productId || s.productId === box.productId)
    || freeShelves[shelfIdx % freeShelves.length];
  move(box.x, box.z);
  room.action(p, { a: 'takeBox', id: box.id });
  if (!p.held) throw new Error('не взял коробку ' + box.id);
  move(shelf.def.x, shelf.def.z - 1.2);
  room.action(p, { a: 'restock', shelfId: shelf.id, on: true });
  tick(8);
  room.action(p, { a: 'restock', on: false });
  if (p.held && p.held.count === 0) {
    move(L.TRASH.x, L.TRASH.z - 1);
    room.action(p, { a: 'trashBox' });
  }
  if (p.held) { room.action(p, { a: 'dropBox' }); }
  shelfIdx++;
}
console.log('полки:', [...room.shelves.values()].filter((s) => s.count > 0)
  .map((s) => `${PRODUCT_BY_ID[s.productId].name}:${s.count}`).join(', '));

// 4. открываем магазин
move(L.SWITCH.x, L.SWITCH.z + 1);
room.action(p, { a: 'toggleOpen' });
console.log('магазин открыт:', room.state.open);

// 5. торгуем: игрок стоит за кассой и жмёт E, когда нужно
const co = room.checkouts.get('c0');
move(co.def.staff.x, co.def.staff.z);
let served = 0;
for (let i = 0; i < 20 * 240; i++) {
  room.tick(1 / 20);
  if (co.state === 'scanning' && i % 3 === 0) room.action(p, { a: 'scan', checkoutId: 'c0' });
  if (co.state === 'payment') { room.action(p, { a: 'pay', checkoutId: 'c0' }); served++; }
}
console.log('обслужено:', room.state.stats.served, '| выручка:', room.state.stats.revenue.toFixed(2));
console.log('ушли злыми:', room.state.stats.lost, '| рейтинг:', room.state.rating);
console.log('покупателей в зале:', room.customers.size, '| деньги:', room.state.money.toFixed(2));
console.log('XP:', room.state.xp, 'уровень:', room.state.level);

// 6. закрываем магазин и день
move(L.SWITCH.x, L.SWITCH.z + 1);
room.action(p, { a: 'toggleOpen' });
console.log('магазин открыт после рубильника:', room.state.open);
tick(180);
console.log('день окончен:', room.state.dayOver);
room.action(p, { a: 'nextDay' });
console.log('новый день:', room.state.day, '| деньги:', room.state.money.toFixed(2));

// 7. состояния покупателей не должны застревать
const states = {};
for (const c of room.customers.values()) states[c.state] = (states[c.state] || 0) + 1;
console.log('состояния покупателей:', JSON.stringify(states));

console.log('\n--- события ---');
console.log(log.slice(0, 14).join('\n'));
