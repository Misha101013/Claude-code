// Общие константы игры (используются и сервером, и клиентом).

export const PROTOCOL_VERSION = 3;

// --- сеть ---
export const TICK_RATE = 20;          // тиков симуляции в секунду
export const SNAPSHOT_RATE = 12;      // снапшотов состояния в секунду
export const INPUT_RATE = 15;         // отправок ввода игрока в секунду

// --- игрок ---
export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.62;
export const WALK_SPEED = 3.9;
export const SPRINT_SPEED = 6.3;
export const INTERACT_RANGE = 2.6;

// --- покупатели ---
export const CUSTOMER_RADIUS = 0.34;
export const CUSTOMER_SPEED = 1.65;
export const CUSTOMER_MAX = 26;
export const QUEUE_SLOTS = 4;         // сколько человек помещается в одну очередь
export const QUEUE_PATIENCE = 95;     // секунд ожидания в очереди до ухода
export const SHELF_LOOK_TIME = 1.4;   // сколько секунд покупатель выбирает товар

// --- время ---
export const DAY_REAL_SECONDS = 480;  // реальных секунд на один игровой день (08:00 -> 22:00)
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 22;
export const CLOCK_SCALE = ((DAY_END_HOUR - DAY_START_HOUR) * 3600) / DAY_REAL_SECONDS;

// --- экономика ---
export const START_MONEY = 800;
export const RENT_BASE = 30;          // базовая аренда за день
export const RENT_PER_SHELF = 10;     // + за каждый купленный стеллаж
export const CASHIER_WAGE = 110;      // зарплата нанятого кассира за день
export const EMPTY_BOX_REFUND = 0.12; // возврат за сдачу пустой коробки
export const DELIVERY_DELAY = 40;     // секунд до приезда фуры
export const DELIVERY_FEE = 12;       // фиксированная плата за доставку
export const MAX_FLOOR_BOXES = 60;    // сколько коробок помещается на складе

// --- склад/выкладка ---
export const SHELF_CAPACITY = 48;     // товаров на один стеллаж
export const RESTOCK_INTERVAL = 0.11; // секунд на выкладку одной единицы товара
export const SCAN_INTERVAL = 0.28;    // секунд на сканирование одной позиции (для авто-кассира)

// --- рейтинг и уровни ---
export const RATING_START = 3.0;
export const RATING_MEMORY = 24;      // сглаживание рейтинга по последним N покупателям

export const LEVEL_XP = [0, 300, 900, 2000, 4200, 7800, 13000, 21000, 33000, 50000];

export function levelFromXp(xp) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return Math.min(lvl, LEVEL_XP.length);
}

export function xpForNextLevel(xp) {
  const lvl = levelFromXp(xp);
  if (lvl >= LEVEL_XP.length) return null;
  return LEVEL_XP[lvl];
}

// Цвета игроков (по порядку подключения)
export const PLAYER_COLORS = [
  '#4fc3f7', '#ffb74d', '#81c784', '#ba68c8',
  '#f06292', '#ffd54f', '#4db6ac', '#ff8a65',
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const money = (v) => `$${(Math.round(v * 100) / 100).toFixed(2)}`;

export function formatClock(seconds) {
  const total = DAY_START_HOUR * 3600 + seconds;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
