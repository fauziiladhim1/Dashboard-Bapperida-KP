import {
  Briefcase, Bulb, Calendar, Car, ChartColumn, ChartLine, ChartPie, CircleDollar, Clouds, Droplet, Factory, Flag, Flame, Globe,
  GraduationCap, HeartPulse, House, LayoutCellsLarge, MapPin, PersonWorker, Persons, Plane, Shield, ShoppingBag, Star, Thunderbolt,
  TriangleExclamation, Wrench,
} from '@gravity-ui/icons';
import { createContext, useContext, type ComponentType, type ReactNode, type SVGProps } from 'react';
import type { CardTone, LayoutCard } from '@/lib/types';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** Ikon yang bisa dipilih untuk kartu Ringkasan (disimpan sebagai `g:<nama>`). Tema pembangunan daerah, bukan seluruh set ikon. */
export const CARD_ICONS: Record<string, Icon> = {
  Persons, PersonWorker, House, Bulb, Wrench, Droplet, Flame, Clouds, TriangleExclamation, Shield, HeartPulse, GraduationCap, Factory,
  Briefcase, ShoppingBag, Car, Plane, MapPin, Globe, Thunderbolt, CircleDollar, ChartLine, ChartPie, ChartColumn, LayoutCellsLarge,
  Star, Flag, Calendar,
};

/** Warna chip ikon; `accent` = bawaan semua kartu. */
export const TONES: Record<Exclude<CardTone, `#${string}`>, string> = {
  accent: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger', muted: 'bg-default text-muted',
};

export type CardStyle = Pick<LayoutCard, 'title' | 'note' | 'icon' | 'tone' | 'foot' | 'footOff' | 'sub' | 'delta' | 'legend' | 'caption' | 'arrange'>;
/** Teks kartu yang bisa diedit sebagai template: keterangan angka, pembanding, judul legenda, keterangan grafik. */
export type Slot = 'sub' | 'delta' | 'legend' | 'caption';

/** Baris angka yang bisa diedit: template bawaan + field yang tersedia (nilai terkini, sudah diformat). */
export type TextSlot = { def: string; vars: Record<string, string | number> };
/** Isi `{nama}` dari field; field tak dikenal dibiarkan apa adanya agar salah ketik terlihat. */
export const fill = (tpl: string, vars: TextSlot['vars']) => tpl.replace(/\{(\w+)\}/g, (m, v: string) => (v in vars ? String(vars[v]) : m));
const Ctx = createContext<CardStyle>({});
/** Diisi Board per kartu; di luar Ringkasan kosong, jadi Panel/Kpi tampil seperti biasa. */
export const CardStyleProvider = Ctx.Provider;
export const useCardStyle = () => useContext(Ctx);

/** Chip ikon header kartu: ikon pilihan atau gambar unggahan editor menggantikan ikon bawaan. */
export function IconChip({ icon: fallback }: { icon?: Icon }) {
  const { icon, tone } = useCardStyle();
  const image = icon?.startsWith('data:image/png') ? icon : undefined;
  const Glyph = (icon?.startsWith('g:') && CARD_ICONS[icon.slice(2)]) || fallback;
  if (!image && !Glyph) return null;
  return (
    <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center overflow-hidden rounded-full', !tone?.startsWith('#') && TONES[(tone ?? 'accent') as keyof typeof TONES])}
      style={tone?.startsWith('#') ? { color: tone, backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)` } : undefined}>
      {image ? <img src={image} alt="" className="size-full object-contain p-1" /> : Glyph && <Glyph className="size-4" />}
    </span>
  );
}

/** Catatan editor di bawah judul kartu (mis. sumber data, definisi indikator). */
export function CardNote({ className }: { className?: string }) {
  const { note } = useCardStyle();
  return note ? <p className={cn('text-xs whitespace-pre-line text-muted', className)}>{note}</p> : null;
}

/**
 * Keterangan bawah kartu (petunjuk, sumber, catatan metodologi). `children` = teks bawaan kartu; editor bisa
 * menggantinya dengan teks sendiri atau menyembunyikannya. Kartu tanpa keterangan bawaan tetap bisa diberi teks.
 */
export function CardFoot({ children, className }: { children?: ReactNode; className?: string }) {
  const { foot, footOff } = useCardStyle();
  const body = footOff ? null : foot || children;
  return body ? <p className={cn('text-xs whitespace-pre-line text-muted', className)}>{body}</p> : null;
}
