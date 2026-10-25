import { FOODS, macrosFor, sumMacros, type Food, type Macros } from './foods';

export type Basis = 'grams' | 'measure' | 'unit' | 'default';
export interface ParsedItem {
  raw: string; foodId: string | null; grams: number; basis: Basis;
  macros: Macros | null; low: number; high: number; confidence: 'high' | 'medium' | 'low';
}
export interface ParsedMeal { items: ParsedItem[]; total: Macros; low: number; high: number }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/.,\s_-]/g, ' ');
const singular = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'e', 'en', 'al', 'a', 'o', 'of', 'with', 'the', 'and', 'in', 'da', 'do', 'das', 'dos', 'um', 'uma', 'un', 'una', 'cocido', 'cocida', 'cooked', 'cozido', 'cozida', 'lata', 'can', 'dry', 'seca', 'polvo', 'para', 'mi', 'my', 'mis', 'unos', 'unas', 'some', 'tipo', 'casero', 'casera']);

const keywordsOf = (food: Food): Set<string> => {
  const raw = [...food.n, food.alias ?? ''].join(' ');
  return new Set(norm(raw).split(/[\s/,.()-]+/).map(singular).filter((w) => w.length >= 3 && !STOP.has(w)));
};
const KW = new Map(FOODS.map((x) => [x.id, keywordsOf(x)] as const));
/** Foods preferred when a bare generic word ties between several (e.g. "queso", "pan", "leche"). */
const DEFAULT_FOR = new Set(['cheese_semi', 'bread_white', 'milk_whole', 'yogurt_plain', 'chicken_breast', 'beef_lean', 'rice_white', 'pasta', 'egg', 'salad_mixed', 'coffee_black', 'potato', 'water']);

const NUMWORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, um: 1, uma: 1, one: 1, a: 1, an: 1, dos: 2, dois: 2, duas: 2, two: 2, tres: 3, three: 3, cuatro: 4, quatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, sete: 7, seven: 7, ocho: 8, oito: 8, eight: 8, nueve: 9, nove: 9, nine: 9, diez: 10, dez: 10, ten: 10,
  medio: 0.5, media: 0.5, meio: 0.5, meia: 0.5, half: 0.5,
};
type Measure = (f: Food) => number;
const MEASURES: Record<string, Measure> = {
  cucharada: (f) => (f.cat === 'fats' && f.liquid ? 13 : 15), colher: (f) => (f.cat === 'fats' && f.liquid ? 13 : 15), tbsp: () => 15, tablespoon: () => 15,
  cucharadita: () => 5, colherzinha: () => 5, tsp: () => 5, teaspoon: () => 5,
  taza: (f) => (f.liquid ? 240 : f.cat === 'nuts' ? 140 : 160), xicara: (f) => (f.liquid ? 240 : 160), cup: (f) => (f.liquid ? 240 : 160),
  vaso: (f) => (f.id === 'beer' ? 330 : 200), copo: () => 200, glass: () => 200,
  lata: (f) => (f.cat === 'drinks' ? 330 : f.unitG ?? f.portionG), can: (f) => (f.cat === 'drinks' ? 330 : f.unitG ?? f.portionG),
  rodaja: (f) => f.unitG ?? 30, rebanada: (f) => f.unitG ?? 30, fatia: (f) => f.unitG ?? 30, slice: (f) => f.unitG ?? 30, feta: (f) => f.unitG ?? 20, loncha: (f) => f.unitG ?? 20,
  punado: () => 30, handful: () => 30, punhado: () => 30,
  scoop: (f) => f.unitG ?? 30, medida: (f) => f.unitG ?? 30, bocha: (f) => f.unitG ?? 70,
  porcion: (f) => f.portionG, porcao: (f) => f.portionG, portion: (f) => f.portionG, plato: (f) => f.portionG, prato: (f) => f.portionG, plate: (f) => f.portionG, racion: (f) => f.portionG,
  pedazo: (f) => f.unitG ?? f.portionG, trozo: (f) => f.unitG ?? f.portionG, pieza: (f) => f.unitG ?? f.portionG, unidad: (f) => f.unitG ?? f.portionG, unidade: (f) => f.unitG ?? f.portionG, unit: (f) => f.unitG ?? f.portionG, piece: (f) => f.unitG ?? f.portionG,
};
const SIZE: Record<string, number> = { grande: 1.3, big: 1.3, large: 1.3, chico: 0.7, chica: 0.7, pequeno: 0.7, pequena: 0.7, small: 0.7, mediano: 1, mediana: 1, medium: 1 };

const SPLIT = /\s*(?:;|\n|\+|&|(?<!\d),|,(?!\d)|\s+y\s+|\s+e\s+|\s+and\s+|\s+con\s+|\s+com\s+|\s+with\s+)\s*/;

function protect(t: string): string {
  // multi-word dishes that contain a connector must not be split ("cafe con leche")
  return t.replace(/\bcafe con leche\b/g, 'cafe_con_leche').replace(/\bcafe com leite\b/g, 'cafe_com_leite').replace(/\bcoffee with milk\b/g, 'coffee_with_milk')
    .replace(/\bpan con queso\b/g, 'pan_con_queso').replace(/\barroz con leche\b/g, 'arroz_con_leche');
}

function pickFood(words: string[]): Food | null {
  let best: Food | null = null, bestScore = 0;
  const set = new Set(words);
  for (const food of FOODS) {
    let score = 0;
    for (const kw of KW.get(food.id)!) if (set.has(kw)) score += kw.length;
    if (!score) continue;
    if (DEFAULT_FOR.has(food.id)) score += 0.5;
    if (score > bestScore) { best = food; bestScore = score; }
  }
  return best;
}

const spread = (basis: Basis, food: Food): number => {
  const base = basis === 'grams' ? 0.1 : basis === 'measure' ? 0.25 : basis === 'unit' ? 0.2 : 0.35;
  return base + (food.cat === 'prepared' || food.cat === 'sweets' ? 0.1 : 0);
};

/**
 * Natural-language meal log ("2 huevos, 200 g de pollo con arroz y una banana") → items with estimated grams, macros and an
 * honest uncertainty range. Rule-based and deterministic (ES/PT/EN); unknown foods are returned unmatched for manual pick.
 */
export function parseMeal(text: string): ParsedMeal {
  const segments = protect(norm(text)).split(SPLIT).map((s) => s.replace(/_/g, ' ').trim()).filter(Boolean);
  const items: ParsedItem[] = segments.map((seg) => {
    let s = ` ${seg} `;
    let grams: number | null = null; let basis: Basis = 'default'; let count = 1; let measure: string | null = null; let size = 1;
    // 1) explicit mass / volume
    const m = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|grs|gramos?|gramas?|grams?|ml|cc|l|lt|litros?|liters?)\b/);
    if (m) {
      const v = Number(m[1]!.replace(',', '.')); const u = m[2]!;
      grams = /^(kg|kilo)/.test(u) ? v * 1000 : /^(l|lt|litro|liter)/.test(u) ? v * 1000 : v;
      basis = 'grams'; s = s.replace(m[0], ' ');
    }
    // 2) fractions / numbers / number-words, and measure words
    const frac = s.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (frac) { count = Number(frac[1]) / Number(frac[2]); s = s.replace(frac[0], ' '); }
    else {
      const num = s.match(/\b(\d+(?:[.,]\d+)?)\b/);
      if (num) { count = Number(num[1]!.replace(',', '.')); s = s.replace(num[0], ' '); }
    }
    const words = s.split(/[\s,./-]+/).filter(Boolean);
    const rest: string[] = [];
    for (const w of words) {
      const sw = singular(w);
      if (!frac && !m && count === 1 && NUMWORDS[w] !== undefined && rest.length === 0 && !/\d/.test(seg)) { count = NUMWORDS[w]!; continue; }
      if (NUMWORDS[w] !== undefined && !measure && rest.length === 0 && NUMWORDS[w] !== 1) { count = NUMWORDS[w]!; continue; }
      if (MEASURES[sw] || MEASURES[w]) { measure = MEASURES[sw] ? sw : w; continue; }
      if (SIZE[w] !== undefined) { size = SIZE[w]!; continue; }
      if (STOP.has(w) || NUMWORDS[w] !== undefined) continue;
      rest.push(singular(w));
    }
    const food = pickFood(rest);
    if (!food) return { raw: seg, foodId: null, grams: 0, basis: 'default' as Basis, macros: null, low: 0, high: 0, confidence: 'low' as const };
    if (grams === null) {
      if (measure) { grams = count * MEASURES[measure]!(food) * size; basis = 'measure'; }
      else if (/\d/.test(seg) || count !== 1 || /^\s*(un|una|um|uma|one|a|an)\s/.test(seg)) { grams = count * (food.unitG ?? food.portionG) * size; basis = food.unitG ? 'unit' : 'default'; }
      else { grams = food.portionG * size; basis = 'default'; }
    }
    grams = Math.round(grams);
    const mac = macrosFor(food, grams), sp = spread(basis, food);
    return { raw: seg, foodId: food.id, grams, basis, macros: mac, low: Math.round(mac.kcal * (1 - sp)), high: Math.round(mac.kcal * (1 + sp)), confidence: basis === 'grams' ? 'high' : basis === 'default' ? 'low' : 'medium' };
  });
  const known = items.filter((i) => i.macros);
  return { items, total: sumMacros(known.map((i) => i.macros!)), low: known.reduce((a, i) => a + i.low, 0), high: known.reduce((a, i) => a + i.high, 0) };
}
