import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AddKpiTile, KpiActions, KpiTile } from './CustomKpis';
import { KpiDialog } from './KpiDialog';
import { HazardExposure } from './insights';
import { arrange, Board, useLayout, withSpan, type BoardEntry } from './layout';
import { retryOf, useStats } from './use-stats';
import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, Bulb, ChartLine, Database, Persons, TriangleExclamation } from '@gravity-ui/icons';
import { Button, buttonVariants } from '@heroui/react';
import { Link, useSearchParams } from 'react-router';
import { KecamatanSelect } from '@/components/common/KecamatanSelect';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { YearNote, YearRange, YearSelect } from '@/components/common/YearRange';
import { canEdit, useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { fmt, fmtCompact, fmtLongDate, greetingKey, pct } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { latestVersions, patchParams, useYear, useYearRange, yearGaps } from '@/lib/year-range';
import { classLabel, colorOf } from '@/lib/layer-style';
import type { CustomKpi, Layer, StatRow } from '@/lib/types';
import { FilterChip } from '@/components/common/FilterChip';
import { Breakdown, LEGEND_BOX, LEGEND_TITLE, MiniDonut, pickChart, haLabel, LandCover, HazardCard, incomparableYears, PolaRuang, HeroKpi, Kpi, MiniMap, RankBars, ROAD_PARTS, RoadOverview, Spark, sum, TimeSeries } from './widgets';
import { ArrowRotateLeft, ArrowUturnCcwLeft, ArrowUturnCwRight, Check, Droplet, Pencil, Wrench } from '@gravity-ui/icons';
import { Tip } from '@/components/common/Tip';
import { useUndoKeys } from '@/lib/use-history';

/** Komposisi satu keseluruhan (jenis lampu, jenis fasilitas): bentuk grafik dipilih dari data (donut bila kategori sedikit). */
const Composition = (p: Parameters<typeof Breakdown>[0]) =>
  pickChart(p.items.map((i) => i.key)) === 'donut' ? <MiniDonut {...p} /> : <Breakdown {...p} />;

export default function OverviewPage() {
  const { data: me } = useMe();
  const { t } = usePrefs();
  const now = new Date();
  const [params, setParams] = useSearchParams();
  const kec = params.get('kec') ?? undefined;
  // Dua kontrol waktu, scope terpisah: `tahun` (global, URL) untuk KPI, peta, inventaris, komposisi;
  // `range` (lokal) hanya untuk grafik tren. Mengubah salah satu tidak mengubah yang lain.
  const { years, tahun, set: setTahun } = useYear();
  const range = useYearRange();
  const allLayers = useQuery({ queryKey: ['layers'], queryFn: endpoints.layers });
  const all = useMemo(() => allLayers.data ?? [], [allLayers.data]);
  const layers = useMemo(() => latestVersions(all, tahun), [all, tahun]);
  const bySlug = (slug: string) => layers.find((l) => l.slug === slug);
  const on = (slug: string) => !!bySlug(slug);
  const pjuQ = useStats('pju', kec, on('pju'));
  // Ruas SK per kelas kondisi. Kelas dihitung API dari tabel survei (survei terakhir <= tahun global, ambang 20%, join
  // nama ruas; fungsi SQL ruas_props); SHP hanya geometri + nama. Panjang = atribut resmi panjang_km SK, bukan geometri.
  const jalanQ = useStats('jalan-kabupaten', kec, on('jalan-kabupaten'), { by: 'kondisi', sum: 'panjang_km', tahun });
  // Kelas kondisi yang dimatikan di kartu Kondisi Jalan: ikut menyaring garis ruas di peta mini.
  const [roadHidden, setRoadHidden] = useState<string[]>([]);
  // Mode "Edit ringkasan" (editor): kelola KPI kustom di tempat. Di luar mode ini Ringkasan hanya tampilan baca.
  const [editing, setEditing] = useState(false);
  // Tata letak kartu (urutan, lebar, tersembunyi) dari DB; resep KPI kustom dari tabel `kpi`.
  const layout = useLayout();
  const kpis = useQuery({ queryKey: ['kpi'], queryFn: endpoints.kpis }).data ?? [];
  const [kpiDialog, setKpiDialog] = useState<CustomKpi | 'new' | null>(null);
  // Ctrl+Z / Ctrl+Y di mode edit = urungkan/ulangi tata letak (builder KPI punya riwayatnya sendiri saat terbuka).
  useUndoKeys(editing && !kpiDialog, layout.undo, layout.redo);
  // Tinggi kartu KPI sebaris (Kondisi jalan; satu baris grid = satu tinggi): jadi tinggi minimum kartu Tutupan lahan
  // yang berada di baris sendiri, agar ukurannya serupa dengan KPI lain di semua lebar layar.
  const [kpiH, setKpiH] = useState(0);
  // React 19: ref callback yang mengembalikan cleanup tidak dipanggil ulang dengan null saat lepas.
  const kpiRow = useCallback((el: HTMLDivElement) => {
    const ro = new ResizeObserver(() => setKpiH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mapHidden = useMemo(() => ({ 'jalan-kabupaten': roadHidden }), [roadHidden]);
  const bahayaQ = useStats('potensi-bencana', kec, on('potensi-bencana'), { by: 'jenis_bahaya', where: 'kelas', eq: 'Tinggi' });
  const batasQ = useStats('batas-administrasi', kec, on('batas-administrasi'), { by: 'kecamatan' });
  // Luas rencana pola ruang per kelas (treemap); layer statis, ikut filter kecamatan.
  const polaQ = useStats('penggunaan-lahan', kec, on('penggunaan-lahan'), { by: 'pola_ruang' });
  // Tutupan lahan aktual (RBI, SHP Audit 2024) per kelas: total luas + komposisi; bukan rencana pola ruang.
  const tutupanQ = useStats('tutupan-lahan', kec, on('tutupan-lahan'), { by: 'kelas' });
  // Standar Pelayanan Minimal: fasilitas pendidikan + kesehatan dari utilitas umum.
  const utilQ = useStats('utilitas-umum', kec, on('utilitas-umum'), { by: 'jenis' });
  const [pju, jalan] = [pjuQ.data, jalanQ.data];
  // Rincian KPI: kelas terbanyak dulu. Kawasan wisata tanpa nama dilewati (label kosong).
  // Baris statistik hanya ada bila layernya ada (useStats `enabled`), jadi `layer!` aman.
  const top = (rows: StatRow[] | undefined, layer: Layer | undefined, named = false) =>
    [...(rows ?? [])].filter((r) => !named || r.key).sort((a, b) => b.count - a.count)
      .map((r) => ({ key: r.key ?? '', label: r.key ? classLabel(layer!.style, r.key) : t('ov.noClass'), value: r.count, color: colorOf(layer!.style, r.key) }));
  // KPI tutupan lahan: total luas semua kelas (kelas kosong ikut total).
  const tutupan = tutupanQ.data;
  const tutupanTotal = sum(tutupan, 'areaHa');
  const util = utilQ.data;
  // Utilitas umum: semua jenis fasilitas; rincian = 3 jenis terbanyak (urutan & warna dari `top`, sama dengan PJU).
  /** Tautan kartu KPI: Peta dengan layer KPI menyala, tahun global ikut. */
  const peta = (slug: string) => `/peta?layer=${slug}${tahun ? `&tahun=${tahun}` : ''}`;
  const ruas = useQuery({ queryKey: ['ruas-jalan', kec, tahun], queryFn: () => endpoints.ruasJalan(kec, undefined, tahun), placeholderData: keepPreviousData, enabled: tahun !== undefined });
  const series = useQuery({ queryKey: ['timeseries', kec], queryFn: () => endpoints.timeseries(kec), placeholderData: keepPreviousData });

  const points = (series.data ?? []).filter((p) => range.inRange(p.tahun));
  // KPI kemiskinan: data terakhir <= tahun global, dibanding data tahun sebelumnya.
  const poor = (series.data ?? []).filter((p) => p.miskin > 0 && tahun !== undefined && p.tahun <= tahun);
  // Tahun yang menyimpang jauh (kemiskinan 2024: total ±1/7 tahun lain, perlu dicek ke sumber) tetap di sparkline, tapi tidak jadi pembanding delta.
  const poorOdd = incomparableYears(poor.map((p) => ({ tahun: p.tahun, v: p.miskin })));
  const poorCmp = poor.filter((p) => !poorOdd.has(p.tahun));
  const poorLast = poorCmp.at(-1);
  const poorFirst = poorCmp.at(-2);
  const poorDelta = poorLast && poorFirst ? poorLast.miskin - poorFirst.miskin : null;
  // Wilayah dengan penduduk miskin terbanyak di tahun data itu: kecamatan (kabupaten) atau kalurahan (kecamatan terpilih).
  const poorWhere = useStats('penduduk-miskin', kec, on('penduduk-miskin') && !!poorLast,
    { by: kec ? 'kalurahan' : 'kecamatan', sum: 'jumlah', where: 'tahun', eq: String(poorLast?.tahun ?? '') });
  // Merah peringatan (`--danger`, sama dengan angka merah kartu) memudar per peringkat (1 = penuh). 5 wilayah teratas
  // (kecamatan, atau kalurahan bila kecamatan dipilih): satu warna per peringkat.
  const DANGER_STEPS = [100, 80, 60, 45, 30].map((p) => `color-mix(in srgb, var(--danger) ${p}%, transparent)`);
  const poorRank = [...(poorWhere.data ?? [])].filter((r) => r.key && r.value).sort((a, b) => b.value! - a.value!).slice(0, 5)
    .map((r, i) => ({ key: r.key!, label: r.key!, value: r.value!, color: DANGER_STEPS[i]! }));
  // Ringkasan sebaran (basis = jumlah semua wilayah tahun itu, sama dengan porsi tiap baris).
  const whereRows = (poorWhere.data ?? []).filter((r) => r.key && r.value);
  const whereTotal = whereRows.reduce((s, r) => s + r.value!, 0);
  const mapLink = `/peta${tahun ? `?tahun=${tahun}` : ''}`;

  // Baris survei (data terakhir <= tahun global) yang namanya tak cocok dengan ruas SK: hanya jumlahnya di kartu jalan.
  const ruasYear = Math.max(...(ruas.data ?? []).map((r) => r.tahun));
  const unmatched = (ruas.data ?? []).filter((r) => r.tahun === ruasYear && r.matched === false).length;

  // KPI jalan = kemantapan jalan (indikator PUPR): % panjang Baik + Sedang dari panjang tersurvei, langsung dari km per
  // kondisi tabel survei (audit D3). Tanpa reklasifikasi ruas berambang 20% (audit D4); ambang itu hanya untuk warna
  // ruas di peta & rincian kelas. Pembanding = survei sebelumnya dengan rumus sama (selisih poin persen).
  const prevSurvey = Math.max(...(ruas.data ?? []).map((r) => r.tahun).filter((y) => y < ruasYear));
  const mantapOf = (year: number) => {
    const rows = (ruas.data ?? []).filter((r) => r.tahun === year);
    const km = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const total = km((r) => r.baik + r.sedang + r.rusakRingan + r.rusakBerat);
    return total ? { pct: (100 * km((r) => r.baik + r.sedang)) / total, total, rusakBerat: km((r) => r.rusakBerat) } : null;
  };
  const mantap = mantapOf(ruasYear);
  const mantapPrev = mantapOf(prevSurvey);
  const roadDiff = mantap && mantapPrev ? Math.round(mantap.pct - mantapPrev.pct) : null;
  const roadSurveyed = sum(jalan, 'count') - sum(jalan, 'count', 'Belum Disurvei');

  // Pembanding tahunan layer bertahun (mis. PJU 2025 → 2026) dari deret `layers` timeseries; kunci = nama tanpa tahun
  // (sama dengan SQL timeseries). Layer statis: tanpa pembanding, bukan angka karangan.
  const layerDelta = (slug: string) => {
    const l = bySlug(slug);
    if (!l?.year) return undefined;
    const k = l.name.replace(/\s*\d{4}$/, '');
    const pts = (series.data ?? []).filter((p) => p.layers?.[k] && p.tahun <= l.year!);
    const [prev, cur] = [pts.at(-2), pts.at(-1)];
    if (!prev || cur?.tahun !== l.year) return undefined;
    const d = cur.layers![k]! - prev.layers![k]!;
    return d ? { d, tahun: prev.tahun } : undefined;
  };
  const pjuDelta = layerDelta('pju');
  const signedN = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

  // Kartu Ringkasan; juga dipakai builder KPI untuk menyimpan lebar kartu (urutan tata letak lengkap).
  const entries: BoardEntry[] = [
    { key: 'hero', label: t('ov.poor'), span: 12, node: (
      <HeroKpi caption={poorOdd.size ? `${t('ov.poorTrend')} (${t('ov.incomparableShort', { tahun: [...poorOdd].join(', ') })})` : t('ov.poorTrend')} icon={Persons}
        extra={poorRank.length > 0 && (
          <div className={LEGEND_BOX}>
            <p className={LEGEND_TITLE}>{t(kec ? 'ov.poorTopKal' : 'ov.poorTopKec', { tahun: poorLast!.tahun })}</p>
            {/* Batang relatif wilayah terbanyak; angka = jiwa, porsi dari total muncul saat diarahkan. */}
            <RankBars items={poorRank} format={fmt} highlight={poorRank[0]!.key}
              detail={(i) => t('ov.poorShare', { pct: pct(i.value, whereTotal) })} />
          </div>
        )}
        label={t('ov.poor')} value={poorLast?.miskin ?? null} format={(n) => t('ov.people', { n: fmt(n) })}
        loading={series.isPending}
        delta={poorDelta !== null ? { text: t('ov.kpiPoorDelta', { delta: `${poorDelta > 0 ? '+' : ''}${fmt(poorDelta)}`, pct: `${poorDelta > 0 ? '+' : ''}${pct(poorDelta, poorFirst!.miskin)}%`, tahun: poorFirst!.tahun }), up: poorDelta > 0, bad: poorDelta > 0 } : undefined}
        sub={poorDelta === null ? t('ov.kpiPoorSub') : undefined} to={peta('penduduk-miskin')}>
        <Spark points={poor.map((p) => ({ label: `${p.tahun}${poorOdd.has(p.tahun) ? '*' : ''}`, value: p.miskin }))} className="min-h-28 flex-1" labels={fmtCompact} />
        {poorLast && tahun !== undefined && poorLast.tahun !== tahun && <YearNote tahun={tahun} year={poorLast.tahun} />}
      </HeroKpi>
    ) },
    { key: 'road', label: t('ov.kpiRoad'), span: 4, node: (
      <div ref={kpiRow} className="h-full">
      <Kpi icon={TriangleExclamation} label={t('ov.kpiRoad')} value={mantap && Math.round(mantap.pct)} format={(n) => t('ov.mantap', { pct: fmt(n) })}
          loading={allLayers.isPending || jalanQ.loading || ruas.isLoading} to={peta('jalan-kabupaten')}
          sub={mantap && jalan ? t('ov.kpiRoadSub', { km: fmt(Math.round(mantap.rusakBerat * 10) / 10), surveyKm: fmt(Math.round(mantap.total)), n: fmt(roadSurveyed), total: fmt(sum(jalan, 'count')), tahun: ruasYear }) : undefined}
          delta={roadDiff ? { text: t('ov.kpiYoY', { delta: t('ov.pp', { n: signedN(roadDiff) }), tahun: prevSurvey }), up: roadDiff > 0, bad: roadDiff < 0 } : undefined}>
          {/* Rincian per kelas (termasuk belum disurvei, porsi dari seluruh ruas SK); klik kelas = saring peta mini. */}
          <RoadOverview network={jalan} layer={bySlug('jalan-kabupaten')} unmatched={unmatched} hiddenKelas={roadHidden} onHiddenKelas={setRoadHidden} />
        </Kpi>
      </div>
    ) },
    { key: 'pju', label: t('ov.kpiPju'), span: 4, node: (
      <Kpi icon={Bulb} label={t('ov.kpiPju')} value={pju ? sum(pju, 'count') : null} format={(n) => t('ov.points', { n: fmt(n) })}
          loading={allLayers.isPending || pjuQ.loading} to={peta('pju')}
          delta={pjuDelta && { text: t('ov.kpiYoY', { delta: signedN(pjuDelta.d), tahun: pjuDelta.tahun }), up: pjuDelta.d > 0, bad: pjuDelta.d < 0 }}
          // Baris keterangan diisi (setara "6 jenis fasilitas" di Utilitas), bukan baris kosong di bawah angka.
          sub={pju ? t('ov.kpiPjuSub', { n: fmt(pju.filter((r) => r.key && r.count > 0).length) }) : undefined}>
          <Composition items={top(pju, bySlug('pju'))} total={sum(pju, 'count')} />
        </Kpi>
    ) },
    { key: 'util', label: t('ov.kpiSpm'), span: 4, node: (
      <Kpi icon={Wrench} label={t('ov.kpiSpm')} value={util ? sum(util, 'count') : null}
          format={(n) => t('ov.facilities', { n: fmt(n) })} loading={allLayers.isPending || utilQ.loading} to={peta('utilitas-umum')}
          sub={util ? t('ov.kpiUtilSub', { n: fmt(util.filter((r) => r.key && r.count > 0).length) }) : undefined}>
          <Composition items={top(util, bySlug('utilitas-umum'), true)} total={sum(util, 'count')} />
        </Kpi>
    ) },
    // KPI kustom (resep dari dashboard, tanpa kode).
    ...kpis.map((k): BoardEntry => ({ key: `kpi:${k.id}`, label: k.label, span: 4,
      node: <KpiTile k={k} all={all} layers={layers} kecamatan={kec} tahun={tahun} to={peta} />,
      actions: <KpiActions k={k} onEdit={() => setKpiDialog(k)} /> })),
    { key: 'tutupan', label: t('ov.kpiSawah'), span: 12, node: (
      // `min-height` (bukan `height`): isi yang lebih tinggi (mis. ponsel) tetap memanjangkan kartu.
      <div className="flex h-full flex-col [&>*]:flex-1" style={{ minHeight: kpiH || undefined }}>
      <Kpi wide bare icon={Droplet} label={t('ov.kpiSawah')} value={tutupan ? Math.round(tutupanTotal) : null} format={haLabel}
          loading={allLayers.isPending || tutupanQ.loading} to={peta('tutupan-lahan')}>
          <LandCover rows={tutupan ?? []} layer={bySlug('tutupan-lahan')} total={tutupanTotal} />
        </Kpi>
      </div>
    ) },
    // Peta + potensi bencana berdampingan; tombol kelas di KPI Kondisi jalan menyaring peta ini.
    { key: 'minimap', label: t('ov.mapTitle'), span: 7, node: <MiniMap layers={layers} kecamatan={kec} gaps={yearGaps(all, tahun)} tahun={tahun} hidden={mapHidden} /> },
    { key: 'hazard', label: t('ov.hazard'), span: 5, node: (
      <HazardCard rows={bahayaQ.data ?? []} totalHa={sum(batasQ.data, 'areaHa')} layer={bySlug('potensi-bencana')}
        loading={allLayers.isPending || bahayaQ.loading} retry={bahayaQ.retry} />
    ) },
    // Analisis untuk keputusan: fasilitas, jalan, dan permukiman yang terpapar zona bahaya tinggi.
    { key: 'exposure', label: t('ins.exposure'), span: 12, node: <HazardExposure kecamatan={kec} /> },
    // Tren selebar penuh (sumbu waktu butuh lebar).
    { key: 'trend', label: t('ov.trend'), span: 12, node: (
      <Panel icon={ChartLine} title={t('ov.trend')} className="h-full"
        action={<YearRange years={range.years} dari={range.dari} sampai={range.sampai} onChange={range.set} onReset={range.reset} isFull={range.isFull} className="w-full sm:w-auto" />}>
        <TimeSeries points={points} loading={series.isPending} retry={retryOf(series)} />
      </Panel>
    ) },
    // Pola ruang selebar penuh (treemap butuh lebar).
    { key: 'pola', label: t('ov.pola'), span: 12, node: <PolaRuang rows={polaQ.data ?? []} layer={bySlug('penggunaan-lahan')} loading={allLayers.isPending || polaQ.loading} retry={polaQ.retry} /> },
  ];

  return (
    <>
      <PageHeader
        title={<>{t(greetingKey(now))}, {me?.name.split(' ')[0]}</>}
        subtitle={<time dateTime={now.toISOString().slice(0, 10)}>{fmtLongDate(now)}</time>}
        action={
          // Urutan: filter | aksi sekunder | aksi primer di ujung kanan.
          <div className="flex flex-wrap items-center gap-2">
            <KecamatanSelect value={kec} onChange={(k) => setParams((p) => patchParams(p, { kec: k }), { replace: true })} className="w-full sm:w-56" />
            <YearSelect years={years} value={tahun} onChange={setTahun} />
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-separator sm:block" />
            {canEdit(me) && (
              <Button variant={editing ? 'primary' : 'secondary'} aria-pressed={editing} onPress={() => setEditing((e) => !e)} className="max-sm:flex-1">
                {editing ? <Check className="size-4" /> : <Pencil className="size-4" />} {t(editing ? 'ov.editDone' : 'ov.edit')}
              </Button>
            )}
            {canEdit(me) && (
              <Link to="/data" className={cn(buttonVariants({ variant: 'secondary' }), 'max-sm:flex-1')}>
                <Database className="size-4" /> {t('ov.manageData')}
              </Link>
            )}
            <Link to={mapLink} className={cn(buttonVariants(), 'group max-sm:flex-1')}>
              {t('ov.openMap')} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        }
      />
      {/* Filter silang yang disetel di dalam kartu (kelas jalan) diangkat ke sini: peta mini di atas kartu ikut tersaring. */}
      {roadHidden.length > 0 && (
        <div role="group" aria-label={t('ov.activeFilters')} className="-mt-4 mb-6 flex flex-wrap items-center gap-2">
          {ROAD_PARTS.filter((p) => roadHidden.includes(p.kelas)).map((p) => (
            <FilterChip key={p.kelas} label={t('ov.chipRoadHidden', { kelas: t(`road.${p.key}`) })}
              onRemove={() => setRoadHidden((h) => h.filter((k) => k !== p.kelas))} />
          ))}
          <button type="button" onClick={() => setRoadHidden([])} className="text-xs text-accent hover:underline">{t('common.clearFilters')}</button>
        </div>
      )}

      {/*
        Bento 12 kolom (tata letak acuan "fitness bento"): hero lebar dengan grafik tertanam, lalu jajaran empat KPI, lalu
        peta + kondisi jalan, tren, lalu pola ruang + bahaya. Pola kartu sama: judul, satu angka utama, satu
        baris pembanding, rincian. Merah = arah buruk (miskin naik, jalan rusak, bahaya tinggi); selain itu warna netral.
        KPI mengikuti filter kecamatan + tahun global; `null` = belum ada data, bukan 0.
      */}
      {/*
        Kartu Ringkasan (pola sama: judul, satu angka utama, satu baris pembanding, rincian). Merah = arah buruk (miskin naik,
        jalan rusak, bahaya tinggi). KPI mengikuti filter kecamatan + tahun global; `null` = belum ada data, bukan 0.
        Urutan bawaan: hero, tiga KPI, KPI kustom, tutupan lahan, peta + bahaya, tren, pola ruang. Editor bisa menyusun
        ulang, mengubah lebar, dan menyembunyikan kartu ("Edit ringkasan"); tata letaknya tersimpan di DB (ringkasan_layout).
      */}
      {editing && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-6 py-3 text-sm">
          <p className="min-w-0 flex-1 basis-64 text-muted">{t('lay.hint')}</p>
          <div className="flex items-center gap-1">
            <Tip label={t('lay.undo')}>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('lay.undo')} isDisabled={!layout.canUndo} onPress={layout.undo}><ArrowUturnCcwLeft className="size-4" /></Button>
            </Tip>
            <Tip label={t('lay.redo')}>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('lay.redo')} isDisabled={!layout.canRedo} onPress={layout.redo}><ArrowUturnCwRight className="size-4" /></Button>
            </Tip>
            <Button size="sm" variant="tertiary" isDisabled={!layout.cards.length} onPress={() => layout.save([])}>
              <ArrowRotateLeft className="size-4" /> {t('lay.reset')}
            </Button>

          </div>
        </div>
      )}
      <Board editing={editing} cards={layout.cards} onChange={layout.save} tail={<AddKpiTile onPress={() => setKpiDialog('new')} />} entries={entries} />
      {kpiDialog && <KpiDialog kpi={kpiDialog === 'new' ? undefined : kpiDialog} all={all} layers={layers} kecamatan={kec} tahun={tahun} onClose={() => setKpiDialog(null)}
        span={kpiDialog === 'new' ? 4 : arrange(layout.cards, entries).find((c) => c.key === `kpi:${kpiDialog.id}`)!.span}
        // Lebar dari builder = lebar kartu di grid. KPI baru (belum di `entries`) ditaruh setelah KPI kustom terakhir, posisi bawaannya.
        onSpan={(id, span) => layout.save(withSpan(arrange(layout.cards, entries), `kpi:${id}`, span))} />}
    </>
  );
}
