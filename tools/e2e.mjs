// Полный прогон клиентского цикла в headless-браузере.
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '/tmp';
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}\n${e.stack}`));

const BASE = process.env.BASE_URL || 'http://localhost:3000';
await page.goto(BASE + '/');
await page.fill('#nameInput', 'Alice');
await page.fill('#roomInput', 'F' + Date.now().toString().slice(-5));
await page.click('#playBtn');
await page.waitForTimeout(2500);

const put = (x, z, yaw = 0, pitch = 0) => page.evaluate(
  ([x, z, yaw, pitch]) => { game.player.x = x; game.player.z = z; game.player.yaw = yaw; game.player.pitch = pitch; },
  [x, z, yaw, pitch],
);
const lookAt = (tx, tz, ty = 1.2) => page.evaluate(([tx, tz, ty]) => {
  const dx = tx - game.player.x;
  const dz = tz - game.player.z;
  game.player.yaw = Math.atan2(dx, dz);
  game.player.pitch = Math.atan2(ty - 1.62, Math.hypot(dx, dz));
}, [tx, tz, ty]);
const shot = (n) => page.screenshot({ path: `${OUT}/f_${n}.png` });

// 1. К ноутбуку, открыть Tab
await put(0, 15.2, 0);
await page.waitForTimeout(600);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
console.log('ноутбук открыт:', await page.evaluate(() => game.ui.laptopOpen));
await shot('laptop_order');

// 2. Набрать корзину и заказать
await page.evaluate(() => {
  for (const id of ['banana', 'milk', 'bread', 'water', 'chips']) game.ui.cart.set(id, 3);
  game.ui.renderLaptop();
});
await page.waitForTimeout(300);
await shot('laptop_cart');
await page.click('#orderBtn');
await page.waitForTimeout(800);
console.log('после заказа деньги:', await page.evaluate(() => game.store.money));
console.log('доставок:', await page.evaluate(() => game.store.deliveries.length));

// вкладка цен
await page.click('[data-tab="price"]');
await page.waitForTimeout(400);
await shot('laptop_price');
await page.click('[data-tab="shop"]');
await page.waitForTimeout(300);
await shot('laptop_shop');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 3. Ждём фуру
await page.waitForTimeout(43000);
const boxes = await page.evaluate(() => game.entities.boxes.size);
console.log('коробок на складе:', boxes);
await put(-8, 8.6, 0, -0.2);
await page.waitForTimeout(600);
await shot('storage_boxes');

// 4. Взять коробку и выложить
const box = await page.evaluate(() => {
  const b = [...game.entities.boxes.values()][0];
  return { x: b.mesh.position.x, z: b.mesh.position.z, id: b.hit.userData.interact.id };
});
await put(box.x, box.z - 1.4);
await lookAt(box.x, box.z, 0.4);
await page.waitForTimeout(500);
console.log('цель:', await page.evaluate(() => JSON.stringify(game.target)));
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
console.log('в руках:', await page.evaluate(() => JSON.stringify(game.myHeld)));
await shot('holding_box');

// к стеллажу
const shelf = await page.evaluate(() => {
  const s = [...game.refs.shelves.values()].find((r) => game.shelfById.get(r.def.id).u);
  return { x: s.def.x, z: s.def.z, id: s.def.id };
});
await put(shelf.x, shelf.z - 1.8);
await lookAt(shelf.x, shelf.z);
await page.waitForTimeout(500);
await page.keyboard.down('KeyE');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyE');
await page.waitForTimeout(700);
console.log('на полке:', await page.evaluate(([id]) => {
  const s = game.shelfById.get(id);
  const ref = game.refs.shelves.get(id);
  return `${s.p} x${s.c} (инстансов: ${ref.items.count})`;
}, [shelf.id]));
await put(shelf.x, shelf.z - 4.2);
await lookAt(shelf.x, shelf.z, 1.0);
await page.waitForTimeout(700);
await shot('shelf_stocked');

// 5. Открыть магазин
await put(10.9, -10.4);
await lookAt(10.9, -11.6, 1.5);
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
console.log('магазин открыт:', await page.evaluate(() => game.store.open));

// 6. Ждём покупателей у кассы
await put(-9, -9.95, 0);
await page.waitForTimeout(30000);
console.log('покупателей:', await page.evaluate(() => game.entities.customers.size));
await lookAt(-9, -9, 1.0);
await page.waitForTimeout(600);
await shot('checkout');
console.log('касса:', await page.evaluate(() => JSON.stringify(game.checkoutById.get('c0'))).then((s) => s.slice(0, 200)));

// пробиваем чеки
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => ({
    t: game.target ? game.target.kind + ':' + game.target.id : null,
    co: game.checkoutById.get('c0').st,
    rev: game.store.stats.revenue,
    active: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : null,
    keys: [...game.player.keys],
  }));
  if (i < 6 || st.rev > 0) console.log('  loop', i, JSON.stringify(st));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
}
await shot('checkout2');
console.log('выручка:', await page.evaluate(() => game.store.stats.revenue));
console.log('обслужено:', await page.evaluate(() => game.store.stats.served));

console.log('ОШИБКИ:', errors.length ? errors.join('\n') : 'нет');
await browser.close();
