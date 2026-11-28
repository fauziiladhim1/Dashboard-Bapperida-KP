import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, MapPin, PencilToLine, VectorSquare } from '@gravity-ui/icons';
import { Badge, Button, buttonVariants, CloseButton, Drawer, ListBox, ScrollShadow, Select } from '@heroui/react';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { AnimatePresence, m } from 'motion/react';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map';
import { VectorLayers } from '@/components/map/VectorLayers';
import { MapHover, type Hover } from '@/components/map/MapHover';
import { UserLocation, type Fix } from '@/components/map/UserLocation';
import { Buildings3D } from '@/components/map/Buildings3D';
import { HazardRaster, identify, kelasOf, type Boundary } from '@/components/map/HazardRaster';
import { featureLabel, HoverTip, labelKey, LegendSymbol, POPUP, PopupCard, rowClass } from '@/components/map/MapOverlays';
import { Collapse, EASE, Toggle } from '@/components/common/motion';
import { KecamatanSelect } from '@/components/common/KecamatanSelect';
import { Tip } from '@/components/common/Tip';
import { YearNote, YearSelect } from '@/components/common/YearRange';
import { DICT } from '@/lib/i18n';
import { endpoints, refreshData } from '@/lib/api';
import { canEdit, useMe } from '@/hooks/use-auth';
import { FeatureDialog } from '@/features/data/FeatureDialog';
import { DrawPanel, DrawTool, type Draft } from './DrawTool';
import { fmt, fmtCompact, fmtDate, getLocale } from '@/lib/format';
import { activeFields, classLabel, classOrder, colorField, colorOf, groupRows, KULON_PROGO_CENTER, legendOf } from '@/lib/layer-style';
import { fill } from '@/components/common/card-style';
import { showValue } from '@/lib/field-types';
import { usePrefs, useT } from '@/lib/prefs';
import { cn, sentenceCase } from '@/lib/utils';
import { isTimed, latestVersions, patchParams, pickYear, useYear, yearGaps, type YearGap } from '@/lib/year-range';
import type { Layer, MediaItem } from '@/lib/types';
import { hasDocs, urgencyOf } from '@/lib/urgency';
import { useSettings } from '@/lib/settings';
import { UrgencyBadge } from '@/components/common/UrgencyBadge';

/** `hidden`: kelas yang dimatikan di legenda (kunci kelas, atau indeks stop untuk layer bertingkat). */
type LayerRow = { on: boolean; opacity: number; hidden: string[] };
type LayerState = Record<string, Partial<LayerRow>>;
type TimedYear = { year?: number; count: number };
/**
 * Slug layer DB Potensi Bencana. Di peta tempatnya diisi raster InaRISK live; zona vektornya (skrip db:inarisk) hanya
 * dipakai statistik Ringkasan, tidak digambar.
 */
const HAZARD_SLUG = 'potensi-bencana';
/** Jenis bahaya = layanan ImageServer InaRISK (nama sama dengan apps/api/src/db/inarisk.ts). Satu jenis tampil sekaligus. */
const HAZARDS = [
  { id: 'banjir', service: 'layer_bahaya_banjir' }, { id: 'longsor', service: 'layer_bahaya_tanah_longsor' },
  { id: 'gempa', service: 'layer_bahaya_gempabumi' }, { id: 'tsunami', service: 'layer_bahaya_tsunami' },
  { id: 'abrasi', service: 'layer_bahaya_gelombang_ekstrim_dan_abrasi' }, { id: 'kekeringan', service: 'layer_bahaya_kekeringan' },
  { id: 'cuaca', service: 'layer_bahaya_cuaca_ekstrim' }, { id: 'likuefaksi', service: 'layer_bahaya_likuefaksi' },
  { id: 'multi', service: 'layer_bahaya_multi' },
] as const;
type HazardId = (typeof HAZARDS)[number]['id'];
type Selected = { id: string | number; layer: Layer; lng: number; lat: number };
/** Alat gambar catatan rencana: satu layer catatan per jenis geometri (seed API), digambar editor langsung di peta. */
const DRAW_TOOLS = [
  { slug: 'catatan-titik', label: 'draw.point', sub: 'draw.pointSub', Icon: MapPin },
  { slug: 'catatan-garis', label: 'draw.line', sub: 'draw.lineSub', Icon: PencilToLine },
  { slug: 'catatan-area', label: 'draw.polygon', sub: 'draw.polygonSub', Icon: VectorSquare },
] as const;
/** Gambar selesai -> dialog fitur baru berisi geometrinya (WKT) untuk diberi judul & catatan. */
type Editing = { layer: Layer; wkt: string };

export default function PetaPage() {
  const t = useT();
  const layers = useQuery({ queryKey: ['layers'], queryFn: endpoints.layers });
  const [state, setState] = useState<LayerState>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const qc = useQueryClient();
  const editor = canEdit(useMe().data);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Panel catatan rencana tertutup saat halaman dibuka: peta lebih lega, editor membukanya bila perlu.
  const [drawOpen, setDrawOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [params, setParams] = useSearchParams();
  // Filter kecamatan di URL (?kec=) agar bisa dibuka langsung dari hasil pencarian wilayah.
  const kecamatan = params.get('kec') ?? undefined;
  const setKecamatan = useCallback((k?: string) => setParams((p) => patchParams(p, { kec: k }), { replace: true }), [setParams]);
  const bbox = params.get('bbox')?.split(',').map(Number);
  const target = params.get('f');
  const flyTo = target ? { lng: Number(params.get('lng')), lat: Number(params.get('lat')) } : null;
  const slugParam = params.get('layer');
  // Hasil pencarian topbar: layernya dinyalakan; fitur/kalurahan juga dipilih (popup + sorotan). Param layer-saja langsung
  // dibersihkan; param fitur dibersihkan oleh FlyTo/FitBounds setelah peta bergerak.
  useEffect(() => {
    const layer = slugParam ? layers.data?.find((l) => l.slug === slugParam) : undefined;
    if (!layer) return;
    update(layer.slug, { on: true }, layer);
    // Potensi bencana digambar sebagai raster InaRISK (bukan layer vektor): nyalakan barisnya. `?bahaya=` = nama jenis
    // dari DB (`jenis_bahaya`, sama dengan label ID `map.hz.*`, mis. "Tanah Longsor" -> longsor); kosong/tidak dikenal = multi-bahaya.
    if (layer.slug === HAZARD_SLUG) {
      const jenis = params.get('bahaya')?.toLocaleLowerCase('id');
      setHazard(HAZARDS.find((h) => jenis && DICT.id[`map.hz.${h.id}`].toLocaleLowerCase('id') === jenis)?.id ?? 'multi');
      setHazardOn(true);
    }
    if (target && flyTo) setSelected({ id: target, layer, ...flyTo });
    else setParams((p) => patchParams(p, { layer: null, bahaya: null }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, slugParam, layers.data]);

  // Satu tahun untuk seluruh peta: tiap layer memakai versi terakhir <= tahun, choropleth memakai tahun itu.
  const year = useYear();
  const tahun = year.tahun;
  const current = useMemo(() => new Set(latestVersions(layers.data ?? [], tahun).map((l) => l.slug)), [layers.data, tahun]);
  const [hazardOn, setHazardOn] = useState(false);
  const [hazard, setHazard] = useState<HazardId>('banjir');
  const [hazardOpacity, setHazardOpacity] = useState(0.7);
  const [me, setMe] = useState<Fix | null>(null);
  const stateOf = (l: Layer): LayerRow => ({ on: l.visibleDefault, opacity: 1, hidden: [], ...state[l.slug] });
  // Layer turunan (mis. Kawasan Pertanian) adalah subset poligon layer sumbernya (Rencana Pola Ruang):
  // menyalakan satu anggota keluarga mematikan yang lain agar poligon yang sama tidak tergambar dua kali.
  const family = (x: Layer) => x.sourceLayerId ?? x.id;
  const update = (slug: string, patch: Partial<LayerState[string]>, l: Layer) =>
    setState((s) => {
      const next = { ...s, [slug]: { ...stateOf(l), ...s[slug], ...patch } };
      if (patch.on) {
        // Baris layer hanya ada setelah daftar layer termuat.
        for (const x of layers.data!) if (x.slug !== slug && family(x) === family(l)) next[x.slug] = { ...stateOf(x), ...s[x.slug], on: false };
      }
      return next;
    });

  // Urutan render: poligon di bawah, garis, lalu titik di atas.
  // Layer multi-tahun (atribut `tahun`): tahun efektif = data terakhir <= tahun global, dari statistik per tahun.
  const timedLayers = useMemo(() => (layers.data ?? []).filter(isTimed), [layers.data]);
  const timedStats = useQueries({ queries: timedLayers.map((l) => ({ queryKey: ['stats', l.slug, 'by-tahun'], queryFn: () => endpoints.stats(l.slug, { by: 'tahun' }) })) });
  const timed: Record<string, TimedYear> = Object.fromEntries(timedLayers.map((l, i) => {
    const rows = timedStats[i]?.data ?? [];
    const year = pickYear(rows.map((r) => Number(r.key)), tahun);
    return [l.slug, { year, count: rows.find((r) => Number(r.key) === year)?.count ?? 0 }];
  }));
  const timedKey = JSON.stringify(timed);

  const visible = useMemo(() => {
    const order = { Polygon: 0, LineString: 1, Point: 2 };
    return (layers.data ?? [])
      // Potensi bencana tampil sebagai raster InaRISK (HazardRaster), bukan zona vektor DB.
      .filter((l) => l.slug !== HAZARD_SLUG && (state[l.slug]?.on ?? l.visibleDefault) && l.featureCount > 0 && current.has(l.slug) && (!timed[l.slug] || timed[l.slug]!.year !== undefined))
      .map((l) => ({ ...l, opacity: state[l.slug]?.opacity ?? 1, hidden: state[l.slug]?.hidden, tahun: timed[l.slug]?.year }))
      .sort((a, b) => order[a.geomType] - order[b.geomType]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `timedKey` mewakili `timed`
  }, [layers.data, state, current, timedKey]);
  // Batas wilayah untuk memotong raster bahaya (ikut filter kecamatan).
  const boundary = useQuery({
    queryKey: ['boundary', kecamatan], enabled: hazardOn, staleTime: Infinity,
    queryFn: () => fetch(endpoints.exportUrl('batas-administrasi', 'geojson', kecamatan)).then((r) => r.json() as Promise<Boundary>),
  });
  const [hazardPick, setHazardPick] = useState<{ lng: number; lat: number } | null>(null);
  const service = HAZARDS.find((h) => h.id === hazard)!.service;

  const onFeatureClick = useCallback((f: MapGeoJSONFeature, layer: Layer, p: { lng: number; lat: number }) => {
    // Raster bahaya menyala: klik di area batas administrasi membuka nilai bahaya (HazardRaster), bukan popup kalurahan.
    // Sedang menggambar: klik peta menambah titik gambar, bukan membuka popup fitur di bawahnya.
    if (draft || (hazardOn && layer.slug === 'batas-administrasi')) return;
    if (f.id !== undefined) setSelected({ id: f.id, layer, lng: p.lng, lat: p.lat });
  }, [hazardOn, draft]);
  const tools = DRAW_TOOLS.flatMap((d) => (layers.data ?? []).filter((l) => l.slug === d.slug).map((layer) => ({ ...d, layer })));
  // Alat yang sama ditekan lagi = batal; alat lain = mulai gambar baru. Tooltip hover disembunyikan selama menggambar.
  const onDrawFinish = (wkt: string) => { setEditing({ layer: draft!.layer, wkt }); setDraft(null); };
  const pickTool = (layer: Layer) => { setSelected(null); setHover(null); setDraft(draft?.layer.slug === layer.slug ? null : { layer, pts: [] }); };
  const onDrawSaved = (l: Layer) => {
    // Gambar baru langsung terlihat: layernya dinyalakan, daftar layer (versi tile) & fitur dimuat ulang.
    update(l.slug, { on: true }, l);
    return refreshData(qc, ['layers', 'features', 'feature']);
  };

  // Baris Potensi Bencana (raster InaRISK live); dipasang di slot layer `potensi-bencana` panel.
  const hazardLayer = layers.data?.find((l) => l.slug === HAZARD_SLUG);
  const hazardClasses = Object.entries(hazardLayer?.style.classes ?? {}).map(([key, color]) => ({ key, label: key, color }));
  const hazardRow = (
  <div className={rowClass(hazardOn)}>
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-3">
        <LegendSymbol color={hazardClasses.at(-1)?.color ?? '#FF0000'} geom="Polygon" />
        <span className="break-words font-medium text-heading">{t('map.hazard')}</span>
      </span>
      <Toggle checked={hazardOn} onChange={setHazardOn} label={t('map.show', { name: t('map.hazard') })} />
    </div>
    <Collapse open={hazardOn}>
      <div className="flex flex-col gap-3 pt-3 pb-1">
        {/* Sama dengan dropdown lain: terbuka ke bawah, dibalik ke atas bila ruang di bawah tidak cukup (mis. dekat dasar panel). */}
        <Select aria-label={t('map.hazardType')} selectedKey={hazard} onSelectionChange={(k) => k !== null && setHazard(k as HazardId)}>
          <Select.Trigger className="min-h-9 gap-2 bg-surface text-sm text-heading">
            <Select.Value className="min-w-0 break-words font-medium" />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox items={HAZARDS.map((h) => ({ id: h.id, name: t(`map.hz.${h.id}`) }))}>
              {(it: { id: string; name: string }) => (
                <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>
              )}
            </ListBox>
          </Select.Popover>
        </Select>
        <Opacity value={hazardOpacity} onChange={setHazardOpacity} label={t('map.opacityOf', { name: t('map.hazard') })} />
        {/* Skala ordinal satu baris, kiri ke kanan Rendah → Tinggi; rentang indeks sama dengan `kelasOf` (sepertiga 0–1). */}
        <div className="rounded-control bg-default/60 p-3">
          <p className="mb-2 text-xs font-medium text-heading">{t('map.hazardSource')}</p>
          <ol className="grid grid-cols-3 gap-0.5 text-xs">
            {(hazardLayer?.style.ordinal ?? []).map((k) => hazardClasses.find((c) => c.key === k)).filter((c) => !!c).map((c, i, all) => (
              <li key={c.key} className="flex min-w-0 flex-col gap-1.5">
                <span aria-hidden className={cn('h-2 ring-1 ring-black/15 ring-inset dark:ring-white/25', i === 0 && 'rounded-l-full', i === all.length - 1 && 'rounded-r-full')} style={{ backgroundColor: c.color }} />
                <span className="font-medium text-heading">{c.key in KELAS_KEY ? t(`map.hz.${KELAS_KEY[c.key as keyof typeof KELAS_KEY]}`) : c.label}</span>
                <span className="text-muted tabular-nums">{HAZARD_RANGE[i]}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-muted">{t('map.hazardLive')}</p>
      </div>
    </Collapse>
  </div>
  );

  const panel = (
    <LayerPanel
      layers={layers.data ?? []}
      stateOf={stateOf}
      update={update}
      kecamatan={kecamatan}
      onKecamatan={setKecamatan}
      inRange={(l) => current.has(l.slug)}
      timed={timed}
      header={<YearSelect years={year.years} value={tahun} onChange={year.set} className="mt-2 w-full sm:w-full" />}
      gaps={yearGaps(layers.data ?? [], tahun)}
      tahun={tahun}
      slots={{ [HAZARD_SLUG]: hazardRow }}
    >
      {/* Layer DB `potensi-bencana` sudah ada (Kebencanaan): baris InaRISK menggantikannya di sana, bukan baris kedua di sini. */}
      {!layers.data?.some((l) => l.slug === HAZARD_SLUG) && (
        <section className="mb-1">
          <p className="px-3 pt-4 pb-2 text-xs font-medium text-nav-section">{t('nav.supporting')}</p>
          {hazardRow}
        </section>
      )}
    </LayerPanel>
  );

  return (
    <div className="relative h-[calc(100dvh-80px)] min-h-[420px] overflow-hidden">
      <Map center={KULON_PROGO_CENTER} zoom={10.2} attributionControl={{ compact: true }}>
        <Buildings3D />
        <MapControls position="bottom-right" showZoom showCompass showLocate showFullscreen onLocate={setMe} />
        {me && <UserLocation initial={me} />}
        <VectorLayers layers={visible} kecamatan={kecamatan} tahun={tahun} onFeatureClick={onFeatureClick} selected={selected && { slug: selected.layer.slug, id: selected.id }} />
        {/* Saat menggambar, kursor silang & klik milik DrawTool (bukan sorotan/tooltip objek di bawahnya). */}
        {!draft && <MapHover onHover={setHover} />}
        {hazardOn && <HazardRaster service={service} opacity={hazardOpacity} boundary={boundary.data} onPick={setHazardPick} />}
        {hazardOn && hazardPick && (
          <MapPopup longitude={hazardPick.lng} latitude={hazardPick.lat} onClose={() => setHazardPick(null)} closeOnClick={false} className={POPUP}>
            <HazardPopup service={service} hazard={hazard} {...hazardPick} onClose={() => setHazardPick(null)} />
          </MapPopup>
        )}
        {bbox?.length === 4 && bbox.every(Number.isFinite) && (
          <FitBounds bbox={bbox as [number, number, number, number]} onDone={() => setParams((p) => patchParams(p, { bbox: null, f: null, layer: null, lng: null, lat: null }), { replace: true })} />
        )}
        {/* Kalurahan hasil pencarian membawa bbox: cukup zoom ke batasnya, tidak terbang ke titik tengah. */}
        {flyTo && !bbox && <FlyTo lng={flyTo.lng} lat={flyTo.lat} onDone={() => setParams((p) => patchParams(p, { f: null, layer: null, lng: null, lat: null }), { replace: true })} />}
        {selected && (
          <MapPopup longitude={selected.lng} latitude={selected.lat} onClose={() => setSelected(null)} closeOnClick={false} className={POPUP}>
            <FeaturePopup selected={selected} tahun={tahun} onClose={() => setSelected(null)} />
          </MapPopup>
        )}
        {draft && (
          <DrawTool draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onFinish={onDrawFinish} />
        )}
      </Map>
      {hover && <HoverTip hover={hover} layers={layers.data ?? []} />}

      {/* Peta penuh di belakang sidebar melayang; panel layer mulai 32px di kanan sidebar (celah untuk tab perkecil/perbesar 24px). */}
      <div className="absolute top-4 left-4 z-30 hidden transition-[left] duration-200 md:block lg:left-[calc(var(--sidebar-offset)+2rem)]">
        <AnimatePresence mode="wait" initial={false}>
          {panelOpen ? (
            <m.aside
              key="panel"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2, ease: EASE }}
              style={{ transformOrigin: 'top left' }}
              className="relative flex max-h-[calc(100dvh-8rem)] w-80 flex-col overflow-hidden rounded-2xl bg-surface shadow-float"
            >
              <Tip label={t('map.collapse')} side="right">
                <CloseButton onPress={() => setPanelOpen(false)} aria-label={t('map.collapse')} className="absolute top-4 right-4 z-10" />
              </Tip>
              {panel}
            </m.aside>
          ) : (
            <m.div key="fab" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}>
              <Badge.Anchor>
                <Button variant="tertiary" onPress={() => setPanelOpen(true)} aria-label={t('map.expand')} className="bg-surface text-sm font-medium shadow-float">
                  <Layers className="size-4" /> {t('map.layers')}
                </Button>
                <Badge color="accent" size="sm">{visible.length}</Badge>
              </Badge.Anchor>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {/* Kanan atas: tombol panel layer (mobile) lalu panel catatan rencana (editor), sepola panel layer di kiri.
          z-30: panel di atas tooltip objek peta (HoverTip z-20) agar tidak tertutup saat kursor di dekat tepi. */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-2">
        <div className="md:hidden"><MobilePanel label={t('map.layers')} title={t('map.panelTitle')}>{panel}</MobilePanel></div>
        {editor && tools.length > 0 && (
          <DrawPanel tools={tools} draft={draft} onPick={pickTool} onChange={setDraft} onCancel={() => setDraft(null)} onFinish={onDrawFinish}
            open={drawOpen} onOpen={setDrawOpen} />
        )}
      </div>
      {editing && (
        <FeatureDialog layer={editing.layer} featureId={null} draftWkt={editing.wkt} readOnly={false}
          onClose={() => setEditing(null)} onSaved={() => onDrawSaved(editing.layer)} />
      )}
    </div>
  );
}

type PanelProps = {
  layers: Layer[];
  stateOf: (l: Layer) => LayerRow;
  update: (slug: string, patch: Partial<LayerRow>, l: Layer) => void;
  kecamatan?: string;
  onKecamatan: (k?: string) => void;
  /** Layer yang bukan versi tahun terpilih: toggle nonaktif. */
  inRange: (l: Layer) => boolean;
  /** Tahun efektif & jumlah fitur tahun itu untuk layer multi-tahun (atribut `tahun`). */
  timed?: Record<string, TimedYear>;
  /** Celah data per seri bertahun di tahun terpilih; ditulis di baris layer seri itu. */
  gaps: YearGap[];
  tahun?: number;
  header?: ReactNode;
  /** Baris pengganti per slug layer (mis. raster InaRISK di tempat layer `potensi-bencana`), tetap di kategorinya. */
  slots?: Record<string, ReactNode>;
  children?: ReactNode;
};

export function LayerPanel({ layers, stateOf, update, kecamatan, onKecamatan, inRange, timed = {}, gaps, tahun, header, slots, children }: PanelProps) {
  const { t, theme } = usePrefs();
  const groups = Object.entries(Object.groupBy(layers, (l) => l.category));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border p-4">
        <h2 className="pr-8 text-base">{t('map.panelTitle')}</h2>
        <p className="mt-1 text-xs text-muted">{t('map.panelSub')}</p>
        <KecamatanSelect value={kecamatan} onChange={onKecamatan} className="mt-4 w-full" />
        {header}
      </div>
      {/* Gutter tetap: scrollbar tidak menimpa tepi kanan kartu baris. */}
      <ScrollShadow className="min-h-0 flex-1 pr-0.5 pb-4 pl-2 [scrollbar-gutter:stable]">
        {groups.map(([category, items], i) => (
          <section key={category} className={cn('flex flex-col gap-2 pb-3', i > 0 && 'border-t border-separator')}>
            <p className="px-3 pt-4 text-xs font-medium text-nav-section">{sentenceCase(category)}</p>
            {items!.map((l) => {
              if (slots?.[l.slug]) return <Fragment key={l.slug}>{slots[l.slug]}</Fragment>;
              const s = stateOf(l);
              const ty = timed[l.slug];
              const usable = ty ? ty.count > 0 : l.featureCount > 0 && inRange(l);
              const on = s.on && usable;
              return (
                <div key={l.slug} className={rowClass(on)}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-start gap-3">
                      <LegendSymbol color={symbolOf(l, theme === 'dark')} geom={l.geomType} className="mt-1.5" />
                      <span className="min-w-0">
                        <span className="font-medium text-heading">{l.name}</span>
                        {/* Jumlah fitur, lalu tahun data sebagai chip (layer statis tanpa chip). Layer kosong: 0 fitur, bukan "bukan versi tahun terpilih". */}
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted tabular-nums">
                          {ty ? t('map.nFeatures', { n: fmt(ty.count) }) : inRange(l) || !l.featureCount ? t('map.nFeatures', { n: fmt(l.featureCount) }) : t('map.outOfRange')}
                          {(ty ? ty.year : l.year) != null && <span className="rounded bg-default px-1.5 py-px text-[11px] text-heading">{ty ? ty.year : l.year}</span>}
                        </span>
                        {/* Layer multi-tahun: tahun terpilih belum ada datanya -> tahun terakhir yang ada, atau belum ada sama sekali. */}
                        {ty && tahun !== undefined && ty.year !== tahun && <YearNote tahun={tahun} year={ty.year} className="mt-1" />}
                        {/* Info tahun di baris seri itu sendiri: versi aktif yang lebih lama, atau seri tanpa data sampai tahun terpilih. */}
                        {tahun !== undefined && (() => {
                          const g = gaps.find((x) => l.year !== null && x.name === l.name.replace(/\s*\d{4}$/, ''));
                          return g && (g.year ? inRange(l) : true) && <YearNote tahun={tahun} year={g.year} className="mt-1" />;
                        })()}
                      </span>
                    </span>
                    <Toggle checked={on} disabled={!usable} onChange={(v) => update(l.slug, { on: v }, l)} label={t('map.show', { name: l.name })} />
                  </div>
                  <Collapse open={on}>
                    <div className="flex flex-col gap-3 pt-3 pb-1">
                      <Opacity value={s.opacity} onChange={(v) => update(l.slug, { opacity: v }, l)} label={t('map.opacityOf', { name: l.name })} />
                      {/* Satu kelas = simbol kepala baris sudah cukup; legenda hanya untuk layer berkelas. */}
                      {on && <LayerLegend layer={l} kecamatan={kecamatan} tahun={tahun} hidden={s.hidden} onHidden={(hidden) => update(l.slug, { hidden }, l)} />}
                    </div>
                  </Collapse>
                </div>
              );
            })}
          </section>
        ))}
        {children}
      </ScrollShadow>
    </div>
  );
}

function MobilePanel({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="tertiary" onPress={() => setOpen(true)} className="bg-surface text-sm font-medium shadow-float">
        <Layers className="size-4" /> {label}
      </Button>
      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Drawer.Content placement="bottom">
          <Drawer.Dialog aria-label={title} className="max-h-[75dvh] p-0">
            <Drawer.Handle />
            {children}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

/** Opasitas satu baris (label, range, persen): range bawaan, track 4px, thumb warna primer. */
function Opacity({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const t = useT();
  return (
    <label className="flex items-center gap-3 text-xs text-heading">
      <span className="shrink-0">{t('map.opacity')}</span>
      <input type="range" min={10} max={100} step={10} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={label} className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]" />
      <output className="w-9 shrink-0 text-right font-medium tabular-nums">{Math.round(value * 100)}%</output>
    </label>
  );
}

/** Terbang ke titik hasil pencarian sekali saat peta siap. */
function FlyTo({ lng, lat, onDone }: { lng: number; lat: number; onDone: () => void }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    // Titik ditaruh di seperempat atas agar popup (terbuka ke bawah) muat di dalam peta.
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: 1200, offset: [0, -map.getContainer().clientHeight / 4] });
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, lng, lat]);
  return null;
}

/** Zoom ke batas wilayah hasil pencarian (bbox [barat, selatan, timur, utara]) sekali saat peta siap. */
function FitBounds({ bbox, onDone }: { bbox: [number, number, number, number]; onDone: () => void }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 48, duration: 1200 });
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, bbox.join(',')]);
  return null;
}

/** Atribut teknis RBI/ArcGIS yang tak berguna bagi pembaca. */
const HIDDEN_ATTR = /^(FID|SHAPE_|LCODE|METADATA|SRS_ID|FCODE|OBJECTID)/i;
/** Wilayah administrasi selalu tampil di popup (kosong = "—", mis. titik pesisir di luar poligon kalurahan). */
const WILAYAH = ['kalurahan', 'kecamatan'];
const empty = (v: unknown) => v == null || String(v).trim() === '';
/** Km per kondisi ruas (dari tabel survei): rincian survei, tidak ditampilkan di popup; kelas cukup lewat badge. */
const CONDITION_KM = ['baik_km', 'sedang_km', 'rusak_ringan_km', 'rusak_berat_km'];
/** Ukuran resmi atribut: dinaikkan ke baris ukuran (Luas/Panjang) di atas tabel, tidak diulang di atribut. */
const MEASURE_KEYS = ['luas_ha', 'panjang_km'];
/** Km dua desimal: ruas pendek (0,85 vs 0,86 km) tidak boleh terbaca sama. */
const fmtKm = (n: number) => n.toLocaleString(getLocale(), { maximumFractionDigits: 2 });

/**
 * Baris tabel atribut popup, urutan sama untuk semua layer: tahun survei (ruas), kolom layer (urutan form), atribut
 * tambahan yang terisi, lalu wilayah di paling bawah (kalurahan, kecamatan; ruas SK: kapanewon).
 * Yang tidak masuk tabel: atribut judul (`labelKey`), atribut kelas (badge di bawah judul), km per kondisi, dan ukuran
 * resmi (`luas_ha`/`panjang_km`, tampil sebagai baris ukuran di atas). Kolom kosong disembunyikan, kecuali kolom wajib
 * dan wilayah ("—").
 */
export const popupRows = (layer: Layer, p: Record<string, unknown>): [string, unknown][] => {
  const title = labelKey(p as never, layer);
  // Layer berkolom kapanewon (ruas SK): kapanewon = kecamatan, dan ruas melintasi banyak kalurahan; wilayah tidak dipaksa.
  const sk = layer.fields.some((f) => f.key === 'kapanewon');
  const region = sk ? ['kapanewon'] : WILAYAH;
  const skip = (k: string) => k === title || k === layer.style?.classField || CONDITION_KM.includes(k)
    || MEASURE_KEYS.includes(k) || region.includes(k) || (k === 'kecamatan' && sk) || k === 'tahun_survei'
    // Sumber & tanggal ambil sudah di catatan sumber popup.
    || k === 'sumber' || k === 'tanggal_ambil';
  const keep = (k: string) => !empty(p[k]) || WILAYAH.includes(k) || !!layer.fields.find((f) => f.key === k)?.required;
  // Field skema: urutan & pilihan dari "Kelola field" (tersembunyi atau popup:false tidak tampil). Atribut di luar skema
  // (kolom impor) tetap tampil seperti biasa; kunci skema yang dimatikan tidak muncul lagi lewat jalur ini.
  const fixed = activeFields(layer).filter((f) => f.popup !== false).map((f) => f.key).filter((k) => !skip(k));
  const extra = Object.keys(p).filter((k) => !layer.fields.some((f) => f.key === k) && !skip(k) && !HIDDEN_ATTR.test(k));
  const survey = empty(p.tahun_survei) ? [] : ['tahun_survei'];
  return [...survey, ...fixed, ...extra, ...region].filter(keep).map((k) => [k, empty(p[k]) ? null : p[k]]);
};
/** Satuan dari akhiran kunci atribut. */
const UNIT: [RegExp, string][] = [[/_m$/, 'm'], [/_km$/, 'km'], [/_ha$/, 'ha'], [/_watt$/, 'W'], [/_va$/, 'VA']];
/** Tahun & kode tidak diberi pemisah ribuan. */
const PLAIN_NUM = /^(tahun|tahun_.+|kode|no_.+)$/;

/** Label kolom yang ditambahkan sistem (tidak ada di `layer.fields`). */
const SYSTEM_LABEL: Record<string, string> = { kecamatan: 'Kecamatan', kalurahan: 'Kalurahan', desa: 'Kelurahan/Desa', keterangan: 'Keterangan', luas_ha: 'Luas (ha)', tahun_survei: 'Tahun survei' };
const prettyKey = (k: string) => SYSTEM_LABEL[k] ?? k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const attrValue = (layer: Layer, k: string, v: unknown) => {
  if (typeof v !== 'number') return showValue(v);
  // Atribut penentu warna bertingkat: nilai + nama kelasnya, mis. "1.633 (Sangat tinggi)".
  const stop = layer.style.steps?.field === k ? layer.style.steps.stops.findLast((s) => v >= s.min) : undefined;
  if (stop) return `${fmt(v)} (${stop.label.replace(/\s*\(.*$/, '')})`;
  if (PLAIN_NUM.test(k)) return String(v);
  // Satuan sudah tertulis di label kolom, mis. "Daya Lampu (W)": tidak diulang di nilai.
  const unit = UNIT.find(([re]) => re.test(k))?.[1];
  const label = layer.fields.find((f) => f.key === k)?.label ?? '';
  const n = unit === 'km' ? fmtKm(v) : fmt(v);
  return unit && !label.includes(`(${unit})`) ? `${n} ${unit}` : n;
};

/**
 * Hasil dokumentasi di popup: foto utama (API mengurutkan paling urgen dulu), keterangan, tanggal, urgensi;
 * thumbnail di bawahnya untuk berganti foto. Semua dibatasi lebar popup.
 */
function DocGallery({ media }: { media: MediaItem[] }) {
  const t = useT();
  const [i, setI] = useState(0);
  const cur = media[Math.min(i, media.length - 1)]!;
  return (
    <figure className="border-t border-separator">
      <picture>
        <source srcSet={`/uploads/${cur.avif}`} type="image/avif" />
        <img src={`/uploads/${cur.webp}`} alt={cur.caption ?? ''} width={cur.width} height={cur.height} loading="lazy" decoding="async" className="h-32 w-full object-cover" />
      </picture>
      <figcaption className="flex flex-col gap-1 px-3.5 py-2 text-xs">
        <span className="flex flex-wrap items-center gap-2">
          {cur.urgensi && <UrgencyBadge value={cur.urgensi} />}
          {cur.tanggal && <span className="text-muted tabular-nums">{fmtDate(cur.tanggal)}</span>}
          {media.length > 1 && <span className="ml-auto text-muted tabular-nums">{t('doc.count', { i: i + 1, n: media.length })}</span>}
        </span>
        {cur.caption && <span className="break-words text-heading">{cur.caption}</span>}
      </figcaption>
      {media.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3.5 pb-2.5">
          {media.map((m, k) => (
            <button key={m.id} type="button" onClick={() => setI(k)} aria-label={t('doc.show', { n: k + 1 })} aria-pressed={k === i}
              className={cn('size-12 shrink-0 overflow-hidden rounded-md ring-2 ring-offset-1 ring-offset-overlay transition', k === i ? 'ring-accent' : 'ring-transparent opacity-70 hover:opacity-100')}>
              <img src={`/uploads/${m.webp}`} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}

/**
 * Tombol popup sekecil isi popup (teks 12px): tinggi 28px, sudut 8px (selaras kartu 16px berpadding 12px), bukan ukuran tombol halaman.
 * Sekunder diberi rona teks 6% alih-alih putih bertepi: tetap terbedakan dari kartu di tema terang maupun gelap.
 */
const POPUP_BTN = 'h-7 min-h-7 gap-1.5 rounded-lg px-3 text-xs font-medium';
// Sekunder bertepi gelap 45% (≥3:1 terhadap kartu): rona tipis sebelumnya terlalu mirip dengan latar popup.
const POPUP_BTN_2ND = 'border border-heading/45 bg-transparent text-heading hover:border-heading hover:bg-heading/[0.06]!';

type Row = [key: string, label: string, value: ReactNode];

/**
 * Tabel atribut popup: kolom label selebar tetap (8,5rem) dan nilai rata kiri, jadi semua nilai mulai di garis yang sama
 * di setiap popup; baris berselang-seling agar mudah diikuti mata.
 */
function AttrRows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] border-t border-separator px-2 py-1.5 text-xs">
      {rows.map(([k, name, v]) => (
        <div key={k} className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-4 rounded-md px-1.5 py-1.5 odd:bg-default/50">
          <dt className="text-muted break-words">{name}</dt>
          <dd className={cn('break-words tabular-nums', v == null ? 'text-subtle' : 'font-medium text-heading')}>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const URG_TONE = { tinggi: 'text-danger', sedang: 'text-warning', rendah: '' } as const;

export function FeaturePopup({ selected, tahun, onClose }: { selected: Selected; tahun?: number; onClose: () => void }) {
  const t = useT();
  const { layer } = selected;
  const { data, isPending } = useQuery({ queryKey: ['feature', String(selected.id), tahun], queryFn: () => endpoints.feature(selected.id, tahun) });
  // Urgensi penanganan dari kelas fitur (mis. Kondisi Jalan "Rusak berat" = tinggi).
  const rules = useSettings().data?.urgensi;
  const urgency = data ? urgencyOf(layer, data.properties, rules) : null;
  const label = (key: string) => layer.fields.find((f) => f.key === key)?.label ?? prettyKey(key);
  const props = data?.properties ?? {};
  const classKey = layer.style.classField;
  const cls = classKey && !empty(props[classKey]) ? String(props[classKey]) : null;
  // Baris ukuran selalu pertama, label tanpa satuan: ukuran resmi atribut (panjang_km SK, luas_ha) diutamakan, selain itu
  // dari geometri. Lalu tahun versi layer, lalu atribut (popupRows), wilayah paling bawah. Sama untuk semua layer.
  const num = (k: string) => (empty(props[k]) ? null : Number(props[k]));
  const areaHa = num('luas_ha') ?? data?.areaHa ?? null;
  const lengthKm = num('panjang_km') ?? data?.lengthKm ?? null;
  // Kelas (bila bukan judul) & urgensi masuk tabel sebagai baris pertama, bukan lencana di atasnya.
  const showClass = !!cls && classKey !== labelKey(props, layer);
  const rows: Row[] = data ? [
    ...(showClass ? [[classKey!, label(classKey!), classLabel(layer.style, cls!)] as Row] : []),
    // Urgensi turunan dari kelas yang sama: hanya tampil bila baris kelas tidak ada.
    ...(urgency && !showClass ? [['_urgensi', t('urg.label'), <span className={URG_TONE[urgency]}>{t(`urg.${urgency}`)}</span>] as Row] : []),
    ...(areaHa != null ? [['_luas', t('map.area'), `${fmt(areaHa)} ha`] as [string, string, string]] : []),
    ...(lengthKm != null ? [['_panjang', t('map.length'), `${fmtKm(lengthKm)} km`] as [string, string, string]] : []),
    // Tahun data fitur (kolom CRUD); data lama tanpa kolom: tahun versi layer.
    // Atribut `tahun` (mis. penduduk miskin) sudah memuat tahun yang sama: baris ini tidak diulang.
    ...((data.tahunData ?? layer.year) != null && empty(props.tahun) ? [['_tahun', t('map.dataYear'), String(data.tahunData ?? layer.year)] as [string, string, string]] : []),
    ...popupRows(layer, props).map(([k, v]): Row => [k, label(k), v == null ? null : attrValue(layer, k, v)]),
  ] : [];
  // Titik: koordinat fitur sendiri; garis/poligon: titik yang diklik.
  const g = data?.geometry;
  const [lng, lat] = g?.type === 'Point' ? g.coordinates : g?.type === 'MultiPoint' && g.coordinates[0] ? g.coordinates[0] : [selected.lng, selected.lat];
  return (
    <PopupCard kicker={layer.name} title={data ? featureLabel(props, layer, selected.id) : t('map.featureNo', { id: selected.id })} onClose={onClose}>
      {isPending ? (
        <p className="px-3.5 pb-3 text-xs text-muted">{t('common.loading')}</p>
      ) : (
        <>
          {/* Galeri dokumentasi hanya untuk layer berkondisi (data statis tidak memakai foto). */}
          {data && hasDocs(layer) && data.media.length > 0 && <DocGallery media={data.media} />}
          {rows.length > 0 && <AttrRows rows={rows} />}
          {/* Baris tambahan popup dari "Kelola field": teks bebas dengan {field} diisi atribut fitur (format sama dengan baris atribut). */}
          {data && !!layer.style.popupLines?.length && (
            <div className="flex flex-col gap-1 border-t border-separator px-3.5 py-2 text-xs text-heading">
              {layer.style.popupLines.map((l, i) => (
                <p key={i} className="whitespace-pre-line">{fill(l, Object.fromEntries(Object.entries(props).map(([k, v]) => [k, empty(v) ? '–' : attrValue(layer, k, v)])))}</p>
              ))}
            </div>
          )}
          {(layer.sumber || data) && (
            <p className="flex flex-col gap-0.5 border-t border-separator px-3.5 py-2 text-[11px] leading-snug text-muted">
              {layer.sumber && <span><span className="font-medium text-heading">{t('map.source')}</span> {layer.sumber}</span>}
              {/* Data hasil impor tidak punya penyunting: cukup tanggalnya. */}
              {data?.updatedAt && <span>{data.updatedByName ? t('map.updated', { date: fmtDate(data.updatedAt), name: data.updatedByName }) : t('map.updatedOn', { date: fmtDate(data.updatedAt) })}</span>}
            </p>
          )}
          <div className="flex flex-col gap-1.5 border-t border-separator px-3.5 py-3">
            <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm', fullWidth: true }), POPUP_BTN, POPUP_BTN_2ND)}>
              <MapPin className="size-3" /> {t('map.gmaps')}
            </a>
          </div>
        </>
      )}
    </PopupCard>
  );
}

const KELAS_KEY = { Rendah: 'low', Sedang: 'mid', Tinggi: 'high' } as const;
/** Rentang indeks per kelas, urutan Rendah → Tinggi (ambang sepertiga, lihat `kelasOf`). */
const HAZARD_RANGE = ['0–0,33', '0,33–0,67', '0,67–1'];

/** Popup klik raster bahaya: indeks InaRISK di titik itu + kelasnya. */
function HazardPopup({ service, hazard, lng, lat, onClose }: {
  service: string; hazard: HazardId; lng: number; lat: number; onClose: () => void;
}) {
  const t = useT();
  const { data, isPending, isError } = useQuery({ queryKey: ['inarisk', service, lng, lat], queryFn: () => identify(service, lng, lat), staleTime: Infinity, retry: 2 });
  const kelas = data != null ? kelasOf(data) : null;
  const i = kelas ? Object.keys(KELAS_KEY).indexOf(kelas) : -1;
  return (
    <PopupCard kicker={t('map.hazard')} title={t(`map.hz.${hazard}`)} onClose={onClose}>
      <div aria-live="polite">
        {isPending || isError || data == null ? (
          <p className="px-3.5 pb-3 text-xs text-muted">{isPending ? t('common.loading') : isError ? t('map.hazardError') : t('map.hazardNone')}</p>
        ) : (
          <AttrRows rows={[
            ['kelas', t('map.hazardClass'), t(`map.hz.${KELAS_KEY[kelas!]}`)],
            ['indeks', t('map.hazardIdx'), data.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
            ['rentang', t('map.hazardRange'), HAZARD_RANGE[i]],
          ]} />
        )}
      </div>
      <p className="border-t border-separator px-3.5 py-2 text-[11px] leading-snug text-muted"><span className="font-medium text-heading">{t('map.source')}</span> {t('map.hazardSource')}</p>
    </PopupCard>
  );
}

/** Baris layer di panel: aktif ditandai warna primer (latar + garis tepi), bukan rona samar. */
/**
 * Simbol baris layer: SATU warna dasar layer (unik antarlayer, dijaga tes seed), bukan warna per kelas; rincian kelas ada
 * di legenda di bawahnya. Batas administrasi di tema gelap memakai abu terang, sama dengan garis yang digambar VectorLayers.
 */
export const symbolOf = (l: Pick<Layer, 'slug' | 'style'>, dark: boolean): string =>
  l.slug === 'batas-administrasi' && dark ? '#E5E7EB' : l.style.color;


type LegendItem = { key: string; label: string; color: string; value?: string };
type LegendGroup = { title: string | null; value?: string; items: LegendItem[] };
type Measured = { count: number; lengthKm: number; areaHa: number };

/**
 * Legenda kelas dalam kotak lembut, judulnya nama atribut pengklasifikasi (mis. "Jenis Lampu").
 * Tiap kelas = checkbox: dimatikan -> fitur kelas itu disembunyikan di peta (swatch kosong, teks redup).
 * Kelompok (mis. pola ruang) punya checkbox sendiri untuk semua kelasnya. Dengan angka (luas/jumlah): satu kolom, angka rata kanan.
 * Lebih dari 8 baris: tinggi dibatasi dan bisa digulir agar panel tidak memanjang.
 */
function Legend({ items, groups, geom, title, hidden = [], onHidden }: {
  items?: LegendItem[]; groups?: LegendGroup[]; geom: Layer['geomType']; title?: string; hidden?: string[]; onHidden: (h: string[]) => void;
}) {
  const t = useT();
  const sections = groups ?? [{ title: null, items: items! }]; // dipanggil dengan salah satu: groups atau items
  const all = sections.flatMap((g) => g.items);
  const withValue = all.some((c) => c.value);
  // Dua kolom hanya untuk label pendek tanpa angka; label panjang (mis. kelas kemiskinan) satu baris penuh, tidak patah.
  const twoCol = !withValue && all.every((c) => c.label.length <= 16);
  const off = new Set(hidden);
  const set = (keys: string[], show: boolean) => onHidden(show ? hidden.filter((h) => !keys.includes(h)) : [...new Set([...hidden, ...keys])]);
  return (
    <div className="rounded-control bg-default/60 p-3">
      {(title || hidden.length > 0) && (
        <p className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-heading">{title}</span>
          {hidden.length > 0 && (
            <button type="button" onClick={() => onHidden([])} className="shrink-0 text-accent hover:underline">{t('map.showAll')}</button>
          )}
        </p>
      )}
      <div className={cn('flex flex-col gap-3', all.length + sections.length > 9 && 'max-h-64 overflow-y-auto pr-1')}>
        {sections.map((g) => {
          const keys = g.items.map((c) => c.key);
          const shown = keys.filter((k) => !off.has(k)).length;
          return (
            <section key={g.title ?? ''}>
              {g.title && (
                <label className="mb-1.5 flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-muted">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={shown === keys.length} ref={(el) => { if (el) el.indeterminate = shown > 0 && shown < keys.length; }}
                      onChange={(e) => set(keys, e.target.checked)} aria-label={t('map.toggleGroup', { name: g.title })} className="size-3.5 shrink-0 cursor-pointer accent-[var(--accent)]" />
                    <span className="break-words">{g.title}</span>
                  </span>
                  {g.value && <span className="shrink-0 tabular-nums">{g.value}</span>}
                </label>
              )}
              <ul className={cn('grid gap-x-4 gap-y-1', g.items.length > 1 && twoCol && 'grid-cols-2')}>
                {g.items.map((c) => {
                  const on = !off.has(c.key);
                  const row = (
                    <>
                      <span className={cn('transition-opacity', !on && 'opacity-35')}><LegendSymbol color={on ? c.color : 'transparent'} geom={geom} /></span>
                      <span className={cn('min-w-0 flex-1 break-words tabular-nums', !on && 'text-muted line-through decoration-muted/60')} title={c.label}>{c.label}</span>
                      {c.value && <span className={cn('shrink-0 tabular-nums', on ? 'text-muted' : 'text-subtle')}>{c.value}</span>}
                    </>
                  );
                  return (
                    <li key={c.key}>
                      <label className="-mx-1 flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-heading hover:bg-default has-focus-visible:ring-2 has-focus-visible:ring-focus">
                        <input type="checkbox" checked={on} onChange={(e) => set([c.key], e.target.checked)} className="sr-only" />
                        {row}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Legenda dari data, bukan dari daftar kelas style: hanya kelas yang benar-benar ada (mengikuti filter kecamatan dan
 * versi tahun layer), dikelompokkan bila style punya `groups`, kelas diurutkan abjad (ordinal: urutan skala).
 * Saat memuat, pakai daftar kelas style. Layer bertingkat (angka): legenda statis dari stop style.
 */
function LayerLegend({ layer, kecamatan, tahun, hidden, onHidden }: { layer: Layer; kecamatan?: string; tahun?: number; hidden: string[]; onHidden: (h: string[]) => void }) {
  const t = useT();
  // Bertingkat (angka) atau satu kelas: legenda statis dari style; berkelas kategori: dari data.
  const classed = !layer.style.steps && legendOf(layer.style).length > 1;
  // Garis berpanjang resmi (panjang_km, mis. ruas SK): km legenda = jumlah atribut itu, sama dengan kartu Ringkasan.
  const sum = layer.fields.some((f) => f.key === 'panjang_km') ? 'panjang_km' : undefined;
  const opts = { kecamatan, tahun, sum };
  const { data } = useQuery({ queryKey: ['stats', layer.slug, opts], queryFn: () => endpoints.stats(layer.slug, opts), enabled: classed });
  const field = colorField(layer.style);
  const title = layer.fields.find((f) => f.key === field)?.label ?? (field ? sentenceCase(field.replace(/_/g, ' ')) : undefined);
  const common = { geom: layer.geomType, title, hidden, onHidden };
  if (layer.style.steps) return <Legend items={legendOf(layer.style)} {...common} />;
  if (!classed) return null;
  // Ruas SK: "N ruas, X km", angka yang sama dengan kartu kondisi jalan di Ringkasan.
  const unit = (r: Measured) => (layer.geomType === 'Polygon' ? `${fmtCompact(r.areaHa)} ha` : layer.geomType === 'LineString'
    ? `${sum ? `${t('ov.nRuas', { n: fmt(r.count) })}, ` : ''}${fmt(r.lengthKm)} km` : fmt(r.count));
  if (!data) return <Legend items={legendOf(layer.style)} {...common} />;
  // Kelas ordinal (kondisi jalan, kelas bahaya): urutan skala dari style (Baik → Rusak Berat → Belum Disurvei);
  // kelas kategori: abjad A–Z, angka dibaca wajar (KPPD 1, KPPD 2, KSPD 1). Fitur tanpa kelas paling bawah.
  const order = classOrder(layer.style);
  const rows = data.map((r) => (r.value != null ? { ...r, lengthKm: r.value } : r))
    .sort((a, b) => Number(!a.key) - Number(!b.key) || order({ key: a.key, label: classLabel(layer.style, a.key!) }, { key: b.key, label: classLabel(layer.style, b.key!) }));
  const total = (rs: Measured[]): Measured => rs.reduce((t, r) => ({ count: t.count + r.count, lengthKm: t.lengthKm + r.lengthKm, areaHa: t.areaHa + r.areaHa }), { count: 0, lengthKm: 0, areaHa: 0 });
  // Kelompok mengikuti urutan `style.groups`. Fitur tanpa kelas: kunci "" (bisa dimatikan juga).
  const groups: LegendGroup[] = groupRows(layer.style, rows, (r) => r.key)
    .map((g) => ({ ...g, total: total(g.rows) }))
    .map(({ group, rows: rs, total: tot }) => ({
      title: group, value: group ? unit(tot) : undefined,
      items: rs.map((r) => ({ key: r.key ?? '', label: r.key ? classLabel(layer.style, r.key) : t('ov.noClass'), color: colorOf(layer.style, r.key), value: unit(r) })),
    }));
  return groups.length ? <Legend groups={groups} {...common} /> : null;
}
