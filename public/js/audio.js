/* Крошечный синтезатор звуков — без единого аудиофайла. */
window.Sfx = (() => {
  let ctx = null, master = null, enabled = true;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone({ type = 'sine', f = 440, f2 = null, t = 0.15, v = 0.3, delay = 0 }) {
    if (!enabled || !ctx) return;
    const now = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(v, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + t + 0.02);
  }

  function noise({ t = 0.2, v = 0.25, lp = 1200, delay = 0 }) {
    if (!enabled || !ctx) return;
    const now = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * t));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    src.connect(f).connect(g).connect(master);
    src.start(now);
  }

  const sounds = {
    fire: () => tone({ type: 'sawtooth', f: 420, f2: 160, t: 0.16, v: 0.16 }),
    ice: () => tone({ type: 'triangle', f: 900, f2: 1500, t: 0.14, v: 0.13 }),
    bolt: () => tone({ type: 'square', f: 1200, f2: 600, t: 0.09, v: 0.1 }),
    hit: () => noise({ t: 0.14, v: 0.2, lp: 2200 }),
    boom: () => { noise({ t: 0.5, v: 0.42, lp: 900 }); tone({ type: 'sine', f: 160, f2: 40, t: 0.5, v: 0.32 }); },
    nova: () => { tone({ type: 'triangle', f: 300, f2: 1400, t: 0.35, v: 0.2 }); noise({ t: 0.3, v: 0.14, lp: 3000 }); },
    chain: () => { tone({ type: 'square', f: 1800, f2: 300, t: 0.22, v: 0.14 }); noise({ t: 0.18, v: 0.12, lp: 4000 }); },
    dash: () => noise({ t: 0.22, v: 0.18, lp: 1600 }),
    death: () => { tone({ type: 'sawtooth', f: 300, f2: 60, t: 0.6, v: 0.26 }); noise({ t: 0.4, v: 0.2, lp: 700 }); },
    kill: () => { tone({ type: 'sine', f: 700, t: 0.1, v: 0.24 }); tone({ type: 'sine', f: 1050, t: 0.16, v: 0.22, delay: 0.09 }); },
    hurt: () => tone({ type: 'sawtooth', f: 220, f2: 110, t: 0.16, v: 0.2 }),
    pick: () => { tone({ type: 'sine', f: 880, t: 0.08, v: 0.16 }); tone({ type: 'sine', f: 1320, t: 0.1, v: 0.14, delay: 0.06 }); },
    spawn: () => tone({ type: 'triangle', f: 200, f2: 800, t: 0.28, v: 0.14 }),
    ui: () => tone({ type: 'square', f: 620, t: 0.05, v: 0.12 }),
    win: () => [0, 0.12, 0.24, 0.42].forEach((d, i) => tone({ type: 'sine', f: [523, 659, 784, 1046][i], t: 0.3, v: 0.22, delay: d })),
  };

  return {
    resume,
    set enabled(v) { enabled = v; },
    get enabled() { return enabled; },
    play(name) {
      if (!enabled) return;
      init();
      const s = sounds[name];
      if (s && ctx) s();
    },
  };
})();
