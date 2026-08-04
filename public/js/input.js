/* Ввод: два виртуальных стика для телефона + клавиатура/мышь для ПК. */
window.Input = (() => {
  const DEAD = 0.14;      // мёртвая зона стика
  const RADIUS = 62;      // радиус стика в пикселях экрана

  const st = {
    move: { x: 0, y: 0 },
    aimAngle: 0,
    aimActive: false,
    firing: false,
    lefty: false,
    left: { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false },
    right: { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false },
    mouse: { x: 0, y: 0, down: false, present: false },
    keys: new Set(),
  };

  let onCast = () => {};
  let canvas = null;

  function stickFor(clientX) {
    const mid = window.innerWidth / 2;
    const isLeftSide = clientX < mid;
    const moveSide = st.lefty ? !isLeftSide : isLeftSide;
    return moveSide ? st.left : st.right;
  }

  function setStick(s, x, y) {
    let dx = x - s.ox, dy = y - s.oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
    s.x = dx; s.y = dy;
  }

  function down(e) {
    if (e.pointerType === 'mouse') {      // на ПК стики не нужны — целимся мышью
      st.mouse.present = true;
      st.mouse.down = true;
      st.mouse.x = e.clientX; st.mouse.y = e.clientY;
      return;
    }
    const s = stickFor(e.clientX);
    if (s.active) return;                 // палец на этой половине уже есть
    s.id = e.pointerId;
    s.ox = e.clientX; s.oy = e.clientY;
    s.x = 0; s.y = 0;
    s.active = true;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  }

  function move(e) {
    if (e.pointerType === 'mouse') { st.mouse.x = e.clientX; st.mouse.y = e.clientY; st.mouse.present = true; }
    for (const s of [st.left, st.right]) {
      if (s.active && s.id === e.pointerId) setStick(s, e.clientX, e.clientY);
    }
  }

  function up(e) {
    for (const s of [st.left, st.right]) {
      if (s.id === e.pointerId) { s.active = false; s.id = null; s.x = 0; s.y = 0; }
    }
    if (e.pointerType === 'mouse') st.mouse.down = false;
  }

  function init(cv, opts = {}) {
    canvas = cv;
    onCast = opts.onCast || onCast;

    cv.addEventListener('pointerdown', (e) => { e.preventDefault(); down(e); });
    cv.addEventListener('pointermove', (e) => { e.preventDefault(); move(e); });
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') up(e); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      st.keys.clear();
      [st.left, st.right].forEach((s) => { s.active = false; s.id = null; s.x = s.y = 0; });
    });

    // кнопки способностей (DOM поверх канваса)
    document.querySelectorAll('.skill').forEach((btn) => {
      const slot = +btn.dataset.slot;
      const fire = (e) => { e.preventDefault(); onCast(slot); btn.dataset.held = '1'; };
      const stop = () => { delete btn.dataset.held; };
      btn.addEventListener('pointerdown', fire);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('pointerleave', stop);
    });
    // удержание базовой атаки — автоповтор
    setInterval(() => {
      const b = document.querySelector('.skill.s0[data-held]');
      if (b) onCast(0);
    }, 90);

    // клавиатура
    const KEY_SLOT = { KeyQ: 1, KeyE: 2, Digit1: 0, Digit2: 1, Digit3: 2, ShiftLeft: 3, ShiftRight: 3, Space: 0 };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      st.keys.add(e.code);
      if (KEY_SLOT[e.code] !== undefined) { e.preventDefault(); onCast(KEY_SLOT[e.code]); }
    });
    window.addEventListener('keyup', (e) => st.keys.delete(e.code));
  }

  // Итоговый вектор движения: стик или клавиши
  function moveVector() {
    const s = st.left;
    if (s.active) {
      const mag = Math.hypot(s.x, s.y) / RADIUS;
      if (mag > DEAD) {
        const k = Math.min(1, (mag - DEAD) / (1 - DEAD)) / Math.max(0.001, mag);
        return { x: (s.x / RADIUS) * k, y: (s.y / RADIUS) * k };
      }
      return { x: 0, y: 0 };
    }
    let x = 0, y = 0;
    if (st.keys.has('KeyA') || st.keys.has('ArrowLeft')) x -= 1;
    if (st.keys.has('KeyD') || st.keys.has('ArrowRight')) x += 1;
    if (st.keys.has('KeyW') || st.keys.has('ArrowUp')) y -= 1;
    if (st.keys.has('KeyS') || st.keys.has('ArrowDown')) y += 1;
    const len = Math.hypot(x, y);
    return len ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  // Прицел: правый стик приоритетнее мыши. selfScreen нужен для мыши.
  function aim(selfScreen, prev) {
    const s = st.right;
    const mag = Math.hypot(s.x, s.y) / RADIUS;
    if (s.active && mag > DEAD) {
      st.aimActive = true;
      st.firing = true;
      st.aimAngle = Math.atan2(s.y, s.x);
      return st.aimAngle;
    }
    st.aimActive = false;
    if (st.mouse.present && selfScreen) {
      st.aimAngle = Math.atan2(st.mouse.y - selfScreen.y, st.mouse.x - selfScreen.x);
    } else {
      st.aimAngle = prev;
    }
    st.firing = st.mouse.down || st.keys.has('Space');
    return st.aimAngle;
  }

  return {
    init, moveVector, aim, state: st, RADIUS, DEAD,
    set lefty(v) { st.lefty = !!v; },
    get lefty() { return st.lefty; },
    get firing() { return st.firing; },
  };
})();
