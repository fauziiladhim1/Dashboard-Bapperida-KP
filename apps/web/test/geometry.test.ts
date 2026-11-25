import { describe, expect, it } from 'vitest';
import { parseGeometryText, toWkt } from '@/lib/geometry';

describe('parseGeometryText / toWkt (Terraformer WKT)', () => {
  it('WKT -> GeoJSON -> WKT pulang-pergi', () => {
    const r = parseGeometryText('LINESTRING (110.12 -7.85, 110.18 -7.85)', 'LineString');
    expect(r).toEqual({ ok: true, geometry: { type: 'LineString', coordinates: [[110.12, -7.85], [110.18, -7.85]] } });
    expect(parseGeometryText(toWkt((r as { geometry: GeoJSON.Geometry }).geometry), 'LineString')).toEqual(r);
  });
  it('GeoJSON (Geometry/Feature) tetap diterima; MultiPoint satu titik ditulis sebagai POINT', () => {
    expect(parseGeometryText('{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[110.1,-7.8]}}', 'Point').ok).toBe(true);
    expect(toWkt({ type: 'MultiPoint', coordinates: [[110.1, -7.8]] })).toMatch(/^POINT/);
  });
  it('layer titik menerima pasangan "lat, lng" salinan aplikasi peta/GPS', () => {
    const p = { ok: true, geometry: { type: 'Point', coordinates: [110.11183, -7.74458] } };
    expect(parseGeometryText('-7.74458, 110.11183', 'Point')).toEqual(p);
    expect(parseGeometryText(' -7.74458 110.11183 ', 'Point')).toEqual(p);
    expect(parseGeometryText('-7.74458, 110.11183', 'Polygon')).toEqual({ ok: false, reason: 'syntax' });
    expect(parseGeometryText('-97.7, 110.1', 'Point')).toEqual({ ok: false, reason: 'range' });
  });
  it('menolak teks kosong, sintaks rusak, tipe tak sesuai layer, dan koordinat di luar WGS84', () => {
    expect(parseGeometryText('  ', 'Point')).toEqual({ ok: false, reason: 'empty' });
    expect(parseGeometryText('LINESTRING (110 -7', 'LineString')).toEqual({ ok: false, reason: 'syntax' });
    expect(parseGeometryText('POINT (110 -7)', 'Polygon')).toEqual({ ok: false, reason: 'type' });
    expect(parseGeometryText('POINT (430000 9130000)', 'Point')).toEqual({ ok: false, reason: 'range' });
  });
});

describe('parseGeometryText: GeoJSON tak lazim', () => {
  it('Geometry polos diterima; objek tanpa type, koordinat hilang/pendek/bukan array ditolak sebagai sintaks', () => {
    expect(parseGeometryText('{"type":"Point","coordinates":[110.1,-7.8]}', 'Point').ok).toBe(true);
    for (const s of ['{}', '{"type":"Point"}', '{"type":"Point","coordinates":[110]}', '{"type":"Point","coordinates":"x"}'])
      expect(parseGeometryText(s, 'Point')).toEqual({ ok: false, reason: 'syntax' });
  });
});

describe('parseGeometryText: topologi area', () => {
  it('cincin berpotongan, segaris, atau kurang dari 3 titik ditolak; garis berpotongan tetap boleh', () => {
    const bad = (w: string) => expect(parseGeometryText(w, 'Polygon')).toEqual({ ok: false, reason: 'topology' });
    bad('POLYGON ((0 0, 1 1, 1 0, 0 1, 0 0))');
    bad('POLYGON ((0 0, 1 0, 2 0, 0 0))');
    bad('POLYGON ((0 0, 1 0, 0 0))');
    bad('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 1, 0 0)), ((5 5, 6 6, 6 5, 5 6, 5 5)))');
    expect(parseGeometryText('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1]]]}', 'Polygon').ok).toBe(true); // cincin tanpa penutup
    expect(parseGeometryText('{"type":"Polygon","coordinates":[[[0,0]]]}', 'Polygon')).toEqual({ ok: false, reason: 'topology' });
    expect(parseGeometryText('LINESTRING (0 0, 1 1, 1 0, 0 1)', 'LineString').ok).toBe(true);
  });
});

