'use strict';

const C = require('./constants');

let nextEntityId = 1;
const eid = () => nextEntityId++;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// индексы типов для компактной сети
const PROJ_KINDS = ['fire', 'ice', 'bolt'];
const GROUND_KINDS = ['meteor', 'blizzard'];

// ─────────────────────────────────────────────────────────────
class Player {
  constructor(id, name, clsId, isBot = false) {
    const cls = C.CLASSES[clsId] || C.CLASSES.pyro;
    this.id = id;
    this.name = name;
    this.cls = cls.id;
    this.isBot = isBot;
    this.maxHp = cls.hp;
    this.speed = cls.speed;
    this.hp = cls.hp;
    this.mana = C.PLAYER.mana;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.aim = 0;
    this.mx = 0; this.my = 0; // желаемое направление движения (-1..1)
    this.alive = true;
    this.respawnAt = 0;
    this.cd = [0, 0, 0];
    this.dashCd = 0;
    this.dashTime = 0;
    this.dashVx = 0; this.dashVy = 0;
    this.slowMul = 1; this.slowUntil = 0;
    this.shield = 0;
    this.buffUntil = 0; this.speedMul = 1; this.cdMul = 1;
    this.burns = []; // {dps, until, from}
    this.protectUntil = 0;
    this.lastHitBy = null;
    this.lastHitAt = 0;
    this.kills = 0; this.deaths = 0; this.streak = 0; this.best = 0;
    this.ping = 0;
  }

  get abilities() { return C.CLASSES[this.cls].abilities; }

  statusBits(now) {
    let b = 0;
    if (this.slowUntil > now) b |= 1;
    if (this.shield > 0) b |= 2;
    if (this.buffUntil > now) b |= 4;
    if (this.protectUntil > now) b |= 8;
    if (this.dashTime > 0) b |= 16;
    return b;
  }
}

// ─────────────────────────────────────────────────────────────
class World {
  constructor(name = 'arena') {
    this.name = name;
    this.now = 0; // игровое время в секундах
    this.players = new Map();
    this.projectiles = [];
    this.grounds = [];
    this.pickups = C.PICKUP_SPOTS.map((s, i) => ({
      id: i + 1, x: s.x, y: s.y, kind: s.kind, readyAt: 0,
    }));
    this.fx = [];
    this.feed = [];
    this.state = 'play';
    this.timeLeft = C.MATCH.duration;
    this.stateUntil = 0;
    this.rosterDirty = true;
  }

  // ── участники ──────────────────────────────────────────────
  addPlayer(id, name, clsId, isBot = false) {
    const p = new Player(id, name, clsId, isBot);
    this.players.set(id, p);
    this.respawn(p, true);
    this.rosterDirty = true;
    return p;
  }

  removePlayer(id) {
    if (this.players.delete(id)) this.rosterDirty = true;
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  freeSpawn() {
    let best = C.SPAWNS[0], bestScore = -1;
    for (const s of C.SPAWNS) {
      let nearest = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        nearest = Math.min(nearest, dist2(s.x, s.y, p.x, p.y));
      }
      const score = nearest === Infinity ? Math.random() * 1e9 : nearest;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  respawn(p, initial = false) {
    const s = this.freeSpawn();
    p.x = s.x + (Math.random() - 0.5) * 40;
    p.y = s.y + (Math.random() - 0.5) * 40;
    p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.mana = C.PLAYER.mana;
    p.alive = true;
    p.shield = 0;
    p.burns.length = 0;
    p.slowUntil = 0; p.slowMul = 1;
    p.buffUntil = 0; p.speedMul = 1; p.cdMul = 1;
    p.dashTime = 0;
    p.cd = [0, 0, 0];
    p.dashCd = 0;
    p.protectUntil = this.now + (initial ? 1 : C.PLAYER.spawnProtect);
    this.fx.push({ k: 'spawn', x: Math.round(p.x), y: Math.round(p.y) });
  }

  // ── ввод ───────────────────────────────────────────────────
  setInput(id, mx, my, aim) {
    const p = this.players.get(id);
    if (!p) return;
    if (Number.isFinite(mx) && Number.isFinite(my)) {
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      p.mx = clamp(mx, -1, 1);
      p.my = clamp(my, -1, 1);
    }
    if (Number.isFinite(aim)) p.aim = aim;
  }

  cast(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.state !== 'play') return;
    if (slot === 3) return this.doDash(p);
    const ab = p.abilities[slot];
    if (!ab) return;
    if (p.cd[slot] > 0 || p.mana < ab.mana) return;

    p.mana -= ab.mana;
    p.cd[slot] = ab.cd * (p.buffUntil > this.now ? p.cdMul : 1);
    p.protectUntil = Math.min(p.protectUntil, this.now); // атака снимает защиту спавна

    switch (ab.type) {
      case 'proj': this.spawnProj(p, ab.proj, p.aim); break;
      case 'multi': {
        const step = ab.spread / Math.max(1, ab.count - 1);
        const start = p.aim - ab.spread / 2;
        for (let i = 0; i < ab.count; i++) this.spawnProj(p, ab.proj, start + step * i);
        this.fx.push({ k: 'cast', x: Math.round(p.x), y: Math.round(p.y), c: C.CLASSES[p.cls].color });
        break;
      }
      case 'nova': {
        this.fx.push({ k: 'nova', x: Math.round(p.x), y: Math.round(p.y), r: ab.radius, c: C.CLASSES[p.cls].color });
        for (const t of this.players.values()) {
          if (t === p || !t.alive) continue;
          if (dist2(t.x, t.y, p.x, p.y) > ab.radius * ab.radius) continue;
          this.damage(t, ab.dmg, p, ab.id);
          if (ab.slow) this.applySlow(t, ab.slow);
        }
        break;
      }
      case 'meteor': {
        const d = Math.min(ab.range, 1e9);
        const tx = clamp(p.x + Math.cos(p.aim) * d, 40, C.WORLD.w - 40);
        const ty = clamp(p.y + Math.sin(p.aim) * d, 40, C.WORLD.h - 40);
        this.grounds.push({
          id: eid(), owner: p.id, x: tx, y: ty, r: ab.radius,
          kind: ab.kind === 'ice' ? 'blizzard' : 'meteor',
          fireAt: this.now + ab.delay, born: this.now, delay: ab.delay,
          dmg: ab.dmg, ticksLeft: ab.ticks || 1, tickTime: ab.tickTime || 0,
          nextTick: this.now + ab.delay, slow: ab.slow || null, burn: ab.burn || null,
          spell: ab.id,
        });
        break;
      }
      case 'chain': this.chainLightning(p, ab); break;
      case 'buff': {
        p.buffUntil = this.now + ab.time;
        p.speedMul = ab.speedMul;
        p.cdMul = ab.cdMul;
        p.shield = Math.max(p.shield, ab.shield);
        this.fx.push({ k: 'buff', x: Math.round(p.x), y: Math.round(p.y), c: C.CLASSES[p.cls].color });
        break;
      }
    }
  }

  doDash(p) {
    if (!p.alive || p.dashCd > 0 || p.mana < C.DASH.mana || this.state !== 'play') return;
    p.mana -= C.DASH.mana;
    p.dashCd = C.DASH.cd;
    p.dashTime = C.DASH.time;
    const a = (p.mx || p.my) ? Math.atan2(p.my, p.mx) : p.aim;
    const v = C.DASH.dist / C.DASH.time;
    p.dashVx = Math.cos(a) * v;
    p.dashVy = Math.sin(a) * v;
    this.fx.push({ k: 'dash', x: Math.round(p.x), y: Math.round(p.y), a: +a.toFixed(2) });
  }

  spawnProj(owner, d, angle) {
    this.projectiles.push({
      id: eid(), owner: owner.id, kind: d.kind,
      x: owner.x + Math.cos(angle) * (C.PLAYER.r + 6),
      y: owner.y + Math.sin(angle) * (C.PLAYER.r + 6),
      vx: Math.cos(angle) * d.speed, vy: Math.sin(angle) * d.speed,
      r: d.r, dmg: d.dmg, ttl: d.ttl, angle,
      aoe: d.aoe || 0, aoeDmg: d.aoeDmg || 0,
      slow: d.slow || null, pierce: d.pierce || 0, hits: null,
    });
  }

  chainLightning(p, ab) {
    const hit = [];
    let from = p;
    let dmg = ab.dmg;
    let range = ab.range;
    const points = [[Math.round(p.x), Math.round(p.y)]];
    for (let j = 0; j <= ab.jumps; j++) {
      let target = null, bestD = range * range;
      for (const t of this.players.values()) {
        if (t === p || !t.alive || hit.includes(t.id)) continue;
        if (t.protectUntil > this.now) continue;
        const d = dist2(t.x, t.y, from.x, from.y);
        if (d < bestD && this.lineClear(from.x, from.y, t.x, t.y)) { bestD = d; target = t; }
      }
      if (!target) break;
      hit.push(target.id);
      points.push([Math.round(target.x), Math.round(target.y)]);
      this.damage(target, dmg, p, ab.id);
      from = target;
      dmg *= ab.falloff;
      range = ab.jumpRange;
    }
    this.fx.push({ k: 'chain', pts: points, c: C.CLASSES[p.cls].color2 });
  }

  // ── геометрия ──────────────────────────────────────────────
  lineClear(x1, y1, x2, y2) {
    for (const o of C.OBSTACLES) {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((o.x - x1) * dx + (o.y - y1) * dy) / len2;
      t = clamp(t, 0, 1);
      const px = x1 + dx * t, py = y1 + dy * t;
      if (dist2(px, py, o.x, o.y) < o.r * o.r) return false;
    }
    return true;
  }

  resolveObstacles(p) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { // страховка от битого ввода
      const s = this.freeSpawn();
      p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.mx = p.my = 0;
    }
    for (const o of C.OBSTACLES) {
      const dx = p.x - o.x, dy = p.y - o.y;
      const rr = o.r + C.PLAYER.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.0001;
        p.x = o.x + (dx / d) * rr;
        p.y = o.y + (dy / d) * rr;
      }
    }
    p.x = clamp(p.x, C.PLAYER.r, C.WORLD.w - C.PLAYER.r);
    p.y = clamp(p.y, C.PLAYER.r, C.WORLD.h - C.PLAYER.r);
  }

  // ── урон и смерть ──────────────────────────────────────────
  applySlow(t, slow) {
    if (t.protectUntil > this.now) return;
    t.slowMul = Math.min(t.slowUntil > this.now ? t.slowMul : 1, slow.mul);
    t.slowUntil = Math.max(t.slowUntil, this.now + slow.time);
  }

  damage(target, amount, attacker, spell) {
    if (!target.alive || amount <= 0) return 0;
    if (target.protectUntil > this.now) return 0;
    let left = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, left);
      target.shield -= absorbed;
      left -= absorbed;
      this.fx.push({ k: 'shield', x: Math.round(target.x), y: Math.round(target.y) });
    }
    target.hp -= left;
    target.lastHitAt = this.now;
    if (attacker && attacker.id !== target.id) target.lastHitBy = attacker.id;
    this.fx.push({ k: 'dmg', x: Math.round(target.x), y: Math.round(target.y - 24), v: Math.round(amount), o: attacker ? attacker.id : 0 });

    if (target.hp <= 0) this.kill(target, attacker, spell);
    return amount;
  }

  kill(victim, attacker, spell) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.now + C.PLAYER.respawn;
    this.fx.push({ k: 'death', x: Math.round(victim.x), y: Math.round(victim.y), c: C.CLASSES[victim.cls].color });

    let killer = attacker;
    if (!killer || killer.id === victim.id) {
      killer = victim.lastHitBy && this.now - victim.lastHitAt < 6
        ? this.players.get(victim.lastHitBy) : null;
    }
    if (killer && killer.id !== victim.id && killer.alive !== undefined) {
      killer.kills++;
      killer.streak++;
      killer.best = Math.max(killer.best, killer.streak);
      killer.hp = Math.min(killer.maxHp, killer.hp + 20); // награда за добивание
    }
    this.feed.push({
      a: killer ? killer.name : null,
      v: victim.name,
      s: spell || 'hit',
      st: killer ? killer.streak : 0,
    });
    this.rosterDirty = true;
  }

  // ── основной шаг симуляции ────────────────────────────────
  update(dt) {
    this.now += dt;

    if (this.state === 'play') {
      this.timeLeft -= dt;
      const top = this.topScore();
      if (this.timeLeft <= 0 || top >= C.MATCH.scoreLimit) this.endMatch();
    } else if (this.now >= this.stateUntil) {
      this.startMatch();
    }

    this.updatePlayers(dt);
    this.updateProjectiles(dt);
    this.updateGrounds();
    this.updatePickups();
  }

  updatePlayers(dt) {
    for (const p of this.players.values()) {
      p.cd[0] = Math.max(0, p.cd[0] - dt);
      p.cd[1] = Math.max(0, p.cd[1] - dt);
      p.cd[2] = Math.max(0, p.cd[2] - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);

      if (!p.alive) {
        if (this.now >= p.respawnAt) this.respawn(p);
        continue;
      }

      if (p.buffUntil <= this.now) { p.speedMul = 1; p.cdMul = 1; }
      if (p.slowUntil <= this.now) p.slowMul = 1;

      p.mana = Math.min(C.PLAYER.mana, p.mana + C.PLAYER.manaRegen * dt);
      if (this.now - p.lastHitAt > C.PLAYER.outOfCombat) {
        p.hp = Math.min(p.maxHp, p.hp + C.PLAYER.hpRegen * dt);
      }

      // горение
      if (p.burns.length) {
        for (let i = p.burns.length - 1; i >= 0; i--) {
          const b = p.burns[i];
          this.damage(p, b.dps * dt, this.players.get(b.from) || null, 'burn');
          if (this.now >= b.until) p.burns.splice(i, 1);
        }
        if (!p.alive) continue;
      }

      // движение
      if (p.dashTime > 0) {
        p.dashTime -= dt;
        p.x += p.dashVx * dt;
        p.y += p.dashVy * dt;
      } else {
        const sp = p.speed * p.speedMul * p.slowMul;
        p.vx = p.mx * sp;
        p.vy = p.my * sp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.resolveObstacles(p);
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.ttl -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      let dead = pr.ttl <= 0;

      if (!dead && (pr.x < 0 || pr.y < 0 || pr.x > C.WORLD.w || pr.y > C.WORLD.h)) dead = true;

      if (!dead) {
        for (const o of C.OBSTACLES) {
          if (dist2(pr.x, pr.y, o.x, o.y) < (o.r + pr.r) * (o.r + pr.r)) { dead = true; break; }
        }
      }

      if (!dead) {
        for (const t of this.players.values()) {
          if (!t.alive || t.id === pr.owner) continue;
          if (pr.hits && pr.hits.includes(t.id)) continue;
          if (t.protectUntil > this.now) continue;
          const rr = C.PLAYER.r + pr.r;
          if (dist2(pr.x, pr.y, t.x, t.y) > rr * rr) continue;

          const owner = this.players.get(pr.owner) || null;
          this.damage(t, pr.dmg, owner, pr.kind);
          if (pr.slow) this.applySlow(t, pr.slow);
          if (pr.pierce > 0) {
            pr.pierce--;
            (pr.hits || (pr.hits = [])).push(t.id);
          } else { dead = true; }
          break;
        }
      }

      if (dead) {
        this.explode(pr);
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(pr) {
    this.fx.push({ k: 'hit', x: Math.round(pr.x), y: Math.round(pr.y), kd: pr.kind, r: pr.aoe || 0 });
    if (!pr.aoe) return;
    const owner = this.players.get(pr.owner) || null;
    for (const t of this.players.values()) {
      if (!t.alive || t.id === pr.owner) continue;
      if (pr.hits && pr.hits.includes(t.id)) continue;
      if (dist2(t.x, t.y, pr.x, pr.y) > pr.aoe * pr.aoe) continue;
      this.damage(t, pr.aoeDmg, owner, pr.kind);
    }
  }

  updateGrounds() {
    for (let i = this.grounds.length - 1; i >= 0; i--) {
      const g = this.grounds[i];
      if (this.now < g.nextTick) continue;
      const owner = this.players.get(g.owner) || null;
      for (const t of this.players.values()) {
        if (!t.alive) continue;
        if (dist2(t.x, t.y, g.x, g.y) > g.r * g.r) continue;
        this.damage(t, g.dmg, owner, g.spell);
        if (g.slow) this.applySlow(t, g.slow);
        if (g.burn) t.burns.push({ dps: g.burn.dps, until: this.now + g.burn.time, from: g.owner });
      }
      this.fx.push({ k: 'boom', x: Math.round(g.x), y: Math.round(g.y), r: g.r, kd: g.kind });
      g.ticksLeft--;
      g.nextTick = this.now + g.tickTime;
      if (g.ticksLeft <= 0) this.grounds.splice(i, 1);
    }
  }

  updatePickups() {
    for (const pk of this.pickups) {
      if (this.now < pk.readyAt) continue;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const rr = C.PLAYER.r + C.PICKUP.r;
        if (dist2(p.x, p.y, pk.x, pk.y) > rr * rr) continue;
        if (pk.kind === 'hp') {
          if (p.hp >= p.maxHp) continue;
          p.hp = Math.min(p.maxHp, p.hp + C.PICKUP.hp);
        } else {
          if (p.mana >= C.PLAYER.mana) continue;
          p.mana = Math.min(C.PLAYER.mana, p.mana + C.PICKUP.mana);
        }
        pk.readyAt = this.now + C.PICKUP.respawn;
        this.fx.push({ k: 'pick', x: pk.x, y: pk.y, kd: pk.kind });
        break;
      }
    }
  }

  // ── матч ───────────────────────────────────────────────────
  topScore() {
    let m = 0;
    for (const p of this.players.values()) m = Math.max(m, p.kills);
    return m;
  }

  endMatch() {
    this.state = 'end';
    this.stateUntil = this.now + C.MATCH.intermission;
    this.timeLeft = 0;
    this.projectiles.length = 0;
    this.grounds.length = 0;
    this.rosterDirty = true;
  }

  startMatch() {
    this.state = 'play';
    this.timeLeft = C.MATCH.duration;
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.streak = 0; p.best = 0;
      this.respawn(p, true);
    }
    this.feed.push({ a: null, v: null, s: 'newmatch' });
    this.rosterDirty = true;
  }

  // ── сеть ───────────────────────────────────────────────────
  snapshot() {
    const p = [];
    for (const pl of this.players.values()) {
      p.push([
        pl.id,
        Math.round(pl.x), Math.round(pl.y),
        +pl.aim.toFixed(2),
        Math.round(Math.max(0, pl.hp)), pl.maxHp,
        Math.round(pl.mana),
        pl.alive ? 1 : 0,
        pl.statusBits(this.now),
        pl.kills, pl.deaths,
        pl.alive ? 0 : +Math.max(0, pl.respawnAt - this.now).toFixed(1),
      ]);
    }
    const b = this.projectiles.map((x) => [
      x.id, Math.round(x.x), Math.round(x.y), PROJ_KINDS.indexOf(x.kind), x.r, +x.angle.toFixed(2),
    ]);
    const g = this.grounds.map((x) => [
      x.id, Math.round(x.x), Math.round(x.y), x.r, GROUND_KINDS.indexOf(x.kind),
      +clamp((this.now - x.born) / Math.max(0.001, x.delay), 0, 1).toFixed(2),
    ]);
    const k = this.pickups.map((x) => [x.id, x.x, x.y, x.kind === 'hp' ? 0 : 1, this.now >= x.readyAt ? 1 : 0]);

    const snap = {
      t: 's',
      ts: Date.now(),
      st: this.state,
      tl: Math.max(0, Math.round(this.timeLeft)),
      p, b, g, k,
      fx: this.fx,
      f: this.feed,
    };
    this.fx = [];
    this.feed = [];
    return snap;
  }

  roster() {
    const list = [];
    for (const p of this.players.values()) {
      list.push({ id: p.id, name: p.name, cls: p.cls, bot: p.isBot, k: p.kills, d: p.deaths, best: p.best });
    }
    list.sort((a, b) => b.k - a.k || a.d - b.d);
    this.rosterDirty = false;
    return { t: 'roster', list, st: this.state };
  }
}

module.exports = { World, Player, PROJ_KINDS, GROUND_KINDS };
