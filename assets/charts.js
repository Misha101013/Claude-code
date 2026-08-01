/* CutDesk — графики на чистом SVG, без библиотек.
   Общие правила: тонкие марки, сетка-волосинка, 2px зазор поверхностью между
   заливками, 2px кольцо на маркерах, подписи текстовыми токенами (не цветом
   серии), подсказка при наведении и с клавиатуры, у каждого графика есть
   таблица-двойник. */

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** Цвета берём из CSS-переменных, поэтому смена темы просто перерисовывает. */
export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = n => cs.getPropertyValue(n).trim();
  return {
    surface: get('--surface-1'),
    text: get('--text-primary'),
    secondary: get('--text-secondary'),
    muted: get('--text-muted'),
    grid: get('--grid'),
    axis: get('--axis'),
    series: [1, 2, 3, 4, 5, 6].map(i => get(`--series-${i}`)),
    ordinal: [1, 2, 3, 4].map(i => get(`--ord-${i}`)),
  };
}

/** Порядковая шкала под нужное число стадий — всегда от светлого к тёмному. */
export function ordinalScale(n, t = tokens()) {
  const base = t.ordinal;
  if (n <= base.length) {
    const step = (base.length - 1) / Math.max(1, n - 1);
    return Array.from({ length: n }, (_, i) => base[Math.round(i * step)]);
  }
  return Array.from({ length: n }, (_, i) => base[Math.min(base.length - 1, i)]);
}

/* ── Каркас: перерисовка по ширине контейнера ────────────────────────── */

const drawers = new WeakMap();
let observer = null;

function mount(root, draw) {
  drawers.set(root, draw);
  if (!observer) {
    observer = new ResizeObserver(entries => {
      for (const e of entries) {
        const fn = drawers.get(e.target);
        if (fn && e.contentRect.width > 0) fn(e.contentRect.width);
      }
    });
  }
  observer.observe(root);
  const w = root.clientWidth;
  if (w > 0) draw(w);
}

/** Полная перерисовка всех живых графиков — например при смене темы. */
export function redrawAll(roots) {
  for (const r of roots) {
    const fn = drawers.get(r);
    if (fn && r.clientWidth > 0) fn(r.clientWidth);
  }
}

function frame(root) {
  root.textContent = '';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  root.appendChild(tip);
  return tip;
}

function showTip(root, tip, x, y, html) {
  tip.textContent = '';
  tip.appendChild(html);
  tip.classList.add('is-on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const maxX = root.clientWidth - w - 2;
  tip.style.left = Math.max(2, Math.min(maxX, x - w / 2)) + 'px';
  tip.style.top = Math.max(2, y - h - 12) + 'px';
}

const hideTip = tip => tip.classList.remove('is-on');

/** Строки подсказки: значение — главное, имя серии — вторично. */
function tipContent(head, rows) {
  const box = document.createElement('div');
  const h = document.createElement('div');
  h.className = 'tip-head';
  h.textContent = head;
  box.appendChild(h);
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'tip-row';
    if (r.color) {
      const key = document.createElement('span');
      key.className = 'tip-key';
      key.style.background = r.color;
      line.appendChild(key);
    }
    const name = document.createElement('span');
    name.className = 'tip-name';
    name.textContent = r.name;
    const val = document.createElement('span');
    val.className = 'tip-val';
    val.textContent = r.value;
    line.append(name, val);
    box.appendChild(line);
  }
  return box;
}

/* ── Шкалы ───────────────────────────────────────────────────────────── */

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v);
  return out;
}

const textWidth = (s, size = 11) => String(s).length * size * 0.58;

function axisText(x, y, str, color, anchor = 'end', size = 11) {
  const t = el('text', {
    x, y, fill: color, 'font-size': size, 'text-anchor': anchor,
    'font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif',
    'dominant-baseline': 'middle',
  });
  t.style.fontVariantNumeric = 'tabular-nums';
  t.textContent = str;
  return t;
}

/* ── Спарклайн для плитки ────────────────────────────────────────────── */

export function sparkline(root, values) {
  mount(root, width => {
    const t = tokens();
    const h = 30, pad = 3;
    root.textContent = '';
    const svg = el('svg', { width, height: h, viewBox: `0 0 ${width} ${h}`, 'aria-hidden': 'true', focusable: 'false' });
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const span = max - min || 1;
    const x = i => (values.length < 2 ? width / 2 : (i / (values.length - 1)) * (width - 2 * pad) + pad);
    const y = v => h - pad - ((v - min) / span) * (h - 2 * pad);
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', {
      d, fill: 'none', stroke: t.series[0], 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .45,
    }));
    const last = values.length - 1;
    if (last >= 0) {
      svg.appendChild(el('circle', {
        cx: x(last), cy: y(values[last]), r: 4,
        fill: t.series[0], stroke: t.surface, 'stroke-width': 2,
      }));
    }
    root.appendChild(svg);
  });
}

/* ── Линия / столбцы во времени (одна серия) ─────────────────────────── */

export function timeSeries(root, opts) {
  const { labels, values, name, fmt = String, shape = 'line', partialLast = false } = opts;
  mount(root, width => {
    if (!labels.length) { root.textContent = ''; return; }
    const t = tokens();
    const tip = frame(root);
    const H = 210, axisBand = 24, top = 14;
    const ticks = niceTicks(Math.max(...values, 0));
    const padLeft = Math.max(30, textWidth(fmt(ticks[ticks.length - 1])) + 12);
    // Линия подписывает последнюю точку справа от маркера — резервируем место.
    const endLabel = shape === 'line' ? fmt(values[values.length - 1] ?? 0) : '';
    const padRight = endLabel ? Math.min(width * 0.28, textWidth(endLabel, 12) + 16) : 10;
    const plotW = Math.max(10, width - padLeft - padRight);
    const plotH = H - top - axisBand;
    const maxY = ticks[ticks.length - 1] || 1;

    const svg = el('svg', {
      width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img',
      'aria-label': `${name}: динамика по периодам, ${labels.length} точек`,
    });

    for (const v of ticks) {
      const y = top + plotH - (v / maxY) * plotH;
      svg.appendChild(el('line', { x1: padLeft, x2: padLeft + plotW, y1: y, y2: y, stroke: v === 0 ? t.axis : t.grid, 'stroke-width': 1 }));
      svg.appendChild(axisText(padLeft - 8, y, fmt(v), t.muted));
    }

    const n = labels.length;
    const bandW = plotW / Math.max(1, n);
    const cx = i => (shape === 'bars' ? padLeft + bandW * (i + 0.5) : padLeft + (n < 2 ? plotW / 2 : (i / (n - 1)) * plotW));
    const cy = v => top + plotH - (v / maxY) * plotH;

    // Последняя корзина обычно ещё не закончилась — она приглушена,
    // чтобы неполный период не читался как обвал.
    const dim = partialLast && n > 1;

    if (shape === 'bars') {
      const barW = Math.min(24, Math.max(4, bandW - 8));
      values.forEach((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, (v / maxY) * plotH);
        if (!h) return;
        const bar = roundedTopRect(cx(i) - barW / 2, top + plotH - h, barW, h, 4, t.series[0]);
        if (dim && i === n - 1) bar.setAttribute('opacity', '.45');
        svg.appendChild(bar);
      });
    } else {
      const pt = i => `${cx(i).toFixed(1)} ${cy(values[i]).toFixed(1)}`;
      const path = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => `${k ? 'L' : 'M'}${pt(from + k)}`).join(' ');
      const full = path(0, n - 1);
      svg.appendChild(el('path', {
        d: `${full} L${cx(n - 1).toFixed(1)} ${top + plotH} L${cx(0).toFixed(1)} ${top + plotH} Z`,
        fill: t.series[0], opacity: .1, stroke: 'none',
      }));
      const stroke = {
        fill: 'none', stroke: t.series[0], 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      };
      svg.appendChild(el('path', { ...stroke, d: dim ? path(0, n - 2) : full }));
      if (dim) svg.appendChild(el('path', { ...stroke, d: path(n - 2, n - 1), opacity: .45 }));
      svg.appendChild(el('circle', {
        cx: cx(n - 1), cy: cy(values[n - 1] ?? 0), r: 4.5,
        fill: t.series[0], stroke: t.surface, 'stroke-width': 2,
        opacity: dim ? .45 : 1,
      }));
      // Подпись только у последней точки — цифры на каждой точке не читают.
      const lab = axisText(cx(n - 1) + 10, cy(values[n - 1] ?? 0), endLabel, t.text, 'start', 12);
      lab.setAttribute('font-weight', '600');
      svg.appendChild(lab);
    }

    // Подписи оси X прореживаем, чтобы они не наезжали друг на друга.
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 62))));
    labels.forEach((l, i) => {
      if (i % step && i !== n - 1) return;
      if (i !== n - 1 && (n - 1 - i) < step * 0.6) return;
      svg.appendChild(axisText(cx(i), H - axisBand / 2, l, t.muted, 'middle'));
    });

    const cross = el('line', { y1: top, y2: top + plotH, stroke: t.axis, 'stroke-width': 1, opacity: 0 });
    const dot = el('circle', { r: 4.5, fill: t.series[0], stroke: t.surface, 'stroke-width': 2, opacity: 0 });
    svg.append(cross, dot);

    const hit = el('rect', {
      x: padLeft, y: top, width: plotW, height: plotH,
      fill: 'transparent', tabindex: '0', role: 'application',
      'aria-label': 'Точки графика: стрелками влево-вправо',
    });
    svg.appendChild(hit);

    let active = -1;
    const focusIndex = i => {
      active = Math.max(0, Math.min(n - 1, i));
      const x = cx(active), y = cy(values[active]);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', '1');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', shape === 'bars' ? '0' : '1');
      showTip(root, tip, x, y, tipContent(labels[active], [{ name, value: fmt(values[active]), color: t.series[0] }]));
    };
    const clear = () => { active = -1; cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); hideTip(tip); };

    hit.addEventListener('pointermove', e => {
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const i = shape === 'bars'
        ? Math.floor((px - padLeft) / bandW)
        : Math.round(((px - padLeft) / plotW) * (n - 1));
      focusIndex(i);
    });
    hit.addEventListener('pointerleave', clear);
    hit.addEventListener('focus', () => focusIndex(active < 0 ? n - 1 : active));
    hit.addEventListener('blur', clear);
    hit.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { focusIndex(active + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { focusIndex(active - 1); e.preventDefault(); }
      if (e.key === 'Escape') clear();
    });

    root.appendChild(svg);
  });
}

function roundedTopRect(x, y, w, h, r, fill) {
  const rr = Math.min(r, w / 2, h);
  const d = `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
  return el('path', { d, fill });
}

/* ── Столбцы со стопкой (несколько серий) ────────────────────────────── */

export function stackedColumns(root, opts) {
  const { labels, series, fmt = String, partialLast = false } = opts;
  mount(root, width => {
    if (!labels.length || !series.length) { root.textContent = ''; return; }
    const t = tokens();
    const tip = frame(root);
    const H = 230, axisBand = 24, top = 14;
    const totals = labels.map((_, i) => series.reduce((s, ser) => s + ser.values[i], 0));
    const ticks = niceTicks(Math.max(...totals, 0));
    const maxY = ticks[ticks.length - 1] || 1;
    const padLeft = Math.max(28, textWidth(fmt(maxY)) + 12);
    const plotW = Math.max(10, width - padLeft - 10);
    const plotH = H - top - axisBand;

    const svg = el('svg', {
      width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img',
      'aria-label': `Заявки по типам видео, ${series.length} категорий`,
    });

    for (const v of ticks) {
      const y = top + plotH - (v / maxY) * plotH;
      svg.appendChild(el('line', { x1: padLeft, x2: padLeft + plotW, y1: y, y2: y, stroke: v === 0 ? t.axis : t.grid, 'stroke-width': 1 }));
      svg.appendChild(axisText(padLeft - 8, y, fmt(v), t.muted));
    }

    const n = labels.length;
    const bandW = plotW / Math.max(1, n);
    const barW = Math.min(24, Math.max(5, bandW - 10));
    const GAP = 2; // зазор цветом поверхности разделяет соседние сегменты

    labels.forEach((_, i) => {
      const x = padLeft + bandW * (i + 0.5) - barW / 2;
      let acc = 0;
      const parts = series.map((ser, si) => ({ si, v: ser.values[i] })).filter(p => p.v > 0);
      parts.forEach((p, k) => {
        const isTop = k === parts.length - 1;
        const y0 = top + plotH - (acc / maxY) * plotH;
        acc += p.v;
        const y1 = top + plotH - (acc / maxY) * plotH;
        const h = Math.max(1, y0 - y1 - (k ? GAP : 0));
        const color = t.series[p.si % t.series.length];
        const mark = isTop
          ? roundedTopRect(x, y1, barW, h, 4, color)
          : el('rect', { x, y: y1, width: barW, height: h, fill: color });
        if (partialLast && n > 1 && i === n - 1) mark.setAttribute('opacity', '.45');
        svg.appendChild(mark);
      });
    });

    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 58))));
    labels.forEach((l, i) => {
      if (i % step && i !== n - 1) return;
      if (i !== n - 1 && (n - 1 - i) < step * 0.6) return;
      svg.appendChild(axisText(padLeft + bandW * (i + 0.5), H - axisBand / 2, l, t.muted, 'middle'));
    });

    // Цель наведения — вся колонка: подсказка показывает сразу все серии.
    labels.forEach((_, i) => {
      const hit = el('rect', {
        x: padLeft + bandW * i, y: top, width: bandW, height: plotH,
        fill: 'transparent', tabindex: '0', role: 'img',
        'aria-label': `${labels[i]}: всего ${fmt(totals[i])}`,
      });
      const show = () => {
        hit.setAttribute('fill', t.grid);
        hit.setAttribute('opacity', '.35');
        const rows = series
          .map((s, si) => ({ name: s.label, value: fmt(s.values[i]), color: t.series[si % t.series.length], raw: s.values[i] }))
          .filter(r => r.raw > 0);
        rows.push({ name: 'Всего', value: fmt(totals[i]), color: '' });
        showTip(root, tip, padLeft + bandW * (i + 0.5), top + 10, tipContent(labels[i], rows));
      };
      const hide = () => { hit.setAttribute('fill', 'transparent'); hit.removeAttribute('opacity'); hideTip(tip); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      svg.appendChild(hit);
    });

    root.appendChild(svg);
  });
}

/* ── Горизонтальные полосы (топы и воронка) ──────────────────────────── */

export function hBars(root, opts) {
  const { items, fmt = String, colors, title = '' } = opts;
  mount(root, width => {
    if (!items.length) { root.textContent = ''; return; }
    const t = tokens();
    const tip = frame(root);
    const rowH = 38, barH = 20;
    const H = Math.max(rowH, items.length * rowH) + 4;
    const labelW = Math.min(150, Math.max(70, Math.round(width * 0.3)));
    const max = Math.max(...items.map(i => i.value), 1);
    const valueW = Math.max(46, textWidth(fmt(max), 12) + 14);
    const trackW = Math.max(10, width - labelW - valueW - 8);

    const svg = el('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'img', 'aria-label': title || 'Горизонтальные полосы' });

    items.forEach((item, i) => {
      const y = i * rowH + 2;
      const cyMid = y + rowH / 2;
      const color = colors ? colors[i % colors.length] : t.series[0];
      const w = Math.max(item.value > 0 ? 3 : 0, (item.value / max) * trackW);

      const lab = axisText(labelW - 10, cyMid, item.label, t.secondary, 'end', 12);
      lab.style.fontVariantNumeric = 'normal';
      svg.appendChild(lab);

      if (w) svg.appendChild(roundedEndBar(labelW, cyMid - barH / 2, w, barH, 4, color));
      svg.appendChild(axisText(labelW + w + 10, cyMid, fmt(item.value), t.text, 'start', 12));

      const hit = el('rect', {
        x: 0, y, width, height: rowH, fill: 'transparent', tabindex: '0', role: 'img',
        'aria-label': `${item.label}: ${fmt(item.value)}`,
      });
      const show = () => {
        hit.setAttribute('fill', t.grid);
        hit.setAttribute('opacity', '.35');
        hit.setAttribute('rx', '8');
        showTip(root, tip, Math.min(width - 60, labelW + w), cyMid - 4,
          tipContent(item.label, [{ name: item.note || 'Значение', value: fmt(item.value), color }]));
      };
      const hide = () => { hit.setAttribute('fill', 'transparent'); hit.removeAttribute('opacity'); hideTip(tip); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      svg.appendChild(hit);
    });

    root.appendChild(svg);
  });
}

function roundedEndBar(x, y, w, h, r, fill) {
  const rr = Math.min(r, w, h / 2);
  const d = `M${x} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} L${x} ${y + h} Z`;
  return el('path', { d, fill });
}

/* ── Легенда и таблица-двойник ───────────────────────────────────────── */

export function legend(root, entries, kind = 'rect') {
  root.textContent = '';
  for (const e of entries) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = kind === 'line' ? 'legend-line' : 'legend-swatch';
    sw.style.background = e.color;
    const label = document.createElement('span');
    label.textContent = e.label;
    item.append(sw, label);
    root.appendChild(item);
  }
}

/** Таблица с теми же числами: значения не заперты в подсказке. */
export function table(root, headers, rows) {
  root.textContent = '';
  const tbl = document.createElement('table');
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    r.forEach((cell, i) => {
      const td = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) td.scope = 'row';
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  tbl.append(thead, tbody);
  root.appendChild(tbl);
}
