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
    const p = { ok: true, geometry: { type: 'Point', coordinates: [110.11183, -7.74458] }, from: 'DD' };
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

describe('parseGeometryText: DMS & UTM (layer titik)', () => {
  const at = (s: string) => {
    const r = parseGeometryText(s, 'Point');
    return r.ok ? { c: (r.geometry as GeoJSON.Point).coordinates, from: r.from } : r;
  };
  it('DMS: huruf arah N/S/E/W, LS/BT, tanda minus, menit desimal', () => {
    const near = (s: string, lng: number, lat: number) => {
      const r = at(s) as { c: number[]; from: string };
      expect(r.from).toBe('DMS');
      expect(r.c[0]).toBeCloseTo(lng, 4);
      expect(r.c[1]).toBeCloseTo(lat, 4);
    };
    near(`6°35'42"S 106°48'59"E`, 106.81639, -6.595);
    near(`6° 35' 42" LS, 106° 48' 59" BT`, 106.81639, -6.595);
    near(`106°48'59"E 6°35'42"S`, 106.81639, -6.595); // urutan dibalik, huruf arah menentukan
    near(`-7°51'36" 110°9'36"`, 110.16, -7.86);
    near(`7°51.6'S 110°9.6'E`, 110.16, -7.86);
    expect(at(`6°35'72"S 106°48'59"E`)).toEqual({ ok: false, reason: 'syntax' }); // detik >= 60
    expect(at(`6°35'42"S 106°48'59"`)).toEqual({ ok: false, reason: 'syntax' }); // arah hanya satu sisi
  });
  it('UTM: dengan/tanpa zona (default 49S), cocok dengan proj4 < 1e-6°', () => {
    // Acuan: proj4 EPSG:4326 -> +proj=utm +zone=49|48 +south.
    for (const [s, lng, lat, from] of [
      ['49S 407398.1629955964 9131086.47949448', 110.16, -7.86, 'UTM 49S'],
      ['407398.1629955964, 9131086.47949448', 110.16, -7.86, 'UTM 49S'],
      ['48M 700835.2335501651 9270645.308764225', 106.8165, -6.5951, 'UTM 48S'],
    ] as const) {
      const r = at(s) as { c: number[]; from: string };
      expect(r.from).toBe(from);
      expect(r.c[0]).toBeCloseTo(lng, 6);
      expect(r.c[1]).toBeCloseTo(lat, 6);
    }
    expect(at('49S 407398 9131086')).not.toHaveProperty('reason');
    expect(parseGeometryText('49S 407398 9131086', 'Polygon')).toEqual({ ok: false, reason: 'syntax' });
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

