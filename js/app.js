/* ==========================================================================
   Ротоскоп — покадровая анимация поверх видео.
   Всё работает на клиенте. Ничего не сохраняется в localStorage/sessionStorage —
   состояние живёт только в памяти на время сессии.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- utils */

  var $ = function (id) { return document.getElementById(id); };
  var raf = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };

  function fmtTime(sec) {
    if (!isFinite(sec)) return '—';
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 2600);
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ---------------------------------------------------------------- state */

  var MAX_DIM = 1024;       // максимальная сторона рабочего кадра
  var MAX_FRAMES = 600;     // защита от гигантских нарезок

  var S = {
    videoURL: null,
    duration: 0,
    fps: 12,
    frameW: 0,
    frameH: 0,
    frames: [],       // { url, thumb, strokes: [], redo: [] }
    index: 0,
    tool: 'brush',
    color: '#111111',
    size: 6,
    onion: false,
    bgOpacity: 0.55,
    slicing: false,
    busy: false
  };

  var els = {};
  [
    'steps', 'screen1', 'screen2', 'screen3', 'drop', 'fileInput', 'videoCard', 'video',
    'mName', 'mDur', 'mSize', 'toStep2', 'presets', 'fps', 'fpsVal', 'estimate', 'doSlice',
    'sliceProgress', 'sliceBar', 'sliceTxt', 'stage', 'canvasWrap', 'bgCanvas', 'onionCanvas',
    'drawCanvas', 'tBrush', 'tEraser', 'tUndo', 'tRedo', 'tOnion', 'tSettings', 'tPlay',
    'tExport', 'brushPanel', 'size', 'sizeVal', 'swatches', 'bgOpacity', 'bgVal', 'clearFrame',
    'copyPrev', 'prevFrame', 'nextFrame', 'frameNo', 'frameTotal', 'filmstrip', 'playModal',
    'playCanvas', 'closePlay', 'playToggle', 'playWithVideo', 'playFps', 'exportModal',
    'closeExport', 'expGif', 'expZip', 'expProgress', 'expBar', 'expTxt'
  ].forEach(function (id) { els[id] = $(id); });

  var bgCtx = els.bgCanvas.getContext('2d');
  var onionCtx = els.onionCanvas.getContext('2d');
  var drawCtx = els.drawCanvas.getContext('2d');

  /* ------------------------------------------------------------ навигация */

  function goStep(n) {
    [1, 2, 3].forEach(function (i) {
      els['screen' + i].classList.toggle('is-active', i === n);
    });
    Array.prototype.forEach.call(els.steps.children, function (btn) {
      var i = +btn.dataset.goto;
      btn.classList.toggle('is-active', i === n);
      btn.classList.toggle('is-done', i < n);
    });
    if (n === 3) {
      fitStage();
      renderAll();
    }
  }

  function enableStep(n) {
    els.steps.querySelector('[data-goto="' + n + '"]').disabled = false;
  }

  els.steps.addEventListener('click', function (e) {
    var btn = e.target.closest('.step');
    if (btn && !btn.disabled) goStep(+btn.dataset.goto);
  });

  /* ------------------------------------------------- ШАГ 1: загрузка видео */

  els.drop.addEventListener('click', function () { els.fileInput.click(); });
  els.drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', function () {
    if (els.fileInput.files && els.fileInput.files[0]) loadVideo(els.fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (t) {
    els.drop.addEventListener(t, function (e) { e.preventDefault(); els.drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    els.drop.addEventListener(t, function (e) { e.preventDefault(); els.drop.classList.remove('is-over'); });
  });
  els.drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadVideo(f);
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  function loadVideo(file) {
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) {
      toast('Это не похоже на видеофайл');
      return;
    }
    if (S.videoURL) URL.revokeObjectURL(S.videoURL);
    S.videoURL = URL.createObjectURL(file);

    var v = els.video;
    v.src = S.videoURL;
    v.load();

    els.mName.textContent = file.name;
    els.mDur.textContent = '…';
    els.mSize.textContent = '…';
    els.videoCard.classList.remove('hidden');

    v.onloadedmetadata = function () {
      S.duration = v.duration || 0;
      var w = v.videoWidth, h = v.videoHeight;
      var scale = Math.min(1, MAX_DIM / Math.max(w, h));
      S.frameW = Math.max(2, Math.round(w * scale / 2) * 2);
      S.frameH = Math.max(2, Math.round(h * scale / 2) * 2);

      els.mDur.textContent = fmtTime(S.duration) + ' сек';
      els.mSize.textContent = w + '×' + h + (scale < 1 ? ' → ' + S.frameW + '×' + S.frameH : '');
      updateEstimate();
      enableStep(2);
    };
    v.onerror = function () {
      toast('Браузер не смог открыть это видео. Попробуйте MP4 (H.264) или WEBM.', 5000);
    };
  }

  els.toStep2.addEventListener('click', function () { goStep(2); });

  /* --------------------------------------------------- ШАГ 2: нарезка FPS */

  function setFps(n) {
    S.fps = Math.min(30, Math.max(1, n | 0));
    els.fps.value = S.fps;
    els.fpsVal.textContent = S.fps;
    Array.prototype.forEach.call(els.presets.children, function (b) {
      b.classList.toggle('is-on', +b.dataset.fps === S.fps);
    });
    els.playFps.textContent = S.fps + ' FPS';
    updateEstimate();
  }

  function frameCountFor(fps) {
    return Math.min(MAX_FRAMES, Math.max(1, Math.floor(S.duration * fps)));
  }

  function updateEstimate() {
    if (!S.duration) { els.estimate.innerHTML = 'Сначала загрузите видео.'; return; }
    var n = frameCountFor(S.fps);
    var capped = Math.floor(S.duration * S.fps) > MAX_FRAMES;
    els.estimate.innerHTML = 'Будет создано <b>' + n + '</b> кадров' +
      (capped ? ' (ограничение — первые ' + MAX_FRAMES + ' кадров)' : '') +
      '. Каждый кадр вы будете обводить вручную.';
    els.estimate.classList.toggle('warn', n > 150);
  }

  els.presets.addEventListener('click', function (e) {
    var b = e.target.closest('.preset');
    if (b) setFps(+b.dataset.fps);
  });
  els.fps.addEventListener('input', function () { setFps(+els.fps.value); });

  els.doSlice.addEventListener('click', function () {
    if (!S.duration) { toast('Сначала загрузите видео'); return; }
    if (S.slicing) return;
    if (S.frames.length && !confirm('Кадры уже нарезаны. Нарезать заново? Все рисунки будут потеряны.')) return;
    sliceVideo();
  });

  function seekTo(v, t) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      };
      var timer = setTimeout(finish, 3000); // страховка: некоторые браузеры не шлют seeked
      v.addEventListener('seeked', finish);
      try { v.currentTime = t; } catch (err) { finish(); }
    });
  }

  async function sliceVideo() {
    var v = els.video;
    S.slicing = true;
    els.doSlice.disabled = true;
    els.sliceProgress.classList.remove('hidden');
    els.sliceBar.style.width = '0%';
    els.sliceTxt.textContent = 'Готовим видео…';

    // некоторым браузерам (в первую очередь на iOS) нужен «толчок» воспроизведением
    v.muted = true;
    v.pause();
    try { await v.play(); v.pause(); } catch (e) { /* не критично */ }

    // очищаем прошлую нарезку
    S.frames.forEach(function (f) { URL.revokeObjectURL(f.url); });
    S.frames = [];
    bgCache.clear();

    var W = S.frameW, H = S.frameH;
    var ex = document.createElement('canvas');
    ex.width = W; ex.height = H;
    var exCtx = ex.getContext('2d');

    var th = document.createElement('canvas');
    var thH = 120;
    th.height = thH;
    th.width = Math.max(2, Math.round(W / H * thH));
    var thCtx = th.getContext('2d');

    var count = frameCountFor(S.fps);
    var step = 1 / S.fps;
    var t0 = performance.now();

    for (var i = 0; i < count; i++) {
      var t = Math.min(i * step, Math.max(0, S.duration - 0.02));
      await seekTo(v, t);

      exCtx.drawImage(v, 0, 0, W, H);
      thCtx.drawImage(v, 0, 0, th.width, th.height);

      var blob = await new Promise(function (res) { ex.toBlob(res, 'image/jpeg', 0.82); });
      if (!blob) { toast('Не удалось прочитать кадр видео'); break; }

      S.frames.push({
        url: URL.createObjectURL(blob),
        thumb: th.toDataURL('image/jpeg', 0.6),
        strokes: [],
        redo: []
      });

      var pct = Math.round((i + 1) / count * 100);
      els.sliceBar.style.width = pct + '%';
      var elapsed = (performance.now() - t0) / 1000;
      var left = (i + 1) < count ? Math.round(elapsed / (i + 1) * (count - i - 1)) : 0;
      els.sliceTxt.textContent = 'Кадр ' + (i + 1) + ' из ' + count +
        (left > 1 ? ' · осталось ~' + left + ' сек' : '');
      await raf();
    }

    S.slicing = false;
    els.doSlice.disabled = false;

    if (!S.frames.length) {
      els.sliceTxt.textContent = 'Не получилось нарезать видео.';
      return;
    }

    els.sliceTxt.textContent = 'Готово: ' + S.frames.length + ' кадров';
    S.index = 0;
    buildFilmstrip();
    enableStep(3);
    goStep(3);
    toast('Кадры готовы — можно рисовать!');
  }

  /* ------------------------------------------------ фоновые кадры (кэш) */

  var bgCache = new Map();

  async function getBg(i) {
    if (i < 0 || i >= S.frames.length) return null;
    if (bgCache.has(i)) {
      var cached = bgCache.get(i);
      bgCache.delete(i); bgCache.set(i, cached); // освежаем в LRU
      return cached;
    }
    var img = new Image();
    img.src = S.frames[i].url;
    try {
      await img.decode();
    } catch (e) {
      await new Promise(function (r) { img.onload = r; img.onerror = r; });
    }
    bgCache.set(i, img);
    while (bgCache.size > 14) bgCache.delete(bgCache.keys().next().value);
    return img;
  }

  /* ------------------------------------------------------ рисование: слои */

  function setupCanvases() {
    [els.bgCanvas, els.onionCanvas, els.drawCanvas].forEach(function (c) {
      c.width = S.frameW;
      c.height = S.frameH;
    });
  }

  function fitStage() {
    if (!S.frameW) return;
    var r = els.stage.getBoundingClientRect();
    var availW = r.width - 20, availH = r.height - 20;
    if (availW <= 0 || availH <= 0) return;
    var k = Math.min(availW / S.frameW, availH / S.frameH);
    els.canvasWrap.style.width = Math.floor(S.frameW * k) + 'px';
    els.canvasWrap.style.height = Math.floor(S.frameH * k) + 'px';
  }

  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', function () { setTimeout(fitStage, 250); });

  function strokeWidth(s, pt, scale) {
    var base = s.w * scale;
    return s.v ? Math.max(0.4, base * (0.35 + 0.65 * (pt.p === undefined ? 0.5 : pt.p))) : base;
  }

  function beginStrokeCtx(ctx, s) {
    ctx.save();
    ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // один «кусок» линии, заканчивающийся точкой i (сглаживание по средним точкам)
  function drawPiece(ctx, s, i, W, H, scale) {
    var p = s.pts, a = p[i - 1], b = p[i];
    ctx.lineWidth = strokeWidth(s, b, scale);
    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo(a.x * W, a.y * H);
    } else {
      var prev = p[i - 2];
      ctx.moveTo((prev.x + a.x) / 2 * W, (prev.y + a.y) / 2 * H);
    }
    ctx.quadraticCurveTo(a.x * W, a.y * H, (a.x + b.x) / 2 * W, (a.y + b.y) / 2 * H);
    ctx.stroke();
  }

  function drawTail(ctx, s, W, H, scale) {
    var p = s.pts, n = p.length;
    if (n < 2) return;
    ctx.lineWidth = strokeWidth(s, p[n - 1], scale);
    ctx.beginPath();
    ctx.moveTo((p[n - 2].x + p[n - 1].x) / 2 * W, (p[n - 2].y + p[n - 1].y) / 2 * H);
    ctx.lineTo(p[n - 1].x * W, p[n - 1].y * H);
    ctx.stroke();
  }

  function drawStroke(ctx, s, W, H) {
    var scale = W / S.frameW;
    beginStrokeCtx(ctx, s);
    if (s.pts.length === 1) {
      ctx.beginPath();
      ctx.arc(s.pts[0].x * W, s.pts[0].y * H, Math.max(0.4, strokeWidth(s, s.pts[0], scale) / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (var i = 1; i < s.pts.length; i++) drawPiece(ctx, s, i, W, H, scale);
      drawTail(ctx, s, W, H, scale);
    }
    ctx.restore();
  }

  function renderStrokes(ctx, strokes, W, H) {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < strokes.length; i++) drawStroke(ctx, strokes[i], W, H);
  }

  var renderToken = 0;

  async function renderBg() {
    var token = ++renderToken;
    var img = await getBg(S.index);
    if (token !== renderToken) return;
    bgCtx.clearRect(0, 0, S.frameW, S.frameH);
    if (img) bgCtx.drawImage(img, 0, 0, S.frameW, S.frameH);
    // предзагрузка соседей — навигация становится мгновенной
    getBg(S.index + 1); getBg(S.index - 1);
  }

  function renderOnion() {
    onionCtx.clearRect(0, 0, S.frameW, S.frameH);
    if (!S.onion || S.index === 0) return;
    var prev = S.frames[S.index - 1];
    if (prev) renderStrokes(onionCtx, prev.strokes, S.frameW, S.frameH);
  }

  function renderAll() {
    if (!S.frames.length) return;
    setupCanvases();
    els.bgCanvas.style.opacity = S.bgOpacity;
    els.onionCanvas.style.opacity = S.onion ? 0.32 : 0;
    renderBg();
    renderOnion();
    renderStrokes(drawCtx, S.frames[S.index].strokes, S.frameW, S.frameH);
    updateFrameUI();
  }

  function updateFrameUI() {
    var f = S.frames[S.index];
    els.frameNo.textContent = S.index + 1;
    els.frameTotal.textContent = S.frames.length;
    els.prevFrame.disabled = S.index === 0;
    els.nextFrame.disabled = S.index === S.frames.length - 1;
    els.tUndo.disabled = !f || !f.strokes.length;
    els.tRedo.disabled = !f || !f.redo.length;
    els.copyPrev.disabled = S.index === 0;

    var thumbs = els.filmstrip.children;
    for (var i = 0; i < thumbs.length; i++) {
      thumbs[i].classList.toggle('is-on', i === S.index);
      thumbs[i].classList.toggle('has-draw', S.frames[i].strokes.length > 0);
    }
    var active = thumbs[S.index];
    if (active) {
      var strip = els.filmstrip.getBoundingClientRect();
      var box = active.getBoundingClientRect();
      if (box.left < strip.left || box.right > strip.right) {
        els.filmstrip.scrollLeft += box.left - strip.left - strip.width / 2 + box.width / 2;
      }
    }
  }

  function buildFilmstrip() {
    els.filmstrip.innerHTML = '';
    var frag = document.createDocumentFragment();
    S.frames.forEach(function (f, i) {
      var b = document.createElement('button');
      b.className = 'thumb';
      b.dataset.i = i;
      b.innerHTML = '<img alt="Кадр ' + (i + 1) + '" src="' + f.thumb + '"><span class="n">' + (i + 1) + '</span>';
      frag.appendChild(b);
    });
    els.filmstrip.appendChild(frag);
  }

  els.filmstrip.addEventListener('click', function (e) {
    var b = e.target.closest('.thumb');
    if (b) gotoFrame(+b.dataset.i);
  });

  function gotoFrame(i) {
    if (i < 0 || i >= S.frames.length || i === S.index) return;
    finishStroke();
    S.index = i;
    renderAll();
  }

  els.prevFrame.addEventListener('click', function () { gotoFrame(S.index - 1); });
  els.nextFrame.addEventListener('click', function () { gotoFrame(S.index + 1); });

  /* ------------------------------------------------- рисование: указатель */

  var active = null;      // текущий штрих
  var activeId = null;
  var lastPenAt = 0;

  function pointFrom(e) {
    var r = els.drawCanvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      p: e.pressure > 0 ? e.pressure : 0.5
    };
  }

  els.drawCanvas.addEventListener('pointerdown', function (e) {
    if (!S.frames.length || active) return;
    if (e.pointerType === 'pen') lastPenAt = Date.now();
    // отсекаем касание ладонью, когда рисуют стилусом
    if (e.pointerType === 'touch' && Date.now() - lastPenAt < 1500) return;
    e.preventDefault();

    activeId = e.pointerId;
    try { els.drawCanvas.setPointerCapture(e.pointerId); } catch (err) {}

    active = {
      c: S.color,
      w: S.size,
      e: S.tool === 'eraser',
      v: e.pointerType === 'pen',
      pts: [pointFrom(e)]
    };
    var f = S.frames[S.index];
    f.strokes.push(active);
    f.redo.length = 0;

    beginStrokeCtx(drawCtx, active);
    drawCtx.beginPath();
    drawCtx.arc(active.pts[0].x * S.frameW, active.pts[0].y * S.frameH,
      Math.max(0.4, strokeWidth(active, active.pts[0], 1) / 2), 0, Math.PI * 2);
    drawCtx.fill();
    drawCtx.restore();

    updateFrameUI();
  });

  els.drawCanvas.addEventListener('pointermove', function (e) {
    if (!active || e.pointerId !== activeId) return;
    e.preventDefault();

    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!events.length) events = [e];

    beginStrokeCtx(drawCtx, active);
    for (var i = 0; i < events.length; i++) {
      var pt = pointFrom(events[i]);
      var last = active.pts[active.pts.length - 1];
      var dx = (pt.x - last.x) * S.frameW, dy = (pt.y - last.y) * S.frameH;
      if (dx * dx + dy * dy < 1.2) continue; // пропускаем дрожание
      active.pts.push(pt);
      drawPiece(drawCtx, active, active.pts.length - 1, S.frameW, S.frameH, 1);
    }
    drawCtx.restore();
  });

  function finishStroke() {
    if (!active) return;
    if (active.pts.length > 1) {
      beginStrokeCtx(drawCtx, active);
      drawTail(drawCtx, active, S.frameW, S.frameH, 1);
      drawCtx.restore();
    }
    active = null;
    activeId = null;
    updateFrameUI();
  }

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    els.drawCanvas.addEventListener(t, function (e) {
      if (e.pointerId !== activeId) return;
      finishStroke();
    });
  });

  // подстраховка от «залипшего» штриха при уходе пальца за пределы холста
  window.addEventListener('pointerup', function () { finishStroke(); });

  /* ---------------------------------------------------------- инструменты */

  function setTool(t) {
    S.tool = t;
    els.tBrush.classList.toggle('is-on', t === 'brush');
    els.tEraser.classList.toggle('is-on', t === 'eraser');
  }

  els.tBrush.addEventListener('click', function () { setTool('brush'); });
  els.tEraser.addEventListener('click', function () { setTool('eraser'); });

  els.tUndo.addEventListener('click', undo);
  els.tRedo.addEventListener('click', redo);

  function undo() {
    finishStroke();
    var f = S.frames[S.index];
    if (!f || !f.strokes.length) return;
    f.redo.push(f.strokes.pop());
    renderStrokes(drawCtx, f.strokes, S.frameW, S.frameH);
    updateFrameUI();
  }

  function redo() {
    var f = S.frames[S.index];
    if (!f || !f.redo.length) return;
    f.strokes.push(f.redo.pop());
    renderStrokes(drawCtx, f.strokes, S.frameW, S.frameH);
    updateFrameUI();
  }

  els.tOnion.addEventListener('click', function () {
    S.onion = !S.onion;
    els.tOnion.classList.toggle('is-on', S.onion);
    els.onionCanvas.style.opacity = S.onion ? 0.32 : 0;
    renderOnion();
    toast(S.onion ? 'Онион-скин включён: виден предыдущий кадр' : 'Онион-скин выключен');
  });

  els.tSettings.addEventListener('click', function () {
    var hidden = els.brushPanel.classList.toggle('hidden');
    els.tSettings.classList.toggle('is-on', !hidden);
    els.screen3.classList.toggle('panel-open', !hidden);
    fitStage();
  });

  els.size.addEventListener('input', function () {
    S.size = +els.size.value;
    els.sizeVal.textContent = S.size;
  });

  els.bgOpacity.addEventListener('input', function () {
    S.bgOpacity = +els.bgOpacity.value / 100;
    els.bgVal.textContent = els.bgOpacity.value;
    els.bgCanvas.style.opacity = S.bgOpacity;
  });

  var COLORS = ['#111111', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de'];
  (function buildSwatches() {
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' is-on' : '');
      b.style.background = c;
      b.dataset.color = c;
      b.setAttribute('aria-label', 'Цвет ' + c);
      els.swatches.appendChild(b);
    });
    var wrap = document.createElement('label');
    wrap.className = 'swatch-custom';
    wrap.title = 'Свой цвет';
    var custom = document.createElement('input');
    custom.type = 'color';
    custom.value = '#111111';
    custom.setAttribute('aria-label', 'Свой цвет');
    custom.addEventListener('input', function () {
      wrap.style.background = custom.value;
      pickColor(custom.value, wrap);
    });
    wrap.appendChild(custom);
    els.swatches.appendChild(wrap);
  })();

  function pickColor(c, btn) {
    S.color = c;
    setTool('brush');
    Array.prototype.forEach.call(els.swatches.querySelectorAll('.swatch, .swatch-custom'), function (b) {
      b.classList.toggle('is-on', b === btn);
    });
  }

  els.swatches.addEventListener('click', function (e) {
    var b = e.target.closest('.swatch');
    if (b) pickColor(b.dataset.color, b);
  });

  els.clearFrame.addEventListener('click', function () {
    var f = S.frames[S.index];
    if (!f || !f.strokes.length) return;
    if (!confirm('Стереть весь рисунок на этом кадре?')) return;
    f.redo = f.strokes.slice().reverse();
    f.strokes = [];
    renderStrokes(drawCtx, f.strokes, S.frameW, S.frameH);
    updateFrameUI();
  });

  els.copyPrev.addEventListener('click', function () {
    if (S.index === 0) return;
    var prev = S.frames[S.index - 1], f = S.frames[S.index];
    if (!prev.strokes.length) { toast('На предыдущем кадре пусто'); return; }
    prev.strokes.forEach(function (s) {
      f.strokes.push({ c: s.c, w: s.w, e: s.e, v: s.v, pts: s.pts.map(function (p) { return { x: p.x, y: p.y, p: p.p }; }) });
    });
    f.redo.length = 0;
    renderStrokes(drawCtx, f.strokes, S.frameW, S.frameH);
    updateFrameUI();
    toast('Рисунок предыдущего кадра скопирован');
  });

  /* ------------------------------------------------- горячие клавиши (ПК) */

  window.addEventListener('keydown', function (e) {
    if (!els.screen3.classList.contains('is-active')) return;
    if (e.target.matches('input, textarea')) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'ArrowLeft') { gotoFrame(S.index - 1); }
    else if (e.key === 'ArrowRight') { gotoFrame(S.index + 1); }
    else if (e.key.toLowerCase() === 'b') { setTool('brush'); }
    else if (e.key.toLowerCase() === 'e') { setTool('eraser'); }
    else if (e.key.toLowerCase() === 'o') { els.tOnion.click(); }
  });

  /* ------------------------------------------------------ отрисовка кадра */

  /** Рисует кадр i в произвольный контекст: фон (опционально) + штрихи. */
  async function composeFrame(ctx, i, W, H, withVideo, whiteBg) {
    ctx.clearRect(0, 0, W, H);
    if (whiteBg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
    }
    if (withVideo) {
      var img = await getBg(i);
      if (img) ctx.drawImage(img, 0, 0, W, H);
    }
    var tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    renderStrokes(tmp.getContext('2d'), S.frames[i].strokes, W, H);
    ctx.drawImage(tmp, 0, 0);
  }

  /* ------------------------------------------------------------- просмотр */

  var play = { timer: 0, i: 0, running: false, ctx: null, W: 0, H: 0 };

  els.tPlay.addEventListener('click', openPlay);
  els.closePlay.addEventListener('click', closePlay);
  els.playModal.addEventListener('click', function (e) { if (e.target === els.playModal) closePlay(); });
  els.playToggle.addEventListener('click', function () {
    play.running ? pausePlay() : startPlay();
  });
  els.playWithVideo.addEventListener('change', function () { /* учитывается на следующем кадре */ });

  function openPlay() {
    if (!S.frames.length) return;
    var maxW = 560;
    var k = Math.min(1, maxW / S.frameW);
    play.W = Math.round(S.frameW * k);
    play.H = Math.round(S.frameH * k);
    els.playCanvas.width = play.W;
    els.playCanvas.height = play.H;
    play.ctx = els.playCanvas.getContext('2d');
    play.i = 0;
    els.playFps.textContent = S.fps + ' FPS';
    els.playModal.classList.remove('hidden');
    startPlay();
  }

  function closePlay() {
    pausePlay();
    els.playModal.classList.add('hidden');
  }

  function startPlay() {
    play.running = true;
    els.playToggle.textContent = 'Пауза';
    tickPlay();
  }

  function pausePlay() {
    play.running = false;
    clearTimeout(play.timer);
    els.playToggle.textContent = 'Играть';
  }

  async function tickPlay() {
    if (!play.running) return;
    var i = play.i;
    await composeFrame(play.ctx, i, play.W, play.H, els.playWithVideo.checked, true);
    if (!play.running) return;
    play.i = (i + 1) % S.frames.length;
    play.timer = setTimeout(tickPlay, 1000 / S.fps);
  }

  /* --------------------------------------------------------------- экспорт */

  els.tExport.addEventListener('click', function () {
    if (!S.frames.length) return;
    els.exportModal.classList.remove('hidden');
  });
  els.closeExport.addEventListener('click', function () { els.exportModal.classList.add('hidden'); });
  els.exportModal.addEventListener('click', function (e) {
    if (e.target === els.exportModal && !S.busy) els.exportModal.classList.add('hidden');
  });

  function expWhat() {
    return document.querySelector('input[name="expWhat"]:checked').value; // draw | both
  }
  function expWidth() {
    return +document.querySelector('input[name="expW"]:checked').value;
  }

  function expProgress(pct, txt) {
    els.expProgress.classList.remove('hidden');
    els.expBar.style.width = pct + '%';
    els.expTxt.textContent = txt;
  }

  function setBusy(v) {
    S.busy = v;
    els.expGif.disabled = v;
    els.expZip.disabled = v;
  }

  els.expZip.addEventListener('click', async function () {
    if (S.busy) return;
    setBusy(true);
    var withVideo = expWhat() === 'both';
    var W = S.frameW, H = S.frameH;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var zip = new ZipWriter();

    try {
      for (var i = 0; i < S.frames.length; i++) {
        await composeFrame(ctx, i, W, H, withVideo, withVideo);
        var blob = await new Promise(function (res) { cv.toBlob(res, 'image/png'); });
        var buf = new Uint8Array(await blob.arrayBuffer());
        zip.add('frame_' + String(i + 1).padStart(3, '0') + '.png', buf);
        expProgress(Math.round((i + 1) / S.frames.length * 100), 'Кадр ' + (i + 1) + ' из ' + S.frames.length);
        await raf();
      }
      expProgress(100, 'Собираем архив…');
      await raf();
      download(zip.finish(), 'rotoscope_' + S.fps + 'fps_png.zip');
      expProgress(100, 'Готово — архив скачан');
    } catch (err) {
      expProgress(0, 'Ошибка: ' + err.message);
    }
    setBusy(false);
  });

  els.expGif.addEventListener('click', async function () {
    if (S.busy) return;
    setBusy(true);
    var withVideo = expWhat() === 'both';
    var W = Math.min(expWidth(), S.frameW);
    var H = Math.max(2, Math.round(W * S.frameH / S.frameW));
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });

    try {
      var enc = new GifEncoder(W, H, { delayMs: 1000 / S.fps, loop: 0 });
      for (var i = 0; i < S.frames.length; i++) {
        await composeFrame(ctx, i, W, H, withVideo, true);
        enc.addFrameRGBA(ctx.getImageData(0, 0, W, H).data);
        expProgress(Math.round((i + 1) / S.frames.length * 85), 'Кадр ' + (i + 1) + ' из ' + S.frames.length);
        await raf();
      }
      expProgress(90, 'Собираем GIF… это самая долгая часть');
      await raf();
      var blob = enc.finish();
      download(blob, 'rotoscope_' + S.fps + 'fps.gif');
      expProgress(100, 'Готово — GIF скачан (' + Math.round(blob.size / 1024) + ' КБ)');
    } catch (err) {
      expProgress(0, 'Ошибка: ' + err.message);
    }
    setBusy(false);
  });

  /* ----------------------------------------------------------------- старт */

  setFps(12);
  setTool('brush');
  els.sizeVal.textContent = S.size;
  els.bgVal.textContent = Math.round(S.bgOpacity * 100);

  window.addEventListener('beforeunload', function (e) {
    if (S.frames.some(function (f) { return f.strokes.length; })) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
