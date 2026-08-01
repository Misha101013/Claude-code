/* CutDesk — модель данных, хранилище и агрегации.
   Всё живёт в localStorage: сервер не нужен, хостинг статики бесплатный. */

export const TYPES = [
  { id: 'reels',   label: 'Reels / Shorts' },
  { id: 'youtube', label: 'YouTube-ролик' },
  { id: 'ad',      label: 'Реклама' },
  { id: 'wedding', label: 'Свадьба / событие' },
  { id: 'podcast', label: 'Подкаст' },
  { id: 'other',   label: 'Другое' },
];

export const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'VK', 'Telegram', 'Другое'];

export const PRIORITIES = [
  { id: 'normal', label: 'Обычная' },
  { id: 'fast',   label: 'Срочно' },
  { id: 'rush',   label: 'Горит' },
];

/* Стадии — упорядоченная воронка, поэтому на графике они окрашены
   порядковой шкалой одного тона, а не категориальными слотами. */
export const STATUSES = [
  { id: 'new',      label: 'Новая',     stage: true },
  { id: 'progress', label: 'В работе',  stage: true },
  { id: 'review',   label: 'На правках', stage: true },
  { id: 'done',     label: 'Сдано',     stage: true },
  { id: 'cancel',   label: 'Отменена',  stage: false },
];

export const WORKS = [
  'Монтаж', 'Субтитры', 'Цветокор', 'Звук', 'Motion-графика', 'Обложка', 'Вертикальные нарезки',
];

export const PRESETS = [
  { label: 'Reels / Shorts', type: 'reels',   platform: 'Instagram', durationSec: 45,   hours: 3,  works: ['Монтаж', 'Субтитры', 'Звук'] },
  { label: 'YouTube-ролик',  type: 'youtube', platform: 'YouTube',   durationSec: 600,  hours: 10, works: ['Монтаж', 'Цветокор', 'Звук', 'Обложка'] },
  { label: 'Рекламный',      type: 'ad',      platform: 'Instagram', durationSec: 30,   hours: 8,  works: ['Монтаж', 'Motion-графика', 'Цветокор', 'Звук'] },
  { label: 'Свадьба',        type: 'wedding', platform: 'Другое',    durationSec: 420,  hours: 16, works: ['Монтаж', 'Цветокор', 'Звук'] },
  { label: 'Подкаст',        type: 'podcast', platform: 'YouTube',   durationSec: 2700, hours: 6,  works: ['Монтаж', 'Субтитры', 'Звук', 'Вертикальные нарезки'] },
];

const KEY_REQ = 'cutdesk.requests.v1';
const KEY_SET = 'cutdesk.settings.v1';

export const DEFAULT_SETTINGS = {
  studio: 'CutDesk', telegram: '', email: '', currency: '₽', rate: 1500,
};

/* ── Хранилище ───────────────────────────────────────────────────────── */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const store = {
  all() {
    const list = read(KEY_REQ, []);
    return Array.isArray(list) ? list.map(normalize) : [];
  },
  save(list) { return write(KEY_REQ, list); },
  settings() { return { ...DEFAULT_SETTINGS, ...read(KEY_SET, {}) }; },
  saveSettings(s) { return write(KEY_SET, { ...DEFAULT_SETTINGS, ...s }); },
  clear() { localStorage.removeItem(KEY_REQ); },
};

export function uid() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Приводит запись к безопасному виду — данные могут прийти из ссылки или файла. */
export function normalize(r) {
  const known = new Set(STATUSES.map(s => s.id));
  return {
    id: str(r?.id, 40) || uid(),
    createdAt: isoDay(r?.createdAt) || today(),
    doneAt: isoDay(r?.doneAt) || '',
    client: str(r?.client, 80) || 'Без имени',
    contact: str(r?.contact, 80),
    title: str(r?.title, 120) || 'Без названия',
    type: TYPES.some(t => t.id === r?.type) ? r.type : 'other',
    platform: PLATFORMS.includes(r?.platform) ? r.platform : 'Другое',
    priority: PRIORITIES.some(p => p.id === r?.priority) ? r.priority : 'normal',
    status: known.has(r?.status) ? r.status : 'new',
    durationSec: clamp(num(r?.durationSec), 0, 36000),
    qty: clamp(num(r?.qty, 1) || 1, 1, 99),
    budget: clamp(num(r?.budget), 0, 1e9),
    hours: clamp(num(r?.hours), 0, 1000),
    deadline: isoDay(r?.deadline) || '',
    source: str(r?.source, 400),
    refs: str(r?.refs, 400),
    notes: str(r?.notes, 1200),
    works: Array.isArray(r?.works) ? r.works.filter(w => WORKS.includes(w)) : [],
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ── Даты ────────────────────────────────────────────────────────────── */

export const today = () => toISO(new Date());

export function toISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isoDay(v) {
  if (typeof v !== 'string') return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? '' : m[0];
}

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Понедельник недели, в которую попадает дата. */
export function weekStart(iso) {
  const d = parseISO(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

export const monthStart = iso => iso.slice(0, 7) + '-01';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function labelDay(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function labelMonth(iso) {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/* ── Форматирование ──────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat('ru-RU');

export const fmtInt = n => nf.format(Math.round(n));

export function fmtMoney(n, cur = '₽') {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1).replace('.', ',')} млн ${cur}`;
  if (Math.abs(v) >= 1e4) return `${nf.format(Math.round(v / 1e3))} тыс. ${cur}`;
  return `${nf.format(v)} ${cur}`;
}

export function fmtDuration(sec) {
  if (!sec) return '—';
  if (sec < 60) return `${sec} сек`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60 ? (m % 60) + ' мин' : ''}`.trim();
}

export const labelOf = (list, id) => list.find(x => x.id === id)?.label ?? id;

/* ── Выборка и агрегации ─────────────────────────────────────────────── */

/** Заявки за период (в днях от сегодня) и с фильтром по типу. */
export function selectRange(list, rangeDays, type = 'all') {
  const from = rangeDays === 'all' ? '0000-01-01' : addDays(today(), -Number(rangeDays) + 1);
  return {
    from,
    rows: list.filter(r => r.createdAt >= from && (type === 'all' || r.type === type)),
  };
}

/** Корзины по неделям или месяцам — недели для коротких периодов. */
export function buckets(fromISO, toISO_, byMonth) {
  const out = [];
  let cur = byMonth ? monthStart(fromISO) : weekStart(fromISO);
  const end = byMonth ? monthStart(toISO_) : weekStart(toISO_);
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(cur);
    if (byMonth) {
      const d = parseISO(cur);
      d.setMonth(d.getMonth() + 1);
      cur = toISO(d);
    } else {
      cur = addDays(cur, 7);
    }
  }
  return out;
}

export const bucketOf = (iso, byMonth) => (byMonth ? monthStart(iso) : weekStart(iso));

/** Текущая корзина ещё не закончилась — значит последнее значение неполное. */
export function lastBucketIsPartial(byMonth) {
  if (byMonth) {
    const d = parseISO(monthStart(today()));
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toISO(d) > today();
  }
  return addDays(weekStart(today()), 6) > today();
}

/** Ряд значений по корзинам для одного показателя. */
export function seriesBy(rows, keys, byMonth, metric) {
  const map = new Map(keys.map(k => [k, 0]));
  for (const r of rows) {
    const k = bucketOf(r.createdAt, byMonth);
    if (!map.has(k)) continue;
    map.set(k, map.get(k) + metricValue(r, metric));
  }
  return keys.map(k => map.get(k));
}

export function metricValue(r, metric) {
  if (metric === 'money') return r.status === 'done' ? r.budget : 0;
  if (metric === 'hours') return r.hours;
  return 1;
}

/** Матрица «корзина × тип» для стопки. */
export function stackBy(rows, keys, byMonth) {
  const series = TYPES.map(t => ({ id: t.id, label: t.label, values: keys.map(() => 0) }));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const byId = new Map(series.map(s => [s.id, s]));
  for (const r of rows) {
    const i = idx.get(bucketOf(r.createdAt, byMonth));
    if (i === undefined) continue;
    byId.get(r.type).values[i] += 1;
  }
  return series.filter(s => s.values.some(v => v > 0));
}

export function funnelCounts(rows) {
  return STATUSES.filter(s => s.stage).map(s => ({
    id: s.id, label: s.label, value: rows.filter(r => r.status === s.id).length,
  }));
}

/** Топ клиентов по выручке; хвост сворачивается в «Другие» — цвета не циклим. */
export function topClients(rows, limit = 6) {
  const map = new Map();
  for (const r of rows) {
    if (r.status !== 'done') continue;
    map.set(r.client, (map.get(r.client) || 0) + r.budget);
  }
  const sorted = [...map].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const tail = sorted.slice(limit - 1).reduce((s, x) => s + x.value, 0);
  return [...head, { label: 'Другие', value: tail }];
}

export function loadByWeekday(rows) {
  const acc = WEEKDAYS.map(label => ({ label, value: 0 }));
  for (const r of rows) {
    if (!r.hours) continue;
    const day = (parseISO(r.deadline || r.createdAt).getDay() + 6) % 7;
    acc[day].value += r.hours;
  }
  return acc;
}

export function summarize(rows) {
  const done = rows.filter(r => r.status === 'done');
  const turnarounds = done
    .filter(r => r.doneAt && r.createdAt)
    .map(r => Math.max(0, daysBetween(r.createdAt, r.doneAt)));
  return {
    count: rows.length,
    active: rows.filter(r => r.status === 'progress' || r.status === 'review').length,
    revenue: done.reduce((s, r) => s + r.budget, 0),
    hours: rows.reduce((s, r) => s + r.hours, 0),
    doneCount: done.length,
    avgCheck: done.length ? done.reduce((s, r) => s + r.budget, 0) / done.length : 0,
    turnaround: turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : 0,
  };
}

export const overdue = r =>
  r.deadline && r.status !== 'done' && r.status !== 'cancel' && r.deadline < today();

/* ── Обмен заявками по ссылке ────────────────────────────────────────── */

export function encodeRequest(req) {
  const json = JSON.stringify(req);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRequest(code) {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return normalize(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Текст заявки для Telegram/почты — то же содержимое, но читаемое человеком. */
export function requestText(r, cur = '₽') {
  const lines = [
    `Заявка: ${r.title}`,
    `Клиент: ${r.client}${r.contact ? ` (${r.contact})` : ''}`,
    `Тип: ${labelOf(TYPES, r.type)} · ${r.platform}`,
    r.durationSec ? `Хронометраж: ${fmtDuration(r.durationSec)}${r.qty > 1 ? ` × ${r.qty}` : ''}` : '',
    r.deadline ? `Дедлайн: ${labelDay(r.deadline)} (${labelOf(PRIORITIES, r.priority)})` : '',
    r.budget ? `Бюджет: ${fmtInt(r.budget)} ${cur}` : '',
    r.works.length ? `Нужно: ${r.works.join(', ')}` : '',
    r.source ? `Исходники: ${r.source}` : '',
    r.refs ? `Референсы: ${r.refs}` : '',
    r.notes ? `Комментарий: ${r.notes}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/* ── Демо-данные ─────────────────────────────────────────────────────── */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoRequests(count = 140) {
  const rnd = mulberry32(20260801);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const clients = [
    'Ольга Ветрова', 'Кофейня «Пар»', 'Тимур Шайх', 'Studio Nord', 'Марина Ли',
    'FitLab', 'Аркадий Пеньков', 'Bloom Cosmetics', 'Дима Ворон', 'Школа Логос',
  ];
  const titles = {
    reels: ['Нарезка для запуска', 'Reels про новинку', 'Тренд-ролик', 'Анонс эфира'],
    youtube: ['Выпуск про поездку', 'Обзор оборудования', 'Влог недели', 'Разбор кейса'],
    ad: ['Промо для таргета', 'Ролик к распродаже', 'Имиджевый ролик'],
    wedding: ['Свадебный клип', 'Фильм со свадьбы', 'Тизер церемонии'],
    podcast: ['Выпуск подкаста', 'Подкаст + нарезки'],
    other: ['Титры к курсу', 'Сборка отчётного ролика'],
  };
  const priceBy = { reels: [4000, 12000], youtube: [15000, 45000], ad: [20000, 80000], wedding: [35000, 90000], podcast: [8000, 22000], other: [5000, 20000] };
  const hoursBy = { reels: [2, 5], youtube: [8, 18], ad: [6, 20], wedding: [14, 30], podcast: [4, 9], other: [3, 10] };

  const out = [];
  for (let i = 0; i < count; i++) {
    // Плотнее к недавним датам — так графики показывают рост, а не белый шум.
    const back = Math.floor(330 * Math.pow(rnd(), 1.35));
    const createdAt = addDays(today(), -back);
    const type = pick(['reels', 'reels', 'reels', 'youtube', 'youtube', 'ad', 'wedding', 'podcast', 'other']);
    const [pMin, pMax] = priceBy[type];
    const [hMin, hMax] = hoursBy[type];
    const lead = 3 + Math.floor(rnd() * 18);

    let status;
    if (back > 30) status = rnd() < 0.9 ? 'done' : 'cancel';
    else if (back > 12) status = pick(['done', 'done', 'review', 'progress', 'cancel']);
    else if (back > 4) status = pick(['progress', 'progress', 'review', 'done']);
    else status = pick(['new', 'new', 'progress']);

    const qty = type === 'reels' && rnd() < 0.4 ? 2 + Math.floor(rnd() * 4) : 1;
    out.push(normalize({
      id: uid() + i,
      createdAt,
      deadline: addDays(createdAt, lead),
      doneAt: status === 'done' ? addDays(createdAt, Math.max(1, Math.round(lead * (0.5 + rnd() * 0.8)))) : '',
      client: pick(clients),
      contact: '@' + ['olga', 'par', 'timur', 'nord', 'marina', 'fitlab'][Math.floor(rnd() * 6)],
      title: pick(titles[type]),
      type,
      platform: pick(PLATFORMS),
      priority: rnd() < 0.18 ? 'rush' : rnd() < 0.4 ? 'fast' : 'normal',
      status,
      durationSec: type === 'podcast' ? 1800 + Math.floor(rnd() * 2400) : Math.round(30 + rnd() * (type === 'reels' ? 60 : 700)),
      qty,
      budget: Math.round((pMin + rnd() * (pMax - pMin)) * qty / 500) * 500,
      hours: Math.round((hMin + rnd() * (hMax - hMin)) * qty * 2) / 2,
      works: WORKS.filter(() => rnd() < 0.45),
      source: 'https://disk.example.com/' + Math.random().toString(36).slice(2, 8),
      notes: '',
    }));
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
