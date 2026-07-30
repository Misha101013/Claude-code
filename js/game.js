import { Net } from './net.js';

const SEEK_SECONDS = 60;

function scoreForHider(foundAtSeconds, seekSeconds) {
  const survived = foundAtSeconds == null ? seekSeconds : foundAtSeconds;
  return Math.round(survived * 3);
}
function scoreForSeekerFind(foundAtSeconds) {
  return Math.max(15, 70 - Math.round(foundAtSeconds));
}

// Event emitter + P2P game state machine. Both host and joiners run the
// exact same `_apply*` handlers so UI code never needs to branch on role
// except to decide "am I the seeker right now" for input handling.
export class Game {
  constructor() {
    this.net = new Net();
    this.handlers = {};
    this.players = new Map(); // id -> {id,name,color,isHost,totalScore}
    this.phase = 'home';
    this.round = null; // {photoUrl, hideSeconds, seekSeconds, seekerId, sprites:{}, found:{}, startedAt}
    this.seekerIndex = -1;
    this.me = null;

    this._wireNet();
  }

  on(type, fn) { this.handlers[type] = fn; }
  _emit(type, payload) { if (this.handlers[type]) this.handlers[type](payload); }

  get isHost() { return this.net.isHost; }
  get myId() { return this.net.myId; }

  _wireNet() {
    const n = this.net;
    n.on('join', (payload, fromId) => {
      if (!this.isHost) return;
      this.players.set(fromId, { id: fromId, name: payload.name, color: payload.color, isHost: false, totalScore: 0 });
      this._broadcastPlayers();
    });
    n.on('player-left', ({ playerId }) => {
      if (!this.isHost) return;
      this.players.delete(playerId);
      this._broadcastPlayers();
    });
    n.on('host-disconnected', () => this._emit('fatal-error', 'Хост отключился.'));

    n.on('players-update', (p) => this._applyPlayers(p));
    n.on('round-start', (p) => this._applyRoundStart(p));
    n.on('hide-progress', (p) => this._emit('hide-progress', p));
    n.on('seek-start', (p) => this._applySeekStart(p));
    n.on('seek-event', (p) => this._applySeekEvent(p));
    n.on('round-end', (p) => this._applyRoundEnd(p));
    n.on('back-to-lobby', () => { this.phase = 'lobby'; this._emit('lobby', this._playersArray()); });

    n.on('sprite-submit', (payload, fromId) => {
      if (!this.isHost) return;
      this._hostReceiveSprite(fromId, payload);
    });
    n.on('seek-tap-result', (payload, fromId) => {
      if (!this.isHost) return;
      this._hostReceiveTap(fromId, payload);
    });
  }

  _playersArray() { return Array.from(this.players.values()); }

  _broadcastPlayers() {
    const payload = { players: this._playersArray() };
    this._applyPlayers(payload);
    this.net.broadcast('players-update', payload);
  }
  _applyPlayers(payload) {
    this.players = new Map(payload.players.map((p) => [p.id, p]));
    this._emit('players-changed', this._playersArray());
  }

  // ---------------- lobby ----------------

  async createRoom(name, color) {
    const code = await this.net.createRoom();
    this.me = { id: 'host', name, color, isHost: true, totalScore: 0 };
    this.players.set('host', this.me);
    this.phase = 'lobby';
    return code;
  }

  async joinRoom(code, name, color) {
    await this.net.joinRoom(code);
    this.me = { id: this.net.myId, name, color, isHost: false, totalScore: 0 };
    this.net.send('join', { playerId: this.net.myId, name, color });
    this.phase = 'lobby';
  }

  leave() {
    this.net.destroy();
    this.players.clear();
    this.phase = 'home';
  }

  // ---------------- round: hide phase ----------------

  hostStartRound(photoDataUrl, hideSeconds) {
    if (!this.isHost) return;
    const ids = this._playersArray().map((p) => p.id);
    this.seekerIndex = (this.seekerIndex + 1) % ids.length;
    const seekerId = ids[this.seekerIndex];
    const payload = { photoUrl: photoDataUrl, hideSeconds, seekSeconds: SEEK_SECONDS, seekerId, startedAt: Date.now() };
    this._applyRoundStart(payload);
    this.net.broadcast('round-start', payload);

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._hostFinishHidePhase(), hideSeconds * 1000 + 1500);
  }

  _applyRoundStart(payload) {
    this.phase = 'hide';
    this.round = { ...payload, sprites: {}, found: {} };
    const amSeeker = payload.seekerId === this.myId;
    this._emit('round-started', {
      amSeeker,
      photoUrl: payload.photoUrl,
      hideSeconds: payload.hideSeconds,
      seekerName: this._nameOf(payload.seekerId),
      hiderIds: this._playersArray().map((p) => p.id).filter((id) => id !== payload.seekerId),
    });
  }

  _nameOf(id) { const p = this.players.get(id); return p ? p.name : '???'; }

  submitSprite(sprite) {
    if (this.isHost) this._hostReceiveSprite(this.myId, sprite);
    else this.net.send('sprite-submit', sprite);
  }

  _hostReceiveSprite(playerId, sprite) {
    if (!this.round || this.round.sprites[playerId]) return;
    this.round.sprites[playerId] = { ...sprite, playerId };
    const hiderIds = this._playersArray().map((p) => p.id).filter((id) => id !== this.round.seekerId);
    const readyIds = Object.keys(this.round.sprites);
    this.net.broadcast('hide-progress', { readyIds });
    this._emit('hide-progress', { readyIds });
    if (hiderIds.every((id) => readyIds.includes(id))) {
      clearTimeout(this._hideTimer);
      this._hostFinishHidePhase();
    }
  }

  _hostFinishHidePhase() {
    if (!this.round || this.phase === 'seek') return;
    const sprites = Object.values(this.round.sprites).map((s) => ({
      playerId: s.playerId, name: this._nameOf(s.playerId), color: (this.players.get(s.playerId) || {}).color,
      dataUrl: s.dataUrl, nx: s.nx, ny: s.ny,
    }));
    const payload = { sprites, seekSeconds: this.round.seekSeconds, seekerId: this.round.seekerId, startedAt: Date.now() };
    this._applySeekStart(payload);
    this.net.broadcast('seek-start', payload);
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => this._hostEndRound(), this.round.seekSeconds * 1000 + 1000);
  }

  _applySeekStart(payload) {
    this.phase = 'seek';
    this.round = { ...this.round, sprites: this.round?.sprites || {}, found: {}, seekStartedAt: payload.startedAt, spriteList: payload.sprites };
    const amSeeker = payload.seekerId === this.myId;
    this._emit('seek-started', {
      amSeeker,
      sprites: payload.sprites,
      seekSeconds: payload.seekSeconds,
      seekerName: this._nameOf(payload.seekerId),
      hiderNames: payload.sprites.map((s) => ({ id: s.playerId, name: s.name })),
    });
  }

  // ---------------- round: seek phase ----------------

  reportTap({ targetPlayerId, hit, x, y }) {
    const foundAtSeconds = (Date.now() - (this.round?.seekStartedAt || Date.now())) / 1000;
    const payload = { targetPlayerId: hit ? targetPlayerId : null, hit, x, y, foundAtSeconds };
    if (this.isHost) this._hostReceiveTap(this.myId, payload);
    else this.net.send('seek-tap-result', payload);
  }

  _hostReceiveTap(_fromId, payload) {
    if (!this.round || this.phase !== 'seek') return;
    if (payload.hit && payload.targetPlayerId && this.round.found[payload.targetPlayerId] == null) {
      this.round.found[payload.targetPlayerId] = payload.foundAtSeconds;
    }
    this._applySeekEvent(payload);
    this.net.broadcast('seek-event', payload);

    const totalHiders = (this.round.spriteList || []).length;
    const foundCount = Object.keys(this.round.found).length;
    if (payload.hit && totalHiders > 0 && foundCount >= totalHiders) {
      clearTimeout(this._seekTimer);
      this._hostEndRound();
    }
  }

  _applySeekEvent(payload) { this._emit('seek-event', payload); }

  _hostEndRound() {
    if (!this.round || this.phase === 'results') return;
    const seekSeconds = this.round.seekSeconds;
    const scores = [];
    for (const s of this.round.spriteList || []) {
      const foundAt = this.round.found[s.playerId] ?? null;
      const pts = scoreForHider(foundAt, seekSeconds);
      scores.push({ playerId: s.playerId, name: s.name, points: pts, foundAtSeconds: foundAt, role: 'hider' });
      const p = this.players.get(s.playerId);
      if (p) p.totalScore = (p.totalScore || 0) + pts;
    }
    let seekerPts = 0;
    for (const sec of Object.values(this.round.found)) seekerPts += scoreForSeekerFind(sec);
    const seekerP = this.players.get(this.round.seekerId);
    if (seekerP) seekerP.totalScore = (seekerP.totalScore || 0) + seekerPts;
    scores.push({ playerId: this.round.seekerId, name: this._nameOf(this.round.seekerId), points: seekerPts, role: 'seeker' });

    const payload = { scores, totals: this._playersArray().map((p) => ({ id: p.id, name: p.name, totalScore: p.totalScore || 0 })) };
    this._applyRoundEnd(payload);
    this.net.broadcast('round-end', payload);
  }

  _applyRoundEnd(payload) {
    this.phase = 'results';
    for (const t of payload.totals) { const p = this.players.get(t.id); if (p) p.totalScore = t.totalScore; }
    this._emit('round-ended', payload);
  }

  playAgain() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    this.round = null;
    this.net.broadcast('back-to-lobby', {});
    this._emit('lobby', this._playersArray());
  }
}
