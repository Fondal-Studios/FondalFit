import { useId } from 'react';

export interface Pt { x: number; y: number }
const nice = (min: number, max: number, n = 4) => {
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
};
const W = 340, H = 200, L = 44, R = 12, T = 12, B = 30;

/** Line chart with labelled axes, gridlines and units. `fmtX` turns the x value (ms or index) into a tick label. */
export function LineChart({ points, unit, title, fmtX, fmtY, color = 'var(--accent)', invertGood }: { points: Pt[]; unit: string; title: string; fmtX: (x: number) => string; fmtY?: (y: number) => string; color?: string; invertGood?: boolean }) {
  const id = useId();
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const { lo, hi, ticks } = nice(Math.min(...ys), Math.max(...ys));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (x: number) => L + (x1 === x0 ? (W - L - R) / 2 : ((x - x0) / (x1 - x0)) * (W - L - R));
  const sy = (y: number) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const fy = fmtY ?? ((v: number) => String(Math.round(v * 10) / 10));
  const xt = points.length <= 4 ? points : [0, 1 / 3, 2 / 3, 1].map((f) => points[Math.round(f * (points.length - 1))]!);
  const first = points[0]!.y, last = points[points.length - 1]!.y;
  const delta = Math.round((last - first) * 10) / 10;
  const good = invertGood ? delta <= 0 : delta >= 0;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}t`}>
        <title id={`${id}t`}>{`${title}: ${fy(first)} → ${fy(last)} ${unit} (${points.length})`}</title>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" /><text x={L - 6} y={sy(v) + 4} textAnchor="end" className="tick">{fy(v)}</text></g>)}
        {xt.map((p, i) => <text key={i} x={sx(p.x)} y={H - 10} textAnchor="middle" className="tick">{fmtX(p.x)}</text>)}
        <text x={4} y={10} className="unit">{unit}</text>
        <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')} />
        {points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={i === points.length - 1 ? 4.5 : 2.5} fill={color} />)}
      </svg>
      <figcaption>{title}: <b>{fy(last)} {unit}</b> <span className={good ? 'ok' : 'warn'}>{delta > 0 ? '+' : ''}{delta} {unit}</span></figcaption>
      <table className="sr-only"><caption>{title}</caption><tbody>{points.map((p, i) => <tr key={i}><td>{fmtX(p.x)}</td><td>{fy(p.y)} {unit}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Bar chart with labelled axes; optional dashed target line. */
export function BarChart({ bars, unit, title, target, color = 'var(--accent)' }: { bars: { label: string; value: number }[]; unit: string; title: string; target?: number; color?: string }) {
  const id = useId();
  if (!bars.length) return null;
  const max = Math.max(...bars.map((b) => b.value), target ?? 0, 1);
  const { hi, ticks } = nice(0, max);
  const sy = (y: number) => T + (1 - y / hi) * (H - T - B);
  const bw = (W - L - R) / bars.length;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}t`}>
        <title id={`${id}t`}>{`${title} (${unit})`}</title>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" /><text x={L - 6} y={sy(v) + 4} textAnchor="end" className="tick">{v}</text></g>)}
        <text x={4} y={10} className="unit">{unit}</text>
        {bars.map((b, i) => <g key={i}>
          <rect x={L + i * bw + bw * 0.15} y={sy(b.value)} width={bw * 0.7} height={Math.max(0, sy(0) - sy(b.value))} rx="3" fill={color} />
          {(bars.length <= 8 || i % Math.ceil(bars.length / 6) === 0) && <text x={L + i * bw + bw / 2} y={H - 10} textAnchor="middle" className="tick">{b.label}</text>}
        </g>)}
        {target !== undefined && <g><line x1={L} x2={W - R} y1={sy(target)} y2={sy(target)} className="target" /><text x={W - R} y={sy(target) - 4} textAnchor="end" className="tick">{target}</text></g>}
      </svg>
      <figcaption>{title}</figcaption>
      <table className="sr-only"><caption>{title}</caption><tbody>{bars.map((b, i) => <tr key={i}><td>{b.label}</td><td>{b.value} {unit}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Circular progress ring. */
export function Ring({ pct, size = 120, stroke = 12, children, color = 'var(--accent)' }: { pct: number; size?: number; stroke?: number; children?: React.ReactNode; color?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d242c" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p > 100 ? 'var(--warn)' : color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ringlabel">{children}</div>
    </div>
  );
}

/** Hydration bar with colour zones: <1.5 L low, 1.5–2.5 fair, 2.5–3.5 good, 3.5–4 high, >4 L more than needed. */
export const WATER_ZONES = [{ to: 1500, color: '#f87171', key: 'low' }, { to: 2500, color: '#fbbf24', key: 'fair' }, { to: 3500, color: '#4ade80', key: 'good' }, { to: 4000, color: '#60a5fa', key: 'high' }, { to: Infinity, color: '#a78bfa', key: 'over' }] as const;
export const waterZone = (ml: number) => WATER_ZONES.find((z) => ml < z.to)!;
export function WaterBar({ ml, goal }: { ml: number; goal?: number }) {
  const MAX = 4500;
  const stops = [0, 1500, 2500, 3500, 4000, MAX];
  return (
    <div className="waterbar" role="img" aria-label={`${(ml / 1000).toFixed(2)} L`}>
      <div className="wtrack">
        {WATER_ZONES.map((z, i) => <span key={i} style={{ left: `${(stops[i]! / MAX) * 100}%`, width: `${((stops[i + 1]! - stops[i]!) / MAX) * 100}%`, background: z.color }} />)}
        <i style={{ left: `${Math.min(100, (ml / MAX) * 100)}%` }} />
        {goal ? <b style={{ left: `${Math.min(100, (goal / MAX) * 100)}%` }} /> : null}
      </div>
      <div className="wticks">{[0, 1500, 2500, 3500, 4000].map((v) => <span key={v} style={{ left: `${(v / MAX) * 100}%` }}>{v / 1000}</span>)}</div>
    </div>
  );
}
