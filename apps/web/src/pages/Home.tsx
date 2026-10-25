import { Bar, Loading, useLoad, useT, type Me } from '../ctx';

export function Home({ me, go }: { me: Me; go: (tab: string) => void }) {
  const t = useT();
  const plan = useLoad<{ version?: number; plan: { days: { name: string; kind?: string; items: unknown[]; cardio?: { modality: string; type: string; durationMin: number } }[] } | null }>('/api/plan');
  const nut = useLoad<{ target: { kcal: number } | null; today: { kcal: number } }>('/api/nutrition');
  const prog = useLoad<{ total: number }>('/api/progress');
  const act = useLoad<{ activities: unknown[] }>('/api/activities');
  const gam = useLoad<{ level: number; xp: number; streakWeeks: number }>('/api/gamification');
  if (!plan.data || !nut.data) return <Loading err={plan.err || nut.err} retry={() => { plan.reload(); nut.reload(); }} />;
  if (!plan.data.plan) return <div className="card"><h2>{t('hi')}, {me.name}</h2><p>{t('noPlanYet')}</p><button className="primary" onClick={() => go('wizard')}>{t('createPlan')}</button></div>;
  const days = plan.data.plan.days;
  const done = (prog.data?.total ?? 0) + (act.data?.activities.length ?? 0);
  const next = days[done % days.length]!;
  const tg = nut.data.target;
  return (
    <>
      <h2>{t('hi')}, {me.name}</h2>
      <div className="card">
        <p className="muted">{t('nextSession')}</p>
        <h3>{next.name} · {next.kind === 'cardio' && next.cardio ? `${t(next.cardio.modality)} · ${t('ct_' + next.cardio.type)} · ${next.cardio.durationMin} ${t('minutes_short')}` : `${next.items.length} ${t('ex_count')}`}</h3>
        <button className="primary" onClick={() => go(next.kind === 'cardio' ? 'cardio' : 'train')}>{t('startNow')}</button>
      </div>
      {tg && <div className="card" onClick={() => go('food')} role="button" tabIndex={0}>
        <p>{t('eaten')}: <b>{nut.data.today.kcal}</b> / {tg.kcal} {t('kcalShort')}</p><Bar pct={(nut.data.today.kcal / tg.kcal) * 100} />
        <button className="link">{t('seeMenus')} →</button></div>}
      {gam.data && <p className="muted">{t('level')} {gam.data.level} · {gam.data.xp} XP · {t('streak')}: {gam.data.streakWeeks}</p>}
    </>
  );
}
