import type { Map as MapLibre, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '@/components/ui/map';

/** Layer data aplikasi (source `src-*`), bukan layer basemap. */
export const dataLayers = (map: MapLibre) =>
  (map.getStyle()?.layers ?? []).filter((l) => 'source' in l && String(l.source).startsWith('src-')).map((l) => l.id);

/** Source vector tile batas administrasi: latar yang menutupi seluruh kabupaten, bukan objek data. */
const BOUNDARY = 'src-batas-administrasi';
/** Fitur latar (batas administrasi): tetap bisa disorot & diberi tooltip, tapi tidak membuat kursor jadi pointer. */
export const isBackdrop = (f: MapGeoJSONFeature) => f.source === BOUNDARY;

/**
 * Fitur teratas di titik kursor. Batas administrasi hanya dipilih bila tak ada fitur lain,
 * supaya jalan, titik, atau kalurahan di bawah kursor tetap menang.
 */
export const topFeature = (map: MapLibre, point: MapMouseEvent['point']): MapGeoJSONFeature | undefined => {
  const layers = dataLayers(map);
  if (!layers.length) return undefined;
  const hits = map.queryRenderedFeatures(point, { layers });
  return hits.find((f) => !isBackdrop(f)) ?? hits[0];
};

/** Posisi kursor relatif ke peta, plus ukuran peta untuk membalik tooltip di tepi. */
export type Hover = { x: number; y: number; w: number; h: number; feature: MapGeoJSONFeature };

/** Kunci feature-state untuk fitur vector tile (source-layer `features`); GeoJSON tanpa id dilewati. */
const stateKey = (f: MapGeoJSONFeature) =>
  f.id === undefined ? null : { source: f.source, id: f.id, ...(f.sourceLayer ? { sourceLayer: f.sourceLayer } : {}) };

/**
 * Pemilik tunggal interaksi hover: cursor pointer di atas objek data (latar/kosong = grab/grabbing bawaan MapLibre),
 * feature-state `hover` untuk sorotan, dan callback tooltip.
 */
export function MapHover({ onHover }: { onHover: (h: Hover | null) => void }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const canvas = map.getCanvas();
    let lit: ReturnType<typeof stateKey> = null;
    const light = (f?: MapGeoJSONFeature) => {
      const next = f ? stateKey(f) : null;
      if (lit && (lit.id !== next?.id || lit.source !== next?.source) && map.getSource(lit.source)) map.setFeatureState(lit, { hover: false });
      if (next) map.setFeatureState(next, { hover: true });
      lit = next;
    };
    const move = (e: MapMouseEvent) => {
      const f = topFeature(map, e.point);
      // Pointer hanya di atas objek data; di latar (batas administrasi/kosong) kursor grab/grabbing bawaan MapLibre,
      // jadi jelas kapan peta bisa digeser dan kapan sebuah objek bisa diklik.
      canvas.style.cursor = f && !isBackdrop(f) ? 'pointer' : '';
      light(f);
      const el = map.getContainer();
      onHover(f ? { x: e.point.x, y: e.point.y, w: el.clientWidth, h: el.clientHeight, feature: f } : null);
    };
    const out = () => {
      canvas.style.cursor = '';
      light();
      onHover(null);
    };
    map.on('mousemove', move);
    map.on('mouseout', out);
    map.on('dragstart', out);
    return () => {
      map.off('mousemove', move);
      map.off('mouseout', out);
      map.off('dragstart', out);
    };
  }, [map, isLoaded, onHover]);

  return null;
}
