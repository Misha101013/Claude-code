// Простой синтезированный звук — без внешних файлов.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
}

function tone(freq, dur, type = 'sine', gain = 1, slide = 0) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.02);
}

function noise(dur, gain = 0.4, filterFreq = 900) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export const sfx = {
  beep: () => tone(1180, 0.09, 'square', 0.25),
  cash: () => {
    tone(880, 0.1, 'triangle', 0.3);
    setTimeout(() => tone(1320, 0.16, 'triangle', 0.28), 70);
    setTimeout(() => noise(0.18, 0.18, 2400), 40);
  },
  pickup: () => tone(300, 0.12, 'sine', 0.25, 180),
  drop: () => noise(0.16, 0.3, 500),
  place: () => tone(520, 0.05, 'sine', 0.14),
  step: () => noise(0.07, 0.10, 380),
  error: () => tone(180, 0.18, 'sawtooth', 0.16),
  truck: () => {
    tone(110, 0.7, 'sawtooth', 0.16, -40);
    setTimeout(() => tone(150, 0.4, 'square', 0.12), 500);
  },
  angry: () => tone(240, 0.25, 'sawtooth', 0.14, -90),
  levelUp: () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.22), i * 90));
  },
  open: () => {
    [392, 523].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sine', 0.2), i * 120));
  },
};
