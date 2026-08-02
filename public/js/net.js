// Тонкая обёртка над WebSocket.

import { INPUT_RATE } from '/shared/config.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.inputAcc = 0;
    this.connected = false;
  }

  connect(name, room) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.emit('open');
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.emit(msg.t, msg);
    });
    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.emit('close');
    });
    this.ws.addEventListener('error', () => this.emit('error'));
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  sendInput(dt, player) {
    this.inputAcc += dt;
    if (this.inputAcc < 1 / INPUT_RATE) return;
    this.inputAcc = 0;
    this.send({
      t: 'input',
      x: Math.round(player.x * 100) / 100,
      z: Math.round(player.z * 100) / 100,
      yaw: Math.round(player.yaw * 1000) / 1000,
      m: player.moving ? 1 : 0,
      s: player.sprint ? 1 : 0,
    });
  }
}
