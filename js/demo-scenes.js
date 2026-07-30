// Procedurally-generated placeholder scenes so the game is playable
// without needing to upload a photo first. Pure canvas drawing — no
// external images, so no licensing concerns.

export const DEMO_SCENES = [
  { id: 'park', label: 'Парк' },
  { id: 'city', label: 'Город' },
  { id: 'beach', label: 'Пляж' },
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

export function paintDemoScene(ctx, w, h, id) {
  const rnd = rand(id.length * 97 + 13);
  if (id === 'park') {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, '#8fc7e8'); sky.addColorStop(1, '#cfe9c9');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.55);
    const grass = ctx.createLinearGradient(0, h * 0.5, 0, h);
    grass.addColorStop(0, '#6fa85a'); grass.addColorStop(1, '#3f6e34');
    ctx.fillStyle = grass; ctx.fillRect(0, h * 0.5, w, h * 0.5);
    for (let i = 0; i < 5; i++) {
      const tx = w * (0.1 + rnd() * 0.8), ty = h * (0.35 + rnd() * 0.12);
      ctx.fillStyle = '#5a3d24'; ctx.fillRect(tx - 6, ty, 12, h * 0.22);
      ctx.fillStyle = ['#3c7a3f', '#4f8f4f', '#2f6a37'][i % 3];
      ctx.beginPath(); ctx.arc(tx, ty - 6, 46 + rnd() * 20, 0, Math.PI * 2); ctx.fill();
    }
  } else if (id === 'city') {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#3a4a6b'); sky.addColorStop(1, '#c98a6b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = w * (0.08 + rnd() * 0.08);
      const bh = h * (0.3 + rnd() * 0.5);
      ctx.fillStyle = `rgb(${30 + rnd() * 20},${30 + rnd() * 20},${40 + rnd() * 20})`;
      ctx.fillRect(x, h - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,220,140,0.5)';
      for (let wy = h - bh + 10; wy < h - 10; wy += 18) {
        for (let wx = x + 6; wx < x + bw - 6; wx += 14) {
          if (rnd() > 0.5) ctx.fillRect(wx, wy, 6, 8);
        }
      }
      x += bw + 4;
    }
  } else if (id === 'beach') {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    sky.addColorStop(0, '#bfe6f2'); sky.addColorStop(1, '#eaf6ec');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.45);
    ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.16, 44, 0, Math.PI * 2); ctx.fill();
    const sea = ctx.createLinearGradient(0, h * 0.4, 0, h * 0.68);
    sea.addColorStop(0, '#2a7f9e'); sea.addColorStop(1, '#4fb0c9');
    ctx.fillStyle = sea; ctx.fillRect(0, h * 0.4, w, h * 0.28);
    const sand = ctx.createLinearGradient(0, h * 0.65, 0, h);
    sand.addColorStop(0, '#e8cf9a'); sand.addColorStop(1, '#d1b077');
    ctx.fillStyle = sand; ctx.fillRect(0, h * 0.65, w, h * 0.35);
  } else {
    // brick wall
    ctx.fillStyle = '#7a3f33'; ctx.fillRect(0, 0, w, h);
    const bw = 90, bh = 34;
    let row = 0;
    for (let y = 0; y < h; y += bh) {
      const offset = row % 2 === 0 ? 0 : -bw / 2;
      for (let x = offset; x < w; x += bw) {
        const shade = 0.85 + rnd() * 0.3;
        ctx.fillStyle = `rgba(${Math.round(122 * shade)},${Math.round(63 * shade)},${Math.round(51 * shade)},1)`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
      row++;
    }
  }
}

export function demoSceneDataUrl(id, w = 900, h = 1200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paintDemoScene(c.getContext('2d'), w, h, id);
  return c.toDataURL('image/jpeg', 0.9);
}
