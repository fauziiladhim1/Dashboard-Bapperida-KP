import type { MapMouseEvent } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '@/components/ui/map';
import { topFeature } from '@/components/map/MapHover';

/**
 * Raster bahaya InaRISK BNPB, diambil langsung dari ImageServer BNPB per tile (bukan salinan di database), jadi peta
 * selalu menampilkan versi yang sedang dilayani BNPB. Tile dipotong ke batas wilayah (kabupaten atau kecamatan terpilih).
 */
const BASE = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
const PROTO = 'inarisk';
/** Id sumber raster; VectorLayers memakainya untuk pemberitahuan "memuat data". */
export const HAZARD_SRC = 'hazard-raster';
const SRC = HAZARD_SRC;
const SIZE = 256;
/** Source vector tile batas administrasi (VectorLayers: `src-{slug}`). */
export const BOUNDARY_SRC = 'src-batas-administrasi';

type Ring = [number, number][];
type Geo = { type: string; coordinates: unknown };
export type Boundary = { features: { geometry: Geo | null }[] };

/** Poligon (lng/lat) dari GeoJSON batas; Polygon & MultiPolygon. */
export const polysOf = (fc: Boundary): Ring[][] => (fc.features ?? []).flatMap(({ geometry: g }) =>
  !g ? [] : g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : []);

const R = 6378137;
/** lng/lat -> Web Mercator (meter), sama dengan bbox tile `{bbox-epsg-3857}`. */
export const merc = ([lng, lat]: [number, number]): [number, number] =>
  [(lng * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

/** Ray casting: titik di dalam salah satu poligon (cincin dalam = lubang). */
export const inside = ([x, y]: [number, number], polys: Ring[][]) => polys.some((p) => p.reduce((inn, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return inn !== hit;
}, false));

/** Kelas indeks InaRISK (0–1), sama dengan `kelasOf` skrip db:inarisk. */
export const kelasOf = (v: number) => (v < 1 / 3 ? 'Rendah' : v < 2 / 3 ? 'Sedang' : 'Tinggi');

// Mask dipakai handler protokol (global MapLibre); satu raster bahaya tampil sekaligus.
let mask: Ring[][] = [];
let registered = false;

// ponytail: tile 256 px tanpa cache sendiri; cache HTTP browser cukup.
const loadTile = async ({ url }: { url: string }, abort: AbortController) => {
  const [service, bbox] = url.slice(PROTO.length + 3).split('/') as [string, string];
  const qs = new URLSearchParams({ bbox, bboxSR: '3857', imageSR: '3857', size: `${SIZE},${SIZE}`, format: 'png32', transparent: 'true', f: 'image' });
  const res = await fetch(`${BASE}/${service}/ImageServer/exportImage?${qs}`, { signal: abort.signal });
  if (!res.ok) throw new Error(`InaRISK ${res.status}`);
  const img = await createImageBitmap(await res.blob());
  const [x0, y0, x1, y1] = bbox.split(',').map(Number) as [number, number, number, number];
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  for (const ring of mask.flat()) {
    ring.forEach(([x, y], i) => {
      const px = ((x - x0) / (x1 - x0)) * SIZE, py = ((y1 - y) / (y1 - y0)) * SIZE;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
  }
  ctx.clip('evenodd');
  ctx.drawImage(img, 0, 0);
  return { data: await (await canvas.convertToBlob()).arrayBuffer() };
};

/** Nilai indeks bahaya (0–1) di satu titik; null = tanpa data. */
export const identify = async (service: string, lng: number, lat: number) => {
  const qs = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint',
    returnGeometry: 'false', returnCatalogItems: 'false', f: 'json',
  });
  const res = await fetch(`${BASE}/${service}/ImageServer/identify?${qs}`);
  if (!res.ok) throw new Error(`InaRISK ${res.status}`);
  const v = Number(((await res.json()) as { value?: string }).value);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 1) : null;
};

type Props = {
  service: string; opacity: number; boundary?: Boundary;
  /** Klik di dalam batas yang tidak mengenai fitur layer lain. */
  onPick: (p: { lng: number; lat: number }) => void;
};

export function HazardRaster({ service, opacity, boundary, onPick }: Props) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded || !boundary) return;
    let cancelled = false;
    const polys = polysOf(boundary);
    if (!polys.length) return;
    mask = polys.map((p) => p.map((ring) => ring.map(merc)));
    const pts = polys.flat(2);
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    void import('maplibre-gl').then(({ addProtocol }) => {
      if (cancelled) return;
      if (!registered) { addProtocol(PROTO, loadTile); registered = true; }
      map.addSource(SRC, {
        type: 'raster', tiles: [`${PROTO}://${service}/{bbox-epsg-3857}`], tileSize: SIZE,
        bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], attribution: 'InaRISK BNPB',
      });
      // Di bawah layer data (vector tile `src-*`) agar jalan/titik tetap terbaca di atas raster.
      const before = map.getStyle().layers.find((l) => 'source' in l && String(l.source).startsWith('src-'))?.id;
      map.addLayer({ id: SRC, type: 'raster', source: SRC, paint: { 'raster-opacity': opacity } }, before);
    });
    const onClick = (e: MapMouseEvent) => {
      // Batas administrasi (poligon transparan seluas kabupaten) tidak menghalangi: klik di atasnya = nilai bahaya.
      const top = topFeature(map, e.point);
      if ((!top || top.source === BOUNDARY_SRC) && inside([e.lngLat.lng, e.lngLat.lat], polys)) onPick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    map.on('click', onClick);
    return () => {
      cancelled = true;
      map.off('click', onClick);
      if (map.getLayer(SRC)) map.removeLayer(SRC);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opasitas diubah di tempat (effect bawah), bukan membuat ulang
  }, [map, isLoaded, service, boundary, onPick]);

  useEffect(() => {
    if (map && isLoaded && map.getLayer(SRC)) map.setPaintProperty(SRC, 'raster-opacity', opacity);
  }, [map, isLoaded, opacity]);

  return null;
}
