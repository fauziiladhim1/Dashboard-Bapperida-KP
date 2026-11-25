import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowsExpand, ChartColumn, Copy, Hashtag, Pencil, Plus, Square, TrashBin } from '@gravity-ui/icons';
import { endpoints, refreshData } from '@/lib/api';
import { fmt } from '@/lib/format';
import { classLabel, colorOf } from '@/lib/layer-style';
import { confirmDanger, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { CustomKpi, KpiMeasure, Layer, StatRow } from '@/lib/types';
import { seriOf } from '@/lib/year-range';
import { ToolBtn } from './layout';
import { useStats } from './use-stats';
import { Kpi, LEGEND_BOX, LEGEND_TITLE, MiniDonut, pickChart, RankBars, Spark } from './widgets';

/** Nilai satu baris statistik sesuai ukuran KPI. */
const valueOf = (r: StatRow, k: CustomKpi) =>
  ({ count: r.count, length_km: r.lengthKm, area_ha: r.areaHa } as Record<string, number>)[k.measure] ?? r.value ?? 0;

/** Agregasi satu atribut angka (SUM/AVG/MIN/MAX), dikirim ke /stats sebagai `agg`. */
export const AGG = ['sum', 'avg', 'min', 'max'] as const;
export const isAgg = (m: string): m is (typeof AGG)[number] => (AGG as readonly string[]).includes(m);
/** Hanya ukuran yang bisa dijumlahkan antarkategori yang bermakna sebagai porsi (donut) atau total. */
export const additive = (m: string) => !['avg', 'min', 'max'].includes(m);

const UNIT: Record<KpiMeasure, string> = { count: '', length_km: 'km', area_ha: 'ha', sum: '', avg: '', min: '', max: '' };
/** Ikon kartu mengikuti ukuran KPI (jumlah, panjang, luas, agregasi atribut), bukan satu ikon untuk semua. */
const ICON = { count: Hashtag, length_km: ArrowsExpand, area_ha: Square, sum: ChartColumn, avg: ChartColumn, min: ChartColumn, max: ChartColumn } as const;

/**
 * Angka utama dari baris per kategori. SUM/jumlah/panjang/luas = dijumlah; MIN/MAX = min/max kategori.
 * AVG tidak bisa disusun dari rata-rata kategori (fitur tanpa nilai tak ikut dihitung SQL): diambil dari query tanpa rincian.
 */
const totalOf = (rows: StatRow[], k: CustomKpi) => {
  const v = rows.map((r) => valueOf(r, k));
  if (!v.length) return 0;
  if (k.measure === 'min') return Math.min(...v);
  if (k.measure === 'max') return Math.max(...v);
  return v.reduce((a, b) => a + b, 0);
};
/** Warna kategori bila rincian bukan field kelas layer (warna kelas tak berlaku): palet chart tema. */
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#c08a6b', '#8a9bb5', '#b5a26b'];

/**
 * Versi layer yang dipakai kartu: layer bertahun (mis. "PJU 2025") diganti versi seri yang sama pada tahun global,
 * sama seperti KPI bawaan; `undefined` = belum ada data di tahun itu.
 */
export const resolve = (k: CustomKpi, all: Layer[], current: Layer[]) => {
  const base = all.find((l) => l.slug === k.layerSlug);
  return base && current.find((l) => l.slug === base.slug || (base.year !== null && l.year !== null && seriOf(l) === seriOf(base)));
};

export function CustomKpiCard({ k, layer, kecamatan, tahun, to }: { k: CustomKpi; layer?: Layer; kecamatan?: string; tahun?: number; to: (slug: string) => string }) {
  const t = useT();
  const q = useStats(layer?.slug ?? k.layerSlug, kecamatan, !!layer, {
    // Rincian per tahun = deret waktu: tahun global tidak menyaringnya (akan tinggal satu titik).
    by: k.byField ?? undefined, sum: k.sumField ?? undefined, agg: isAgg(k.measure) && k.measure !== 'sum' ? k.measure : undefined, tahun: k.byField === 'tahun' ? undefined : tahun,
    ...(k.whereField && k.whereEq !== null && { where: k.whereField, eq: k.whereEq }),
  });
  // AVG: angka utama = avg SQL atas semua fitur (satu baris, nogroup), bukan rata-rata dari rata-rata kategori/kelas.
  const overall = useStats(layer?.slug ?? k.layerSlug, kecamatan, !!layer && k.measure === 'avg', {
    sum: k.sumField ?? undefined, agg: 'avg', nogroup: '1', tahun: k.byField === 'tahun' ? undefined : tahun,
    ...(k.whereField && k.whereEq !== null && { where: k.whereField, eq: k.whereEq }),
  });
  const rows = q.data ?? [];
  const total = k.measure === 'avg' ? (overall.data?.[0]?.value ?? 0) : totalOf(rows, k);
  const unit = k.unit ?? UNIT[k.measure];
  const format = (n: number) => `${fmt(Math.round(n * 100) / 100)}${unit ? ` ${unit}` : ''}`;
  const byClass = !!layer && k.byField === layer.style.classField;
  const parts = k.byField && layer
    ? rows.filter((r) => valueOf(r, k) > 0).map((r, i) => ({
      key: r.key ?? '', label: r.key ? classLabel(layer.style, r.key) : t('ov.noClass'), value: valueOf(r, k),
      color: byClass ? colorOf(layer.style, r.key) : PALETTE[i % PALETTE.length]!,
    }))
    : [];
  const byLabel = layer?.fields.find((f) => f.key === k.byField)?.label ?? k.byField ?? '';
  const picked = k.chart === 'auto' ? pickChart(parts.map((p) => p.key || null)) : k.chart;
  // Rata-rata/min/maks antarkategori bukan porsi dari total: donut diganti batang.
  const kind = picked === 'donut' && !additive(k.measure) ? 'bar' : picked;
  const byLabelKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, 'id', { numeric: true });
  const sorted = [...parts].sort(k.sort === 'label' ? byLabelKey : k.sort === 'asc' ? (a, b) => a.value - b.value : (a, b) => b.value - a.value)
    .slice(0, k.topN ?? (kind === 'bar' ? 6 : undefined));
  // Deret berurutan (mis. per tahun): angka utama = titik terakhir s.d. tahun global, bukan jumlah semua tahun.
  const series = [...parts].sort(byLabelKey);
  const upTo = series.filter((p) => tahun === undefined || !/^\d{4}$/.test(p.key) || Number(p.key) <= tahun);
  const figure = kind === 'line' && upTo.length ? upTo.at(-1)!.value : total;
  const whereLabel = layer?.fields.find((f) => f.key === k.whereField)?.label ?? k.whereField;
  const chart = !parts.length || kind === 'number' ? null
    : kind === 'line' ? <Spark className="mt-2 h-20" labels={(n) => format(n)}
      points={series.map((p) => ({ label: p.label, value: p.value }))} />
    : kind === 'donut' ? <MiniDonut title={t('kpi.compBy', { by: byLabel })} items={sorted} total={total} format={format} />
    : (
      <div className={LEGEND_BOX}>
        <p className={LEGEND_TITLE}>{t(k.sort === 'asc' ? 'kpi.bottom' : k.sort === 'label' ? 'kpi.per' : 'kpi.top', { by: byLabel })}</p>
        <RankBars items={sorted} format={format} highlight={sorted[0]?.key} />
      </div>
    );
  return (
    <Kpi tone={k.warn ? 'bad' : undefined} icon={ICON[k.measure]} label={k.label} value={q.data ? figure : null} format={format}
      loading={q.loading} to={layer ? to(layer.slug) : undefined}
      // Tanpa versi layer di tahun global: kartu "belum ada data" (layer dihapus = KPI ikut terhapus, FK cascade).
      sub={layer && [kind === 'line' && upTo.length ? `${layer.name}, ${upTo.at(-1)!.label}` : layer.name, k.whereField && `${whereLabel}: ${k.whereEq}`].filter(Boolean).join(', ')}>
      {chart}
    </Kpi>
  );
}

/** Kartu KPI kustom di grid Ringkasan (versi layer mengikuti tahun global). */
export function KpiTile({ k, all, layers, kecamatan, tahun, to }: {
  k: CustomKpi; all: Layer[]; layers: Layer[]; kecamatan?: string; tahun?: number; to: (slug: string) => string;
}) {
  return <CustomKpiCard k={k} layer={resolve(k, all, layers)} kecamatan={kecamatan} tahun={tahun} to={to} />;
}

/**
 * Aksi KPI (ubah, duplikat, hapus) di toolbar tata letak kartu (mode edit), bukan mengambang di atas judul kartu:
 * satu baris ikon 28px yang sejajar dengan geser/lebar/sembunyikan, seperti toolbar objek dasbor Tableau.
 */
export function KpiActions({ k, onEdit }: { k: CustomKpi; onEdit: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: endpoints.deleteKpi,
    onSuccess: () => { toast(t('kpi.deleted')); return refreshData(qc, ['kpi', 'layout']); },
    onError: (e) => toastError(e.message),
  });
  // Duplikat (seperti "Duplicate sheet" Tableau): resep sama, judul bertanda salinan, kartu baru di akhir.
  const duplicate = useMutation({
    mutationFn: () => { const { id: _id, sortOrder: _s, ...body } = k; return endpoints.createKpi({ ...body, label: t('kpi.copyOf', { label: k.label }).slice(0, 80) }); },
    onSuccess: () => { toast(t('table.saved')); return refreshData(qc, ['kpi']); },
    onError: (e) => toastError(e.message),
  });
  const confirmDelete = async () => {
    if (await confirmDanger({ title: t('kpi.confirmDelete'), text: t('kpi.confirmText'), confirm: t('confirm.yesDelete'), cancel: t('confirm.no'), subject: k.label })) remove.mutate(k.id);
  };
  return (
    <>
      <ToolBtn label={`${t('common.edit')} ${k.label}`} onPress={onEdit}><Pencil className="size-3.5" /></ToolBtn>
      <ToolBtn label={`${t('kpi.duplicate')} ${k.label}`} disabled={duplicate.isPending} onPress={() => duplicate.mutate()}><Copy className="size-3.5" /></ToolBtn>
      <ToolBtn label={`${t('common.delete')} ${k.label}`} className="text-danger" onPress={() => void confirmDelete()}><TrashBin className="size-3.5" /></ToolBtn>
    </>
  );
}

/** Kartu "Tambah KPI" di akhir grid (mode edit saja). */
export function AddKpiTile({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onPress}
      className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl bg-default/50 card-pad text-sm text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent lg:col-span-4">
      <Plus className="size-5" aria-hidden />
      <span className="font-medium">{t('kpi.add')}</span>
      <span className="max-w-56 text-center text-xs">{t('kpi.addHint')}</span>
    </button>
  );
}
