// Геометрия магазина. Один источник правды для сервера (коллизии, навигация)
// и клиента (построение 3D-сцены).

export const WALL_H = 3.4;
export const WALL_T = 0.4;

// Внешние границы здания
export const STORE = { minX: -14, maxX: 14, minZ: -12, maxZ: 18 };
// Перегородка между торговым залом и складом
export const DIVIDER_Z = 8;
// Проём в перегородке (дверь на склад)
export const STORAGE_DOOR = { minX: 10.4, maxX: 13.6 };
// Входная дверь в южной стене
export const ENTRANCE = { minX: 4, maxX: 9, z: STORE.minZ };
export const ENTRANCE_X = (ENTRANCE.minX + ENTRANCE.maxX) / 2;
export const ENTRANCE_INSIDE = { x: ENTRANCE_X, z: -10.4 };
export const ENTRANCE_OUTSIDE = { x: ENTRANCE_X, z: -14.5 };

export const SHELF_W = 3.4;
export const SHELF_D = 1.0;
export const SHELF_H = 1.9;

export const COUNTER_W = 2.6;
export const COUNTER_D = 0.9;
export const COUNTER_H = 1.0;

function rect(x, z, w, d, h = WALL_H, kind = 'wall') {
  return { x, z, w, d, h, kind };
}

// --- стены ---
const W = [];
{
  const { minX, maxX, minZ, maxZ } = STORE;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // северная и боковые
  W.push(rect(cx, maxZ, width + WALL_T, WALL_T));
  W.push(rect(minX, cz, WALL_T, depth + WALL_T));
  W.push(rect(maxX, cz, WALL_T, depth + WALL_T));
  // южная с проёмом под вход
  const leftW = ENTRANCE.minX - minX;
  W.push(rect(minX + leftW / 2, minZ, leftW, WALL_T));
  const rightW = maxX - ENTRANCE.maxX;
  W.push(rect(maxX - rightW / 2, minZ, rightW, WALL_T));
  // перегородка склада с проёмом
  const dLeft = STORAGE_DOOR.minX - minX;
  W.push(rect(minX + dLeft / 2, DIVIDER_Z, dLeft, WALL_T));
  const dRight = maxX - STORAGE_DOOR.maxX;
  W.push(rect(maxX - dRight / 2, DIVIDER_Z, dRight, WALL_T));
}
export const WALLS = W;

// --- стеллажи ---
export const SHELF_ROWS_Z = [-3.5, 1.0, 5.5];
export const SHELF_COLS_X = [-9, -5.4, -1.8, 1.8, 5.4, 9];

export const SHELVES = [];
SHELF_ROWS_Z.forEach((z, row) => {
  SHELF_COLS_X.forEach((x, col) => {
    const id = `s${row}${col}`;
    // первый ряд (4 стеллажа) доступен сразу, остальное покупается
    const free = row === 0 && col < 5;
    const cost = row === 0 ? 350 : row === 1 ? 700 : 1300;
    SHELVES.push({
      id, x, z, row, col,
      w: SHELF_W, d: SHELF_D, h: SHELF_H,
      free, cost,
      // точка, где стоит покупатель перед стеллажом (стеллажи «лицом» на юг)
      front: { x, z: z - SHELF_D / 2 - 0.65 },
    });
  });
});

// --- кассы ---
export const CHECKOUTS = [
  { id: 'c0', x: -9, z: -9, free: true, cost: 0 },
  { id: 'c1', x: -5, z: -9, free: false, cost: 950 },
  { id: 'c2', x: -1, z: -9, free: false, cost: 2400 },
].map((c) => ({
  ...c,
  w: COUNTER_W, d: COUNTER_D, h: COUNTER_H,
  // покупатель стоит с северной стороны, кассир (игрок) - с южной
  customer: { x: c.x, z: c.z + 0.95 },
  staff: { x: c.x, z: c.z - 1.15 },
}));

// Слоты очереди - тянутся на север от кассы
export function queueSlot(checkout, index) {
  return { x: checkout.x, z: checkout.z + 0.95 + index * 0.95 };
}

// --- прочие объекты ---
export const DESK = { x: 0, z: 16.6, w: 2.6, d: 1.0, h: 0.95 }; // стол с ноутбуком (склад)
export const DESK_SPOT = { x: 0, z: 15.2 };
export const TRASH = { x: -13, z: 16.6, w: 1.0, d: 1.0, h: 1.1 };
export const SWITCH = { x: 10.9, z: -11.6 }; // рубильник «открыто/закрыто» у входа

// Зона разгрузки: сюда падают коробки из фуры
export const DELIVERY = { minX: -12.6, maxX: -3.4, minZ: 9.6, maxZ: 14.6 };

export function deliverySpot(index) {
  const cols = 10;
  const rows = 6;
  const i = index % (cols * rows);
  const cx = i % cols;
  const cz = Math.floor(i / cols);
  const stepX = (DELIVERY.maxX - DELIVERY.minX) / (cols - 1);
  const stepZ = (DELIVERY.maxZ - DELIVERY.minZ) / (rows - 1);
  return { x: DELIVERY.minX + cx * stepX, z: DELIVERY.minZ + cz * stepZ };
}

// --- препятствия для коллизий ---
export function collisionBoxes() {
  const out = WALLS.map((w) => ({ ...w }));
  for (const s of SHELVES) out.push({ x: s.x, z: s.z, w: s.w, d: s.d, h: s.h, kind: 'shelf', id: s.id });
  for (const c of CHECKOUTS) out.push({ x: c.x, z: c.z, w: c.w, d: c.d, h: c.h, kind: 'counter', id: c.id });
  out.push({ ...DESK, kind: 'desk' });
  out.push({ ...TRASH, kind: 'trash' });
  return out;
}

// Точка спавна игроков (склад, у двери в зал)
export const SPAWN = { x: 12, z: 9.6, yaw: Math.PI };

export function inStore(x, z) {
  return x > STORE.minX + 0.5 && x < STORE.maxX - 0.5 && z > STORE.minZ + 0.5 && z < STORE.maxZ - 0.5;
}
