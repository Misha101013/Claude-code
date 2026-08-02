// Навигация покупателей: граф путевых точек + A*.
// Граф строится один раз при старте из общей геометрии магазина.

import {
  collisionBoxes, SHELVES, CHECKOUTS, queueSlot,
  ENTRANCE_INSIDE, ENTRANCE_OUTSIDE,
} from '../shared/layout.js';
import { clearPath, dist } from '../shared/physics.js';
import { QUEUE_SLOTS, CUSTOMER_RADIUS } from '../shared/config.js';

const PAD = CUSTOMER_RADIUS + 0.11;

// Коридоры торгового зала
const LANE_Z = [-10.6, -7.6, -6.6, -1.25, 3.25, 7.0];
const COL_X = [-12.2, -9, -5.4, -1.8, 1.8, 5.4, 9, 12.2];

const boxes = collisionBoxes().filter((b) => b.kind !== 'desk' && b.kind !== 'trash');

const nodes = [];
const addNode = (x, z, tag) => {
  const n = { x, z, tag, edges: [] };
  nodes.push(n);
  return n;
};

for (const z of LANE_Z) for (const x of COL_X) addNode(x, z, 'lane');
addNode(ENTRANCE_INSIDE.x, ENTRANCE_INSIDE.z, 'door');
addNode(ENTRANCE_OUTSIDE.x, ENTRANCE_OUTSIDE.z, 'exit');
for (const s of SHELVES) addNode(s.front.x, s.front.z, `shelf:${s.id}`);
for (const c of CHECKOUTS) {
  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const q = queueSlot(c, i);
    addNode(q.x, q.z, `queue:${c.id}:${i}`);
  }
}

// рёбра: соединяем точки, между которыми есть прямая видимость
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i];
    const b = nodes[j];
    const d = dist(a.x, a.z, b.x, b.z);
    if (d > 9.5) continue;
    if (!clearPath(a.x, a.z, b.x, b.z, boxes, PAD)) continue;
    a.edges.push({ n: j, d });
    b.edges.push({ n: i, d });
  }
}

function nearestVisible(x, z) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const d = dist(x, z, n.x, n.z);
    if (d >= bestD) continue;
    if (!clearPath(x, z, n.x, n.z, boxes, PAD)) continue;
    best = i;
    bestD = d;
  }
  if (best === -1) {
    // запасной вариант: ближайшая точка вообще
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const d = dist(x, z, n.x, n.z);
      if (d < bestD) { best = i; bestD = d; }
    }
  }
  return best;
}

// Возвращает массив точек {x,z} от текущей позиции до цели (цель включена).
export function findPath(fromX, fromZ, toX, toZ) {
  if (clearPath(fromX, fromZ, toX, toZ, boxes, PAD)) return [{ x: toX, z: toZ }];

  const start = nearestVisible(fromX, fromZ);
  const goal = nearestVisible(toX, toZ);
  if (start === -1 || goal === -1) return [{ x: toX, z: toZ }];
  if (start === goal) return [{ x: nodes[goal].x, z: nodes[goal].z }, { x: toX, z: toZ }];

  const n = nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = [start];
  g[start] = 0;
  f[start] = dist(nodes[start].x, nodes[start].z, toX, toZ);

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) break;
    closed[cur] = 1;
    for (const e of nodes[cur].edges) {
      if (closed[e.n]) continue;
      const ng = g[cur] + e.d;
      if (ng < g[e.n]) {
        g[e.n] = ng;
        f[e.n] = ng + dist(nodes[e.n].x, nodes[e.n].z, toX, toZ);
        prev[e.n] = cur;
        if (!open.includes(e.n)) open.push(e.n);
      }
    }
  }

  if (prev[goal] === -1 && goal !== start) return [{ x: toX, z: toZ }];

  const chain = [];
  for (let c = goal; c !== -1; c = prev[c]) {
    chain.push({ x: nodes[c].x, z: nodes[c].z });
    if (c === start) break;
  }
  chain.reverse();
  chain.push({ x: toX, z: toZ });
  return chain;
}

export const navBoxes = boxes;
