// Small synthesized sound kit. Everything is generated with oscillators
// so the game stays a single self-contained folder with no audio files
// to ship, and nothing loads until the player's first interaction —
// mobile browsers refuse to start an AudioContext before that anyway.

let ctx = null;
let enabled = true;

export function setSoundEnabled(on) { enabled = !!on; }
export function isSoundEnabled() { return enabled; }

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Call from a click handler once, so later game-driven sounds are allowed.
export function unlockAudio() { ac(); }

function tone({ freq, dur = 0.12, type = 'sine', gain = 0.12, delay = 0, sweepTo = null }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  // Quick attack, smooth decay — avoids the click you get from stopping
  // an oscillator at non-zero amplitude.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.14, gain = 0.09, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const amp = c.createGain();
  amp.gain.value = gain;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  src.connect(filter).connect(amp).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  tap: () => tone({ freq: 520, dur: 0.05, type: 'triangle', gain: 0.07 }),
  place: () => { tone({ freq: 440, dur: 0.09, type: 'triangle' }); tone({ freq: 660, dur: 0.12, type: 'triangle', delay: 0.07 }); },
  tick: () => tone({ freq: 880, dur: 0.05, type: 'square', gain: 0.05 }),
  urgent: () => tone({ freq: 1180, dur: 0.07, type: 'square', gain: 0.09 }),
  found: () => { tone({ freq: 700, dur: 0.1, type: 'sine' }); tone({ freq: 1050, dur: 0.16, type: 'sine', delay: 0.08 }); },
  miss: () => noise({ dur: 0.16, gain: 0.1 }),
  submitted: () => tone({ freq: 590, dur: 0.14, type: 'sine', sweepTo: 880 }),
  roundEnd: () => {
    [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.1, delay: i * 0.1 }));
  },
  matchEnd: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.28, type: 'triangle', gain: 0.11, delay: i * 0.12 }));
  },
  hint: () => tone({ freq: 340, dur: 0.22, type: 'sine', gain: 0.1, sweepTo: 520 }),
};
