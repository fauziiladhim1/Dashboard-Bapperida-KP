import { geojsonToWKT, wktToGeoJSON } from '@terraformer/wkt';
import { finishProblem, type Pt } from './draw';
import type { Layer } from './types';

/** Tipe GeoJSON yang diterima per tipe dasar layer (server menyimpan sebagai Multi*). */
const ACCEPTS: Record<Layer['geomType'], GeoJSON.Geometry['type'][]> = {
  Point: ['Point', 'MultiPoint'],
  LineString: ['LineString', 'MultiLineString'],
  Polygon: ['Polygon', 'MultiPolygon'],
};

/** `from` terisi bila teks bukan WKT/GeoJSON (DD, DMS, UTM): editor menulis ulang teks sebagai WKT. */
export type GeomResult = { ok: true; geometry: GeoJSON.Geometry; from?: string } | { ok: false; reason: 'empty' | 'syntax' | 'type' | 'range' | 'topology' };

/** Satu komponen DMS: 6°35'42"S, 6° 35.7' LS, -6°35'42" (tanpa huruf arah: urutan lintang lalu bujur). */
const DMS = /(-)?(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|'')\s*)?([NSEW])?/g;

/** Derajat Menit Detik -> [bujur, lintang]; null bila bukan DMS dua komponen yang sah. */
export function parseDms(text: string): [number, number] | null {
  if (!text.includes('°')) return null;
  // Singkatan Indonesia: LS/LU = lintang selatan/utara, BT/BB = bujur timur/barat.
  const u = text.toUpperCase().replace(/LS\b/g, 'S').replace(/LU\b/g, 'N').replace(/BT\b/g, 'E').replace(/BB\b/g, 'W');
  const parts = [...u.matchAll(DMS)];
  if (parts.length !== 2 || u.replace(DMS, '').replace(/[\s,;]/g, '')) return null;
  const hemis = parts.map((p) => p[5]);
  if (hemis.filter(Boolean).length === 1) return null;
  let lat: number | undefined, lng: number | undefined;
  for (const [i, [, neg, d, m = '0', s = '0', h]] of parts.entries()) {
    if (Number(m) >= 60 || Number(s) >= 60 || (neg && h)) return null;
    const v = (Number(d) + Number(m) / 60 + Number(s) / 3600) * (neg || h === 'S' || h === 'W' ? -1 : 1);
    if (h ? h === 'N' || h === 'S' : i === 0) lat = v;
    else lng = v;
  }
  return lat === undefined || lng === undefined ? null : [lng, lat];
}

/** UTM: "[zona+huruf] timur utara", mis. "49S 407398 9131086" atau "407398, 9131086". */
const UTM = /^(?:(\d{1,2})\s*([C-HJ-NP-X])\s+)?(\d{6}(?:\.\d+)?)\s*(?:mE)?\s*[,\s]\s*(\d{6,7}(?:\.\d+)?)\s*(?:mN)?$/i;
// ponytail: tanpa zona dianggap zona 49S (wilayah kerja, bujur 108-114). Data dari zona lain wajib menulis zonanya.
const DEFAULT_UTM_ZONE = { zone: 49, south: true };

/** UTM WGS84 -> [bujur, lintang] (deret invers Snyder, galat << 1 m di dalam zona). */
export function utmToLngLat(zone: number, south: boolean, easting: number, northing: number): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = easting - 500000, y = south ? northing - 10000000 : northing;
  const mu = y / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const p1 = mu + (1.5 * e1 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(p1), cos = Math.cos(p1), T = Math.tan(p1) ** 2, C = ep2 * cos ** 2;
  const N = a / Math.sqrt(1 - e2 * sin ** 2), R = (a * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5, D = x / (N * k0);
  const lat = p1 - ((N * Math.tan(p1)) / R) * (D ** 2 / 2 - ((5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * ep2 - 3 * C ** 2) * D ** 6) / 720);
  const lng = (D - ((1 + 2 * T + C) * D ** 3) / 6 + ((5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * ep2 + 24 * T ** 2) * D ** 5) / 120) / cos;
  return [zone * 6 - 183 + (lng * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Teks titik non-WKT (UTM, DMS, DD "lat, lng") -> posisi + label format; null bila tak dikenali. */
function parsePointText(s: string): { p: [number, number]; from: string } | null {
  const utm = UTM.exec(s);
  if (utm) {
    const zone = utm[1] ? Number(utm[1]) : DEFAULT_UTM_ZONE.zone;
    // Huruf: S = selatan (kebiasaan "49S"); selain itu huruf pita lintang, C-M di belahan selatan.
    const south = utm[2] ? /[C-MS]/i.test(utm[2]) : DEFAULT_UTM_ZONE.south;
    const e = Number(utm[3]), n = Number(utm[4]);
    if (zone < 1 || zone > 60 || e < 100000 || e > 900000) return null; // utara maks 7 digit (< 10 juta) dijaga regex
    return { p: utmToLngLat(zone, south, e, n), from: `UTM ${zone}${south ? 'S' : 'N'}` };
  }
  const dms = parseDms(s);
  if (dms) return { p: dms, from: 'DMS' };
  // Pasangan "lat, lng" (format salinan aplikasi peta/GPS) -> POINT (lng lat).
  const pair = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  return pair ? { p: [Number(pair[2]), Number(pair[1])], from: 'DD' } : null;
}

/** Semua posisi [lng, lat] dari array koordinat bersarang berapa pun dalamnya. */
export const positions = (c: unknown): number[][] =>
  !Array.isArray(c) ? [] : typeof c[0] === 'number' ? [c as number[]] : c.flatMap(positions);

/**
 * Teks geometri dari editor: WKT (utama, via Terraformer) atau GeoJSON (diawali `{`: Geometry/Feature).
 * Divalidasi: sintaks, tipe sesuai layer, dan koordinat WGS84 (lng -180..180, lat -90..90).
 */
export function parseGeometryText(text: string, geomType: Layer['geomType']): GeomResult {
  const s = text.trim();
  if (!s) return { ok: false, reason: 'empty' };
  let g: GeoJSON.Geometry;
  // Layer titik juga menerima UTM, DMS, dan DD "lat, lng"; dikonversi ke WGS84 sebelum validasi di bawah.
  const pt = geomType === 'Point' ? parsePointText(s) : null;
  try {
    if (pt) g = { type: 'Point', coordinates: pt.p };
    else if (s.startsWith('{')) {
      const j = JSON.parse(s) as GeoJSON.Geometry | GeoJSON.Feature;
      g = j.type === 'Feature' ? j.geometry : j;
    } else g = wktToGeoJSON(s);
  } catch {
    return { ok: false, reason: 'syntax' };
  }
  if (!g || !('type' in g)) return { ok: false, reason: 'syntax' };
  if (!ACCEPTS[geomType].includes(g.type)) return { ok: false, reason: 'type' };
  const pts = 'coordinates' in g ? positions(g.coordinates) : [];
  if (!pts.length || pts.some((p) => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return { ok: false, reason: 'syntax' };
  if (pts.some(([lng = 0, lat = 0]) => lng < -180 || lng > 180 || lat < -90 || lat > 90)) return { ok: false, reason: 'range' };
  // Topologi area: tiap cincin minimal 3 titik berbeda, tidak segaris, tidak memotong dirinya. Garis boleh berpotongan
  // (jalan melingkar sah); geometri tersimpan yang tidak diubah tidak divalidasi ulang saat simpan.
  const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
  for (const ring of rings as Pt[][]) {
    const open = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    if (open.length < 3 || finishProblem(open, 'Polygon')) return { ok: false, reason: 'topology' };
  }
  return pt ? { ok: true, geometry: g, from: pt.from } : { ok: true, geometry: g };
}

/** Geometri tersimpan -> WKT untuk editor. MultiPoint satu titik (cara server menyimpan titik) ditulis sebagai POINT. */
export const toWkt = (g: GeoJSON.Geometry): string =>
  geojsonToWKT(g.type === 'MultiPoint' && g.coordinates.length === 1 ? { type: 'Point', coordinates: g.coordinates[0]! } : g);

/** Contoh WKT per tipe layer untuk placeholder editor. */
export const WKT_EXAMPLE: Record<Layer['geomType'], string> = {
  Point: 'POINT (110.16 -7.86)',
  LineString: 'LINESTRING (110.12 -7.85, 110.18 -7.85)',
  Polygon: 'POLYGON ((110.1 -7.9, 110.2 -7.9, 110.2 -7.8, 110.1 -7.8, 110.1 -7.9))',
};
