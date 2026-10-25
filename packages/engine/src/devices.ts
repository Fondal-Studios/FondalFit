/** Parsers for data coming from outside devices. Pure functions (testable without hardware). */

export interface ScaleReading { weightKg: number; bodyFatPct?: number; at?: string }

/**
 * Bluetooth GATT "Weight Measurement" (0x2A9D) as defined by the Bluetooth SIG Weight Scale Service:
 * flags(u8): bit0 imperial units, bit1 timestamp present, bit2 user id present, bit3 BMI+height present; weight u16 LE
 * with resolution 0.005 kg (SI) or 0.01 lb (imperial).
 */
export function parseWeightMeasurement(buf: DataView): ScaleReading | null {
  if (buf.byteLength < 3) return null;
  const flags = buf.getUint8(0);
  const raw = buf.getUint16(1, true);
  if (raw === 0xffff) return null; // "measurement unsuccessful"
  const imperial = (flags & 1) === 1;
  const weightKg = imperial ? raw * 0.01 * 0.45359237 : raw * 0.005;
  let at: string | undefined;
  if (flags & 2 && buf.byteLength >= 10) {
    const y = buf.getUint16(3, true), mo = buf.getUint8(5), d = buf.getUint8(6), h = buf.getUint8(7), mi = buf.getUint8(8), s = buf.getUint8(9);
    if (y > 2000 && mo >= 1 && mo <= 12) at = new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString();
  }
  const r = Math.round(weightKg * 100) / 100;
  return r >= 20 && r <= 400 ? { weightKg: r, at } : null;
}

/**
 * "Body Composition Measurement" (0x2A9C): flags(u16): bit0 imperial; body fat % u16 LE at resolution 0.1 %.
 * Many consumer scales report impedance-based estimates: treat as a trend, not a clinical value.
 */
export function parseBodyComposition(buf: DataView): { bodyFatPct: number } | null {
  if (buf.byteLength < 4) return null;
  const pct = buf.getUint16(2, true) * 0.1;
  return pct >= 2 && pct <= 70 ? { bodyFatPct: Math.round(pct * 10) / 10 } : null;
}

export interface GpxPoint { lat: number; lon: number; t: number; alt?: number }
const attr = (s: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(s)?.[1];

/** Minimal GPX track reader (Strava/Garmin/Apple exports). Ignores waypoints; returns points in file order. */
export function parseGpx(xml: string): GpxPoint[] {
  const out: GpxPoint[] = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = Number(attr(m[1]!, 'lat')), lon = Number(attr(m[1]!, 'lon'));
    const time = /<time>([^<]+)<\/time>/.exec(m[2]!)?.[1];
    const ele = /<ele>([^<]+)<\/ele>/.exec(m[2]!)?.[1];
    const t = time ? Date.parse(time) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(t) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon, t, alt: ele !== undefined && Number.isFinite(Number(ele)) ? Number(ele) : undefined });
  }
  return out;
}

export interface CsvWeight { day: string; weightKg: number }
/** Import weights from a CSV (`date,weight`), tolerating `;` or `,` and decimal commas. */
export function parseWeightCsv(text: string): CsvWeight[] {
  const out: CsvWeight[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{4}-\d{2}-\d{2})\s*[;,\t]\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:kg)?\s*$/i.exec(line);
    if (!m) continue;
    const w = Number(m[2]!.replace(',', '.'));
    if (w >= 20 && w <= 400) out.push({ day: m[1]!, weightKg: w });
  }
  return out;
}
