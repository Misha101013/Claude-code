import { buildCharacterPath, CHAR_BOX } from './shapes.js';

// Fraction of the photo's displayed height the character occupies.
// Same fraction on every device => consistent gameplay regardless of
// screen size, since placement/size are normalized to photo space.
const CHAR_HEIGHT_FRACTION = 0.22;

// Authoring resolution multiplier for the offscreen sprite (box units -> px).
const REF = 3;

const BASE_FILL = '#d8d3c4';

export const BRUSHES = [
  { id: 'soft', label: '●', title: 'Мягкая кисть' },
  { id: 'hard', label: '⬤', title: 'Жёсткая кисть' },
  { id: 'marker', label: '▮', title: 'Маркер' },
  { id: 'spray', label: '✺', title: 'Спрей' },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class PaintEngine {
  constructor({ wrapEl, photoCanvas, paintCanvas }) {
    this.wrapEl = wrapEl;
    this.photoCanvas = photoCanvas;
    this.paintCanvas = paintCanvas;
    this.photoCtx = photoCanvas.getContext('2d');
    this.paintCtx = paintCanvas.getContext('2d');

    this.charPath = buildCharacterPath();

    this.offscreen = document.createElement('canvas');
    this.offscreen.width = CHAR_BOX.w * REF;
    this.offscreen.height = CHAR_BOX.h * REF;
    this.offCtx = this.offscreen.getContext('2d');
    this.offCtx.scale(REF, REF);

    this.phase = 'idle'; // idle | placing | painting
    this.nx = 0.5; this.ny = 0.55;
    this.brush = { type: 'soft', size: 14, color: '#c98a5b' };
    this.undoStack = [];
    this.drawing = false;
    this._lastBox = null;
    this.eyedropperActive = false;
    this.onColorPicked = null;

    this.image = null;
    this.naturalW = 0; this.naturalH = 0;
    this.canvasW = 0; this.canvasH = 0;
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);

    this._bindPointer();
    window.addEventListener('resize', () => this._fit());
  }

  async loadPhoto(src) {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });
    this.image = img;
    this.naturalW = img.naturalWidth;
    this.naturalH = img.naturalHeight;
    this._fit();
    this._resetOffscreen();
  }

  _fit() {
    if (!this.image) return;
    const rect = this.wrapEl.getBoundingClientRect();
    const containerRatio = rect.width / rect.height;
    const imgRatio = this.naturalW / this.naturalH;
    let cssW, cssH;
    if (imgRatio > containerRatio) {
      cssW = rect.width; cssH = rect.width / imgRatio;
    } else {
      cssH = rect.height; cssW = rect.height * imgRatio;
    }
    for (const c of [this.photoCanvas, this.paintCanvas]) {
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
      c.width = Math.round(cssW * this.dpr);
      c.height = Math.round(cssH * this.dpr);
    }
    this.canvasW = this.photoCanvas.width;
    this.canvasH = this.photoCanvas.height;
    this.photoCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.photoCtx.drawImage(this.image, 0, 0, this.canvasW, this.canvasH);
    this._redrawSprite();
  }

  _resetOffscreen() {
    this.offCtx.setTransform(REF, 0, 0, REF, 0, 0);
    this.offCtx.clearRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.save();
    this.offCtx.clip(this.charPath);
    this.offCtx.fillStyle = BASE_FILL;
    this.offCtx.fillRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.restore();
    this.undoStack = [];
  }

  // ---- placement ----

  beginPlacement() {
    this.phase = 'placing';
    this._redrawSprite();
  }

  setPlacementFromCanvasPoint(cx, cy) {
    this.nx = clamp(cx / this.canvasW, 0.08, 0.92);
    this.ny = clamp(cy / this.canvasH, 0.08, 0.92);
    this._redrawSprite();
  }

  lockPlacement() {
    this.phase = 'painting';
  }

  get k() {
    return (CHAR_HEIGHT_FRACTION * this.canvasH) / CHAR_BOX.h;
  }

  spriteScreenRect() {
    const k = this.k;
    return {
      x: this.nx * this.canvasW - k * (CHAR_BOX.w / 2),
      y: this.ny * this.canvasH - k * 70,
      w: k * CHAR_BOX.w,
      h: k * CHAR_BOX.h,
    };
  }

  _redrawSprite() {
    if (!this.canvasW) return;
    this.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.paintCtx.clearRect(0, 0, this.canvasW, this.canvasH);
    const r = this.spriteScreenRect();
    this.paintCtx.globalAlpha = this.phase === 'placing' ? 0.85 : 1;
    this.paintCtx.drawImage(this.offscreen, r.x, r.y, r.w, r.h);
    this.paintCtx.globalAlpha = 1;
  }

  // ---- coordinate mapping: screen canvas px -> box space (0..100, 0..140) ----

  _canvasPointToBox(cx, cy) {
    const k = this.k;
    const r = this.spriteScreenRect();
    return { x: (cx - r.x) / k, y: (cy - r.y) / k };
  }

  _eventToCanvasPoint(evt) {
    const rect = this.paintCanvas.getBoundingClientRect();
    const t = evt.touches ? evt.touches[0] : evt;
    return {
      x: (t.clientX - rect.left) * (this.canvasW / rect.width),
      y: (t.clientY - rect.top) * (this.canvasH / rect.height),
    };
  }

  _bindPointer() {
    const el = this.paintCanvas;
    const down = (evt) => {
      evt.preventDefault();
      const p = this._eventToCanvasPoint(evt);
      if (this.phase === 'placing') {
        this.setPlacementFromCanvasPoint(p.x, p.y);
      } else if (this.phase === 'painting') {
        if (this.eyedropperActive) {
          const hex = this.sampleColorAt(p.x, p.y);
          this.setColor(hex);
          this.eyedropperActive = false;
          this.onColorPicked && this.onColorPicked(hex);
          return;
        }
        this._pushUndo();
        this.drawing = true;
        const b = this._canvasPointToBox(p.x, p.y);
        this._lastBox = b;
        this._stampAt(b.x, b.y);
        this._redrawSprite();
      }
    };
    const move = (evt) => {
      if (this.phase === 'placing' && evt.buttons !== undefined && evt.buttons === 0 && evt.type === 'mousemove') return;
      const p = this._eventToCanvasPoint(evt);
      if (this.phase === 'placing' && (evt.touches || evt.buttons)) {
        evt.preventDefault();
        this.setPlacementFromCanvasPoint(p.x, p.y);
      } else if (this.phase === 'painting' && this.drawing) {
        evt.preventDefault();
        const b = this._canvasPointToBox(p.x, p.y);
        this._strokeSegment(this._lastBox, b);
        this._lastBox = b;
        this._redrawSprite();
      } else if (this.phase === 'eyedrop-preview') {
        evt.preventDefault();
        this.onEyedropperMove && this.onEyedropperMove(p.x, p.y);
      }
    };
    const up = () => { this.drawing = false; this._lastBox = null; };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  }

  _pushUndo() {
    if (this.undoStack.length > 25) this.undoStack.shift();
    this.undoStack.push(this.offCtx.getImageData(0, 0, this.offscreen.width, this.offscreen.height));
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.offCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.offCtx.putImageData(snap, 0, 0);
    this.offCtx.setTransform(REF, 0, 0, REF, 0, 0);
    this._redrawSprite();
  }

  clearToBase() {
    this._pushUndo();
    this._resetPaintKeepUndo();
  }

  _resetPaintKeepUndo() {
    this.offCtx.save();
    this.offCtx.clip(this.charPath);
    this.offCtx.clearRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.fillStyle = BASE_FILL;
    this.offCtx.fillRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.restore();
    this._redrawSprite();
  }

  setBrush(type) { this.brush.type = type; }
  setSize(px) { this.brush.size = px; }
  setColor(hex) { this.brush.color = hex; }

  _stampAt(x, y) {
    const ctx = this.offCtx;
    ctx.save();
    ctx.clip(this.charPath);
    ctx.fillStyle = this.brush.color;
    const r = this.brush.size / 2;
    if (this.brush.type === 'spray') {
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.random() * r;
        ctx.globalAlpha = 0.5 + Math.random() * 0.4;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = this.brush.type === 'soft' ? 0.85 : 1;
      if (this.brush.type === 'marker') {
        ctx.beginPath();
        ctx.rect(x - r, y - r * 0.6, r * 2, r * 1.2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _strokeSegment(from, to) {
    if (!from) { this._stampAt(to.x, to.y); return; }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (this.brush.size * 0.25)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._stampAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }
  }

  // ---- eyedropper: sample the underlying photo at a canvas point ----

  sampleColorAt(cx, cy) {
    const x = clamp(Math.round(cx), 0, this.canvasW - 1);
    const y = clamp(Math.round(cy), 0, this.canvasH - 1);
    const d = this.photoCtx.getImageData(x, y, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  canvasPointFromEvent(evt) { return this._eventToCanvasPoint(evt); }

  // ---- export for network transmission ----

  exportSprite() {
    return {
      dataUrl: this.offscreen.toDataURL('image/png'),
      nx: this.nx,
      ny: this.ny,
    };
  }
}

// Shared placement math: given a normalized (nx, ny) anchor and a
// target canvas's pixel size, return the on-screen rect a sprite
// occupies. Used for drawing, hit-testing, and UI highlights alike so
// they never drift out of sync with each other.
export function spriteRect(nx, ny, canvasW, canvasH) {
  const k = (CHAR_HEIGHT_FRACTION * canvasH) / CHAR_BOX.h;
  const x = nx * canvasW - k * (CHAR_BOX.w / 2);
  const y = ny * canvasH - k * 70;
  return { x, y, w: k * CHAR_BOX.w, h: k * CHAR_BOX.h };
}

// Draw a previously-exported sprite onto any canvas context, given the
// same normalized placement + that canvas's own pixel dimensions.
export function drawSpriteOnCanvas(ctx, img, nx, ny, canvasW, canvasH) {
  const r = spriteRect(nx, ny, canvasW, canvasH);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return r;
}

export function isPointInCharacter(ctx, path, cx, cy, nx, ny, canvasW, canvasH) {
  const r = spriteRect(nx, ny, canvasW, canvasH);
  const k = r.w / CHAR_BOX.w;
  const boxX = (cx - r.x) / k;
  const boxY = (cy - r.y) / k;
  return ctx.isPointInPath(path, boxX, boxY);
}
