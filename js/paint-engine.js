import { getCharacterPath, CHAR_BOX } from './shapes.js';
import { ZoomController } from './zoom.js';
import { computeBlendScore } from './blend.js';

// Fraction of the photo's displayed height the character occupies at
// scale 1. Normalising against the photo (not the screen) is what keeps
// a round fair across a tablet and a small phone.
const CHAR_HEIGHT_FRACTION = 0.22;

// Authoring resolution multiplier for the offscreen sprite (box units -> px).
const REF = 3;

// Vertical anchor inside the 100x140 box: (nx, ny) marks this point.
const ANCHOR_Y = 70;

const BASE_FILL = '#d8d3c4';

let _checkerPattern = null;
function checkerPattern(ctx) {
  if (_checkerPattern) return _checkerPattern;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 16;
  const tctx = tile.getContext('2d');
  tctx.fillStyle = 'rgba(255,255,255,0.55)';
  tctx.fillRect(0, 0, 16, 16);
  tctx.fillStyle = 'rgba(120,120,130,0.55)';
  tctx.fillRect(0, 0, 8, 8);
  tctx.fillRect(8, 8, 8, 8);
  _checkerPattern = ctx.createPattern(tile, 'repeat');
  return _checkerPattern;
}

export const BRUSHES = [
  { id: 'soft', label: '●', title: 'Мягкая кисть' },
  { id: 'hard', label: '⬤', title: 'Жёсткая кисть' },
  { id: 'marker', label: '▮', title: 'Маркер' },
  { id: 'spray', label: '✺', title: 'Спрей' },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class PaintEngine {
  constructor({ wrapEl, stageEl, photoCanvas, paintCanvas }) {
    this.wrapEl = wrapEl;
    this.photoCanvas = photoCanvas;
    this.paintCanvas = paintCanvas;
    this.photoCtx = photoCanvas.getContext('2d', { willReadFrequently: true });
    this.paintCtx = paintCanvas.getContext('2d');

    this.character = 'cat';
    this.charScale = 1;
    this.charPath = getCharacterPath(this.character);

    this.offscreen = document.createElement('canvas');
    this.offscreen.width = CHAR_BOX.w * REF;
    this.offscreen.height = CHAR_BOX.h * REF;
    this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true });
    this.offCtx.scale(REF, REF);

    this.phase = 'idle'; // idle | placing | painting
    this.nx = 0.5; this.ny = 0.55;
    this.brush = { type: 'soft', size: 14, color: '#c98a5b' };
    this.undoStack = [];
    this.drawing = false;
    this._lastBox = null;
    this.eyedropperActive = false;
    this.onColorPicked = null;
    this.onBlendChange = null;
    this.onStrokeStart = null;
    this.blend = null;

    this.image = null;
    this.naturalW = 0; this.naturalH = 0;
    this.canvasW = 0; this.canvasH = 0;
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);

    this.zoomer = new ZoomController({
      wrapEl,
      stageEl,
      onDown: (evt) => this._onDown(evt),
      onMove: (evt) => this._onMove(evt),
      onUp: () => this._onUp(),
      onCancel: () => this._cancelStroke(),
    });

    window.addEventListener('resize', () => this._fit());
  }

  setCharacter(id) {
    this.character = id;
    this.charPath = getCharacterPath(id);
    if (this.image) { this._resetOffscreen(); this._redrawSprite(); }
  }

  setCharScale(scale) {
    this.charScale = clamp(scale || 1, 0.5, 2);
    if (this.image) this._redrawSprite();
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
    this.zoomer.reset();
    this._fit();
    this._resetOffscreen();
    this.blend = null;
  }

  _fit() {
    if (!this.image) return;
    const rect = this.wrapEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
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
    this._fillBase();
    this.undoStack = [];
  }

  _fillBase() {
    this.offCtx.save();
    this.offCtx.clip(this.charPath);
    this.offCtx.fillStyle = BASE_FILL;
    this.offCtx.fillRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.restore();
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
    this._redrawSprite();
    this.recomputeBlend();
  }

  get k() {
    return (CHAR_HEIGHT_FRACTION * this.charScale * this.canvasH) / CHAR_BOX.h;
  }

  spriteScreenRect() {
    return spriteRect(this.nx, this.ny, this.canvasW, this.canvasH, this.charScale);
  }

  _redrawSprite() {
    if (!this.canvasW) return;
    const ctx = this.paintCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvasW, this.canvasH);
    const r = this.spriteScreenRect();

    if (this.phase === 'placing') {
      // Not-yet-placed preview: transparency checkerboard + dashed
      // outline, so it reads as a sticker you haven't stuck down yet.
      const k = this.k;
      const path = new Path2D();
      path.addPath(this.charPath, new DOMMatrix().translate(r.x, r.y).scale(k, k));
      ctx.save();
      ctx.clip(path);
      ctx.fillStyle = checkerPattern(ctx);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5 * this.dpr;
      ctx.setLineDash([7 * this.dpr, 5 * this.dpr]);
      ctx.stroke(path);
      ctx.restore();
      return;
    }

    ctx.drawImage(this.offscreen, r.x, r.y, r.w, r.h);
  }

  // ---- coordinate mapping ----

  _canvasPointToBox(cx, cy) {
    const k = this.k;
    const r = this.spriteScreenRect();
    return { x: (cx - r.x) / k, y: (cy - r.y) / k };
  }

  // getBoundingClientRect already reflects the zoom transform, so this
  // stays correct at any zoom level without consulting the controller.
  _eventToCanvasPoint(evt) {
    const rect = this.paintCanvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (this.canvasW / rect.width),
      y: (evt.clientY - rect.top) * (this.canvasH / rect.height),
    };
  }

  canvasPointFromEvent(evt) { return this._eventToCanvasPoint(evt); }

  _onDown(evt) {
    const p = this._eventToCanvasPoint(evt);
    if (this.phase === 'placing') {
      this.setPlacementFromCanvasPoint(p.x, p.y);
      return;
    }
    if (this.phase !== 'painting') return;

    if (this.eyedropperActive) {
      const hex = this.sampleColorAt(p.x, p.y);
      this.setColor(hex);
      this.onColorPicked && this.onColorPicked(hex);
      return;
    }
    this._pushUndo();
    this.drawing = true;
    this.onStrokeStart && this.onStrokeStart();
    const b = this._canvasPointToBox(p.x, p.y);
    this._lastBox = b;
    this._stampAt(b.x, b.y);
    this._redrawSprite();
  }

  _onMove(evt) {
    const p = this._eventToCanvasPoint(evt);
    if (this.phase === 'placing') {
      this.setPlacementFromCanvasPoint(p.x, p.y);
    } else if (this.phase === 'painting' && this.drawing) {
      const b = this._canvasPointToBox(p.x, p.y);
      this._strokeSegment(this._lastBox, b);
      this._lastBox = b;
      this._redrawSprite();
    }
  }

  _onUp() {
    const wasDrawing = this.drawing;
    this.drawing = false;
    this._lastBox = null;
    if (wasDrawing) this.recomputeBlend();
  }

  // A pinch started mid-stroke: roll the stroke back so zooming never
  // costs the player a stray smear across their work.
  _cancelStroke() {
    if (!this.drawing) return;
    this.drawing = false;
    this._lastBox = null;
    this.undo();
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
    this.recomputeBlend();
  }

  get canUndo() { return this.undoStack.length > 0; }

  clearToBase() {
    this._pushUndo();
    this.offCtx.save();
    this.offCtx.clip(this.charPath);
    this.offCtx.clearRect(0, 0, CHAR_BOX.w, CHAR_BOX.h);
    this.offCtx.restore();
    this._fillBase();
    this._redrawSprite();
    this.recomputeBlend();
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
      const dots = Math.max(10, Math.round(r * 1.6));
      for (let i = 0; i < dots; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * r;
        ctx.globalAlpha = 0.35 + Math.random() * 0.4;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, r * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.brush.type === 'marker') {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.rect(x - r, y - r * 0.6, r * 2, r * 1.2);
      ctx.fill();
    } else if (this.brush.type === 'soft') {
      // Real feathered edge: a radial fade blends far better against
      // photo texture than a flat disc at reduced opacity.
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = this.brush.color;
      grad.addColorStop(0, hexToRgba(c, 0.9));
      grad.addColorStop(0.6, hexToRgba(c, 0.55));
      grad.addColorStop(1, hexToRgba(c, 0));
      ctx.fillStyle = grad;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _strokeSegment(from, to) {
    if (!from) { this._stampAt(to.x, to.y); return; }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (this.brush.size * 0.22)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this._stampAt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }
  }

  // ---- eyedropper ----

  sampleColorAt(cx, cy) {
    const x = clamp(Math.round(cx), 0, this.canvasW - 1);
    const y = clamp(Math.round(cy), 0, this.canvasH - 1);
    const d = this.photoCtx.getImageData(x, y, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // ---- camouflage quality ----

  recomputeBlend() {
    if (!this.canvasW || this.phase === 'idle') return null;
    this.blend = computeBlendScore({
      photoCtx: this.photoCtx,
      spriteCanvas: this.offscreen,
      rect: this.spriteScreenRect(),
      canvasW: this.canvasW,
      canvasH: this.canvasH,
    });
    this.onBlendChange && this.onBlendChange(this.blend);
    return this.blend;
  }

  // ---- export for network transmission ----

  exportSprite() {
    if (this.blend == null) this.recomputeBlend();
    return {
      dataUrl: this.offscreen.toDataURL('image/png'),
      nx: this.nx,
      ny: this.ny,
      character: this.character,
      scale: this.charScale,
      blend: this.blend == null ? 0 : this.blend,
    };
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Shared placement math: given a normalized (nx, ny) anchor, a target
// canvas's pixel size and the character scale used when painting, return
// the rect the sprite occupies. Drawing, hit-testing and found-markers
// all go through this so they can never drift apart.
export function spriteRect(nx, ny, canvasW, canvasH, scale = 1) {
  const k = (CHAR_HEIGHT_FRACTION * scale * canvasH) / CHAR_BOX.h;
  return {
    x: nx * canvasW - k * (CHAR_BOX.w / 2),
    y: ny * canvasH - k * ANCHOR_Y,
    w: k * CHAR_BOX.w,
    h: k * CHAR_BOX.h,
  };
}

export function drawSpriteOnCanvas(ctx, img, nx, ny, canvasW, canvasH, scale = 1) {
  const r = spriteRect(nx, ny, canvasW, canvasH, scale);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return r;
}

// Hit-test against the character's own silhouette, so tapping the gap
// between a cat's legs correctly counts as a miss.
export function isPointInCharacter(ctx, characterId, cx, cy, nx, ny, canvasW, canvasH, scale = 1) {
  const r = spriteRect(nx, ny, canvasW, canvasH, scale);
  const k = r.w / CHAR_BOX.w;
  const boxX = (cx - r.x) / k;
  const boxY = (cy - r.y) / k;
  if (boxX < 0 || boxY < 0 || boxX > CHAR_BOX.w || boxY > CHAR_BOX.h) return false;
  return ctx.isPointInPath(getCharacterPath(characterId), boxX, boxY);
}
