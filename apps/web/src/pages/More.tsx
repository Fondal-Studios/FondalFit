import { useApp, useT } from '../ctx';
import { useNav } from '../nav';

export function More() {
  const t = useT(), nav = useNav(), { me } = useApp();
  const items: [string, string, string, string][] = me.mode === 'pro'
    ? [['📋', 'hub', 'hubTitle', 'hubSub'], ['🏢', 'gyms', 'Gimnasios', 'Gestionar equipos y alumnos'], ['🔎', 'directory', 'navDirectory', 'navDirectorySub'], ['🧪', 'science', 'science', 'scienceSub'], ['⚙️', 'settings', 'settings', 'settingsSub']]
    : [['🤖', 'coach', 'coach', 'coachSub'], ['📈', 'progress', 'progress', 'progressSub'], ['🏆', 'challenges', 'challenges', 'challengesSub'], ['📚', 'routines', 'routines', 'routinesSub'], ['🏋️', 'exercises', 'exercises', 'exercisesSub'], ['😴', 'recovery', 'recovery', 'recoverySub'], ['🏅', 'rankings', 'rankingsWeekly', 'rankingsWeeklySub'], ['🏢', 'gyms', 'Gimnasios', 'Mis membresías y solicitudes'], ['🔎', 'directory', 'navDirectory', 'navDirectorySub'], ['🩺', 'profile', 'affiliate', 'affiliateSub'], ['🧪', 'science', 'science', 'scienceSub'], ['⚙️', 'settings', 'settings', 'settingsSub']];
  if (!me.canPro) items.unshift(['🎓', 'settings', 'enablePro', 'enableProShort']);
  if (me.isAdmin) items.push(['📊', 'admin', 'admin', 'adminSub']);
  return (
    <div className="stack"><h2>{t('nav_more')}</h2>
      <div className="card list">{items.map(([em, k, title, sub]) => <button key={k} onClick={() => nav.push(k)}><span><b>{em} {k==='gyms'?title:t(title)}</b><span className="sub">{k==='gyms'?sub:t(sub)}</span></span><span aria-hidden>›</span></button>)}</div>
    </div>
  );
}
