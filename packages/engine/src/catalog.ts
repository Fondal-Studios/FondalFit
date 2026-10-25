import type { Equipment, Exercise, Muscle } from './types';

const e = (id: string, pattern: Exercise['pattern'], muscle: Muscle, equipment: Equipment[], stresses: Exercise['stresses'], increment: number): Exercise =>
  ({ id, pattern, muscle, equipment, stresses, increment });

export const CATALOG: Exercise[] = [
  // quads
  e('air_squat', 'squat', 'quads', ['none'], ['knee'], 0),
  e('box_squat_bodyweight', 'squat', 'quads', ['none'], [], 0),
  e('goblet_squat', 'squat', 'quads', ['dumbbells'], ['knee'], 2),
  e('back_squat', 'squat', 'quads', ['barbell'], ['knee', 'lower_back'], 2.5),
  e('leg_press', 'squat', 'quads', ['machines'], ['knee'], 5),
  e('bulgarian_split_squat', 'lunge', 'quads', ['dumbbells'], ['knee', 'hip'], 2),
  e('leg_extension', 'isolation', 'quads', ['machines'], ['knee'], 2.5),
  // hamstrings
  e('hamstring_walkout', 'hinge', 'hamstrings', ['none'], [], 0),
  e('romanian_deadlift', 'hinge', 'hamstrings', ['barbell', 'dumbbells'], ['lower_back'], 2.5),
  e('leg_curl', 'isolation', 'hamstrings', ['machines'], [], 2.5),
  e('deadlift', 'hinge', 'hamstrings', ['barbell'], ['lower_back'], 2.5),
  // glutes
  e('glute_bridge', 'hinge', 'glutes', ['none'], [], 0),
  e('step_up_low', 'lunge', 'glutes', ['none'], [], 0),
  e('reverse_lunge', 'lunge', 'glutes', ['none', 'dumbbells'], ['knee'], 2),
  e('hip_thrust', 'hinge', 'glutes', ['barbell'], [], 5),
  // chest
  e('incline_push_up', 'push', 'chest', ['none'], [], 0),
  e('push_up', 'push', 'chest', ['none'], ['wrist', 'shoulder'], 0),
  e('dumbbell_press', 'push', 'chest', ['dumbbells'], ['shoulder'], 2),
  e('chest_press_machine', 'push', 'chest', ['machines'], ['shoulder'], 2.5),
  e('bench_press', 'push', 'chest', ['barbell'], ['shoulder', 'wrist'], 2.5),
  // back
  e('inverted_row_table', 'pull', 'back', ['none'], [], 0),
  e('band_row', 'pull', 'back', ['bands'], [], 0),
  e('dumbbell_row', 'pull', 'back', ['dumbbells'], [], 2),
  e('lat_pulldown', 'pull', 'back', ['machines'], [], 2.5),
  e('seated_cable_row', 'pull', 'back', ['machines'], [], 2.5),
  e('pull_up', 'pull', 'back', ['bar'], ['shoulder'], 0),
  // shoulders
  e('pike_push_up', 'push', 'shoulders', ['none'], ['shoulder', 'wrist'], 0),
  e('face_pull', 'pull', 'shoulders', ['bands'], [], 0),
  e('lateral_raise', 'isolation', 'shoulders', ['dumbbells'], [], 1),
  e('shoulder_press_db', 'push', 'shoulders', ['dumbbells'], ['shoulder'], 2),
  e('overhead_press', 'push', 'shoulders', ['barbell'], ['shoulder', 'lower_back'], 2.5),
  // arms
  e('band_curl', 'isolation', 'biceps', ['bands'], [], 0),
  e('biceps_curl', 'isolation', 'biceps', ['dumbbells'], [], 1),
  e('bench_dip', 'push', 'triceps', ['none'], ['shoulder', 'wrist'], 0),
  e('triceps_extension_band', 'isolation', 'triceps', ['bands'], [], 0),
  e('triceps_pushdown', 'isolation', 'triceps', ['machines'], [], 2.5),
  // calves
  e('calf_raise_bw', 'isolation', 'calves', ['none'], ['ankle'], 0),
  e('calf_raise_machine', 'isolation', 'calves', ['machines'], ['ankle'], 5),
  // core / carry / mobility
  e('plank', 'core', 'core', ['none'], [], 0),
  e('dead_bug', 'core', 'core', ['none'], [], 0),
  e('pallof_press', 'core', 'core', ['bands'], [], 0),
  e('farmer_carry', 'carry', 'core', ['dumbbells'], [], 2),
  e('hip_flow', 'mobility', 'core', ['none'], [], 0),
  e('thoracic_rotation', 'mobility', 'core', ['none'], [], 0),
];

export const byId = (id: string) => CATALOG.find((x) => x.id === id);
