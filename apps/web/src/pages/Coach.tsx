import { useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Loading, useLoad, useT } from '../ctx';

interface Supp { id: string; evidence: 'strong' | 'moderate' | 'conditional' }
interface Msg { role: 'user' | 'assistant'; content: string }

export function Coach({ memory }: { memory: boolean }) {
  const t = useT();
  const st = useLoad<{ configured: boolean }>('/api/coach/status');
  const sp = useLoad<{ supplements: Supp[]; proteinGapG: number; basedOnLogs: boolean }>('/api/supplements');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = msgs.slice(-8);
    setMsgs([...msgs, { role: 'user', content: q }]); setText(''); setBusy(true); setErr('');
    try {
      const r = await api('POST', '/api/coach', { message: q, history });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply }]);
    } catch (e) { setErr(e instanceof ApiError && e.status === 429 ? t('coachLimit') : t('coachErr')); }
    finally { setBusy(false); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  };

  return (
    <>
      <div className="card">
        <h2>{t('ask')}</h2>
        {!st.data ? <Loading err={st.err} retry={st.reload} /> : !st.data.configured ? <p className="muted">{t('coachOff')}</p> : <>
          {!memory && <p className="muted">{t('coachShare')}</p>}
          <div className="chips">{['q1', 'q2', 'q3'].map((q) => <button key={q} className="chip" onClick={() => ask(t(q))}>{t(q)}</button>)}</div>
          <div className="chat" aria-live="polite">{msgs.map((m, i) => <p key={i} className={m.role}>{m.content}</p>)}{busy && <p className="assistant muted">{t('thinking')}</p>}<div ref={end} /></div>
          {err && <p className="warn" role="alert">{err}</p>}
          <form className="row" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <input aria-label={t('ask')} placeholder={t('askPlaceholder')} maxLength={1200} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="primary" style={{ flex: 'none' }} disabled={busy || !text.trim()}>{t('send')}</button></form></>}
      </div>
      <div className="card">
        <h2>{t('suppTitle')}</h2><p className="muted">{t('suppIntro')}</p>
        {!sp.data ? <Loading err={sp.err} retry={sp.reload} /> : <>
          {sp.data.basedOnLogs && sp.data.proteinGapG > 0 && <p className="warn">{t('proteinGap', { g: sp.data.proteinGapG })}</p>}
          {sp.data.supplements.map((s) => <div key={s.id} className="supp"><span className={'badge ev-' + s.evidence}>{t('ev_' + s.evidence)}</span><p>{t('supp_' + s.id)}</p></div>)}
          <p className="muted">{t('suppDisclaimer')}</p></>}
      </div>
    </>
  );
}
