import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { LANGS, translate, type Lang } from './i18n';

export { LANGS };
export type { Lang };
export type TFn = (k: string, vars?: Record<string, string | number>) => string;
export const LangCtx = createContext<{ lang: Lang; t: TFn }>({ lang: 'es', t: (k) => k });
export const useT = () => useContext(LangCtx).t;
export const useLang = () => useContext(LangCtx).lang;

export const initialLang = (): Lang => {
  try { const s = localStorage.getItem('ff_lang') as Lang | null; if (s && LANGS.includes(s)) return s; } catch { /* ignore */ }
  const n = navigator.language.slice(0, 2);
  return (LANGS as string[]).includes(n) ? (n as Lang) : 'es';
};

export interface Me { id: number; name: string; role: 'athlete' | 'pro' | 'admin'; lang: Lang; subscription: { plan: string; trialEndsAt: string; active: boolean; canceled: boolean }; consents: Record<string, boolean> }

export function LangPicker({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT();
  return (
    <label>{t('language')}
      <select value={lang} onChange={(e) => onLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
    </label>
  );
}

export function Chips({ options, value, onChange, multi, label }: { options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean; label?: (o: string) => string }) {
  const t = useT();
  return <div className="chips">{options.map((o) => {
    const on = value.includes(o);
    return <button key={o} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...value, o]) : [o])}>{label ? label(o) : t(o)}</button>;
  })}</div>;
}

export function Bar({ pct }: { pct: number }) { return <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>; }

/** Fetch-on-mount with loading/error state and retry (the free server can take up to a minute to wake). */
export function useLoad<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setErr(false);
    api<T>('GET', url).then((d) => live && setData(d)).catch(() => live && setErr(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, n, ...deps]);
  return { data, err, reload: () => setN((x) => x + 1), setData };
}

export function Loading({ err, retry }: { err: boolean; retry: () => void }) {
  const t = useT();
  return err ? <div className="card"><p className="warn" role="alert">{t('netError')}</p><button onClick={retry}>{t('retry')}</button></div> : <p className="muted" role="status">{t('loading')}</p>;
}

export const Stack = ({ children }: { children: ReactNode }) => <div className="stack">{children}</div>;
