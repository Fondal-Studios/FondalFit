import type { Goal } from './types';

export type LifeFactor = 1.2 | 1.3 | 1.4;
export interface NutritionInput {
  sex: 'f' | 'm'; weightKg: number; heightCm: number; age: number;
  /** daily-life activity outside training: 1.2 mostly seated, 1.3 on feet some of the day, 1.4 physically active job */
  lifeFactor: LifeFactor;
  strengthDays: number; cardioDays: number; goal: Goal;
}
export interface NutritionExplain {
  formula: 'mifflin_st_jeor'; bmr: number; lifeFactor: number; lifeKcal: number; trainKcal: number; tdee: number;
  adjustPct: number; proteinPerKg: number; fatPct: number; kcalFloor: number;
}
export interface NutritionTarget { kcal: number; proteinG: number; fatG: number; carbsG: number; waterMl: number; floored: boolean; explain: NutritionExplain }

const ADJUST: Record<Goal, number> = { fat_loss: -15, hypertrophy: 8, strength: 5, recomposition: 0, endurance: 0, vo2max: 0, general: 0, mobility: 0 };
const PROTEIN: Record<Goal, number> = { fat_loss: 2.0, recomposition: 2.0, hypertrophy: 1.8, strength: 1.8, endurance: 1.6, vo2max: 1.6, general: 1.5, mobility: 1.4 };
// average energy cost per session: ≈300 kcal strength, ≈450 kcal cardio (≈60 min easy-moderate). Population averages, not measurements.
const KCAL_STRENGTH = 300, KCAL_CARDIO = 450;

/** Mifflin–St Jeor BMR × life factor + average training expenditure, then a goal adjustment. Never below BMR or an absolute floor. */
export function nutritionTarget(n: NutritionInput): NutritionTarget {
  const bmr = 10 * n.weightKg + 6.25 * n.heightCm - 5 * n.age + (n.sex === 'm' ? 5 : -161);
  const lifeKcal = bmr * n.lifeFactor;
  const trainKcal = (n.strengthDays * KCAL_STRENGTH + n.cardioDays * KCAL_CARDIO) / 7;
  const tdee = lifeKcal + trainKcal;
  const adjustPct = ADJUST[n.goal];
  const raw = tdee * (1 + adjustPct / 100);
  const kcalFloor = Math.round(Math.max(bmr, n.sex === 'm' ? 1500 : 1200));
  const kcal = Math.round(Math.max(raw, kcalFloor));
  const proteinPerKg = PROTEIN[n.goal];
  const proteinG = Math.round(n.weightKg * proteinPerKg);
  const fatPct = 27;
  const fatG = Math.round((kcal * fatPct / 100) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return {
    kcal, proteinG, fatG, carbsG, waterMl: Math.round(n.weightKg * 35), floored: raw < kcalFloor,
    explain: { formula: 'mifflin_st_jeor', bmr: Math.round(bmr), lifeFactor: n.lifeFactor, lifeKcal: Math.round(lifeKcal), trainKcal: Math.round(trainKcal), tdee: Math.round(tdee), adjustPct, proteinPerKg, fatPct, kcalFloor },
  };
}
