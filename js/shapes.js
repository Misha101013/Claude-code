// Character silhouette: a cute rounded "blob person" used as the
// hideable shape. Defined in a local 100x140 box centered on (50,70),
// returned as a Path2D you can transform (translate/scale) before use.

export const CHAR_BOX = { w: 100, h: 140 };

export function buildCharacterPath() {
  const p = new Path2D();

  // Head
  p.moveTo(50, 4);
  p.arc(50, 30, 26, 0, Math.PI * 2);

  // Body + legs as one rounded blob (drawn as a separate subpath so the
  // whole shape fills as a single silhouette).
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
