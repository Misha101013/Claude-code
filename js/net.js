// Thin P2P networking layer on top of PeerJS's free public broker.
// Star topology: the host is the hub. Joiners only ever talk to the
// host; the host relays/broadcasts as needed. Host is authoritative
// for game state.

const ID_PREFIX = 'blendin-';

function randomCode(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.roomCode = null;
    this.myId = null; // stable per-player id used in game state (not the raw peer id)
    this.conns = new Map(); // playerId -> DataConnection (host only)
    this.hostConn = null; // joiner only
    this.handlers = {};
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, payload, fromId) {
    if (this.handlers[type]) this.handlers[type](payload, fromId);
  }

  async createRoom() {
    this.isHost = true;
    this.roomCode = randomCode();
    this.myId = 'host';
    await this._openPeer(ID_PREFIX + this.roomCode);
    this.peer.on('connection', (conn) => this._attachHostSide(conn));
    return this.roomCode;
  }

  async joinRoom(code) {
    this.isHost = false;
    this.roomCode = code.trim().toUpperCase();
    this.myId = 'p' + Math.random().toString(36).slice(2, 9);
    await this._openPeer(null);
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(ID_PREFIX + this.roomCode, { reliable: true });
      const timeout = setTimeout(() => reject(new Error('Комната не отвечает. Проверь код.')), 12000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.hostConn = conn;
        conn.on('data', (msg) => this._emit(msg.type, msg.payload, 'host'));
        conn.on('close', () => this._emit('host-disconnected', {}));
        resolve();
      });
      conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  _openPeer(id) {
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id) : new Peer();
      this.peer.on('open', () => resolve());
      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') reject(new Error('Такая комната уже существует, попробуй ещё раз.'));
        else reject(err);
      });
    });
  }

  _attachHostSide(conn) {
    conn.on('open', () => {
      conn.on('data', (msg) => {
        if (msg.type === 'join') {
          this.conns.set(msg.payload.playerId, conn);
          conn.playerId = msg.payload.playerId;
        }
        this._emit(msg.type, msg.payload, conn.playerId);
      });
      conn.on('close', () => {
        if (conn.playerId) {
          this.conns.delete(conn.playerId);
          this._emit('player-left', { playerId: conn.playerId });
        }
      });
    });
  }

  // Joiner -> host
  send(type, payload) {
    if (this.isHost) return;
    if (this.hostConn && this.hostConn.open) this.hostConn.send({ type, payload });
  }

  // Host -> everyone (including optional local echo handled by caller)
  broadcast(type, payload) {
    if (!this.isHost) return;
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send({ type, payload });
    }
  }

  // Host -> one player
  sendTo(playerId, type, payload) {
    const conn = this.conns.get(playerId);
    if (conn && conn.open) conn.send({ type, payload });
  }

  destroy() {
    try { this.peer && this.peer.destroy(); } catch (_) {}
  }
}
