'use strict';

const C = require('./constants');

const BOT_NAMES = [
  'Мерлин', 'Гэндальф', 'Моргана', 'Зельда', 'Радагаст', 'Цирцея', 'Некрос',
  'Астра', 'Вельзевул', 'Кассандра', 'Гримуар', 'Фьорд', 'Ксантия', 'Орфей',
];

const rnd = (a, b) => a + Math.random() * (b - a);

// Простой, но живой ИИ: держит дистанцию, стреляет с упреждением,
// уходит с линии огня, лечится на пикапах и добивает раненых.
class Bot {
  constructor(world, player, skill = 0.65) {
    this.world = world;
    this.p = player;
    this.skill = skill; // 0..1
    this.targetId = null;
    this.thinkIn = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeIn = rnd(0.6, 1.8);
    this.aimError = (1 - skill) * 0.45;
    this.prefRange = rnd(230, 380);
    this.goal = null;
  }

  update(dt) {
    const w = this.world, me = this.p;
    if (!me.alive) return;

    this.thinkIn -= dt;
    this.strafeIn -= dt;
    if (this.strafeIn <= 0) { this.strafe *= -1; this.strafeIn = rnd(0.8, 2.2); }
    if (this.thinkIn <= 0) { this.think(); this.thinkIn = rnd(0.18, 0.35); }

    const target = this.targetId ? w.players.get(this.targetId) : null;
    let mx = 0, my = 0;

    // если мало HP — идём к аптечке
    const wantHeal = me.hp < me.maxHp * 0.4;
    const goal = wantHeal ? this.nearestPickup('hp') : (me.mana < 25 ? this.nearestPickup('mana') : null);

    if (goal) {
      const a = Math.atan2(goal.y - me.y, goal.x - me.x);
      mx = Math.cos(a); my = Math.sin(a);
    } else if (target && target.alive) {
      const dx = target.x - me.x, dy = target.y - me.y;
      const d = Math.hypot(dx, dy) || 1;
      const dirA = Math.atan2(dy, dx);
      const push = d > this.prefRange ? 1 : d < this.prefRange * 0.6 ? -1 : 0;
      mx = Math.cos(dirA) * push + Math.cos(dirA + Math.PI / 2) * this.strafe * 0.9;
      my = Math.sin(dirA) * push + Math.sin(dirA + Math.PI / 2) * this.strafe * 0.9;
    } else {
      // патруль к центру карты
      const a = Math.atan2(C.WORLD.h / 2 - me.y, C.WORLD.w / 2 - me.x);
      mx = Math.cos(a + rnd(-0.6, 0.6));
      my = Math.sin(a + rnd(-0.6, 0.6));
    }

    // обход препятствий
    const avoid = this.avoidVector();
    mx += avoid.x; my += avoid.y;

    let aim = me.aim;
    if (target && target.alive) {
      const lead = this.leadAngle(target);
      aim = lead + rnd(-this.aimError, this.aimError);
    } else {
      aim = Math.atan2(my, mx);
    }
    w.setInput(me.id, mx, my, aim);

    if (!target || !target.alive) return;
    const d = Math.hypot(target.x - me.x, target.y - me.y);
    const clear = w.lineClear(me.x, me.y, target.x, target.y);
    if (!clear) return;

    const ab = me.abilities;
    // ульта
    if (d < (ab[2].range || ab[2].radius || 400) && Math.random() < 0.6 * this.skill) w.cast(me.id, 2);
    // способность
    if (ab[1].type === 'nova') {
      if (d < (ab[1].radius || 180) * 0.8) w.cast(me.id, 1);
    } else if (d < 420 && Math.random() < 0.5 * this.skill) {
      w.cast(me.id, 1);
    }
    // основная атака
    if (d < 620) w.cast(me.id, 0);
    // рывок для сближения/ухода
    if (Math.random() < 0.02 * this.skill && (d > 500 || me.hp < me.maxHp * 0.35)) w.cast(me.id, 3);
  }

  think() {
    const w = this.world, me = this.p;
    let best = null, bestScore = -Infinity;
    for (const t of w.players.values()) {
      if (t.id === me.id || !t.alive) continue;
      if (t.protectUntil > w.now) continue;
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      let score = 1200 - d;
      if (t.hp < t.maxHp * 0.4) score += 350; // добиваем раненых
      if (!t.isBot) score += 200; // предпочитаем живых игроков
      if (!w.lineClear(me.x, me.y, t.x, t.y)) score -= 500;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    this.targetId = best ? best.id : null;
  }

  leadAngle(target) {
    const me = this.p;
    const speed = me.abilities[0].proj ? me.abilities[0].proj.speed : 500;
    const dx = target.x - me.x, dy = target.y - me.y;
    const t = Math.hypot(dx, dy) / speed;
    const px = target.x + target.vx * t * this.skill;
    const py = target.y + target.vy * t * this.skill;
    return Math.atan2(py - me.y, px - me.x);
  }

  nearestPickup(kind) {
    const w = this.world, me = this.p;
    let best = null, bd = 700 * 700;
    for (const pk of w.pickups) {
      if (pk.kind !== kind || w.now < pk.readyAt) continue;
      const d = (pk.x - me.x) ** 2 + (pk.y - me.y) ** 2;
      if (d < bd) { bd = d; best = pk; }
    }
    return best;
  }

  avoidVector() {
    const me = this.p;
    let ax = 0, ay = 0;
    for (const o of C.OBSTACLES) {
      const dx = me.x - o.x, dy = me.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const safe = o.r + C.PLAYER.r + 60;
      if (d < safe) {
        const f = (safe - d) / safe;
        ax += (dx / d) * f * 1.6;
        ay += (dy / d) * f * 1.6;
      }
    }
    // не липнем к краям карты
    const m = 90;
    if (me.x < m) ax += 1; if (me.x > C.WORLD.w - m) ax -= 1;
    if (me.y < m) ay += 1; if (me.y > C.WORLD.h - m) ay -= 1;
    return { x: ax, y: ay };
  }
}

module.exports = { Bot, BOT_NAMES };
