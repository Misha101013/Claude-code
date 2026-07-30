import { Game } from './game.js';
import {
  PaintEngine, BRUSHES, drawSpriteOnCanvas, isPointInCharacter, spriteRect,
} from './paint-engine.js';
import { CHARACTERS } from './shapes.js';
import { AVATAR_COLORS } from './palette-data.js';
import { DEMO_SCENES, paintDemoScene, demoSceneDataUrl } from './demo-scenes.js';
import { IbisColorWheel } from './color-wheel.js';
import { ZoomController } from './zoom.js';
import { blendLabel } from './blend.js';
import {
  MATCH_FIELDS, MATCH_DEFAULTS, matchSettings, playerSettings,
  saveMatchSettings, savePlayerSettings, tapsForHiderCount,
} from './settings.js';
import { sfx, setSoundEnabled, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const game = new Game();
window.__game = game; // debug hook

let selectedPhotoUrl = null;
let engine = null;
let colorWheel = null;
let previousScreen = 'screen-menu';

let hideTimerHandle = null;
let hideDeadline = 0;
let hideSubmitted = false;
let lastTickSecond = -1;

let seekTimerHandle = null;
let seekDeadline = 0;
let seekZoom = null;
let seekTapStart = null;
let seekCtx = null;
let seekImage = null;
let seekSpriteImages = {};
let currentSeekSprites = [];
let seekFoundIds = new Set();
let amSeeker = false;

let currentRound = null;

if (!playerSettings.color) {
  playerSettings.color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  savePlayerSettings();
}
setSoundEnabled(playerSettings.sound);

function showScreen(id) {
  const active = document.querySelector('.screen--active');
  if (active && active.id !== id) previousScreen = active.id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('screen--active'));
  const target = $(id);
  target.classList.add('screen--active');
  document.body.classList.toggle('body--full', target.classList.contains('screen--full'));
}

// =====================================================================
// Menu
// =====================================================================

function renderCharacterPicker() {
  const wrap = $('character-picker');
  wrap.innerHTML = '';
  for (const ch of CHARACTERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'character-btn' + (ch.id === playerSettings.character ? ' is-selected' : '');
    btn.innerHTML = `<span>${ch.emoji}</span><span>${ch.label}</span>`;
    btn.addEventListener('click', () => {
      playerSettings.character = ch.id;
      savePlayerSettings();
      renderCharacterPicker();
      $('brand-mark').textContent = ch.emoji;
      sfx.tap();
    });
    wrap.appendChild(btn);
  }
}

function renderAvatarSwatches() {
  const wrap = $('avatar-swatches');
  wrap.innerHTML = '';
  for (const color of AVATAR_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-swatch' + (color === playerSettings.color ? ' is-selected' : '');
    b.style.background = color;
    b.addEventListener('click', () => {
      playerSettings.color = color;
      savePlayerSettings();
      renderAvatarSwatches();
      sfx.tap();
    });
    wrap.appendChild(b);
  }
}

$('input-nickname').value = playerSettings.name || '';
renderCharacterPicker();
renderAvatarSwatches();
$('brand-mark').textContent =
  (CHARACTERS.find((c) => c.id === playerSettings.character) || CHARACTERS[0]).emoji;

function currentProfile() {
  const name = $('input-nickname').value.trim() || 'Игрок';
  playerSettings.name = name;
  savePlayerSettings();
  return { name, color: playerSettings.color, character: playerSettings.character };
}

function setHomeError(msg) {
  const el = $('home-error');
  if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
}

$('btn-create-room').addEventListener('click', async () => {
  unlockAudio();
  setHomeError('');
  $('btn-create-room').disabled = true;
  try {
    const code = await game.createRoom(currentProfile());
    $('room-code-display').textContent = code;
    enterLobby();
  } catch (err) {
    setHomeError(err.message || 'Не удалось создать комнату.');
  } finally {
    $('btn-create-room').disabled = false;
  }
});

$('btn-join-room').addEventListener('click', async () => {
  unlockAudio();
  const code = $('input-room-code').value.trim();
  if (!code) { setHomeError('Введи код комнаты.'); return; }
  setHomeError('');
  $('btn-join-room').disabled = true;
  try {
    await game.joinRoom(code, currentProfile());
    $('room-code-display').textContent = game.net.roomCode;
    enterLobby();
  } catch (err) {
    setHomeError(err.message || 'Не удалось подключиться. Проверь код.');
  } finally {
    $('btn-join-room').disabled = false;
  }
});

$('btn-open-settings').addEventListener('click', () => { unlockAudio(); openSettings(); });
$('btn-open-help').addEventListener('click', () => showScreen('screen-help'));
$('btn-help-back').addEventListener('click', () => showScreen(previousScreen));

// =====================================================================
// Settings
// =====================================================================

let settingsReturnTo = 'screen-menu';

function openSettings(returnTo) {
  settingsReturnTo = returnTo || (document.querySelector('.screen--active') || {}).id || 'screen-menu';
  renderSettings();
  showScreen('screen-settings');
}

$('btn-settings-back').addEventListener('click', () => {
  saveMatchSettings();
  if (game.isHost) game.hostUpdateSettings(matchSettings);
  showScreen(settingsReturnTo);
  renderRulesSummary();
});

$('toggle-sound').addEventListener('click', () => {
  playerSettings.sound = !playerSettings.sound;
  savePlayerSettings();
  setSoundEnabled(playerSettings.sound);
  $('toggle-sound').setAttribute('aria-checked', String(playerSettings.sound));
  if (playerSettings.sound) { unlockAudio(); sfx.tap(); }
});

$('btn-reset-match-settings').addEventListener('click', () => {
  Object.assign(matchSettings, MATCH_DEFAULTS);
  saveMatchSettings();
  renderSettings();
  sfx.tap();
});

function renderSettings() {
  $('toggle-sound').setAttribute('aria-checked', String(playerSettings.sound));
  const list = $('match-settings-list');
  list.innerHTML = '';

  for (const field of MATCH_FIELDS) {
    const row = document.createElement('div');
    row.className = 'setting-row' + (field.type === 'toggle' ? ' setting-row--toggle' : '');

    if (field.type === 'toggle') {
      const text = document.createElement('div');
      text.innerHTML = `<div class="setting-row-label">${field.label}</div>` +
        (field.hint ? `<span class="setting-hint">${field.hint}</span>` : '');
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'switch';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(!!matchSettings[field.key]));
      sw.appendChild(document.createElement('span'));
      sw.addEventListener('click', () => {
        matchSettings[field.key] = !matchSettings[field.key];
        sw.setAttribute('aria-checked', String(matchSettings[field.key]));
        saveMatchSettings();
        sfx.tap();
      });
      row.append(text, sw);
    } else {
      const head = document.createElement('div');
      head.className = 'setting-row-head';
      const label = document.createElement('span');
      label.className = 'setting-row-label';
      label.textContent = field.label;
      const value = document.createElement('span');
      value.className = 'setting-row-value';
      value.textContent = field.format(matchSettings[field.key]);
      head.append(label, value);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = field.min; input.max = field.max; input.step = field.step;
      input.value = matchSettings[field.key];
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        matchSettings[field.key] = v;
        value.textContent = field.format(v);
      });
      input.addEventListener('change', () => saveMatchSettings());

      row.append(head, input);
      if (field.hint) {
        const hint = document.createElement('span');
        hint.className = 'setting-hint';
        hint.textContent = field.hint;
        row.appendChild(hint);
      }
    }
    list.appendChild(row);
  }
}

// =====================================================================
// Lobby
// =====================================================================

function enterLobby() {
  $('host-photo-block').hidden = !game.isHost;
  $('lobby-waiting-note').hidden = game.isHost;
  renderPlayers([...game.players.values()]);
  renderRulesSummary();
  updateRoundBadge();
  showScreen('screen-lobby');
}

function updateRoundBadge() {
  const badge = $('lobby-round-badge');
  if (game.match && game.match.totalRounds) {
    badge.hidden = false;
    badge.textContent = `Раунд ${Math.min(game.match.roundIndex + 1, game.match.totalRounds)} из ${game.match.totalRounds}`;
  } else {
    badge.hidden = true;
  }
}

function renderRulesSummary() {
  const s = game.settings;
  const players = game.players.size || 2;
  const hiders = Math.max(1, players - 1);
  const chips = [
    `⏱ прятки ${s.hideSeconds}с`,
    `🔎 поиск ${s.seekSeconds}с`,
    `🎯 попыток ${tapsForHiderCount(s, hiders)}`,
    `🔁 раундов ${s.rounds > 0 ? s.rounds : players}`,
  ];
  if (s.hints) chips.push('💡 подсказки');
  if (s.blendMeter) chips.push('📊 счётчик маскировки');
  if (s.autoFillHelper) chips.push('🪄 подсказка фона');
  $('lobby-rules').innerHTML = chips
    .map((c) => `<span class="rule-chip">${c}</span>`).join('');
}

function renderPlayers(players) {
  const ul = $('player-list');
  ul.innerHTML = '';
  $('player-count').textContent = String(players.length);
  for (const p of players) {
    const li = document.createElement('li');
    li.dataset.playerId = p.id;
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = p.color;
    const chr = document.createElement('span');
    chr.className = 'player-char';
    chr.textContent = (CHARACTERS.find((c) => c.id === p.character) || CHARACTERS[0]).emoji;
    const name = document.createElement('span');
    name.textContent = p.name + (p.isHost ? ' 👑' : '');
    li.append(dot, chr, name);
    if (p.totalScore) {
      const score = document.createElement('span');
      score.className = 'player-score';
      score.textContent = p.totalScore;
      li.appendChild(score);
    } else if (p.id === game.myId) {
      const tag = document.createElement('span');
      tag.className = 'player-tag player-tag--you';
      tag.textContent = 'ты';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  }
  $('btn-start-round').disabled = !(selectedPhotoUrl && players.length >= 2);
}

game.on('players-changed', (players) => {
  if ($('screen-lobby').classList.contains('screen--active')) {
    renderPlayers(players);
    renderRulesSummary();
  }
});
game.on('settings-changed', () => renderRulesSummary());
game.on('await-photo', () => { enterLobby(); });
game.on('fatal-error', (msg) => { alert(msg); location.reload(); });

// A dropped connection is retried silently a few times before it's
// treated as real (see net.js) — most blips never make it past this
// banner, and it's non-blocking so nothing on screen is interrupted.
game.on('host-reconnecting', () => { $('connection-banner').hidden = false; });
game.on('host-reconnected', () => { $('connection-banner').hidden = true; });

$('btn-copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(game.net.roomCode);
    $('btn-copy-code').textContent = 'Скопировано';
    setTimeout(() => { $('btn-copy-code').textContent = 'Скопировать'; }, 1500);
  } catch (_) {}
});

function leaveRoom() {
  game.leave();
  clearInterval(hideTimerHandle);
  clearInterval(seekTimerHandle);
  selectedPhotoUrl = null;
  showScreen('screen-menu');
}
$('btn-leave-lobby').addEventListener('click', leaveRoom);
$('btn-match-leave').addEventListener('click', leaveRoom);
$('btn-edit-rules').addEventListener('click', () => openSettings('screen-lobby'));

function setSelectedPhoto(url) {
  selectedPhotoUrl = url;
  $('photo-preview').src = url;
  $('photo-preview').hidden = false;
  $('btn-start-round').disabled = !(selectedPhotoUrl && game.players.size >= 2);
}

$('btn-upload-photo').addEventListener('click', () => $('input-photo-file').click());
$('input-photo-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // Downscale before it ever hits the wire: a full-res phone photo as
      // a data URL is megabytes, and it has to reach every player.
      const maxDim = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      setSelectedPhoto(c.toDataURL('image/jpeg', 0.85));
      document.querySelectorAll('.demo-scene-thumb').forEach((t) => t.classList.remove('is-selected'));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

(function renderDemoScenes() {
  const row = $('demo-scene-row');
  for (const scene of DEMO_SCENES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-scene-thumb';
    btn.title = scene.label;
    const c = document.createElement('canvas');
    c.width = 62; c.height = 62;
    paintDemoScene(c.getContext('2d'), 62, 62, scene.id);
    btn.appendChild(c);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.demo-scene-thumb').forEach((t) => t.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      setSelectedPhoto(demoSceneDataUrl(scene.id));
      sfx.tap();
    });
    row.appendChild(btn);
  }
})();

$('btn-start-round').addEventListener('click', () => {
  if (!selectedPhotoUrl) return;
  game.hostStartRound(selectedPhotoUrl);
});

// =====================================================================
// Hide phase
// =====================================================================

function ensureEngine() {
  if (!engine) {
    engine = new PaintEngine({
      wrapEl: $('canvas-wrap'),
      stageEl: $('canvas-stage'),
      photoCanvas: $('canvas-photo'),
      paintCanvas: $('canvas-paint'),
    });
    engine.onColorPicked = (hex) => setActiveColor(hex);
    engine.onBlendChange = (score) => updateBlendBadge(score);
    engine.onStrokeStart = () => { $('wheel-popover').hidden = true; };
    engine.onMagicUsed = (used) => {
      if (!used) return;
      $('tool-magic').disabled = true;
      $('hide-hint').textContent = 'Закрасься';
      sfx.tap();
    };
  }
  return engine;
}

function setActiveColor(hex) {
  engine.setColor(hex);
  $('wheel-swatch').style.background = hex;
  if (colorWheel) colorWheel.setColor(hex);
}

function updateBlendBadge(score) {
  if (!game.settings.blendMeter) return;
  $('blend-value').textContent = blendLabel(score);
  const pct = score == null ? 0 : Math.round(score * 100);
  const fill = $('blend-bar-fill');
  fill.style.width = pct + '%';
  fill.style.background = pct >= 75 ? 'var(--good)' : pct >= 55 ? 'var(--accent-3)' : 'var(--danger)';
}

function renderBrushRow() {
  const row = $('brush-row');
  row.innerHTML = '';
  BRUSHES.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brush-btn' + (i === 0 ? ' is-selected' : '');
    btn.textContent = b.label;
    btn.title = b.title;
    btn.addEventListener('click', () => {
      engine.setBrush(b.id);
      row.querySelectorAll('.brush-btn').forEach((x) => x.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      sfx.tap();
    });
    row.appendChild(btn);
  });
}
renderBrushRow();

$('brush-size').addEventListener('input', (e) => engine && engine.setSize(parseInt(e.target.value, 10)));
$('tool-undo').addEventListener('click', () => { if (engine) { engine.undo(); sfx.tap(); } });
$('tool-clear').addEventListener('click', () => { if (engine) { engine.clearToBase(); sfx.tap(); } });

$('tool-eyedropper').addEventListener('click', () => {
  if (!engine) return;
  // Sticky, like a real paint app: stays armed until switched off, so
  // sampling several colours doesn't mean re-tapping the tool each time.
  engine.eyedropperActive = !engine.eyedropperActive;
  $('tool-eyedropper').classList.toggle('is-selected', engine.eyedropperActive);
  $('hide-hint').textContent = engine.eyedropperActive ? 'Тапни по фото — возьму цвет' : 'Закрасься';
  $('wheel-popover').hidden = true;
  sfx.tap();
});

// Press and hold to see yourself exactly as the seeker will.
(function bindPeek() {
  const btn = $('tool-peek');
  const on = (e) => { e.preventDefault(); $('screen-hide').classList.add('screen--peeking'); };
  const off = () => $('screen-hide').classList.remove('screen--peeking');
  btn.addEventListener('pointerdown', on);
  window.addEventListener('pointerup', off);
  window.addEventListener('pointercancel', off);
})();

function ensureColorWheel() {
  if (!colorWheel) {
    colorWheel = new IbisColorWheel({
      wheelCanvas: $('wheel-canvas'),
      valueTrack: $('value-track'),
      valueThumb: $('value-thumb'),
      wheelDot: $('wheel-dot'),
      size: 170,
      onChange: (hex) => setActiveColor(hex),
    });
  }
  return colorWheel;
}

$('tool-wheel').addEventListener('click', () => {
  ensureColorWheel();
  $('wheel-popover').hidden = !$('wheel-popover').hidden;
  if (engine) engine.eyedropperActive = false;
  $('tool-eyedropper').classList.remove('is-selected');
});
$('wheel-close').addEventListener('click', () => { $('wheel-popover').hidden = true; });

$('tool-magic').addEventListener('click', () => {
  if (!engine || !engine.magicAvailable) return;
  engine.magicArmed = true;
  engine.eyedropperActive = false;
  $('tool-eyedropper').classList.remove('is-selected');
  $('wheel-popover').hidden = true;
  $('hide-hint').textContent = 'Тапни в трудном для закраски месте';
  sfx.tap();
});

$('hide-zoom-in').addEventListener('click', () => engine && engine.zoomer.zoomBy(1.4));
$('hide-zoom-out').addEventListener('click', () => engine && engine.zoomer.zoomBy(1 / 1.4));
$('hide-zoom-reset').addEventListener('click', () => engine && engine.zoomer.reset());

async function beginHidePhase(payload) {
  showScreen('screen-hide');
  hideSubmitted = false;
  lastTickSecond = -1;
  $('paint-toolbar').hidden = true;
  $('wheel-popover').hidden = true;
  $('btn-place-here').hidden = false;
  $('btn-hide-done').disabled = true;
  $('blend-badge').hidden = true;
  $('screen-hide').classList.remove('screen--peeking');
  $('hide-hint').textContent = 'Выбери место';
  $('hide-timer').classList.remove('is-urgent');

  const eng = ensureEngine();
  eng.setCharacter(playerSettings.character);
  eng.setCharScale(game.settings.charScale);
  eng.eyedropperActive = false;
  eng.magicHelperEnabled = !!game.settings.autoFillHelper;
  $('tool-eyedropper').classList.remove('is-selected');
  $('tool-magic').hidden = !eng.magicHelperEnabled;
  $('tool-magic').disabled = false;
  await eng.loadPhoto(payload.photoUrl);
  eng.beginPlacement();

  hideDeadline = Date.now() + payload.hideSeconds * 1000;
  clearInterval(hideTimerHandle);
  hideTimerHandle = setInterval(checkHideDeadline, 200);
  checkHideDeadline();
}

function checkHideDeadline() {
  const left = Math.max(0, Math.ceil((hideDeadline - Date.now()) / 1000));
  $('hide-timer').textContent = left;
  $('hide-timer').classList.toggle('is-urgent', left <= 5);
  if (left <= 5 && left > 0 && left !== lastTickSecond) {
    lastTickSecond = left;
    sfx.urgent();
  }
  if (left <= 0) {
    clearInterval(hideTimerHandle);
    hideTimerHandle = null;
    if (!hideSubmitted) submitHide();
  }
}

// Phones background mid-round constantly — that's half the point of a
// hiding phase. setInterval is throttled while hidden, so re-check the
// moment we're visible again rather than waiting for the next tick.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (hideTimerHandle) checkHideDeadline();
  if (seekTimerHandle) checkSeekDeadline();
});

$('btn-place-here').addEventListener('click', () => {
  if (!engine || engine.phase !== 'placing') return;
  engine.lockPlacement();
  $('btn-place-here').hidden = true;
  $('paint-toolbar').hidden = false;
  $('btn-hide-done').disabled = false;
  $('blend-badge').hidden = !game.settings.blendMeter;
  $('hide-hint').textContent = 'Закрасься';
  setActiveColor(engine.brush.color);
  sfx.place();
});

$('btn-hide-done').addEventListener('click', () => {
  if (!engine || engine.phase !== 'painting') return;
  submitHide();
});

function submitHide() {
  if (hideSubmitted || !engine) return;
  // If the round already moved on (a seek-start or round-end broadcast
  // arrived while this tab was backgrounded and its timer throttled), a
  // late auto-submit must not stomp the screen that event switched us
  // to — nothing would switch us back and the player would be stuck.
  if (game.phase !== 'hide') {
    hideSubmitted = true;
    clearInterval(hideTimerHandle);
    hideTimerHandle = null;
    return;
  }
  hideSubmitted = true;
  clearInterval(hideTimerHandle);
  hideTimerHandle = null;
  $('btn-hide-done').disabled = true;
  sfx.submitted();

  // Show the waiting screen BEFORE submitting: if this submission is the
  // one that completes the hide phase, submitSprite() can synchronously
  // drive us all the way into the seek phase, and that screen must be
  // the one left standing.
  const entries = (currentRound?.hiderIds || []).map((id) => ({ id, name: game.playerName(id) }));
  showWaitingScreen(entries, 'Ждём, пока все спрячутся…', 'Ты уже спрятался.');
  game.submitSprite(engine.exportSprite());
}

// =====================================================================
// Waiting screen
// =====================================================================

function showWaitingScreen(entries, title, sub) {
  $('waiting-title').textContent = title;
  $('waiting-sub').textContent = sub || '';
  const ul = $('waiting-list');
  ul.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    li.dataset.playerId = entry.id;
    li.innerHTML = `<span class="player-status-icon">⏳</span><span>${entry.name}</span>`;
    ul.appendChild(li);
  }
  showScreen('screen-waiting');
}

game.on('hide-progress', ({ readyIds }) => {
  for (const id of readyIds) {
    const li = document.querySelector(`#waiting-list li[data-player-id="${id}"]`);
    if (li) li.querySelector('.player-status-icon').textContent = '✅';
  }
});

game.on('round-started', (payload) => {
  currentRound = payload;
  const hiderEntries = payload.hiderIds.map((id) => ({ id, name: game.playerName(id) }));
  if (payload.amSeeker) {
    showWaitingScreen(
      hiderEntries,
      '🔎 Этот раунд ищешь ты',
      `Раунд ${payload.roundIndex + 1} из ${payload.totalRounds}. Ждём, пока все спрячутся.`,
    );
  } else {
    beginHidePhase(payload);
  }
});

// =====================================================================
// Seek phase
// =====================================================================

function ensureSeekZoom() {
  if (!seekZoom) {
    seekZoom = new ZoomController({
      wrapEl: $('seek-canvas-wrap'),
      stageEl: $('seek-canvas-stage'),
      onDown: (evt) => { seekTapStart = { x: evt.clientX, y: evt.clientY, valid: true }; },
      onMove: (evt) => {
        if (!seekTapStart) return;
        if (Math.hypot(evt.clientX - seekTapStart.x, evt.clientY - seekTapStart.y) > 12) {
          seekTapStart.valid = false;
        }
      },
      // Fire the guess on release, not on press: a pinch that begins with
      // one finger must never spend a tap from the budget.
      onUp: (evt) => {
        if (seekTapStart && seekTapStart.valid) handleSeekTap(evt);
        seekTapStart = null;
      },
      onCancel: () => { seekTapStart = null; },
    });
  }
  return seekZoom;
}

$('seek-zoom-in').addEventListener('click', () => ensureSeekZoom().zoomBy(1.4));
$('seek-zoom-out').addEventListener('click', () => ensureSeekZoom().zoomBy(1 / 1.4));
$('seek-zoom-reset').addEventListener('click', () => ensureSeekZoom().reset());

function fitSeekCanvas(img) {
  const wrap = $('seek-canvas-wrap');
  const canvas = $('canvas-seek');
  const rect = wrap.getBoundingClientRect();
  const containerRatio = rect.width / rect.height;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  let cssW, cssH;
  if (imgRatio > containerRatio) { cssW = rect.width; cssH = rect.width / imgRatio; }
  else { cssH = rect.height; cssW = rect.height * imgRatio; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

async function beginSeekPhase(payload) {
  amSeeker = payload.amSeeker;
  currentSeekSprites = payload.sprites;
  seekFoundIds = new Set();
  seekSpriteImages = {};
  lastTickSecond = -1;
  document.querySelectorAll('.found-marker, .miss-marker').forEach((el) => el.remove());
  $('hint-ring').hidden = true;

  seekDeadline = Date.now() + payload.seekSeconds * 1000;
  clearInterval(seekTimerHandle);
  seekTimerHandle = setInterval(checkSeekDeadline, 200);

  if (!payload.amSeeker) {
    $('spectate-seeker-name').textContent = payload.seekerName;
    const list = $('spectate-found-list');
    list.innerHTML = '';
    for (const s of payload.sprites) {
      const li = document.createElement('li');
      li.dataset.playerId = s.playerId;
      li.innerHTML = `<span class="player-status-icon">🙈</span><span>${s.name}</span>`;
      list.appendChild(li);
    }
    showScreen('screen-spectate');
    checkSeekDeadline();
    return;
  }

  showScreen('screen-seek');
  $('seek-hint').textContent = 'Тапай по фото';
  $('seek-found-count').textContent = `Найдено: 0 / ${payload.sprites.length}`;
  $('taps-value').textContent = String(payload.tapsAllowed);
  $('taps-value').classList.remove('is-low');

  const canvas = $('canvas-seek');
  seekCtx = canvas.getContext('2d');
  ensureSeekZoom().reset();

  seekImage = new Image();
  await new Promise((res, rej) => {
    seekImage.onload = res;
    seekImage.onerror = rej;
    seekImage.src = payload.photoUrl;
  });
  fitSeekCanvas(seekImage);
  redrawSeekCanvas();
  checkSeekDeadline();
}

function redrawSeekCanvas() {
  if (!seekCtx || !seekImage) return;
  const canvas = $('canvas-seek');
  seekCtx.setTransform(1, 0, 0, 1, 0, 0);
  seekCtx.clearRect(0, 0, canvas.width, canvas.height);
  seekCtx.drawImage(seekImage, 0, 0, canvas.width, canvas.height);
  for (const s of currentSeekSprites) {
    let img = seekSpriteImages[s.playerId];
    if (!img) {
      img = new Image();
      img.onload = () => redrawSeekCanvas();
      img.src = s.dataUrl;
      seekSpriteImages[s.playerId] = img;
    }
    if (img.complete && img.naturalWidth) {
      drawSpriteOnCanvas(seekCtx, img, s.nx, s.ny, canvas.width, canvas.height, s.scale);
    }
  }
}

function checkSeekDeadline() {
  const left = Math.max(0, Math.ceil((seekDeadline - Date.now()) / 1000));
  $('seek-timer').textContent = left;
  $('seek-timer').classList.toggle('is-urgent', left <= 5);
  $('spectate-timer').textContent = left;
  if (left <= 5 && left > 0 && left !== lastTickSecond) {
    lastTickSecond = left;
    sfx.urgent();
  }
  if (left <= 0) { clearInterval(seekTimerHandle); seekTimerHandle = null; }
}

function handleSeekTap(evt) {
  if (!seekCtx || !amSeeker) return;
  const canvas = $('canvas-seek');
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (evt.clientY - rect.top) * (canvas.height / rect.height);
  if (cx < 0 || cy < 0 || cx > canvas.width || cy > canvas.height) return;

  let hitId = null;
  for (const s of currentSeekSprites) {
    if (seekFoundIds.has(s.playerId)) continue;
    if (isPointInCharacter(seekCtx, s.character, cx, cy, s.nx, s.ny, canvas.width, canvas.height, s.scale)) {
      hitId = s.playerId;
      break;
    }
  }

  if (hitId) {
    placeFoundMarker(currentSeekSprites.find((s) => s.playerId === hitId), canvas);
  } else {
    placeMissMarker(evt.clientX, evt.clientY);
  }
  game.reportTap({ targetPlayerId: hitId, hit: !!hitId, x: cx, y: cy });
}

// Markers live in the zoom stage so they scale and pan with the photo.
function stageOffsetFor(canvas) {
  const stage = canvas.parentElement;
  const cw = parseFloat(canvas.style.width) || canvas.width;
  const ch = parseFloat(canvas.style.height) || canvas.height;
  return {
    stage,
    left: stage.clientWidth / 2 - cw / 2,
    top: stage.clientHeight / 2 - ch / 2,
    cw, ch,
  };
}

function placeFoundMarker(sprite, canvas) {
  if (!sprite) return;
  const o = stageOffsetFor(canvas);
  const r = spriteRect(sprite.nx, sprite.ny, o.cw, o.ch, sprite.scale);
  const el = document.createElement('div');
  el.className = 'found-marker';
  el.style.left = (o.left + r.x + r.w / 2) + 'px';
  el.style.top = (o.top + r.y + r.h / 2) + 'px';
  el.style.width = (r.w * 1.25) + 'px';
  el.style.height = (r.h * 1.25) + 'px';
  o.stage.appendChild(el);
}

function placeMissMarker(clientX, clientY) {
  const canvas = $('canvas-seek');
  const o = stageOffsetFor(canvas);
  const rect = canvas.getBoundingClientRect();
  // Convert to the canvas's own untransformed CSS space so the mark
  // stays glued to the photo at any zoom level.
  const el = document.createElement('div');
  el.className = 'miss-marker';
  el.textContent = '✕';
  el.style.left = (o.left + ((clientX - rect.left) / rect.width) * o.cw) + 'px';
  el.style.top = (o.top + ((clientY - rect.top) / rect.height) * o.ch) + 'px';
  o.stage.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

game.on('seek-started', (payload) => beginSeekPhase(payload));

game.on('seek-event', ({ targetPlayerId, hit, tapsLeft }) => {
  if (hit && targetPlayerId) {
    seekFoundIds.add(targetPlayerId);
    sfx.found();
    const li = document.querySelector(`#spectate-found-list li[data-player-id="${targetPlayerId}"]`);
    if (li) li.innerHTML = `<span class="player-status-icon">✅</span><span>${game.playerName(targetPlayerId)}</span>`;
  } else if (amSeeker) {
    sfx.miss();
  }
  if (amSeeker) {
    $('seek-found-count').textContent = `Найдено: ${seekFoundIds.size} / ${currentSeekSprites.length}`;
    $('taps-value').textContent = String(tapsLeft);
    $('taps-value').classList.toggle('is-low', tapsLeft <= 2);
  }
});

game.on('hint', ({ nx, ny, radiusFrac }) => {
  if (!amSeeker) return;
  const canvas = $('canvas-seek');
  const o = stageOffsetFor(canvas);
  const ring = $('hint-ring');
  const d = radiusFrac * 2 * o.ch;
  ring.style.width = d + 'px';
  ring.style.height = d + 'px';
  ring.style.left = (o.left + nx * o.cw) + 'px';
  ring.style.top = (o.top + ny * o.ch) + 'px';
  ring.hidden = false;
  $('seek-hint').textContent = 'Подсказка!';
  sfx.hint();
});

// =====================================================================
// Round results
// =====================================================================

const REASON_TEXT = {
  'all-found': 'Искатель нашёл всех.',
  'out-of-taps': 'У искателя закончились попытки.',
  'time': 'Время вышло.',
  'no-hiders': 'Никто не успел спрятаться — раунд не считается.',
};

game.on('round-ended', (payload) => {
  clearInterval(seekTimerHandle);
  clearInterval(hideTimerHandle);
  seekTimerHandle = null;
  hideTimerHandle = null;
  sfx.roundEnd();

  $('results-round-badge').textContent = `${payload.roundNumber} / ${payload.totalRounds}`;
  $('results-reason').textContent = REASON_TEXT[payload.reason] || '';

  renderRoundRows(payload.rows);
  renderTotals(payload.totals);
  drawReveal(payload);

  const isHost = game.isHost;
  $('btn-next-round').hidden = !(isHost && !payload.isLast);
  $('btn-finish-match').hidden = !(isHost && payload.isLast);
  $('results-waiting-note').hidden = isHost;
  showScreen('screen-results');
});

function renderRoundRows(rows) {
  const ul = $('round-rows');
  ul.innerHTML = '';
  const ordered = [...rows].sort((a, b) => b.points - a.points);
  for (const row of ordered) {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'score-role';
    icon.textContent = row.role === 'seeker' ? '🔎' : '🎨';

    const body = document.createElement('div');
    body.className = 'score-body';
    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = row.name;
    const detail = document.createElement('span');
    detail.className = 'score-detail';
    detail.textContent = describeRow(row);
    body.append(name, detail);

    const pts = document.createElement('span');
    pts.className = 'score-points';
    pts.textContent = '+' + row.points;

    li.append(icon, body, pts);
    ul.appendChild(li);
  }
}

function describeRow(row) {
  if (row.role === 'seeker') {
    const p = row.parts;
    const bits = [`нашёл ${row.finds} из ${row.hiderCount}`, `попытки ${row.tapsUsed}/${row.tapsAllowed}`];
    if (p.findPts) bits.push(`скорость +${p.findPts}`);
    if (p.foundAllPts) bits.push(`все найдены +${p.foundAllPts}`);
    if (p.tapPts) bits.push(`экономия +${p.tapPts}`);
    return bits.join(' · ');
  }
  if (row.noShow) return 'не успел спрятаться';
  const p = row.parts;
  const bits = [];
  bits.push(row.foundAtSeconds == null
    ? 'не найден'
    : `нашли за ${Math.round(row.foundAtSeconds)}с`);
  if (p.survivalPts) bits.push(`выживание +${p.survivalPts}`);
  if (p.neverFoundPts) bits.push(`не нашли +${p.neverFoundPts}`);
  bits.push(`маскировка ${Math.round((row.blend || 0) * 100)}% +${p.blendPts}`);
  return bits.join(' · ');
}

function renderTotals(totals) {
  const list = $('results-list');
  list.innerHTML = '';
  for (const t of [...totals].sort((a, b) => b.totalScore - a.totalScore)) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = t.color || '#888';
    const name = document.createElement('span');
    name.className = 'results-name';
    name.textContent = t.name;
    const score = document.createElement('span');
    score.className = 'results-score';
    score.textContent = t.totalScore;
    li.append(dot, name, score);
    list.appendChild(li);
  }
}

// Show where everyone actually was — the payoff shot of the round.
function drawReveal(payload) {
  const canvas = $('canvas-reveal');
  if (!payload.photoUrl || !payload.revealSprites || payload.revealSprites.length === 0) {
    canvas.hidden = true;
    return;
  }
  canvas.hidden = false;
  const img = new Image();
  img.onload = () => {
    const maxW = 420;
    const w = Math.min(maxW, img.naturalWidth);
    const h = Math.round((w / img.naturalWidth) * img.naturalHeight);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    for (const s of payload.revealSprites) {
      const sprite = new Image();
      sprite.onload = () => {
        const r = drawSpriteOnCanvas(ctx, sprite, s.nx, s.ny, w, h, s.scale);
        ctx.save();
        ctx.strokeStyle = s.found ? '#57e389' : '#ff4d6d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.7, r.h * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };
      sprite.src = s.dataUrl;
    }
  };
  img.src = payload.photoUrl;
}

$('btn-next-round').addEventListener('click', () => game.hostNextRound());
$('btn-finish-match').addEventListener('click', () => game.hostFinishMatch());

// =====================================================================
// Match end
// =====================================================================

game.on('match-ended', (payload) => {
  sfx.matchEnd();
  const podium = $('podium');
  podium.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  const top = payload.totals.slice(0, 3);
  // Visual order 2-1-3 so the winner stands in the middle.
  const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
  for (const idx of order) {
    const p = top[idx];
    if (!p) continue;
    const slot = document.createElement('div');
    slot.className = `podium-slot podium-slot--${idx + 1}`;
    slot.innerHTML =
      `<span class="podium-medal">${medals[idx]}</span>` +
      `<span class="podium-name">${p.name}</span>` +
      `<div class="podium-bar">${p.totalScore}</div>`;
    podium.appendChild(slot);
  }

  const list = $('final-standings');
  list.innerHTML = '';
  for (const t of payload.totals) {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="results-name">${t.name}</span>` +
      `<span class="results-score">${t.totalScore}</span>`;
    list.appendChild(li);
  }

  $('btn-new-match').hidden = !game.isHost;
  showScreen('screen-match-end');
});

$('btn-new-match').addEventListener('click', () => game.hostResetMatch());

showScreen('screen-menu');
