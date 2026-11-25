import { useEffect, useRef, useState } from 'react';
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map';
import { fmt } from '@/lib/format';
import { useT } from '@/lib/prefs';

export type Fix = { longitude: number; latitude: number; accuracy?: number; heading?: number | null };

/** Meter per piksel layar pada lintang & zoom MapLibre (ubin 512 px). */
export const metersPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

type OrientationEv = DeviceOrientationEvent & { webkitCompassHeading?: number };
/** Arah hadap perangkat (derajat dari utara, searah jarum jam), atau null bila sensor tak memberi arah absolut. */
export const headingOf = (e: OrientationEv, screenAngle = 0) => {
  // iOS: kompas langsung; Android/Chrome: alpha absolut berlawanan jarum jam → dibalik.
  const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  return h == null ? null : (h + screenAngle) % 360;
};

/**
 * Titik lokasi gaya Google Maps: titik biru bertepi putih (ukuran tetap), lingkaran akurasi biru transparan
 * yang mengikuti skala peta saat zoom, dan sorot arah (kerucut memudar) yang mengikuti arah hadap perangkat.
 * Posisi terus diperbarui (watchPosition) selama halaman peta terbuka.
 */
export function UserLocation({ initial }: { initial: Fix }) {
  const t = useT();
  const { map } = useMap();
  const [fix, setFix] = useState(initial);
  const [hasHeading, setHasHeading] = useState(false);
  const circle = useRef<HTMLSpanElement>(null);
  const beam = useRef<HTMLSpanElement>(null);
  const heading = useRef<number | null>(null);
  useEffect(() => setFix(initial), [initial]);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setFix({ longitude: p.coords.longitude, latitude: p.coords.latitude, accuracy: p.coords.accuracy, heading: p.coords.heading }),
      () => {}, // Gagal memperbarui: titik terakhir tetap ditampilkan.
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Ukuran lingkaran akurasi & sudut sorot ditulis langsung ke DOM (tiap frame zoom/putar), tanpa render ulang React.
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      if (circle.current) {
        const d = fix.accuracy ? (2 * fix.accuracy) / metersPerPixel(fix.latitude, map.getZoom()) : 0;
        circle.current.style.width = circle.current.style.height = `${d}px`;
        circle.current.style.opacity = d > 22 ? '1' : '0'; // lebih kecil dari titik: disembunyikan
      }
      // Sudut layar = arah hadap − rotasi peta; GPS (saat bergerak) dipakai bila kompas tak ada.
      const h = heading.current ?? (fix.heading != null && !Number.isNaN(fix.heading) ? fix.heading : null);
      if (beam.current) beam.current.style.transform = `translate(-50%, -100%) rotate(${(h ?? 0) - map.getBearing()}deg)`;
      setHasHeading(h != null);
    };
    const onOrient = (e: Event) => {
      const h = headingOf(e as OrientationEv, screen.orientation?.angle ?? 0);
      if (h != null) { heading.current = h; apply(); }
    };
    const ev = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    apply();
    map.on('zoom', apply);
    map.on('rotate', apply);
    window.addEventListener(ev, onOrient);
    return () => {
      map.off('zoom', apply);
      map.off('rotate', apply);
      window.removeEventListener(ev, onOrient);
    };
  }, [map, fix]);

  const label = fix.accuracy ? t('map.youAreHereAcc', { m: fmt(Math.round(fix.accuracy)) }) : t('map.youAreHere');
  return (
    <MapMarker longitude={fix.longitude} latitude={fix.latitude}>
      <MarkerContent className="cursor-default">
        <div role="img" aria-label={label} title={label} className="gloc">
          <span ref={circle} className="gloc__acc" />
          <span ref={beam} className="gloc__beam" hidden={!hasHeading} />
          <span className="gloc__dot" />
        </div>
      </MarkerContent>
    </MapMarker>
  );
}
