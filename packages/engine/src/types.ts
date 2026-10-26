export type Goal = 'hypertrophy' | 'strength' | 'recomposition' | 'fat_loss' | 'endurance' | 'vo2max' | 'general' | 'mobility';
export type Equipment = 'none' | 'dumbbells' | 'barbell' | 'machines' | 'bands' | 'bar';
export type Area = 'knee' | 'shoulder' | 'lower_back' | 'hip' | 'ankle' | 'wrist' | 'neck';
export type Muscle = 'quads' | 'hamstrings' | 'glutes' | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'core' | 'calves' | 'full';
export type CardioModality = 'run' | 'bike';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export interface Exercise {
  id: string;
  pattern: 'squat' | 'hinge' | 'push' | 'pull' | 'core' | 'lunge' | 'mobility' | 'carry' | 'isolation' | 'conditioning';
  /** primary muscle trained; drives weekly volume accounting */
  muscle: Muscle;
  equipment: Equipment[];
  /** areas that should be avoided when the athlete reports a restriction there */
  stresses: Area[];
  /** load increment in kg for external-load exercises; 0 = bodyweight */
  increment: number;
  /** 1 = beginner-friendly, 2 = intermediate, 3 = advanced/skill */
  level: 1 | 2 | 3;
  secondary?: Muscle[];
  /** performed for time: the rep numbers are seconds (planks, holds, stretches) */
  timed?: boolean;
}

export interface Prescription {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  rirTarget: number;
  load: number; // kg, 0 for bodyweight
  restSec?: number;
}

export type CardioType = 'zone2' | 'intervals' | 'tempo' | 'long' | 'walkrun';
export interface CardioSession {
  modality: CardioModality;
  type: CardioType;
  durationMin: number;
  intervals?: { reps: number; workSec: number; restSec: number };
}

export interface PlanDay { name: string; kind?: 'strength' | 'cardio' | 'hiit' | 'mobility'; items: Prescription[]; format?: 'standard' | 'superset' | 'circuit'; cardio?: CardioSession; /** free text shown with the session (e.g. a run/walk pattern) */ note?: string }
export interface Ramp { startedAt: string; weeks: number; setsMult: number; loadMult: number }
export interface Plan {
  engineVersion: string; goal: Goal; days: PlanDay[]; weeksSinceDeload: number;
  /** 4-week mesocycle applied over `days` (base, build, peak, deload) from `startedAt` */
  meso?: { startedAt: string };
  /** explicit multi-week program (e.g. couch-to-5K): `days` is week 1, `weeks[i]` is week i+1 */
  program?: { routineId: string; startedAt: string; weeks: PlanDay[][] };
  /** temporary reduced load after a break */
  ramp?: Ramp;
}

export interface AssessmentInput {
  goal: Goal;
  experience: Experience;
  /** strength sessions per week (gym or calisthenics, depending on equipment) */
  strengthDays: number;
  /** cardio sessions per week, split across `cardioModalities` */
  cardioDays: number;
  cardioModalities: CardioModality[];
  equipment: Equipment[];
  restrictions: Area[];
  /** PAR-Q style answers; any true is a red flag that requires clearance */
  redFlags: { chestPain: boolean; dizziness: boolean; recentSurgery: boolean; pregnancy: boolean; medication: boolean };
}

export interface SetResult { weight: number; reps: number; rir: number }

export interface AutonomyLimits {
  maxLoadIncreasePct: number;
  maxWeeklyVolumeDeltaPct: number;
  maxSessionsPerWeek: number;
  allowAutoDeload: boolean;
}
