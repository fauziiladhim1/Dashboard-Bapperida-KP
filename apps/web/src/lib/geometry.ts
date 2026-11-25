import { geojsonToWKT, wktToGeoJSON } from '@terraformer/wkt';
import type { Layer } from './types';

/** Tipe GeoJSON yang diterima per tipe dasar layer (server menyimpan sebagai Multi*). */
const ACCEPTS: Record<Layer['geomType'], GeoJSON.Geometry['type'][]> = {
  Point: ['Point', 'MultiPoint'],
  LineString: ['LineString', 'MultiLineString'],
  Polygon: ['Polygon', 'MultiPolygon'],
};

export type GeomResult = { ok: true; geometry: GeoJSON.Geometry } | { ok: false; reason: 'empty' | 'syntax' | 'type' | 'range' };

/** Semua posisi [lng, lat] dari array koordinat bersarang berapa pun dalamnya. */
const positions = (c: unknown): number[][] =>
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
