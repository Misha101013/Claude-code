// Каталог товаров. cost - закупочная цена за штуку, market - рекомендованная
// рыночная цена (по ней покупатели оценивают, дорого им или нет),
// perBox - штук в коробке, level - с какого уровня магазина товар доступен.

export const CATEGORIES = [
  { id: 'produce', name: 'Овощи и фрукты', color: '#7cb342' },
  { id: 'dairy', name: 'Молочное', color: '#90caf9' },
  { id: 'bakery', name: 'Выпечка', color: '#d7a86e' },
  { id: 'drinks', name: 'Напитки', color: '#4dd0e1' },
  { id: 'snacks', name: 'Снеки', color: '#ffb74d' },
  { id: 'frozen', name: 'Заморозка', color: '#b3e5fc' },
  { id: 'household', name: 'Бытовое', color: '#ce93d8' },
  { id: 'health', name: 'Здоровье', color: '#ef9a9a' },
];

const RAW = [
  // id, name, emoji, cat, cost, market, perBox, level, color
  ['banana', 'Бананы', '🍌', 'produce', 0.28, 0.55, 24, 1, '#ffe082'],
  ['apple', 'Яблоки', '🍎', 'produce', 0.32, 0.62, 24, 1, '#e57373'],
  ['potato', 'Картофель', '🥔', 'produce', 0.20, 0.45, 30, 1, '#c9a227'],
  ['tomato', 'Помидоры', '🍅', 'produce', 0.35, 0.70, 20, 2, '#ef5350'],
  ['cucumber', 'Огурцы', '🥒', 'produce', 0.30, 0.60, 20, 2, '#66bb6a'],
  ['orange', 'Апельсины', '🍊', 'produce', 0.38, 0.75, 20, 3, '#ffa726'],

  ['milk', 'Молоко', '🥛', 'dairy', 0.72, 1.35, 12, 1, '#eceff1'],
  ['eggs', 'Яйца', '🥚', 'dairy', 1.10, 2.10, 12, 1, '#fff8e1'],
  ['yogurt', 'Йогурт', '🍶', 'dairy', 0.45, 0.92, 16, 2, '#f8bbd0'],
  ['cheese', 'Сыр', '🧀', 'dairy', 1.80, 3.40, 10, 3, '#ffd54f'],
  ['butter', 'Масло', '🧈', 'dairy', 1.40, 2.60, 12, 4, '#fff176'],

  ['bread', 'Хлеб', '🍞', 'bakery', 0.55, 1.10, 12, 1, '#d7a86e'],
  ['croissant', 'Круассаны', '🥐', 'bakery', 0.40, 0.88, 16, 2, '#e6b877'],
  ['donut', 'Пончики', '🍩', 'bakery', 0.50, 1.10, 16, 3, '#f48fb1'],

  ['water', 'Вода', '💧', 'drinks', 0.22, 0.50, 24, 1, '#81d4fa'],
  ['cola', 'Кола', '🥤', 'drinks', 0.55, 1.15, 24, 1, '#8d6e63'],
  ['juice', 'Сок', '🧃', 'drinks', 0.85, 1.65, 12, 2, '#ffb300'],
  ['energy', 'Энергетик', '⚡', 'drinks', 0.90, 1.95, 24, 3, '#aed581'],
  ['coffee', 'Кофе', '☕', 'drinks', 2.40, 4.50, 8, 4, '#6d4c41'],
  ['beer', 'Пиво', '🍺', 'drinks', 0.80, 1.75, 24, 5, '#fbc02d'],

  ['chips', 'Чипсы', '🍟', 'snacks', 0.60, 1.30, 18, 1, '#ffca28'],
  ['chocolate', 'Шоколад', '🍫', 'snacks', 0.50, 1.05, 24, 1, '#795548'],
  ['cookies', 'Печенье', '🍪', 'snacks', 0.70, 1.45, 16, 2, '#bcaaa4'],
  ['candy', 'Конфеты', '🍬', 'snacks', 0.35, 0.80, 30, 2, '#f06292'],
  ['nuts', 'Орехи', '🥜', 'snacks', 1.20, 2.35, 12, 4, '#a1887f'],

  ['icecream', 'Мороженое', '🍦', 'frozen', 1.20, 2.40, 10, 3, '#e1f5fe'],
  ['pizza', 'Пицца зам.', '🍕', 'frozen', 1.60, 3.10, 10, 3, '#ff7043'],
  ['fries', 'Картофель фри', '🍟', 'frozen', 1.00, 2.00, 12, 5, '#ffd180'],

  ['soap', 'Мыло', '🧼', 'household', 0.65, 1.40, 16, 2, '#b39ddb'],
  ['paper', 'Туал. бумага', '🧻', 'household', 1.50, 2.90, 12, 2, '#f5f5f5'],
  ['detergent', 'Порошок', '🧴', 'household', 2.20, 4.20, 8, 4, '#4fc3f7'],
  ['shampoo', 'Шампунь', '🧴', 'household', 1.80, 3.50, 10, 5, '#9575cd'],

  ['vitamins', 'Витамины', '💊', 'health', 3.20, 6.00, 8, 6, '#ef9a9a'],
  ['painkiller', 'Таблетки', '💉', 'health', 2.10, 4.20, 10, 6, '#e57373'],
  ['toothpaste', 'Зубная паста', '🪥', 'health', 1.30, 2.60, 12, 5, '#80cbc4'],
];

export const PRODUCTS = RAW.map(([id, name, emoji, cat, cost, market, perBox, level, color]) => ({
  id, name, emoji, cat, cost, market, perBox, level, color,
  boxCost: Math.round(cost * perBox * 100) / 100,
}));

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

export function productsForLevel(level) {
  return PRODUCTS.filter((p) => p.level <= level);
}

// Насколько охотно покупатель берёт товар по цене price при рыночной market.
// По рынку и ниже - берут всегда, 1.7 рынка и выше - почти никогда.
export function priceAppeal(price, market) {
  if (price <= 0) return 1;
  const f = price / market;
  if (f <= 1) return 1;
  if (f >= 1.7) return 0.02;
  return 1 - (f - 1) / 0.72;
}

// Популярность категорий - влияет на то, что покупатели чаще кладут в корзину.
export const CATEGORY_WEIGHT = {
  produce: 1.25, dairy: 1.2, bakery: 1.1, drinks: 1.15,
  snacks: 1.0, frozen: 0.8, household: 0.7, health: 0.5,
};
