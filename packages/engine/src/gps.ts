export interface GeoPoint { lat: number; lon: number; t: number; acc?: number; alt?: number }
export type Sport = 'run' | 'bike' | 'walk';

const R = 6371000;
const rad = (x: number) => (x * Math.PI) / 180;
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_SPEED_MS: Record<Sport, number> = { run: 9, walk: 3.5, bike: 25 }; // physical plausibility caps
export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 3;

/** Accept a GPS fix only if accurate and physically plausible: filters jitter and jumps. */
export function acceptPoint(prev: GeoPoint | undefined, p: GeoPoint, sport: Sport): boolean {
  if (p.acc !== undefined && p.acc > MAX_ACCURACY_M) return false;
  if (!prev) return true;
  const dt = (p.t - prev.t) / 1000;
  if (dt <= 0) return false;
  const d = haversine(prev, p);
  if (d < MIN_STEP_M) return false;
  return d / dt <= MAX_SPEED_MS[sport];
}

export interface TrackStats { distanceM: number; movingSec: number; avgPaceSecKm: number; avgSpeedKmh: number; elevGainM: number; currentPaceSecKm: number }

/** Stats from accepted points; segments with gaps >30s (pauses/signal loss) don't count as moving time. */
export function trackStats(points: GeoPoint[], windowSec = 30): TrackStats {
  let dist = 0, moving = 0, gain = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt > 30) continue;
    dist += haversine(a, b); moving += dt;
    if (a.alt !== undefined && b.alt !== undefined && b.alt - a.alt > 0.5) gain += b.alt - a.alt;
  }
  // current pace over the trailing window
  let wd = 0, wt = 0;
  const end = points[points.length - 1]?.t ?? 0;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1]!, b = points[i]!;
    if (end - b.t > windowSec * 1000) break;
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && dt <= 30) { wd += haversine(a, b); wt += dt; }
  }
  const pace = (d: number, t: number) => (d > 10 ? Math.round((t / d) * 1000) : 0);
  return { distanceM: Math.round(dist), movingSec: Math.round(moving), avgPaceSecKm: pace(dist, moving), avgSpeedKmh: moving ? Math.round((dist / moving) * 36) / 10 : 0, elevGainM: Math.round(gain), currentPaceSecKm: pace(wd, wt) };
}

/** Thin a route for storage (keeps first/last, at most `max` points). */
export function simplifyRoute(points: GeoPoint[], max = 300): [number, number][] {
  const step = Math.max(1, Math.ceil(points.length / max));
  const out = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  return out.map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);
}

/** Heart-rate zones from an estimated max HR (Tanaka: 208 − 0.7×age). Estimates only. */
export function hrZones(age: number) {
  const max = Math.round(208 - 0.7 * age);
  const r = (a: number, b: number): [number, number] => [Math.round(max * a), Math.round(max * b)];
  return { max, z2: r(0.6, 0.7), z3: r(0.7, 0.8), z4: r(0.8, 0.9) };
}
