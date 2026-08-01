// Procedurally-generated scenes so the game is playable without needing
// to upload a photo first. Pure canvas drawing — no external images, so
// no licensing concerns.
//
// Everything is sized as a fraction of the target canvas, because the
// same routine draws both the 62px lobby thumbnail and the full-size
// round photo, and the thumbnail has to read as a miniature of it.
//
// The scenes deliberately carry texture — blades, leaves, speckle,
// per-brick shading. On a flat gradient a single eyedropper sample wins
// the round outright; against texture you actually have to work the
// brushes, which is the whole point of the game.

export const DEMO_SCENES = [
  { id: 'park', label: 'Парк' },
  { id: 'forest', label: 'Листва' },
  { id: 'city', label: 'Город' },
  { id: 'beach', label: 'Пляж' },
  { id: 'pebbles', label: 'Камни' },
  { id: 'brick', label: 'Стена' },
];

function rand(seed) {
  // tiny deterministic PRNG so a scene looks the same every time
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function seedFor(id) {
  let s = 7;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return s;
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * amount)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

// How many blobs of radius r it takes to cover w×h. Counting by coverage
// rather than by raw pixel area is what keeps the 62px lobby thumbnail
// as dense as the full-size scene — a fixed pixel density would leave
// the thumbnail nearly empty and a stone field would read as flat grey.
function blobCount(w, h, r, coverage = 2) {
  return Math.max(8, Math.round((w * h) / (Math.PI * r * r) * coverage));
}

// Scatter soft blobs — the workhorse behind grass, leaves and sand grain.
function scatter(ctx, rnd, count, box, palette, rMin, rMax, squash = 1) {
  for (let i = 0; i < count; i++) {
    const x = box.x + rnd() * box.w;
    const y = box.y + rnd() * box.h;
    const r = rMin + rnd() * (rMax - rMin);
    ctx.fillStyle = shade(pick(rnd, palette), 0.85 + rnd() * 0.3);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * squash, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintPark(ctx, rnd, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.58);
  sky.addColorStop(0, '#7cbde3'); sky.addColorStop(1, '#d3e9cb');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.58);

  const grass = ctx.createLinearGradient(0, h * 0.5, 0, h);
  grass.addColorStop(0, '#74ad5c'); grass.addColorStop(1, '#37622e');
  ctx.fillStyle = grass; ctx.fillRect(0, h * 0.5, w, h * 0.5);

  // blades: short strokes that get longer and darker toward the viewer
  const blades = blobCount(w, h * 0.5, Math.min(w, h) * 0.012, 3);
  for (let i = 0; i < blades; i++) {
    const t = rnd();
    const y = h * (0.5 + t * 0.5);
    const x = rnd() * w;
    const len = h * (0.006 + t * 0.02);
    ctx.strokeStyle = shade(pick(rnd, ['#5f9a4c', '#7ab863', '#41703a', '#8cc472']), 0.85 + rnd() * 0.3);
    ctx.lineWidth = Math.max(0.6, w * 0.0016);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * len * 0.6, y - len);
    ctx.stroke();
  }

  // trees: trunk plus layered dappled foliage
  for (let i = 0; i < 5; i++) {
    const tx = w * (0.08 + rnd() * 0.84);
    const ty = h * (0.34 + rnd() * 0.14);
    ctx.fillStyle = shade('#5a3d24', 0.85 + rnd() * 0.3);
    ctx.fillRect(tx - w * 0.008, ty, w * 0.016, h * 0.2);
    const rad = w * (0.07 + rnd() * 0.04);
    scatter(ctx, rnd, 40, { x: tx - rad, y: ty - rad * 1.5, w: rad * 2, h: rad * 1.6 },
      ['#3c7a3f', '#4f8f4f', '#2f6a37', '#63a355'], rad * 0.16, rad * 0.4);
  }

  // a few flowers for colour speckle
  scatter(ctx, rnd, blobCount(w, h * 0.38, Math.min(w, h) * 0.05, 0.05), { x: 0, y: h * 0.62, w, h: h * 0.38 },
    ['#f0e2a0', '#e8f0f4', '#e0a6c4'], w * 0.004, w * 0.008);
}

function paintForest(ctx, rnd, w, h) {
  // dense canopy filling the frame — the hardest scene to blend into,
  // and the most rewarding when you get it right
  ctx.fillStyle = '#20351f'; ctx.fillRect(0, 0, w, h);
  const greens = ['#3f6b32', '#4f8340', '#5f9a45', '#2e5227', '#6f9c3c'];
  const autumn = ['#9c7a2c', '#b08b34', '#7d5a24'];

  // shafts of light so the scene has bright and dark regions to hide in
  for (let i = 0; i < 5; i++) {
    const g = ctx.createLinearGradient(w * rnd(), 0, w * rnd(), h);
    g.addColorStop(0, 'rgba(220,240,190,0.16)');
    g.addColorStop(1, 'rgba(220,240,190,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  const leafR = Math.min(w, h) * 0.018;
  const leaves = blobCount(w, h, leafR * 0.75, 1.6);
  scatter(ctx, rnd, Math.round(leaves * 0.8), { x: 0, y: 0, w, h }, greens, leafR * 0.5, leafR, 0.55);
  scatter(ctx, rnd, Math.round(leaves * 0.2), { x: 0, y: 0, w, h }, autumn, leafR * 0.5, leafR, 0.55);

  // a couple of branches crossing the frame
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = shade('#4a3520', 0.8 + rnd() * 0.4);
    ctx.lineWidth = w * (0.006 + rnd() * 0.01);
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, h * rnd());
    ctx.bezierCurveTo(w * 0.3, h * rnd(), w * 0.7, h * rnd(), w * 1.05, h * rnd());
    ctx.stroke();
  }
  scatter(ctx, rnd, Math.round(leaves * 0.35), { x: 0, y: 0, w, h }, greens, leafR * 0.4, leafR * 0.8, 0.55);
}

function paintCity(ctx, rnd, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2d3c5c'); sky.addColorStop(0.6, '#7a6a80');
  sky.addColorStop(1, '#d09468');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

  // far skyline in haze, then the near blocks in front of it
  for (const layer of [{ dim: 0.55, top: 0.42, alpha: 0.55 }, { dim: 1, top: 0.28, alpha: 1 }]) {
    ctx.globalAlpha = layer.alpha;
    let x = -w * 0.05;
    while (x < w) {
      const bw = w * (0.07 + rnd() * 0.1);
      const bh = h * (layer.top + rnd() * 0.42);
      const base = 34 + rnd() * 22;
      ctx.fillStyle = `rgb(${Math.round(base * layer.dim)},${Math.round((base + 4) * layer.dim)},${Math.round((base + 16) * layer.dim)})`;
      ctx.fillRect(x, h - bh, bw, bh);
      if (layer.dim === 1) {
        const stepY = h * 0.022, stepX = bw * 0.19;
        for (let wy = h - bh + stepY; wy < h - stepY; wy += stepY) {
          for (let wx = x + stepX * 0.5; wx < x + bw - stepX * 0.5; wx += stepX) {
            const r = rnd();
            if (r > 0.45) {
              ctx.fillStyle = r > 0.82
                ? `rgba(255,214,130,${0.35 + rnd() * 0.5})`
                : `rgba(150,180,210,${0.12 + rnd() * 0.2})`;
              ctx.fillRect(wx, wy, stepX * 0.5, stepY * 0.5);
            }
          }
        }
      }
      x += bw + w * 0.006;
    }
    ctx.globalAlpha = 1;
  }
}

function paintBeach(ctx, rnd, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  sky.addColorStop(0, '#a7dcee'); sky.addColorStop(1, '#f2f7ec');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.45);
  ctx.fillStyle = '#ffe28a';
  ctx.beginPath(); ctx.arc(w * 0.76, h * 0.15, Math.min(w, h) * 0.05, 0, Math.PI * 2); ctx.fill();

  // sea as bands of shifting blue with foam crests
  const seaTop = h * 0.4, seaH = h * 0.26;
  const sea = ctx.createLinearGradient(0, seaTop, 0, seaTop + seaH);
  sea.addColorStop(0, '#1f6f8f'); sea.addColorStop(1, '#59b8cd');
  ctx.fillStyle = sea; ctx.fillRect(0, seaTop, w, seaH);
  for (let i = 0; i < 26; i++) {
    const y = seaTop + rnd() * seaH;
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.35})`;
    ctx.lineWidth = Math.max(0.8, h * 0.0022);
    ctx.beginPath();
    const x0 = rnd() * w, len = w * (0.08 + rnd() * 0.3);
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + len * 0.5, y - h * 0.005, x0 + len, y);
    ctx.stroke();
  }

  const sand = ctx.createLinearGradient(0, seaTop + seaH, 0, h);
  sand.addColorStop(0, '#ecd6a2'); sand.addColorStop(1, '#c9a468');
  ctx.fillStyle = sand; ctx.fillRect(0, seaTop + seaH, w, h - seaTop - seaH);
  // wet line where the water reaches, then dry grain
  ctx.fillStyle = 'rgba(160,140,100,0.35)';
  ctx.fillRect(0, seaTop + seaH, w, h * 0.02);
  const sandH = h - seaTop - seaH;
  scatter(ctx, rnd, blobCount(w, sandH, w * 0.0025, 1.2), { x: 0, y: seaTop + seaH, w, h: sandH },
    ['#d8bf8c', '#f0dcae', '#b89a63', '#9c8050'], w * 0.001, w * 0.004);
}

function paintPebbles(ctx, rnd, w, h) {
  ctx.fillStyle = '#6e6a63'; ctx.fillRect(0, 0, w, h);
  const stones = ['#8c8880', '#a19a8f', '#6f6a62', '#b7ada0', '#7d746a', '#9a8f7e'];
  const r = Math.min(w, h) * 0.035;
  const count = blobCount(w, h, r * 0.7, 2.4);
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const rx = r * (0.5 + rnd() * 0.7), ry = rx * (0.6 + rnd() * 0.35);
    const rot = rnd() * Math.PI;
    const base = pick(rnd, stones);
    ctx.fillStyle = shade(base, 0.82 + rnd() * 0.34);
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
    // a lit top edge gives each stone volume
    ctx.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.12})`;
    ctx.beginPath(); ctx.ellipse(x - rx * 0.18, y - ry * 0.28, rx * 0.6, ry * 0.42, rot, 0, Math.PI * 2); ctx.fill();
  }
}

function paintBrick(ctx, rnd, w, h) {
  ctx.fillStyle = '#d9d2c4'; // mortar
  ctx.fillRect(0, 0, w, h);
  const bw = w * 0.24, bh = h * 0.035;
  const gap = Math.max(1, w * 0.006);
  let row = 0;
  for (let y = 0; y < h; y += bh) {
    const offset = row % 2 === 0 ? 0 : -bw / 2;
    for (let x = offset; x < w; x += bw) {
      const base = pick(rnd, ['#8a4436', '#7a3f33', '#96503c', '#6d3a2f', '#a05a44']);
      ctx.fillStyle = shade(base, 0.86 + rnd() * 0.28);
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);
    }
    row++;
  }
  // grain over the whole wall so it isn't a flat colour per brick
  ctx.globalAlpha = 0.35;
  scatter(ctx, rnd, blobCount(w, h, w * 0.003, 1.2), { x: 0, y: 0, w, h },
    ['#5c2f26', '#a86a52', '#8a4436'], w * 0.001, w * 0.005);
  ctx.globalAlpha = 1;
}

const PAINTERS = {
  park: paintPark,
  forest: paintForest,
  city: paintCity,
  beach: paintBeach,
  pebbles: paintPebbles,
  brick: paintBrick,
};

export function paintDemoScene(ctx, w, h, id) {
  const painter = PAINTERS[id] || paintPark;
  ctx.save();
  painter(ctx, rand(seedFor(id)), w, h);
  ctx.restore();
}

export function demoSceneDataUrl(id, w = 900, h = 1200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paintDemoScene(c.getContext('2d'), w, h, id);
  return c.toDataURL('image/jpeg', 0.9);
}
