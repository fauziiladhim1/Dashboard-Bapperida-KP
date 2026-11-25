import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type DragEvent, type FormEvent, type Key, type ReactNode } from 'react';
import { ArrowUturnCcwLeft, ArrowUturnCwRight, BarsAscendingAlignLeft, BarsDescendingAlignLeft, ChartColumn, ChartLine, ChartPie, Hashtag, ListOl, MagicWand, Xmark } from '@gravity-ui/icons';
import { Button, Input, Label, ListBox, Select } from '@heroui/react';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { Toggle } from '@/components/common/motion';
import { endpoints, refreshData } from '@/lib/api';
import { toast } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { CustomKpi, CustomKpiInput, KpiMeasure, Layer, LayoutCard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useHistory, useUndoKeys } from '@/lib/use-history';
import { additive, AGG, CustomKpiCard, isAgg, resolve } from './CustomKpis';
import { ToolBtn, WIDTHS } from './layout';
import { useStats } from './use-stats';

/** Select HeroUI terkendali; pilihan tunggal tidak bisa dikosongkan, jadi `onChange` selalu menerima id. */
function Pick({ label, value, onChange, items, placeholder }: {
  label: string; value: string | null; onChange: (v: string) => void; items: { id: string; name: string }[]; placeholder?: string;
}) {
  return (
    <Select selectedKey={value} onSelectionChange={(k: Key | null) => onChange(String(k))} placeholder={placeholder} className="flex w-full flex-col gap-2">
      <Label>{label}</Label>
      <Select.Trigger className="w-full"><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(it: { id: string; name: string }) => <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Ukuran yang masuk akal per tipe geometri: panjang hanya untuk garis, luas hanya untuk poligon. */
const measuresOf = (l?: Layer): KpiMeasure[] => [
  'count', ...(l?.geomType === 'LineString' ? ['length_km' as const] : []), ...(l?.geomType === 'Polygon' ? ['area_ha' as const] : []),
];

/** Field yang diseret/diklik: dimensi (kategori) atau ukuran (`count`/`length_km`/`area_ha`/`sum:<atribut angka>`). */
type Pill = { kind: 'dim' | 'measure'; id: string; name: string };
const DND = 'application/x-kpi-field';

/** Chip field: diseret ke rak, atau diklik untuk ditaruh di rak bawaannya (keyboard). */
function Chip({ p, onPick }: { p: Pill; onPick: () => void }) {
  return (
    <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData(DND, JSON.stringify(p)); e.dataTransfer.effectAllowed = 'copy'; }} onClick={onPick}
      className={cn('inline-flex h-7 max-w-full cursor-grab items-center truncate rounded-md border px-2 text-left text-xs active:cursor-grabbing',
        p.kind === 'dim' ? 'border-accent/30 bg-accent/5 text-accent' : 'border-success/30 bg-success/5 text-success')}>
      {p.name}
    </button>
  );
}

/** Rak (Nilai/Rincian/Filter): menerima chip jenis tertentu; isi tampil sebagai pil dengan tombol kosongkan. */
function ShelfBox({ label, accepts, value, onDrop, onClear, clearLabel, hint, children }: {
  label: string; accepts: Pill['kind']; value?: string; onDrop: (p: Pill) => void; onClear?: () => void; clearLabel: string; hint: string; children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    try { const p = JSON.parse(e.dataTransfer.getData(DND)) as Pill; if (p.kind === accepts) onDrop(p); } catch { /* bukan chip field */ }
  };
  return (
    // Label rak rata tengah dengan isinya; semua isi rak (pil, Seg, select) setinggi 28px.
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn('flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-dashed px-1.5 py-1 transition-colors', over ? 'border-accent bg-accent/5' : 'border-separator')}>
        {value ? (
          <span className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium', accepts === 'dim' ? 'bg-accent/10 text-accent' : 'bg-success/10 text-success')}>
            {value}
            {onClear && <button type="button" aria-label={clearLabel} onClick={onClear} className="rounded hover:bg-default"><Xmark className="size-3" /></button>}
          </span>
        ) : <span className="px-0.5 text-xs text-muted">{hint}</span>}
        {children}
      </div>
    </div>
  );
}

/** Select bawaan setinggi kontrol rak lain (28px). */
const SELECT = 'h-7 rounded-md border border-separator bg-surface px-1.5 text-xs text-heading';

/** Pilihan kecil di dalam pil rak (agregasi, urutan), seperti menu pil Tableau. */
function Seg({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; label: ReactNode; title: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 items-center rounded-md bg-default p-0.5">
      {items.map((it) => (
        <button key={it.id} type="button" role="radio" aria-checked={value === it.id} aria-label={it.title} title={it.title} onClick={() => onChange(it.id)}
          className={cn('grid h-6 min-w-7 place-items-center rounded px-1.5 text-[11px] font-medium', value === it.id ? 'bg-surface text-heading shadow-sm' : 'text-muted hover:text-heading')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

const CHARTS = [
  { id: 'auto', icon: MagicWand }, { id: 'number', icon: Hashtag }, { id: 'bar', icon: ChartColumn }, { id: 'line', icon: ChartLine }, { id: 'donut', icon: ChartPie },
] as const;

/**
 * Builder KPI ala Tableau: daftar field (dimensi/ukuran) diseret atau diklik ke rak Nilai, Rincian, Filter; bentuk grafik
 * dipilih lewat ikon; pratinjau = kartu KPI sungguhan dari /stats (filter kecamatan & tahun yang aktif).
 * Resep tetap tersimpan di tabel `kpi` (API & skema tidak berubah).
 */
export function KpiDialog({ kpi, all, layers, kecamatan, tahun, onClose, span: savedSpan, onSpan }: {
  kpi?: CustomKpi; all: Layer[]; layers: Layer[]; kecamatan?: string; tahun?: number; onClose: () => void;
  /** Lebar kartu di grid Ringkasan (12 kolom); diubah di sini = disimpan ke tata letak lewat `onSpan`. */
  span: LayoutCard['span']; onSpan: (id: number, span: LayoutCard['span']) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Tiap aksi (taruh field, ganti agregasi, urutan, grafik) = satu langkah urungkan; ketikan judul/satuan digabung.
  const h = useHistory<CustomKpiInput>(kpi ?? {
    label: '', layerSlug: '', measure: 'count', sumField: null, byField: null, whereField: null, whereEq: null, unit: null, warn: false, chart: 'auto', sort: 'desc', topN: null,
  });
  const f = h.value;
  const set = (patch: Partial<CustomKpiInput>, typing = false) => h.set({ ...f, ...patch }, typing);
  useUndoKeys(true, h.undo, h.redo);
  const layer = all.find((l) => l.slug === f.layerSlug);
  const fields = layer?.fields ?? [];
  const nameOf = (key: string) => fields.find((x) => x.key === key)?.label ?? key;
  // Field kelas (mis. jenis_lampu, kondisi) bisa jadi rincian walau bukan isian form.
  const classField = layer?.style.classField;
  // Angka tidak jadi kategori, kecuali tahun (`tahun`, `tahun_pasang`, ...: rincian per tahun = grafik garis).
  const isYear = (key: string) => /^tahun/.test(key);
  const dims: Pill[] = [
    ...fields.filter((x) => isYear(x.key) || x.type !== 'number').map((x) => ({ kind: 'dim' as const, id: x.key, name: x.label })),
    ...(classField && !fields.some((x) => x.key === classField) ? [{ kind: 'dim' as const, id: classField, name: classField }] : []),
  ];
  const measures: Pill[] = [
    ...measuresOf(layer).map((m) => ({ kind: 'measure' as const, id: m, name: t(`kpi.m.${m}`) })),
    // Atribut angka (seperti "Measures" Tableau): ditaruh di Nilai = SUM bawaan, agregasi diganti di pil.
    ...fields.filter((x) => x.type === 'number' && !isYear(x.key)).map((x) => ({ kind: 'measure' as const, id: `agg:${x.key}`, name: x.label })),
  ];
  const setMeasure = (id: string) => set(id.startsWith('agg:')
    ? { measure: isAgg(f.measure) ? f.measure : 'sum', sumField: id.slice(4) }
    : { measure: id as KpiMeasure, sumField: null });
  const setAgg = (measure: KpiMeasure) => set({ measure, ...(f.chart === 'donut' && !additive(measure) && { chart: 'auto' as const }) });
  const measureName = isAgg(f.measure) ? (f.sumField ? `${f.measure.toUpperCase()}(${nameOf(f.sumField)})` : undefined) : t(`kpi.m.${f.measure}`);
  // Nilai filter dipilih dari kategori yang benar-benar ada di data layer, bukan diketik bebas.
  const filterVals = useStats(f.layerSlug, undefined, !!layer && !!f.whereField, { by: f.whereField ?? undefined });
  const valueOpts = (filterVals.data ?? []).filter((r) => r.key).map((r) => ({ id: r.key!, name: r.key! }));

  // Ukuran kartu seperti "Size" sheet di dasbor Tableau: pratinjau digambar selebar kartu sungguhan di grid, lalu
  // diperkecil (zoom) agar muat di kanvas. Container query di kartu membaca lebar asli, jadi tata letak isinya sama persis.
  const [span, setSpan] = useState(savedSpan);
  const [canvasW, setCanvasW] = useState(0);
  // React 19: ref callback yang mengembalikan cleanup tidak dipanggil lagi dengan null, jadi `el` selalu ada.
  const canvasRef = useCallback((el: HTMLDivElement) => {
    const ro = new ResizeObserver(([e]) => setCanvasW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // ponytail: rumus grid desktop (lg, 12 kolom, gap 1rem); di tablet/ponsel kartu lebih lebar dari pratinjau ini.
  const boardW = document.querySelector('[data-board]')?.clientWidth || 1200;
  const cardW = ((boardW - 11 * 16) / 12) * span + (span - 1) * 16;
  const scale = canvasW ? Math.min(1, canvasW / cardW) : 1;

  const save = useMutation({
    mutationFn: (body: CustomKpiInput) => (kpi ? endpoints.updateKpi(kpi.id, body) : endpoints.createKpi(body)),
    onSuccess: async (saved) => {
      toast(t('table.saved')); await refreshData(qc, ['kpi']);
      // Setelah refreshData: refetch tata letak lama yang dipicunya dibatalkan oleh simpan optimistis, bukan menimpanya.
      if (span !== savedSpan) onSpan(saved.id, span);
      onClose();
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(f); };
  const draft: CustomKpi = { ...f, id: kpi?.id ?? 0, sortOrder: kpi?.sortOrder ?? 100, label: f.label || t('kpi.preview') };

  return (
    <AppModal size="xl" title={t(kpi ? 'kpi.edit' : 'kpi.add')} description={t('kpi.desc')} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        {/*
          Toolbar ala Tableau: urungkan/ulangi, bentuk grafik ("Show Me"), dan ukuran kartu di Ringkasan. Semua kontrol 28px
          (ToolBtn sama dengan toolbar kartu di papan), jadi ikon segaris.
        */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-separator pb-2 md:col-span-2">
          <ToolBtn label={t('kpi.undo')} disabled={!h.canUndo} onPress={h.undo}><ArrowUturnCcwLeft className="size-3.5" /></ToolBtn>
          <ToolBtn label={t('kpi.redo')} disabled={!h.canRedo} onPress={h.redo}><ArrowUturnCwRight className="size-3.5" /></ToolBtn>
          <span aria-hidden className="mx-1 h-5 w-px bg-separator" />
          <div role="radiogroup" aria-label={t('kpi.chart')} className="flex items-center gap-1">
            {CHARTS.map(({ id, icon: Icon }) => {
              // Tanpa rincian hanya angka: batang/garis/donut butuh kategori.
              const off = (!f.byField && id !== 'auto' && id !== 'number') || (id === 'donut' && !additive(f.measure));
              const name = t(`kpi.c.${id}`).split(' (')[0];
              return (
                <button key={id} type="button" role="radio" aria-checked={f.chart === id} aria-label={name} disabled={off} title={t(`kpi.c.${id}`)} onClick={() => set({ chart: id })}
                  className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors disabled:opacity-35',
                    f.chart === id ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-default hover:text-heading')}>
                  <Icon className="size-3.5" aria-hidden /><span className="hidden sm:inline">{name}</span>
                </button>
              );
            })}
          </div>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted">{t('kpi.size')}
            <Seg label={t('kpi.size')} value={String(span)} onChange={(v) => setSpan(Number(v) as LayoutCard['span'])}
              items={WIDTHS.map((w) => ({ id: String(w.span), label: w.label, title: `${w.label} ${t('kpi.size').toLowerCase()}` }))} />
          </span>
        </div>
        {/* Kolom 1: sumber data + daftar field. */}
        <div className="flex flex-col gap-3 md:border-r md:border-separator md:pr-4">
          <Pick label={t('kpi.layer')} placeholder={t('kpi.pickLayer')} value={f.layerSlug || null} items={all.map((l) => ({ id: l.slug, name: l.name }))}
            // Ganti layer: atribut lama tak berlaku lagi.
            onChange={(v) => set({ layerSlug: v, measure: 'count', sumField: null, byField: null, whereField: null, whereEq: null, chart: 'auto' })} />
          {!layer ? <p className="text-xs text-muted">{t('kpi.pickLayerFirst')}</p> : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted">{t('kpi.dims')}</p>
                <div className="flex flex-wrap gap-1.5">{dims.map((p) => <Chip key={p.id} p={p} onPick={() => set({ byField: p.id })} />)}</div>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted">{t('kpi.measures')}</p>
                <div className="flex flex-wrap gap-1.5">{measures.map((p) => <Chip key={p.id} p={p} onPick={() => setMeasure(p.id)} />)}</div>
              </div>
            </>
          )}
        </div>

        {/* Kolom 2: rak + bentuk grafik + kanvas pratinjau + teks kartu. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <ShelfBox label={t('kpi.shelfValue')} accepts="measure" value={measureName} onDrop={(p) => setMeasure(p.id)} clearLabel="" hint={t('kpi.dropHere')}>
              {isAgg(f.measure) && (
                <Seg label={t('kpi.agg')} value={f.measure} onChange={(v) => setAgg(v as KpiMeasure)}
                  items={AGG.map((a) => ({ id: a, label: a.toUpperCase(), title: t(`kpi.m.${a}`) }))} />
              )}
            </ShelfBox>
            <ShelfBox label={t('kpi.shelfBy')} accepts="dim" value={f.byField ? nameOf(f.byField) : undefined} onDrop={(p) => set({ byField: p.id })}
              onClear={() => set({ byField: null, chart: 'auto', topN: null })} clearLabel={t('kpi.clear', { rak: t('kpi.shelfBy') })} hint={t('kpi.dropHere')}>
              {f.byField && (
                <>
                  <Seg label={t('kpi.sort')} value={f.sort} onChange={(v) => set({ sort: v as CustomKpiInput['sort'] })} items={[
                    { id: 'desc', label: <BarsDescendingAlignLeft className="size-3.5" />, title: t('kpi.sortDesc') },
                    { id: 'asc', label: <BarsAscendingAlignLeft className="size-3.5" />, title: t('kpi.sortAsc') },
                    { id: 'label', label: <ListOl className="size-3.5" />, title: t('kpi.sortLabel') },
                  ]} />
                  <label className="flex items-center gap-1 text-xs text-muted">{t('kpi.topN')}
                    <select value={f.topN ?? ''} onChange={(e) => set({ topN: e.target.value ? Number(e.target.value) : null })}
                      className={SELECT}>
                      <option value="">{t('kpi.topAll')}</option>
                      {[3, 5, 10, 20].map((n) => <option key={n} value={n}>{t('kpi.topNn', { n })}</option>)}
                    </select>
                  </label>
                </>
              )}
            </ShelfBox>
            {/* Filter: atribut diseret ke rak atau dipilih di select; nilainya dipilih di rak yang sama dari data layer. */}
            <ShelfBox label={t('kpi.shelfFilter')} accepts="dim" value={f.whereField ? nameOf(f.whereField) : undefined}
              onDrop={(p) => set({ whereField: p.id, whereEq: null })} onClear={() => set({ whereField: null, whereEq: null })}
              clearLabel={t('kpi.clear', { rak: t('kpi.shelfFilter') })} hint={t('kpi.dropHere')}>
              {layer && (f.whereField ? (
                <select aria-label={t('kpi.filterValue')} value={f.whereEq ?? ''} onChange={(e) => set({ whereEq: e.target.value || null })} className={SELECT}>
                  <option value="">{t('kpi.filterValue')}…</option>
                  {valueOpts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : (
                <select aria-label={t('kpi.whereField')} value="" onChange={(e) => e.target.value && set({ whereField: e.target.value, whereEq: null })} className={SELECT}>
                  <option value="">{t('kpi.whereField')}…</option>
                  {dims.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              ))}
            </ShelfBox>
          </div>
          {!f.byField && <p className="text-xs text-muted">{t('kpi.chartHint')}</p>}
          {/* Kanvas: kartu sungguhan seukuran di Ringkasan (latar dasbor); ukurannya dipilih di toolbar, seperti "Size" Tableau. */}
          <div className="flex flex-col gap-2">
            <Label>{t('kpi.preview')}</Label>
            <div ref={canvasRef} className="overflow-hidden rounded-xl bg-background p-3">
              {layer ? (
                <div className="pointer-events-none" style={{ width: cardW, zoom: scale }}>
                  <CustomKpiCard k={draft} layer={resolve(draft, all, layers)} kecamatan={kecamatan} tahun={tahun} to={() => '#'} />
                </div>
              ) : <p className="rounded-xl border border-dashed border-separator p-4 text-xs text-muted">{t('kpi.pickLayerFirst')}</p>}
            </div>
            <p className="text-xs text-muted">{t('kpi.previewHint')}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="kpi-label">{t('kpi.label')}</Label>
              <Input id="kpi-label" required minLength={2} maxLength={80} value={f.label} onChange={(e) => set({ label: e.target.value }, true)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kpi-unit">{t('kpi.unit')}</Label>
              <Input id="kpi-unit" maxLength={30} placeholder={t('kpi.unitHint')} value={f.unit ?? ''} onChange={(e) => set({ unit: e.target.value || null }, true)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t('kpi.warn')}<span className="block text-xs text-muted">{t('kpi.warnHint')}</span></span>
            <Toggle checked={f.warn} onChange={(warn) => set({ warn })} label={t('kpi.warn')} />
          </div>
        </div>

        <div className="flex flex-col gap-3 md:col-span-2">
          {save.error && <ErrorAlert message={save.error.message} />}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" isDisabled={save.isPending || !layer || (isAgg(f.measure) && !f.sumField) || (!!f.whereField && !f.whereEq)}>{t('common.save')}</Button>
          </div>
        </div>
      </form>
    </AppModal>
  );
}
