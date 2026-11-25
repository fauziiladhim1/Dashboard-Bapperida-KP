import { useEffect } from 'react';
import { useMap } from '@/components/ui/map';

export const BUILDINGS_3D = 'bangunan-3d';
/** Mulai zoom 15 bangunan basemap diangkat jadi 3D; di bawahnya tetap tapak datar bawaan Carto. */
const MIN_ZOOM = 15;
/** Tinggi cadangan (m) bila OSM tidak mencatat tinggi: kira-kira rumah 2 lantai. */
const DEFAULT_HEIGHT = 6;
const FLAT = ['building', 'building-top'];

/**
 * Bangunan 3D dari sumber vektor basemap Carto (`protomaps`, source-layer `buildings`). Peta tetap datar sampai
 * dimiringkan (klik kanan + seret / dua jari). Dipasang ulang tiap ganti style (tema terang/gelap).
 */
export function Buildings3D() {
  const { map, isLoaded, resolvedTheme } = useMap();

  useEffect(() => {
    if (!isLoaded || !map || map.getLayer(BUILDINGS_3D) || !map.getSource('protomaps')) return;
    const height = ['coalesce', ['get', 'height'], ['get', 'render_height'], DEFAULT_HEIGHT];
    const base = ['coalesce', ['get', 'min_height'], ['get', 'render_min_height'], 0];
    // Naik bertahap 15 → 16 agar tidak meloncat saat melewati MIN_ZOOM.
    const grow = (v: unknown) => ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, MIN_ZOOM + 1, v];
    const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addLayer({
      id: BUILDINGS_3D, type: 'fill-extrusion', source: 'protomaps', 'source-layer': 'buildings', minzoom: MIN_ZOOM,
      paint: {
        'fill-extrusion-color': resolvedTheme === 'dark' ? '#2a2a2a' : '#d6d6d6',
        'fill-extrusion-height': grow(height),
        'fill-extrusion-base': grow(base),
        'fill-extrusion-opacity': 0.85,
      },
    } as never, firstLabel);
    // Tapak datar bawaan hanya untuk zoom < 15, supaya tidak dobel di bawah bangunan 3D.
    for (const id of FLAT) if (map.getLayer(id)) map.setLayerZoomRange(id, map.getLayer(id)!.minzoom ?? 0, MIN_ZOOM);
  }, [isLoaded, map, resolvedTheme]);

  return null;
}
