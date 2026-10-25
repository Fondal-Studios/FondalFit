import type { Goal } from './types';
import type { DietFlag } from './menus';

export interface Supplement { id: string; evidence: 'strong' | 'moderate' | 'conditional'; dose: string }

/**
 * Evidence-based only. Everything else (fat burners, prohormones, "testosterone boosters") is deliberately excluded.
 * `conditional` items need lab results or a professional first. Not medical advice.
 */
export function supplementAdvice(o: { goal: Goal; cardioDays: number; strengthDays: number; diet: DietFlag[]; proteinGapG: number }): Supplement[] {
  const out: Supplement[] = [];
  if (o.strengthDays > 0 || o.goal === 'hypertrophy' || o.goal === 'strength') out.push({ id: 'creatine', evidence: 'strong', dose: '3–5 g/day, any time, daily' });
  if (o.proteinGapG >= 20) out.push({ id: 'whey_or_plant_protein', evidence: 'strong', dose: '20–30 g to cover the protein gap' });
  if (o.goal === 'endurance' || o.goal === 'vo2max' || o.cardioDays >= 3) out.push({ id: 'caffeine', evidence: 'strong', dose: '3 mg/kg, 30–60 min before; avoid late in the day' });
  if (o.cardioDays > 0) out.push({ id: 'electrolytes', evidence: 'moderate', dose: 'only for sessions > 60–90 min or very hot weather' });
  if (o.diet.includes('vegan')) out.push({ id: 'b12', evidence: 'strong', dose: 'as indicated by a professional (essential for vegans)' });
  out.push({ id: 'omega3', evidence: 'moderate', dose: 'if you eat little fish: ≈250–500 mg EPA+DHA/day' });
  out.push({ id: 'vitamin_d_iron', evidence: 'conditional', dose: 'only if blood tests show deficiency' });
  return out;
}
