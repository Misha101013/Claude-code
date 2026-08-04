/* Точка входа: связывает сеть, ввод, предсказание движения и рендер. */
(() => {
  const canvas = document.getElementById('game');
  const SEND_HZ = 20;
  const FIRE_MS = 100;

  const game = {
    cfg: null,
    running: false,
    self: { x: 0, y: 0 },      // локальное предсказание своей позиции
    aim: 0,
    cds: [0, 0, 0, 0],
    mana: 100,
    lastHp: 0,
    lastSend: 0,
    lastFire: 0,
    lastHudAt: 0,
    matchState: 'play',
    wakeLock: null,
  };

  // ── подготовка ────────────────────────────────────────────
  Renderer.init(canvas);
  Input.init(canvas, { onCast: (slot) => tryCast(slot) });

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      game.cfg = cfg;
      UI.buildClassCards(cfg);
      UI.setSkillIcons(UI.settings.cls);
      UI.setStatus('Готово. Выбирайте школу магии и в бой!', 'ok');
    })
    .catch(() => UI.setStatus('Сервер недоступен. Обновите страницу.', 'err'));

  UI.init({
    onPlay: (name, cls) => startGame(name, cls),
    onExit: () => leaveGame(),
    onClassChange: (cls) => { Net.setClass(cls); game.cds = [0, 0, 0, 0]; },
  });

  // ── сетевые события ───────────────────────────────────────
  Net.on('welcome', (m) => {
    game.cfg = m.cfg;
    Renderer.setConfig(m.cfg);
    UI.selfId = m.id;
    UI.setSkillIcons(UI.settings.cls);
    UI.showGame();
    UI.setStatus('В бою', 'ok');
    game.running = true;
    game.cds = [0, 0, 0, 0];
  });

  Net.on('roster', () => {
    if (!document.getElementById('scoreboard').classList.contains('hidden')) {
      UI.updateScoreboard(Net.state.roster);
    }
  });

  Net.on('snapshot', (m) => {
    const self = m.p.find((a) => a[0] === Net.id);
    Renderer.pushFx(m.fx, Net.id);
    playFxSounds(m.fx);
    if (m.f && m.f.length) {
      UI.pushFeed(m.f);
      for (const e of m.f) {
        const meKiller = e.a && Net.state.roster.get(Net.id) && e.a === Net.state.roster.get(Net.id).name;
        Sfx.play(meKiller ? 'kill' : 'death');
      }
    }
    if (self) {
      const hp = self[4];
      if (game.lastHp && hp < game.lastHp) {
        Sfx.play('hurt');
        if (UI.settings.shake) Renderer.shake(Math.min(9, (game.lastHp - hp) * 0.35));
        if (navigator.vibrate) navigator.vibrate(25);
      }
      game.lastHp = hp;
      game.mana = self[6];
    }
    // конец матча / новый матч
    if (m.st !== game.matchState) {
      game.matchState = m.st;
      if (m.st === 'end') UI.showResults(Net.state.roster);
      else UI.hideResults();
    }
  });

  Net.on('status', (s) => {
    if (s.kind === 'close') UI.setStatus('Соединение потеряно, переподключаемся…', 'err');
    if (s.kind === 'open') UI.setStatus('В бою', 'ok');
  });

  // ── управление сессией ────────────────────────────────────
  function startGame(name, cls) {
    UI.setStatus('Подключение к арене…');
    Net.connect(name, cls);
    requestFullscreen();
    keepAwake();
  }

  function leaveGame() {
    Net.close();
    game.running = false;
    game.matchState = 'play';
    UI.showLobby();
    UI.setStatus('Вы вышли в лобби', '');
    if (game.wakeLock) { try { game.wakeLock.release(); } catch { /* ignore */ } game.wakeLock = null; }
  }

  function requestFullscreen() {
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) {
      d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) game.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* не критично */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && game.running && !game.wakeLock) keepAwake();
  });

  // ── заклинания ────────────────────────────────────────────
  function tryCast(slot) {
    if (!game.running || !game.cfg) return;
    const frame = Net.view();
    const me = frame && frame.players.get(Net.id);
    if (!me || !me.alive) return;
    if (game.cds[slot] > 0) return;

    const cls = game.cfg.classes[UI.settings.cls];
    const cost = slot === 3 ? game.cfg.dash.mana : cls.abilities[slot].mana;
    if (game.mana < cost) return;

    const buffed = (me.bits & 4) !== 0;
    const cdMul = buffed ? (cls.abilities[2].cdMul || 1) : 1;
    const base = slot === 3 ? game.cfg.dash.cd : cls.abilities[slot].cd;
    game.cds[slot] = base * (slot === 3 ? 1 : cdMul);
    game.mana -= cost; // мгновенный отклик, снапшот поправит
    Net.cast(slot, game.aim);

    const kinds = ['fire', 'ice', 'bolt'];
    if (slot === 3) Sfx.play('dash');
    else if (cls.abilities[slot].type === 'nova') Sfx.play('nova');
    else if (cls.abilities[slot].type === 'chain') Sfx.play('chain');
    else if (cls.abilities[slot].proj) Sfx.play(cls.abilities[slot].proj.kind);
    else Sfx.play(kinds[0]);
  }

  function playFxSounds(fx) {
    for (const f of fx) {
      if (!nearMe(f.x, f.y, 900)) continue;
      if (f.k === 'boom') Sfx.play('boom');
      else if (f.k === 'pick') Sfx.play('pick');
      else if (f.k === 'spawn') Sfx.play('spawn');
      else if (f.k === 'hit' && f.r) Sfx.play('hit');
    }
  }

  function nearMe(x, y, r) {
    if (x === undefined) return true;
    const dx = x - game.self.x, dy = y - game.self.y;
    return dx * dx + dy * dy < r * r;
  }

  // ── автоприцел ────────────────────────────────────────────
  function autoAim(frame, aim) {
    if (!UI.settings.autoaim || !frame) return aim;
    let best = null, bestScore = Infinity;
    for (const p of frame.players.values()) {
      if (p.id === Net.id || !p.alive) continue;
      const dx = p.x - game.self.x, dy = p.y - game.self.y;
      const d = Math.hypot(dx, dy);
      if (d > 700) continue;
      let diff = Math.abs(angleDiff(Math.atan2(dy, dx), aim));
      if (diff > 0.42) continue;               // помогаем только «примерно в сторону цели»
      const score = diff * 400 + d * 0.25;
      if (score < bestScore) { bestScore = score; best = { dx, dy }; }
    }
    if (!best) return aim;
    const target = Math.atan2(best.dy, best.dx);
    return aim + angleDiff(target, aim) * 0.55;  // мягкое доворачивание
  }

  function angleDiff(a, b) {
    let d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ── предсказание своего движения ──────────────────────────
  function predict(me, mv, dt) {
    const cfg = game.cfg;
    const cls = cfg.classes[UI.settings.cls];
    let speed = cls.speed;
    if (me.bits & 1) speed *= 0.5;                       // замедление
    if (me.bits & 4) speed *= (cls.abilities[2].speedMul || 1);
    if (me.bits & 16) speed = cfg.dash.dist / cfg.dash.time; // рывок ведёт сервер

    if (!(me.bits & 16)) {
      game.self.x += mv.x * speed * dt;
      game.self.y += mv.y * speed * dt;
    }

    // столкновения — та же логика, что на сервере
    const R = cfg.player.r;
    for (const o of cfg.obstacles) {
      const dx = game.self.x - o.x, dy = game.self.y - o.y;
      const rr = o.r + R;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.0001;
        game.self.x = o.x + (dx / d) * rr;
        game.self.y = o.y + (dy / d) * rr;
      }
    }
    game.self.x = Math.max(R, Math.min(cfg.world.w - R, game.self.x));
    game.self.y = Math.max(R, Math.min(cfg.world.h - R, game.self.y));

    // сверка с сервером
    const ex = me.x - game.self.x, ey = me.y - game.self.y;
    const err = Math.hypot(ex, ey);
    if (err > 140 || !me.alive) {
      game.self.x = me.x; game.self.y = me.y;
    } else {
      const k = Math.min(1, dt * (err > 40 ? 12 : 6));
      game.self.x += ex * k;
      game.self.y += ey * k;
    }
  }

  // ── игровой цикл ──────────────────────────────────────────
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    for (let i = 0; i < 4; i++) game.cds[i] = Math.max(0, game.cds[i] - dt);
    if (game.cfg) game.mana = Math.min(game.cfg.player.mana, game.mana + game.cfg.player.manaRegen * dt);

    const frame = game.running ? Net.view() : null;
    if (!frame || !game.cfg) { Renderer.draw(null, null, new Map(), 0, dt); return; }

    const me = frame.players.get(Net.id);
    const mv = Input.moveVector();

    if (me) {
      if (!game.self.x && !game.self.y) { game.self.x = me.x; game.self.y = me.y; }
      predict(me, mv, dt);

      const selfScreen = Renderer.w2s(game.self.x, game.self.y);
      let aim = Input.aim(selfScreen, game.aim);
      aim = autoAim(frame, aim);
      game.aim = aim;

      // отправка ввода
      if (now - game.lastSend > 1000 / SEND_HZ) {
        game.lastSend = now;
        Net.input(mv.x, mv.y, aim);
      }
      // автоатака при удержании стика/кнопки мыши
      if (Input.firing && now - game.lastFire > FIRE_MS) {
        game.lastFire = now;
        tryCast(0);
      }

      UI.setDead(!me.alive && frame.st === 'play', me.resp);
    }

    Renderer.follow(game.self.x, game.self.y, dt);
    Renderer.draw(frame, game.self, Net.state.roster, Net.id, dt);

    if (now - game.lastHudAt > 90) {
      game.lastHudAt = now;
      UI.updateHud({
        self: me, roster: Net.state.roster, tl: frame.tl,
        cds: game.cds, mana: game.mana, latency: Net.latency,
      });
      Renderer.drawMinimap(UI.el.minimap, frame, Net.id, Net.state.roster);
    }
  }
  requestAnimationFrame(loop);
})();
