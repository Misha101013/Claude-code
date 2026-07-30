// A compact HSV color wheel + brightness slider, styled after the
// classic mobile painting-app picker (ibisPaint etc): a hue/saturation
// disc (drawn once, always at V=1) with a draggable dot, a vertical
// value slider next to it, and a swatch grid underneath.

function hsv2rgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgb2hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hex2hsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export class IbisColorWheel {
  constructor({ wheelCanvas, valueTrack, valueThumb, wheelDot, onChange, size = 200 }) {
    this.wheelCanvas = wheelCanvas;
    this.valueTrack = valueTrack;
    this.valueThumb = valueThumb;
    this.wheelDot = wheelDot;
    this.onChange = onChange;
    this.h = 24; this.s = 0.55; this.v = 0.85;

    this.size = size;
    this.wheelCanvas.width = this.size;
    this.wheelCanvas.height = this.size;
    this._drawWheel();
    this._bindWheel();
    this._bindValue();
    this._updateThumbs();
  }

  _drawWheel() {
    const ctx = this.wheelCanvas.getContext('2d');
    const size = this.size, cx = size / 2, cy = size / 2, radius = size / 2 - 2;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const r = Math.sqrt(dx * dx + dy * dy) / radius;
        const idx = (y * size + x) * 4;
        if (r > 1) { img.data[idx + 3] = 0; continue; }
        let hue = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (hue < 0) hue += 360;
        const [rr, gg, bb] = hsv2rgb(hue, Math.min(r, 1), 1);
        img.data[idx] = rr; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  _bindWheel() {
    const pick = (evt) => {
      const rect = this.wheelCanvas.getBoundingClientRect();
      const t = evt.touches ? evt.touches[0] : evt;
      const cx = rect.width / 2, cy = rect.height / 2;
      let x = t.clientX - rect.left - cx;
      let y = t.clientY - rect.top - cy;
      const radius = rect.width / 2;
      let r = Math.sqrt(x * x + y * y) / radius;
      if (r > 1) { const scale = 1 / r; x *= scale; y *= scale; r = 1; }
      let hue = (Math.atan2(y, x) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      this.h = hue; this.s = r;
      this._updateThumbs();
      this._emit();
    };
    let dragging = false;
    const down = (e) => { dragging = true; pick(e); e.preventDefault(); };
    const move = (e) => { if (dragging) { pick(e); e.preventDefault(); } };
    const up = () => { dragging = false; };
    this.wheelCanvas.addEventListener('pointerdown', down);
    this.wheelCanvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.wheelCanvas.addEventListener('touchstart', down, { passive: false });
    this.wheelCanvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  _bindValue() {
    const pick = (evt) => {
      const rect = this.valueTrack.getBoundingClientRect();
      const t = evt.touches ? evt.touches[0] : evt;
      let frac = 1 - (t.clientY - rect.top) / rect.height;
      frac = Math.max(0, Math.min(1, frac));
      this.v = frac;
      this._updateThumbs();
      this._emit();
    };
    let dragging = false;
    const down = (e) => { dragging = true; pick(e); e.preventDefault(); };
    const move = (e) => { if (dragging) { pick(e); e.preventDefault(); } };
    const up = () => { dragging = false; };
    this.valueTrack.addEventListener('pointerdown', down);
    this.valueTrack.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.valueTrack.addEventListener('touchstart', down, { passive: false });
    this.valueTrack.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  setColor(hex) {
    const { h, s, v } = hex2hsv(hex);
    this.h = h; this.s = s; this.v = v || 0.01;
    this._updateThumbs();
  }

  _updateThumbs() {
    const size = this.wheelCanvas.getBoundingClientRect().width || this.size;
    const radius = size / 2;
    const rad = (this.h * Math.PI) / 180;
    const dist = this.s * radius;
    this.wheelDot.style.left = (radius + Math.cos(rad) * dist) + 'px';
    this.wheelDot.style.top = (radius + Math.sin(rad) * dist) + 'px';
    this.wheelDot.style.background = rgb2hex(hsv2rgb(this.h, this.s, 1));

    const pureHex = rgb2hex(hsv2rgb(this.h, this.s, 1));
    this.valueTrack.style.background = `linear-gradient(to top, #000, ${pureHex})`;
    this.valueThumb.style.bottom = (this.v * 100) + '%';

    this.currentHex = rgb2hex(hsv2rgb(this.h, this.s, this.v));
  }

  _emit() { this.onChange && this.onChange(this.currentHex); }
}
