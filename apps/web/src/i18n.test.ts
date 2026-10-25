import { describe, expect, it } from 'vitest';
import { dict, LANGS } from './i18n';
import { CATALOG, DISHES } from '@fondal/engine';

describe('i18n', () => {
  it('all languages have identical keys and no empty values', () => {
    const base = Object.keys(dict.en).sort();
    for (const l of LANGS) {
      expect(Object.keys(dict[l]).sort()).toEqual(base);
      for (const v of Object.values(dict[l])) expect(v.trim()).not.toBe('');
    }
  });
  it('every catalog exercise has a translation', () => {
    for (const e of CATALOG) for (const l of LANGS) expect((dict[l] as Record<string, string>)['ex_' + e.id]).toBeTruthy();
  });
  it('every dish, goal, muscle and supplement has a translation', () => {
    const need = [...DISHES.map((d) => 'dish_' + d.id), ...['hypertrophy', 'strength', 'recomposition', 'fat_loss', 'endurance', 'vo2max', 'general', 'mobility'].flatMap((g) => ['g_' + g, 'gd_' + g]),
      ...['quads', 'hamstrings', 'glutes', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'calves'].map((m) => 'm_' + m),
      ...['creatine', 'whey_or_plant_protein', 'caffeine', 'electrolytes', 'b12', 'omega3', 'vitamin_d_iron'].map((s) => 'supp_' + s)];
    for (const l of LANGS) for (const k of need) expect(dict[l][k], `${l}:${k}`).toBeTruthy();
  });
});
