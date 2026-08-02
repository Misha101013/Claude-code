// HTTP + WebSocket сервер: раздаёт клиент и крутит симуляцию комнат.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import * as C from '../shared/config.js';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const SAVE_FILE = path.join(ROOT, 'data', 'rooms.json');

const app = express();
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));

const rooms = new Map();

function getRoom(code) {
  const key = normalizeCode(code);
  if (!rooms.has(key)) rooms.set(key, new Room(key));
  return rooms.get(key);
}

function normalizeCode(code) {
  const c = String(code || 'main').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c || 'MAIN';
}

app.get('/api/rooms', (_req, res) => {
  res.json({
    rooms: [...rooms.values()].map((r) => ({
      code: r.code,
      players: r.players.size,
      day: r.state.day,
      open: r.state.open,
      money: Math.round(r.state.money),
      names: [...r.players.values()].map((p) => p.name),
    })).sort((a, b) => b.players - a.players),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const room = getRoom(url.searchParams.get('room'));
  const player = room.addPlayer(ws, url.searchParams.get('name'));
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (raw.length > 8192) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    try { room.handle(player, msg); } catch (err) { console.error('handle error', err); }
  });

  ws.on('close', () => {
    room.removePlayer(player.id);
  });

  ws.on('error', () => {
    room.removePlayer(player.id);
  });
});

// --- главный цикл ---
const TICK_MS = 1000 / C.TICK_RATE;
let last = Date.now();
let syncAcc = 0;
let storeAcc = 0;

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  syncAcc += dt;
  storeAcc += dt;

  const sendSync = syncAcc >= 1 / C.SNAPSHOT_RATE;
  const sendStore = storeAcc >= 0.2;
  if (sendSync) syncAcc = 0;
  if (sendStore) storeAcc = 0;

  for (const room of rooms.values()) {
    if (room.players.size === 0 && room.customers.size === 0) continue;
    try {
      room.tick(dt);
      if (sendSync) room.broadcast(room.serializeDynamic());
      if (sendStore && room.storeDirty) {
        room.storeDirty = false;
        room.broadcast({ t: 'store', store: room.serializeStore() });
      }
    } catch (err) {
      console.error(`room ${room.code} tick error`, err);
    }
  }
}, TICK_MS);

// выгружаем из памяти давно пустующие магазины (их состояние уже сохранено)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.size === 0 && now - room.lastActivity > 30 * 60 * 1000) {
      saveRooms();
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

// пинг, чтобы отваливались мёртвые соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

// --- сохранение прогресса ---
function saveRooms() {
  try {
    const payload = [...rooms.values()]
      .filter((r) => r.state.xp > 0 || r.state.day > 1 || r.state.money !== C.START_MONEY)
      .map((r) => r.serializeSave());
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(payload));
  } catch (err) {
    console.error('save error', err);
  }
}

function loadRooms() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return;
    const payload = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    for (const save of payload) {
      const room = getRoom(save.code);
      room.restoreSave(save);
    }
    console.log(`Загружено магазинов: ${payload.length}`);
  } catch (err) {
    console.error('load error', err);
  }
}

loadRooms();
setInterval(saveRooms, 30000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { saveRooms(); process.exit(0); });
}

server.listen(PORT, () => {
  console.log(`🛒 Супермаркет запущен: http://localhost:${PORT}`);
});
