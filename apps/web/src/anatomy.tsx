import { byId, type Muscle } from '@fondal/engine';
import { useT } from './ctx';

/* ------------------------------------------------------------------ muscle map (front + back) */
type Level = 'p' | 's' | undefined;
const fill = (l: Level) => (l === 'p' ? 'var(--m-primary)' : l === 's' ? 'var(--m-secondary)' : 'var(--m-idle)');

/** Stylised anatomical chart: the worked muscles are lit (strong = primary, softer = helper). Illustrative, not a medical drawing. */
export function MuscleMap({ primary, secondary = [] }: { primary: Muscle; secondary?: Muscle[] }) {
  const t = useT();
  const lv = (m: Muscle): Level => (primary === 'full' || primary === m ? 'p' : secondary.includes(m) || secondary.includes('full') ? 's' : undefined);
  const body = (
    <>
      <circle cx="50" cy="14" r="10" className="m-body" />
      <path className="m-body" d="M44 23h12v8H44z" />
      <path className="m-body" d="M32 31Q50 25 68 31L72 52L68 100Q50 108 32 100L28 52Z" />
      <path className="m-body" d="M30 33Q18 38 16 66L13 100L22 101L27 70L33 46Z" />
      <path className="m-body" d="M70 33Q82 38 84 66L87 100L78 101L73 70L67 46Z" />
      <path className="m-body" d="M34 100L49 100L48 150L46 198L36 198L35 150Z" />
      <path className="m-body" d="M66 100L51 100L52 150L54 198L64 198L65 150Z" />
    </>
  );
  const E = (cx: number, cy: number, rx: number, ry: number, l: Level, rot = 0) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill(l)} transform={`rotate(${rot} ${cx} ${cy})`} />;
  return (
    <div className="musclemap" role="img" aria-label={`${t('m_' + primary)}${secondary.length ? ' + ' + secondary.map((m) => t('m_' + m)).join(', ') : ''}`}>
      <figure>
        <svg viewBox="0 0 100 205">
          {body}
          {E(29, 38, 7, 8, lv('shoulders'))}{E(71, 38, 7, 8, lv('shoulders'))}
          {E(41, 48, 10, 7.5, lv('chest'), -8)}{E(59, 48, 10, 7.5, lv('chest'), 8)}
          {E(22, 58, 4.2, 11, lv('biceps'), 6)}{E(78, 58, 4.2, 11, lv('biceps'), -6)}
          <rect x="43" y="58" width="14" height="36" rx="5" fill={fill(lv('core'))} /><path d="M34 62Q40 78 38 96M66 62Q60 78 62 96" stroke={fill(lv('core'))} strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
          {E(41, 125, 7.5, 24, lv('quads'), 2)}{E(59, 125, 7.5, 24, lv('quads'), -2)}
          {E(41, 172, 5, 15, lv('calves'))}{E(59, 172, 5, 15, lv('calves'))}
        </svg>
        <figcaption>{t('anat_front')}</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 100 205">
          {body}
          {E(29, 38, 7, 8, lv('shoulders'))}{E(71, 38, 7, 8, lv('shoulders'))}
          <path d="M40 32Q50 28 60 32L68 52L58 84L50 90L42 84L32 52Z" fill={fill(lv('back'))} />
          <rect x="44" y="76" width="12" height="18" rx="4" fill={fill(lv('core'))} opacity=".85" />
          {E(22, 58, 4.4, 11, lv('triceps'), 6)}{E(78, 58, 4.4, 11, lv('triceps'), -6)}
          {E(42, 104, 9, 8.5, lv('glutes'))}{E(58, 104, 9, 8.5, lv('glutes'))}
          {E(41, 134, 7, 20, lv('hamstrings'), 2)}{E(59, 134, 7, 20, lv('hamstrings'), -2)}
          {E(41, 174, 5.5, 15, lv('calves'))}{E(59, 174, 5.5, 15, lv('calves'))}
        </svg>
        <figcaption>{t('anat_back')}</figcaption>
      </figure>
      <div className="mm-legend small"><span><i className="p" /> {t('anat_primary')}</span><span><i className="s" /> {t('anat_secondary')}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ movement figures (start → end) */
type P = [number, number];
interface Pose { head: P; sh: P; hip: P; knee: P; ankle: P; elbow: P; wrist: P; load?: P; floor?: boolean }
interface Tpl { start: Pose; end: Pose; bar?: 'overhead' | 'support' }
const STAND: Pose = { head: [50, 14], sh: [50, 28], hip: [50, 54], knee: [50, 74], ankle: [50, 94], elbow: [50, 42], wrist: [50, 56] };
const T: Record<string, Tpl> = {
  squat: {
    start: { ...STAND, elbow: [58, 38], wrist: [60, 28], load: [60, 28] },
    end: { head: [60, 32], sh: [54, 44], hip: [34, 72], knee: [66, 72], ankle: [50, 94], elbow: [64, 48], wrist: [70, 40], load: [70, 40] },
  },
  hinge: {
    start: { ...STAND, elbow: [52, 44], wrist: [55, 62], load: [55, 62] },
    end: { head: [76, 40], sh: [66, 44], hip: [32, 52], knee: [42, 72], ankle: [46, 94], elbow: [68, 58], wrist: [68, 74], load: [68, 74] },
  },
  press: {
    start: { ...STAND, elbow: [54, 40], wrist: [56, 28], load: [56, 28] },
    end: { ...STAND, elbow: [52, 14], wrist: [52, 0], load: [52, 0] },
  },
  curl: {
    start: { ...STAND, elbow: [50, 44], wrist: [52, 62], load: [52, 62] },
    end: { ...STAND, elbow: [50, 44], wrist: [60, 30], load: [60, 30] },
  },
  extension: {
    start: { ...STAND, elbow: [46, 10], wrist: [56, 28], load: [56, 28] },
    end: { ...STAND, elbow: [46, 10], wrist: [48, -4], load: [48, -4] },
  },
  raise: {
    start: { ...STAND, elbow: [52, 44], wrist: [54, 60], load: [54, 60] },
    end: { ...STAND, elbow: [64, 30], wrist: [80, 28], load: [80, 28] },
  },
  bench: {
    start: { head: [16, 72], sh: [28, 72], hip: [60, 72], knee: [78, 60], ankle: [84, 92], elbow: [38, 80], wrist: [28, 64], load: [28, 64], floor: true },
    end: { head: [16, 72], sh: [28, 72], hip: [60, 72], knee: [78, 60], ankle: [84, 92], elbow: [28, 54], wrist: [28, 38], load: [28, 38], floor: true },
  },
  pushup: {
    start: { head: [16, 52], sh: [26, 56], hip: [60, 68], knee: [78, 74], ankle: [94, 80], elbow: [38, 74], wrist: [26, 88] },
    end: { head: [16, 76], sh: [26, 80], hip: [60, 82], knee: [78, 84], ankle: [94, 88], elbow: [40, 86], wrist: [26, 90] },
  },
  row: {
    start: { head: [74, 38], sh: [66, 42], hip: [34, 56], knee: [42, 76], ankle: [44, 94], elbow: [68, 58], wrist: [68, 74], load: [68, 74] },
    end: { head: [74, 38], sh: [66, 42], hip: [34, 56], knee: [42, 76], ankle: [44, 94], elbow: [48, 54], wrist: [60, 58], load: [60, 58] },
  },
  pullup: {
    start: { head: [50, 28], sh: [50, 36], hip: [50, 62], knee: [50, 80], ankle: [50, 96], elbow: [46, 18], wrist: [46, 2] },
    end: { head: [50, 8], sh: [50, 18], hip: [50, 44], knee: [50, 62], ankle: [50, 78], elbow: [42, 22], wrist: [46, 2] },
    bar: 'overhead',
  },
  pulldown: {
    start: { ...STAND, head: [50, 20], sh: [50, 32], elbow: [50, 14], wrist: [48, -2] },
    end: { ...STAND, head: [50, 20], sh: [50, 32], elbow: [40, 40], wrist: [48, 22] },
    bar: 'overhead',
  },
  lunge: {
    start: { ...STAND },
    end: { head: [50, 28], sh: [50, 42], hip: [50, 66], knee: [72, 72], ankle: [72, 94], elbow: [50, 56], wrist: [50, 70] },
  },
  bridge: {
    start: { head: [14, 80], sh: [26, 82], hip: [54, 88], knee: [72, 66], ankle: [80, 92], elbow: [40, 88], wrist: [54, 90], floor: true },
    end: { head: [14, 80], sh: [26, 82], hip: [54, 66], knee: [72, 66], ankle: [80, 92], elbow: [40, 88], wrist: [54, 90], floor: true },
  },
  plank: {
    start: { head: [16, 66], sh: [26, 70], hip: [60, 74], knee: [78, 78], ankle: [94, 84], elbow: [26, 88], wrist: [38, 88], floor: true },
    end: { head: [16, 66], sh: [26, 70], hip: [60, 74], knee: [78, 78], ankle: [94, 84], elbow: [26, 88], wrist: [38, 88], floor: true },
  },
  crunch: {
    start: { head: [18, 82], sh: [28, 84], hip: [58, 88], knee: [76, 66], ankle: [84, 90], elbow: [22, 74], wrist: [20, 80], floor: true },
    end: { head: [30, 64], sh: [38, 72], hip: [58, 88], knee: [76, 66], ankle: [84, 90], elbow: [28, 62], wrist: [26, 66], floor: true },
  },
  legraise: {
    start: { head: [50, 14], sh: [50, 28], hip: [50, 54], knee: [50, 74], ankle: [50, 94], elbow: [46, 14], wrist: [46, 0] },
    end: { head: [50, 14], sh: [50, 28], hip: [50, 54], knee: [74, 52], ankle: [96, 52], elbow: [46, 14], wrist: [46, 0] },
    bar: 'overhead',
  },
  jump: {
    start: { head: [58, 36], sh: [52, 46], hip: [36, 72], knee: [64, 74], ankle: [50, 94], elbow: [44, 58], wrist: [40, 68] },
    end: { head: [50, 6], sh: [50, 20], hip: [50, 46], knee: [50, 64], ankle: [50, 80], elbow: [48, 6], wrist: [48, -6] },
  },
  calf: {
    start: { ...STAND, ankle: [50, 94] },
    end: { head: [50, 8], sh: [50, 22], hip: [50, 48], knee: [50, 68], ankle: [50, 90], elbow: [50, 36], wrist: [50, 50] },
  },
  carry: {
    start: { ...STAND, elbow: [50, 44], wrist: [50, 66], load: [50, 66] },
    end: { head: [50, 14], sh: [50, 28], hip: [50, 54], knee: [60, 74], ankle: [56, 94], elbow: [50, 44], wrist: [50, 66], load: [50, 66] },
  },
  stretch: {
    start: { ...STAND },
    end: { head: [74, 46], sh: [66, 46], hip: [34, 54], knee: [40, 74], ankle: [44, 94], elbow: [74, 62], wrist: [78, 76] },
  },
  hold: {
    start: { ...STAND, head: [50, 20], sh: [50, 32], elbow: [46, 18], wrist: [46, 2] },
    end: { ...STAND, head: [50, 20], sh: [50, 32], elbow: [46, 18], wrist: [46, 2] },
    bar: 'overhead',
  },
};

/** Which figure explains each exercise: by name first, then by movement pattern. */
export function figureFor(id: string): string {
  const has = (...k: string[]) => k.some((x) => id.includes(x));
  if (has('hanging_leg', 'hanging_knee', 'lying_leg', 'leg_raise')) return has('lying') ? 'crunch' : 'legraise';
  if (has('plank', 'hollow', 'l_sit', 'side_plank', 'wall_sit', 'handstand_wall_hold', 'front_lever', 'dead_bug', 'bird_dog', 'superman', 'pallof')) return has('l_sit', 'front_lever', 'handstand') ? 'hold' : 'plank';
  if (has('crunch', 'russian', 'bicycle')) return 'crunch';
  if (has('mountain', 'burpee', 'bear_crawl')) return 'pushup';
  if (has('jump', 'skater', 'high_knees', 'rope', 'jumping_jack', 'box_jump', 'swing', 'snatch', 'thruster')) return has('swing', 'snatch', 'thruster') ? 'hinge' : 'jump';
  if (has('calf')) return 'calf';
  if (has('bridge', 'thrust', 'frog', 'kickback', 'donkey', 'abduction', 'lateral_walk')) return 'bridge';
  if (has('pull_up', 'chin_up', 'pullup')) return 'pullup';
  if (has('pulldown', 'pull_down', 'straight_arm')) return 'pulldown';
  if (has('curl') && !has('leg_curl', 'nordic', 'slider')) return 'curl';
  if (has('triceps_ext', 'skull', 'overhead_triceps', 'pushdown', 'kickback_tri')) return has('pushdown') ? 'curl' : 'extension';
  if (has('lateral_raise', 'front_raise', 'rear_delt', 'reverse_pec', 'pull_apart', 'face_pull', 'dislocate')) return 'raise';
  if (has('bench_press', 'dumbbell_press', 'chest_press', 'close_grip', 'incline_bench', 'incline_dumbbell', 'dumbbell_fly', 'pec_deck', 'cable_cross')) return 'bench';
  if (has('push_up', 'dip', 'planche')) return 'pushup';
  if (has('overhead_press', 'shoulder_press', 'arnold', 'push_press', 'handstand_push', 'pike')) return 'press';
  if (has('row', 'rack_pull_x')) return 'row';
  if (has('lunge', 'split_squat', 'step_up', 'cossack', 'shrimp', 'pistol')) return 'lunge';
  if (has('deadlift', 'rdl', 'good_morning', 'pull_through', 'hamstring_walkout', 'rack_pull')) return 'hinge';
  if (has('squat', 'leg_press', 'leg_extension', 'hack')) return 'squat';
  if (has('farmer', 'carry')) return 'carry';
  const ex = byId(id);
  switch (ex?.pattern) {
    case 'squat': return 'squat';
    case 'hinge': return 'hinge';
    case 'push': return ex.muscle === 'shoulders' ? 'press' : 'bench';
    case 'pull': return 'row';
    case 'lunge': return 'lunge';
    case 'core': return 'crunch';
    case 'carry': return 'carry';
    case 'mobility': return 'stretch';
    case 'conditioning': return 'jump';
    default: return ex?.muscle === 'biceps' ? 'curl' : ex?.muscle === 'triceps' ? 'extension' : ex?.muscle === 'calves' ? 'calf' : ex?.muscle === 'shoulders' ? 'raise' : 'squat';
  }
}

const seg = (a: P, b: P) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
function Figure({ pose, tpl, equipment, accent }: { pose: Pose; tpl: Tpl; equipment: string[]; accent: boolean }) {
  const p = pose;
  const heavy = equipment.includes('barbell'), db = equipment.includes('dumbbells');
  return (
    <svg viewBox="-4 -12 108 116" className={'mv' + (accent ? ' end' : '')}>
      {p.floor ? <path d="M0 96H100" className="mv-floor" /> : <path d="M0 96H100" className="mv-floor" />}
      {tpl.bar === 'overhead' && <path d="M30 2H70" className="mv-bar" />}
      <path d={`${seg(p.hip, p.knee)}${seg(p.knee, p.ankle)}${seg(p.sh, p.elbow)}${seg(p.elbow, p.wrist)}`} className="mv-limb back" transform="translate(3 0)" />
      <path d={seg(p.sh, p.hip)} className="mv-torso" />
      <path d={`${seg(p.hip, p.knee)}${seg(p.knee, p.ankle)}${seg(p.sh, p.elbow)}${seg(p.elbow, p.wrist)}`} className="mv-limb" />
      <path d={`M${p.ankle[0]} ${p.ankle[1]}l8 0`} className="mv-limb" />
      <circle cx={p.head[0]} cy={p.head[1]} r="7" className="mv-head" />
      {p.load && heavy && <path d={`M${p.load[0] - 12} ${p.load[1]}H${p.load[0] + 12}`} className="mv-weight" />}
      {p.load && heavy && <><circle cx={p.load[0] - 12} cy={p.load[1]} r="4" className="mv-plate" /><circle cx={p.load[0] + 12} cy={p.load[1]} r="4" className="mv-plate" /></>}
      {p.load && db && !heavy && <circle cx={p.load[0]} cy={p.load[1]} r="5" className="mv-plate" />}
      <circle cx={p.wrist[0]} cy={p.wrist[1]} r="2.2" className="mv-joint" />
    </svg>
  );
}

/** Two frames of the movement (start and end) with an arrow: what the exercise should look like. */
export function MovementFigure({ id }: { id: string }) {
  const t = useT();
  const tpl = T[figureFor(id)] ?? T.squat!;
  const eq = byId(id)?.equipment ?? [];
  const isHold = tpl.start === tpl.end || JSON.stringify(tpl.start) === JSON.stringify(tpl.end);
  return (
    <div className="movement" role="img" aria-label={t('anat_movement')}>
      <figure><Figure pose={tpl.start} tpl={tpl} equipment={eq} accent={false} /><figcaption>{isHold ? t('anat_hold') : t('anat_start')}</figcaption></figure>
      {!isHold && <span className="mv-arrow" aria-hidden>➜</span>}
      {!isHold && <figure><Figure pose={tpl.end} tpl={tpl} equipment={eq} accent /><figcaption>{t('anat_end')}</figcaption></figure>}
    </div>
  );
}

/** Anatomy + movement for one exercise, used inside the "Technique" window and the exercise page. */
export function ExerciseVisual({ id }: { id: string }) {
  const t = useT();
  const ex = byId(id);
  if (!ex) return null;
  return (
    <div className="exvisual">
      <MuscleMap primary={ex.muscle} secondary={ex.secondary} />
      <MovementFigure id={id} />
      <p className="muted small">{t('anat_note')}</p>
    </div>
  );
}
