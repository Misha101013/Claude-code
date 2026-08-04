'use strict';

// ─────────────────────────────────────────────────────────────
//  Общие константы мира. Часть из них отправляется клиенту
//  в приветственном пакете, чтобы не дублировать баланс руками.
// ─────────────────────────────────────────────────────────────

const TICK_HZ = 30; // частота симуляции
const SNAPSHOT_HZ = 15; // частота рассылки состояния
const DT = 1 / TICK_HZ;

const WORLD = {
  w: 2400,
  h: 1600,
};

const PLAYER = {
  r: 18,
  hp: 100,
  mana: 100,
  manaRegen: 11, // в секунду
  hpRegen: 1.5, // вне боя
  outOfCombat: 5, // сек без урона до регена HP
  respawn: 3.5,
  spawnProtect: 1.5,
};

const DASH = {
  cd: 5,
  mana: 12,
  dist: 190,
  time: 0.16,
};

const MATCH = {
  duration: +(process.env.MATCH_DURATION || 6 * 60), // сек
  scoreLimit: +(process.env.MATCH_SCORE_LIMIT || 30),
  intermission: +(process.env.MATCH_INTERMISSION || 12),
  maxPlayers: 12,
  minAlive: 4, // добиваем ботами до этого числа
};

const PICKUP = {
  r: 14,
  respawn: 14, // сек
  hp: 35,
  mana: 45,
};

// ── Заклинания ────────────────────────────────────────────────
// type: proj | multi | nova | meteor | chain | buff
const CLASSES = {
  pyro: {
    id: 'pyro',
    name: 'Пиромант',
    tag: 'Урон по площади',
    color: '#ff7a3d',
    color2: '#ffd166',
    hp: 100,
    speed: 205,
    desc: 'Жжёт всё вокруг. Метеор ломает толпу.',
    abilities: [
      {
        id: 'fireball', name: 'Огненный шар', icon: '🔥', cd: 0.5, mana: 7, type: 'proj',
        proj: { speed: 540, r: 9, dmg: 15, ttl: 1.5, aoe: 46, aoeDmg: 8, kind: 'fire' },
      },
      {
        id: 'flamewave', name: 'Волна огня', icon: '🌋', cd: 6, mana: 26, type: 'multi',
        count: 7, spread: 0.85,
        proj: { speed: 430, r: 8, dmg: 13, ttl: 0.75, kind: 'fire' },
      },
      {
        id: 'meteor', name: 'Метеор', icon: '☄️', cd: 17, mana: 45, type: 'meteor',
        range: 560, delay: 1.1, radius: 130, dmg: 60, burn: { dps: 10, time: 3 },
      },
    ],
  },
  cryo: {
    id: 'cryo',
    name: 'Криомант',
    tag: 'Контроль',
    color: '#5ec8ff',
    color2: '#c9f2ff',
    hp: 110,
    speed: 198,
    desc: 'Замедляет и добивает. Живучий и цепкий.',
    abilities: [
      {
        id: 'frostbolt', name: 'Ледяная стрела', icon: '❄️', cd: 0.55, mana: 7, type: 'proj',
        proj: { speed: 580, r: 8, dmg: 14, ttl: 1.6, kind: 'ice', slow: { mul: 0.55, time: 1.4 } },
      },
      {
        id: 'nova', name: 'Ледяная нова', icon: '💠', cd: 7, mana: 28, type: 'nova',
        radius: 190, dmg: 22, slow: { mul: 0.35, time: 2.2 },
      },
      {
        id: 'blizzard', name: 'Буран', icon: '🌨️', cd: 18, mana: 48, type: 'meteor',
        range: 540, delay: 0.8, radius: 165, dmg: 26, ticks: 5, tickTime: 0.6,
        slow: { mul: 0.5, time: 1.2 }, kind: 'ice',
      },
    ],
  },
  storm: {
    id: 'storm',
    name: 'Буревестник',
    tag: 'Скорость',
    color: '#c08bff',
    color2: '#ffe66d',
    hp: 92,
    speed: 224,
    desc: 'Быстрый снайпер. Цепная молния прошивает строй.',
    abilities: [
      {
        id: 'spark', name: 'Разряд', icon: '⚡', cd: 0.42, mana: 6, type: 'proj',
        proj: { speed: 700, r: 7, dmg: 12, ttl: 1.3, kind: 'bolt', pierce: 1 },
      },
      {
        id: 'chain', name: 'Цепная молния', icon: '🔗', cd: 8, mana: 30, type: 'chain',
        range: 480, jumps: 3, jumpRange: 300, dmg: 26, falloff: 0.75,
      },
      {
        id: 'surge', name: 'Штормовой рывок', icon: '🌀', cd: 15, mana: 40, type: 'buff',
        time: 6, speedMul: 1.45, cdMul: 0.55, shield: 35,
      },
    ],
  },
};

// Карта: круглые препятствия (камни/колонны) — простая и честная физика.
const OBSTACLES = [
  { x: 600, y: 400, r: 78 },
  { x: 1800, y: 400, r: 78 },
  { x: 600, y: 1200, r: 78 },
  { x: 1800, y: 1200, r: 78 },
  { x: 1200, y: 800, r: 120 },
  { x: 1200, y: 300, r: 56 },
  { x: 1200, y: 1300, r: 56 },
  { x: 330, y: 800, r: 62 },
  { x: 2070, y: 800, r: 62 },
  { x: 880, y: 800, r: 40 },
  { x: 1520, y: 800, r: 40 },
];

const PICKUP_SPOTS = [
  { x: 400, y: 250, kind: 'hp' },
  { x: 2000, y: 250, kind: 'hp' },
  { x: 400, y: 1350, kind: 'hp' },
  { x: 2000, y: 1350, kind: 'hp' },
  { x: 1200, y: 520, kind: 'mana' },
  { x: 1200, y: 1080, kind: 'mana' },
  { x: 760, y: 800, kind: 'mana' },
  { x: 1640, y: 800, kind: 'mana' },
];

const SPAWNS = [
  { x: 200, y: 200 }, { x: 2200, y: 200 }, { x: 200, y: 1400 }, { x: 2200, y: 1400 },
  { x: 1200, y: 150 }, { x: 1200, y: 1450 }, { x: 150, y: 800 }, { x: 2250, y: 800 },
  { x: 700, y: 1050 }, { x: 1700, y: 550 }, { x: 700, y: 550 }, { x: 1700, y: 1050 },
];

// то, что уходит клиенту (без серверных мелочей)
function clientConfig() {
  return {
    world: WORLD,
    player: { r: PLAYER.r, hp: PLAYER.hp, mana: PLAYER.mana, respawn: PLAYER.respawn, manaRegen: PLAYER.manaRegen },
    dash: DASH,
    match: { duration: MATCH.duration, scoreLimit: MATCH.scoreLimit },
    classes: CLASSES,
    obstacles: OBSTACLES,
    pickupR: PICKUP.r,
    tickHz: TICK_HZ,
    snapshotHz: SNAPSHOT_HZ,
  };
}

module.exports = {
  TICK_HZ, SNAPSHOT_HZ, DT, WORLD, PLAYER, DASH, MATCH, PICKUP,
  CLASSES, OBSTACLES, PICKUP_SPOTS, SPAWNS, clientConfig,
};
