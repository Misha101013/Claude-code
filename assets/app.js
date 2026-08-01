/* CutDesk — сборка приложения: маршруты, форма заявки, доска и аналитика. */

import {
  TYPES, PLATFORMS, PRIORITIES, STATUSES, WORKS, PRESETS,
  store, uid, normalize, today, addDays, daysBetween, labelDay, labelMonth,
  buckets, lastBucketIsPartial, seriesBy, stackBy, funnelCounts, topClients,
  loadByWeekday, selectRange, summarize, overdue, labelOf,
  fmtInt, fmtMoney, fmtDuration, encodeRequest, decodeRequest, requestText, demoRequests,
} from './data.js';

import { tokens, ordinalScale, sparkline, timeSeries, stackedColumns, hBars, legend, table } from './charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let requests = store.all();
let settings = store.settings();
let editingId = null;

/* ── Мелкие утилиты ──────────────────────────────────────────────────── */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function persist() {
  if (!store.save(requests)) toast('Не удалось сохранить: хранилище браузера недоступно');
  refreshCounters();
}

function refreshCounters() {
  const open = requests.filter(r => r.status !== 'done' && r.status !== 'cancel').length;
  $('#navCount').textContent = open;
  const dataStat = $('#dataStat');
  if (dataStat) dataStat.textContent = `В базе ${requests.length} заявок. Хранятся в этом браузере.`;
}

const cur = () => settings.currency || '₽';
const money = n => fmtMoney(n, cur());

function fillSelect(sel, items, valueKey = 'id', labelKey = 'label') {
  sel.textContent = '';
  for (const it of items) {
    const opt = document.createElement('option');
    if (typeof it === 'string') { opt.value = it; opt.textContent = it; }
    else { opt.value = it[valueKey]; opt.textContent = it[labelKey]; }
    sel.appendChild(opt);
  }
}

/* ── Тема ────────────────────────────────────────────────────────────── */

const THEME_KEY = 'cutdesk.theme';

function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f9f9f7');
  $('#themeBtn').textContent = mode === 'auto' ? '◐' : mode === 'dark' ? '☾' : '☀';
  if (currentView() === 'stats') renderStats();
}

function initTheme() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
  $('#themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    applyTheme(order[(order.indexOf(document.documentElement.dataset.theme) + 1) % order.length]);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (document.documentElement.dataset.theme === 'auto') applyTheme('auto');
  });
}

/* ── Маршруты ────────────────────────────────────────────────────────── */

const VIEWS = { '': 'brief', '/': 'brief', '/board': 'board', '/stats': 'stats', '/settings': 'settings' };
const currentView = () => $('.view.is-active')?.dataset.view;

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query || '') };
}

function route() {
  const { path, params } = parseHash();
  const view = VIEWS[path] ?? 'brief';
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
  $$('#nav a').forEach(a => {
    if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });

  if (view === 'brief') handleBriefParams(params);
  if (view === 'board') renderBoard();
  if (view === 'stats') renderStats();
  if (view === 'settings') fillSettingsForm();
}

/* ── Вид «Заявка» ────────────────────────────────────────────────────── */

function initBrief() {
  fillSelect($('#typeSel'), TYPES);
  fillSelect($('#platformSel'), PLATFORMS);
  fillSelect($('#prioritySel'), PRIORITIES);

  const presets = $('#presets');
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      $$('#presets .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      applyPreset(PRESETS[i]);
    });
    presets.appendChild(b);
  });

  const works = $('#works');
  WORKS.forEach(w => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.work = w;
    b.textContent = w;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
    works.appendChild(b);
  });

  $('#briefForm').addEventListener('submit', onSubmitBrief);
  $('#briefForm').addEventListener('reset', () => {
    setTimeout(() => {
      $$('#works .chip, #presets .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      editingId = null;
    });
  });
  $('#againBtn').addEventListener('click', () => {
    $('#sentCard').hidden = true;
    $('#briefForm').hidden = false;
    $('#briefForm').reset();
  });
  $('#copyLink').addEventListener('click', () => copyText($('#copyLink').dataset.url));
}

function applyPreset(p) {
  const f = $('#briefForm');
  f.type.value = p.type;
  f.platform.value = p.platform;
  f.durationSec.value = p.durationSec;
  f.hours.value = p.hours;
  $$('#works .chip').forEach(c => c.setAttribute('aria-pressed', String(p.works.includes(c.dataset.work))));
  if (!f.deadline.value) f.deadline.value = addDays(today(), 7);
}

function formToRequest() {
  const f = $('#briefForm');
  const get = n => f.elements[n]?.value ?? '';
  return normalize({
    id: editingId || uid(),
    createdAt: editingId ? requests.find(r => r.id === editingId)?.createdAt : today(),
    status: editingId ? requests.find(r => r.id === editingId)?.status : 'new',
    doneAt: editingId ? requests.find(r => r.id === editingId)?.doneAt : '',
    client: get('client'), contact: get('contact'), title: get('title'),
    type: get('type'), platform: get('platform'), priority: get('priority'),
    durationSec: get('durationSec'), qty: get('qty'), budget: get('budget'), hours: get('hours'),
    deadline: get('deadline'), source: get('source'), refs: get('refs'), notes: get('notes'),
    works: $$('#works .chip[aria-pressed="true"]').map(c => c.dataset.work),
  });
}

function fillForm(r) {
  const f = $('#briefForm');
  for (const [k, v] of Object.entries(r)) {
    if (f.elements[k] && typeof v !== 'object') f.elements[k].value = v || '';
  }
  $$('#works .chip').forEach(c => c.setAttribute('aria-pressed', String(r.works.includes(c.dataset.work))));
}

function onSubmitBrief(e) {
  e.preventDefault();
  const req = formToRequest();

  if (editingId) {
    requests = requests.map(r => (r.id === editingId ? req : r));
    editingId = null;
    persist();
    toast('Заявка обновлена');
    location.hash = '#/board';
    return;
  }

  requests = [req, ...requests];
  persist();
  showSent(req);
}

function showSent(req) {
  const text = requestText(req, cur());
  const url = `${location.origin}${location.pathname}#/?d=${encodeRequest(req)}`;

  $('#sentSummary').textContent = `${req.title} · ${req.client}${req.budget ? ` · ${fmtInt(req.budget)} ${cur()}` : ''}`;
  const tg = settings.telegram.replace(/^@/, '');
  const tgLink = $('#sendTg');
  tgLink.href = tg
    ? `https://t.me/${encodeURIComponent(tg)}?text=${encodeURIComponent(text + '\n\n' + url)}`
    : `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  $('#sendMail').href = `mailto:${encodeURIComponent(settings.email || '')}`
    + `?subject=${encodeURIComponent('Заявка на монтаж: ' + req.title)}`
    + `&body=${encodeURIComponent(text + '\n\n' + url)}`;
  $('#copyLink').dataset.url = url;

  $('#briefForm').hidden = true;
  $('#sentCard').hidden = false;
  $('#sentCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleBriefParams(params) {
  $('#studioTitle').textContent = settings.studio && settings.studio !== 'CutDesk'
    ? `Заявка на монтаж · ${settings.studio}` : 'Заявка на монтаж';
  $$('[data-cur]').forEach(n => { n.textContent = cur(); });

  const editId = params.get('edit');
  const code = params.get('d');
  $('#incomingCard').hidden = true;
  $('#sentCard').hidden = true;
  $('#briefForm').hidden = false;

  if (editId) {
    const r = requests.find(x => x.id === editId);
    if (r) { editingId = editId; fillForm(r); toast('Режим редактирования'); }
    return;
  }

  editingId = null;
  if (!code) return;

  const incoming = decodeRequest(code);
  if (!incoming) { toast('Ссылка повреждена'); return; }

  const known = requests.some(r => r.id === incoming.id);
  $('#incomingSummary').textContent = known
    ? `${incoming.title} · ${incoming.client} — уже есть в базе.`
    : `${incoming.title} · ${incoming.client} · ${labelOf(TYPES, incoming.type)}${incoming.budget ? ` · ${fmtInt(incoming.budget)} ${cur()}` : ''}`;
  $('#incomingCard').hidden = false;

  $('#incomingAdd').onclick = () => {
    if (requests.some(r => r.id === incoming.id)) { toast('Такая заявка уже есть'); return; }
    requests = [incoming, ...requests];
    persist();
    location.hash = '#/board';
  };
  $('#incomingEdit').onclick = () => {
    fillForm(incoming);
    $('#incomingCard').hidden = true;
    $('#briefForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#incomingSkip').onclick = () => { $('#incomingCard').hidden = true; location.hash = '#/'; };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Ссылка скопирована');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Ссылка скопирована');
  }
}

/* ── Вид «Заявки» ────────────────────────────────────────────────────── */

const boardState = { status: 'open', query: '', sort: 'new' };

function initBoard() {
  const filters = [{ id: 'open', label: 'В работе' }, { id: 'all', label: 'Все' }, ...STATUSES];
  const box = $('#statusFilter');
  filters.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (f.id === boardState.status ? ' is-on' : '');
    b.textContent = f.label;
    b.addEventListener('click', () => {
      boardState.status = f.id;
      $$('#statusFilter .chip').forEach(c => c.classList.remove('is-on'));
      b.classList.add('is-on');
      renderBoard();
    });
    box.appendChild(b);
  });

  $('#search').addEventListener('input', e => { boardState.query = e.target.value.trim().toLowerCase(); renderBoard(); });
  $('#sortSel').addEventListener('change', e => { boardState.sort = e.target.value; renderBoard(); });
}

function visibleRequests() {
  const { status, query, sort } = boardState;
  let rows = requests.filter(r => {
    if (status === 'open') { if (r.status === 'done' || r.status === 'cancel') return false; }
    else if (status !== 'all' && r.status !== status) return false;
    if (!query) return true;
    return `${r.client} ${r.title} ${r.notes} ${r.platform}`.toLowerCase().includes(query);
  });
  const byDate = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);
  if (sort === 'deadline') {
    rows = rows.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || byDate(a, b));
  } else if (sort === 'budget') {
    rows = rows.sort((a, b) => b.budget - a.budget);
  } else {
    rows = rows.sort(byDate);
  }
  return rows;
}

function renderBoard() {
  const rows = visibleRequests();
  const list = $('#list');
  list.textContent = '';
  $('#listEmpty').hidden = rows.length > 0;

  const sum = rows.reduce((s, r) => s + r.budget, 0);
  const hrs = rows.reduce((s, r) => s + r.hours, 0);
  const late = rows.filter(overdue).length;
  const strip = $('#boardSummary');
  strip.textContent = '';
  const bits = [
    ['Заявок', fmtInt(rows.length)],
    ['Сумма', money(sum)],
    ['Часов', fmtInt(hrs)],
  ];
  if (late) bits.push(['Просрочено', fmtInt(late)]);
  for (const [k, v] of bits) {
    const s = document.createElement('span');
    s.append(document.createTextNode(k + ': '));
    const b = document.createElement('b');
    b.textContent = v;
    s.appendChild(b);
    strip.appendChild(s);
  }

  const t = tokens();
  const stageColors = ordinalScale(4, t);
  const colorOf = st => (st === 'cancel' ? t.muted : stageColors[STATUSES.findIndex(s => s.id === st)] || t.muted);

  for (const r of rows) list.appendChild(requestCard(r, colorOf(r.status)));
}

function requestCard(r, dotColor) {
  const card = document.createElement('article');
  card.className = 'req-card';

  const top = document.createElement('div');
  top.className = 'req-top';
  const title = document.createElement('span');
  title.className = 'req-title';
  title.textContent = r.title;
  const client = document.createElement('span');
  client.className = 'req-client';
  client.textContent = r.client;

  const badge = document.createElement('span');
  badge.className = 'badge';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = dotColor;
  badge.append(dot, document.createTextNode(labelOf(STATUSES, r.status)));
  top.append(title, client, badge);
  card.appendChild(top);

  const meta = document.createElement('div');
  meta.className = 'req-meta';
  const add = (label, value, strong = true) => {
    const s = document.createElement('span');
    s.append(document.createTextNode(label + ' '));
    const b = document.createElement(strong ? 'b' : 'span');
    b.textContent = value;
    s.appendChild(b);
    meta.appendChild(s);
  };
  add('Тип:', labelOf(TYPES, r.type), false);
  add('Площадка:', r.platform, false);
  if (r.durationSec) add('Хроно:', fmtDuration(r.durationSec) + (r.qty > 1 ? ` × ${r.qty}` : ''));
  if (r.budget) add('Бюджет:', money(r.budget));
  if (r.hours) add('Часы:', fmtInt(r.hours));
  card.appendChild(meta);

  if (r.deadline) {
    const left = daysBetween(today(), r.deadline);
    const dl = document.createElement('span');
    dl.className = 'badge' + (overdue(r) ? ' is-late' : left <= 2 && r.status !== 'done' ? ' is-soon' : '');
    dl.textContent = overdue(r)
      ? `Просрочено на ${Math.abs(left)} дн.`
      : `Дедлайн: ${labelDay(r.deadline)}${r.status === 'done' ? '' : ` · ${left} дн.`}`;
    const wrap = document.createElement('div');
    wrap.className = 'req-works';
    wrap.appendChild(dl);
    if (r.priority !== 'normal') {
      const p = document.createElement('span');
      p.className = 'tag';
      p.textContent = labelOf(PRIORITIES, r.priority);
      wrap.appendChild(p);
    }
    card.appendChild(wrap);
  }

  if (r.works.length) {
    const works = document.createElement('div');
    works.className = 'req-works';
    for (const w of r.works) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = w;
      works.appendChild(tag);
    }
    card.appendChild(works);
  }

  const actions = document.createElement('div');
  actions.className = 'req-actions';

  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Статус заявки');
  sel.style.width = 'auto';
  fillSelect(sel, STATUSES);
  sel.value = r.status;
  sel.addEventListener('change', () => {
    const next = sel.value;
    requests = requests.map(x => (x.id === r.id
      ? { ...x, status: next, doneAt: next === 'done' ? (x.doneAt || today()) : '' }
      : x));
    persist();
    renderBoard();
  });
  actions.appendChild(sel);

  const edit = document.createElement('a');
  edit.className = 'btn btn-sm';
  edit.href = `#/?edit=${encodeURIComponent(r.id)}`;
  edit.textContent = 'Изменить';
  actions.appendChild(edit);

  if (r.source) {
    const src = document.createElement('a');
    src.className = 'btn btn-sm';
    src.href = r.source;
    src.target = '_blank';
    src.rel = 'noopener noreferrer';
    src.textContent = 'Исходники';
    actions.appendChild(src);
  }

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'btn btn-sm';
  share.textContent = 'Ссылка';
  share.addEventListener('click', () => copyText(`${location.origin}${location.pathname}#/?d=${encodeRequest(r)}`));
  actions.appendChild(share);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-sm btn-danger';
  del.textContent = 'Удалить';
  del.addEventListener('click', () => {
    if (!confirm(`Удалить заявку «${r.title}»?`)) return;
    requests = requests.filter(x => x.id !== r.id);
    persist();
    renderBoard();
  });
  actions.appendChild(del);

  card.appendChild(actions);
  return card;
}

/* ── Вид «Аналитика» ─────────────────────────────────────────────────── */

const statsState = { range: '90', type: 'all', metric: 'count', shape: 'line' };

const METRICS = [
  { id: 'count', label: 'Заявки', fmt: fmtInt, name: 'Заявок' },
  { id: 'money', label: 'Выручка', fmt: v => fmtMoney(v, cur()), name: 'Выручка' },
  { id: 'hours', label: 'Часы', fmt: fmtInt, name: 'Часов' },
];

function initStats() {
  fillSelect($('#typeFilter'), [{ id: 'all', label: 'Все типы' }, ...TYPES]);
  $('#rangeSel').value = statsState.range;
  $('#rangeSel').addEventListener('change', e => { statsState.range = e.target.value; renderStats(); });
  $('#typeFilter').addEventListener('change', e => { statsState.type = e.target.value; renderStats(); });

  segmented($('#dynMetric'), METRICS.map(m => ({ id: m.id, label: m.label })), statsState.metric, id => {
    statsState.metric = id;
    renderStats();
  });
  segmented($('#dynShape'), [{ id: 'line', label: 'Линия' }, { id: 'bars', label: 'Столбцы' }], statsState.shape, id => {
    statsState.shape = id;
    renderStats();
  });

  $$('.tbl-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.card').querySelector('.chart-table');
      const open = body.hidden;
      body.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Скрыть таблицу' : 'Таблица';
    });
  });
}

function segmented(root, items, active, onPick) {
  root.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(it.id === active));
    b.addEventListener('click', () => {
      $$('button', root).forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onPick(it.id);
    });
    root.appendChild(b);
  }
}

function renderStats() {
  const { range, type, metric, shape } = statsState;
  const { from, rows } = selectRange(requests, range, type);
  const byMonth = range === 'all' || Number(range) > 120;
  // Для «всего времени» начало шкалы — самая ранняя заявка, а не 0000 год.
  const start = range === 'all'
    ? rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), today())
    : from;
  const keys = buckets(start, today(), byMonth);
  const labels = keys.map(byMonth ? labelMonth : labelDay);
  const m = METRICS.find(x => x.id === metric);
  const now = summarize(rows);

  // Предыдущий отрезок той же длины — для дельт.
  let prev = null;
  if (range !== 'all') {
    const days = Number(range);
    const prevFrom = addDays(from, -days);
    prev = summarize(requests.filter(r => r.createdAt >= prevFrom && r.createdAt < from && (type === 'all' || r.type === type)));
  }

  renderHero(now, prev);
  renderTiles(now, prev, rows, keys, byMonth);
  renderDynamics(rows, keys, labels, m, shape, byMonth);
  renderMix(rows, keys, labels, byMonth);
  renderFunnel(rows);
  renderClients(rows);
  renderLoad(rows);
}

function deltaText(node, current, previous, invert = false, fmt = fmtInt, base = 'delta') {
  node.className = base;
  if (previous === null || previous === undefined) { node.textContent = ''; return; }
  if (!previous) {
    node.textContent = current ? 'Нет данных за прошлый период' : '';
    return;
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const good = invert ? diff < 0 : diff > 0;
  node.classList.add(diff === 0 ? 'flat' : good ? 'up' : 'down');
  node.textContent = '';
  const b = document.createElement('b');
  b.textContent = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(pct)}%`;
  node.append(b, document.createTextNode(` к прошлому периоду (${fmt(previous)})`));
}

function renderHero(now, prev) {
  $('#heroValue').textContent = money(now.revenue);
  deltaText($('#heroDelta'), now.revenue, prev?.revenue ?? null, false, money);
}

function renderTiles(now, prev, rows, keys, byMonth) {
  const box = $('#tiles');
  box.textContent = '';
  const items = [
    { label: 'Заявок за период', value: fmtInt(now.count), cur: now.count, prev: prev?.count, spark: seriesBy(rows, keys, byMonth, 'count') },
    { label: 'Сдано', value: fmtInt(now.doneCount), cur: now.doneCount, prev: prev?.doneCount, spark: seriesBy(rows.filter(r => r.status === 'done'), keys, byMonth, 'count') },
    { label: 'Средний чек', value: money(now.avgCheck), cur: now.avgCheck, prev: prev?.avgCheck, fmt: money },
    { label: 'Срок сдачи, дней', value: now.turnaround ? now.turnaround.toFixed(1).replace('.', ',') : '—', cur: now.turnaround, prev: prev?.turnaround, invert: true, fmt: v => v.toFixed(1).replace('.', ',') },
  ];

  for (const it of items) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const lbl = document.createElement('p');
    lbl.className = 'stat-label';
    lbl.textContent = it.label;
    const val = document.createElement('p');
    val.className = 'tile-value';
    val.textContent = it.value;
    const d = document.createElement('p');
    tile.append(lbl, val, d);
    deltaText(d, it.cur, it.prev ?? null, it.invert, it.fmt || fmtInt, 'tile-delta');
    if (it.spark && it.spark.length > 1) {
      const s = document.createElement('div');
      s.className = 'spark';
      tile.appendChild(s);
      sparkline(s, it.spark);
    }
    box.appendChild(tile);
  }
}

function renderDynamics(rows, keys, labels, metric, shape, byMonth) {
  const values = seriesBy(rows, keys, byMonth, metric.id);
  const partialLast = lastBucketIsPartial(byMonth);
  $('#dynTitle').textContent = `Динамика: ${metric.label.toLowerCase()}`;
  $('#dynSub').textContent = (byMonth ? 'По месяцам' : 'По неделям (начало недели — понедельник)')
    + (partialLast ? ` · ${byMonth ? 'месяц' : 'неделя'} ещё идёт, последнее значение приглушено` : '');
  timeSeries($('#dynChart'), { labels, values, name: metric.name, fmt: metric.fmt, shape, partialLast });
  table($('.card[data-chart="dynamics"] .chart-table'),
    [byMonth ? 'Месяц' : 'Неделя', metric.name],
    labels.map((l, i) => [l, metric.fmt(values[i])]));
}

function renderMix(rows, keys, labels, byMonth) {
  const series = stackBy(rows, keys, byMonth);
  const t = tokens();
  const root = $('#mixChart');
  if (!series.length) {
    root.textContent = '';
    $('#mixLegend').textContent = '';
    empty(root);
    table($('.card[data-chart="mix"] .chart-table'), ['Период', 'Заявок'], []);
    return;
  }
  stackedColumns(root, { labels, series, fmt: fmtInt, partialLast: lastBucketIsPartial(byMonth) });
  legend($('#mixLegend'), series.map((s, i) => ({ label: s.label, color: t.series[i % t.series.length] })));
  table($('.card[data-chart="mix"] .chart-table'),
    ['Период', ...series.map(s => s.label), 'Всего'],
    labels.map((l, i) => [l, ...series.map(s => fmtInt(s.values[i])), fmtInt(series.reduce((sum, s) => sum + s.values[i], 0))]));
}

function renderFunnel(rows) {
  const items = funnelCounts(rows);
  const colors = ordinalScale(items.length);
  hBars($('#funnelChart'), { items: items.map(i => ({ ...i, note: 'Заявок' })), fmt: fmtInt, colors, title: 'Воронка по стадиям' });
  const cancelled = rows.filter(r => r.status === 'cancel').length;
  table($('.card[data-chart="funnel"] .chart-table'),
    ['Стадия', 'Заявок'],
    [...items.map(i => [i.label, fmtInt(i.value)]), ['Отменена', fmtInt(cancelled)]]);
}

function renderClients(rows) {
  const items = topClients(rows);
  const root = $('#clientsChart');
  if (!items.length) {
    root.textContent = '';
    empty(root);
    table($('.card[data-chart="clients"] .chart-table'), ['Клиент', 'Выручка'], []);
    return;
  }
  hBars(root, { items: items.map(i => ({ ...i, note: 'Выручка' })), fmt: money, title: 'Топ клиентов по выручке' });
  table($('.card[data-chart="clients"] .chart-table'), ['Клиент', 'Выручка'], items.map(i => [i.label, money(i.value)]));
}

function renderLoad(rows) {
  const items = loadByWeekday(rows);
  hBars($('#loadChart'), { items: items.map(i => ({ ...i, note: 'Часов' })), fmt: fmtInt, title: 'Загрузка по дням недели' });
  table($('.card[data-chart="load"] .chart-table'), ['День', 'Часов'], items.map(i => [i.label, fmtInt(i.value)]));
}

function empty(root) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Нет данных за выбранный период';
  root.appendChild(p);
}

/* ── Вид «Настройки» ─────────────────────────────────────────────────── */

function initSettings() {
  $('#settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    settings = {
      studio: f.studio.value.trim() || 'CutDesk',
      telegram: f.telegram.value.trim(),
      email: f.email.value.trim(),
      currency: f.currency.value.trim() || '₽',
      rate: Number(f.rate.value) || 0,
    };
    store.saveSettings(settings);
    $$('[data-cur]').forEach(n => { n.textContent = cur(); });
    toast('Настройки сохранены');
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ settings, requests }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cutdesk-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importFile').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.requests;
      if (!Array.isArray(list)) throw new Error('bad');
      const known = new Set(requests.map(r => r.id));
      const added = list.map(normalize).filter(r => !known.has(r.id));
      requests = [...added, ...requests];
      if (data.settings) { settings = store.settings(); store.saveSettings({ ...settings, ...data.settings }); settings = store.settings(); }
      persist();
      toast(`Добавлено заявок: ${added.length}`);
      fillSettingsForm();
    } catch {
      toast('Не похоже на файл CutDesk');
    }
    e.target.value = '';
  });

  $('#demoBtn').addEventListener('click', () => {
    if (requests.length && !confirm('Добавить 140 демо-заявок к существующим?')) return;
    requests = [...demoRequests(), ...requests];
    persist();
    toast('Демо-данные загружены');
    location.hash = '#/stats';
  });

  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Удалить все заявки без возможности восстановления?')) return;
    requests = [];
    store.clear();
    persist();
    renderBoard();
    toast('База очищена');
  });
}

function fillSettingsForm() {
  const f = $('#settingsForm');
  f.studio.value = settings.studio;
  f.telegram.value = settings.telegram;
  f.email.value = settings.email;
  f.currency.value = settings.currency;
  f.rate.value = settings.rate;
  refreshCounters();
}

/* ── Старт ───────────────────────────────────────────────────────────── */

initTheme();
initBrief();
initBoard();
initStats();
initSettings();
refreshCounters();
window.addEventListener('hashchange', route);
route();
