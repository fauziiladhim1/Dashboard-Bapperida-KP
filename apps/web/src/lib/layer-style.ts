import type { ExpressionSpecification } from 'maplibre-gl';
import type { Layer, LayerStyle } from './types';

/** Atribut penentu warna: angka bertingkat (`steps.field`) atau kelas kategori (`classField`). */
/** Field skema yang aktif (bukan yang disembunyikan/"dihapus"): dipakai tabel, form, impor, builder KPI, popup. */
export const activeFields = (layer: Pick<Layer, 'fields'>) => layer.fields.filter((f) => !f.hidden);

export const colorField = (style: LayerStyle): string | undefined => style.steps?.field ?? style.classField;

/**
 * Warna per fitur sebagai ekspresi MapLibre: `step` untuk atribut angka bertingkat (mis. jumlah penduduk miskin),
 * `match` per kelas atribut; fallback ke warna dasar layer.
 */
export const colorExpression = (style: LayerStyle): string | ExpressionSpecification => {
  if (style.steps) {
    const [first, ...rest] = style.steps.stops;
    return ['step', ['to-number', ['get', style.steps.field], -1], first!.color, ...rest.flatMap((s) => [s.min, s.color])] as ExpressionSpecification;
  }
  const entries = Object.entries(style.classes ?? {});
  if (!style.classField || !entries.length) return style.color;
  return ['match', ['to-string', ['get', style.classField]], ...entries.flat(), style.color] as ExpressionSpecification;
};

/** Nama tampilan kelas: `style.labels` bila ada (mis. "KSPD 2" -> "KSPD 2 Menoreh Selatan"), selain itu kunci aslinya. */
export const classLabel = (style: LayerStyle, key: string) => style.labels?.[key] ?? key;

/** Item legenda statis; `key` = kunci kelas, atau indeks stop (sebagai teks) untuk layer bertingkat. */
export const legendOf = (style: LayerStyle): { key: string; label: string; color: string }[] => {
  if (style.steps) return style.steps.stops.map(({ label, color }, i) => ({ key: String(i), label, color }));
  const entries = Object.entries(style.classes ?? {});
  return entries.length
    ? entries.map(([key, color]) => ({ key, label: classLabel(style, key), color })).sort((a, b) => classOrder(style)(a, b))
    : [{ key: '', label: 'Fitur', color: style.color }];
};

/**
 * Urutan kelas legenda: kelas ordinal (kondisi jalan, kelas bahaya) mengikuti skala `style.ordinal`; selain itu abjad
 * dengan angka dibaca wajar (KPPD 1, KPPD 2, KSPD 1, …). Kunci jsonb dari DB tidak berurutan, jadi selalu diurutkan di sini.
 */
export const classOrder = (style: LayerStyle) => {
  const rank = style.ordinal ?? [];
  const at = (k: string | null) => (k && rank.includes(k) ? rank.indexOf(k) : rank.length);
  return (a: { key: string | null; label: string }, b: { key: string | null; label: string }) =>
    at(a.key) - at(b.key) || a.label.localeCompare(b.label, 'id', { numeric: true });
};

/**
 * Filter MapLibre yang menyembunyikan kelas yang dimatikan di legenda. Kategori: nilai `classField` di luar `hidden`
 * (fitur tanpa kelas tetap tampil kecuali "" dimatikan). Bertingkat: `hidden` berisi indeks stop, rentang [min_i, min_i+1) dibuang.
 * null = tak ada yang disembunyikan.
 */
export const classFilter = (style: LayerStyle, hidden: string[]): ExpressionSpecification | null => {
  if (!hidden.length) return null;
  if (style.steps) {
    const { field, stops } = style.steps;
    const v = ['to-number', ['get', field], -1];
    return ['all', ...hidden.map((h) => {
      const i = Number(h);
      const lo = ['>=', v, stops[i]!.min];
      return ['!', stops[i + 1] ? ['all', lo, ['<', v, stops[i + 1]!.min]] : lo];
    })] as ExpressionSpecification;
  }
  if (!style.classField) return null;
  return ['!', ['in', ['coalesce', ['to-string', ['get', style.classField]], ''], ['literal', hidden]]] as ExpressionSpecification;
};

/** Warna untuk nilai atribut `colorField`: stop terakhir yang `min`-nya terlampaui (bertingkat) atau warna kelas. */
export const colorOf = (style: LayerStyle, key: string | null): string => {
  if (style.steps) {
    const v = Number(key);
    if (key === null || key === '' || Number.isNaN(v)) return style.color;
    return style.steps.stops.findLast((s) => v >= s.min)?.color ?? style.steps.stops[0]!.color;
  }
  return (key && style.classes?.[key]) || style.color;
};

/** `tahun`: tahun global; ruas SK diberi kondisi survei terakhir <= tahun (layer lain mengabaikannya). */
export const tileUrl = (layer: Pick<Layer, 'slug' | 'updatedAt'>, kecamatan?: string, tahun?: number): string => {
  const params = new URLSearchParams({ v: String(Date.parse(layer.updatedAt)) });
  if (kecamatan) params.set('kecamatan', kecamatan);
  if (tahun !== undefined) params.set('tahun', String(tahun));
  return `${window.location.origin}/api/v1/tiles/${layer.slug}/{z}/{x}/{y}?${params}`;
};

export const KULON_PROGO_CENTER: [number, number] = [110.165, -7.83];

export type Grouped<R> = { group: string | null; rows: R[] };

/**
 * Baris berkelas dikelompokkan menurut `style.groups` (urutan grup mengikuti style, urutan baris dipertahankan);
 * kelas di luar grup masuk "Lainnya". Tanpa `groups`: satu kelompok tanpa judul.
 */
export const groupRows = <R,>(style: LayerStyle, rows: R[], keyOf: (r: R) => string | null): Grouped<R>[] => {
  if (!style.groups) return rows.length ? [{ group: null, rows }] : [];
  const of = (k: string | null) => Object.keys(style.groups!).find((g) => k !== null && style.groups![g]!.includes(k)) ?? 'Lainnya';
  const order = [...Object.keys(style.groups), 'Lainnya'];
  return order.map((group) => ({ group, rows: rows.filter((r) => of(keyOf(r)) === group) })).filter((g) => g.rows.length);
};
