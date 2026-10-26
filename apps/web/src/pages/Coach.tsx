import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Chips, Loading, useApp, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';

interface Supp { id: string; evidence: 'strong' | 'moderate' | 'conditional' }
interface Msg { role: 'user' | 'assistant'; content: string }
const TONES = ['friendly', 'direct', 'motivating', 'technical'];

export function Coach() {
  const t = useT(), nav = useNav(), { me } = useApp();
  const memory = !!me.consents.ai_memory;
  const st = useLoad<{ configured: boolean }>('/api/coach/status');
  const sp = useLoad<{ supplements: Supp[]; proteinGapG: number; basedOnLogs: boolean }>('/api/supplements');
  const hist = useLoad<{ messages: Msg[] }>('/api/coach/history');
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (hist.data && msgs === null) setMsgs(hist.data.messages); }, [hist.data, msgs]);
  const list = msgs ?? [];

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = list.slice(-8);
    setMsgs([...list, { role: 'user', content: q }]); setText(''); setBusy(true); setErr('');
    try {
      const r = await api('POST', '/api/coach', { message: q, history });
      setMsgs((m) => [...(m ?? []), { role: 'assistant', content: r.reply }]);
    } catch (e) { setErr(e instanceof ApiError && e.status === 429 ? t('coachLimit') : t('coachErr')); }
    finally { setBusy(false); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50); }
  };

  return (
    <Page title={t('coach')} right={<button onClick={() => nav.push('coach_memory')}>🧠 {t('memory')}</button>}>
      <div className="card">
        {!st.data ? <Loading err={st.err} retry={st.reload} /> : !st.data.configured ? <p className="muted">{t('coachOff')}</p> : <>
          {!memory && <p className="muted">{t('coachShare')}</p>}
          <div className="chips">{['q1', 'q2', 'q3'].map((q) => <button key={q} className="chip" onClick={() => ask(t(q))}>{t(q)}</button>)}</div>
          <div className="chat" aria-live="polite">{list.map((m, i) => <p key={i} className={m.role}>{m.content}</p>)}{busy && <p className="assistant muted">{t('thinking')}</p>}<div ref={end} /></div>
          {err && <p className="warn" role="alert">{err}</p>}
          <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input aria-label={t('ask')} placeholder={t('askPlaceholder')} maxLength={1200} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="primary" style={{ flex: 'none' }} disabled={busy || !text.trim()}>{t('send')}</button></form>
          <p className="muted small">{t('coachDisclaimer')}</p></>}
      </div>
      <div className="card">
        <h3>{t('suppTitle')}</h3><p className="muted">{t('suppIntro')}</p>
        {!sp.data ? <Loading err={sp.err} retry={sp.reload} /> : <>
          {sp.data.basedOnLogs && sp.data.proteinGapG > 0 && <p className="warn">{t('proteinGap', { g: sp.data.proteinGapG })}</p>}
          {sp.data.supplements.map((s) => <div key={s.id} className="supp"><span className={'badge ev-' + s.evidence}>{t('ev_' + s.evidence)}</span><p>{t('supp_' + s.id)}</p></div>)}
          <p className="muted small">{t('suppDisclaimer')}</p></>}
      </div>
    </Page>
  );
}

export function CoachMemory() {
  const t = useT(), { me, toast } = useApp();
  const mem = useLoad<{ memory: { key: string; value: string }[]; limit: number }>('/api/coach/memory');
  const [k, setK] = useState(''), [v, setV] = useState('');
  if (!mem.data) return <Page title={t('memory')}><Loading err={mem.err} retry={mem.reload} /></Page>;
  const tone = mem.data.memory.find((m) => m.key === 'coach_tone')?.value ?? 'friendly';
  const facts = mem.data.memory.filter((m) => m.key !== 'coach_tone');
  const setTone = async (x: string) => { await api('PUT', '/api/coach/memory', { key: 'coach_tone', value: x }); mem.reload(); };
  const add = async () => {
    try { await api('PUT', '/api/coach/memory', { key: k.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 30), value: v }); setK(''); setV(''); mem.reload(); } catch { toast(t('invalid')); }
  };
  return (
    <Page title={t('memory')}>
      <div className="card"><h3>{t('coachTone')}</h3><Chips options={TONES} value={[tone]} onChange={(x) => void setTone(x[0]!)} label={(x) => t('tone_' + x)} /><p className="muted small">{t('toneNote')}</p></div>
      <div className="card"><h3>{t('rememberedFacts')}</h3>
        {!me.consents.ai_memory && <p className="warn">{t('memoryOff')}</p>}
        {facts.length === 0 && <p className="muted">{t('noFactsYet')}</p>}
        {facts.map((f) => <div className="row between" key={f.key} style={{ margin: '6px 0' }}><span style={{ flex: 3 }}><b>{f.key.replace(/_/g, ' ')}</b>: {f.value}</span><button aria-label={t('remove')} style={{ flex: 'none' }} onClick={async () => { await api('DELETE', `/api/coach/memory/${f.key}`); mem.reload(); }}>✕</button></div>)}
        <div className="grid2" style={{ marginTop: 8 }}><label>{t('factKey')}<input value={k} maxLength={30} placeholder="dias_libres" onChange={(e) => setK(e.target.value)} /></label><label>{t('factValue')}<input value={v} maxLength={300} placeholder="martes y jueves" onChange={(e) => setV(e.target.value)} /></label></div>
        <button className="primary" disabled={k.trim().length < 2 || !v.trim()} onClick={add}>{t('addFact')}</button>
        <p className="muted small">{mem.data.memory.length}/{mem.data.limit}</p>
        <button className="danger" onClick={async () => { if (confirm(t('forgetConfirm'))) { await api('DELETE', '/api/coach/memory'); mem.reload(); } }}>{t('forgetAll')}</button></div>
    </Page>
  );
}
