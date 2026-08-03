/* ==========================================================================
   gif.js — минимальный кодировщик анимированного GIF89a.
   Никаких зависимостей: квантование палитры (median cut) + LZW + сборка файла.

   Использование:
     const enc = new GifEncoder(width, height, { delayMs: 83, loop: 0 });
     enc.addFrameRGBA(uint8ClampedArrayRGBA);   // для каждого кадра
     const blob = enc.finish();                 // Blob('image/gif')

   Палитра строится общая для всех кадров: сначала addFrameRGBA() собирает
   статистику и складывает кадры, finish() квантует и пишет файл.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ---------- Побитовый писатель для LZW ---------- */

  function BitWriter() {
    this.bytes = [];
    this.cur = 0;
    this.nbits = 0;
  }
  BitWriter.prototype.write = function (code, size) {
    this.cur |= code << this.nbits;
    this.nbits += size;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.nbits -= 8;
    }
  };
  BitWriter.prototype.flush = function () {
    if (this.nbits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
  };

  /* ---------- LZW-сжатие потока индексов палитры ---------- */

  function lzwEncode(indices, minCodeSize) {
    var CLEAR = 1 << minCodeSize;
    var EOI = CLEAR + 1;
    var codeSize = minCodeSize + 1;
    var next = EOI + 1;
    var dict = new Map();
    var bw = new BitWriter();

    bw.write(CLEAR, codeSize);

    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var key = (prefix << 8) | k;
      var found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      bw.write(prefix, codeSize);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        // словарь заполнен — сбрасываем
        bw.write(CLEAR, codeSize);
        dict = new Map();
        next = EOI + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    bw.write(prefix, codeSize);
    bw.write(EOI, codeSize);
    bw.flush();
    return bw.bytes;
  }

  /* ---------- Квантование: гистограмма 5-5-5 + median cut ---------- */

  function Quantizer() {
    this.hist = new Int32Array(32768); // 32*32*32 корзин
    // суммы каналов по корзинам: цвет корзины = реальное среднее, а не центр,
    // иначе чистый белый превращается в 252,252,252
    this.sr = new Float64Array(32768);
    this.sg = new Float64Array(32768);
    this.sb = new Float64Array(32768);
  }

  Quantizer.prototype.sample = function (rgba, step) {
    var h = this.hist, sr = this.sr, sg = this.sg, sb = this.sb;
    var stride = 4 * (step || 1);
    for (var i = 0; i < rgba.length; i += stride) {
      var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      var idx = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      h[idx]++; sr[idx] += r; sg[idx] += g; sb[idx] += b;
    }
  };

  Quantizer.prototype.buildPalette = function (maxColors) {
    var h = this.hist;
    var entries = [];
    for (var i = 0; i < 32768; i++) {
      if (h[i] === 0) continue;
      entries.push({
        r: this.sr[i] / h[i],
        g: this.sg[i] / h[i],
        b: this.sb[i] / h[i],
        n: h[i]
      });
    }
    if (entries.length === 0) entries.push({ r: 255, g: 255, b: 255, n: 1 });

    var boxes = [makeBox(entries)];
    while (boxes.length < maxColors) {
      // берём коробку с наибольшим «объёмом» по цвету и более чем одним цветом
      var target = -1, best = -1;
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        if (box.items.length < 2) continue;
        var score = box.range * box.count;
        if (score > best) { best = score; target = b; }
      }
      if (target < 0) break;
      var split = splitBox(boxes[target]);
      if (!split) break;
      boxes.splice(target, 1, split[0], split[1]);
    }

    var pal = new Uint8Array(maxColors * 3);
    for (var j = 0; j < boxes.length; j++) {
      var it = boxes[j].items, sr = 0, sg = 0, sb = 0, sn = 0;
      for (var k = 0; k < it.length; k++) {
        sr += it[k].r * it[k].n;
        sg += it[k].g * it[k].n;
        sb += it[k].b * it[k].n;
        sn += it[k].n;
      }
      pal[j * 3] = Math.round(sr / sn);
      pal[j * 3 + 1] = Math.round(sg / sn);
      pal[j * 3 + 2] = Math.round(sb / sn);
    }
    return { palette: pal, size: Math.max(1, boxes.length) };
  };

  function makeBox(items) {
    var rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0, count = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.r < rmin) rmin = it.r; if (it.r > rmax) rmax = it.r;
      if (it.g < gmin) gmin = it.g; if (it.g > gmax) gmax = it.g;
      if (it.b < bmin) bmin = it.b; if (it.b > bmax) bmax = it.b;
      count += it.n;
    }
    var dr = rmax - rmin, dg = gmax - gmin, db = bmax - bmin;
    var axis = dr >= dg && dr >= db ? 'r' : (dg >= db ? 'g' : 'b');
    return { items: items, axis: axis, range: Math.max(dr, dg, db), count: count };
  }

  function splitBox(box) {
    var axis = box.axis;
    var items = box.items.slice().sort(function (a, b) { return a[axis] - b[axis]; });
    var half = box.count / 2, acc = 0, cut = 0;
    for (var i = 0; i < items.length; i++) {
      acc += items[i].n;
      if (acc >= half) { cut = i + 1; break; }
    }
    if (cut <= 0) cut = 1;
    if (cut >= items.length) cut = items.length - 1;
    if (cut <= 0) return null;
    return [makeBox(items.slice(0, cut)), makeBox(items.slice(cut))];
  }

  /* ---------- Сопоставление пикселей палитре (с кэшем 5-5-5) ---------- */

  function makeMapper(pal, size) {
    var cache = new Int16Array(32768).fill(-1);
    return function (r, g, b) {
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var hit = cache[key];
      if (hit >= 0) return hit;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < size; i++) {
        var dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2];
        var d = dr * dr * 3 + dg * dg * 6 + db * db; // веса по чувствительности глаза
        if (d < bestD) { bestD = d; best = i; }
      }
      cache[key] = best;
      return best;
    };
  }

  /* ---------- Кодировщик ---------- */

  function GifEncoder(width, height, opts) {
    opts = opts || {};
    this.width = width | 0;
    this.height = height | 0;
    this.delay = Math.max(2, Math.round((opts.delayMs || 100) / 10)); // сотые доли секунды
    this.loop = opts.loop === undefined ? 0 : opts.loop;
    this.maxColors = Math.min(256, opts.maxColors || 256);
    this.frames = [];
    this.q = new Quantizer();
  }

  /** Добавить кадр. rgba — Uint8ClampedArray длиной width*height*4 (альфа игнорируется). */
  GifEncoder.prototype.addFrameRGBA = function (rgba) {
    var n = this.width * this.height;
    var rgb = new Uint8Array(n * 3);
    for (var i = 0, j = 0; i < n; i++, j += 3) {
      var p = i * 4;
      rgb[j] = rgba[p];
      rgb[j + 1] = rgba[p + 1];
      rgb[j + 2] = rgba[p + 2];
    }
    this.frames.push(rgb);
    // выборка для гистограммы: каждый 3-й пиксель — достаточно и быстро
    this.q.sample(rgba, 3);
  };

  GifEncoder.prototype.frameCount = function () { return this.frames.length; };

  GifEncoder.prototype.finish = function () {
    var built = this.q.buildPalette(this.maxColors);
    var pal = built.palette, palSize = built.size;
    var map = makeMapper(pal, palSize);

    var out = [];
    var push = function (arr) { for (var i = 0; i < arr.length; i++) out.push(arr[i]); };
    var u16 = function (v) { out.push(v & 0xff, (v >> 8) & 0xff); };

    // Заголовок
    push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
    u16(this.width); u16(this.height);
    out.push(0xf7); // глобальная таблица цветов, 256 записей
    out.push(0);    // индекс фона
    out.push(0);    // соотношение сторон пикселя

    // Глобальная палитра — всегда 256 записей
    for (var c = 0; c < 256; c++) {
      out.push(pal[c * 3] || 0, pal[c * 3 + 1] || 0, pal[c * 3 + 2] || 0);
    }

    // Зацикливание (NETSCAPE2.0)
    push([0x21, 0xff, 0x0b]);
    push([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
    out.push(0x03, 0x01);
    u16(this.loop);
    out.push(0x00);

    var n = this.width * this.height;

    for (var f = 0; f < this.frames.length; f++) {
      var rgb = this.frames[f];
      var indices = new Uint8Array(n);
      for (var i = 0, j = 0; i < n; i++, j += 3) {
        indices[i] = map(rgb[j], rgb[j + 1], rgb[j + 2]);
      }

      // Graphic Control Extension
      push([0x21, 0xf9, 0x04, 0x04]); // disposal = 1 (оставить кадр)
      u16(this.delay);
      out.push(0x00); // прозрачный индекс не используется
      out.push(0x00);

      // Image Descriptor
      out.push(0x2c);
      u16(0); u16(0);
      u16(this.width); u16(this.height);
      out.push(0x00);

      // LZW-данные подблоками по 255 байт
      out.push(8); // minCodeSize
      var data = lzwEncode(indices, 8);
      for (var p = 0; p < data.length; p += 255) {
        var chunk = data.slice(p, p + 255);
        out.push(chunk.length);
        push(chunk);
      }
      out.push(0x00);
    }

    out.push(0x3b); // конец файла
    return new Blob([new Uint8Array(out)], { type: 'image/gif' });
  };

  global.GifEncoder = GifEncoder;
})(typeof window !== 'undefined' ? window : this);
