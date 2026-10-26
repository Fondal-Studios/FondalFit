import { describe, expect, it } from 'vitest';
import { CATALOG } from '@fondal/engine';
import { EXINFO } from './index';
import { dict, LANGS } from '../i18n';

describe('exercise library content', () => {
  it('every catalog exercise has a name, 3+ steps and a key cue in all three languages', () => {
    const missing: string[] = [];
    for (const ex of CATALOG) {
      const info = EXINFO[ex.id];
      if (!info) { missing.push(ex.id); continue; }
      LANGS.forEach((l, i) => {
        const idx = ({ es: 0, en: 1, pt: 2 } as const)[l];
        const steps = info.how[idx].split('|').map((s) => s.trim()).filter(Boolean);
        if (steps.length < 3 || steps.length > 5) missing.push(`${ex.id}:${l}:steps${steps.length}`);
        if (info.tip[idx].trim().length < 8) missing.push(`${ex.id}:${l}:tip`);
        if (!dict[l]['ex_' + ex.id]) missing.push(`${ex.id}:${l}:name`);
        void i;
      });
    }
    expect(missing).toEqual([]);
  });
  it('names are in the right language (es/en/pt not swapped)', () => {
    expect(dict.es['ex_assisted_pull_up']).toBe('Dominada asistida');
    expect(dict.en['ex_assisted_pull_up']).toBe('Assisted pull-up');
    expect(dict.pt['ex_assisted_pull_up']).toBe('Barra fixa assistida');
    expect(dict.es['ex_leg_press']).toBe('Prensa de piernas');
    expect(dict.en['ex_leg_press']).toBe('Leg press');
  });
  it('has no orphan entries (info for exercises that do not exist)', () => {
    const ids = new Set(CATALOG.map((c) => c.id));
    expect(Object.keys(EXINFO).filter((k) => !ids.has(k))).toEqual([]);
  });
  it('the three languages have the same number of steps', () => {
    for (const [id, info] of Object.entries(EXINFO)) {
      const n = info.how.map((h) => h.split('|').length);
      expect(new Set(n).size, id).toBe(1);
    }
  });
});
