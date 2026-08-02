// Простая 2D-физика: круг против набора AABB. Используется и клиентом
// (движение игрока), и сервером (движение покупателей).

export function resolveCircle(x, z, radius, boxes) {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      const hw = b.w / 2 + radius;
      const hd = b.d / 2 + radius;
      const dx = px - b.x;
      const dz = pz - b.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const overlapX = hw - Math.abs(dx);
        const overlapZ = hd - Math.abs(dz);
        if (overlapX < overlapZ) px += dx >= 0 ? overlapX : -overlapX;
        else pz += dz >= 0 ? overlapZ : -overlapZ;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

// Пересекает ли отрезок (x1,z1)-(x2,z2) прямоугольник, раздутый на pad.
export function segmentHitsBox(x1, z1, x2, z2, b, pad = 0) {
  const minX = b.x - b.w / 2 - pad;
  const maxX = b.x + b.w / 2 + pad;
  const minZ = b.z - b.d / 2 - pad;
  const maxZ = b.z + b.d / 2 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;

  const slabs = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dz, z1 - minZ],
    [dz, maxZ - z1],
  ];

  for (const [p, q] of slabs) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export function clearPath(x1, z1, x2, z2, boxes, pad) {
  for (const b of boxes) {
    if (segmentHitsBox(x1, z1, x2, z2, b, pad)) return false;
  }
  return true;
}

export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
