'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { RoomManager } = require('./room');
const C = require('./game/constants');

const PORT = process.env.PORT || 3000;
const app = express();
const PUBLIC = path.join(__dirname, '..', 'public');

app.use(express.static(PUBLIC, { maxAge: '1h', extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const manager = new RoomManager();
app.get('/api/stats', (_req, res) => res.json(manager.stats()));
app.get('/api/config', (_req, res) => res.json(C.clientConfig()));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.joined = false;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    if (!ws.joined) {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || m.t !== 'join') return;
      const room = manager.findRoom();
      room.join(ws, m.name, m.cls);
      ws.joined = true;
      return;
    }
    const room = manager.get(ws.roomId);
    if (room) room.onMessage(ws, raw);
  });

  const bye = () => {
    const room = manager.get(ws.roomId);
    if (room && ws.playerId) room.leave(ws.playerId);
    manager.cleanup();
  };
  ws.on('close', bye);
  ws.on('error', bye);
});

// вычищаем «мёртвые» соединения (мобильные клиенты часто уходят молча)
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* игнор */ }
  }
}, 20000).unref();

server.listen(PORT, () => {
  console.log(`⚔️  War of Wizards 2D — http://localhost:${PORT}`);
  console.log(`    тик ${C.TICK_HZ} Гц · снапшоты ${C.SNAPSHOT_HZ} Гц · до ${C.MATCH.maxPlayers} игроков в комнате`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nЗавершение…');
    wss.clients.forEach((ws) => ws.close(1001, 'server shutdown'));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
