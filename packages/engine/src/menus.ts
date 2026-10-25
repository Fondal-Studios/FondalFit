export type Ingredient = 'meat' | 'fish' | 'egg' | 'dairy' | 'gluten' | 'nuts';
export type MealKind = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export interface Dish { id: string; kind: MealKind; p: number; c: number; f: number; contains: Ingredient[] }
export const dishKcal = (d: Pick<Dish, 'p' | 'c' | 'f'>) => Math.round(4 * d.p + 4 * d.c + 9 * d.f);

const d = (id: string, kind: MealKind, p: number, c: number, f: number, contains: Ingredient[] = []): Dish => ({ id, kind, p, c, f, contains });

/** Standard portions, approximate macros (typical values; real products vary). Names are translated in the UI as `dish_<id>`. */
export const DISHES: Dish[] = [
  d('oats_banana_walnuts', 'breakfast', 12, 60, 16, ['gluten', 'nuts']),
  d('yogurt_granola_fruit', 'breakfast', 20, 55, 10, ['dairy', 'gluten']),
  d('eggs_toast_avocado', 'breakfast', 22, 35, 24, ['egg', 'gluten']),
  d('tofu_scramble_potato', 'breakfast', 22, 38, 14),
  d('protein_pancakes_berries', 'breakfast', 30, 50, 9, ['egg', 'dairy', 'gluten']),
  d('chia_pudding_mango', 'breakfast', 10, 42, 18),
  d('smoothie_banana_peanut_whey', 'breakfast', 32, 48, 14, ['dairy', 'nuts']),
  d('cottage_cheese_fruit_seeds', 'breakfast', 28, 30, 10, ['dairy']),
  d('quinoa_porridge_apple', 'breakfast', 14, 58, 8),
  d('chicken_rice_broccoli', 'lunch', 45, 70, 10, ['meat']),
  d('beef_potatoes_salad', 'lunch', 42, 55, 18, ['meat']),
  d('lentil_stew_rice', 'lunch', 26, 85, 8),
  d('tuna_pasta_tomato', 'lunch', 38, 80, 10, ['fish', 'gluten']),
  d('chicken_quinoa_veg', 'lunch', 44, 60, 12, ['meat']),
  d('salmon_sweet_potato_greens', 'lunch', 38, 50, 22, ['fish']),
  d('chickpea_curry_rice', 'lunch', 22, 88, 14),
  d('turkey_wrap_veg', 'lunch', 36, 58, 12, ['meat', 'gluten']),
  d('tofu_stirfry_rice_noodles', 'lunch', 30, 75, 14),
  d('omelette_potato_salad', 'lunch', 34, 45, 22, ['egg']),
  d('apple_peanut_butter', 'snack', 6, 30, 12, ['nuts']),
  d('greek_yogurt_berries', 'snack', 17, 18, 4, ['dairy']),
  d('hummus_veg_sticks', 'snack', 8, 22, 9),
  d('banana_rice_cakes', 'snack', 3, 35, 1),
  d('protein_shake_water', 'snack', 25, 4, 2, ['dairy']),
  d('mixed_nuts_fruit', 'snack', 7, 25, 16, ['nuts']),
  d('edamame_bowl', 'snack', 17, 14, 8),
  d('boiled_eggs_fruit', 'snack', 14, 20, 10, ['egg']),
  d('grilled_fish_veg_potato', 'dinner', 40, 45, 14, ['fish']),
  d('chicken_salad_olive_bread', 'dinner', 38, 35, 20, ['meat', 'gluten']),
  d('veggie_omelette_salad', 'dinner', 28, 14, 20, ['egg']),
  d('bean_burrito_bowl', 'dinner', 24, 75, 12),
  d('beef_stirfry_rice', 'dinner', 38, 62, 16, ['meat']),
  d('tofu_veg_stew_quinoa', 'dinner', 28, 52, 14),
  d('pasta_pesto_chicken', 'dinner', 40, 75, 18, ['meat', 'gluten', 'nuts', 'dairy']),
  d('pumpkin_lentil_soup', 'dinner', 20, 50, 8),
  d('shrimp_rice_salad', 'dinner', 36, 58, 9, ['fish']),
  d('turkey_meatballs_zucchini', 'dinner', 42, 25, 16, ['meat', 'egg']),
];
export const dishById = (id: string) => DISHES.find((x) => x.id === id);

/** vegetarian/vegan expand to ingredient exclusions. */
export type DietFlag = 'vegetarian' | 'vegan' | 'gluten_free' | 'lactose_free' | 'nut_free' | 'egg_free' | 'fish_free';
export function avoidList(flags: DietFlag[]): Set<Ingredient> {
  const s = new Set<Ingredient>();
  for (const f of flags) {
    if (f === 'vegetarian') { s.add('meat'); s.add('fish'); }
    if (f === 'vegan') { s.add('meat'); s.add('fish'); s.add('egg'); s.add('dairy'); }
    if (f === 'gluten_free') s.add('gluten');
    if (f === 'lactose_free') s.add('dairy');
    if (f === 'nut_free') s.add('nuts');
    if (f === 'egg_free') s.add('egg');
    if (f === 'fish_free') s.add('fish');
  }
  return s;
}

export interface Menu { index: number; dishIds: [string, string, string, string] }
export const MENU_COUNT = 30;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 30 distinct day-menus built from the dishes compatible with the diet (mixed-radix enumeration with a coprime stride). */
export function buildMenus(flags: DietFlag[] = []): Menu[] {
  const avoid = avoidList(flags);
  const ok = (k: MealKind) => DISHES.filter((x) => x.kind === k && !x.contains.some((c) => avoid.has(c)));
  const [B, L, S, D] = [ok('breakfast'), ok('lunch'), ok('snack'), ok('dinner')];
  if (!B.length || !L.length || !S.length || !D.length) return [];
  const total = B.length * L.length * S.length * D.length;
  let step = Math.max(1, Math.floor(total * 0.618));
  while (gcd(step, total) !== 1) step++;
  const count = Math.min(MENU_COUNT, total);
  return Array.from({ length: count }, (_, i) => {
    let n = (i * step) % total;
    const b = n % B.length; n = Math.floor(n / B.length);
    const l = n % L.length; n = Math.floor(n / L.length);
    const s = n % S.length; n = Math.floor(n / S.length);
    const dd = n % D.length;
    return { index: i, dishIds: [B[b]!.id, L[l]!.id, S[s]!.id, D[dd]!.id] };
  });
}

export interface ScaledMenu { index: number; factor: number; meals: { dishId: string; kind: MealKind; kcal: number; p: number; c: number; f: number }[]; kcal: number; p: number; c: number; f: number }

/** Scales portions so the menu approximates the target kcal (clamped to 0.6–1.8× to keep portions realistic). */
export function scaleMenu(m: Menu, targetKcal: number): ScaledMenu {
  const dishes = m.dishIds.map((id) => dishById(id)!);
  const base = dishes.reduce((a, x) => a + dishKcal(x), 0);
  const factor = Math.round(Math.min(1.8, Math.max(0.6, targetKcal / base)) * 20) / 20;
  const meals = dishes.map((x) => ({ dishId: x.id, kind: x.kind, kcal: Math.round(dishKcal(x) * factor), p: Math.round(x.p * factor), c: Math.round(x.c * factor), f: Math.round(x.f * factor) }));
  const sum = (k: 'kcal' | 'p' | 'c' | 'f') => meals.reduce((a, x) => a + x[k], 0);
  return { index: m.index, factor, meals, kcal: sum('kcal'), p: sum('p'), c: sum('c'), f: sum('f') };
}

/** Three menus per day, rotating through the whole set (30 menus → each repeats every 10 days). */
export function menusForDay(dayNumber: number, targetKcal: number, flags: DietFlag[] = []): ScaledMenu[] {
  const all = buildMenus(flags);
  if (!all.length) return [];
  const n = all.length;
  const start = ((dayNumber * 3) % n + n) % n;
  return [0, 1, 2].map((k) => scaleMenu(all[(start + k) % n]!, targetKcal));
}

/** Days since epoch in UTC; the rotation key. */
export const dayNumberOf = (date: Date) => Math.floor(date.getTime() / 864e5);
