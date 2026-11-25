import { CloseButton } from '@heroui/react';
import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE } from '@/components/common/motion';
import type { Hover } from '@/components/map/MapHover';
import { fmt } from '@/lib/format';
import { classLabel, colorField, colorOf } from '@/lib/layer-style';
import { useT } from '@/lib/prefs';
import type { Layer } from '@/lib/types';

/** MapPopup bawaan mapcn sudah berupa kartu; dikosongkan agar hanya PopupCard yang tampil (bukan kartu dobel). */
export const POPUP = 'max-w-none border-0 bg-transparent p-0 shadow-none';

type Props = Record<string, unknown>;

const filled = (v: unknown) => v != null && String(v).trim() !== '';

/** Atribut yang jadi judul fitur: nama → kelas → kalurahan/desa → kecamatan; undefined bila tak ada (judul = #id). */
export const labelKey = (p: Props, layer: Layer | undefined): string | undefined =>
  ['nama', 'nama_ruas', 'name', layer?.style?.classField, 'kalurahan', 'desa', 'kecamatan'].find((k): k is string => !!k && filled(p[k]));

/** Nama tampilan fitur, sama untuk tooltip, popup, dan pencarian; kelas memakai label tampilannya. */
export const featureLabel = (p: Props, layer: Layer | undefined, id: unknown) => {
  const k = labelKey(p, layer);
  if (!k) return `#${id ?? ''}`;
  return layer && k === layer.style.classField ? classLabel(layer.style, String(p[k])) : String(p[k]);
};

/**
 * Kartu popup peta: kategori kecil (nama layer), judul, tombol tutup; isi bebas. Tanpa titik/simbol warna.
 * Tinggi maks setengah peta: MapLibre memilih sisi popup saat masih kecil (memuat) dan tidak menghitung ulang,
 * jadi batas ini menjamin popup muat di sisi mana pun; isi yang lebih panjang digulir.
 */
export function PopupCard({ kicker, title, onClose, children }: { kicker: string; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      style={{ transformOrigin: 'bottom center' }}
      className="flex max-h-[min(30rem,calc(50dvh-3.5rem))] w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-overlay text-overlay-foreground shadow-float"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 pt-3 pr-2 pb-2 pl-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium break-words text-muted">{kicker}</p>
          <h3 className="mt-0.5 text-sm font-medium break-words">{title}</h3>
        </div>
        {/* Tutup 28px seukuran tombol isi popup (bukan 40px tombol halaman); tanpa latar, rona tipis hanya saat diarahkan. */}
        <CloseButton onPress={onClose} aria-label={t('common.close')}
          className="-mt-1 size-7 shrink-0 rounded-lg bg-transparent text-muted hover:bg-heading/[0.06] hover:text-heading [&_svg]:size-3.5" />
      </div>
      {/* Isi (galeri dokumentasi, atribut, tombol) digulir di dalam kartu; header tetap terlihat. */}
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </m.div>
  );
}

const GAP = 16;
const TIP_W = 208;
const TIP_H = 48;

/** Tooltip hover: mengikuti kursor, tak menangkap mouse, dibalik ke kiri/atas bila dekat tepi peta. */
export function HoverTip({ hover, layers }: { hover: Hover; layers: Layer[] }) {
  const t = useT();
  const { feature: f, x, y, w, h } = hover;
  const p = (f.properties ?? {}) as Props;
  const layer = layers.find((l) => `src-${l.slug}` === f.source);
  const field = layer && colorField(layer.style);
  const cls = field ? p[field] : undefined;
  const color = layer ? colorOf(layer.style, cls == null ? null : String(cls)) : 'var(--muted)';
  const title = featureLabel(p, layer, f.id);
  // Baris 2: nama layer; baris 3 (layer bertingkat): nilai beserta label atributnya, mis. "Jumlah Penduduk Miskin (jiwa): 1.234";
  // baris 4: kecamatan bila diketahui. Kelas kategori sudah ditunjukkan titik warna.
  const sub = layer?.name ?? null;
  const steps = layer?.style.steps;
  const stop = steps && cls != null ? steps.stops.findLast((s) => Number(cls) >= s.min) : undefined;
  const value = steps && cls != null
    ? `${layer!.fields.find((f) => f.key === steps.field)?.label ?? steps.field}: ${fmt(Number(cls))}${stop ? ` (${stop.label.replace(/\s*\(.*$/, '')})` : ''}`
    : null;
  const kec = p.kecamatan && p.kecamatan !== title ? t('common.kec', { name: String(p.kecamatan) }) : null;
  // ponytail: ukuran tooltip ditaksir (TIP_W × TIP_H) untuk membalik sisi; ukur DOM bila perlu presisi.
  // Dekat tepi kanan/bawah: tambatkan sisi kanan/bawah tooltip ke kursor agar lebarnya tetap mengikuti isi.
  const pos = {
    ...(x + GAP + TIP_W > w ? { right: w - x + GAP } : { left: x + GAP }),
    ...(y + GAP + TIP_H > h ? { bottom: h - y + GAP } : { top: y + GAP }),
  };
  return (
    <div role="tooltip" className="pointer-events-none absolute z-20 rounded-xl bg-overlay px-2.5 py-1.5 text-overlay-foreground shadow-float"
      style={{ ...pos, maxWidth: TIP_W }}>
      <p className="flex items-start gap-1.5 text-xs font-medium text-heading">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {/* Judul panjang boleh dua baris agar tidak terpotong. */}
        <span className="break-words">{title}</span>
      </p>
      {sub && <p className="mt-0.5 break-words pl-3.5 text-[11px] text-muted">{sub}</p>}
      {value && <p className="pl-3.5 text-[11px] text-heading tabular-nums">{value}</p>}
      {kec && <p className="break-words pl-3.5 text-[11px] text-muted">{kec}</p>}
    </div>
  );
}
