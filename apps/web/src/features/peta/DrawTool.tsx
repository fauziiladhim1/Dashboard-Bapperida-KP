import type { Map as MapLibre } from 'maplibre-gl';
import { MapPin } from '@gravity-ui/icons';
import { Badge, Button, CloseButton } from '@heroui/react';
import { AnimatePresence, m as motion } from 'motion/react';
import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react';
import { MapGeoJSON, MapMarker, MarkerContent, useMap } from '@/components/ui/map';
import { dataLayers } from '@/components/map/MapHover';
import { LegendSymbol, rowClass } from '@/components/map/MapOverlays';
import { fmt } from '@/lib/format';
import { addVertex, finishProblem, type DrawProblem, type Pt } from '@/lib/draw';
import { drawnWkt } from '@/features/data/FeatureDialog';
import { positions } from '@/lib/geometry';
import type { Layer } from '@/lib/types';
import type { Key } from '@/lib/i18n';
import { useT } from '@/lib/prefs';
import { EASE } from '@/components/common/motion';
import { cn } from '@/lib/utils';

/** Radius tempel (piksel layar): klik sedekat ini ke titik sudut gambar sendiri / objek data menempel tepat ke sana. */
const SNAP_PX = 12;
const round = (p: Pt): Pt => [+p[0].toFixed(7), +p[1].toFixed(7)];

/**
 * Titik sudut terdekat dalam radius SNAP_PX: gambar sendiri didahulukan (agar klik titik pertama menutup poligon),
 * lalu objek data yang sedang tampil (vector tile `src-*`). null = tidak ada yang cukup dekat.
 * ponytail: sudut dari tile ter-render (presisi tile, ±cm pada zoom 15) bukan dari DB; cukup untuk catatan rencana.
 */
function snapTarget(map: MapLibre, p: Pt, own: Pt[]): Pt | null {
  const c = map.project(p);
  const near = (cands: Pt[]) => {
    let best: Pt | null = null, bestD = SNAP_PX;
    for (const q of cands) {
      const s = map.project(q);
      const d = Math.hypot(s.x - c.x, s.y - c.y);
      if (d <= bestD) [best, bestD] = [q, d];
    }
    return best;
  };
  const layers = dataLayers(map);
  if (near(own)) return near(own);
  if (!layers.length) return null;
  const hits = map.queryRenderedFeatures([[c.x - SNAP_PX, c.y - SNAP_PX], [c.x + SNAP_PX, c.y + SNAP_PX]], { layers });
  const found = near(hits.flatMap((f) => (f.geometry && 'coordinates' in f.geometry ? positions(f.geometry.coordinates) as Pt[] : [])));
  return found && round(found);
}

/** Gambar yang sedang dibuat. `problem`: alasan klik terakhir ditolak (ditampilkan di panel sampai klik berikutnya). */
export type Draft = { layer: Layer; pts: Pt[]; problem?: DrawProblem | null };

/** Status gambar untuk peta & panel: cukup titik, masalah topologi bila diselesaikan, dan WKT hasilnya. */
const statusOf = ({ layer, pts }: Draft) => {
  const geom = layer.geomType as 'LineString' | 'Polygon';
  const enough = layer.geomType !== 'Point' && pts.length >= (geom === 'Polygon' ? 3 : 2);
  const blocked = enough ? finishProblem(pts, geom) : null;
  return { ready: enough && !blocked, blocked, wkt: (v: Pt[]) => drawnWkt(v, geom) };
};

type Handlers = { onChange: (d: Draft) => void; onFinish: (wkt: string) => void; onCancel: () => void };

/**
 * Lapisan gambar di peta utama: klik = titik sudut (menempel ke sudut terdekat), pratinjau bentuk & garis bantu ke
 * kursor, topologi dijaga (garis/area tidak boleh memotong dirinya, area tidak boleh segaris).
 * Pintasan: Enter selesai, Esc batal, Backspace hapus titik terakhir. Tombolnya di DrawPanel.
 */
export function DrawTool({ draft, onChange, onFinish, onCancel }: { draft: Draft } & Handlers) {
  const { map } = useMap();
  const { layer, pts } = draft;
  const geom = layer.geomType;
  const color = layer.style.color;
  const [cursor, setCursor] = useState<{ p: Pt; snapped: boolean } | null>(null);
  const { ready, wkt } = statusOf(draft);

  useEffect(() => {
    // ponytail: map pasti ada, <Map> baru merender anak setelah instance MapLibre dibuat.
    const m = map!;
    const canvas = m.getCanvas();
    const at = (e: { lngLat: { lng: number; lat: number } }) => {
      const raw = round([e.lngLat.lng, e.lngLat.lat]);
      const s = snapTarget(m, raw, pts);
      return { p: s ?? raw, snapped: !!s };
    };
    const click = (e: { lngLat: { lng: number; lat: number } }) => {
      const { p } = at(e);
      if (geom === 'Point') return onFinish(`POINT (${p[0]} ${p[1]})`);
      const r = addVertex(pts, p, geom);
      if (r.done && !finishProblem(r.pts, geom)) onFinish(wkt(r.pts));
      else onChange({ layer, pts: r.pts, problem: r.problem ?? null });
    };
    const move = (e: { lngLat: { lng: number; lat: number } }) => {
      canvas.style.cursor = 'crosshair';
      setCursor(at(e));
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element).closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && ready) onFinish(wkt(pts));
      else if (e.key === 'Backspace' && pts.length) {
        e.preventDefault();
        onChange({ layer, pts: pts.slice(0, -1) });
      }
    };
    canvas.style.cursor = 'crosshair';
    m.on('click', click);
    m.on('mousemove', move);
    window.addEventListener('keydown', key);
    return () => {
      m.off('click', click);
      m.off('mousemove', move);
      window.removeEventListener('keydown', key);
      canvas.style.cursor = '';
    };
  }, [map, pts, layer, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- callback induk dipanggil apa adanya

  // Bentuk yang sudah pasti (garis tegas) dan garis bantu ke kursor (putus-putus); poligon diwarnai tipis.
  const shape = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: geom === 'Polygon' && pts.length >= 3
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]!]] } }]
      : pts.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : [],
  }), [pts, geom]);
  const band = useMemo<GeoJSON.FeatureCollection>(() => {
    const last = pts.at(-1);
    const coords = !cursor || !last ? [] : geom === 'Polygon' && pts.length >= 2 ? [last, cursor.p, pts[0]!] : [last, cursor.p];
    return { type: 'FeatureCollection', features: coords.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] };
  }, [pts, cursor, geom]);

  return (
    <>
      {geom !== 'Point' && (
        <>
          <MapGeoJSON id="draw-shape" data={shape} fillPaint={{ 'fill-color': color, 'fill-opacity': 0.15 }} linePaint={{ 'line-color': color, 'line-width': 2.5 }} />
          <MapGeoJSON id="draw-band" data={band} fillPaint={false} linePaint={{ 'line-color': color, 'line-width': 1.5, 'line-dasharray': [2, 2] }} />
        </>
      )}
      {pts.map((p, i) => (
        <MapMarker key={`${i}-${p[0]}-${p[1]}`} longitude={p[0]} latitude={p[1]}>
          {/* Titik pertama poligon lebih besar: klik untuk menutup area. */}
          <MarkerContent>
            <span className={cn('block rounded-full border-2 border-white shadow', i === 0 && geom === 'Polygon' && pts.length >= 3 ? 'size-3.5' : 'size-2.5')} style={{ backgroundColor: color }} />
          </MarkerContent>
        </MapMarker>
      ))}
      {cursor?.snapped && (
        <MapMarker longitude={cursor.p[0]} latitude={cursor.p[1]}>
          <MarkerContent><span data-testid="snap-ring" className="pointer-events-none block size-5 rounded-full border-2 bg-white/40" style={{ borderColor: color }} /></MarkerContent>
        </MapMarker>
      )}
    </>
  );
}

export type DrawToolDef = { layer: Layer; label: Key; sub: Key; Icon: ComponentType<SVGProps<SVGSVGElement>> };

type PanelProps = Handlers & {
  tools: DrawToolDef[]; draft: Draft | null; onPick: (layer: Layer) => void; open: boolean; onOpen: (open: boolean) => void;
};

/**
 * Panel catatan rencana, sepola panel layer: kartu melayang (ditutup -> tombol mengambang berisi jumlah catatan),
 * satu baris per alat (warna layer, keterangan, jumlah tersimpan), dan status gambar aktif di kaki panel.
 */
export function DrawPanel({ tools, draft, onPick, onChange, onFinish, onCancel, open, onOpen }: PanelProps) {
  const t = useT();
  const total = tools.reduce((n, { layer }) => n + layer.featureCount, 0);
  const status = draft && statusOf(draft);
  const geom = draft?.layer.geomType;
  const hint = !draft ? '' : geom === 'Point' ? t('map.placeNote') : t(geom === 'Polygon' ? 'draw.hintPolygon' : 'draw.hintLine', { n: draft.pts.length });
  const issue = draft?.problem ?? status?.blocked;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {open ? (
        <motion.aside
          key="draw-panel"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2, ease: EASE }}
          style={{ transformOrigin: 'top right' }}
          aria-label={t('draw.panel')}
          className="relative w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface shadow-float"
        >
          {/* Menutup panel juga membatalkan gambar yang sedang dibuat: kontrolnya ada di panel ini. */}
          {/* Tanpa Tip: di panel kanan, tooltip ke kiri menutupi judul; aria-label sudah memberi nama tombol. */}
          <CloseButton onPress={() => { onCancel(); onOpen(false); }} aria-label={t('draw.collapse')} className="absolute top-4 right-4 z-10" />
          <div className="border-b border-border p-4">
            <h2 className="pr-8 text-base">{t('draw.panel')}</h2>
            <p className="mt-1 text-xs text-muted">{t('draw.panelSub')}</p>
          </div>
          {/* Baris sepola panel layer: simbol warna layer, nama, keterangan + jumlah tersimpan; ikon alat di kanan. */}
          <div role="group" aria-label={t('draw.tools')} className="flex flex-col gap-2 p-2">
            {tools.map(({ layer, label, sub, Icon }) => {
              const on = draft?.layer.slug === layer.slug;
              return (
                <button key={layer.slug} type="button" aria-label={t(label)} aria-pressed={on} onClick={() => onPick(layer)}
                  className={cn(rowClass(on), 'flex w-full items-start gap-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus')}>
                  <LegendSymbol color={layer.style.color} geom={layer.geomType} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-heading">{t(label)}</span>
                    {/* Keterangan kiri, jumlah tersimpan rata kanan: tanpa pemisah titik tengah. */}
                    <span className="mt-0.5 flex gap-2 text-xs text-muted tabular-nums"><span>{t(sub)}</span><span className="ml-auto shrink-0">{t('map.nFeatures', { n: fmt(layer.featureCount) })}</span></span>
                  </span>
                  <Icon className={cn('mt-0.5 size-4 shrink-0', on ? 'text-accent' : 'text-muted')} />
                </button>
              );
            })}
          </div>
          {draft && (
            <div className="border-t border-border p-4">
              <p className="text-sm font-medium text-heading tabular-nums">{hint}</p>
              <p aria-live="polite" className={cn('mt-1 text-xs', issue ? 'text-danger' : 'text-muted')}>{issue ? t(`draw.${issue}`) : t('draw.keys')}</p>
              <div className="mt-3 flex gap-2">
                {geom !== 'Point' && (
                  <>
                    <Button size="sm" variant="secondary" isDisabled={!draft.pts.length} onPress={() => onChange({ layer: draft.layer, pts: draft.pts.slice(0, -1) })}>{t('draw.undo')}</Button>
                    <Button size="sm" isDisabled={!status!.ready} onPress={() => onFinish(status!.wkt(draft.pts))}>{t('draw.done')}</Button>
                  </>
                )}
                <Button size="sm" variant="tertiary" onPress={onCancel} className="ml-auto">{t('common.cancel')}</Button>
              </div>
            </div>
          )}
        </motion.aside>
      ) : (
        <motion.div key="draw-fab" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}>
          <Badge.Anchor>
            <Button variant="tertiary" onPress={() => onOpen(true)} aria-label={t('draw.expand')} className="bg-surface text-sm font-medium shadow-float">
              <MapPin className="size-4" /> {t('draw.panel')}
            </Button>
            <Badge color="accent" size="sm">{total}</Badge>
          </Badge.Anchor>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
