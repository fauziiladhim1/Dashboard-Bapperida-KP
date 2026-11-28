import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activeFields } from '@/lib/layer-style';
import { useCallback, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { ArrowUturnCcwLeft, ArrowUturnCwRight, BarsAscendingAlignLeft, BarsDescendingAlignLeft, ChartColumn, ChartColumnStacked, ChartLine, ChartPie, ChartTreemap, GripHorizontal, Hashtag, LayoutColumns, LayoutHeader, LayoutRows, ListOl, MagicWand, Xmark } from '@gravity-ui/icons';
import { Button, Input, Label } from '@heroui/react';
import { Pick } from '@/components/common/Pick';
import { CardStyleProvider } from '@/components/common/card-style';
import { isNumeric } from '@/lib/field-types';
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
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
      <span className="text-sm font-medium text-heading">{label}</span>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn('flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-dashed px-1.5 py-1 transition-colors', over ? 'border-accent bg-accent/5' : 'border-separator')}>
        {value ? (
          <span className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs', accepts === 'dim' ? 'bg-accent/10 text-accent' : 'bg-success/10 text-success')}>
            {value}
            {onClear && <button type="button" aria-label={clearLabel} onClick={onClear} className="rounded hover:bg-default"><Xmark className="size-3" /></button>}
          </span>
        ) : <span className="px-0.5 text-xs text-muted">{hint}</span>}
        {children}
      </div>
    </div>
  );
}


/** Pilihan kecil di dalam pil rak (agregasi, urutan), seperti menu pil Tableau. */
function Seg({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; label: ReactNode; title: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 items-center rounded-md bg-default p-0.5">
      {items.map((it) => (
        <button key={it.id} type="button" role="radio" aria-checked={value === it.id} aria-label={it.title} title={it.title} onClick={() => onChange(it.id)}
          className={cn('grid h-6 min-w-7 place-items-center rounded px-1.5 text-xs', value === it.id ? 'bg-surface text-heading shadow-sm' : 'text-muted hover:text-heading')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

const CHARTS = [
  { id: 'auto', icon: MagicWand }, { id: 'number', icon: Hashtag }, { id: 'bar', icon: ChartColumn }, { id: 'column', icon: ChartColumnStacked },
  { id: 'line', icon: ChartLine }, { id: 'donut', icon: ChartPie }, { id: 'treemap', icon: ChartTreemap }, { id: 'table', icon: LayoutRows },
] as const;

/**
 * Builder KPI ala Tableau: daftar field (dimensi/ukuran) diseret atau diklik ke rak Nilai, Rincian, Filter; bentuk grafik
 * dipilih lewat ikon; pratinjau = kartu KPI sungguhan dari /stats (filter kecamatan & tahun yang aktif).
 * Resep tetap tersimpan di tabel `kpi` (API & skema tidak berubah).
 */
export function KpiDialog({ kpi, template, note, all, layers, kecamatan, tahun, onClose, span: savedSpan, arrange: savedArrange = 'auto', look, onSaved }: {
  kpi?: CustomKpi;
  /** Resep awal untuk KPI baru, mis. kartu bawaan yang diubah isinya (disimpan sebagai KPI kustom). */
  template?: CustomKpiInput;
  /** Catatan di atas builder, mis. saat kartu bawaan diganti resep. */
  note?: string;
  all: Layer[]; layers: Layer[]; kecamatan?: string; tahun?: number; onClose: () => void;
  /** Lebar kartu di grid Ringkasan (12 kolom); hasilnya dikirim ke `onSaved` untuk disimpan ke tata letak. */
  span: LayoutCard['span'];
  /** Penempatan isi kartu (angka & grafik) yang tersimpan di tata letak. */
  arrange?: Arrange;
  /** Gaya kartu yang tersimpan (judul, ikon, warna, catatan, keterangan): pratinjau tampil persis seperti kartu di Ringkasan. */
  look?: LayoutCard;
  onSaved: (id: number, span: LayoutCard['span'], arrange: Arrange) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  // Tiap aksi (taruh field, ganti agregasi, urutan, grafik) = satu langkah urungkan; ketikan judul/satuan digabung.
  const h = useHistory<CustomKpiInput>(kpi ?? template ?? {
    label: '', layerSlug: '', measure: 'count', sumField: null, byField: null, by2Field: null, chart2: 'line', whereField: null, whereEq: null, unit: null, warn: false, chart: 'auto', sort: 'desc', topN: null,
  });
  const f = h.value;
  const set = (patch: Partial<CustomKpiInput>, typing = false) => h.set({ ...f, ...patch }, typing);
  useUndoKeys(true, h.undo, h.redo);
  const layer = all.find((l) => l.slug === f.layerSlug);
  const fields = layer ? activeFields(layer) : [];
  const nameOf = (key: string) => fields.find((x) => x.key === key)?.label ?? key;
  // Field kelas (mis. jenis_lampu, kondisi) bisa jadi rincian walau bukan isian form.
  const classField = layer?.style.classField;
  // Angka tidak jadi kategori, kecuali tahun (`tahun`, `tahun_pasang`, ...: rincian per tahun = grafik garis).
  const isYear = (key: string) => /^tahun/.test(key);
  const dims: Pill[] = [
    ...fields.filter((x) => isYear(x.key) || !isNumeric(x.type)).map((x) => ({ kind: 'dim' as const, id: x.key, name: x.label })),
    ...(classField && !fields.some((x) => x.key === classField) ? [{ kind: 'dim' as const, id: classField, name: classField }] : []),
  ];
  const measures: Pill[] = [
    ...measuresOf(layer).map((m) => ({ kind: 'measure' as const, id: m, name: t(`kpi.m.${m}`) })),
    // Atribut angka (seperti "Measures" Tableau): ditaruh di Nilai = SUM bawaan, agregasi diganti di pil.
    ...fields.filter((x) => isNumeric(x.type) && !isYear(x.key)).map((x) => ({ kind: 'measure' as const, id: `agg:${x.key}`, name: x.label })),
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
  const [arrange, setArrange] = useState<Arrange>(savedArrange);
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
      onSaved(saved.id, span, arrange);
      onClose();
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(f); };
  const draft: CustomKpi = { ...f, id: kpi?.id ?? 0, sortOrder: kpi?.sortOrder ?? 100, label: f.label || t('kpi.preview') };

  return (
    <AppModal size="xl" title={t(kpi || template ? 'kpi.edit' : 'kpi.add')} description={t('kpi.desc')} onClose={onClose}
      // Aksi di footer modal (tetap terlihat walau builder digulir); submit terhubung ke form lewat `form`.
      footer={<>
        {save.error && <div className="mr-auto min-w-0"><ErrorAlert message={save.error.message} /></div>}
        <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="kpi-form" isDisabled={save.isPending || !layer || (isAgg(f.measure) && !f.sumField) || (!!f.whereField && !f.whereEq)}>{t('common.save')}</Button>
      </>}>
      <form id="kpi-form" onSubmit={submit} className="grid grid-cols-1 gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        {note && <p className="text-xs text-muted md:col-span-2">{note}</p>}
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
              const off = (!f.byField && id !== 'auto' && id !== 'number') || ((id === 'donut' || id === 'treemap') && !additive(f.measure));
              const name = t(`kpi.c.${id}`).split(' (')[0];
              return (
                <button key={id} type="button" role="radio" aria-checked={f.chart === id} aria-label={name} disabled={off} title={t(`kpi.c.${id}`)} onClick={() => set({ chart: id })}
                  className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors disabled:opacity-35',
                    f.chart === id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-default hover:text-heading')}>
                  <Icon className="size-3.5" aria-hidden /><span className="hidden sm:inline">{name}</span>
                </button>
              );
            })}
          </div>

        </div>
        {/* Kolom 1: sumber data + daftar field. */}
        <div className="flex flex-col gap-3 md:border-r md:border-separator md:pr-4">
          <Pick label={t('kpi.layer')} placeholder={t('kpi.pickLayer')} value={f.layerSlug || null} items={all.map((l) => ({ id: l.slug, name: l.name }))}
            // Ganti layer: atribut lama tak berlaku lagi.
            onChange={(v) => set({ layerSlug: v, measure: 'count', sumField: null, byField: null, by2Field: null, whereField: null, whereEq: null, chart: 'auto' })} />
          {!layer ? <p className="text-xs text-muted">{t('kpi.pickLayerFirst')}</p> : (
            <>
              <div className="flex flex-col gap-1.5">
                <p className="section-title">{t('kpi.dims')}</p>
                <div className="flex flex-wrap gap-1.5">{dims.map((p) => <Chip key={p.id} p={p} onPick={() => set({ byField: p.id })} />)}</div>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="section-title">{t('kpi.measures')}</p>
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
                  <span className="flex items-center gap-1.5 text-xs text-muted">{t('kpi.topN')}
                    <Pick size="sm" hideLabel label={t('kpi.topN')} value={f.topN ? String(f.topN) : 'all'} className="w-28"
                      onChange={(v) => set({ topN: v === 'all' ? null : Number(v) })}
                      items={[{ id: 'all', name: t('kpi.topAll') }, ...[3, 5, 10, 20].map((n) => ({ id: String(n), name: t('kpi.topNn', { n }) }))]} />
                  </span>
                </>
              )}
            </ShelfBox>
            {/* Grafik kedua (format kartu Penduduk Miskin): rincian lain di samping grafik utama, mis. deret per tahun. */}
            <ShelfBox label={t('kpi.shelfBy2')} accepts="dim" value={f.by2Field ? nameOf(f.by2Field) : undefined} onDrop={(p) => set({ by2Field: p.id })}
              onClear={() => set({ by2Field: null })} clearLabel={t('kpi.clear', { rak: t('kpi.shelfBy2') })} hint={t('kpi.dropHere')}>
              {layer && (f.by2Field ? (
                <Seg label={t('kpi.chart2')} value={f.chart2} onChange={(v) => set({ chart2: v as CustomKpiInput['chart2'] })} items={[
                  { id: 'line', label: <ChartLine className="size-3.5" />, title: t('kpi.c.line') },
                  { id: 'bar', label: <ChartColumn className="size-3.5" />, title: t('kpi.c.bar') },
                ]} />
              ) : (
                <Pick size="sm" hideLabel label={t('kpi.shelfBy2')} value={null} placeholder={`${t('kpi.pickField')}…`} className="w-44"
                  onChange={(v) => set({ by2Field: v })} items={dims.map((d) => ({ id: d.id, name: d.name }))} />
              ))}
            </ShelfBox>
            {/* Filter: atribut diseret ke rak atau dipilih di select; nilainya dipilih di rak yang sama dari data layer. */}
            <ShelfBox label={t('kpi.shelfFilter')} accepts="dim" value={f.whereField ? nameOf(f.whereField) : undefined}
              onDrop={(p) => set({ whereField: p.id, whereEq: null })} onClear={() => set({ whereField: null, whereEq: null })}
              clearLabel={t('kpi.clear', { rak: t('kpi.shelfFilter') })} hint={t('kpi.dropHere')}>
              {layer && (f.whereField ? (
                <Pick size="sm" hideLabel label={t('kpi.filterValue')} value={f.whereEq} placeholder={`${t('kpi.filterValue')}…`} className="w-44"
                  onChange={(v) => set({ whereEq: v })} items={valueOpts} />
              ) : (
                <Pick size="sm" hideLabel label={t('kpi.whereField')} value={null} placeholder={`${t('kpi.whereField')}…`} className="w-44"
                  onChange={(v) => set({ whereField: v, whereEq: null })} items={dims.map((d) => ({ id: d.id, name: d.name }))} />
              ))}
            </ShelfBox>
          </div>
          {!f.byField && <p className="text-xs text-muted">{t('kpi.chartHint')}</p>}
          {/*
            Tata letak ala software editing: inspektor (lebar & penempatan isi) di atas kanvas, dan pegangan di tepi kanan kartu
            pratinjau untuk menyeret lebarnya langsung (snap ke ⅓/½/⅔/penuh baris 12 kolom). Yang terlihat di kanvas = hasil di Ringkasan.
          */}
          <section aria-labelledby="kpi-layout" className="flex flex-col gap-3 border-t border-separator pt-4">
            <p id="kpi-layout" className="section-title">{t('kpi.layout')}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-heading">{t('kpi.size')}
                <Seg label={t('kpi.size')} value={String(span)} onChange={(v) => setSpan(Number(v) as LayoutCard['span'])}
                  items={WIDTHS.map((w) => ({ id: String(w.span), label: w.span === 12 ? t('kpi.full') : w.label, title: t('kpi.cols', { n: w.span }) }))} />
              </span>
              <span className="flex items-center gap-2 text-sm font-medium text-heading">{t('style.arrange')}
                <Seg label={t('style.arrange')} value={arrange} onChange={(v) => setArrange(v as Arrange)}
                  items={PLACEMENTS.map((p) => ({ id: p.id, label: <p.icon className="size-3.5" />, title: t(`style.arrange.${p.id}`) }))} />
                <span className="text-xs font-normal text-muted">{t(`style.arrange.${arrange}`)}</span>
              </span>
            </div>
            <div ref={canvasRef} className="overflow-hidden rounded-xl border border-dashed border-separator p-3">
              {layer ? (
                <div className="relative" style={{ width: cardW * scale }}>
                  <div className="pointer-events-none" style={{ width: cardW, zoom: scale }}>
                    <CardStyleProvider value={{ ...look, arrange }}>
                      <CustomKpiCard k={draft} layer={resolve(draft, all, layers)} kecamatan={kecamatan} tahun={tahun} to={() => '#'} />
                    </CardStyleProvider>
                  </div>
                  <ResizeHandle label={t('kpi.size')} span={span} onSpan={setSpan} unit={((boardW + 16) / 12) * scale} />
                </div>
              ) : <p className="text-xs text-muted">{t('kpi.pickLayerFirst')}</p>}
            </div>
            <p className="text-xs text-muted">{t('kpi.previewHint')}</p>
          </section>
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
            <span className="font-medium text-heading">{t('kpi.warn')}<span className="block text-xs font-normal text-muted">{t('kpi.warnHint')}</span></span>
            <Toggle checked={f.warn} onChange={(warn) => set({ warn })} label={t('kpi.warn')} />
          </div>
        </div>

      </form>
    </AppModal>
  );
}

type Arrange = NonNullable<LayoutCard['arrange']>;

const PLACEMENTS: { id: Arrange; icon: typeof MagicWand }[] = [
  { id: 'auto', icon: MagicWand }, { id: 'side', icon: LayoutColumns }, { id: 'stack', icon: LayoutRows }, { id: 'chartFirst', icon: LayoutHeader },
];

/**
 * Pegangan seret di tepi kanan kartu pratinjau: geser kiri/kanan untuk mengubah lebar, dilepas = snap ke lebar terdekat
 * (⅓/½/⅔/penuh). Keyboard: panah kiri/kanan pindah satu preset. `unit` = lebar satu kolom grid di kanvas (px).
 */
function ResizeHandle({ label, span, onSpan, unit }: { label: string; span: LayoutCard['span']; onSpan: (s: LayoutCard['span']) => void; unit: number }) {
  const spans = WIDTHS.map((w) => w.span);
  const snap = (cols: number) => spans.reduce((a, b) => (Math.abs(b - cols) < Math.abs(a - cols) ? b : a));
  const step = (d: -1 | 1) => onSpan(spans[Math.min(spans.length - 1, Math.max(0, spans.indexOf(snap(span)) + d))]!);
  return (
    <span role="slider" tabIndex={0} aria-label={label} aria-valuemin={4} aria-valuemax={12} aria-valuenow={span}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } }}
      onPointerDown={(e) => {
        if (!unit) return;
        const el = e.currentTarget; el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, from = span;
        const move = (ev: PointerEvent) => onSpan(snap(from + (ev.clientX - x0) / unit));
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), { once: true });
      }}
      className="absolute top-1/2 -right-2 grid h-12 w-4 -translate-y-1/2 cursor-ew-resize place-items-center rounded-md border border-separator bg-surface text-muted shadow-sm hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
      <GripHorizontal className="size-3 rotate-90" aria-hidden />
    </span>
  );
}
