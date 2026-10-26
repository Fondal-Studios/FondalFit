import { describe, expect, it } from 'vitest';
import { FOODS, FOOD_CATS, foodById, macrosFor, parseMeal, plateMacros, gramChips, foodName } from '../src';

const ids = (t: string) => parseMeal(t).items.map((i) => i.foodId);

describe('food table', () => {
  it('has unique ids, every category populated and sane macros', () => {
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    expect(FOODS.length).toBeGreaterThanOrEqual(140);
    for (const c of FOOD_CATS) expect(FOODS.filter((f) => f.cat === c).length, c).toBeGreaterThanOrEqual(5);
    for (const f of FOODS) {
      // Atwater sanity: stated kcal within 35% (alcohol, fibre, rounding) of 4p+4c+9f for foods with energy
      const est = 4 * f.p + 4 * f.c + 9 * f.f;
      if (f.kcal > 40 && !['beer', 'wine_red', 'cerveza_lata', 'vino_copa', 'fernet_cola'].includes(f.id)) expect(Math.abs(est - f.kcal) / f.kcal, f.id).toBeLessThan(0.35);
      expect(f.portionG).toBeGreaterThan(0);
      expect(f.n.every((x) => x.length > 1)).toBe(true);
    }
  });
  it('computes plate macros from grams', () => {
    expect(macrosFor(foodById('chicken_breast')!, 200)).toMatchObject({ kcal: 330, p: 62 });
    const plate = plateMacros([{ foodId: 'chicken_breast', grams: 200 }, { foodId: 'rice_white', grams: 150 }, { foodId: 'nope', grams: 50 }]);
    expect(plate.kcal).toBe(330 + 195);
    expect(foodName(foodById('egg')!, 'pt')).toBe('Ovo inteiro');
  });
  it('offers sensible gram chips', () => {
    expect(gramChips(foodById('chicken_breast')!)).toEqual([50, 100, 150, 200, 250, 300]);
    expect(gramChips(foodById('olive_oil')!)).toEqual([5, 10, 15, 20, 30]);
  });
});

describe('natural-language meal parser', () => {
  it('parses explicit grams with several foods (ES)', () => {
    const r = parseMeal('200g de pollo con 150 g de arroz y ensalada');
    expect(r.items.map((i) => [i.foodId, i.grams, i.basis])).toEqual([['chicken_breast', 200, 'grams'], ['rice_white', 150, 'grams'], ['salad_mixed', 150, 'default']]);
    expect(r.total.kcal).toBe(330 + 195 + 38);
    expect(r.low).toBeLessThan(r.total.kcal); expect(r.high).toBeGreaterThan(r.total.kcal);
  });
  it('counts units and fractions', () => {
    expect(parseMeal('2 huevos').items[0]).toMatchObject({ foodId: 'egg', grams: 100, basis: 'unit' });
    expect(parseMeal('1/2 palta').items[0]).toMatchObject({ foodId: 'avocado', grams: 75 });
    expect(parseMeal('una banana').items[0]).toMatchObject({ foodId: 'banana', grams: 120 });
    expect(parseMeal('tres milanesas').items[0]).toMatchObject({ foodId: 'milanesa_beef', grams: 450 });
  });
  it('handles measures and liquids', () => {
    expect(parseMeal('dos cucharadas de aceite de oliva').items[0]).toMatchObject({ foodId: 'olive_oil', grams: 26, basis: 'measure' });
    expect(parseMeal('1 taza de arroz').items[0]).toMatchObject({ foodId: 'rice_white', grams: 160 });
    expect(parseMeal('500 ml de agua').items[0]).toMatchObject({ foodId: 'water', grams: 500 });
    expect(parseMeal('1 lata de coca').items[0]).toMatchObject({ foodId: 'soda_cola', grams: 330 });
    expect(parseMeal('1.5 kg de papa').items[0]!.grams).toBe(1500);
  });
  it('disambiguates by the most specific words', () => {
    expect(ids('café con leche')).toEqual(['coffee_milk']);
    expect(ids('leche de almendras')).toEqual(['almond_milk']);
    expect(ids('pasta de maní')).toEqual(['peanut_butter']);
    expect(ids('jugo de naranja')).toEqual(['orange_juice']);
    expect(ids('pan integral')).toEqual(['bread_whole']);
    expect(ids('arroz integral')).toEqual(['rice_brown']);
    expect(ids('milanesa de pollo')).toEqual(['milanesa_chicken_baked']);
    expect(ids('queso')).toEqual(['cheese_semi']);
    expect(ids('pollo')).toEqual(['chicken_breast']);
  });
  it('works in Portuguese and English', () => {
    expect(ids('100 g de frango, arroz e feijão')).toEqual(['chicken_breast', 'rice_white', 'black_beans']);
    expect(parseMeal('2 eggs and a banana with 30 g of oats').items.map((i) => i.foodId)).toEqual(['egg', 'banana', 'oats_dry']);
    expect(ids('one scoop whey protein')).toEqual(['whey']);
  });
  it('reports uncertainty honestly and flags unknown foods', () => {
    const g = parseMeal('200 g de pollo').items[0]!, d = parseMeal('pollo').items[0]!;
    expect(g.confidence).toBe('high'); expect(d.confidence).toBe('low');
    expect((d.high - d.low) / d.macros!.kcal).toBeGreaterThan((g.high - g.low) / g.macros!.kcal);
    const u = parseMeal('pollo y algo raro xyz');
    expect(u.items[1]).toMatchObject({ foodId: null, macros: null });
    expect(u.total.kcal).toBe(parseMeal('pollo').total.kcal);
    expect(parseMeal('').items).toEqual([]);
  });
  it('handles decimal commas without splitting the list', () => {
    expect(parseMeal('0,5 kg de pollo').items).toHaveLength(1);
    expect(parseMeal('0,5 kg de pollo').items[0]!.grams).toBe(500);
  });
});
