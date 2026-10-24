import { describe, expect, it } from 'vitest';
import { dict, LANGS } from './i18n';
import { CATALOG } from '@fondal/engine';

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
});
