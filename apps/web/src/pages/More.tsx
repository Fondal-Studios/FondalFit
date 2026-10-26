import { useT } from '../ctx';

export function More({ go }: { go: (tab: string) => void }) {
  const t = useT();
  return <div className="card menu-list">{['coach', 'science', 'recovery', 'progress', 'rankings', 'directory', 'profile', 'settings'].map((k) => <button key={k} onClick={() => go(k)}>{k==='profile'?'Afiliarme como profesional de salud':k==='gyms'?'Mis gimnasios':k==='directory'?'Encontrar profesionales':k==='rankings'?'Rankings semanales':t(k)} →</button>)}</div>;
}
