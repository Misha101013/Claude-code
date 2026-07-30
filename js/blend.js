// How well does the painted character match the photo behind it?
//
// Sample the sprite on a coarse grid, compare each opaque sample to the
// photo pixel it covers, and average the perceptual distance. This gives
// hiders a skill-based score that doesn't depend on whether the seeker
// happened to tap the right spot, and drives the live "blend" meter.

const SAMPLE_W = 34;
const SAMPLE_H = 48;

// Mean distance at which the score bottoms out. Roughly "every channel
// is off by ~90", which is unmistakably visible on any background.
const TOLERANCE = 0.35;

// Green carries most perceived brightness, blue the least.
const WR = 0.3, WG = 0.59, WB = 0.11;

let sampleCanvas = null;
function getSampleCtx() {
  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = SAMPLE_W;
    sampleCanvas.height = SAMPLE_H;
  }
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
  return ctx;
}

// `rect` is where the sprite sits in photo-canvas pixels.
// Returns 0..1, or null when there's nothing meaningful to measure.
export function computeBlendScore({ photoCtx, spriteCanvas, rect, canvasW, canvasH }) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvasW, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(canvasH, Math.ceil(rect.y + rect.h));
  const regionW = x1 - x0;
  const regionH = y1 - y0;
  if (regionW <= 1 || regionH <= 1) return null;

  let photo;
  try {
    photo = photoCtx.getImageData(x0, y0, regionW, regionH);
  } catch (_) {
    return null; // tainted canvas — never expected here, but don't crash the round
  }

  const ctx = getSampleCtx();
  ctx.drawImage(spriteCanvas, 0, 0, SAMPLE_W, SAMPLE_H);
  const sprite = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);

  let total = 0;
  let count = 0;
  for (let sy = 0; sy < SAMPLE_H; sy++) {
    for (let sx = 0; sx < SAMPLE_W; sx++) {
      const si = (sy * SAMPLE_W + sx) * 4;
      if (sprite.data[si + 3] < 128) continue;

      // Sample at the centre of the cell this sample stands for.
      const fx = rect.x + ((sx + 0.5) / SAMPLE_W) * rect.w;
      const fy = rect.y + ((sy + 0.5) / SAMPLE_H) * rect.h;
      const px = Math.round(fx) - x0;
      const py = Math.round(fy) - y0;
      if (px < 0 || py < 0 || px >= regionW || py >= regionH) continue;

      const pi = (py * regionW + px) * 4;
      const dr = sprite.data[si] - photo.data[pi];
      const dg = sprite.data[si + 1] - photo.data[pi + 1];
      const db = sprite.data[si + 2] - photo.data[pi + 2];
      total += Math.sqrt(WR * dr * dr + WG * dg * dg + WB * db * db) / 255;
      count++;
    }
  }

  if (count === 0) return null;
  const mean = total / count;
  return Math.max(0, Math.min(1, 1 - mean / TOLERANCE));
}

export function blendLabel(score) {
  if (score == null) return '—';
  const pct = Math.round(score * 100);
  if (pct >= 90) return pct + '% идеально';
  if (pct >= 75) return pct + '% хорошо';
  if (pct >= 55) return pct + '% так себе';
  return pct + '% заметно';
}
