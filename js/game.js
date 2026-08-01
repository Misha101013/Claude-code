import { Net } from './net.js';
import { sanitizeMatchSettings, matchSettings, tapsForHiderCount, roundsForPlayerCount } from './settings.js';

// Fractions of the seek clock at which a struggling seeker gets a hint.
// Later and wider than before: a hint only helps someone who's found
// nobody at all, and even then it's a broad, imprecise circle rather
// than a real lead.
const HINT_AT = [0.7, 0.88];

// ---------------------------------------------------------------------
// Scoring
//
// The two roles are scored on comparable ranges (~0..210) and the match
// runs one round per player by default, so seeking more often can't be
// what wins it. A hider is rewarded for surviving AND for actually
// camouflaging well, which keeps "wedge yourself into a dark corner"
// from being the only viable tactic. A seeker is rewarded for speed and
// for precision, since misses burn a limited tap budget.
// ---------------------------------------------------------------------

export function hiderScore({ foundAtSeconds, seekSeconds, blend }) {
  const survived = foundAtSeconds == null ? seekSeconds : foundAtSeconds;
  const survivalPts = Math.round(100 * Math.min(1, survived / Math.max(1, seekSeconds)));
  const neverFoundPts = foundAtSeconds == null ? 50 : 0;
  const blendPts = Math.round(60 * Math.max(0, Math.min(1, blend || 0)));
  return {
    survivalPts, neverFoundPts, blendPts,
    total: survivalPts + neverFoundPts + blendPts,
  };
}

export function seekerScore({ findTimes, hiderCount, seekSeconds, tapsLeft }) {
  let sum = 0;
  for (const t of findTimes) {
    sum += 60 + Math.round(60 * Math.max(0, 1 - t / Math.max(1, seekSeconds)));
  }
  // Normalised per hider: facing four hiders shouldn't be worth four
  // times a round spent facing one.
  const findPts = hiderCount > 0 ? Math.round(sum / hiderCount) : 0;
  const foundAllPts = hiderCount > 0 && findTimes.length >= hiderCount ? 40 : 0;
  const tapPts = Math.min(40, Math.max(0, tapsLeft) * 4);
  return { findPts, foundAllPts, tapPts, total: findPts + foundAllPts + tapPts };
}

export class Game {
  constructor() {
    this.net = new Net();
    this.handlers = {};
    this.players = new Map(); // id -> {id,name,color,character,isHost,totalScore}
    this.phase = 'menu'; // menu | lobby | hide | seek | results | match-end
    this.settings = sanitizeMatchSettings(matchSettings);
    this.round = null;
    this.match = null;
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
      this.players.set(fromId, {
        id: fromId, name: payload.name, color: payload.color,
        character: payload.character || 'cat', isHost: false, totalScore: 0,
        wantsSeeker: false,
      });
      this._broadcastPlayers();
      this.net.sendTo(fromId, 'match-config', { settings: this.settings });
    });

    n.on('player-left', ({ playerId }) => {
      if (!this.isHost) return;
      this.players.delete(playerId);
      this._broadcastPlayers();
      // A departure can be the thing that completes the hide phase, or
      // can strand a seek phase with nobody left to find.
      if (this.phase === 'hide') this._hostCheckHideComplete();
      else if (this.phase === 'seek') this._hostCheckSeekComplete();
    });

    n.on('host-disconnected', () => this._emit('fatal-error', 'Хост отключился — комната закрыта.'));
    n.on('host-reconnecting', (p) => this._emit('host-reconnecting', p));
    n.on('host-reconnected', () => this._emit('host-reconnected', {}));

    n.on('rejoin', (payload, fromId) => {
      if (!this.isHost) return;
      if (this.players.has(fromId)) {
        // Seat was held during the grace period — bring them back up to
        // speed on whatever broadcast they missed while disconnected.
        this._resendCurrentState(fromId);
      } else {
        // Reconnected too late: we already gave up their seat and told
        // everyone else. Say so plainly instead of leaving them
        // half-connected to a room that no longer recognises them.
        this.net.sendTo(fromId, 'kicked', {});
      }
    });
    n.on('kicked', () => this._emit('fatal-error', 'Не удалось переподключиться вовремя — место в комнате освободили. Зайди заново.'));

    n.on('players-update', (p) => this._applyPlayers(p));
    n.on('match-config', (p) => {
      this.settings = sanitizeMatchSettings(p.settings);
      this._emit('settings-changed', this.settings);
    });
    n.on('round-start', (p) => this._applyRoundStart(p));
    n.on('hide-progress', (p) => this._emit('hide-progress', p));
    n.on('peer-sprite', (p) => this._emit('peer-sprite', p));
    n.on('seek-start', (p) => this._applySeekStart(p));
    n.on('seek-event', (p) => this._emit('seek-event', p));
    n.on('hint', (p) => this._emit('hint', p));
    n.on('round-end', (p) => this._applyRoundEnd(p));
    n.on('await-photo', (p) => this._applyAwaitPhoto(p));
    n.on('match-end', (p) => this._applyMatchEnd(p));

    n.on('want-seeker', (payload, fromId) => {
      if (!this.isHost) return;
      const p = this.players.get(fromId);
      if (p) { p.wantsSeeker = !!payload.want; this._broadcastPlayers(); }
    });

    n.on('sprite-submit', (payload, fromId) => {
      if (this.isHost) this._hostReceiveSprite(fromId, payload);
    });
    n.on('seek-tap', (payload, fromId) => {
      if (this.isHost) this._hostReceiveTap(fromId, payload);
    });
  }

  _playersArray() { return Array.from(this.players.values()); }
  playerName(id) { const p = this.players.get(id); return p ? p.name : '???'; }
  playerColor(id) { const p = this.players.get(id); return p ? p.color : '#888'; }

  _broadcastPlayers() {
    const payload = { players: this._playersArray() };
    this._applyPlayers(payload);
    this.net.broadcast('players-update', payload);
  }

  _applyPlayers(payload) {
    this.players = new Map(payload.players.map((p) => [p.id, p]));
    this._emit('players-changed', this._playersArray());
  }

  // Best-effort catch-up for someone whose connection just came back:
  // replay whatever broadcast they might have missed while it was down.
  _resendCurrentState(playerId) {
    this.net.sendTo(playerId, 'players-update', { players: this._playersArray() });
    if (this.phase === 'hide' && this.round) {
      this.net.sendTo(playerId, 'round-start', {
        photoUrl: this.round.photoUrl,
        settings: this.settings,
        seekerId: this.round.seekerId,
        roundIndex: this.round.roundIndex,
        totalRounds: this.round.totalRounds,
        startedAt: this.round.startedAt,
      });
    } else if (this.phase === 'seek' && this.round) {
      this.net.sendTo(playerId, 'seek-start', {
        sprites: this.round.spriteList,
        seekerId: this.round.seekerId,
        seekSeconds: this.settings.seekSeconds,
        tapsAllowed: this.round.tapsAllowed,
        startedAt: this.round.seekStartedAt,
      });
    } else if (this.phase === 'lobby') {
      this.net.sendTo(playerId, 'await-photo', { roundNumber: this.match ? this.match.roundIndex : 0 });
    }
  }

  // ---------------- room ----------------

  async createRoom(profile) {
    const code = await this.net.createRoom();
    // Pick up anything changed in Settings before the room existed — the
    // constructor's snapshot is already stale by then.
    this.settings = sanitizeMatchSettings(matchSettings);
    this.me = { id: 'host', ...profile, isHost: true, totalScore: 0, wantsSeeker: false };
    this.players.set('host', this.me);
    this.phase = 'lobby';
    return code;
  }

  async joinRoom(code, profile) {
    await this.net.joinRoom(code);
    this.me = { id: this.net.myId, ...profile, isHost: false, totalScore: 0, wantsSeeker: false };
    this.net.send('join', { playerId: this.net.myId, ...profile });
    this.phase = 'lobby';
  }

  leave() {
    this._clearTimers();
    this.net.destroy();
    this.players.clear();
    this.round = null;
    this.match = null;
    this.phase = 'menu';
  }

  // A player raising (or lowering) their hand to seek next round. Hosts
  // apply it directly; joiners ask the host, who's the one deciding who
  // seeks next.
  setWantsSeeker(want) {
    if (this.isHost) {
      const p = this.players.get(this.myId);
      if (p) p.wantsSeeker = !!want;
      this._broadcastPlayers();
    } else {
      this.net.send('want-seeker', { want: !!want });
    }
  }

  hostUpdateSettings(settings) {
    if (!this.isHost) return;
    this.settings = sanitizeMatchSettings(settings);
    this.net.broadcast('match-config', { settings: this.settings });
    this._emit('settings-changed', this.settings);
  }

  _clearTimers() {
    clearTimeout(this._hideTimer);
    clearTimeout(this._seekTimer);
    for (const t of this._hintTimers || []) clearTimeout(t);
    this._hintTimers = [];
  }

  // ---------------- round: hide phase ----------------

  hostStartRound(photoDataUrl) {
    if (!this.isHost) return;
    const ids = this._playersArray().map((p) => p.id);
    if (ids.length < 2) return;

    if (!this.match) {
      this.match = {
        roundIndex: 0,
        totalRounds: roundsForPlayerCount(this.settings, ids.length),
        seekerHistory: [],
      };
      for (const p of this.players.values()) p.totalScore = 0;
    }

    // Random rather than join order, but still fair: everyone still gets
    // exactly one turn before anybody repeats (the pool reopens once it's
    // empty). Anyone who's raised their hand for this round jumps the
    // queue — picked at random if more than one volunteers — otherwise
    // it's a random draw from whoever hasn't sought yet.
    let pool = ids.filter((id) => !this.match.seekerHistory.includes(id));
    if (pool.length === 0) { this.match.seekerHistory = []; pool = ids.slice(); }
    const volunteers = pool.filter((id) => {
      const p = this.players.get(id);
      return p && p.wantsSeeker;
    });
    const chooseFrom = volunteers.length ? volunteers : pool;
    const seekerId = chooseFrom[Math.floor(Math.random() * chooseFrom.length)];
    this.match.seekerHistory.push(seekerId);
    const chosen = this.players.get(seekerId);
    if (chosen) chosen.wantsSeeker = false;
    this._broadcastPlayers();

    const payload = {
      photoUrl: photoDataUrl,
      settings: this.settings,
      seekerId,
      roundIndex: this.match.roundIndex,
      totalRounds: this.match.totalRounds,
      startedAt: Date.now(),
    };
    this._applyRoundStart(payload);
    this.net.broadcast('round-start', payload);

    this._clearTimers();
    // Safety net only: the phase normally ends as soon as every hider has
    // submitted. The extra slack covers a slow upload of the last sprite.
    this._hideTimer = setTimeout(
      () => this._hostFinishHidePhase(),
      this.settings.hideSeconds * 1000 + 2500,
    );
  }

  _applyRoundStart(payload) {
    this.phase = 'hide';
    this.settings = sanitizeMatchSettings(payload.settings);
    this.round = {
      photoUrl: payload.photoUrl,
      seekerId: payload.seekerId,
      roundIndex: payload.roundIndex,
      totalRounds: payload.totalRounds,
      startedAt: payload.startedAt,
      sprites: {},
      found: {},
      taps: 0,
      tapsAllowed: 0,
    };
    if (!this.match) {
      this.match = {
        roundIndex: payload.roundIndex,
        totalRounds: payload.totalRounds,
        seekerHistory: [],
      };
    }
    this.match.roundIndex = payload.roundIndex;
    this.match.totalRounds = payload.totalRounds;

    this._emit('round-started', {
      amSeeker: payload.seekerId === this.myId,
      photoUrl: payload.photoUrl,
      hideSeconds: this.settings.hideSeconds,
      startedAt: payload.startedAt,
      seekerId: payload.seekerId,
      seekerName: this.playerName(payload.seekerId),
      roundIndex: payload.roundIndex,
      totalRounds: payload.totalRounds,
      hiderIds: this._hiderIds(payload.seekerId),
    });
  }

  _hiderIds(seekerId = this.round && this.round.seekerId) {
    return this._playersArray().map((p) => p.id).filter((id) => id !== seekerId);
  }

  submitSprite(sprite) {
    if (this.isHost) this._hostReceiveSprite(this.myId, sprite);
    else this.net.send('sprite-submit', sprite);
  }

  _hostReceiveSprite(playerId, sprite) {
    if (!this.round || this.phase !== 'hide') return;
    if (this.round.sprites[playerId]) return;
    if (playerId === this.round.seekerId) return;
    this.round.sprites[playerId] = { ...sprite, playerId };
    const readyIds = Object.keys(this.round.sprites);
    this.net.broadcast('hide-progress', { readyIds });
    this._emit('hide-progress', { readyIds });
    this._relayPeerSprite(playerId, sprite);
    this._hostCheckHideComplete();
  }

  // Optional setting: once a hider finishes, show their spot (dimmed) to
  // the OTHER hiders still working — never to the seeker, who this
  // message is never sent to.
  _relayPeerSprite(playerId, sprite) {
    if (!this.settings.showHiders) return;
    const payload = {
      playerId,
      dataUrl: sprite.dataUrl,
      nx: sprite.nx,
      ny: sprite.ny,
      character: sprite.character || 'cat',
      scale: sprite.scale || 1,
    };
    for (const id of this._hiderIds()) {
      if (id === playerId) continue;
      if (id === this.myId) this._emit('peer-sprite', payload);
      else this.net.sendTo(id, 'peer-sprite', payload);
    }
  }

  _hostCheckHideComplete() {
    if (!this.round || this.phase !== 'hide') return;
    const hiderIds = this._hiderIds();
    if (hiderIds.length === 0) { this._hostFinishHidePhase(); return; }
    const readyIds = Object.keys(this.round.sprites);
    if (hiderIds.every((id) => readyIds.includes(id))) {
      clearTimeout(this._hideTimer);
      this._hostFinishHidePhase();
    }
  }

  _hostFinishHidePhase() {
    if (!this.round || this.phase !== 'hide') return;
    clearTimeout(this._hideTimer);

    const sprites = Object.values(this.round.sprites)
      .filter((s) => this.players.has(s.playerId))
      .map((s) => ({
        playerId: s.playerId,
        name: this.playerName(s.playerId),
        color: this.playerColor(s.playerId),
        dataUrl: s.dataUrl,
        nx: s.nx, ny: s.ny,
        character: s.character || 'cat',
        scale: s.scale || 1,
        blend: s.blend || 0,
      }));

    // Nobody managed to hide: there is nothing to seek, so close the
    // round out instead of dropping the seeker onto an empty photo.
    if (sprites.length === 0) {
      this.phase = 'seek'; // let _hostEndRound run its normal path
      this.round.spriteList = [];
      this.round.seekStartedAt = Date.now();
      this.round.tapsAllowed = 0;
      this._hostEndRound('no-hiders');
      return;
    }

    const tapsAllowed = tapsForHiderCount(this.settings, sprites.length);
    const payload = {
      sprites,
      seekerId: this.round.seekerId,
      seekSeconds: this.settings.seekSeconds,
      tapsAllowed,
      startedAt: Date.now(),
    };
    this._applySeekStart(payload);
    this.net.broadcast('seek-start', payload);

    this._seekTimer = setTimeout(
      () => this._hostEndRound('time'),
      this.settings.seekSeconds * 1000 + 800,
    );

    if (this.settings.hints) {
      this._hintTimers = HINT_AT.map((frac, i) => setTimeout(
        () => this._hostSendHint(i),
        this.settings.seekSeconds * 1000 * frac,
      ));
    }
  }

  // ---------------- round: seek phase ----------------

  _applySeekStart(payload) {
    this.phase = 'seek';
    this.round = {
      ...(this.round || {}),
      seekerId: payload.seekerId,
      spriteList: payload.sprites,
      found: {},
      taps: 0,
      tapsAllowed: payload.tapsAllowed,
      seekStartedAt: payload.startedAt,
    };
    this._emit('seek-started', {
      amSeeker: payload.seekerId === this.myId,
      sprites: payload.sprites,
      seekSeconds: payload.seekSeconds,
      tapsAllowed: payload.tapsAllowed,
      seekerName: this.playerName(payload.seekerId),
      photoUrl: this.round.photoUrl,
    });
  }

  reportTap({ targetPlayerId, hit, x, y }) {
    const payload = { targetPlayerId: hit ? targetPlayerId : null, hit, x, y };
    if (this.isHost) this._hostReceiveTap(this.myId, payload);
    else this.net.send('seek-tap', payload);
  }

  _hostReceiveTap(fromId, payload) {
    if (!this.round || this.phase !== 'seek') return;
    if (fromId !== this.round.seekerId) return;
    if (this.round.taps >= this.round.tapsAllowed) return;

    this.round.taps++;
    const foundAtSeconds = (Date.now() - this.round.seekStartedAt) / 1000;
    if (payload.hit && payload.targetPlayerId && this.round.found[payload.targetPlayerId] == null) {
      this.round.found[payload.targetPlayerId] = foundAtSeconds;
    }
    const event = {
      targetPlayerId: payload.hit ? payload.targetPlayerId : null,
      hit: !!payload.hit,
      x: payload.x, y: payload.y,
      foundAtSeconds,
      tapsLeft: Math.max(0, this.round.tapsAllowed - this.round.taps),
    };
    this._emit('seek-event', event);
    this.net.broadcast('seek-event', event);
    this._hostCheckSeekComplete();
  }

  _hostCheckSeekComplete() {
    if (!this.round || this.phase !== 'seek') return;
    const live = (this.round.spriteList || []).filter((s) => this.players.has(s.playerId));
    const foundCount = live.filter((s) => this.round.found[s.playerId] != null).length;
    if (live.length > 0 && foundCount >= live.length) this._hostEndRound('all-found');
    else if (this.round.taps >= this.round.tapsAllowed) this._hostEndRound('out-of-taps');
  }

  _hostSendHint(level) {
    if (!this.round || this.phase !== 'seek') return;
    // Once the seeker has found even one hider, they're no longer
    // "struggling" — no more hand-holding for the rest of the round.
    if (Object.keys(this.round.found).length > 0) return;
    const unfound = (this.round.spriteList || [])
      .filter((s) => this.round.found[s.playerId] == null && this.players.has(s.playerId));
    if (unfound.length === 0) return;
    const target = unfound[Math.floor(Math.random() * unfound.length)];
    // Jitter the centre so the hint narrows the search without handing
    // over the exact pixel. Radii are intentionally wide/imprecise.
    const radiusFrac = level === 0 ? 0.42 : 0.3;
    const jitter = radiusFrac * 0.45;
    const payload = {
      nx: Math.max(0.05, Math.min(0.95, target.nx + (Math.random() * 2 - 1) * jitter)),
      ny: Math.max(0.05, Math.min(0.95, target.ny + (Math.random() * 2 - 1) * jitter)),
      radiusFrac,
      level,
    };
    this._emit('hint', payload);
    this.net.broadcast('hint', payload);
  }

  // ---------------- round end ----------------

  _hostEndRound(reason) {
    if (!this.round || this.phase === 'results') return;
    this._clearTimers();

    const seekSeconds = this.settings.seekSeconds;
    const spriteList = this.round.spriteList || [];
    const live = spriteList.filter((s) => this.players.has(s.playerId));
    const rows = [];

    for (const s of live) {
      const foundAt = this.round.found[s.playerId] ?? null;
      const parts = hiderScore({ foundAtSeconds: foundAt, seekSeconds, blend: s.blend });
      rows.push({
        playerId: s.playerId, name: s.name, role: 'hider',
        foundAtSeconds: foundAt, blend: s.blend, parts, points: parts.total,
      });
    }

    // Hiders who never submitted anything still show up, at zero, so the
    // scoreboard explains itself rather than silently dropping them.
    for (const id of this._hiderIds()) {
      if (live.some((s) => s.playerId === id)) continue;
      rows.push({
        playerId: id, name: this.playerName(id), role: 'hider',
        noShow: true, points: 0,
        parts: { survivalPts: 0, neverFoundPts: 0, blendPts: 0, total: 0 },
      });
    }

    const findTimes = live
      .map((s) => this.round.found[s.playerId])
      .filter((t) => t != null);
    const seekParts = seekerScore({
      findTimes, hiderCount: live.length, seekSeconds,
      tapsLeft: Math.max(0, this.round.tapsAllowed - this.round.taps),
    });
    rows.push({
      playerId: this.round.seekerId, name: this.playerName(this.round.seekerId),
      role: 'seeker', finds: findTimes.length, hiderCount: live.length,
      tapsUsed: this.round.taps, tapsAllowed: this.round.tapsAllowed,
      parts: seekParts, points: seekParts.total,
    });

    for (const row of rows) {
      const p = this.players.get(row.playerId);
      if (p) p.totalScore = (p.totalScore || 0) + row.points;
    }

    this.match.roundIndex++;
    const isLast = this.match.roundIndex >= this.match.totalRounds;

    const payload = {
      rows, reason,
      roundNumber: this.match.roundIndex,
      totalRounds: this.match.totalRounds,
      isLast,
      revealSprites: live.map((s) => ({
        playerId: s.playerId, name: s.name, nx: s.nx, ny: s.ny,
        dataUrl: s.dataUrl, character: s.character, scale: s.scale,
        found: this.round.found[s.playerId] != null,
      })),
      totals: this._playersArray().map((p) => ({
        id: p.id, name: p.name, color: p.color, totalScore: p.totalScore || 0,
      })),
    };
    this._applyRoundEnd(payload);
    this.net.broadcast('round-end', payload);
  }

  _applyRoundEnd(payload) {
    this.phase = 'results';
    for (const t of payload.totals) {
      const p = this.players.get(t.id);
      if (p) p.totalScore = t.totalScore;
    }
    if (this.match) {
      this.match.roundIndex = payload.roundNumber;
      this.match.totalRounds = payload.totalRounds;
    }
    this._emit('round-ended', { ...payload, photoUrl: this.round ? this.round.photoUrl : null });
  }

  // ---------------- between rounds ----------------

  hostNextRound() {
    if (!this.isHost) return;
    this.phase = 'lobby';
    this.round = null;
    const payload = { roundNumber: this.match ? this.match.roundIndex : 0 };
    this.net.broadcast('await-photo', payload);
    this._applyAwaitPhoto(payload);
  }

  _applyAwaitPhoto(payload) {
    this.phase = 'lobby';
    this.round = null;
    this._emit('await-photo', payload);
  }

  hostFinishMatch() {
    if (!this.isHost) return;
    const payload = {
      totals: this._playersArray()
        .map((p) => ({ id: p.id, name: p.name, color: p.color, totalScore: p.totalScore || 0 }))
        .sort((a, b) => b.totalScore - a.totalScore),
      rounds: this.match ? this.match.totalRounds : 0,
    };
    this._applyMatchEnd(payload);
    this.net.broadcast('match-end', payload);
  }

  _applyMatchEnd(payload) {
    this.phase = 'match-end';
    this._emit('match-ended', payload);
  }

  hostResetMatch() {
    if (!this.isHost) return;
    this.match = null;
    for (const p of this.players.values()) { p.totalScore = 0; p.wantsSeeker = false; }
    this._broadcastPlayers();
    this.hostNextRound();
  }
}
