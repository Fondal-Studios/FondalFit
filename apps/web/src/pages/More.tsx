import { useT } from '../ctx';

export function More({ go }: { go: (tab: string) => void }) {
  const t = useT();
  return <div className="card menu-list">{['coach', 'science', 'recovery', 'progress', 'rankings', 'directory', 'settings'].map((k) => <button key={k} onClick={() => go(k)}>{k==='directory'?'Encontrar profesionales':k==='rankings'?'Rankings semanales':t(k)} →</button>)}</div>;
}
