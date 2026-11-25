import { geojsonToWKT, wktToGeoJSON } from '@terraformer/wkt';
import { finishProblem, type Pt } from './draw';
import type { Layer } from './types';

/** Tipe GeoJSON yang diterima per tipe dasar layer (server menyimpan sebagai Multi*). */
const ACCEPTS: Record<Layer['geomType'], GeoJSON.Geometry['type'][]> = {
  Point: ['Point', 'MultiPoint'],
  LineString: ['LineString', 'MultiLineString'],
  Polygon: ['Polygon', 'MultiPolygon'],
};

export type GeomResult = { ok: true; geometry: GeoJSON.Geometry } | { ok: false; reason: 'empty' | 'syntax' | 'type' | 'range' | 'topology' };

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
  // Pasangan "lat, lng" (format salinan aplikasi peta/GPS) untuk layer titik -> POINT (lng lat).
  const pair = geomType === 'Point' ? /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(s) : null;
  try {
    if (pair) g = { type: 'Point', coordinates: [Number(pair[2]), Number(pair[1])] };
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
  return { ok: true, geometry: g };
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
