import { polygonArea, perimeter, rectPolygon, bounds, snapOrthogonal } from './geometry.js';
import { ROOM_TYPES, DEFAULT_PRICES, RULES_NOTE, analyzeRoom, suggestReforms, estimateCost, wallArea } from './advisor.js';
import { renderPlan } from './plan.js';
import { arSupported, scanFloorCorners } from './ar.js';

const $ = id => document.getElementById(id);
const KEY = 'arquitecto.rooms.v1';
const ars = n => '$' + Math.round(n).toLocaleString('es-AR');
let rooms = [];
try { rooms = JSON.parse(localStorage.getItem(KEY)) || []; } catch { rooms = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rooms)); } catch {} };

$('rType').innerHTML = Object.entries(ROOM_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
$('note').textContent = RULES_NOTE;

function meta() {
  return {
    name: $('rName').value.trim() || ROOM_TYPES[$('rType').value].label + ' ' + (rooms.length + 1),
    type: $('rType').value,
    height: parseFloat($('rHeight').value) || 2.6,
    hasWindow: $('rWindow').checked,
  };
}

function addRoom(poly) {
  const b = bounds(poly);
  const norm = poly.map(p => ({ x: p.x - b.minX, z: p.z - b.minZ }));
  const right = rooms.reduce((m, r) => Math.max(m, r.ox + bounds(r.poly).maxX), -1.2);
  rooms.push({ id: Date.now(), ...meta(), poly: norm, ox: right + 1.2, oz: 0 });
  $('rName').value = '';
  save(); render();
}

function metrics(r) {
  const b = bounds(r.poly), area = polygonArea(r.poly), per = perimeter(r.poly);
  return { ...r, area, per, minSide: Math.min(b.maxX - b.minX, b.maxZ - b.minZ), wallArea: wallArea(per, r.height) };
}

function render() {
  const ms = rooms.map(metrics);
  renderPlan($('plan'), ms);
  const tot = ms.reduce((a, r) => a + r.area, 0);
  $('totals').textContent = ms.length ? `${ms.length} ambiente(s) · superficie cubierta relevada: ${tot.toFixed(1)} m²` : 'Todavía no hay ambientes. Escaneá o cargá uno.';
  $('roomList').innerHTML = '';
  ms.forEach(r => {
    const li = document.createElement('li');
    li.textContent = `${r.name} — ${r.area.toFixed(2)} m², perímetro ${r.per.toFixed(2)} m `;
    const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'Quitar';
    b.onclick = () => { rooms = rooms.filter(x => x.id !== r.id); save(); render(); };
    li.append(b); $('roomList').append(li);
  });
  $('findings').innerHTML = ms.map(r => analyzeRoom(r).map(f => `<div class="f ${f.level}"><b>${r.name}:</b> ${f.text}</div>`).join('')).join('');
  $('reforms').innerHTML = suggestReforms(ms).map(s => {
    const c = estimateCost(s.cost, DEFAULT_PRICES);
    return `<div class="card"><b>${s.title}</b> <span class="dim">· riesgo: ${s.risk}</span><p>${s.detail}</p>` +
      (c.total ? `<p class="dim">Estimado de referencia: ${ars(c.range[0])} – ${ars(c.range[1])} (precios editables en js/advisor.js; actualizalos)</p>` : '') + `</div>`;
  }).join('');
}

$('btnManual').onclick = () => {
  const w = parseFloat($('mW').value), l = parseFloat($('mL').value);
  if (!(w > 0 && l > 0)) return alert('Ingresá ancho y largo válidos.');
  addRoom(rectPolygon(w, l));
};

const download = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
};
$('btnSvg').onclick = () => download('plano.svg', new XMLSerializer().serializeToString($('plan')).replace(/var\(--room\)/g, '#dfe9f5').replace(/var\(--wall\)/g, '#17202b').replace(/var\(--dim\)/g, '#5b6675').replace(/var\(--ink\)/g, '#17202b'), 'image/svg+xml');
$('btnJson').onclick = () => download('relevamiento.json', JSON.stringify(rooms.map(metrics), null, 2), 'application/json');
$('btnClear').onclick = () => { if (confirm('¿Borrar todos los ambientes?')) { rooms = []; save(); render(); } };

arSupported().then(ok => {
  $('arStatus').textContent = ok
    ? 'Tu dispositivo soporta medición con cámara (AR). Ubicate en el ambiente y tocá cada esquina del piso.'
    : 'Este navegador no soporta medición AR (necesitás Chrome en Android con ARCore). Podés cargar las medidas a mano.';
  $('btnAR').disabled = !ok;
});

$('btnAR').onclick = async () => {
  const overlay = $('arOverlay'); overlay.hidden = false;
  let marked = 0;
  try {
    const s = await scanFloorCorners(overlay,
      n => { marked = n; $('arMsg').textContent = `${n} esquina(s) marcadas`; },
      ready => { if (!marked) $('arMsg').textContent = ready ? 'Listo: tocá una esquina' : 'Apuntá al piso'; });
    $('arUndo').onclick = () => { s.undo(); marked = s.points.length; $('arMsg').textContent = `${marked} esquina(s)`; };
    $('arDone').onclick = () => s.finish();
    const pts = await s.ended;
    overlay.hidden = true;
    if (pts.length < 3) return alert('Hacen falta al menos 3 esquinas.');
    addRoom(snapOrthogonal(pts.map(p => ({ x: p.x, z: p.z }))));
  } catch (e) {
    overlay.hidden = true; alert('No se pudo iniciar la cámara AR: ' + e.message);
  }
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
