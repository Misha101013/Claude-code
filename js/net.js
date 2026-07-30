// Thin P2P networking layer on top of PeerJS's free public broker.
// Star topology: the host is the hub. Joiners only ever talk to the
// host; the host relays/broadcasts as needed. Host is authoritative
// for game state.
//
// Mobile connections blip constantly — a screen lock, a native photo
// picker taking over the foreground, a tower handoff — and WebRTC does
// not recover from that on its own. A dropped DataConnection is treated
// as "probably temporary" on both ends: the joiner retries the connect
// with backoff, and the host holds the player's seat open for a few
// seconds before actually removing them, so a quick reconnect is
// invisible instead of ending the game.

const ID_PREFIX = 'blendin-';
const HOST_GRACE_MS = 7000;
const RECONNECT_ATTEMPTS = 5;

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
    this.destroyed = false;
    this._pendingDeparture = new Map(); // host only: playerId -> timeout
    this._reconnectAttempt = 0;
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, payload, fromId) {
    if (this.handlers[type]) this.handlers[type](payload, fromId);
  }

  async createRoom(desiredCode) {
    this.isHost = true;
    this.roomCode = (desiredCode || randomCode()).toUpperCase();
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
    await this._connectToHost();
  }

  _connectToHost() {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(ID_PREFIX + this.roomCode, { reliable: true });
      const timeout = setTimeout(() => reject(new Error('Комната не отвечает. Проверь код.')), 12000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.hostConn = conn;
        this._reconnectAttempt = 0;
        conn.on('data', (msg) => this._emit(msg.type, msg.payload, 'host'));
        conn.on('close', () => this._handleHostConnLost());
        resolve();
      });
      conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  _handleHostConnLost() {
    if (this.destroyed) return;
    this._reconnectAttempt += 1;
    if (this._reconnectAttempt > RECONNECT_ATTEMPTS) {
      this._emit('host-disconnected', {});
      return;
    }
    this._emit('host-reconnecting', { attempt: this._reconnectAttempt });
    const delay = Math.min(1200 * this._reconnectAttempt, 5000);
    setTimeout(() => {
      if (this.destroyed) return;
      this._connectToHost()
        .then(() => {
          // A fresh DataConnection has no memory of who we were — tell
          // the host so it re-associates this connection with our
          // existing seat instead of removing us for good.
          this.send('rejoin', { playerId: this.myId });
          this._emit('host-reconnected', {});
        })
        .catch(() => this._handleHostConnLost());
    }, delay);
  }

  _openPeer(id) {
    return new Promise((resolve, reject) => {
      this.peer = id ? new Peer(id) : new Peer();
      this.peer.on('open', () => resolve());
      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') reject(new Error('Такая комната уже существует, попробуй ещё раз.'));
        else reject(err);
      });
      this.peer.on('disconnected', () => {
        // Lost the signalling socket (used only to open NEW connections —
        // existing ones are unaffected). Reconnecting it is the
        // PeerJS-recommended recovery and needs no coordination with
        // anyone else.
        if (this.destroyed) return;
        setTimeout(() => {
          if (!this.destroyed && this.peer && !this.peer.destroyed) this.peer.reconnect();
        }, 800);
      });
    });
  }

  _attachHostSide(conn) {
    conn.on('open', () => {
      conn.on('data', (msg) => {
        if (msg.type === 'join' || msg.type === 'rejoin') {
          const pid = msg.payload.playerId;
          const pending = this._pendingDeparture.get(pid);
          if (pending) { clearTimeout(pending); this._pendingDeparture.delete(pid); }
          this.conns.set(pid, conn);
          conn.playerId = pid;
        }
        this._emit(msg.type, msg.payload, conn.playerId);
      });
      conn.on('close', () => {
        const pid = conn.playerId;
        if (!pid) return;
        // Hold the seat: only actually drop them if nobody reconnects
        // with this playerId before the grace period elapses.
        const timer = setTimeout(() => {
          this._pendingDeparture.delete(pid);
          if (this.conns.get(pid) === conn) {
            this.conns.delete(pid);
            this._emit('player-left', { playerId: pid });
          }
        }, HOST_GRACE_MS);
        this._pendingDeparture.set(pid, timer);
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
    this.destroyed = true;
    for (const t of this._pendingDeparture.values()) clearTimeout(t);
    this._pendingDeparture.clear();
    try { this.peer && this.peer.destroy(); } catch (_) {}
  }
}
