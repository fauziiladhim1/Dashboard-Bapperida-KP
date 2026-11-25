import { ArrowDown, ArrowUp, ArrowUpRight, LayoutCellsLarge, TriangleExclamation } from '@gravity-ui/icons';
import { Card, ListBox, Select } from '@heroui/react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { m } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { MapHover, type Hover } from '@/components/map/MapHover';
import { HoverTip } from '@/components/map/MapOverlays';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Map, MapControls } from '@/components/ui/map';
import { VectorLayers } from '@/components/map/VectorLayers';
import { AnimatedNumber, EASE } from '@/components/common/motion';
import { fmt, fmtCompact, fmtDate, pct } from '@/lib/format';
import { colorOf, KULON_PROGO_CENTER } from '@/lib/layer-style';
import { usePrefs } from '@/lib/prefs';
import { useSettings } from '@/lib/settings';
import { canEdit, useMe } from '@/hooks/use-auth';
import { Panel } from '@/components/common/Panel';
import type { Layer, StatRow, TimePoint } from '@/lib/types';
import type { YearGap } from '@/lib/year-range';
import { YearNote } from '@/components/common/YearRange';
import { cn } from '@/lib/utils';

export const sum = (rows: StatRow[] | undefined, k: 'count' | 'lengthKm' | 'areaHa', key?: string) =>
  (rows ?? []).filter((r) => key === undefined || r.key === key).reduce((s, r) => s + r[k], 0);

const toggleIn = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

/**
 * Gaya legenda tunggal untuk semua rincian KPI (Breakdown, donut, kondisi jalan, tutupan lahan, peringkat):
 * judul, titik warna, dan kolom porsi sama ukurannya di setiap kartu.
 */
export const LEGEND_TITLE = 'text-xs font-medium text-muted';
/**
 * Blok legenda/rincian semua kartu Ringkasan: tanpa garis tepi dan tanpa latar, rata dengan isi kartu (padding kartu
 * 24px). Ruang sisa kartu diisi oleh konten itu sendiri (mis. donut PJU/Utilitas mengisi tinggi kartu), bukan bingkai.
 */
export const LEGEND_BOX = 'flex flex-col gap-3';
const DOT = 'size-2.5 shrink-0 rounded-full';
const PCT = 'w-10 shrink-0 text-right text-subtle tabular-nums';

export const haLabel = (v: unknown) => `${fmt(Number(v))} ha`;
export const kmLabel = (v: unknown) => `${fmt(Number(v))} km`;

type KpiProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>; label: string;
  /** `null` = tidak ada data (bukan nol): tampil "—" dan teks "belum ada data". */
  value: number | null; format: (n: number) => string; sub?: string; loading?: boolean;
  /** Angka utama berarti peringatan (mis. ruas rusak berat): merah, sama dengan Headline tone="bad". */
  tone?: 'bad';
  /** Perubahan dibanding periode sebelumnya; `bad` = naik itu buruk (merah). */
  delta?: { text: string; up: boolean; bad: boolean }; children?: ReactNode;
  /** Seluruh kartu jadi tautan (mis. ke Peta dengan layer KPI menyala), tanpa tombol di dalam kartu. */
  to?: string;
  /** Kartu selebar baris: rincian (`children`) selalu di bawah angka utama, memakai seluruh lebar kartu. */
  wide?: boolean;
  /** Tanpa angka utama di kartu: grafik di `children` sudah memuatnya (mis. total di tengah donut). */
  bare?: boolean;
};

/**
 * Angka utama KPI + baris pembanding/keterangan. Kartu biasa 34px tanpa margin atas (jarak dari header diatur `gap`
 * kartu); `big` = ukuran kartu hero (penduduk miskin), dengan margin atas sendiri.
 */
export function KpiFigure({ value, format, sub, delta, loading, tone, big }: Omit<KpiProps, 'icon' | 'label' | 'children' | 'to' | 'wide' | 'bare'> & { big?: boolean }) {
  const { t } = usePrefs();
  const Arrow = delta?.up ? ArrowUp : ArrowDown;
  const SIZE = big ? 'mt-2 text-[44px] sm:text-[56px]' : 'text-[34px]';
  return (
    <>
      {loading ? (
        <span aria-busy className={cn('skeleton block w-32 rounded-lg', big ? 'mt-2 h-14' : 'h-9')} />
      ) : value === null ? (
        <p className={cn('font-heading leading-none font-medium text-subtle', SIZE)}>—</p>
      ) : (
        <AnimatedNumber value={value} format={format} className={cn('font-heading block leading-none font-medium tracking-[-0.03em] tabular-nums', SIZE, tone === 'bad' && value > 0 ? 'text-danger' : 'text-heading')} />
      )}
      {!loading && (value === null ? <p className="mt-2 text-xs text-muted">{t('ov.noData')}</p> : (
        // Baris pembanding selalu setinggi satu baris (kosong pun), agar legenda di bawahnya sejajar antar kartu sebaris.
        <div className="mt-3 flex min-h-[1lh] flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          {delta && (
            // Pembanding tanpa latar (gaya kartu analitik): panah + teks berwarna arah baik/buruk.
            <span className={cn('inline-flex items-center gap-1 font-medium', delta.bad ? 'text-danger' : 'text-success')}>
              <Arrow className="size-3" aria-hidden />{delta.text}
            </span>
          )}
          {sub && <span className="text-muted">{sub}</span>}
        </div>
      ))}
    </>
  );
}

/** Label KPI: tautan ke Peta bila `to` diisi (panah muncul saat diarahkan). */
function KpiLabel({ label, to, className }: { label: string; to?: string; className?: string }) {
  return (
    // Judul KPI = judul kartu lain (`card__title`): ukuran & tebal sama di seluruh Ringkasan.
    <p className={cn('card__title text-balance', className)}>
      {to ? (
        <Link to={to} className="group/title inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-accent-text">
          {label}
          <ArrowUpRight aria-hidden className="size-4 shrink-0 text-accent opacity-40 transition group-hover/title:translate-x-0.5 group-hover/title:-translate-y-0.5 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
        </Link>
      ) : label}
    </p>
  );
}

const IconChip = ({ icon: Icon }: { icon: KpiProps['icon'] }) => (
  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
    <Icon className="size-4" />
  </span>
);

/** Header kartu Ringkasan: chip ikon + judul, setinggi chip (36px). Sama dengan header `Panel`. */
const KpiHead = ({ icon, label, to }: Pick<KpiProps, 'icon' | 'label' | 'to'>) => (
  <div className="flex min-h-9 items-center gap-3"><IconChip icon={icon} /><KpiLabel label={label} to={to} /></div>
);

/**
 * Kartu KPI bento. Pola semua kartu Ringkasan: padding `.card-pad` (20px ponsel, 24px ≥640px; juga `Panel`, hero & tile KPI baru), jarak antarblok 16px; header (chip + judul), angka utama,
 * baris keterangan, lalu rincian. Tata letak isi mengikuti lebar KARTU (container query), bukan layar: kartu ⅓/½
 * bertumpuk, kartu ⅔/penuh = angka di kolom kiri, rincian memakai sisa lebar. Jadi isi tetap pas saat lebar kartu
 * diubah di "Edit ringkasan".
 */
export function Kpi({ icon, label, children, to, wide, bare, ...figure }: KpiProps) {
  const showChildren = !figure.loading && figure.value !== null && children;
  return (
    <Card className="card-pad @container h-full gap-4">
      <KpiHead icon={icon} label={label} to={to} />
      <div className={cn('flex flex-1 flex-col gap-4', !wide && '@2xl:flex-row @2xl:items-start @2xl:gap-8')}>
        {bare && figure.loading ? <span aria-busy className="skeleton block h-56 w-full rounded-xl" />
          // `bare`: angka utama hanya bila tidak ada data, agar keterangan "belum ada data" tetap tampil.
          : (!bare || figure.value === null) && <div className="@2xl:w-56 @2xl:shrink-0"><KpiFigure {...figure} /></div>}
        {showChildren && <div className="flex min-w-0 flex-1 flex-col">{children}</div>}
      </div>
    </Card>
  );
}

/**
 * Kartu hero bento (lebar penuh): kiri judul + KPI utama berukuran besar + rincian (`extra`, mis. semua kecamatan),
 * kanan grafik tertanam dengan keterangan kecil di kiri atas. `children` = isi panel grafik.
 */
export function HeroKpi({ label, children, to, icon, caption, extra, ...figure }: KpiProps & { caption?: string;
  /** Rincian di bawah angka utama (mis. penduduk miskin per kecamatan). */
  extra?: ReactNode }) {
  return (
    <Card className="relative h-full flex-col gap-0 overflow-hidden p-0 md:min-h-[260px] lg:flex-row lg:items-stretch">
      {/* Padding sama dengan kartu lain (.card-pad): ikon hero sejajar dengan ikon kartu di bawahnya. */}
      <div className="card-pad flex flex-1 flex-col justify-center">
        <div className="flex items-center gap-3"><IconChip icon={icon} /><KpiLabel label={label} to={to} /></div>
        <KpiFigure {...figure} big />
        {extra && !figure.loading && figure.value !== null && <div className="mt-8 lg:max-w-md">{extra}</div>}
      </div>
      {children && (
        // Grafik langsung di kartu (tanpa bingkai/latar sendiri), keterangan kecil di kiri atas. Blok grafik pertama
        // (div pertama, mis. Spark) mengisi sisa tinggi kartu agar tidak ada ruang kosong di atasnya.
        // Grafik mulai di bawah angka utama (lg:pt-40): puncak garis tidak sejajar/melewati judul maupun angka utama di kiri.
        <div className="relative flex flex-col justify-end gap-2 px-5 pt-14 pb-5 sm:px-6 sm:pb-6 lg:max-w-[560px] lg:flex-1 lg:pt-36 lg:pr-6 lg:pl-0 [&>div:first-of-type]:flex-1">
          {caption && <p className="pointer-events-none absolute top-2 left-5 text-xs text-muted sm:left-6 lg:left-0 lg:top-6">{caption}</p>}
          {children}
        </div>
      )}
    </Card>
  );
}

/**
 * Pola hover baris daftar (rincian KPI, bahaya, kecamatan): baris diarahkan disorot, baris lain diredupkan,
 * dan `RowTip` di baris itu muncul. Tip tetap di DOM (hanya opacity), jadi pembaca layar ikut membacanya.
 */
// Redup hanya saat sebuah baris diarahkan (bukan celah antarbaris), jadi selalu ada satu baris yang tersorot.
const ROW_LIST = '[&:has(>li:hover)>li:not(:hover)]:opacity-45';
const ROW = 'group/row relative rounded-md transition hover:bg-accent/5';
function RowTip({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute -top-6 right-0 z-10 rounded-md bg-overlay px-1.5 py-0.5 text-xs whitespace-nowrap text-heading opacity-0 shadow-card-hover transition-opacity group-hover/row:opacity-100">
      {children}
    </span>
  );
}

/**
 * Legenda KPI: maks. 3 kelas teratas. Tiap baris: label, jumlah, porsi dari `total`, dan batang porsi
 * berwarna kelasnya di bawahnya (dibaca tanpa mencocokkan warna ke legenda terpisah). Kosong = tidak dirender.
 */
export function Breakdown({ items, total, format = fmt, highlight }: { items: { key: string; label: string; value: number; color: string }[]; total: number;
  /** Satuan nilai (mis. `haLabel` untuk luas); bawaan angka biasa. */
  format?: (n: number) => string;
  /** Baris yang disorot (teks tebal), mis. kelas yang jadi angka utama. */
  highlight?: string }) {
  if (!items.length) return null;
  return (
    <div className={LEGEND_BOX}>
      <ul className={cn(ROW_LIST, '-mx-1.5 flex flex-col gap-1 text-xs')}>
        {items.slice(0, 3).map((i, n) => (
          <li key={i.key} className={cn(ROW, 'flex flex-col gap-1 px-1.5 py-1')}>
            <span className="flex items-baseline gap-2">
              <span className={cn('min-w-0 flex-1 leading-snug', i.key === highlight ? 'font-medium text-heading' : 'text-muted')} title={i.label}>{i.label}</span>
              <span className="font-medium text-heading tabular-nums">{format(i.value)}</span>
              <span className={PCT}>{pctLabel(i.value, total)}</span>
            </span>
            <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-default">
              <m.span className="block h-full origin-left rounded-full" style={{ backgroundColor: i.color, width: `${pct(i.value, total)}%` }}
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 + n * 0.08 }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Part = { key: string; label: string; value: number; color: string };

/**
 * Donut porsi kecil + legenda (maks. 5 irisan; sisanya digabung "Lainnya"). Untuk komposisi satu keseluruhan
 * (mis. jenis lampu PJU), bukan peringkat. Tengah: kosong, atau porsi irisan yang diarahkan (jumlah kelas sudah di baris keterangan).
 */
export function MiniDonut({ items, total, format = fmt, title }: { items: Part[]; total: number; format?: (n: number) => string; title?: string }) {
  const { t } = usePrefs();
  const [hot, setHot] = useState<string | null>(null);
  if (!items.length || total <= 0) return null;
  const head = items.slice(0, 5);
  const rest = items.slice(5).reduce((n, i) => n + i.value, 0);
  const parts = rest > 0 ? [...head, { key: '__rest', label: t('ov.other'), value: rest, color: '#A9AFA9' }] : head;
  const cur = parts.find((p) => p.key === hot);
  let start = 0;
  return (
    <div className={cn(LEGEND_BOX, 'flex-1 justify-center')} onMouseLeave={() => setHot(null)}>
      {title && <p className={LEGEND_TITLE}>{title}</p>}
      {/* Kartu sempit (< 21rem, mis. ⅓ lebar di layar 1024 atau ponsel): donut di atas legenda, agar label tak menyusut jadi 0. */}
      <div className="flex flex-col items-center gap-4 @[21rem]:flex-row">
        <div className="relative size-36 shrink-0">
          {/* viewBox diberi tepi 1 unit: busur diarahkan (stroke 5) menjangkau r 18,4, lewat kotak 36 dan terpotong. */}
          <svg viewBox="-1 -1 38 38" className="size-full -rotate-90" aria-hidden>
            {parts.map((p) => {
              const len = (p.value / total) * 100;
              const seg = (
                <circle key={p.key} cx="18" cy="18" r="15.915" fill="none" stroke={p.color} strokeWidth={hot === p.key ? 5 : 4}
                  strokeDasharray={`${Math.max(len - 0.8, 0.3)} ${100 - Math.max(len - 0.8, 0.3)}`} strokeDashoffset={-start}
                  strokeOpacity={hot !== null && hot !== p.key ? 0.3 : 1} className="transition-[stroke-width,stroke-opacity]" onMouseEnter={() => setHot(p.key)} />
              );
              start += len;
              return seg;
            })}
          </svg>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-heading tabular-nums">
            {cur && pctLabel(cur.value, total)}
          </span>
        </div>
        {/* Lebar legenda dibatasi: di kartu lebar angka tetap dekat labelnya, tak terlempar ke tepi kanan. */}
        <ul className="flex w-full min-w-0 max-w-sm flex-1 flex-col gap-2.5 text-xs">
          {parts.map((p) => (
            <li key={p.key} onMouseEnter={() => setHot(p.key)} className={cn('flex items-center gap-2 transition-opacity', hot !== null && hot !== p.key && 'opacity-40')}>
              <span aria-hidden className={DOT} style={{ backgroundColor: p.color }} />
              <span className="min-w-0 flex-1 truncate text-muted" title={p.label}>{p.label}</span>
              <span className="font-medium text-heading tabular-nums">{format(p.value)}</span>
              <span className={PCT}>{pctLabel(p.value, total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export type ChartKind = 'auto' | 'number' | 'bar' | 'line' | 'donut';

/**
 * Bentuk grafik dari bentuk data (dipakai KPI bawaan & kustom): kunci berupa tahun = deret waktu (line); kategori
 * sedikit (<= 6) yang menjumlah jadi satu keseluruhan = komposisi (donut); kategori banyak = peringkat (bar).
 */
export const pickChart = (keys: (string | null)[], additive = true): Exclude<ChartKind, 'auto'> => {
  if (!keys.length) return 'number';
  if (keys.length >= 2 && keys.every((k) => k !== null && /^\d{4}$/.test(k))) return 'line';
  return additive && keys.length <= 6 ? 'donut' : 'bar';
};

/** Porsi untuk legenda: kelas kecil tetap terbaca (< 1%), bukan 0%. */
export const pctLabel = (v: number, total: number) => (v > 0 && pct(v, total) === 0 ? '<1%' : `${pct(v, total)}%`);

type LandGroup = { key: string; label: string; value: number; color: string; members: { label: string; value: number }[] };

/**
 * Tutupan lahan per kelompok (`style.groups` layer: Pertanian, Vegetasi, Permukiman, ...): donut di kiri (luas total
 * di tengahnya, tanpa judul di atas), tabel berperingkat di kanan (kelompok, luas, porsi, 3 kelas penyusun terluas). Warna kelompok = warna kelas
 * terluasnya, jadi sama dengan peta. Kelas di luar kelompok = "Lainnya"; kelas kosong di data = "Tanpa kelas".
 * Diarahkan (busur atau baris): kelompok itu disorot, yang lain diredupkan, porsinya tampil di tengah donut.
 */
export function LandCover({ rows, layer, total }: { rows: StatRow[]; layer?: Layer; total: number }) {
  const { t } = usePrefs();
  const [hot, setHot] = useState<string | null>(null);
  const style = layer?.style ?? { color: '#9CA3AF' };
  const groups = useMemo(() => {
    const of = new globalThis.Map<string, string>();
    for (const [g, ks] of Object.entries(style.groups ?? {})) for (const k of ks) of.set(k, g);
    const acc = new globalThis.Map<string, LandGroup & { top: number }>();
    for (const r of rows) {
      if (r.areaHa <= 0) continue;
      const g = r.key ? (of.get(r.key) ?? t('ov.other')) : t('ov.noClass');
      const e = acc.get(g) ?? { key: g, label: g, value: 0, color: '#A9AFA9', members: [], top: 0 };
      e.value += r.areaHa;
      if (r.key) {
        e.members.push({ label: style.labels?.[r.key] ?? r.key, value: r.areaHa });
        if (r.areaHa > e.top) { e.top = r.areaHa; e.color = colorOf(style, r.key); }
      }
      acc.set(g, e);
    }
    return [...acc.values()].sort((a, b) => b.value - a.value).map((g) => ({ ...g, members: g.members.sort((a, b) => b.value - a.value) }));
  }, [rows, style, t]);
  if (!groups.length || total <= 0) return null;
  const dim = (k: string) => hot !== null && hot !== k && 'opacity-35';
  const cur = groups.find((g) => g.key === hot);
  const kelas = rows.filter((r) => r.key && r.areaHa > 0).length;
  let start = 0;
  return (
    // Tanpa judul/angka di atas donut: total tampil di tengah donut. flex-1 + items-center: kartu setinggi KPI sebaris
    // (tinggi minimum dari OverviewPage), donut & tabel di tengah ruang itu.
    <div className="flex flex-1 flex-col items-center gap-6 @2xl:flex-row @2xl:gap-10" onMouseLeave={() => setHot(null)}>
      {/* Donut kelompok (r = 100/2π: panjang busur = persen). Tengah: luas total, atau porsi + nama kelompok yang diarahkan. */}
      <div className="relative size-56 shrink-0">
        {/* viewBox diberi tepi 1 unit: busur diarahkan (stroke 5) menjangkau r 18,4, lewat kotak 36 dan terpotong. */}
        <svg viewBox="-1 -1 38 38" className="size-full -rotate-90" aria-hidden>
          {groups.map((g, n) => {
            const len = (g.value / total) * 100;
            const seg = (
              <m.circle key={g.key} cx="18" cy="18" r="15.915" fill="none" stroke={g.color} strokeWidth={hot === g.key ? 4.5 : 3.5}
                strokeDasharray={`${Math.max(len - 0.8, 0.3)} ${100 - Math.max(len - 0.8, 0.3)}`} strokeDashoffset={-start}
                strokeOpacity={hot !== null && hot !== g.key ? 0.3 : 1} className="cursor-pointer transition-[stroke-width,stroke-opacity]" onMouseEnter={() => setHot(g.key)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, ease: EASE, delay: 0.1 + n * 0.06 }} />
            );
            start += len;
            return seg;
          })}
        </svg>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span className="font-heading text-[28px] leading-none font-medium tracking-[-0.03em] text-heading tabular-nums">
            {cur ? pctLabel(cur.value, total) : haLabel(Math.round(total))}
          </span>
          <span className="mt-2 text-xs leading-tight text-muted">
            {cur ? `${cur.label}, ${haLabel(Math.round(cur.value))}` : t('ov.kpiLandSub', { n: fmt(kelas), g: fmt(groups.filter((g) => g.members.length).length) })}
          </span>
        </span>
      </div>
      {/* Legenda = tabel berperingkat (kelompok, luas, porsi, kelas penyusun): 6 baris terbaca sekilas, angka rata kanan
          sehingga mudah dibandingkan. Kartu sempit: kolom kelas penyusun disembunyikan. */}
      <table className="w-full min-w-0 flex-1 table-fixed border-collapse text-xs">
        <thead>
          <tr className="text-left text-subtle">
            <th scope="col" className="w-[38%] pb-2 font-normal @3xl:w-[26%]">{t('ov.lcGroup')}</th>
            <th scope="col" className="pb-2 text-right font-normal">{t('ov.lcArea')}</th>
            <th scope="col" className="w-14 pb-2 text-right font-normal">{t('ov.lcShare')}</th>
            <th scope="col" className="hidden w-[44%] pb-2 pl-6 font-normal @3xl:table-cell">{t('ov.lcClasses')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-separator border-t border-separator">
          {groups.map((g) => (
            <tr key={g.key} className={cn('cursor-default transition', dim(g.key), hot === g.key && 'bg-accent/5')} onMouseEnter={() => setHot(g.key)}>
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={DOT} style={{ backgroundColor: g.color }} />
                  <span className="truncate font-medium text-heading" title={g.label}>{g.label}</span>
                </span>
              </th>
              <td className="py-2 text-right text-muted tabular-nums">{haLabel(Math.round(g.value))}</td>
              <td className="py-2 text-right font-medium text-heading tabular-nums">{pctLabel(g.value, total)}</td>
              <td className="hidden truncate py-2 pl-6 text-subtle @3xl:table-cell" title={g.members.map((x) => x.label).join(', ')}>
                {g.members.length ? <>
                  {g.members.slice(0, 3).map((x) => `${x.label} ${pctLabel(x.value, total)}`).join(', ')}
                  {g.members.length > 3 && `, ${t('ov.moreClasses', { n: g.members.length - 3 })}`}
                </> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sparkline tren (SVG polyline, tanpa sumbu). Diarahkan: titik pindah ke tahun terdekat dan nilainya tampil. < 2 titik = tidak dirender. */
export function Spark({ points, format = fmt, className = 'h-12', labels }: { points: { label: string; value: number }[]; format?: (n: number) => string; className?: string;
  /** Nilai ringkas di atas tiap titik + tahun di bawahnya (seri pendek, mis. 3 tahun kemiskinan). */
  labels?: (n: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const gid = `spark-${useId().replace(/:/g, '')}`;
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - ((v - min) / span) * 28] as const);
  const at = hi ?? points.length - 1;
  const [x, y] = xy[at]!;
  return (
    <div aria-hidden className="flex flex-col gap-1">
      <div className={cn('relative w-full cursor-crosshair text-chart-1', className)} data-testid="spark-area"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = r.width ? Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)) : points.length - 1;
          setHi(Math.min(points.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHi(null)}>
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" data-testid="spark">
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="1" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Area bergradasi di bawah garis, muncul pelan setelah kartu tampil. */}
          <m.path d={`M0,32 L${xy.map((p) => p.join(',')).join(' L')} L100,32 Z`} fill={`url(#${gid})`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.2 }} />
          <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hi !== null && <span aria-hidden className="absolute inset-y-0 w-px -translate-x-1/2 bg-current opacity-30" style={{ left: `${x}%` }} />}
        {labels && hi === null && xy.map(([px, py], i) => (
          <span key={i} className="pointer-events-none absolute flex flex-col items-center" style={{ left: `${px}%`, top: `${(py / 32) * 100}%` }}>
            <span className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current opacity-70" />
            <span className={cn('absolute -translate-y-[calc(100%+8px)] rounded px-1 text-xs font-medium whitespace-nowrap text-heading tabular-nums',
              px > 90 ? '-translate-x-full' : px < 10 ? '' : '-translate-x-1/2')}>{labels(points[i]!.value)}</span>
          </span>
        ))}
        {/* Titik HTML, bukan <circle>: SVG direntang tanpa rasio tetap, lingkaran jadi lonjong. */}
        <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-surface" style={{ left: `${x}%`, top: `${(y / 32) * 100}%` }} />
        {hi !== null && (
          <span className={cn('absolute -top-6 rounded-md bg-overlay px-1.5 py-0.5 text-xs whitespace-nowrap text-heading shadow-card-hover tabular-nums',
            x > 60 ? '-translate-x-full' : x < 40 ? '' : '-translate-x-1/2')} style={{ left: `${x}%` }}>
            {points[hi]!.label}: <b className="font-medium">{format(points[hi]!.value)}</b>
          </span>
        )}
      </div>
      {/* Rentang garis: tanpa sumbu, cukup tahun awal & akhir; dengan `labels`, semua tahun (titik berjarak sama). */}
      {labels ? (
        // Tiap label tepat di bawah titiknya, selebar jarak antartitik (terpotong + title bila kartu sempit), agar tak bertabrakan.
        <div className="relative h-[1lh] text-xs text-subtle tabular-nums">
          {xy.map(([px], i) => (
            <span key={i} title={points[i]!.label} className={cn('absolute truncate', px > 90 ? '-translate-x-full text-right' : px < 10 ? '' : '-translate-x-1/2 text-center')}
              // Label tepi rata kiri/kanan: setengah jarak, sisanya milik label tetangga yang rata tengah.
              style={{ left: `${px}%`, maxWidth: `${(i === 0 || i === xy.length - 1 ? 50 : 100) / (points.length - 1)}%` }}>{points[i]!.label}</span>
          ))}
        </div>
      ) : (
        <div className="flex justify-between text-xs text-subtle tabular-nums">
          {[points[0]!, points.at(-1)!].map((p, i) => <span key={i}>{p.label}</span>)}
        </div>
      )}
    </div>
  );
}

/** Keadaan kosong/galat. `retry` diisi bila query gagal: pesan galat + tombol coba lagi, bukan "belum ada data" yang menyesatkan. */
export function Empty({ retry }: { retry?: () => void }) {
  const { t } = usePrefs();
  const { data: me } = useMe();
  if (retry) {
    return (
      <div role="alert" className="grid min-h-24 flex-1 place-items-center gap-2 rounded-xl bg-danger/5 px-4 py-4 text-center text-sm text-danger">
        {t('ov.loadError')}
        <button type="button" onClick={retry} className="text-sm font-medium underline-offset-2 hover:underline">{t('err.retry')}</button>
      </div>
    );
  }
  // Ajakan unggah hanya untuk yang bisa mengunggah.
  return <p className="grid min-h-24 flex-1 place-items-center rounded-xl bg-default/50 px-4 text-center text-sm text-muted">{canEdit(me) ? t('ov.empty') : t('ov.emptyViewer')}</p>;
}

/** Palet seri tren mengikuti tema (hijau tua, terakota, oker, tosca, lavender gelap); rona berjauhan agar tetap terbedakan. */
const POOR_COLOR = '#C2412D';
const ROAD_COLOR = '#4C6B57';
const DAMAGED_COLOR = '#C98A2B';
const LAYER_COLORS = ['#4C6B57', '#6E7FB8', '#C98A2B', '#4F8F91', '#C2412D'];
/** Jenis lampu PJU (urut terbanyak): tosca, oker, lavender, hijau tua; "Tidak Tercatat"/"Hilang" abu-abu. */
const LAMP_COLORS = ['#4F8F91', '#C98A2B', '#6E7FB8', '#4C6B57'];
const SHAPES = ['circle', 'square', 'diamond', 'triangle'] as const;
const DASHES = [undefined, '6 4', '2 3', '8 3 2 3'];

type Unit = 'jiwa' | 'km' | 'fitur' | 'titik' | 'watt';
/** Bentuk grafik per topik: batang (data sedikit tahun / arus per tahun), batang tumpuk (rincian), area (stok berkelanjutan). */
type Chart = 'bar' | 'stack' | 'area';
/** `badUp`: kenaikan itu buruk (kemiskinan, jalan rusak) -> selisih positif merah, turun hijau. */
type Series = { key: string; label: string; color: string; unit: Unit; chart: Chart; shape: (typeof SHAPES)[number]; dash?: string; badUp?: boolean };
type Topic = 'kemiskinan' | 'wilayah' | 'jalan' | 'pju' | 'pjuTotal' | 'pjuWatt' | 'layer';
/** Seri bersarang (peta nama -> nilai per tahun): kunci seri = `<prefix>.<nama>`. */
const NESTED = ['layers', 'miskinWilayah', 'pjuLampu'] as const;

/** Penanda titik: bentuk berbeda per seri agar tidak bergantung pada warna saja. */
function Marker({ cx = 0, cy = 0, s, r = 4, hollow }: { cx?: number; cy?: number; s: Series; r?: number;
  /** Titik tahun yang tak sebanding (lihat `incomparableYears`): berongga, tidak dibandingkan. */
  hollow?: boolean }) {
  const p = hollow ? { fill: 'var(--surface)', stroke: s.color, strokeWidth: 1.5 } : { fill: s.color, stroke: 'var(--surface)', strokeWidth: 1.5 };
  if (s.shape === 'square') return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} {...p} />;
  if (s.shape === 'diamond') return <polygon points={`${cx},${cy - r - 1} ${cx + r + 1},${cy} ${cx},${cy + r + 1} ${cx - r - 1},${cy}`} {...p} />;
  if (s.shape === 'triangle') return <polygon points={`${cx},${cy - r - 1} ${cx + r + 1},${cy + r} ${cx - r - 1},${cy + r}`} {...p} />;
  return <circle cx={cx} cy={cy} r={r} {...p} />;
}

/** Contoh garis + penanda (kotak untuk batang), dipakai di chip dan tooltip. */
const Swatch = ({ s }: { s: Series }) => s.chart !== 'area' ? <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} /> : (
  <svg aria-hidden width="22" height="12" viewBox="0 0 22 12" className="shrink-0 overflow-visible">
    <line x1="1" y1="6" x2="21" y2="6" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" />
    <Marker cx={11} cy={6} s={s} r={3} />
  </svg>
);

type TipProps = { active?: boolean; label?: unknown; payload?: { dataKey?: unknown; value?: unknown }[]; series: Series[]; unitOf: (u: Unit, v: number) => string;
  /** Nilai tahun berdata sebelumnya untuk seri `key`, agar tooltip menyebut perubahan (YoY). */
  prevOf?: (key: string, tahun: number) => { tahun: number; v: number } | undefined;
  /** Label baris jumlah (batang tumpuk). */
  total?: string };

/** Tooltip ringkas: tahun lalu semua seri yang tampil, urut dari nilai terbesar. */
function TrendTip({ active, label, payload, series, unitOf, prevOf, total }: TipProps) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => p.value != null)
    .map((p) => ({ s: series.find((s) => s.key === p.dataKey), v: Number(p.value) }))
    .filter((r): r is { s: Series; v: number } => !!r.s && Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v); // Recharts sudah membuang nilai null dari payload: rows tak pernah kosong di sini.
  return (
    <div className="min-w-40 rounded-xl border border-border bg-overlay px-2.5 py-1.5 text-xs shadow-card-hover">
      <p className="mb-1 font-semibold text-foreground tabular-nums">{String(label)}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map(({ s, v }) => (
          <li key={s.key} className="flex flex-col">
            <span className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-muted"><Swatch s={s} />{s.label}</span>
              <b className="font-medium text-foreground tabular-nums">{unitOf(s.unit, v)}</b>
            </span>
            <Change s={s} prev={prevOf?.(s.key, Number(label))} v={v} className="self-end" />
          </li>
        ))}
      </ul>
      {total && rows.length > 1 && (
        <p className="mt-1 flex justify-between gap-4 border-t border-separator pt-1 text-muted">{total}
          <b className="font-medium text-foreground tabular-nums">{unitOf(rows[0]!.s.unit, rows.reduce((n, r) => n + r.v, 0))}</b></p>
      )}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

/**
 * Tahun yang nilainya < 25% tahun berdata berikutnya: hampir pasti satuan berbeda (mis. kemiskinan 2024 = 9.821 vs
 * 2025 = 71.432 jiwa, kemungkinan KK). Tetap digambar, tapi tidak dipakai sebagai pembanding.
 */
// ponytail: heuristik rasio 25%; ganti dengan kolom satuan di data bila tersedia.
export function incomparableYears(vals: { tahun: number; v: number | null | undefined }[]) {
  const out = new Set<number>();
  vals.forEach((p, i) => {
    const next = vals.slice(i + 1).find((q) => q.v != null);
    // Nol itu nilai sah (mis. jalan rusak 0 km), bukan tanda satuan berbeda.
    if (p.v && next && p.v < next.v! * 0.25) out.add(p.tahun);
  });
  return out;
}

/** Selisih berwarna vs nilai sebelumnya: merah bila naik pada seri `badUp`, hijau bila turun (dan sebaliknya). */
function Change({ s, prev, v, className }: { s: Series; prev?: { tahun: number; v: number }; v: number; className?: string }) {
  const { t } = usePrefs();
  if (!prev) return null;
  const diff = v - prev.v;
  const bad = s.badUp ? diff > 0 : diff < 0;
  return (
    <span className={cn('text-xs tabular-nums', diff === 0 ? 'text-muted' : bad ? 'text-danger' : 'text-success', className)}>
      {signed(diff)}{prev.v ? ` (${signed((diff / prev.v) * 100)}%)` : ''} {t('ov.vsYear', { tahun: prev.tahun })}
    </span>
  );
}

/** Tahun lama -> baru di "Kemiskinan per wilayah": makin tegas, tahun terakhir = merah kemiskinan. */
const YEAR_COLORS = ['#C9B79C', '#C98A2B', POOR_COLOR];

/**
 * Kemiskinan per wilayah: semua wilayah (baris) x tahun berdata (batang), urut jiwa miskin tahun terakhir.
 * Angka utama = berapa wilayah naik antara dua tahun sebanding terakhir.
 */
function AreaBars({ data, keys, years, odd, unitOf }: {
  data: { tahun: number; miskinWilayah: Record<string, number | null> }[]; keys: string[]; years: Series[];
  odd: Set<number>; unitOf: (u: Unit, v: number) => string;
}) {
  const { t } = usePrefs();
  const at = (y: number, w: string) => data.find((p) => p.tahun === y)?.miskinWilayah[w] ?? null;
  const ys = years.map((s) => Number(s.label));
  const last = ys.at(-1)!;
  const names = keys.map((k) => k.slice('miskinWilayah.'.length)).sort((a, b) => (at(last, b) ?? 0) - (at(last, a) ?? 0));
  const rows = names.map((w) => ({ wilayah: w, ...Object.fromEntries(ys.map((y) => [`y${y}`, at(y, w)])) }));
  const cmp = ys.filter((y) => !odd.has(y)).slice(-2);
  const up = cmp.length === 2 ? names.filter((w) => (at(cmp[1]!, w) ?? 0) > (at(cmp[0]!, w) ?? 0)).length : null;
  const tick = { fill: 'var(--muted)', fontSize: 12 };
  return (
    <div className="flex flex-col gap-4">
      {up !== null && (
        <div aria-live="polite"><KpiFigure value={up} tone={up > 0 ? 'bad' : undefined}
          format={(n) => t('ov.areaUp', { n: fmt(n), total: fmt(names.length) })} sub={t('ov.areaUpSub', { dari: cmp[0]!, sampai: cmp[1]! })} /></div>
      )}
      {/* Tinggi mengikuti jumlah wilayah agar semua nama terbaca (12 kecamatan = ±400 px). */}
      <div style={{ height: names.length * 30 + 40 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barGap={1} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="var(--separator)" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => fmtCompact(v)} />
            <YAxis type="category" dataKey="wilayah" tickLine={false} axisLine={false} tick={tick} width={104} interval={0} />
            <Tooltip content={<TrendTip series={years} unitOf={unitOf} />} cursor={{ fill: 'var(--default)', fillOpacity: 0.5 }} />
            {years.map((s) => (odd.has(Number(s.label))
              ? <Bar key={s.key} dataKey={s.key} name={s.label} fill="var(--surface)" stroke={s.color} strokeWidth={1.5} strokeDasharray="3 2" radius={[0, 3, 3, 0]} maxBarSize={10} />
              : <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[0, 3, 3, 0]} maxBarSize={10} animationDuration={300} />))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {odd.size > 0 && <p className="text-xs text-muted">{t('ov.incomparable', { tahun: [...odd].join(', ') })}</p>}
    </div>
  );
}

/**
 * Tren tahunan, satu-satunya elemen berseri di dasbor. Dropdown "Analisis data" memilih topik dulu; satu topik =
 * satu satuan, jadi cukup satu sumbu kiri. Semua seri topik selalu tampil; legenda statis menyebut serinya.
 * Rentang diatur YearRange lokal di panel, bukan tahun global.
 */
export function TimeSeries({ points, loading, retry }: { points: TimePoint[]; loading?: boolean; retry?: () => void }) {
  const { t } = usePrefs();
  // null = topik default: yang tahun berdatanya terbanyak (bukan selalu kemiskinan).
  const [topic, setTopic] = useState<Topic | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  // 0 pada tahun tanpa survei = tidak ada data, bukan nol: jadikan null agar garis tidak jatuh palsu ke 0.
  // Sebaran kemiskinan: 0 kalurahan itu nilai sah, jadi hanya tahun tanpa data kemiskinan yang null.
  const nullZero = (o?: Record<string, number>) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v || null]));
  // Kumulatif PJU hanya di tahun berpemasangan; antartahun ditahan garis tangga (stepAfter), tidak diinterpolasi.
  let cum = 0;
  const all = points.map((p) => ({
    ...p, miskin: p.miskin || null, jalanKm: p.jalanKm || null, jalanRusakKm: p.jalanKm ? p.jalanRusakKm : null,
    pjuPasang: p.pjuPasang || null,
    pjuWatt: p.pjuPasang ? (p.pjuWatt || null) : null, pjuTotal: p.pjuPasang ? (cum += p.pjuPasang) : null,
    layers: nullZero(p.layers), miskinWilayah: nullZero(p.miskinWilayah), pjuLampu: nullZero(p.pjuLampu),
  }));
  type Row = (typeof all)[number];
  const val = (p: Row, key: string) => {
    const nested = NESTED.find((n) => key.startsWith(`${n}.`));
    return nested ? p[nested][key.slice(nested.length + 1)] : p[key as 'miskin'];
  };
  // Seri dari layer bertahun (mis. PJU 2025, PJU 2026): hanya yang punya data di >= 2 tahun dalam rentang, agar benar-benar tren.
  const layerKeys = [...new Set(points.flatMap((p) => Object.keys(p.layers ?? {})))].filter((k) => points.filter((p) => p.layers?.[k]).length >= 2);
  // Kemiskinan per wilayah: semua wilayah yang pernah berdata (12 kecamatan, atau kalurahan bila filter kecamatan aktif).
  const areaKeys = [...new Set(points.flatMap((p) => Object.keys(p.miskinWilayah ?? {})))];
  // Jenis lampu PJU dari data (urut total terbanyak); "Tidak Tercatat"/"Hilang" abu-abu.
  const lampTotals = new globalThis.Map<string, number>();
  for (const p of points) for (const [k, v] of Object.entries(p.pjuLampu ?? {})) lampTotals.set(k, (lampTotals.get(k) ?? 0) + v);
  const lampKeys = [...lampTotals].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const years = (f: (p: TimePoint) => number | null | undefined) => points.filter((p) => f(p)).length >= 2;
  type T = { id: Topic; label: string; unit: Unit; chart: Chart; series: Omit<Series, 'shape' | 'dash' | 'unit' | 'chart'>[] };
  const topics: T[] = [
    { id: 'kemiskinan', label: t('ov.topicPoverty'), unit: 'jiwa', chart: 'bar', series: [{ key: 'miskin', label: t('ov.poor'), color: POOR_COLOR, badUp: true }] },
    ...(areaKeys.length && years((p) => p.miskin) ? [{ id: 'wilayah' as const, label: t('ov.topicPovertyArea'), unit: 'jiwa' as const, chart: 'bar' as const,
      series: areaKeys.map((k, i) => ({ key: `miskinWilayah.${k}`, label: k, color: LAYER_COLORS[i % LAYER_COLORS.length]!, badUp: true })) }] : []),
    ...(points.filter((p) => p.jalanKm).length >= 2 ? [{ id: 'jalan' as const, label: t('ov.topicRoad'), unit: 'km' as const, chart: 'area' as const, series: [
      { key: 'jalanKm', label: t('ov.roadKm'), color: ROAD_COLOR }, { key: 'jalanRusakKm', label: t('ov.damagedKm'), color: DAMAGED_COLOR, badUp: true },
    ] }] : []),
    ...(years((p) => p.pjuPasang) ? [
      { id: 'pju' as const, label: t('ov.topicPju'), unit: 'titik' as const, chart: 'stack' as const,
        series: lampKeys.map((k, i) => ({ key: `pjuLampu.${k}`, label: k, color: /^(tidak tercatat|hilang)$/i.test(k) ? '#9CA3AF' : LAMP_COLORS[i % LAMP_COLORS.length]! })) },
      { id: 'pjuTotal' as const, label: t('ov.topicPjuTotal'), unit: 'titik' as const, chart: 'area' as const,
        series: [{ key: 'pjuTotal', label: t('ov.pjuCumulative'), color: ROAD_COLOR }] },
      ...(years((p) => p.pjuWatt) ? [{ id: 'pjuWatt' as const, label: t('ov.topicPjuWatt'), unit: 'watt' as const, chart: 'bar' as const,
        series: [{ key: 'pjuWatt', label: t('ov.pjuWatt'), color: DAMAGED_COLOR }] }] : []),
    ] : []),
    ...(layerKeys.length ? [{ id: 'layer' as const, label: t('ov.topicLayer'), unit: 'fitur' as const, chart: 'area' as const,
      series: layerKeys.map((k, i) => ({ key: `layers.${k}`, label: k, color: LAYER_COLORS[i % LAYER_COLORS.length]! })) }] : []),
  ];
  const yearsOf = (x: T) => all.filter((p) => x.series.some((s) => val(p, s.key) != null)).length;
  const cur = topics.find((x) => x.id === topic) ?? topics.reduce((a, b) => (yearsOf(b) > yearsOf(a) ? b : a));
  const series: Series[] = cur.series.map((s, i) => ({ ...s, unit: cur.unit, chart: cur.chart, shape: SHAPES[i % SHAPES.length]!,
    dash: cur.chart === 'area' ? DASHES[i % DASHES.length] : undefined }));
  const unitOf = (u: Unit, v: number) => ({
    jiwa: () => t('map.people', { n: fmt(v) }), km: () => kmLabel(v), fitur: () => t('map.nFeatures', { n: fmt(v) }),
    titik: () => t('ov.points', { n: fmt(v) }), watt: () => `${fmt(v)} W`,
  })[u]();
  const unitShort: Record<Unit, string> = { jiwa: t('unit.people'), km: 'km', fitur: t('unit.features'), titik: t('unit.points'), watt: t('unit.watt') };
  // Sumbu waktu dipotong ke tahun berdata topik aktif: PJU mulai 2002 tidak membuat grafik kemiskinan (2024–2026) kosong 20 tahun.
  const has = (p: Row) => series.some((s) => val(p, s.key) != null);
  const [first, last] = [all.findIndex(has), all.findLastIndex(has)];
  // Tahun tanpa baris di rentang itu diisi kosong (null), agar jarak sumbu sebanding waktu: PJU 2003 lalu 2013 tidak
  // digambar bersebelahan seolah setahun.
  const byYear = new globalThis.Map(all.map((p) => [p.tahun, p]));
  const gap = (tahun: number) => ({ tahun, miskin: null, jalanKm: null, jalanRusakKm: null, pjuPasang: null, pjuWatt: null,
    pjuTotal: null, layers: {}, miskinWilayah: {}, pjuLampu: {} }) as unknown as Row;
  const data = first < 0 ? [] : Array.from({ length: all[last]!.tahun - all[first]!.tahun + 1 }, (_, i) => all[first]!.tahun + i)
    .map((y) => byYear.get(y) ?? gap(y));
  const hasData = data.some(has);
  // Seri per wilayah memakai tahun tak sebanding dari total kemiskinan: angka wilayah 2024 ikut satuan data yang berbeda.
  // Topik PJU = arus per tahun / kumulatif (wajar naik-turun tajam): heuristik satuan berbeda tidak berlaku.
  const pjuTopic = cur.id.startsWith('pju');
  const oddBase = (key: string) => (key.startsWith('miskinWilayah.') ? 'miskin' : key);
  const odd = Object.fromEntries(series.map((s) => [s.key, pjuTopic ? new Set<number>()
    : incomparableYears(data.map((p) => ({ tahun: p.tahun, v: val(p, oddBase(s.key)) })))]));
  const oddYears = [...new Set(series.flatMap((s) => [...odd[s.key]!]))];
  // Pembanding = tahun berdata sebelumnya yang sebanding; tahun tak sebanding tidak dibandingkan (ke/dari).
  const prevOf = (key: string, tahun: number) => {
    if (odd[key]?.has(tahun)) return undefined;
    const p = data.filter((d) => d.tahun < tahun && val(d, key) != null && !odd[key]?.has(d.tahun)).at(-1);
    return p ? { tahun: p.tahun, v: val(p, key)! } : undefined;
  };
  const tick = { fill: 'var(--muted)', fontSize: 12 };
  const fade = (k: string) => (hot && hot !== k ? 0.2 : 1);
  // Angka utama. Arus per tahun (pemasangan, daya): jumlah sepanjang rentang. Stok (kemiskinan, kumulatif, jalan):
  // perubahan tahun sebanding pertama → terakhir untuk seri pertama atau yang diarahkan.
  const flow = cur.chart === 'stack' || cur.id === 'pjuWatt';
  const lead = series.find((s) => s.key === hot) ?? series[0]!;
  const leadKeys = flow && !hot ? series.map((s) => s.key) : [lead.key];
  const span = data.filter((p) => leadKeys.some((k) => val(p, k) != null) && !odd[lead.key]?.has(p.tahun));
  const [from, to] = [span[0], span.at(-1)];
  const fromV = from ? val(from, lead.key) ?? 0 : 0;
  const total = span.reduce((n, p) => n + leadKeys.reduce((m, k) => m + (val(p, k) ?? 0), 0), 0);
  const diff = from && to && from !== to ? (val(to, lead.key) ?? 0) - fromV : null;
  const tanpaTahun = pjuTopic ? (points[0]?.pjuTanpaTahun ?? 0) : 0;
  const bars = cur.chart !== 'area';
  // Per wilayah: baris = wilayah, satu batang per tahun berdata (lama -> baru, warna makin tegas), urut jiwa miskin tahun terakhir.
  const areaYears = cur.id === 'wilayah' ? data.filter(has).map((p) => p.tahun) : [];
  const yearSeries: Series[] = areaYears.map((y, i) => ({ key: `y${y}`, label: String(y), unit: 'jiwa', chart: 'bar', shape: 'square', badUp: true,
    color: YEAR_COLORS[YEAR_COLORS.length - areaYears.length + i] ?? YEAR_COLORS[0]! }));
  const legend = cur.id === 'wilayah' ? yearSeries : series;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Select aria-label={t('ov.analysis')} selectedKey={cur.id} onSelectionChange={(k) => k !== null && setTopic(k as Topic)} className="w-full sm:w-auto">
          <Select.Trigger className="min-h-10 gap-2 whitespace-nowrap bg-surface text-sm text-heading">
            <span className="shrink-0 text-muted">{t('ov.analysis')}</span>
            <Select.Value className="min-w-0 truncate font-medium" />
            <Select.Indicator />
          </Select.Trigger>
          {/* Daftar minimal selebar tombol, item satu baris: label topik tidak terlipat. */}
          <Select.Popover className="min-w-(--trigger-width) w-auto">
            <ListBox items={topics} className="whitespace-nowrap">
              {(it: { id: Topic; label: string }) => (
                <ListBox.Item id={it.id} textValue={it.label}>{it.label}<ListBox.ItemIndicator /></ListBox.Item>
              )}
            </ListBox>
          </Select.Popover>
        </Select>
        {/* Legenda statis di baris yang sama dengan pemilih topik (bila topik punya lebih dari satu seri). Arahkan = sorot seri. */}
        {legend.length > 1 && hasData && !loading && (
          <ul aria-label={t('ov.series')} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted sm:ml-auto">
            {legend.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5" onMouseEnter={() => setHot(s.key)} onMouseLeave={() => setHot(null)}>
                <Swatch s={s} />{s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {loading ? (
        // Kerangka setinggi grafik agar konten di bawahnya tidak bergeser (CLS).
        <div aria-busy className="flex animate-pulse flex-col gap-4">
          <div className="h-60 rounded bg-default sm:h-[17rem] lg:h-[19rem]" />
        </div>
      ) : retry ? <Empty retry={retry} /> : !hasData ? <Empty /> : cur.id === 'wilayah' ? (
        <AreaBars data={data} keys={series.map((s) => s.key)} years={yearSeries} odd={odd[series[0]!.key]!} unitOf={unitOf} />
      ) : (
        <div className="flex flex-col gap-4">
          {flow && from && to ? (
            <div aria-live="polite"><KpiFigure value={total} format={(n) => unitOf(cur.unit, n)}
              sub={t('ov.totalSub', { seri: hot ? lead.label : cur.label, dari: from.tahun, sampai: to.tahun })} /></div>
          ) : diff !== null && (
            <div aria-live="polite"><KpiFigure value={diff} tone={lead.badUp ? 'bad' : undefined}
              format={(n) => `${n > 0 ? '+' : ''}${unitOf(cur.unit, n)}`}
              sub={t('ov.trendKpiSub', { seri: lead.label, dari: from!.tahun, sampai: to!.tahun, pct: fromV ? `${signed(Math.round((diff / fromV) * 100))}%` : '—' })} /></div>
          )}
          <div>
          {/* Satuan sumbu kiri; legenda seri ada di baris pemilih topik. */}
          <p className="mb-1 text-xs text-muted">{unitShort[cur.unit]}</p>
          <div className="h-56 lg:h-64">
            {/* Topik selalu punya minimal satu seri (kemiskinan selalu ada). */}
            <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} onMouseLeave={() => setHot(null)} barGap={2} barCategoryGap="20%">
                  <defs>
                    {series.map((s) => (
                      <linearGradient key={s.key} id={`fill-${s.key.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={0.12} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--separator)" />
                  <XAxis dataKey="tahun" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={24} padding={bars ? undefined : { left: 16, right: 16 }} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tick={tick} width={48} domain={[0, 'auto']} tickFormatter={(v: number) => fmtCompact(v)} />
                  <Tooltip offset={20} content={<TrendTip series={series} unitOf={unitOf} prevOf={prevOf} total={cur.chart === 'stack' ? t('ov.total') : undefined} />}
                    cursor={bars ? { fill: 'var(--default)', fillOpacity: 0.5 } : { stroke: 'var(--border)', strokeWidth: 1 }} />
                  {bars ? series.map((s, i) => (
                    // Batang: arus per tahun dan data sedikit tahun (kemiskinan 3 tahun); garis menyiratkan nilai antartahun yang tidak ada.
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} fillOpacity={fade(s.key)} maxBarSize={cur.chart === 'stack' ? 28 : 36}
                      stackId={cur.chart === 'stack' ? 'pju' : undefined} radius={cur.chart !== 'stack' || i === series.length - 1 ? [3, 3, 0, 0] : 0}
                      animationDuration={300} animationEasing="ease-out" onMouseEnter={() => setHot(s.key)}>
                      {data.map((p) => (odd[s.key]?.has(p.tahun)
                        ? <Cell key={p.tahun} fill="var(--surface)" stroke={s.color} strokeWidth={1.5} strokeDasharray="3 2" />
                        : <Cell key={p.tahun} />))}
                    </Bar>
                  )) : series.map((s) => (
                    <Area key={s.key} dataKey={s.key} name={s.label} type={cur.id === 'pjuTotal' ? 'stepAfter' : 'linear'} stroke={s.color} strokeWidth={hot === s.key ? 3 : 2.25}
                      strokeDasharray={s.dash} strokeOpacity={fade(s.key)} fill={`url(#fill-${s.key.replace(/\W/g, '')})`} fillOpacity={fade(s.key)}
                      connectNulls animationDuration={300} animationEasing="ease-out"
                      dot={(p: { cx?: number; cy?: number; index?: number; value?: unknown }) => <g key={`${s.key}-${p.index}`} opacity={fade(s.key)}>{p.value != null && p.cy != null && <Marker cx={p.cx} cy={p.cy} s={s} hollow={odd[s.key]!.has(data[p.index!]!.tahun)} />}</g>}
                      activeDot={(p: { cx?: number; cy?: number }) => <Marker cx={p.cx} cy={p.cy} s={s} r={5.5} />}
                      onMouseEnter={() => setHot(s.key)} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
          </div>
          </div>
          {oddYears.length > 0 && <p className="text-xs text-muted">{t('ov.incomparable', { tahun: oddYears.join(', ') })}</p>}
          {tanpaTahun > 0 && <p className="text-xs text-muted">{t('ov.pjuNoYear', { n: fmt(tanpaTahun) })}</p>}
        </div>
      )}
    </div>
  );
}

/** Kondisi jalan per ruas (CSV); `kelas` = nilai atribut `kondisi` layer Ruas Jalan Kabupaten, warna sama dengan layer itu. */
export const SEGMENT_PARTS = [
  { key: 'baik', kelas: 'Baik', color: '#16A34A' },
  { key: 'sedang', kelas: 'Sedang', color: '#F59E0B' },
  { key: 'rusakRingan', kelas: 'Rusak Ringan', color: '#F97316' },
  { key: 'rusakBerat', kelas: 'Rusak Berat', color: '#DC2626' },
] as const;
/** Ruas SK yang namanya tidak cocok dengan tabel survei (lihat syncKondisiRuas di API). */
const UNSURVEYED = { key: 'belum', kelas: 'Belum Disurvei', color: '#9CA3AF' } as const;
/** Kelas kartu Kondisi jalan: empat kelas survei lalu Belum Disurvei. */
export const ROAD_PARTS = [...SEGMENT_PARTS, UNSURVEYED] as const;

type Rank = { key: string; label: string; value: number; color: string };

/**
 * Daftar batang peringkat (HTML): label, batang relatif nilai terbesar, angka rata kanan. `highlight` = baris yang
 * disorot (teks tebal); dipakai kartu bencana, fasilitas umum, dan fungsi jalan agar ketiganya terbaca sama.
 */
export function RankBars({ items, format, highlight, detail, className, onSelect }: {
  items: Rank[]; format: (n: number) => string; highlight?: string;
  /** Rincian yang muncul saat baris diarahkan (mis. porsi dari total kalurahan). */
  detail?: (i: Rank) => string; className?: string;
  /** Baris bisa dipilih (klik baris / tombol label): mis. angka utama kartu bencana ikut jenis yang dipilih. */
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  // Kolom angka selebar angka terpanjang daftar: tiap baris grid sendiri, jadi tanpa ini batang berakhir tak sejajar.
  const numW = `${Math.max(...items.map((i) => format(i.value).length))}ch`;
  return (
    <ul className={cn(ROW_LIST, 'flex flex-col gap-1', className)}>
      {items.map((i) => (
        <li key={i.key} onClick={onSelect && (() => onSelect(i.key))}
          className={cn(ROW, '-mx-1.5 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 px-1.5 py-1 text-xs', onSelect && 'cursor-pointer', onSelect && i.key === highlight && 'bg-accent/5')}>
          {onSelect ? (
            // Tombol di label agar baris bisa dipilih dengan keyboard; klik di batang/angka ditangani `li`.
            <button type="button" aria-pressed={i.key === highlight} onClick={(e) => { e.stopPropagation(); onSelect(i.key); }}
              className={cn('rounded-sm text-left break-words', i.key === highlight ? 'font-medium text-heading' : 'text-muted')}>{i.label}</button>
          ) : <span className={cn('break-words', i.key === highlight ? 'font-medium text-heading' : 'text-muted')}>{i.label}</span>}
          <span className="h-2 overflow-hidden rounded-full bg-default">
            {/* scaleX (transform) alih-alih width: tidak memicu reflow tiap frame, animasi tetap mulus. */}
            <m.span className="block h-full w-full origin-left rounded-full" style={{ backgroundColor: i.color }}
              initial={{ scaleX: 0 }} animate={{ scaleX: max ? i.value / max : 0 }} transition={{ duration: 0.8, ease: EASE }} />
          </span>
          <span className="text-right font-medium text-heading tabular-nums" style={{ minWidth: numW }}>{format(i.value)}</span>
          {detail && <RowTip>{detail(i)}</RowTip>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Potensi bencana InaRISK: jumlah kalurahan berkelas bahaya Tinggi per jenis bahaya (multi-bahaya dikeluarkan karena
 * gabungan jenis lain). Angka utama = jenis dengan kalurahan bahaya tinggi terbanyak.
 */
export function HazardCard({ rows, totalHa, layer, loading, retry }: { rows: StatRow[]; totalHa: number; layer?: Layer; loading?: boolean; retry?: () => void }) {
  const { t } = usePrefs();
  // Zona InaRISK (raster -> poligon per kelas): ukuran yang jujur = LUAS zona kelas Tinggi, bukan jumlah kalurahan
  // (satu piksel tinggi saja sudah membuat kalurahan terhitung). Porsi dari luas wilayah (kabupaten / kecamatan terpilih).
  // Batang = merah peringatan (`--danger`); semua jenis (maks. 8) agar kartu setinggi kartu Kondisi Jalan di sebelahnya.
  // Nama jenis gabungan (multi-bahaya) dari pengaturan DB `keterpaparan.zona.gabungan`.
  const gabungan = useSettings().data?.keterpaparan.zona.gabungan;
  const items = rows.filter((r) => r.key && r.key !== gabungan && r.areaHa > 0).sort((a, b) => b.areaHa - a.areaHa).slice(0, 8)
    .map((r) => ({ key: r.key!, label: r.key!, value: Math.round(r.areaHa), color: 'var(--danger)' }));
  const top = items[0];
  // Angka utama = multi-bahaya InaRISK (gabungan semua jenis), bukan duplikat batang teratas. Klik satu jenis = angka
  // utama ikut jenis itu; klik lagi = kembali ke multi-bahaya.
  const multi = gabungan ? rows.find((r) => r.key === gabungan) : undefined;
  const [sel, setSel] = useState<string | null>(null);
  const cur = items.find((i) => i.key === sel) ?? (multi ? { key: '', label: t('ov.multiHazard'), value: Math.round(multi.areaHa) } : top);
  return (
    <Panel icon={TriangleExclamation} title={t('ov.hazard')} className="h-full"
      to={`/peta?layer=potensi-bencana${sel ? `&bahaya=${encodeURIComponent(sel)}` : ''}`}>
      {retry ? <Empty retry={retry} /> : loading ? <span aria-busy className="skeleton block h-40 rounded-xl" /> : !top || !cur ? <Empty /> : (
        <>
          <div aria-live="polite"><KpiFigure value={cur.value} format={haLabel} tone="bad"
            sub={t('ov.hazardKpiSub', { jenis: cur.label, pct: pctLabel(cur.value, totalHa) })} /></div>
          <div className={LEGEND_BOX}><RankBars items={items} format={haLabel} highlight={sel ?? undefined} className="gap-1" onSelect={(k) => setSel(sel === k ? null : k)}
            detail={(i) => t('ov.hazardShare', { pct: pctLabel(i.value, totalHa) })} /></div>
        </>
      )}
      {/* Catatan kaki (petunjuk klik + sumber) di dasar kartu, sama dengan kartu Kondisi jalan; header tanpa subjudul. */}
      {/* Angka dari zona hasil db:inarisk (salinan, bukan live): tanggal ambil ditampilkan agar umurnya jelas. */}
      {top && !retry && !loading && layer?.sumber && (
        <p className="mt-auto text-xs text-muted">
          {t('ov.hazardNote')} <span title={layer.sumber}>{t('map.source')} {layer.sumber}, {t('ov.takenOn', { date: fmtDate(layer.updatedAt) })}.</span>
        </p>
      )}
    </Panel>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Treemap squarified (Bruls dkk.): luas kotak sebanding nilai, rasio sisi sedekat mungkin 1. Satuan sama dengan `W`/`H`;
 * item harus urut menurun dan bernilai > 0.
 */
export function squarify<T extends { v: number }>(items: T[], W: number, H: number): (T & Box)[] {
  const scale = (W * H) / (items.reduce((s, i) => s + i.v, 0) || 1);
  let rest = items.map((i) => ({ i, a: i.v * scale }));
  let [x, y, w, h] = [0, 0, W, H];
  const out: (T & Box)[] = [];
  const worst = (row: typeof rest, len: number) => {
    const s = row.reduce((t, r) => t + r.a, 0);
    const as = row.map((r) => r.a);
    return Math.max((len * len * Math.max(...as)) / (s * s), (s * s) / (len * len * Math.min(...as)));
  };
  while (rest.length) {
    const len = Math.min(w, h);
    const row = [rest[0]!];
    let k = 1;
    while (k < rest.length && worst([...row, rest[k]!], len) <= worst(row, len)) row.push(rest[k++]!);
    rest = rest.slice(k);
    const s = row.reduce((t, r) => t + r.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) { out.push({ ...r.i, x, y: cy, w: cw, h: r.a / cw }); cy += r.a / cw; }
      x += cw; w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const r of row) { out.push({ ...r.i, x: cx, y, w: r.a / rh, h: rh }); cx += r.a / rh; }
      y += rh; h -= rh;
    }
  }
  return out;
}

/** Warna teks di atas kotak berwarna: gelap untuk latar terang, putih untuk latar gelap. */
const ink = (c: string) => {
  const n = /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null;
  if (!n) return 'var(--heading)';
  return (0.299 * n[0]! + 0.587 * n[1]! + 0.114 * n[2]!) / 255 > 0.6 ? '#1d2420' : '#ffffff';
};

/** `true` bila lebar layar < 640px (breakpoint `sm`); ikut berubah saat jendela diubah ukurannya. */
const NARROW = '(max-width: 639px)';
// ponytail: matchMedia selalu ada (prefs.tsx juga memakainya tanpa guard).
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const q = window.matchMedia(NARROW);
    const on = () => setNarrow(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** Kotak treemap dalam satuan 100 x TM_H; wadah memakai rasio yang sama, jadi posisi cukup dalam persen (tanpa ukur DOM). */
const TM_H = 30;

/**
 * Rencana pola ruang: luas tiap kelas pola ruang sebagai treemap (7 kelas terluas, sisanya "Lainnya"). Warna = legenda
 * layer Rencana Pola Ruang. Kotak kecil menyembunyikan teks secara visual (tetap terbaca pembaca layar; `title` = rincian).
 */
export function PolaRuang({ rows, layer, loading, retry }: { rows: StatRow[]; layer?: Layer; loading?: boolean; retry?: () => void }) {
  const { t } = usePrefs();
  const total = sum(rows, 'areaHa');
  const sorted = rows.filter((r) => r.key && r.areaHa > 0).sort((a, b) => b.areaHa - a.areaHa);
  // Layar sempit (< 640px): wadah hampir persegi dan cukup 5 kelas terluas, agar kotak cukup lebar untuk namanya.
  const narrow = useNarrow();
  const keep = narrow ? 5 : 7;
  const restHa = sum(sorted.slice(keep), 'areaHa');
  const items = [
    ...sorted.slice(0, keep).map((r) => ({ key: r.key!, label: r.key!, v: r.areaHa, color: colorOf(layer?.style ?? { color: '#9CA3AF' }, r.key) })),
    ...(restHa > 0 ? [{ key: '_lain', label: t('ov.other'), v: restHa, color: 'var(--surface-tertiary)' }] : []),
  ];
  const h = narrow ? 90 : TM_H;
  const tiles = squarify(items, 100, h);
  // Angka utama = total luas rencana; arahkan/fokus kotak = angka utama ikut kelas itu (luas + porsi).
  const [hot, setHot] = useState<string | null>(null);
  const cur = items.find((i) => i.key === hot);
  // Legenda selalu di dalam kotak warnanya (tidak ada daftar terpisah di luar treemap): nama dipotong bila sempit,
  // angka ha hanya bila kotak cukup lega; nama lengkap tetap di `title` dan terbaca pembaca layar.
  return (
    <Panel icon={LayoutCellsLarge} title={t('ov.pola')} className="h-full" to="/peta?layer=penggunaan-lahan">
      {retry ? <Empty retry={retry} /> : loading ? <span aria-busy className="skeleton block aspect-[100/30] rounded-xl" /> : !items.length ? <Empty /> : (
        <>
        <div aria-live="polite"><KpiFigure value={cur?.v ?? total} format={haLabel}
          sub={cur ? t('ov.polaKpiClass', { kelas: cur.label, pct: pct(cur.v, total) }) : t('ov.polaKpiSub', { kelas: items[0]!.label, pct: pct(items[0]!.v, total) })} /></div>
        <ul aria-label={t('ov.pola')} className="relative -m-[3px] [&:has(>li:hover)>li:not(:hover)]:opacity-60" style={{ aspectRatio: `100 / ${h}` }} onMouseLeave={() => setHot(null)}>
          {tiles.map((r, i) => {
            const share = pct(r.v, total);
            const figure = r.w > 14 && r.h > h * 0.4;
            return (
              <m.li key={r.key} className="absolute p-[3px] transition-opacity" title={`${r.label}: ${haLabel(r.v)} (${share}%)`}
                tabIndex={0} onMouseEnter={() => setHot(r.key)} onFocus={() => setHot(r.key)} onBlur={() => setHot(null)}
                style={{ left: `${r.x}%`, top: `${(r.y / h) * 100}%`, width: `${r.w}%`, height: `${(r.h / h) * 100}%` }}
                initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.05 }}>
                <div className="flex size-full min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-xl p-2 transition-[filter] hover:brightness-105"
                  style={{ backgroundColor: r.color, color: ink(r.color) }}>
                  <span className={cn('line-clamp-2 text-xs leading-tight font-medium break-words', (r.w < (narrow ? 20 : 10) || r.h < h * 0.3) && 'sr-only')}>{r.label}</span>
                  <span className="flex min-w-0 items-end justify-between gap-1.5">
                    <span className={cn('truncate text-base leading-none font-medium tracking-[-0.03em] tabular-nums', !figure && 'sr-only')}>{fmtCompact(r.v)} ha</span>
                    <span className="shrink-0 rounded-md bg-black/70 px-1.5 py-0.5 text-xs leading-none font-medium text-white tabular-nums">{share}%</span>
                  </span>
                </div>
              </m.li>
            );
          })}
        </ul>
        </>
      )}
    </Panel>
  );
}

/** Rincian kartu KPI Kondisi jalan: komposisi ruas SK per kelas + filter peta mini (klik kelas). */
export function RoadOverview({ network = [], layer, unmatched = 0, hiddenKelas = [], onHiddenKelas }: {
  network?: StatRow[];
  /** Layer Ruas Jalan Kabupaten: warna kelas diambil dari style-nya agar kartu, legenda, dan peta sama. */
  layer?: Layer;
  /** Jumlah baris survei yang namanya tidak cocok dengan ruas SK (tidak tergambar di peta). */
  unmatched?: number;
  /** Kelas (`kondisi`) yang dimatikan; state dipegang halaman agar peta mini ikut tersaring. */
  hiddenKelas?: string[]; onHiddenKelas?: (kelas: string[]) => void;
}) {
  const { t } = usePrefs();
  const hidden = new Set(hiddenKelas);
  const toggle = (kelas: string) => onHiddenKelas?.([...toggleIn(hidden, kelas)]);
  const [hover, setHover] = useState<string | null>(null);
  const colorFor = (kelas: string, fallback: string) => (layer ? colorOf(layer.style, kelas) : fallback);
  // Urutan skala Baik → Rusak Berat (sama dengan legenda Peta), lalu Belum Disurvei. Porsi = dari seluruh ruas SK,
  // jadi lima baris berjumlah 100% dan ruas yang belum disurvei ikut terlihat porsinya.
  const classes = ROAD_PARTS.map((p) => ({
    key: p.key as string, kelas: p.kelas as string, label: t(`road.${p.key}`), color: colorFor(p.kelas, p.color), n: sum(network, 'count', p.kelas),
  }));
  const netN = sum(network, 'count');
  const shownN = classes.filter((c) => !hidden.has(c.kelas)).reduce((s, c) => s + c.n, 0);
  const fade = (k: string) => (hover && hover !== k ? 0.3 : 1);
  return (
    <div className={LEGEND_BOX}>
      {/* Satu batang utuh; lebar segmen = porsi jumlah ruas. */}
      <div className="flex h-3 gap-1" role="img" aria-label={t('ov.roadComposition')}>
        {classes.map((c) => (
          <m.div key={c.key} data-testid={`seg-${c.key}`} onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
            className="h-full rounded-full transition-opacity" style={{ backgroundColor: c.color, opacity: fade(c.key) }}
            initial={{ width: 0 }} animate={{ width: `${hidden.has(c.kelas) ? 0 : pct(c.n, shownN)}%` }} transition={{ duration: 0.8, ease: EASE }} />
        ))}
      </div>
      <ul className="-mx-1.5 flex flex-col gap-0.5">
        {classes.map((c) => (
          <li key={c.key}>
            <button type="button" aria-pressed={!hidden.has(c.kelas)} onClick={() => toggle(c.kelas)}
              onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(c.key)} onBlur={() => setHover(null)}
              className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition hover:bg-row-hover', hidden.has(c.kelas) ? 'opacity-40' : fade(c.key) < 1 && 'opacity-50')}>
              <span aria-hidden className={DOT} style={{ backgroundColor: c.color }} />
              <span className={cn('min-w-0 flex-1 break-words', c.key === 'rusakBerat' ? 'font-medium text-heading' : 'text-muted', hidden.has(c.kelas) && 'line-through')}>{c.label}</span>
              <span className="font-medium text-heading tabular-nums">{fmt(c.n)}</span>
              <span className={PCT}>{pctLabel(c.n, netN)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {t('ov.roadClassNote')}{unmatched > 0 && <> {t('ov.roadUnmatched', { n: fmt(unmatched) })}</>}
      </p>
    </div>
  );
}

/** Peta kecil: layer bawaan (visibleDefault) saja; pemilihan layer lengkap ada di halaman Peta. */
const NO_HIDDEN: Record<string, string[]> = {};

/** `hidden`: kelas yang dimatikan per slug layer (mis. kelas kondisi ruas dari kartu Kondisi Jalan). */
export function MiniMap({ layers, kecamatan, gaps = [], tahun, hidden = NO_HIDDEN }: { layers: Layer[]; kecamatan?: string; gaps?: YearGap[]; tahun?: number; hidden?: Record<string, string[]> }) {
  const { t } = usePrefs();
  const visible = useMemo(() => layers.filter((l) => l.visibleDefault && l.featureCount > 0).map((l) => ({ ...l, opacity: 1, hidden: hidden[l.slug] })), [layers, hidden]);
  const [hover, setHover] = useState<Hover | null>(null);
  const navigate = useNavigate();
  // Klik fitur di peta mini → buka di halaman Peta dengan popup fitur tersebut.
  const open = useCallback((f: MapGeoJSONFeature, l: Layer, p: { lng: number; lat: number }) => {
    if (f.id !== undefined) navigate(`/peta?f=${f.id}&layer=${l.slug}&lng=${p.lng}&lat=${p.lat}`);
  }, [navigate]);
  return (
    <Card className="relative h-full min-h-[360px] overflow-hidden p-0">
      <Map center={KULON_PROGO_CENTER} zoom={9.6} attributionControl={{ compact: true }} cooperativeGestures>
        <MapControls position="bottom-right" showZoom />
        <VectorLayers layers={visible} kecamatan={kecamatan} tahun={tahun} onFeatureClick={open} />
        <MapHover onHover={setHover} />
      </Map>
      {/* Konteks peta: judul, kecamatan terfilter, layer yang tampil (maks 3 + sisa). Tahun sudah ada di header. */}
      <div className="pointer-events-none absolute top-5 left-5 flex max-w-[calc(100%-2.5rem)] flex-col items-start gap-2 sm:top-6 sm:left-6 sm:max-w-[calc(100%-3rem)]">
        <div className="pointer-events-auto rounded-2xl bg-surface/90 px-4 py-2.5 shadow-card backdrop-blur">
          <h2 className="card__title">
            <Link to="/peta" className="group/title inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-accent-text">
              {t('ov.mapTitle')}{kecamatan ? `, ${kecamatan}` : ''}
              <ArrowUpRight aria-hidden className="size-4 shrink-0 text-accent opacity-40 transition group-hover/title:translate-x-0.5 group-hover/title:-translate-y-0.5 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
            </Link>
          </h2>
          {/* Seri layer bertahun yang kosong / memakai versi lama di tahun terpilih. */}
          {tahun !== undefined && gaps.map((g) => <YearNote key={g.name} tahun={tahun} year={g.year} name={g.name} className="mt-1 max-w-72" />)}
        </div>
        {visible.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {visible.slice(0, 3).map((l) => <li key={l.id} className="rounded-full bg-surface/90 px-2.5 py-1 text-xs text-heading shadow-card backdrop-blur">{l.name}</li>)}
            {visible.length > 3 && <li className="rounded-full bg-surface/90 px-2.5 py-1 text-xs text-muted shadow-card backdrop-blur">+{visible.length - 3}</li>}
          </ul>
        )}
      </div>
      {hover && <HoverTip hover={hover} layers={layers} />}
    </Card>
  );
}

