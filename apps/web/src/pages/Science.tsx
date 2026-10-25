import { useT } from '../ctx';

const SECTIONS = ['fibers', 'hyp', 'fat', 'conc', 'nut', 'prog'];
export function Science() {
  const t = useT();
  return (
    <>
      <p className="muted">{t('sc_intro')}</p>
      {SECTIONS.map((s) => <div className="card" key={s}><h3>{t(`sc_${s}_t`)}</h3><p>{t(`sc_${s}`)}</p></div>)}
      <p className="muted">{t('sc_limits')}</p>
    </>
  );
}
