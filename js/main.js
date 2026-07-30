import { Game } from './game.js';
import { PaintEngine, BRUSHES, drawSpriteOnCanvas, isPointInCharacter, spriteRect } from './paint-engine.js';
import { buildCharacterPath } from './shapes.js';
import { PALETTE, AVATAR_COLORS } from './palette-data.js';
import { DEMO_SCENES, paintDemoScene, demoSceneDataUrl } from './demo-scenes.js';
import { IbisColorWheel } from './color-wheel.js';

const $ = (id) => document.getElementById(id);
const game = new Game();
window.__game = game; // debug hook

let selectedAvatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
let selectedPhotoUrl = null;
let engine = null;
let hideTimerHandle = null;
let hideDeadline = 0;
let hideSubmitted = false;
let seekTimerHandle = null;
let seekDeadline = 0;
let seekCtx = null;
let seekPath = buildCharacterPath();
let currentSeekSprites = [];
let currentRoundInfo = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('screen--active'));
  $(id).classList.add('screen--active');
}

// ---------------- home screen ----------------

function renderAvatarSwatches() {
  const wrap = $('avatar-swatches');
  wrap.innerHTML = '';
  for (const color of AVATAR_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-swatch' + (color === selectedAvatarColor ? ' is-selected' : '');
    b.style.background = color;
    b.addEventListener('click', () => {
      selectedAvatarColor = color;
      wrap.querySelectorAll('.avatar-swatch').forEach((el) => el.classList.remove('is-selected'));
      b.classList.add('is-selected');
    });
    wrap.appendChild(b);
  }
}
renderAvatarSwatches();

$('input-nickname').value = localStorage.getItem('blendin-name') || '';

function currentName() {
  const name = $('input-nickname').value.trim() || 'Игрок';
  localStorage.setItem('blendin-name', name);
  return name;
}

function setHomeError(msg) {
  const el = $('home-error');
  if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
}

$('btn-create-room').addEventListener('click', async () => {
  setHomeError('');
  $('btn-create-room').disabled = true;
  try {
    const code = await game.createRoom(currentName(), selectedAvatarColor);
    $('room-code-display').textContent = code;
    enterLobby();
  } catch (err) {
    setHomeError(err.message || 'Не удалось создать комнату.');
  } finally {
    $('btn-create-room').disabled = false;
  }
});

$('btn-join-room').addEventListener('click', async () => {
  const code = $('input-room-code').value.trim();
  if (!code) { setHomeError('Введи код комнаты.'); return; }
  setHomeError('');
  $('btn-join-room').disabled = true;
  try {
    await game.joinRoom(code, currentName(), selectedAvatarColor);
    $('room-code-display').textContent = game.net.roomCode;
    enterLobby();
  } catch (err) {
    setHomeError(err.message || 'Не удалось подключиться.');
  } finally {
    $('btn-join-room').disabled = false;
  }
});

// ---------------- lobby screen ----------------

function enterLobby() {
  $('host-photo-block').hidden = !game.isHost;
  $('lobby-waiting-note').hidden = game.isHost;
  showScreen('screen-lobby');
  renderPlayers([...game.players.values()]);
}

function renderPlayers(players) {
  const ul = $('player-list');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.dataset.playerId = p.id;
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = p.color;
    li.appendChild(dot);
    const name = document.createElement('span');
    name.textContent = p.name + (p.isHost ? ' 👑' : '');
    li.appendChild(name);
    if (p.id === game.myId) {
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
  if (document.getElementById('screen-lobby').classList.contains('screen--active')) {
    renderPlayers(players);
  }
});
game.on('lobby', (players) => { enterLobby(); });
game.on('fatal-error', (msg) => { alert(msg); location.reload(); });

$('btn-copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(game.net.roomCode); } catch (_) {}
});

$('btn-leave-lobby').addEventListener('click', () => {
  game.leave();
  showScreen('screen-home');
});
$('btn-back-lobby').textContent = 'Выйти из комнаты';
$('btn-back-lobby').addEventListener('click', () => {
  game.leave();
  showScreen('screen-home');
});

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
    c.width = 64; c.height = 64;
    paintDemoScene(c.getContext('2d'), 64, 64, scene.id);
    btn.appendChild(c);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.demo-scene-thumb').forEach((t) => t.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      setSelectedPhoto(demoSceneDataUrl(scene.id));
    });
    row.appendChild(btn);
  }
})();

$('input-hide-time').addEventListener('input', (e) => { $('hide-time-value').textContent = e.target.value; });

$('btn-start-round').addEventListener('click', () => {
  if (!selectedPhotoUrl) return;
  game.hostStartRound(selectedPhotoUrl, parseInt($('input-hide-time').value, 10));
});

// ---------------- hide (paint) screen ----------------

let colorWheel = null;

function ensureEngine() {
  if (!engine) {
    engine = new PaintEngine({
      wrapEl: $('canvas-wrap'),
      photoCanvas: $('canvas-photo'),
      paintCanvas: $('canvas-paint'),
    });
    engine.onColorPicked = (hex) => {
      $('tool-eyedropper').classList.remove('is-selected');
      setActiveColor(hex);
    };
  }
  return engine;
}

function setActiveColor(hex) {
  engine.setColor(hex);
  $('wheel-swatch').style.background = hex;
  highlightPaletteSwatch(hex);
  if (colorWheel) colorWheel.setColor(hex);
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
    });
    row.appendChild(btn);
  });
}

function renderPaletteRow() {
  const row = $('palette-row');
  row.innerHTML = '';
  for (const hex of PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = hex;
    sw.dataset.hex = hex;
    sw.addEventListener('click', () => setActiveColor(hex));
    row.appendChild(sw);
  }
}

function highlightPaletteSwatch(hex) {
  $('palette-row').querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('is-selected', s.dataset.hex.toLowerCase() === hex.toLowerCase());
  });
}

renderBrushRow();
renderPaletteRow();

$('brush-size').addEventListener('input', (e) => engine && engine.setSize(parseInt(e.target.value, 10)));
$('tool-undo').addEventListener('click', () => engine && engine.undo());
$('tool-eyedropper').addEventListener('click', () => {
  if (!engine) return;
  engine.eyedropperActive = !engine.eyedropperActive;
  $('tool-eyedropper').classList.toggle('is-selected', engine.eyedropperActive);
  $('wheel-popover').hidden = true;
});

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
  $('tool-eyedropper').classList.remove('is-selected');
  if (engine) engine.eyedropperActive = false;
});
$('wheel-close').addEventListener('click', () => { $('wheel-popover').hidden = true; });

async function beginHidePhase(photoUrl, hideSeconds) {
  showScreen('screen-hide');
  hideSubmitted = false;
  $('paint-toolbar').hidden = true;
  $('wheel-popover').hidden = true;
  $('btn-place-here').hidden = false;
  $('btn-hide-done').disabled = true;
  $('hide-hint').textContent = 'Спрячься';
  const eng = ensureEngine();
  await eng.loadPhoto(photoUrl);
  eng.eyedropperActive = false;
  $('tool-eyedropper').classList.remove('is-selected');
  eng.beginPlacement();

  hideDeadline = Date.now() + hideSeconds * 1000;
  clearInterval(hideTimerHandle);
  hideTimerHandle = setInterval(() => {
    const left = Math.max(0, Math.ceil((hideDeadline - Date.now()) / 1000));
    $('hide-timer').textContent = left;
    if (left <= 0) {
      clearInterval(hideTimerHandle);
      if (!hideSubmitted) submitHide();
    }
  }, 250);
}

$('btn-place-here').addEventListener('click', () => {
  if (!engine || engine.phase !== 'placing') return;
  engine.lockPlacement();
  $('btn-place-here').hidden = true;
  $('paint-toolbar').hidden = false;
  $('btn-hide-done').disabled = false;
  $('hide-hint').textContent = 'Закрасься';
});

$('btn-hide-done').addEventListener('click', () => {
  if (!engine || engine.phase !== 'painting') return;
  submitHide();
});

function submitHide() {
  if (hideSubmitted || !engine) return;
  hideSubmitted = true;
  clearInterval(hideTimerHandle);
  $('btn-hide-done').disabled = true;
  $('hide-hint').textContent = 'Отправлено! Ждём остальных…';
  // Show the waiting screen BEFORE submitting: when this player's
  // submission is the one that completes the hide phase, submitSprite()
  // can synchronously drive the local state machine all the way into
  // the seek phase (host's own echo has no network round-trip), which
  // must be the screen left on-screen afterwards, not this one.
  const entries = (currentRoundInfo?.hiderIds || []).map((id) => ({ id, name: nameForId(id) }));
  showWaitingScreen(entries, 'Ждём, пока все спрячутся…');
  game.submitSprite(engine.exportSprite());
}

// ---------------- waiting screen (shared: seeker-waits / hider-submitted) ----------------

function showWaitingScreen(entries, title) {
  $('waiting-list').innerHTML = '';
  document.querySelector('#screen-waiting .waiting-title').textContent = title;
  for (const entry of entries) {
    const li = document.createElement('li');
    li.dataset.playerId = entry.id;
    li.innerHTML = `<span class="player-status-icon">⏳</span><span>${entry.name}</span>`;
    $('waiting-list').appendChild(li);
  }
  showScreen('screen-waiting');
}

function markWaitingReady(playerId) {
  const li = document.querySelector(`#waiting-list li[data-player-id="${playerId}"]`);
  if (li) li.querySelector('.player-status-icon').textContent = '✅';
}

game.on('round-started', (payload) => {
  currentRoundInfo = payload;
  const hiderEntries = payload.hiderIds.map((id) => ({ id, name: nameForId(id) }));
  if (payload.amSeeker) {
    showWaitingScreen(hiderEntries, `🔎 Ты ищешь! Жди, пока все спрячутся`);
  } else {
    beginHidePhase(payload.photoUrl, payload.hideSeconds);
  }
});

function nameForId(id) {
  const p = game.players.get(id);
  return p ? p.name : '???';
}

game.on('hide-progress', ({ readyIds }) => {
  readyIds.forEach(markWaitingReady);
});

// ---------------- seek screen ----------------

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

let seekImage = null;
let seekFoundIds = new Set();
let seekSpriteImages = {};

async function beginSeekPhase(payload) {
  currentSeekSprites = payload.sprites;
  seekFoundIds = new Set();
  document.querySelectorAll('.found-marker,.miss-marker').forEach((el) => el.remove());

  if (!payload.amSeeker) {
    $('spectate-seeker-name').textContent = payload.seekerName;
    const list = $('spectate-found-list');
    list.innerHTML = '';
    for (const h of payload.hiderNames) {
      const li = document.createElement('li');
      li.dataset.playerId = h.id;
      li.innerHTML = `<span class="player-status-icon">🙈</span><span>${h.name}</span>`;
      list.appendChild(li);
    }
    showScreen('screen-spectate');
    return;
  }

  showScreen('screen-seek');
  $('seek-found-count').textContent = `Найдено: 0 / ${payload.sprites.length}`;
  $('seek-hint').textContent = 'Тапай по фото — ищи спрятавшихся';

  const canvas = $('canvas-seek');
  seekCtx = canvas.getContext('2d');
  seekSpriteImages = {};
  seekImage = new Image();
  await new Promise((res) => { seekImage.onload = res; seekImage.src = currentRoundInfo.photoUrl; });
  fitSeekCanvas(seekImage);
  redrawSeekCanvas(payload.sprites);

  seekDeadline = Date.now() + payload.seekSeconds * 1000;
  clearInterval(seekTimerHandle);
  seekTimerHandle = setInterval(() => {
    const left = Math.max(0, Math.ceil((seekDeadline - Date.now()) / 1000));
    $('seek-timer').textContent = left;
    if (left <= 0) clearInterval(seekTimerHandle);
  }, 250);
}

function redrawSeekCanvas(sprites) {
  const canvas = $('canvas-seek');
  seekCtx.setTransform(1, 0, 0, 1, 0, 0);
  seekCtx.clearRect(0, 0, canvas.width, canvas.height);
  seekCtx.drawImage(seekImage, 0, 0, canvas.width, canvas.height);
  for (const s of sprites) {
    if (!seekSpriteImages[s.playerId]) {
      const img = new Image();
      img.src = s.dataUrl;
      seekSpriteImages[s.playerId] = img;
      img.onload = () => redrawSeekCanvas(sprites);
    }
    const img = seekSpriteImages[s.playerId];
    if (img.complete && img.naturalWidth) {
      drawSpriteOnCanvas(seekCtx, img, s.nx, s.ny, canvas.width, canvas.height);
    }
  }
}

$('canvas-seek').addEventListener('pointerdown', (evt) => {
  if (!seekCtx) return;
  const canvas = $('canvas-seek');
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (evt.clientY - rect.top) * (canvas.height / rect.height);

  let hitId = null;
  for (const s of currentSeekSprites) {
    if (seekFoundIds.has(s.playerId)) continue;
    if (isPointInCharacter(seekCtx, seekPath, cx, cy, s.nx, s.ny, canvas.width, canvas.height)) { hitId = s.playerId; break; }
  }

  if (hitId) {
    const hitSprite = currentSeekSprites.find((s) => s.playerId === hitId);
    placeFoundMarker(hitSprite, canvas);
  } else {
    placeMissMarker(evt.clientX, evt.clientY);
  }
  game.reportTap({ targetPlayerId: hitId, hit: !!hitId, x: cx, y: cy });
});

function placeFoundMarker(sprite, canvas) {
  const wrap = $('seek-canvas-wrap');
  const cssScale = canvas.getBoundingClientRect().width / canvas.width;
  const r = spriteRect(sprite.nx, sprite.ny, canvas.width, canvas.height);
  const el = document.createElement('div');
  el.className = 'found-marker';
  el.style.left = ((r.x + r.w / 2) * cssScale) + 'px';
  el.style.top = ((r.y + r.h / 2) * cssScale) + 'px';
  el.style.width = (r.w * cssScale * 1.2) + 'px';
  el.style.height = (r.h * cssScale * 1.2) + 'px';
  wrap.appendChild(el);
}

function placeMissMarker(clientX, clientY) {
  const wrap = $('seek-canvas-wrap');
  const wrapRect = wrap.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'miss-marker';
  el.textContent = '✕';
  el.style.left = (clientX - wrapRect.left) + 'px';
  el.style.top = (clientY - wrapRect.top) + 'px';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

game.on('seek-started', (payload) => beginSeekPhase(payload));

game.on('seek-event', ({ targetPlayerId, hit }) => {
  if (hit && targetPlayerId) {
    seekFoundIds.add(targetPlayerId);
    $('seek-found-count').textContent = `Найдено: ${seekFoundIds.size} / ${currentSeekSprites.length}`;
    const li = document.querySelector(`#spectate-found-list li[data-player-id="${targetPlayerId}"]`);
    if (li) li.innerHTML = `<span class="player-status-icon">✅</span><span>${nameForId(targetPlayerId)}</span>`;
  }
});

// ---------------- results screen ----------------

game.on('round-ended', ({ scores, totals }) => {
  clearInterval(seekTimerHandle);
  const list = $('results-list');
  list.innerHTML = '';
  const totalsSorted = [...totals].sort((a, b) => b.totalScore - a.totalScore);
  for (const t of totalsSorted) {
    const roundScore = scores.find((s) => s.playerId === t.id);
    const li = document.createElement('li');
    const noteText = roundScore
      ? (roundScore.role === 'seeker'
        ? `искал: +${roundScore.points}`
        : (roundScore.foundAtSeconds == null ? `не нашли: +${roundScore.points}` : `нашли на ${Math.round(roundScore.foundAtSeconds)}с: +${roundScore.points}`))
      : '';
    li.innerHTML = `<div style="flex:1"><span class="results-name">${t.name}</span><span class="results-note">${noteText}</span></div><span class="results-score">${t.totalScore}</span>`;
    list.appendChild(li);
  }
  $('btn-play-again').hidden = !game.isHost;
  showScreen('screen-results');
});

$('btn-play-again').addEventListener('click', () => game.playAgain());

showScreen('screen-home');
