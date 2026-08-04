/* Рендер: камера, арена, маги, эффекты, стики. Всё на Canvas 2D. */
window.Renderer = (() => {
  const cam = { x: 0, y: 0, scale: 1, shake: 0, shakeX: 0, shakeY: 0 };
  const particles = [];
  const floaters = [];
  const rings = [];
  const bolts = [];
  const trails = new Map(); // id снаряда -> хвост

  let cv, ctx, cfg = null, floor = null, dpr = 1;
  let W = 0, H = 0; // CSS-пиксели
  let time = 0;

  const KIND_COLOR = ['#ff9a3d', '#7fdcff', '#e0b3ff'];
  const KIND_CORE = ['#fff2c4', '#ffffff', '#ffffff'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * dpr);
    cv.height = Math.floor(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    cam.scale = clamp(Math.max(W, H) / 850, 0.5, 1.8);
  }

  function setConfig(c) { cfg = c; floor = null; }

  // ── статичный пол арены рисуем один раз в offscreen ────────
  function buildFloor() {
    const k = 0.5; // масштаб текстуры пола
    const w = Math.ceil(cfg.world.w * k), h = Math.ceil(cfg.world.h * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');

    const grd = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w, h) * 0.75);
    grd.addColorStop(0, '#1a1230');
    grd.addColorStop(0.6, '#120c22');
    grd.addColorStop(1, '#0a0616');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);

    // плитка
    g.strokeStyle = 'rgba(150,120,255,.09)';
    g.lineWidth = 1;
    const step = 80 * k;
    for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    // рунные круги
    g.strokeStyle = 'rgba(190,150,255,.16)';
    for (const r of [520, 380, 240]) {
      g.beginPath();
      g.arc(w / 2, h / 2, r * k, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.stroke();
    }
    g.save();
    g.translate(w / 2, h / 2);
    g.fillStyle = 'rgba(190,150,255,.14)';
    g.font = `${Math.round(26 * k * 2)}px serif`;
    g.textAlign = 'center';
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i / 12) * Math.PI * 2);
      g.fillText('✦', 0, -300 * k);
      g.restore();
    }
    g.restore();

    // рамка арены
    g.strokeStyle = 'rgba(255,190,120,.35)';
    g.lineWidth = 6 * k * 2;
    g.strokeRect(3, 3, w - 6, h - 6);

    floor = { canvas: c, k };
  }

  // ── камера ────────────────────────────────────────────────
  function follow(x, y, dt) {
    const s = cam.scale;
    const viewW = W / s, viewH = H / s;
    // смещаем центр вниз — свой маг оказывается выше кнопок способностей
    y += Math.min(90, viewH * 0.12);
    let tx = x, ty = y;
    if (cfg) {
      // небольшой запас за краем карты, чтобы маг у стены не липнул к краю экрана
      const m = 110;
      tx = viewW >= cfg.world.w ? cfg.world.w / 2
        : clamp(x, viewW / 2 - m, cfg.world.w - viewW / 2 + m);
      ty = viewH >= cfg.world.h ? cfg.world.h / 2
        : clamp(y, viewH / 2 - m, cfg.world.h - viewH / 2 + m);
    }
    const k = 1 - Math.pow(0.0025, dt); // мягкое следование
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 26);
      cam.shakeX = rand(-cam.shake, cam.shake);
      cam.shakeY = rand(-cam.shake, cam.shake);
    } else { cam.shakeX = cam.shakeY = 0; }
  }

  const w2s = (x, y) => ({
    x: (x - cam.x) * cam.scale + W / 2 + cam.shakeX,
    y: (y - cam.y) * cam.scale + H / 2 + cam.shakeY,
  });

  function shake(v) { cam.shake = Math.min(16, cam.shake + v); }

  // ── эффекты ───────────────────────────────────────────────
  function burst(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(speed * 0.35, speed);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(life * 0.6, life), max: life, color, size: rand(size * 0.6, size),
      });
    }
  }

  function pushFx(list, selfId) {
    for (const f of list) {
      switch (f.k) {
        case 'hit':
          burst(f.x, f.y, 10, KIND_COLOR[f.kd] || '#fff', 190, 0.42, 3.4);
          if (f.r) rings.push({ x: f.x, y: f.y, r: 6, to: f.r, life: 0.32, max: 0.32, c: KIND_COLOR[f.kd] });
          break;
        case 'boom':
          rings.push({ x: f.x, y: f.y, r: 10, to: f.r, life: 0.55, max: 0.55, c: f.kd === 'blizzard' ? '#9fe8ff' : '#ffb057', w: 6 });
          burst(f.x, f.y, 34, f.kd === 'blizzard' ? '#bfefff' : '#ff8f3c', 340, 0.8, 5);
          if (near(f.x, f.y, 620)) shake(f.kd === 'blizzard' ? 4 : 9);
          break;
        case 'nova':
          rings.push({ x: f.x, y: f.y, r: 8, to: f.r, life: 0.45, max: 0.45, c: f.c || '#9fe8ff', w: 5 });
          burst(f.x, f.y, 26, '#cbefff', 260, 0.6, 4);
          break;
        case 'chain':
          bolts.push({ pts: f.pts, life: 0.28, max: 0.28, c: f.c || '#ffe66d' });
          if (near(f.pts[0][0], f.pts[0][1], 700)) shake(3);
          break;
        case 'death':
          burst(f.x, f.y, 46, f.c || '#ff6b6b', 300, 1.1, 5.5);
          rings.push({ x: f.x, y: f.y, r: 8, to: 130, life: 0.6, max: 0.6, c: f.c || '#ff6b6b', w: 4 });
          break;
        case 'spawn':
          rings.push({ x: f.x, y: f.y, r: 90, to: 12, life: 0.5, max: 0.5, c: '#cbb6ff', w: 3 });
          break;
        case 'dash':
          burst(f.x, f.y, 14, '#dcd0ff', 150, 0.4, 3);
          break;
        case 'buff':
          rings.push({ x: f.x, y: f.y, r: 10, to: 90, life: 0.5, max: 0.5, c: f.c || '#c08bff', w: 4 });
          break;
        case 'shield':
          burst(f.x, f.y, 8, '#8fd8ff', 120, 0.35, 3);
          break;
        case 'cast':
          burst(f.x, f.y, 12, f.c || '#ffd166', 130, 0.35, 3);
          break;
        case 'pick':
          rings.push({ x: f.x, y: f.y, r: 6, to: 46, life: 0.4, max: 0.4, c: f.kd === 'hp' ? '#7dffb0' : '#7fe0ff', w: 3 });
          break;
        case 'dmg':
          floaters.push({
            x: f.x + rand(-8, 8), y: f.y, v: f.v, life: 0.9, max: 0.9,
            mine: f.o === selfId,
          });
          break;
      }
    }
  }

  function near(x, y, r) {
    const dx = x - cam.x, dy = y - cam.y;
    return dx * dx + dy * dy < r * r;
  }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].life -= dt;
      if (rings[i].life <= 0) rings.splice(i, 1);
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].life -= dt;
      if (bolts[i].life <= 0) bolts.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y -= dt * 34;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    if (particles.length > 900) particles.splice(0, particles.length - 900);
  }

  // ── основной кадр ─────────────────────────────────────────
  function draw(frame, self, roster, selfId, dt) {
    time += dt;
    if (!ctx) return;
    if (cfg && !floor) buildFloor();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07040e';
    ctx.fillRect(0, 0, W, H);
    if (!cfg || !frame) return;

    updateFx(dt);

    // пол
    const o = w2s(0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(floor.canvas, o.x, o.y, cfg.world.w * cam.scale, cfg.world.h * cam.scale);
    ctx.restore();

    drawPickups(frame.pickups);
    drawGrounds(frame.grounds);
    drawObstacles();
    drawRings();
    drawProjectiles(frame.projectiles, dt);
    drawParticles();
    drawPlayers(frame.players, self, roster, selfId);
    drawBolts();
    drawFloaters();
    drawSticks();
  }

  function drawObstacles() {
    for (const ob of cfg.obstacles) {
      const p = w2s(ob.x, ob.y);
      const r = ob.r * cam.scale;
      if (p.x < -r * 2 || p.y < -r * 2 || p.x > W + r * 2 || p.y > H + r * 2) continue;

      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.22, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();

      const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.15, p.x, p.y, r);
      g.addColorStop(0, '#5b5170');
      g.addColorStop(0.55, '#3a3350');
      g.addColorStop(1, '#221d33');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(170,140,255,.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawPickups(list) {
    for (const pk of list) {
      if (!pk.on) continue;
      const p = w2s(pk.x, pk.y);
      const r = cfg.pickupR * cam.scale;
      const pulse = 1 + Math.sin(time * 3 + pk.id) * 0.14;
      const col = pk.kind === 0 ? '#57e08a' : '#5ec8ff';
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y + Math.sin(time * 2 + pk.id) * 3, r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGrounds(list) {
    for (const g of list) {
      const p = w2s(g.x, g.y);
      const r = g.r * cam.scale;
      const ice = g.kind === 1;
      const col = ice ? '#7fdcff' : '#ff8f3c';
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.2 * Math.sin(time * 12);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // заполняющийся сектор — таймер удара
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * g.p);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawProjectiles(list, dt) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let tr = trails.get(b.id);
      if (!tr) { tr = []; trails.set(b.id, tr); }
      tr.push({ x: b.x, y: b.y });
      if (tr.length > 7) tr.shift();

      const col = KIND_COLOR[b.kind] || '#fff';
      const core = KIND_CORE[b.kind] || '#fff';
      const p = w2s(b.x, b.y);
      const r = Math.max(2.5, b.r * cam.scale);

      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const a = w2s(tr[i - 1].x, tr[i - 1].y), c = w2s(tr[i].x, tr[i].y);
        ctx.globalAlpha = (i / tr.length) * 0.5;
        ctx.strokeStyle = col;
        ctx.lineWidth = r * 1.5 * (i / tr.length);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const id of trails.keys()) if (!seen.has(id)) trails.delete(id);
  }

  function drawRings() {
    for (const r of rings) {
      const t = 1 - r.life / r.max;
      const rad = (r.r + (r.to - r.r) * t) * cam.scale;
      const p = w2s(r.x, r.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.85;
      ctx.strokeStyle = r.c || '#fff';
      ctx.lineWidth = (r.w || 3) * cam.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, rad), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      const s = w2s(p.x, p.y);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.6, p.size * cam.scale * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBolts() {
    for (const b of bolts) {
      const a = b.life / b.max;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = b.c;
      ctx.shadowColor = b.c;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3.5 * cam.scale;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < b.pts.length - 1; i++) {
        const p1 = w2s(b.pts[i][0], b.pts[i][1]);
        const p2 = w2s(b.pts[i + 1][0], b.pts[i + 1][1]);
        ctx.moveTo(p1.x, p1.y);
        const segs = 5;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const jitter = s === segs ? 0 : rand(-9, 9);
          ctx.lineTo(
            p1.x + (p2.x - p1.x) * t + jitter,
            p1.y + (p2.y - p1.y) * t + jitter,
          );
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(15 * Math.max(0.8, cam.scale))}px system-ui, sans-serif`;
    for (const f of floaters) {
      const p = w2s(f.x, f.y);
      const a = Math.min(1, f.life / f.max * 1.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.mine ? '#ffe066' : '#ff7b7b';
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.lineWidth = 3;
      const txt = `-${f.v}`;
      ctx.strokeText(txt, p.x, p.y);
      ctx.fillText(txt, p.x, p.y);
    }
    ctx.restore();
  }

  // ── маги ──────────────────────────────────────────────────
  function drawPlayers(players, self, roster, selfId) {
    const list = [...players.values()].sort((a, b) => a.y - b.y);
    for (const pl of list) {
      const info = roster.get(pl.id) || { name: '???', cls: 'pyro', bot: false };
      const cls = cfg.classes[info.cls] || cfg.classes.pyro;
      const isSelf = pl.id === selfId;
      const wx = isSelf && self ? self.x : pl.x;
      const wy = isSelf && self ? self.y : pl.y;
      const p = w2s(wx, wy);
      const r = cfg.player.r * 1.3 * cam.scale; // спрайт чуть крупнее хитбокса — так читаемее

      if (p.x < -80 || p.y < -80 || p.x > W + 80 || p.y > H + 80) continue;

      if (!pl.alive) { drawGhost(p, r, cls); continue; }

      const bob = Math.sin(time * 4 + pl.id) * 1.6 * cam.scale;

      // тень
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.85, r * 0.9, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();

      // аура статусов
      if (pl.bits & 4) auraRing(p, r * 1.5, '#c08bff', 0.6);
      if (pl.bits & 1) auraRing(p, r * 1.32, '#7fdcff', 0.5);
      if (pl.bits & 8) auraRing(p, r * 1.6, '#ffffff', 0.35);
      if (pl.bits & 2) auraRing(p, r * 1.42, '#8fd8ff', 0.85);

      ctx.save();
      ctx.translate(p.x, p.y + bob);

      // посох по направлению прицела
      const ax = Math.cos(pl.aim), ay = Math.sin(pl.aim);
      ctx.strokeStyle = '#8b6b4a';
      ctx.lineWidth = 3 * cam.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax * r * 0.2, ay * r * 0.2);
      ctx.lineTo(ax * r * 1.5, ay * r * 1.5);
      ctx.stroke();
      ctx.fillStyle = cls.color2;
      ctx.shadowColor = cls.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ax * r * 1.6, ay * r * 1.6, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // мантия
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, cls.color);
      g.addColorStop(1, shade(cls.color, -0.45));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, r * 0.95);
      ctx.quadraticCurveTo(0, r * 0.2, r * 0.95, r * 0.95);
      ctx.lineTo(r * 0.7, r * 1.0);
      ctx.lineTo(-r * 0.7, r * 1.0);
      ctx.closePath();
      ctx.fill();

      // тело
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.fill();

      // лицо-капюшон
      ctx.fillStyle = 'rgba(12,8,22,.9)';
      ctx.beginPath();
      ctx.arc(ax * r * 0.16, ay * r * 0.16, r * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cls.color2;
      ctx.beginPath();
      ctx.arc(ax * r * 0.3 - ay * r * 0.16, ay * r * 0.3 + ax * r * 0.16, r * 0.11, 0, Math.PI * 2);
      ctx.arc(ax * r * 0.3 + ay * r * 0.16, ay * r * 0.3 - ax * r * 0.16, r * 0.11, 0, Math.PI * 2);
      ctx.fill();

      // шляпа
      ctx.fillStyle = shade(cls.color, -0.25);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.62, r * 1.0, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.62);
      ctx.quadraticCurveTo(-r * 0.1, -r * 2.1, r * 0.62, -r * 0.68);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = cls.color2;
      ctx.beginPath();
      ctx.arc(r * 0.02, -r * 1.55, r * 0.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // кольцо своего мага
      if (isSelf) {
        ctx.strokeStyle = 'rgba(255,209,102,.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.75, time * 1.2 % (Math.PI * 2), time * 1.2 % (Math.PI * 2) + Math.PI * 1.7);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      drawNameplate(p, r, pl, info, isSelf);
    }
  }

  function drawGhost(p, r, cls) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = cls.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function auraRing(p, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha * (0.65 + 0.35 * Math.sin(time * 6));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawNameplate(p, r, pl, info, isSelf) {
    const y = p.y - r * 2.3;
    const w = 46 * cam.scale;
    const h = 5 * cam.scale;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(11 * Math.max(0.85, cam.scale))}px system-ui, sans-serif`;
    ctx.fillStyle = isSelf ? '#ffd166' : 'rgba(240,235,255,.9)';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 3;
    const label = info.bot ? `${info.name} ⚙` : info.name;
    ctx.strokeText(label, p.x, y - 6);
    ctx.fillText(label, p.x, y - 6);

    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(p.x - w / 2, y, w, h);
    const frac = clamp(pl.hp / pl.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#57e08a' : frac > 0.25 ? '#ffd166' : '#ff5d73';
    ctx.fillRect(p.x - w / 2, y, w * frac, h);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - w / 2, y, w, h);
    ctx.restore();
  }

  // ── стики ─────────────────────────────────────────────────
  function drawSticks() {
    const st = Input.state;
    for (const s of [st.left, st.right]) {
      if (!s.active) continue;
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#e6dcff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.ox, s.oy, Input.RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#cdbcff';
      ctx.beginPath();
      ctx.arc(s.ox + s.x, s.oy + s.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── миникарта ─────────────────────────────────────────────
  function drawMinimap(el, frame, selfId, roster) {
    if (!el || !cfg || !frame) return;
    const c = el.getContext('2d');
    const w = el.width = el.clientWidth * dpr;
    const h = el.height = el.clientHeight * dpr;
    if (!w || !h) return;
    const sx = w / cfg.world.w, sy = h / cfg.world.h;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(10,6,20,.6)';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(140,120,200,.35)';
    for (const ob of cfg.obstacles) {
      c.beginPath();
      c.arc(ob.x * sx, ob.y * sy, ob.r * sx, 0, Math.PI * 2);
      c.fill();
    }
    for (const pl of frame.players.values()) {
      if (!pl.alive) continue;
      const info = roster.get(pl.id);
      const cls = cfg.classes[info ? info.cls : 'pyro'];
      c.fillStyle = pl.id === selfId ? '#ffd166' : cls.color;
      c.beginPath();
      c.arc(pl.x * sx, pl.y * sy, pl.id === selfId ? 4 * dpr : 3 * dpr, 0, Math.PI * 2);
      c.fill();
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = amt < 0 ? 1 + amt : 1;
    const add = amt > 0 ? 255 * amt : 0;
    r = Math.round(r * f + add); g = Math.round(g * f + add); b = Math.round(b * f + add);
    return `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)})`;
  }

  return { init, resize, setConfig, draw, follow, pushFx, shake, w2s, drawMinimap, cam };
})();
