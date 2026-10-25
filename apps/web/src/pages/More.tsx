import { useT } from '../ctx';

export function More({ go }: { go: (tab: string) => void }) {
  const t = useT();
  return <div className="card menu-list">{['directory', 'photos', 'coach', 'science', 'recovery', 'progress', 'rankings', 'settings'].map((k) => <button key={k} onClick={() => go(k)}>{k==='directory'?'Encontrar un profesional':k==='photos'?'Fotos de evolución':k==='rankings'?'Rankings semanales':t(k)} →</button>)}</div>;
}
