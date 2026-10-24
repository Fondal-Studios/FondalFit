import type { Exercise } from './types';

export const CATALOG: Exercise[] = [
  { id: 'goblet_squat', pattern: 'squat', equipment: ['dumbbells'], stresses: ['knee'], increment: 2 },
  { id: 'back_squat', pattern: 'squat', equipment: ['barbell'], stresses: ['knee', 'lower_back'], increment: 2.5 },
  { id: 'air_squat', pattern: 'squat', equipment: ['none'], stresses: ['knee'], increment: 0 },
  { id: 'box_squat_bodyweight', pattern: 'squat', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'romanian_deadlift', pattern: 'hinge', equipment: ['barbell', 'dumbbells'], stresses: ['lower_back'], increment: 2.5 },
  { id: 'glute_bridge', pattern: 'hinge', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'bench_press', pattern: 'push', equipment: ['barbell'], stresses: ['shoulder', 'wrist'], increment: 2.5 },
  { id: 'dumbbell_press', pattern: 'push', equipment: ['dumbbells'], stresses: ['shoulder'], increment: 2 },
  { id: 'push_up', pattern: 'push', equipment: ['none'], stresses: ['wrist', 'shoulder'], increment: 0 },
  { id: 'incline_push_up', pattern: 'push', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'dumbbell_row', pattern: 'pull', equipment: ['dumbbells'], stresses: [], increment: 2 },
  { id: 'band_row', pattern: 'pull', equipment: ['bands'], stresses: [], increment: 0 },
  { id: 'pull_up', pattern: 'pull', equipment: ['bar'], stresses: ['shoulder'], increment: 0 },
  { id: 'reverse_lunge', pattern: 'lunge', equipment: ['none', 'dumbbells'], stresses: ['knee'], increment: 2 },
  { id: 'step_up_low', pattern: 'lunge', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'plank', pattern: 'core', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'dead_bug', pattern: 'core', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'farmer_carry', pattern: 'carry', equipment: ['dumbbells'], stresses: [], increment: 2 },
  { id: 'hip_flow', pattern: 'mobility', equipment: ['none'], stresses: [], increment: 0 },
  { id: 'thoracic_rotation', pattern: 'mobility', equipment: ['none'], stresses: [], increment: 0 },
];

export const byId = (id: string) => CATALOG.find((e) => e.id === id);
