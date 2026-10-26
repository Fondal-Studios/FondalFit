import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { FOODS, FOOD_CATS, foodById, foodName, gramChips, macrosFor, parseMeal, type Food, type FoodCat, type Macros } from '@fondal/engine';
import { Chips, useApp, useLang, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';

interface Custom { name: string; kcalPer100: number; proteinPer100: number; carbsPer100: number; fatPer100: number }
/** A plate line: a food from the table, or an AI-estimated custom food (clearly labelled everywhere). */
interface Entry { key: string; foodId?: string; custom?: Custom; grams: number }
const entryMacros = (e: Entry): Macros => { if (e.foodId) return macrosFor(foodById(e.foodId)!, e.grams); const c = e.custom!, k = e.grams / 100; return { kcal: Math.round(c.kcalPer100 * k), p: Math.round(c.proteinPer100 * k * 10) / 10, c: Math.round(c.carbsPer100 * k * 10) / 10, f: Math.round(c.fatPer100 * k * 10) / 10 }; };
const sumEntries = (es: Entry[]): Macros => es.reduce((a, e) => { const m = entryMacros(e); return { kcal: a.kcal + m.kcal, p: Math.round((a.p + m.p) * 10) / 10, c: Math.round((a.c + m.c) * 10) / 10, f: Math.round((a.f + m.f) * 10) / 10 }; }, { kcal: 0, p: 0, c: 0, f: 0 });
const EMOJI: Record<FoodCat, string> = { meat: '🥩', fish: '🐟', dairy: '🥚', veg: '🥦', fruit: '🍎', grain: '🍞', legume: '🫘', nuts: '🥜', fats: '🫒', drinks: '🥤', sweets: '🍫', prepared: '🍕' };
const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mealByHour = () => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 20 ? 'snack' : 'dinner'; };
const SR = (typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition) : undefined) as (new () => any) | undefined;
const SPEECH_LANG = { es: 'es-AR', pt: 'pt-BR', en: 'en-US' } as const;

export function AddFood({ date }: { date?: string }) {
  const t = useT(), lang = useLang(), nav = useNav(), { toast } = useApp();
  const [tab, setTab] = useState<'cat' | 'text' | 'recent' | 'manual'>('cat');
  const [meal, setMeal] = useState<string>(mealByHour());
  const [cat, setCat] = useState<FoodCat | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ food: Food; grams: number } | null>(null);
  const [plate, setPlate] = useState<Entry[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const foods = useMemo(() => FOODS.filter((f) => (!cat || f.cat === cat) && (!q || norm(foodName(f, lang) + ' ' + (f.alias ?? '')).includes(norm(q)))).sort((a, b) => foodName(a, lang).localeCompare(foodName(b, lang), lang)), [cat, q, lang]);
  const total = sumEntries(plate);
  const add = (foodId: string, grams: number) => setPlate((p) => { const i = p.findIndex((x) => x.foodId === foodId); return i >= 0 ? p.map((x, j) => (j === i ? { ...x, grams: x.grams + grams } : x)) : [...p, { key: foodId, foodId, grams }]; });
  const addCustom = (custom: Custom, grams: number) => setPlate((p) => [...p, { key: 'c:' + custom.name + p.length, custom, grams }]);

  const save = async () => {
    setBusy(true);
    try {
      const at = date ? new Date(`${date}T12:00:00`).toISOString() : undefined;
      await api('POST', '/api/nutrition/log', { mealType: meal, items: plate.filter((e) => e.foodId).map((e) => ({ foodId: e.foodId!, grams: e.grams })), custom: plate.filter((e) => e.custom).map((e) => ({ ...e.custom!, grams: e.grams })), at, timezoneOffset: new Date().getTimezoneOffset() });
      toast(`${t('mealSaved')} · ${total.kcal} ${t('kcalShort')}`);
      nav.back();
    } catch { toast(t('netError')); } finally { setBusy(false); }
  };

  return (
    <Page title={t('addFood')} sub={date ?? undefined}>
      <Chips options={[...MEALS]} value={[meal]} onChange={(v) => setMeal(v[0]!)} label={(m) => t('k_' + m)} />
      <div className="tabs-inline" role="tablist">
        {(['cat', 'text', 'recent', 'manual'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t('addtab_' + k)}</button>)}
      </div>

      {tab === 'cat' && (cat === null && !q ? (
        <>
          <div className="searchbar"><input type="search" aria-label={t('searchFood')} placeholder={t('searchFood')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="catgrid">{FOOD_CATS.map((c) => <button key={c} onClick={() => setCat(c)}><span className="em" aria-hidden>{EMOJI[c]}</span>{t('fc_' + c)}</button>)}</div>
        </>
      ) : (
        <>
          <div className="row"><button onClick={() => { setCat(null); setQ(''); }}>← {t('categories')}</button>{cat && <b style={{ flex: 'none' }}>{EMOJI[cat]} {t('fc_' + cat)}</b>}</div>
          <div className="searchbar"><input type="search" aria-label={t('searchFood')} placeholder={t('searchFood')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="list">
            {foods.map((f) => <button key={f.id} onClick={() => setPick({ food: f, grams: f.portionG })}><span><b>{foodName(f, lang)}</b><span className="sub">{f.kcal} {t('kcalShort')} / 100 {f.liquid ? 'ml' : 'g'}</span></span><span aria-hidden>＋</span></button>)}
            {!foods.length && <div className="empty"><div className="em">🔎</div><p>{t('noResults')}</p></div>}
          </div>
        </>
      ))}

      {tab === 'text' && <TextLog onAdd={(items) => { items.forEach((i) => (i.foodId ? add(i.foodId, i.grams) : addCustom(i.custom!, i.grams))); setTab('cat'); setCat(null); toast(`${items.length} ${t('addedToPlate')}`); }} />}
      {tab === 'recent' && <Recent onAdd={(items) => { items.forEach((i) => (i.foodId ? add(i.foodId, i.grams) : i.custom && addCustom(i.custom, i.grams))); toast(t('addedToPlate')); }} />}

      {tab === 'manual' && <ManualFood meal={meal} date={date} onSaved={() => { toast(t('mealSaved')); nav.back(); }} />}

      {pick && <PortionSheet food={pick.food} grams={pick.grams} onChange={(g) => setPick({ ...pick, grams: g })} onCancel={() => setPick(null)} onAdd={() => { add(pick.food.id, pick.grams); setPick(null); toast(`${foodName(pick.food, lang)} · ${macrosFor(pick.food, pick.grams).kcal} ${t('kcalShort')}`); }} />}

      {plate.length > 0 && !pick && !review && <div className="platebar"><button className="primary" onClick={() => setReview(true)}>🍽 {t('plate')}: {plate.length} · {total.kcal} {t('kcalShort')} — {t('reviewSave')}</button></div>}
      {review && (
        <>
          <div className="scrim" onClick={() => setReview(false)} />
          <div className="sheet" role="dialog" aria-label={t('plate')}>
            <h3>{t('plate')} · {t('k_' + meal)}</h3>
            <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
              {plate.map((it) => { const f = it.foodId ? foodById(it.foodId)! : undefined; return (
                <div className="row between" key={it.key} style={{ margin: '6px 0' }}>
                  <span style={{ flex: 2 }}><b>{f ? foodName(f, lang) : it.custom!.name}</b>{!f && <span className="badge lv2" style={{ marginLeft: 6 }}>{t('aiEstimate')}</span>}<span className="muted small"> · {entryMacros(it).kcal} {t('kcalShort')}</span></span>
                  <input style={{ flex: 1, minWidth: 70 }} inputMode="numeric" aria-label={t('grams')} value={it.grams} onChange={(e) => setPlate(plate.map((x) => (x.key === it.key ? { ...x, grams: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                  <span className="muted">{f?.liquid ? 'ml' : 'g'}</span>
                  <button aria-label={t('remove')} onClick={() => setPlate(plate.filter((x) => x.key !== it.key))} style={{ flex: 'none' }}>✕</button>
                </div>); })}
            </div>
            <p><b>{total.kcal} {t('kcalShort')}</b> · P {total.p} g · C {total.c} g · G {total.f} g</p>
            <div className="row"><button className="primary" disabled={busy || plate.some((p) => p.grams <= 0)} onClick={save}>{t('saveMeal')}</button><button onClick={() => setReview(false)}>{t('addMore')}</button></div>
          </div>
        </>
      )}
    </Page>
  );
}

function PortionSheet({ food, grams, onChange, onAdd, onCancel }: { food: Food; grams: number; onChange: (g: number) => void; onAdd: () => void; onCancel: () => void }) {
  const t = useT(), lang = useLang();
  const m = macrosFor(food, grams), unit = food.liquid ? 'ml' : 'g';
  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={foodName(food, lang)}>
        <h3>{foodName(food, lang)}</h3>
        <div className="chips">{gramChips(food).map((g) => <button key={g} className={'chip' + (g === grams ? ' on' : '')} onClick={() => onChange(g)}>{g} {unit}</button>)}</div>
        {food.unitG && food.unitG >= 20 && <div className="chips" style={{ marginTop: 8 }}>{[1, 2, 3].map((n) => <button key={n} className={'chip' + (grams === n * food.unitG! ? ' on' : '')} onClick={() => onChange(n * food.unitG!)}>{n} {t('unit')} ({n * food.unitG!} {unit})</button>)}</div>}
        <div className="row" style={{ margin: '12px 0' }}>
          <button aria-label="−10" onClick={() => onChange(Math.max(5, grams - 10))} style={{ flex: 'none' }}>−10</button>
          <input inputMode="numeric" aria-label={t('grams')} value={grams} onChange={(e) => onChange(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))} style={{ textAlign: 'center', fontSize: '1.3rem' }} />
          <button aria-label="+10" onClick={() => onChange(grams + 10)} style={{ flex: 'none' }}>+10</button>
        </div>
        <p className="big">{m.kcal} {t('kcalShort')}</p><p className="muted">P {m.p} g · C {m.c} g · G {m.f} g · {t('approxFood')}</p>
        <div className="row"><button className="primary" disabled={grams <= 0} onClick={onAdd}>{t('addToPlate')}</button><button onClick={onCancel}>{t('cancel')}</button></div>
      </div>
    </>
  );
}

interface Interp { raw: string; foodId: string | null; name: string; grams: number; kcal: number; p: number; c: number; f: number; low: number; high: number; confidence: 'high' | 'medium' | 'low'; custom: Custom | null; note: string }

/** Free text → items. The server asks the AI model when it is configured (and always re-validates it); otherwise rules answer. */
function TextLog({ onAdd }: { onAdd: (items: { foodId: string | null; custom: Custom | null; grams: number }[]) => void }) {
  const t = useT(), lang = useLang();
  const [text, setText] = useState('');
  const [items, setItems] = useState<Interp[] | null>(null);
  const [source, setSource] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  useEffect(() => () => { try { rec.current?.stop(); } catch { /* ignore */ } }, []);

  const analyze = async () => {
    setBusy(true);
    try { const r = await api('POST', '/api/nutrition/interpret', { text }); setItems(r.items); setSource(r.source); }
    catch { // offline or server down: the same deterministic parser runs in the browser
      const r = parseMeal(text);
      setItems(r.items.map((i) => ({ raw: i.raw, foodId: i.foodId, name: i.foodId ? foodName(foodById(i.foodId)!, lang) : i.raw, grams: i.grams, kcal: i.macros?.kcal ?? 0, p: i.macros?.p ?? 0, c: i.macros?.c ?? 0, f: i.macros?.f ?? 0, low: i.low, high: i.high, confidence: i.confidence, custom: null, note: '' })));
      setSource('rules_local');
    } finally { setBusy(false); }
  };
  const edit = (i: number, grams: number) => setItems((cur) => cur!.map((x, j) => {
    if (j !== i || x.grams <= 0 && !x.custom && !x.foodId) return x;
    const ratio = x.grams > 0 ? grams / x.grams : 0;
    const f = x.foodId ? foodById(x.foodId) : undefined;
    const m = f ? macrosFor(f, grams) : { kcal: Math.round(x.kcal * ratio), p: x.p * ratio, c: x.c * ratio, f: x.f * ratio };
    return { ...x, grams, kcal: m.kcal, p: m.p, c: m.c, f: m.f, low: Math.round(m.kcal * 0.9), high: Math.round(m.kcal * 1.1), confidence: 'high' as const };
  }));
  const known = (items ?? []).filter((i) => i.grams > 0 && (i.foodId || i.custom));
  const kcal = known.reduce((a, i) => a + i.kcal, 0), low = known.reduce((a, i) => a + i.low, 0), high = known.reduce((a, i) => a + i.high, 0);
  const listen = () => {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); r.lang = SPEECH_LANG[lang]; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => setText((x) => (x ? x + ', ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  };
  return (
    <div className="card">
      <p className="muted">{t('nlHelp')}</p>
      <textarea aria-label={t('nlPlaceholder')} placeholder={t('nlPlaceholder')} rows={3} value={text} onChange={(e) => { setText(e.target.value); setItems(null); }} />
      <div className="row"><button className="primary" disabled={!text.trim() || busy} onClick={analyze}>{busy ? t('thinking') : t('analyze')}</button>{SR && <button onClick={listen} aria-pressed={listening}>{listening ? '⏹' : '🎤'} {t('dictate')}</button>}</div>
      {items && (
        <div style={{ marginTop: 12 }}>
          <p className="muted small">{source === 'ai' ? '✨ ' + t('interpretedByAi') : t('interpretedByRules')}</p>
          {items.map((it, i) => (it.foodId || it.custom) && it.grams > 0 ? (
            <div className="card" key={i} style={{ margin: '8px 0' }}>
              <div className="row between"><b>{it.name}</b><span>{it.custom && <span className="badge lv2" style={{ marginRight: 6 }}>{t('aiEstimate')}</span>}<span className={'badge ' + (it.confidence === 'high' ? 'lv1' : it.confidence === 'medium' ? 'lv2' : 'lv3')}>{t('conf_' + it.confidence)}</span></span></div>
              <p className="muted small">“{it.raw}”{it.note ? ` · ${it.note}` : ''}</p>
              <div className="row"><input inputMode="numeric" aria-label={t('grams')} value={it.grams} onChange={(e) => edit(i, Math.max(0, Number(e.target.value) || 0))} /><span className="muted" style={{ flex: 'none' }}>{it.foodId && foodById(it.foodId)?.liquid ? 'ml' : 'g'}</span><span style={{ flex: 2 }}><b>{it.kcal} {t('kcalShort')}</b><span className="muted small"> ({it.low}–{it.high})</span></span></div>
              {it.confidence === 'low' && <p className="warn small">{t('assumedPortion')}</p>}
            </div>
          ) : (
            <div className="card alert" key={i} style={{ margin: '8px 0' }}><p>❓ “{it.raw}” — {t('notRecognized')}</p></div>
          ))}
          {known.length > 0 && <><p><b>≈ {kcal} {t('kcalShort')}</b> <span className="muted">({t('range')} {low}–{high})</span></p><p className="muted small">{t('nlUncertainty')}</p><button className="primary" onClick={() => onAdd(known.map((i) => ({ foodId: i.foodId, custom: i.custom, grams: i.grams })))}>{t('addToPlate')}</button></>}
        </div>
      )}
    </div>
  );
}

function Recent({ onAdd }: { onAdd: (items: { foodId: string | null; custom: Custom | null; grams: number }[]) => void }) {
  const t = useT();
  const r = useLoad<{ recent: { meal: string; kcal: number; items: { foodId?: string; grams: number; name?: string }[] }[] }>('/api/nutrition/recent');
  if (!r.data) return <p className="muted">{t('loading')}</p>;
  if (!r.data.recent.length) return <div className="empty"><div className="em">🕘</div><p>{t('noRecent')}</p></div>;
  return <div className="list">{r.data.recent.map((m, i) => <button key={i} onClick={() => onAdd(m.items.filter((i) => i.foodId).map((i) => ({ foodId: i.foodId!, custom: null, grams: i.grams })))}><span><b>{m.meal}</b><span className="sub">{m.kcal} {t('kcalShort')} · {m.items.length} {t('foods')}</span></span><span aria-hidden>＋</span></button>)}</div>;
}


/** Add a food or dish when you already know its calories (label, restaurant, another app). */
function ManualFood({ meal, date, onSaved }: { meal: string; date?: string; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: '', kcal: '', p: '', c: '', g: '' });
  const [busy, setBusy] = useState(false);
  const n = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const save = async () => {
    setBusy(true);
    try { await api('POST', '/api/nutrition/log', { meal: f.name.trim(), mealType: meal, kcal: Math.round(n(f.kcal)), proteinG: n(f.p), carbsG: n(f.c), fatG: n(f.g), at: date ? new Date(`${date}T12:00:00`).toISOString() : undefined, timezoneOffset: new Date().getTimezoneOffset() }); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <div className="card">
      <p className="muted">{t('manualFoodHelp')}</p>
      <label>{t('meal')}<input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>{t('kcalShort')}<input inputMode="numeric" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value.replace(/\D/g, '') })} /></label>
      <div className="grid3"><label>{t('protein')}<input inputMode="decimal" value={f.p} onChange={(e) => setF({ ...f, p: e.target.value })} /></label><label>{t('carbs')}<input inputMode="decimal" value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} /></label><label>{t('fat')}<input inputMode="decimal" value={f.g} onChange={(e) => setF({ ...f, g: e.target.value })} /></label></div>
      <p className="muted small">{t('optionalMacros')}</p>
      <button className="primary" disabled={busy || !f.name.trim() || !f.kcal || Number(f.kcal) > 5000} onClick={save}>{t('saveMeal')}</button>
    </div>
  );
}
