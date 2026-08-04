/* Интерфейс: лобби, HUD, таблица, меню, итоги матча. */
window.UI = (() => {
  const $ = (s) => document.querySelector(s);
  const el = {
    lobby: $('#lobby'), hud: $('#hud'), status: $('#status'), nick: $('#nick'),
    classList: $('#class-list'), play: $('#play'), online: $('#online-info'),
    timer: $('#timer'), ping: $('#ping'), leaders: $('#leaders'), feed: $('#feed'),
    barHp: $('#bar-hp'), barMp: $('#bar-mp'), hpText: $('#hp-text'), mpText: $('#mp-text'),
    dead: $('#dead'), respawnT: $('#respawn-t'),
    scoreboard: $('#scoreboard'), scoreRows: $('#score-rows'),
    menu: $('#menu'), menuClasses: $('#menu-classes'),
    results: $('#results'), resultsRows: $('#results-rows'),
    minimap: $('#minimap'),
  };

  const CLASS_EMOJI = { pyro: '🔥', cryo: '❄️', storm: '⚡' };

  const settings = Object.assign(
    { sound: true, shake: true, autoaim: true, lefty: false, nick: '', cls: 'pyro' },
    JSON.parse(localStorage.getItem('ww2d') || '{}'),
  );
  const save = () => localStorage.setItem('ww2d', JSON.stringify(settings));

  let cfg = null;
  let hooks = {};
  let selfId = 0;
  const feedSeen = [];

  // ── лобби ─────────────────────────────────────────────────
  function buildClassCards(config) {
    cfg = config;
    el.classList.innerHTML = '';
    const desc = document.createElement('div');
    desc.className = 'cls-desc';

    Object.values(cfg.classes).forEach((c) => {
      const b = document.createElement('div');
      b.className = 'cls' + (settings.cls === c.id ? ' on' : '');
      b.dataset.cls = c.id;
      b.innerHTML = `<span class="em">${CLASS_EMOJI[c.id] || '✨'}</span>
        <div class="nm">${c.name}</div><div class="tg">${c.tag}</div>`;
      b.onclick = () => {
        settings.cls = c.id;
        save();
        Sfx.play('ui');
        [...el.classList.children].forEach((x) => x.classList.toggle('on', x.dataset.cls === c.id));
        renderDesc(desc);
      };
      el.classList.appendChild(b);
    });
    el.classList.after(desc);
    renderDesc(desc);
    buildMenuClasses();
  }

  function renderDesc(node) {
    const c = cfg.classes[settings.cls];
    if (!c) return;
    node.innerHTML = `<b>${c.name}</b> · ${c.desc}<br>` +
      c.abilities.map((a) => `${a.icon} ${a.name}`).join(' · ');
  }

  function buildMenuClasses() {
    el.menuClasses.innerHTML = '';
    Object.values(cfg.classes).forEach((c) => {
      const b = document.createElement('button');
      b.textContent = `${CLASS_EMOJI[c.id]} ${c.name}`;
      b.className = settings.cls === c.id ? 'on' : '';
      b.onclick = () => {
        settings.cls = c.id;
        save();
        [...el.menuClasses.children].forEach((x, i) => {
          x.classList.toggle('on', Object.values(cfg.classes)[i].id === c.id);
        });
        hooks.onClassChange && hooks.onClassChange(c.id);
        setSkillIcons(c.id);
      };
      el.menuClasses.appendChild(b);
    });
  }

  function setStatus(text, kind = '') {
    el.status.textContent = text;
    el.status.className = 'status ' + kind;
  }

  function showLobby() {
    el.lobby.classList.remove('hidden');
    el.lobby.style.display = '';
    el.hud.classList.add('hidden');
    el.results.classList.add('hidden');
    el.dead.classList.add('hidden');
    el.menu.classList.add('hidden');
    el.scoreboard.classList.add('hidden');
  }

  function showGame() {
    el.lobby.style.display = 'none';
    el.hud.classList.remove('hidden');
  }

  // ── HUD ───────────────────────────────────────────────────
  function setSkillIcons(clsId) {
    if (!cfg) return;
    const c = cfg.classes[clsId];
    if (!c) return;
    c.abilities.forEach((a, i) => {
      const b = document.querySelector(`.skill.s${i}`);
      if (!b) return;
      b.querySelector('.ico').textContent = a.icon;
      b.querySelector('small').textContent = a.name;
    });
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateHud({ self, roster, tl, cds, mana, latency }) {
    if (self) {
      const hp = Math.max(0, self.hp) / self.maxHp;
      el.barHp.style.transform = `scaleX(${hp})`;
      el.hpText.textContent = Math.ceil(Math.max(0, self.hp));
      const mp = mana / cfg.player.mana;
      el.barMp.style.transform = `scaleX(${mp})`;
      el.mpText.textContent = Math.floor(mana);
    }
    el.timer.textContent = fmtTime(tl);
    el.ping.textContent = `${latency} мс`;

    // кулдауны
    for (let i = 0; i <= 3; i++) {
      const b = document.querySelector(`.skill.s${i}`) || (i === 3 ? document.querySelector('.skill.dash') : null);
      if (!b) continue;
      const left = cds[i] || 0;
      b.classList.toggle('cooling', left > 0.05);
      b.querySelector('.cd').textContent = left > 0.05 ? left.toFixed(left < 1 ? 1 : 0) : '';
      const cost = i === 3 ? cfg.dash.mana : cfg.classes[settings.cls].abilities[i].mana;
      b.classList.toggle('nomana', mana < cost);
    }

    // лидеры
    const top = [...roster.values()].sort((a, b) => b.k - a.k).slice(0, 3);
    el.leaders.innerHTML = top.map((p) => `<span class="l${p.id === selfId ? ' me' : ''}">${
      escapeHtml(p.name)} <b>${p.k}</b></span>`).join('');
  }

  function setDead(show, t) {
    el.dead.classList.toggle('hidden', !show);
    if (show) el.respawnT.textContent = (t || 0).toFixed(1);
  }

  function pushFeed(events) {
    for (const e of events) {
      const d = document.createElement('div');
      if (e.s === 'newmatch') {
        d.innerHTML = '<b>Новый матч!</b>';
      } else if (e.a) {
        const streak = e.st >= 3 ? ` 🔥×${e.st}` : '';
        d.innerHTML = `<b>${escapeHtml(e.a)}</b> ➜ <span class="v">${escapeHtml(e.v)}</span>${streak}`;
      } else {
        d.innerHTML = `<span class="v">${escapeHtml(e.v)}</span> пал`;
      }
      el.feed.appendChild(d);
      feedSeen.push(d);
      setTimeout(() => d.remove(), 6000);
      while (el.feed.children.length > 5) el.feed.firstChild.remove();
    }
  }

  function updateScoreboard(roster) {
    const list = [...roster.values()].sort((a, b) => b.k - a.k || a.d - b.d);
    const rows = list.map((p, i) => {
      const cls = cfg.classes[p.cls] || cfg.classes.pyro;
      return `<div class="score-row${p.id === selfId ? ' me' : ''}">
        <span>${i + 1}</span>
        <span class="nm"><i class="dot" style="background:${cls.color}"></i>${escapeHtml(p.name)}${
        p.bot ? '<i class="bot">БОТ</i>' : ''}</span>
        <span>${p.k}</span><span>${p.d}</span><span>${p.best}</span>
      </div>`;
    }).join('');
    el.scoreRows.innerHTML = rows;
    return list;
  }

  function showResults(roster) {
    const list = updateScoreboard(roster);
    el.resultsRows.innerHTML =
      '<div class="score-head"><span>#</span><span>Маг</span><span>К</span><span>С</span><span>Серия</span></div>' +
      el.scoreRows.innerHTML;
    el.results.classList.remove('hidden');
    if (list[0] && list[0].id === selfId) Sfx.play('win');
  }

  function hideResults() { el.results.classList.add('hidden'); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── инициализация ─────────────────────────────────────────
  function init(h) {
    hooks = h;
    el.nick.value = settings.nick || '';
    $('#opt-sound').checked = settings.sound;
    $('#opt-shake').checked = settings.shake;
    $('#opt-aim').checked = settings.autoaim;
    $('#opt-left').checked = settings.lefty;
    Sfx.enabled = settings.sound;

    el.play.onclick = () => {
      settings.nick = el.nick.value.trim().slice(0, 14);
      save();
      Sfx.resume();
      Sfx.play('ui');
      hooks.onPlay && hooks.onPlay(settings.nick || 'Маг', settings.cls);
    };
    el.nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.play.click(); });

    $('#btn-score').onclick = () => {
      el.scoreboard.classList.toggle('hidden');
      if (!el.scoreboard.classList.contains('hidden')) updateScoreboard(Net.state.roster);
      Sfx.play('ui');
    };
    $('#score-close').onclick = () => el.scoreboard.classList.add('hidden');
    $('#btn-menu').onclick = () => { el.menu.classList.toggle('hidden'); Sfx.play('ui'); };
    $('#menu-close').onclick = () => el.menu.classList.add('hidden');
    $('#menu-exit').onclick = () => { el.menu.classList.add('hidden'); hooks.onExit && hooks.onExit(); };

    $('#opt-sound').onchange = (e) => { settings.sound = e.target.checked; Sfx.enabled = settings.sound; save(); };
    $('#opt-shake').onchange = (e) => { settings.shake = e.target.checked; save(); };
    $('#opt-aim').onchange = (e) => { settings.autoaim = e.target.checked; save(); };
    $('#opt-left').onchange = (e) => { settings.lefty = e.target.checked; Input.lefty = settings.lefty; save(); };
    Input.lefty = settings.lefty;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        el.scoreboard.classList.toggle('hidden');
        if (!el.scoreboard.classList.contains('hidden')) updateScoreboard(Net.state.roster);
      }
      if (e.code === 'Escape') el.menu.classList.toggle('hidden');
    });

    // счётчик онлайна в лобби
    const poll = () => fetch('/api/stats').then((r) => r.json()).then((s) => {
      el.online.textContent = `Сейчас в бою: ${s.players} игрок(ов) · ${s.bots} духов · комнат: ${s.rooms.length}`;
    }).catch(() => {});
    poll();
    setInterval(() => { if (!el.lobby.classList.contains('hidden') && el.lobby.style.display !== 'none') poll(); }, 5000);
  }

  return {
    init, buildClassCards, setStatus, showLobby, showGame, updateHud, setDead,
    pushFeed, updateScoreboard, showResults, hideResults, setSkillIcons,
    settings, save, el,
    set selfId(v) { selfId = v; },
    get selfId() { return selfId; },
  };
})();
