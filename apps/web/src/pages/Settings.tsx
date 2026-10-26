import { useState } from 'react';
import { api } from '../api';
import { LangPicker, Loading, useApp, useLang, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';

const CONSENT_KEYS = ['share_with_pro', 'ai_memory', 'camera_video'];

export function Settings() {
  const t = useT(), lang = useLang(), nav = useNav();
  const { me, refresh, onLang, onLogout, toast } = useApp();
  const links = useLoad<{ id: number; status: string; proName: string }[]>('/api/links', [me.mode]);
  const [code, setCode] = useState('');
  const toggle = async (k: string, v: boolean) => { await api('PUT', '/api/consents', { [k]: v }); await refresh(); links.reload(); };
  const join = async () => {
    try { const r = await api('POST', '/api/links/join-code', { code }); toast(`${t('joined')} ${r.proName}`); setCode(''); links.reload(); }
    catch (e) { const st = (e as { status?: number }).status; toast(st === 404 ? t('invalidCode') : st === 403 ? t('c_share_with_pro') : t('invalid')); }
  };
  const download = async () => {
    const data = await api('GET', '/api/export');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'fondal-export.json'; a.click();
  };
  return (
    <Page title={t('settings')}>
      <div className="card"><h3>{me.name}</h3><p className="muted">{me.email}</p><LangPicker lang={lang} onLang={onLang} /></div>

      <div className="card"><h3>Ayuda y tutoriales</h3><p className="muted">Aprendé a usar cada función de Fondal Fit paso a paso. Podés repetir la guía todas las veces que quieras.</p><button className="primary" onClick={()=>window.dispatchEvent(new Event('fondal:show-tutorial'))}>Ver tutorial de mi interfaz</button></div>
      <div className="card"><h3>{t('accountMode')}</h3>
        {me.canPro ? <p className="muted">{t('modeHelp')}</p> : <p className="muted">{t('enableProHelp')}</p>}
        {me.canPro ? <div className="modepill" role="group" aria-label={t('accountMode')} style={{ alignSelf: 'flex-start' }}>
          {(me.availableModes ?? (['athlete', 'pro'] as const)).map((m) => <button key={m} className={me.mode === m ? 'on' : ''} aria-pressed={me.mode === m} onClick={async () => { await api('POST', '/api/me/mode', { mode: m }); await refresh(); nav.go(m === 'pro' ? 'students' : m === 'medical' ? 'medical_panel' : m === 'admin' ? 'admin' : 'home'); }}>{t(m === 'pro' ? 'pro' : m === 'medical' ? 'navHealth' : m === 'admin' ? 'admin' : 'athlete')}</button>)}
        </div> : <button className="primary" onClick={async () => { await api('POST', '/api/me/pro'); await api('POST', '/api/me/mode', { mode: 'pro' }); await refresh(); nav.go('students'); }}>{t('enablePro')}</button>}
      </div>

      {me.mode === 'athlete' && <>
        <div className="card"><button onClick={() => nav.push('wizard')}>{t('editPlan')}</button></div>
        <div className="card"><h3>{t('privacy')}</h3>
          {CONSENT_KEYS.map((k) => <label key={k} className="check"><input type="checkbox" checked={!!me.consents[k]} onChange={(e) => toggle(k, e.target.checked)} />{k === 'ai_memory' ? t('coachMemory') : t('c_' + k)}</label>)}</div>
        <div className="card"><h3>{t('myTrainers')}</h3>
          {!links.data ? <Loading err={links.err} retry={links.reload} /> : links.data.map((l) => (
            <div className="row between" key={l.id} style={{ margin: '6px 0' }}><span>{l.proName} <span className="badge">{t(l.status)}</span></span>
              <span className="row" style={{ flex: 'none' }}>
                {l.status === 'pending' && <button className="primary" disabled={!me.consents.share_with_pro} onClick={async () => { await api('POST', `/api/links/${l.id}/accept`); links.reload(); }}>{t('accept')}</button>}
                {l.status !== 'revoked' && <button className="danger" onClick={async () => { await api('POST', `/api/links/${l.id}/revoke`); links.reload(); }}>{t('revoke')}</button>}</span></div>))}
          <label>{t('joinWithCode')}<div className="row"><input value={code} maxLength={12} placeholder="ABCD2345" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }} onChange={(e) => setCode(e.target.value.toUpperCase())} /><button className="primary" style={{ flex: 'none' }} disabled={code.length < 6} onClick={join}>{t('join')}</button></div></label>
          {!me.consents.share_with_pro && <p className="muted small">{t('c_share_with_pro')}</p>}</div>
      </>}

      <div className="card"><h3>{t('subscription')}</h3>
        <p>{t('trialUntil')} {me.subscription.trialEndsAt.slice(0, 10)} {me.subscription.canceled && <span className="badge">{t('canceled')}</span>}</p><p className="muted">{t('paymentsNote')}</p>
        {!me.subscription.canceled && <button onClick={async () => { await api('POST', '/api/subscription/cancel'); await refresh(); }}>{t('cancelSub')}</button>}</div>
      <div className="card"><h3>{t('yourData')}</h3><div className="row"><button onClick={download}>{t('export')}</button><button className="danger" onClick={async () => { if (confirm(t('confirmDelete'))) { await api('DELETE', '/api/me'); onLogout(); } }}>{t('deleteAccount')}</button></div></div>
      <button onClick={onLogout}>{t('logout')}</button>
    </Page>
  );
}
