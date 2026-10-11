// Reglas orientativas (Argentina). NO reemplazan Código de Edificación municipal
// ni a un profesional matriculado: sirven para orientar preguntas y presupuesto.

export const ROOM_TYPES = {
  dormitorio: { label: 'Dormitorio', minArea: 9, minSide: 2.6, wet: false },
  living: { label: 'Living / Comedor', minArea: 12, minSide: 2.6, wet: false },
  cocina: { label: 'Cocina', minArea: 4, minSide: 1.8, wet: true },
  bano: { label: 'Baño', minArea: 2.5, minSide: 1.2, wet: true },
  lavadero: { label: 'Lavadero', minArea: 2, minSide: 1.2, wet: true },
  pasillo: { label: 'Pasillo', minArea: 0, minSide: 0.9, wet: false },
  otro: { label: 'Otro', minArea: 0, minSide: 0, wet: false },
};

// Precios de REFERENCIA en ARS: editables por el usuario. Actualizar antes de usar.
export const DEFAULT_PRICES = {
  pintura_m2: 6000,
  piso_m2: 38000,
  revestimiento_m2: 32000,
  demolicion_tabique_m2: 15000,
  tabique_durlock_m2: 42000,
  electricidad_boca: 45000,
  sanitaria_artefacto: 120000,
};

export const RULES_NOTE =
  'Valores orientativos. Verificá el Código de Edificación / Urbanístico de tu municipio y consultá a un profesional matriculado.';

/** Analiza un ambiente y devuelve hallazgos y sugerencias. */
export function analyzeRoom(room) {
  const t = ROOM_TYPES[room.type] || ROOM_TYPES.otro;
  const out = [];
  const w = room.minSide, area = room.area;
  if (t.minArea && area < t.minArea)
    out.push({ level: 'warn', text: `${t.label} de ${area.toFixed(1)} m²: queda por debajo de ~${t.minArea} m² orientativos.` });
  if (t.minSide && w < t.minSide)
    out.push({ level: 'warn', text: `Lado menor de ${w.toFixed(2)} m (orientativo ≥ ${t.minSide} m).` });
  if (room.height && room.height < 2.4)
    out.push({ level: 'warn', text: `Altura ${room.height.toFixed(2)} m: baja para local habitable (orientativo ≥ 2,40 m).` });
  if (!room.hasWindow && room.type !== 'pasillo')
    out.push({ level: 'warn', text: 'Sin ventana: revisar ventilación e iluminación natural exigidas.' });
  if (room.type === 'cocina' && room.hasWindow === false)
    out.push({ level: 'risk', text: 'Cocina sin ventilación: riesgo con artefactos a gas. Consultar gasista matriculado.' });
  if (area > 0 && room.type === 'living' && area > 20)
    out.push({ level: 'idea', text: 'Superficie amplia: se puede zonificar estar/comedor/escritorio con mobiliario o desniveles de luz.' });
  return out;
}

/** Sugerencias globales de reforma según el conjunto de ambientes. */
export function suggestReforms(rooms) {
  const s = [];
  const by = type => rooms.filter(r => r.type === type);
  const cocina = by('cocina')[0], living = by('living')[0];
  if (cocina && living) {
    s.push({
      title: 'Integrar cocina y living',
      risk: 'verificar muro',
      detail: 'Abrir el muro entre ambos gana luz y amplitud. Si es portante necesita viga y cálculo de un ingeniero; si es tabique, es una obra simple.',
      cost: { demolicion_tabique_m2: 2.6 * 3 },
    });
  }
  if (by('bano').length === 1 && by('dormitorio').length >= 3)
    s.push({ title: 'Agregar toilette o baño en suite', risk: 'instalaciones', detail: 'Con 3+ dormitorios y un solo baño conviene sumar un segundo núcleo húmedo, idealmente contra una pared sanitaria existente para abaratar cañerías.', cost: { sanitaria_artefacto: 3, revestimiento_m2: 20 } });
  rooms.filter(r => !r.hasWindow && r.type !== 'pasillo').forEach(r =>
    s.push({ title: `Ventilación/luz en ${r.name}`, risk: 'fachada', detail: 'Evaluar abertura, ventilación por conducto o claraboya. Si da a medianera, hay restricciones.', cost: {} }));
  if (rooms.some(r => r.area > 0)) s.push({ title: 'Renovar terminaciones', risk: 'bajo', detail: 'Pintura y pisos son la reforma de mayor impacto visual con menor riesgo.', cost: { pintura_m2: rooms.reduce((a, r) => a + r.wallArea, 0), piso_m2: rooms.reduce((a, r) => a + r.area, 0) } });
  return s;
}

export function estimateCost(items, prices = DEFAULT_PRICES) {
  let total = 0;
  const lines = Object.entries(items).map(([k, qty]) => {
    const sub = (prices[k] || 0) * qty;
    total += sub;
    return { key: k, qty, unit: prices[k] || 0, sub };
  });
  return { lines, total, range: [total * 0.85, total * 1.35] }; // incertidumbre típica de obra
}

/** Cuántos m² de pared (sin descontar vanos) tiene un ambiente. */
export function wallArea(perimeterM, height) { return perimeterM * height; }
