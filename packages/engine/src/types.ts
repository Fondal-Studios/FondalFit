export type Goal = 'strength' | 'hypertrophy' | 'endurance' | 'fat_loss' | 'mobility' | 'general' | 'hybrid';
export type Equipment = 'none' | 'dumbbells' | 'barbell' | 'machines' | 'bands' | 'bar';
export type Area = 'knee' | 'shoulder' | 'lower_back' | 'hip' | 'ankle' | 'wrist' | 'neck';

export interface Exercise {
  id: string;
  pattern: 'squat' | 'hinge' | 'push' | 'pull' | 'core' | 'lunge' | 'mobility' | 'carry';
  equipment: Equipment[];
  /** areas that should be avoided when the athlete reports a restriction there */
  stresses: Area[];
  /** load increment in kg for external-load exercises; 0 = bodyweight */
  increment: number;
}

export interface Prescription {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  rirTarget: number;
  load: number; // kg, 0 for bodyweight
}

export interface PlanDay { name: string; items: Prescription[]; run?: {minutes:number; intensity:'easy'|'moderate'; note:string} }
export interface Plan { engineVersion: string; goal: Goal; days: PlanDay[]; weeksSinceDeload: number }

export interface AssessmentInput {
  goal: Goal;
  secondaryGoals?: Goal[];
  targetDescription?: string;
  specificGoals?: string[];
  baseline?: {
    age?: number; weightKg?: number; heightCm?: number;
    weeklyStrengthSessions?: number; weeklyRunKm?: number;
    longestComfortableRunKm?: number; comfortableRunPaceMinKm?: number;
    walkingMinutes?: number; pushUps?: number; sitToStand30s?: number;
    restingHeartRate?: number; perceivedFitness?: number;
    activityMinutesPerWeek?: number; sleepHours?: number; recovery?: number;
  };
  trainingContext?: { strengthDays?: number; cardioDays?: number; recentBreakWeeks?: number; confidence?: number; preferredReassessmentWeeks?: number };

  targetDate?: string;
  sessionMinutes?: number;
  preferredActivities?: ('strength' | 'running' | 'mobility')[];
  daysPerWeek: number;
  experience: 'beginner' | 'intermediate' | 'advanced';
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
