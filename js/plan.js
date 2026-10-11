import { bounds, distance } from './geometry.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, t) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  if (t != null) e.textContent = t;
  return e;
};

/** Dibuja el plano de planta (SVG) con cotas y superficies. rooms: [{name,poly,area,x,z}] en metros. */
export function renderPlan(svg, rooms) {
  svg.replaceChildren();
  if (!rooms.length) return;
  const all = rooms.flatMap(r => r.poly.map(p => ({ x: p.x + r.ox, z: p.z + r.oz })));
  const b = bounds(all), pad = 1.2;
  const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
  svg.setAttribute('viewBox', `${b.minX - pad} ${b.minZ - pad} ${W} ${H}`);
  const fs = Math.max(W, H) / 40;
  for (const r of rooms) {
    const pts = r.poly.map(p => ({ x: p.x + r.ox, z: p.z + r.oz }));
    svg.appendChild(el('polygon', {
      points: pts.map(p => `${p.x},${p.z}`).join(' '),
      fill: 'var(--room)', stroke: 'var(--wall)', 'stroke-width': fs * 0.35, 'stroke-linejoin': 'round',
    }));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], d = distance(a, c);
      if (d < 0.5) continue;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      const nx = -(c.z - a.z) / d, nz = (c.x - a.x) / d; // normal; se aleja del centro luego
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const sign = ((mx - cx) * nx + (mz - cz) * nz) >= 0 ? 1 : -1;
      svg.appendChild(el('text', {
        x: mx + nx * sign * fs * 0.9, y: mz + nz * sign * fs * 0.9,
        'font-size': fs * 0.8, 'text-anchor': 'middle', fill: 'var(--dim)',
      }, d.toFixed(2) + ' m'));
    }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    svg.appendChild(el('text', { x: cx, y: cz - fs * 0.2, 'font-size': fs * 1.1, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-weight': 600 }, r.name));
    svg.appendChild(el('text', { x: cx, y: cz + fs * 1.1, 'font-size': fs, 'text-anchor': 'middle', fill: 'var(--ink)' }, r.area.toFixed(1) + ' m²'));
  }
}
