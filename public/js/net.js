/* Сеть: WebSocket, буфер снапшотов, замер пинга, переподключение. */
window.Net = (() => {
  const INTERP_MS = 130; // задержка интерполяции — сглаживает джиттер мобильной сети
  const BUFFER = 24;

  const state = {
    ws: null,
    id: 0,
    cfg: null,
    roster: new Map(),
    snaps: [],
    latency: 0,
    connected: false,
    joined: false,
    matchState: 'play',
    timeLeft: 0,
    lastError: '',
  };

  const handlers = { welcome: [], roster: [], snapshot: [], status: [], emote: [] };
  const on = (evt, fn) => handlers[evt].push(fn);
  const emit = (evt, arg) => handlers[evt].forEach((f) => f(arg));

  let pingTimer = null;
  let joinInfo = { name: 'Маг', cls: 'pyro' };
  let reconnectDelay = 800;
  let manualClose = false;

  function url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function connect(name, cls) {
    joinInfo = { name, cls };
    manualClose = false;
    open();
  }

  function open() {
    try { state.ws = new WebSocket(url()); } catch (e) { scheduleReconnect(); return; }
    const ws = state.ws;

    ws.onopen = () => {
      state.connected = true;
      reconnectDelay = 800;
      send({ t: 'join', name: joinInfo.name, cls: joinInfo.cls });
      emit('status', { kind: 'open' });
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);
      send({ t: 'ping', ts: performance.now() });
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          state.id = m.id;
          state.cfg = m.cfg;
          state.joined = true;
          state.snaps.length = 0;
          emit('welcome', m);
          break;
        case 'roster':
          state.roster = new Map(m.list.map((p) => [p.id, p]));
          emit('roster', m.list);
          break;
        case 's':
          pushSnapshot(m);
          emit('snapshot', m);
          break;
        case 'pong':
          state.latency = Math.max(0, Math.round(performance.now() - m.ts));
          break;
        case 'emote':
          emit('emote', m);
          break;
      }
    };

    ws.onclose = () => {
      state.connected = false;
      state.joined = false;
      clearInterval(pingTimer);
      emit('status', { kind: 'close' });
      if (!manualClose) scheduleReconnect();
    };

    ws.onerror = () => { state.lastError = 'Ошибка соединения'; };
  }

  function scheduleReconnect() {
    emit('status', { kind: 'reconnect', delay: reconnectDelay });
    setTimeout(() => { if (!manualClose) open(); }, reconnectDelay);
    reconnectDelay = Math.min(8000, Math.round(reconnectDelay * 1.7));
  }

  function close() {
    manualClose = true;
    clearInterval(pingTimer);
    if (state.ws) { try { state.ws.close(); } catch { /* ignore */ } }
    state.ws = null;
    state.connected = false;
    state.joined = false;
    state.snaps.length = 0;
  }

  function send(obj) {
    const ws = state.ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ── разбор снапшота в удобные объекты ──────────────────────
  function pushSnapshot(m) {
    const players = new Map();
    for (const a of m.p) {
      players.set(a[0], {
        id: a[0], x: a[1], y: a[2], aim: a[3], hp: a[4], maxHp: a[5], mana: a[6],
        alive: !!a[7], bits: a[8], k: a[9], d: a[10], resp: a[11],
      });
    }
    const snap = {
      rt: performance.now(),
      st: m.st, tl: m.tl,
      players,
      projectiles: m.b.map((b) => ({ id: b[0], x: b[1], y: b[2], kind: b[3], r: b[4], a: b[5] })),
      grounds: m.g.map((g) => ({ id: g[0], x: g[1], y: g[2], r: g[3], kind: g[4], p: g[5] })),
      pickups: m.k.map((k) => ({ id: k[0], x: k[1], y: k[2], kind: k[3], on: !!k[4] })),
      fx: m.fx || [],
      feed: m.f || [],
    };
    state.matchState = m.st;
    state.timeLeft = m.tl;
    state.snaps.push(snap);
    if (state.snaps.length > BUFFER) state.snaps.shift();
  }

  // Возвращает интерполированный кадр мира на «сейчас минус INTERP».
  function view() {
    const snaps = state.snaps;
    if (!snaps.length) return null;
    const target = performance.now() - INTERP_MS;
    if (snaps.length === 1 || target <= snaps[0].rt) return frameOf(snaps[0], snaps[0], 0);

    for (let i = snaps.length - 1; i > 0; i--) {
      const b = snaps[i], a = snaps[i - 1];
      if (target >= a.rt && target <= b.rt) {
        const t = (target - a.rt) / Math.max(1, b.rt - a.rt);
        return frameOf(a, b, t);
      }
    }
    const last = snaps[snaps.length - 1];
    return frameOf(last, last, 0);
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function frameOf(a, b, t) {
    const players = new Map();
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      players.set(id, pa ? {
        ...pb,
        x: lerp(pa.x, pb.x, t),
        y: lerp(pa.y, pb.y, t),
        aim: lerpAngle(pa.aim, pb.aim, t),
      } : pb);
    }
    const projectiles = b.projectiles.map((qb) => {
      const qa = a.projectiles.find((q) => q.id === qb.id);
      return qa ? { ...qb, x: lerp(qa.x, qb.x, t), y: lerp(qa.y, qb.y, t) } : qb;
    });
    return {
      players, projectiles,
      grounds: b.grounds, pickups: b.pickups,
      st: b.st, tl: b.tl,
    };
  }

  // ── исходящие ──────────────────────────────────────────────
  const api = {
    state, on, connect, close, send, view,
    get id() { return state.id; },
    get cfg() { return state.cfg; },
    get latency() { return state.latency; },
    input(x, y, a) { send({ t: 'in', x: +x.toFixed(3), y: +y.toFixed(3), a: +a.toFixed(3) }); },
    cast(slot, a) { send({ t: 'cast', s: slot, a: +a.toFixed(3) }); },
    setClass(cls) { send({ t: 'class', cls }); },
    INTERP_MS,
  };
  return api;
})();
