import { describe, expect, it } from 'vitest';
import { challengesForWeek, evaluateChallenge, isoWeekKey, normalizeZone, parseBodyComposition, parseGpx, parseWeightCsv, parseWeightMeasurement, trackStats, weekStartUtc, weeklyPoints } from '../src';
import type { WeekMetrics } from '../src';

const m = (o: Partial<WeekMetrics> = {}): WeekMetrics => ({ sessions: 0, activeDays: 0, activeMinutes: 0, runKm: 0, bikeKm: 0, mealDays: 0, recoveryDays: 0, ...o });

describe('weeks and challenges', () => {
  it('iso week keys and Monday starts', () => {
    expect(isoWeekKey(new Date('2026-10-25T12:00:00Z'))).toBe('2026-W43');
    expect(isoWeekKey(new Date('2026-10-26T00:00:00Z'))).toBe('2026-W44');
    expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(weekStartUtc(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });
  it('three deterministic, distinct challenges per week, anchored on 150 active minutes', () => {
    const a = challengesForWeek('2026-W43'), b = challengesForWeek('2026-W43');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a[0]!.id).toBe('move_150');
    expect(new Set(a.map((c) => c.metric)).size).toBe(3);
    const variety = new Set(Array.from({ length: 20 }, (_, i) => challengesForWeek(`2026-W${String(i + 1).padStart(2, '0')}`).map((c) => c.id).join()));
    expect(variety.size).toBeGreaterThan(4);
  });
  it('only proposes running/cycling challenges to people who do them', () => {
    for (let w = 1; w <= 52; w++) {
      const ids = challengesForWeek(`2026-W${String(w).padStart(2, '0')}`, { run: false, bike: false }).map((c) => c.metric);
      expect(ids).not.toContain('runKm'); expect(ids).not.toContain('bikeKm');
    }
  });
  it('evaluates progress', () => {
    const c = { id: 'run_10', metric: 'runKm' as const, target: 10, points: 25 };
    expect(evaluateChallenge(c, m({ runKm: 4 }))).toEqual({ value: 4, pct: 40, done: false });
    expect(evaluateChallenge(c, m({ runKm: 25 })).pct).toBe(100);
  });
  it('points reward consistency, are capped, and more volume never earns more', () => {
    const ch = challengesForWeek('2026-W43');
    const balanced = weeklyPoints(m({ activeDays: 5, sessions: 4, activeMinutes: 200, mealDays: 5, recoveryDays: 5, runKm: 12 }), ch);
    const extreme = weeklyPoints(m({ activeDays: 7, sessions: 14, activeMinutes: 1500, mealDays: 7, recoveryDays: 7, runKm: 150, bikeKm: 500 }), ch);
    expect(extreme).toBe(balanced);
    expect(extreme).toBeLessThanOrEqual(150);
    expect(weeklyPoints(m(), ch)).toBe(0);
  });
  it('normalises zones', () => { expect(normalizeZone('  Villa  Crespo, CABA! ')).toBe('villa crespo caba'); expect(normalizeZone('São Paulo')).toBe('sao paulo'); });
});

describe('device parsers', () => {
  const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
  it('parses a BLE weight measurement (SI): 72.35 kg', () => {
    const raw = Math.round(72.35 / 0.005); // 14470
    expect(parseWeightMeasurement(dv([0x00, raw & 255, raw >> 8]))?.weightKg).toBe(72.35);
  });
  it('parses imperial units and a timestamp', () => {
    const raw = Math.round(160 / 0.01); // 160 lb
    const r = parseWeightMeasurement(dv([0x03, raw & 255, raw >> 8, 0xea, 0x07, 10, 25, 8, 30, 15]));
    expect(r?.weightKg).toBeCloseTo(72.57, 1);
    expect(r?.at).toBe('2026-10-25T08:30:15.000Z');
  });
  it('rejects unsuccessful or absurd readings', () => {
    expect(parseWeightMeasurement(dv([0, 0xff, 0xff]))).toBeNull();
    expect(parseWeightMeasurement(dv([0, 0, 0]))).toBeNull();
    expect(parseWeightMeasurement(dv([0]))).toBeNull();
  });
  it('parses body fat from body-composition', () => {
    expect(parseBodyComposition(dv([0, 0, 0xe6, 0x00]))?.bodyFatPct).toBe(23);
    expect(parseBodyComposition(dv([0, 0, 0, 0]))).toBeNull();
  });
  it('reads GPX tracks and feeds the GPS stats', () => {
    const pts = Array.from({ length: 5 }, (_, i) => `<trkpt lat="${-34.6 + i * 0.0001}" lon="-58.4"><ele>${20 + i}</ele><time>2026-10-25T10:00:0${i}Z</time></trkpt>`).join('');
    const parsed = parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk><wpt lat="1" lon="1"/></gpx>`);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toMatchObject({ alt: 20 });
    expect(trackStats(parsed).distanceM).toBeGreaterThan(40);
    expect(parseGpx('<gpx><trkpt lat="x" lon="y"><time>2026-10-25T10:00:00Z</time></trkpt></gpx>')).toEqual([]);
  });
  it('imports weights from CSV in several styles', () => {
    expect(parseWeightCsv('date,weight\n2026-10-01,80.5\n2026-10-02;79,8\n2026-10-03\t79.2 kg\nbad,line\n2026-10-04,3')).toEqual([
      { day: '2026-10-01', weightKg: 80.5 }, { day: '2026-10-02', weightKg: 79.8 }, { day: '2026-10-03', weightKg: 79.2 }]);
  });
});
