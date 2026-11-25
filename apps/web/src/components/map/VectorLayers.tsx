import type { FilterSpecification, MapGeoJSONFeature, MapSourceDataEvent, MapStyleDataEvent, MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useMap } from '@/components/ui/map';
import { topFeature } from '@/components/map/MapHover';
import { HAZARD_SRC } from '@/components/map/HazardRaster';
import { classFilter, colorExpression, tileUrl } from '@/lib/layer-style';
import type { Layer } from '@/lib/types';
import { fmt } from '@/lib/format';
import { useT } from '@/lib/prefs';

/**
 * fill: paksa isi poligon (mis. peta tematik kecamatan), termasuk untuk batas administrasi.
 * tahun: hanya fitur dengan atribut `tahun` = nilai ini yang digambar (layer berdata multi-tahun, mis. penduduk miskin).
 * hidden: kelas yang dimatikan di legenda (kunci kelas, atau indeks stop untuk layer bertingkat).
 */
export type VisibleLayer = Layer & { opacity: number; fill?: boolean; tahun?: number; hidden?: string[] };

/** Fitur terpilih (klik peta atau hasil pencarian) yang diberi garis sorot. */
export type Selection = { slug: string; id: string | number };

type Props = {
  layers: VisibleLayer[];
  kecamatan?: string;
  /** Tahun global: dikirim ke tile agar kelas kondisi ruas SK sama dengan tahun kartu ringkasan. */
  tahun?: number;
  selected?: Selection | null;
  onFeatureClick?: (feature: MapGeoJSONFeature, layer: Layer, lngLat: { lng: number; lat: number }) => void;
};

/** Nilai `a` saat fitur di-hover (feature-state dari MapHover), `b` bila tidak. */
const hov = <T,>(a: T, b: T) => ['case', ['boolean', ['feature-state', 'hover'], false], a, b] as never;

const ids = (slug: string) => ({ source: `src-${slug}`, fill: `fill-${slug}`, line: `line-${slug}`, circle: `circle-${slug}` });

/** Batas administrasi hanya garis agar tidak menutupi layer lain; `edge` = simbologi garis tepi (kawasan strategis). */
const kindOf = (layer: VisibleLayer) => ({
  outlineOnly: layer.slug === 'batas-administrasi' && !layer.fill,
  edge: !!layer.style.outline && !layer.fill,
});

/** Properti paint yang bergantung pada opacity; dipakai saat membuat layer dan saat slider digeser (tanpa membuat ulang). */
const opacityPaint = (layer: VisibleLayer): [string, string, unknown][] => {
  const id = ids(layer.slug);
  const o = layer.opacity;
  if (layer.geomType === 'Polygon') {
    const { outlineOnly, edge } = kindOf(layer);
    return [
      [id.fill, 'fill-opacity', outlineOnly ? hov(0.12, 0) : edge ? hov(0.25 * o, 0.08 * o) : hov(Math.min(1, 0.7 * o), 0.45 * o)],
      [id.line, 'line-opacity', o],
    ];
  }
  return layer.geomType === 'LineString' ? [[id.line, 'line-opacity', o]] : [[id.circle, 'circle-opacity', o]];
};

/** Filter gabungan: tahun (layer multi-tahun) dan kelas yang dimatikan; null = tanpa filter. */
const filterOf = (layer: VisibleLayer): FilterSpecification | null => {
  const parts = [
    ...(layer.tahun !== undefined ? [['==', ['to-number', ['get', 'tahun']], layer.tahun]] : []),
    ...[classFilter(layer.style, layer.hidden ?? [])].filter(Boolean),
  ];
  return parts.length ? (parts.length === 1 ? parts[0] : ['all', ...parts]) as FilterSpecification : null;
};

/** Kunci struktur: source/layer hanya dibuat ulang bila daftar, versi data, atau mode isi berubah, bukan karena opacity/kelas. */
const structureKey = (layers: VisibleLayer[]) => layers.map((l) => `${l.slug}:${l.updatedAt}:${l.fill ? 1 : 0}:${l.tahun ?? ''}`).join('|');

/**
 * Menampilkan layer sebagai vector tile dari PostGIS (/api/v1/tiles).
 * Hanya tile yang terlihat yang diunduh, sehingga data ribuan poligon tetap ringan.
 */
export function VectorLayers({ layers, kecamatan, tahun, selected, onFeatureClick }: Props) {
  const { map, isLoaded, resolvedTheme } = useMap();
  const t = useT();
  // Sumber layer data yang sedang mengambil tile (bukan basemap): diisi `dataloading`, dikosongkan `idle`.
  const [busy, setBusy] = useState<string[]>([]);
  // Daftar terbaru untuk effect struktur (yang tidak bergantung pada opacity).
  const latest = useRef(layers);
  latest.current = layers;
  const key = structureKey(layers);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const layers = latest.current;
    const added: string[][] = [];
    for (const layer of layers) {
      const id = ids(layer.slug);
      const color = colorExpression(layer.style);
      map.addSource(id.source, { type: 'vector', tiles: [tileUrl(layer, kecamatan, tahun)], minzoom: 0, maxzoom: 16 });
      const filter = filterOf(layer);
      const common = { source: id.source, 'source-layer': 'features', ...(filter && { filter }) };
      const layerIds: string[] = [];
      const op = Object.fromEntries(opacityPaint(layer).map(([lid, prop, v]) => [`${lid}/${prop}`, v])) as Record<string, never>;
      if (layer.geomType === 'Polygon') {
        // Batas: isi transparan tetap dipasang agar area kecamatan bisa di-hover/klik.
        const { outlineOnly, edge } = kindOf(layer);
        map.addLayer({ ...common, id: id.fill, type: 'fill', paint: { 'fill-color': color, 'fill-opacity': op[`${id.fill}/fill-opacity`] } });
        // Batas wilayah gelap (#111827) tak terlihat di basemap gelap; ganti terang.
        const lineColor = outlineOnly && resolvedTheme === 'dark' ? '#E5E7EB' : color;
        map.addLayer({ ...common, id: id.line, type: 'line', paint: { 'line-color': lineColor, 'line-width': outlineOnly ? hov(2.5, 1.5) : edge ? hov(3.5, 2.5) : hov(2, 0.8), 'line-opacity': op[`${id.line}/line-opacity`], ...(outlineOnly ? { 'line-dasharray': [3, 2] } : {}) } });
        layerIds.push(id.fill, id.line);
      } else if (layer.geomType === 'LineString') {
        map.addLayer({ ...common, id: id.line, type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, hov(3.5, 1.5), 15, hov(8, 5)], 'line-opacity': op[`${id.line}/line-opacity`] } });
        layerIds.push(id.line);
      } else {
        map.addLayer({ ...common, id: id.circle, type: 'circle', paint: { 'circle-color': color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, hov(5, 3), 15, hov(10, 7)], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': hov(2.5, 1.5), 'circle-opacity': op[`${id.circle}/circle-opacity`] } });
        layerIds.push(id.circle);
      }
      added.push([id.source, ...layerIds]);
    }

    // Satu handler di level peta: fitur teratas (jalan di atas poligon) yang dipilih.
    const onClick = (e: MapMouseEvent) => {
      const feature = topFeature(map, e.point);
      const layer = feature && layers.find((l) => ids(l.slug).source === feature.source);
      if (feature && layer) onFeatureClick?.(feature, layer, e.lngLat);
    };
    map.on('click', onClick);
    // Cursor & tooltip diurus MapHover agar satu pemilik untuk semua layer.

    return () => {
      map.off('click', onClick);
      // Hapus layer sebelum source; map bisa sudah dihancurkan saat unmount.
      for (const [source, ...layerIds] of added) {
        // Sorotan (`sel-*`) memakai source yang sama: dilepas dulu agar removeSource tidak gagal.
        for (const l of [...layerIds, `sel-${source.slice(4)}`]) if (map.getLayer(l)) map.removeLayer(l);
        if (map.getSource(source)) map.removeSource(source);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` mewakili `layers` tanpa opacity
  }, [map, isLoaded, resolvedTheme, key, kecamatan, tahun, onFeatureClick]);

  // Opacity & kelas yang dimatikan diubah di tempat: tanpa kedip dan tanpa meminta ulang tile.
  useEffect(() => {
    if (!map || !isLoaded) return;
    for (const layer of layers) {
      for (const [lid, prop, v] of opacityPaint(layer)) if (map.getLayer(lid)) map.setPaintProperty(lid, prop as never, v as never);
      const id = ids(layer.slug);
      for (const lid of [id.fill, id.line, id.circle]) if (map.getLayer(lid)) map.setFilter(lid, filterOf(layer));
    }
  }, [map, isLoaded, layers]);

  // Sorotan fitur terpilih: layer garis/lingkaran aksen di atas semua layer data, hanya untuk id terpilih.
  const sel = selected && layers.find((l) => l.slug === selected.slug);
  const selKey = sel ? `${key}#${sel.slug}:${selected!.id}` : '';
  useEffect(() => {
    if (!map || !isLoaded || !sel || !map.getSource(ids(sel.slug).source)) return;
    const id = `sel-${sel.slug}`;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563EB';
    const base = { id, source: ids(sel.slug).source, 'source-layer': 'features', filter: ['==', ['id'], Number(selected!.id)] as FilterSpecification };
    if (sel.geomType === 'Point') {
      map.addLayer({ ...base, type: 'circle', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 9, 15, 14], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': accent, 'circle-stroke-width': 3 } });
    } else {
      map.addLayer({ ...base, type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': sel.geomType === 'LineString' ? 9 : 3.5, 'line-opacity': sel.geomType === 'LineString' ? 0.55 : 1 } });
    }
    return () => {
      if (map.getLayer(id)) map.removeLayer(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `selKey` mewakili layer terpilih + struktur
  }, [map, isLoaded, selKey, resolvedTheme]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    const pending = new Set<string>();
    // Jeda 300 ms: tile dari cache selesai lebih dulu, pemberitahuan tidak berkedip.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    const onLoad = (e: MapSourceDataEvent | MapStyleDataEvent) => {
      // Layer data (src-<slug>) dan raster bahaya InaRISK (HazardRaster); basemap diabaikan.
      const id = 'sourceId' in e ? String(e.sourceId) : '';
      if (!id.startsWith('src-') && id !== HAZARD_SRC) return;
      pending.add(id.replace(/^src-/, ''));
      // Sudah tampil: layer yang menyusul langsung ikut disebut.
      if (shown) setBusy([...pending]);
      timer ??= setTimeout(() => { shown = true; setBusy([...pending]); }, 300);
    };
    const onIdle = () => { clearTimeout(timer); timer = undefined; shown = false; pending.clear(); setBusy([]); };
    map.on('dataloading', onLoad);
    map.on('idle', onIdle);
    return () => { clearTimeout(timer); map.off('dataloading', onLoad); map.off('idle', onIdle); };
  }, [map, isLoaded]);

  const names = [
    ...layers.filter((l) => busy.includes(l.slug)).map((l) => `${l.name} (${t('map.nFeatures', { n: fmt(l.featureCount) })})`),
    ...(busy.includes(HAZARD_SRC) ? [t('map.hazard')] : []),
  ];
  if (!names.length) return null;
  return (
    <div role="status" className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-overlay/95 px-4 py-2 text-xs text-heading shadow-lg backdrop-blur">
      <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <span className="truncate">{t('map.loadingData', { names: names.join(', ') })}</span>
    </div>
  );
}
