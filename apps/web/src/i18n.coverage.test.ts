import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FOOD_CATS, ROUTINES, DISHES, challengesForWeek } from '@fondal/engine';
import { dict, LANGS } from './i18n';

const SRC = path.join(__dirname);
const files: string[] = [];
(function walk(d: string) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'exinfo') walk(p); } else if (/\.tsx?$/.test(f.name) && !/test|i18n/.test(f.name)) files.push(p); } })(SRC);

describe('every string the UI asks for exists in es, en and pt', () => {
  it('literal t("key") calls', () => {
    const missing: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'\s*[,)]/g)) {
        const k = m[1]!;
        if (k.endsWith('_')) continue; // dynamic prefix, covered below
        for (const l of LANGS) if (!dict[l][k]) missing.push(`${path.basename(f)}:${l}:${k}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('dynamic key families', () => {
    const need: string[] = [];
    FOOD_CATS.forEach((c) => need.push('fc_' + c));
    new Set(ROUTINES.flatMap((r) => r.tags)).forEach((x) => need.push('tag_' + x));
    new Set(ROUTINES.map((r) => r.place)).forEach((x) => need.push('place_' + x));
    new Set(ROUTINES.flatMap((r) => r.program.flat().map((d) => d.kind))).forEach((x) => need.push('kind_' + x));
    ['base', 'build', 'peak', 'deload', 'program', 'plain'].forEach((x) => need.push('phase_' + x));
    ['move_150', 'train_3', 'days_4', 'run_10', 'run_5', 'bike_40', 'meals_5', 'recovery_4'].forEach((x) => need.push('ch_' + x));
    for (let w = 1; w <= 52; w++) challengesForWeek(`2026-W${String(w).padStart(2, '0')}`, { run: true, bike: true }).forEach((c) => need.push('ch_' + c.id));
    ['low', 'fair', 'good', 'high', 'over'].forEach((x) => need.push('water_' + x));
    ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm'].forEach((x) => need.push('me_' + x));
    ['P', 'C', 'G'].forEach((x) => need.push('macro_' + x));
    ['friendly', 'direct', 'motivating', 'technical'].forEach((x) => need.push('tone_' + x));
    ['high', 'medium', 'low'].forEach((x) => need.push('conf_' + x));
    ['cat', 'text', 'recent', 'manual'].forEach((x) => need.push('addtab_' + x));
    ['overview', 'users'].forEach((x) => need.push('adm_' + x));
    ['1', '2', '3'].forEach((x) => need.push('lv' + x));
    DISHES.forEach((d) => need.push('dish_' + d.id));
    ['science', 'settings', 'coach', 'progress', 'challenges', 'routines', 'exercises', 'recovery', 'admin'].forEach((x) => need.push(x, x + 'Sub'));
    const missing = [...new Set(need)].flatMap((k) => LANGS.filter((l) => !dict[l][k]).map((l) => `${l}:${k}`));
    expect(missing).toEqual([]);
  });
});
