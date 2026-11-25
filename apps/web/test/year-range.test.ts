import { describe, expect, it } from 'vitest';
import { groupRows } from '@/lib/layer-style';
import { growth, isTimed, latestVersions, pickYear, yearGaps, yearOptions } from '@/lib/year-range';

const L = (name: string, year: number | null) => ({ name, year });

describe('latestVersions', () => {
  const layers = [L('Batas Administrasi', 2024), L('Kondisi Jalan 2025', 2025), L('Kondisi Jalan 2026', 2026), L('Potensi Bencana', null)];
  it('memilih versi terakhir <= tahun, layer tanpa tahun selalu ikut', () => {
    expect(latestVersions(layers, 2025).map((l) => l.name)).toEqual(['Batas Administrasi', 'Kondisi Jalan 2025', 'Potensi Bencana']);
    expect(latestVersions(layers, 2026).map((l) => l.name)).toEqual(['Batas Administrasi', 'Kondisi Jalan 2026', 'Potensi Bencana']);
    expect(latestVersions(layers, 2023).map((l) => l.name)).toEqual(['Potensi Bencana']);
  });
  it('membuang versi sebelum awal rentang; tanpa tahun mengembalikan semua', () => {
    expect(latestVersions(layers, 2026, 2025).map((l) => l.name)).toEqual(['Kondisi Jalan 2026', 'Potensi Bencana']);
    expect(latestVersions(layers, undefined)).toBe(layers);
  });
  it('versi 0 fitur tidak menggantikan versi lama yang berisi', () => {
    const v = [{ name: 'Jalan 2025', year: 2025, featureCount: 5 }, { name: 'Jalan 2026', year: 2026, featureCount: 0 }];
    expect(latestVersions(v, 2026).map((l) => l.name)).toEqual(['Jalan 2025']);
  });
});

describe('yearGaps', () => {
  const layers = [L('Kesehatan 2024', 2024), L('Jalan 2026', 2026), L('Batas', null)];
  it('melaporkan seri yang memakai versi lama dan seri tanpa data; layer statis diabaikan', () => {
    expect(yearGaps(layers, 2026)).toEqual([{ name: 'Kesehatan', year: 2024 }]);
    expect(yearGaps(layers, 2024)).toEqual([{ name: 'Jalan' }]);
    expect(yearGaps(layers, 2025)).toEqual([{ name: 'Kesehatan', year: 2024 }, { name: 'Jalan' }]);
    expect(yearGaps(layers, undefined)).toEqual([]);
  });
});

describe('groupRows', () => {
  it('mengelompokkan sesuai style.groups, sisanya ke Lainnya', () => {
    const style = { color: '#000000', groups: { Air: ['Sungai'], Tani: ['Sawah'] } };
    const rows = [{ key: 'Sawah' }, { key: 'Sungai' }, { key: null }];
    expect(groupRows(style, rows, (r) => r.key)).toEqual([
      { group: 'Air', rows: [{ key: 'Sungai' }] }, { group: 'Tani', rows: [{ key: 'Sawah' }] }, { group: 'Lainnya', rows: [{ key: null }] },
    ]);
    expect(groupRows({ color: '#000000' }, rows, (r) => r.key)).toEqual([{ group: null, rows }]);
  });
});

describe('growth', () => {
  it('memakai tahun berdata pertama & terakhir, melewati null; pct null bila awal 0; < 2 titik = null', () => {
    expect(growth([{ tahun: 2026, v: 120 }, { tahun: 2024, v: 100 }, { tahun: 2025, v: null }])).toEqual({ fromYear: 2024, toYear: 2026, from: 100, to: 120, diff: 20, pct: 20 });
    expect(growth([{ tahun: 2024, v: 0 }, { tahun: 2025, v: 5 }])?.pct).toBeNull();
    expect(growth([{ tahun: 2024, v: 5 }, { tahun: 2025, v: null }])).toBeNull();
  });
});

describe('layer multi-tahun (atribut tahun)', () => {
  it('isTimed: statis + field tahun; pickYear: terakhir <= terpilih', () => {
    expect(isTimed({ year: null, fields: [{ key: 'tahun' }] })).toBe(true);
    expect(isTimed({ year: 2026, fields: [{ key: 'tahun' }] })).toBe(false);
    expect(isTimed({ year: null, fields: [{ key: 'nama' }] })).toBe(false);
    expect(pickYear([2024, 2025, 2026], 2025)).toBe(2025);
    expect(pickYear([2024, 2026], 2025)).toBe(2024);
    expect(pickYear([2026, NaN], 2025)).toBeUndefined();
    expect(pickYear([2024], undefined)).toBeUndefined();
  });
});

describe('yearOptions', () => {
  it('tahun 2000 s.d. tahun berjalan, melebar bila data lebih lama atau lebih baru', () => {
    expect(yearOptions([2024, 2026], 2026)).toEqual(Array.from({ length: 27 }, (_, i) => 2000 + i));
    expect(yearOptions([1998, 2030], 2026).slice(0, 2)).toEqual([1998, 1999]);
    expect(yearOptions([1998, 2030], 2026).at(-1)).toBe(2030);
    expect(yearOptions([], 2026).at(-1)).toBe(2026);
  });
});
