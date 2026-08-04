'use strict';

const C = require('./game/constants');
const { World } = require('./game/world');
const { Bot, BOT_NAMES } = require('./game/bot');

const BOT_CLASSES = ['pyro', 'cryo', 'storm'];

class Room {
  constructor(id) {
    this.id = id;
    this.world = new World(id);
    this.clients = new Map(); // playerId -> {ws, alive, lastMsg, msgCount}
    this.bots = new Map(); // playerId -> Bot
    this.nextId = 1;
    this.tickTimer = null;
    this.tickCount = 0;
    this.snapEvery = Math.max(1, Math.round(C.TICK_HZ / C.SNAPSHOT_HZ));
    this.lastTick = Date.now();
  }

  get size() { return this.clients.size; }
  get full() { return this.clients.size >= C.MATCH.maxPlayers; }

  start() {
    if (this.tickTimer) return;
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 1000 / C.TICK_HZ);
  }

  stop() {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // ── подключение ────────────────────────────────────────────
  join(ws, name, cls) {
    const id = this.nextId++;
    const safeName = String(name || '').trim().slice(0, 14) || `Маг-${id}`;
    const clsId = C.CLASSES[cls] ? cls : 'pyro';
    const p = this.world.addPlayer(id, safeName, clsId, false);
    this.clients.set(id, { ws, lastPing: 0, msgCount: 0, msgWindow: Date.now() });
    ws.playerId = id;
    ws.roomId = this.id;

    this.send(ws, {
      t: 'welcome',
      id,
      room: this.id,
      cfg: C.clientConfig(),
      you: { name: p.name, cls: p.cls },
    });
    this.send(ws, this.world.roster());
    this.syncBots();
    this.start();
    return p;
  }

  leave(id) {
    this.clients.delete(id);
    this.world.removePlayer(id);
    this.bots.delete(id);
    this.syncBots();
    if (this.clients.size === 0) {
      // никого живого — гасим комнату вместе с ботами
      for (const botId of this.bots.keys()) this.world.removePlayer(botId);
      this.bots.clear();
      this.stop();
    }
  }

  onMessage(ws, raw) {
    const cl = this.clients.get(ws.playerId);
    if (!cl) return;

    // защита от флуда: не более 200 сообщений в секунду с клиента
    const now = Date.now();
    if (now - cl.msgWindow > 1000) { cl.msgWindow = now; cl.msgCount = 0; }
    if (++cl.msgCount > 200) return;

    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    switch (m.t) {
      case 'in':
        this.world.setInput(ws.playerId, +m.x || 0, +m.y || 0, +m.a);
        break;
      case 'cast': {
        const slot = m.s | 0;
        if (slot >= 0 && slot <= 3) {
          if (Number.isFinite(+m.a)) this.world.setInput(ws.playerId, undefined, undefined, +m.a);
          this.world.cast(ws.playerId, slot);
        }
        break;
      }
      case 'ping':
        this.send(ws, { t: 'pong', ts: m.ts, now: Date.now() });
        break;
      case 'class': {
        // смена школы магии применяется сразу, кулдауны сбрасываются
        const p = this.world.players.get(ws.playerId);
        if (p && C.CLASSES[m.cls]) {
          p.cls = m.cls;
          p.maxHp = C.CLASSES[m.cls].hp;
          p.speed = C.CLASSES[m.cls].speed;
          p.hp = Math.min(p.hp, p.maxHp);
          p.cd = [0, 0, 0];
          this.world.rosterDirty = true;
        }
        break;
      }
      case 'emote':
        this.broadcast({ t: 'emote', id: ws.playerId, e: (m.e | 0) % 6 });
        break;
    }
  }

  // ── боты ───────────────────────────────────────────────────
  syncBots() {
    const humans = this.clients.size;
    if (humans === 0) return;
    const want = Math.max(0, Math.min(C.MATCH.minAlive - humans, C.MATCH.maxPlayers - humans));
    while (this.bots.size > want) {
      const id = this.bots.keys().next().value;
      this.bots.delete(id);
      this.world.removePlayer(id);
    }
    while (this.bots.size < want) {
      const id = this.nextId++;
      const cls = BOT_CLASSES[this.bots.size % BOT_CLASSES.length];
      const p = this.world.addPlayer(id, this.freeBotName(id), cls, true);
      this.bots.set(id, new Bot(this.world, p, 0.45 + Math.random() * 0.4));
    }
  }

  // Имена ботов не должны повторяться в одной комнате
  freeBotName(id) {
    const used = new Set([...this.world.players.values()].map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? free[Math.floor(Math.random() * free.length)] : `Дух-${id}`;
  }

  // ── цикл ───────────────────────────────────────────────────
  tick() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 0.25) dt = 0.25; // защита от «прыжка» после подвисания

    for (const bot of this.bots.values()) bot.update(dt);
    this.world.update(dt);

    if (++this.tickCount % this.snapEvery === 0) {
      const snap = this.world.snapshot();
      this.broadcast(snap);
      if (this.world.rosterDirty) this.broadcast(this.world.roster());
    }
  }

  send(ws, obj) {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch { /* сокет умер */ }
    }
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const cl of this.clients.values()) {
      if (cl.ws.readyState === 1) {
        try { cl.ws.send(data); } catch { /* игнор */ }
      }
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.seq = 0;
  }

  findRoom() {
    for (const r of this.rooms.values()) if (!r.full) return r;
    const id = `arena-${++this.seq}`;
    const r = new Room(id);
    this.rooms.set(id, r);
    return r;
  }

  get(id) { return this.rooms.get(id); }

  cleanup() {
    for (const [id, r] of this.rooms) {
      if (r.size === 0 && this.rooms.size > 1) this.rooms.delete(id);
    }
  }

  stats() {
    const rooms = [];
    let players = 0, bots = 0;
    for (const r of this.rooms.values()) {
      rooms.push({ id: r.id, players: r.size, bots: r.bots.size, state: r.world.state });
      players += r.size; bots += r.bots.size;
    }
    return { rooms, players, bots };
  }
}

module.exports = { Room, RoomManager };
