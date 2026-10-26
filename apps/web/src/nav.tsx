import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useT } from './ctx';

export interface Screen { name: string; props?: Record<string, unknown> }
interface NavApi { push: (name: string, props?: Record<string, unknown>) => void; back: () => void; go: (tab: string) => void; tab: string; depth: number }
const Ctx = createContext<NavApi>({ push: () => {}, back: () => {}, go: () => {}, tab: 'home', depth: 0 });
export const useNav = () => useContext(Ctx);

/**
 * Stack navigation over the tab roots. Every pushed screen gets a back button; the browser/phone back gesture
 * pops the stack too (each push adds a history entry), so "back" never drops the user out of the app by surprise.
 */
export function NavProvider({ initialTab, children, render }: { initialTab: string; children?: ReactNode; render: (api: NavApi, stack: Screen[]) => ReactNode }) {
  const [tab, setTab] = useState(initialTab);
  const [stack, setStack] = useState<Screen[]>([]);

  const push = useCallback((name: string, props?: Record<string, unknown>) => {
    try { window.history.pushState({ ff: true }, ''); } catch { /* ignore */ }
    setStack((s) => [...s, { name, props }]);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    if (stack.length === 0) return;
    try { window.history.back(); } catch { setStack((s) => s.slice(0, -1)); }
  }, [stack.length]);
  const go = useCallback((k: string) => { setStack([]); setTab(k); window.scrollTo({ top: 0 }); }, []);

  useEffect(() => {
    const onPop = () => setStack((s) => s.slice(0, -1));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const api = useMemo(() => ({ push, back, go, tab, depth: stack.length }), [push, back, go, tab, stack.length]);
  return <Ctx.Provider value={api}>{render(api, stack)}{children}</Ctx.Provider>;
}

/** Page chrome for secondary screens: title + back button. Root tabs use plain <h2>. */
export function Page({ title, right, children, sub }: { title: string; right?: ReactNode; sub?: string; children: ReactNode }) {
  const { back, depth } = useNav();
  const t = useT();
  return (
    <section className="page">
      <div className="pagebar">
        {depth > 0 ? <button className="iconbtn" onClick={back} aria-label={t('back')}>←</button> : null}
        <div className="pagetitle"><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}
