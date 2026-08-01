// Character silhouettes. Every shape is authored inside the same
// 100x140 box and horizontally centred on x=50, so placement, painting,
// hit-testing and scoring all work per-character without special cases.
//
// All subpaths are wound clockwise so overlapping parts (head over body,
// legs over body) union under nonzero fill instead of punching holes.
// The one deliberate exception is the chameleon's tail curl, where an
// inner counter-clockwise arc is exactly what makes it a curl.

export const CHAR_BOX = { w: 100, h: 140 };

function roundRect(p, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
}

function ellipse(p, cx, cy, rx, ry) {
  p.moveTo(cx + rx, cy);
  p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  p.closePath();
}

function triangle(p, ax, ay, bx, by, cx, cy) {
  p.moveTo(ax, ay);
  p.lineTo(bx, by);
  p.lineTo(cx, cy);
  p.closePath();
}

function buildCat() {
  const p = new Path2D();
  // ears first, tucked under the head
  triangle(p, 20, 44, 27, 3, 51, 30);
  triangle(p, 80, 44, 73, 3, 49, 30);
  ellipse(p, 50, 43, 31, 27);
  roundRect(p, 27, 62, 46, 50, 17);
  roundRect(p, 30, 100, 17, 32, 8);
  roundRect(p, 53, 100, 17, 32, 8);
  // tail sweeping up the right side
  p.moveTo(70, 98);
  p.bezierCurveTo(90, 92, 95, 74, 92, 58);
  p.bezierCurveTo(91, 52, 84, 53, 84, 60);
  p.bezierCurveTo(86, 72, 82, 84, 68, 88);
  p.closePath();
  return p;
}

function buildChameleon() {
  const p = new Path2D();
  // crest, head and snout, facing right
  triangle(p, 42, 34, 54, 8, 70, 30);
  ellipse(p, 62, 44, 23, 19);
  triangle(p, 78, 36, 97, 46, 78, 54);
  ellipse(p, 46, 78, 31, 26);
  roundRect(p, 32, 96, 13, 26, 6);
  roundRect(p, 56, 96, 13, 26, 6);
  // curled tail: outer arc clockwise, inner arc back the other way, so
  // the pair reads as a thick curl rather than a filled disc
  const cx = 30, cy = 110, outer = 21, inner = 11;
  const a0 = -1.15, a1 = Math.PI * 0.62;
  p.moveTo(cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer);
  p.arc(cx, cy, outer, a0, a1, false);
  p.lineTo(cx + Math.cos(a1) * inner, cy + Math.sin(a1) * inner);
  p.arc(cx, cy, inner, a1, a0, true);
  p.closePath();
  return p;
}

function buildBunny() {
  const p = new Path2D();
  // ears
  p.moveTo(36, 54);
  p.bezierCurveTo(25, 24, 31, 3, 41, 5);
  p.bezierCurveTo(50, 9, 47, 32, 45, 55);
  p.closePath();
  p.moveTo(64, 54);
  p.bezierCurveTo(75, 24, 69, 3, 59, 5);
  p.bezierCurveTo(50, 9, 53, 32, 55, 55);
  p.closePath();
  ellipse(p, 50, 66, 25, 22);
  ellipse(p, 50, 101, 28, 26);
  roundRect(p, 23, 114, 23, 17, 8);
  roundRect(p, 54, 114, 23, 17, 8);
  return p;
}

function buildSquarePerson() {
  const p = new Path2D();
  roundRect(p, 33, 3, 34, 30, 0); // head
  roundRect(p, 25, 34, 50, 52, 0); // torso
  roundRect(p, 9, 38, 15, 42, 0); // left arm
  roundRect(p, 76, 38, 15, 42, 0); // right arm
  roundRect(p, 29, 88, 18, 48, 0); // left leg
  roundRect(p, 53, 88, 18, 48, 0); // right leg
  return p;
}

// The classic pedestrian pictogram from crossing signs: a round head and
// a soft pill-shaped body, everything heavily rounded.
function buildSignPerson() {
  const p = new Path2D();
  ellipse(p, 50, 19, 15, 15); // head
  roundRect(p, 30, 32, 40, 54, 19); // torso
  roundRect(p, 11, 40, 15, 38, 7); // left arm
  roundRect(p, 74, 40, 15, 38, 7); // right arm
  roundRect(p, 29, 84, 17, 48, 8); // left leg
  roundRect(p, 54, 84, 17, 48, 8); // right leg
  return p;
}

function buildBlob() {
  const p = new Path2D();
  ellipse(p, 50, 30, 26, 26);
  p.moveTo(24, 46);
  p.bezierCurveTo(24, 40, 30, 38, 50, 38);
  p.bezierCurveTo(70, 38, 76, 40, 76, 46);
  p.bezierCurveTo(78, 62, 80, 82, 74, 100);
  p.bezierCurveTo(72, 108, 66, 110, 62, 108);
  p.bezierCurveTo(58, 106, 58, 100, 58, 94);
  p.lineTo(58, 118);
  p.bezierCurveTo(58, 128, 54, 134, 46, 134);
  p.bezierCurveTo(40, 134, 37, 129, 38, 122);
  p.lineTo(40, 96);
  p.bezierCurveTo(40, 100, 40, 106, 36, 108);
  p.bezierCurveTo(31, 110, 25, 107, 24, 100);
  p.bezierCurveTo(20, 82, 22, 62, 24, 46);
  p.closePath();
  return p;
}

export const CHARACTERS = [
  { id: 'cat', label: 'Кот', emoji: '🐱', build: buildCat },
  { id: 'chameleon', label: 'Хамелеон', emoji: '🦎', build: buildChameleon },
  { id: 'bunny', label: 'Зайчик', emoji: '🐰', build: buildBunny },
  { id: 'blob', label: 'Человечек', emoji: '🧍', build: buildBlob },
  { id: 'square', label: 'Кубик', emoji: '🧊', build: buildSquarePerson },
  { id: 'sign', label: 'Пешеход', emoji: '🚸', build: buildSignPerson },
];

// Draw a character's silhouette into a small canvas, scaled to fit and
// centred. Used anywhere a player needs to recognise a shape rather than
// read its name: the menu picker and the seeker's wanted list.
export function drawCharacterGlyph(canvas, id, { fill = '#fff', pad = 0.08 } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const k = Math.min(w / CHAR_BOX.w, h / CHAR_BOX.h) * (1 - pad * 2);
  ctx.save();
  ctx.translate((w - CHAR_BOX.w * k) / 2, (h - CHAR_BOX.h * k) / 2);
  ctx.scale(k, k);
  ctx.fillStyle = fill;
  ctx.fill(getCharacterPath(id));
  ctx.restore();
}

const cache = new Map();

export function getCharacterPath(id) {
  if (!cache.has(id)) {
    const def = CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
    cache.set(id, def.build());
  }
  return cache.get(id);
}

export function characterLabel(id) {
  const def = CHARACTERS.find((c) => c.id === id);
  return def ? def.label : id;
}

// Kept so older call sites (and the default character) keep working.
export function buildCharacterPath() { return getCharacterPath('cat'); }
