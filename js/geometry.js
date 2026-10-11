// Geometría pura (sin DOM) para poder probarla en Node.

/** Área de un polígono (m²) por la fórmula del cordón. pts = [{x,z}] en metros. */
export function polygonArea(pts) {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function perimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) p += distance(pts[i], pts[(i + 1) % pts.length]);
  return p;
}

export function bounds(pts) {
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

export function centroid(pts) {
  const b = bounds(pts);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** Rectángulo ancho × largo como polígono. */
export function rectPolygon(w, l, ox = 0, oz = 0) {
  return [{ x: ox, z: oz }, { x: ox + w, z: oz }, { x: ox + w, z: oz + l }, { x: ox, z: oz + l }];
}

/** Ajusta ángulos casi rectos (±tol grados) a 90° cuando el polígono es ortogonal. */
export function snapOrthogonal(pts, tolDeg = 8) {
  if (pts.length < 3) return pts.slice();
  // Orienta el polígono según su arista más larga y alinea las aristas casi axiales.
  let best = 0, bl = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = distance(pts[i], pts[(i + 1) % pts.length]);
    if (d > bl) { bl = d; best = i; }
  }
  const a = pts[best], b = pts[(best + 1) % pts.length];
  const ang = Math.atan2(b.z - a.z, b.x - a.x);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = pts.map(p => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
  const tol = Math.tan(tolDeg * Math.PI / 180);
  // Vértices unidos por una arista casi horizontal comparten z; por una casi vertical, x.
  // Se agrupan (union-find) y cada grupo toma el promedio, sin acumular error.
  const n = rot.length, px = [...Array(n).keys()], pz = [...Array(n).keys()];
  const find = (u, i) => (u[i] === i ? i : (u[i] = find(u, u[i])));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = rot[j].x - rot[i].x, dz = rot[j].z - rot[i].z;
    if (Math.abs(dz) < Math.abs(dx) * tol) pz[find(pz, i)] = find(pz, j);
    else if (Math.abs(dx) < Math.abs(dz) * tol) px[find(px, i)] = find(px, j);
  }
  const mean = (u, key) => {
    const sum = {}, cnt = {};
    rot.forEach((p, i) => { const r = find(u, i); sum[r] = (sum[r] || 0) + p[key]; cnt[r] = (cnt[r] || 0) + 1; });
    return i => sum[find(u, i)] / cnt[find(u, i)];
  };
  const gx = mean(px, 'x'), gz = mean(pz, 'z');
  return rot.map((_, i) => ({ x: gx(i), z: gz(i) })).map(p => ({ x: p.x * c + p.z * s, z: -p.x * s + p.z * c }));
}
