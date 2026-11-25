import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { endpoints } from './api';

/** Salin params lalu terapkan patch; `null`/`undefined` menghapus kunci. */
export const patchParams = (params: URLSearchParams, patch: Record<string, string | number | null | undefined>): URLSearchParams => {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  return next;
};

type Versioned = { name: string; year: number | null; featureCount?: number };
export const seriOf = (l: Versioned) => l.name.replace(/\s*\d{4}$/, '');
/** Versi kosong (0 fitur) belum berisi data: tidak menggantikan versi lama yang berisi. */
const hasData = (l: Versioned) => l.featureCount === undefined || l.featureCount > 0;

/**
 * Satu versi per seri layer bertahun: versi terakhir berisi data dengan tahun <= `tahun` (dan >= `dari` bila diisi).
 * Layer tanpa tahun (statis, mis. SHP Audit 2024) selalu ikut. `tahun` kosong = semua layer.
 */
export const latestVersions = <L extends Versioned>(layers: L[], tahun: number | undefined, dari?: number): L[] => {
  if (tahun === undefined) return layers;
  const best = new Map<string, number>();
  for (const l of layers) {
    if (l.year === null || l.year > tahun || (dari !== undefined && l.year < dari) || !hasData(l)) continue;
    best.set(seriOf(l), Math.max(best.get(seriOf(l)) ?? -Infinity, l.year));
  }
  return layers.filter((l) => l.year === null || best.get(seriOf(l)) === l.year);
};

/** Celah data per seri bertahun pada `tahun`: `year` = versi lama yang dipakai; tanpa `year` = belum ada data sama sekali. */
export type YearGap = { name: string; year?: number };
/**
 * Layer berdata multi-tahun dalam satu layer (atribut `tahun`, mis. penduduk miskin): peta menampilkan satu tahun saja,
 * mengikuti pemilih tahun global, bukan satu layer per tahun.
 */
export const isTimed = (l: { year: number | null; fields: { key: string }[] }) => l.year === null && l.fields.some((f) => f.key === 'tahun');

/** Tahun data terakhir yang <= tahun terpilih (fallback seperti versi layer); undefined bila belum ada. */
export const pickYear = (years: number[], tahun: number | undefined) =>
  tahun === undefined ? undefined : years.filter((y) => Number.isFinite(y) && y <= tahun).sort((a, b) => b - a)[0];

export const yearGaps = (layers: Versioned[], tahun: number | undefined): YearGap[] => {
  if (tahun === undefined) return [];
  const shown = new Map(latestVersions(layers, tahun).filter((l) => l.year !== null).map((l) => [seriOf(l), l.year!]));
  const series = [...new Set(layers.filter((l) => l.year !== null).map(seriOf))];
  return series.flatMap((name) => {
    const y = shown.get(name);
    return y === tahun ? [] : [y === undefined ? { name } : { name, year: y }];
  });
};

/** Tahun berdata: tahun pada deret waktu Ringkasan + tahun layer bertahun, urut naik. */
const useDataYears = (): number[] => {
  const series = useQuery({ queryKey: ['timeseries', undefined], queryFn: () => endpoints.timeseries() });
  const layers = useQuery({ queryKey: ['layers'], queryFn: endpoints.layers });
  return useMemo(() => {
    const ys = new Set<number>([...(series.data ?? []).map((p) => p.tahun), ...(layers.data ?? []).flatMap((l) => (l.year ? [l.year] : []))]);
    return [...ys].sort((a, b) => a - b);
  }, [series.data, layers.data]);
};

/** Tahun pertama yang bisa dipilih walau belum berdata (panel menampilkan "belum ada data"). */
export const FIRST_YEAR = 2000;
/** Pilihan tahun: FIRST_YEAR s.d. tahun berjalan (atau tahun data terakhir bila lebih baru), urut naik. */
export const yearOptions = (data: number[], now = new Date().getFullYear()) => {
  const [from, to] = [Math.min(FIRST_YEAR, data[0] ?? FIRST_YEAR), Math.max(now, data.at(-1) ?? now)];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};

/** Sumber tunggal daftar tahun: `years` = semua pilihan, `data` = tahun yang benar-benar berdata. */
export const useYears = () => {
  const data = useDataYears();
  return useMemo(() => ({ years: yearOptions(data), data }), [data]);
};

/** Tahun global (peta, legenda, statistik): `?tahun=` di URL agar sama di Ringkasan dan Peta; default tahun terbaru. */
export const useYear = () => {
  const { years, data } = useYears();
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('tahun'));
  // Tahun apa pun dalam pilihan boleh (tanpa data = panel "belum ada data"); default = tahun data terakhir.
  const tahun = years.includes(raw) ? raw : data.at(-1);
  const set = useCallback((y: number) => setParams((p) => patchParams(p, { tahun: y }), { replace: true }), [setParams]);
  return { years, tahun, set };
};

/** Rentang khusus grafik tren: state lokal (bukan URL), default rentang tahun berdata; tidak memengaruhi panel lain. */
export const useYearRange = () => {
  const { years, data } = useYears();
  const [picked, setPicked] = useState<{ dari?: number; sampai?: number }>({});
  const dari = picked.dari !== undefined && years.includes(picked.dari) ? picked.dari : data[0];
  const sampai = picked.sampai !== undefined && years.includes(picked.sampai) ? picked.sampai : data.at(-1);
  const set = useCallback((r: { dari: number; sampai: number }) => setPicked(r), []);
  const reset = useCallback(() => setPicked({}), []);
  const inRange = (y: number) => dari !== undefined && sampai !== undefined && y >= dari && y <= sampai;
  return { years, dari, sampai, set, reset, inRange, isFull: dari === data[0] && sampai === data.at(-1) };
};

/** Pertumbuhan antara tahun berdata pertama dan terakhir; `null`/non-angka dilewati. `pct` null bila nilai awal 0. */
export type Growth = { fromYear: number; toYear: number; from: number; to: number; diff: number; pct: number | null };
export const growth = (points: { tahun: number; v: number | null | undefined }[]): Growth | null => {
  const ok = points.filter((p): p is { tahun: number; v: number } => p.v != null && Number.isFinite(p.v)).sort((a, b) => a.tahun - b.tahun);
  if (ok.length < 2) return null;
  const a = ok[0]!, b = ok.at(-1)!;
  return { fromYear: a.tahun, toYear: b.tahun, from: a.v, to: b.v, diff: b.v - a.v, pct: a.v ? ((b.v - a.v) / a.v) * 100 : null };
};
