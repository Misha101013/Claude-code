// Two kinds of settings.
//
// MATCH settings belong to whoever hosts: they decide timings and
// scoring, so they're broadcast and every device runs the round by the
// same numbers. PLAYER settings are per-device flavour (name, colour,
// character, sound) and never leave the phone except the bits other
// players need to see.

export const MATCH_DEFAULTS = {
  rounds: 0, // 0 => one round per player, so everyone seeks once
  hideSeconds: 45,
  seekSeconds: 60,
  tapsBase: 4,
  tapsPerHider: 3,
  hints: true,
  blendMeter: true,
  autoFillHelper: false,
  showHiders: false,
};

// Descriptors drive the settings UI, so adding a setting here is enough
// to get a control for it.
export const MATCH_FIELDS = [
  {
    key: 'rounds', label: 'Раундов в матче', type: 'range',
    min: 0, max: 10, step: 1,
    format: (v) => (v === 0 ? 'по одному на каждого' : String(v)),
    hint: 'Ноль — каждый успеет поискать ровно один раз.',
  },
  {
    key: 'hideSeconds', label: 'Время на прятки', type: 'range',
    min: 20, max: 120, step: 5, format: (v) => v + ' сек',
  },
  {
    key: 'seekSeconds', label: 'Время на поиск', type: 'range',
    min: 20, max: 150, step: 5, format: (v) => v + ' сек',
  },
  {
    key: 'tapsBase', label: 'Базовых попыток у искателя', type: 'range',
    min: 1, max: 12, step: 1, format: (v) => String(v),
    hint: 'Промах тратит попытку — искать наугад не выйдет.',
  },
  {
    key: 'tapsPerHider', label: 'Плюс попыток за каждого прячущегося', type: 'range',
    min: 1, max: 6, step: 1, format: (v) => '+' + v,
  },
  {
    key: 'hints', label: 'Подсказки искателю', type: 'toggle',
    hint: 'Если долго не находит вообще никого — под конец покажем неточный, широкий круг. Как только есть хоть одна находка, подсказки больше не будет.',
  },
  {
    key: 'blendMeter', label: 'Показывать качество маскировки', type: 'toggle',
    hint: 'Живой процент совпадения с фоном, пока красишь.',
  },
  {
    key: 'autoFillHelper', label: 'Подсказка фона', type: 'toggle',
    hint: 'Отдельная кисть с волшебной палочкой: берёт цвет фона максимально точно, прямо как пипетка, но проводит мазками. Запас ограничен — хватит на один трудный участок, а не на всего персонажа.',
  },
  {
    key: 'showHiders', label: 'Видно других прячущихся', type: 'toggle',
    hint: 'Пока сам прячешься, будешь полупрозрачно видеть, куда уже спрятались остальные — чтобы не сесть друг другу на голову. Искателю это никогда не показывается.',
  },
];

export const PLAYER_DEFAULTS = {
  name: '',
  color: null, // picked at random on first run
  character: 'cat',
  size: 'medium',
  sound: true,
  testMode: false,
  lastMode: 'classic', // last round mode picked, remembered for convenience
};

// A per-player choice, not a match setting — everyone picks their own.
// Deliberately a narrow band (small vs large is only a ~27% spread) so
// it's a small tactical nudge rather than a dominant "always go tiny"
// strategy: a smaller character is a little easier to blend and a
// little easier to miss, but nowhere near enough to make size the whole
// game the way a wide range would.
export const SIZE_PRESETS = [
  { id: 'small', label: 'Маленький', dotSize: 10, scale: 0.88 },
  { id: 'medium', label: 'Средний', dotSize: 15, scale: 1 },
  { id: 'large', label: 'Крупный', dotSize: 20, scale: 1.12 },
];

export function sizeScale(id) {
  const preset = SIZE_PRESETS.find((s) => s.id === id);
  return preset ? preset.scale : 1;
}

const MATCH_KEY = 'blendin-match-v2';
const PLAYER_KEY = 'blendin-player-v2';

function load(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    // Only adopt keys we still know about, so a stale payload from an
    // older version can't smuggle in fields the game no longer honours.
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      if (parsed[k] !== undefined) out[k] = parsed[k];
    }
    return out;
  } catch (_) {
    return { ...defaults };
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

export const matchSettings = load(MATCH_KEY, MATCH_DEFAULTS);
export const playerSettings = load(PLAYER_KEY, PLAYER_DEFAULTS);

export function saveMatchSettings() { save(MATCH_KEY, matchSettings); }
export function savePlayerSettings() { save(PLAYER_KEY, playerSettings); }

// Clamp anything arriving over the network into the range its
// descriptor allows, so a peer can't hand us a 9000-second timer.
export function sanitizeMatchSettings(incoming) {
  const out = { ...MATCH_DEFAULTS };
  for (const field of MATCH_FIELDS) {
    const v = incoming ? incoming[field.key] : undefined;
    if (field.type === 'toggle') {
      out[field.key] = typeof v === 'boolean' ? v : MATCH_DEFAULTS[field.key];
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[field.key] = Math.min(field.max, Math.max(field.min, v));
    }
  }
  return out;
}

export function tapsForHiderCount(settings, hiderCount) {
  return settings.tapsBase + settings.tapsPerHider * Math.max(1, hiderCount);
}

export function roundsForPlayerCount(settings, playerCount) {
  return settings.rounds > 0 ? settings.rounds : Math.max(1, playerCount);
}
