import { Shield } from '@gravity-ui/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AnimatedNumber } from '@/components/common/motion';
import { Panel } from '@/components/common/Panel';
import { endpoints } from '@/lib/api';
import { fmt } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';
import { retryOf } from './use-stats';
import { Empty } from './widgets';

/**
 * Kartu analisis untuk keputusan pengembangan wilayah (Ringkasan): keterpaparan bahaya. Pola Panel + Empty sama
 * dengan kartu lain.
 */

const TH = 'pb-2 text-xs font-normal text-subtle';
type Row = Awaited<ReturnType<typeof endpoints.exposure>>[number];
/** `u` = satuan: di ringkasan menempel pada angka, di tabel/daftar pindah ke judul kolom agar sel hanya angka. */
type Col = { k: 'ins.schools' | 'ins.health' | 'ins.tourism' | 'ins.roads' | 'ins.settlement'; v: (r: Row) => number; u?: string };
/** Lima ukuran keterpaparan, urutan sama di ringkasan, tabel, dan daftar seluler. */
const COLS: Col[] = [
  { k: 'ins.schools', v: (r) => r.sekolah }, { k: 'ins.health', v: (r) => r.faskes },
  { k: 'ins.tourism', v: (r) => r.wisata }, { k: 'ins.roads', v: (r) => Math.round(r.jalanKm), u: 'km' },
  { k: 'ins.settlement', v: (r) => Math.round(r.permukimanHa), u: 'ha' },
];

/**
 * Sel angka tanpa latar: angka polos + garis tipis di bawahnya, panjangnya sebanding nilai terhadap maksimum kolom
 * (perbandingan antarjenis sekali lihat). Nilai 0 diredupkan tanpa garis. `end` = rata kanan (tabel).
 */
function Heat({ v, max, end }: { v: number; max: number; end?: boolean }) {
  return (
    <span className={cn('inline-flex w-16 flex-col gap-1', end ? 'items-end' : 'items-start')}>
      <span className={cn('tabular-nums', v ? 'text-heading' : 'text-subtle')}>{fmt(v)}</span>
      {/* Lintasan tipis (skala 0-maks kolom) + isian merah. */}
      <span aria-hidden className={cn('flex h-[3px] w-full overflow-hidden rounded-full bg-separator/70', end && 'justify-end')}>
        <span className="rounded-full bg-danger/75" style={{ width: v ? `${Math.max(6, (v / max) * 100)}%` : 0 }} />
      </span>
    </span>
  );
}

const hazardLink = (jenis: string) => `/peta?layer=potensi-bencana&bahaya=${encodeURIComponent(jenis)}`;

/**
 * Keterpaparan zona bahaya kelas Tinggi: sekolah, fasilitas kesehatan, destinasi wisata, ruas jalan (km) dan permukiman
 * (ha) di dalam zona, per jenis bahaya. Multi-bahaya = gabungan, jadi tampil terpisah di atas, bukan dijumlah.
 * Kartu sempit (< 36rem, container query): tabel diganti daftar bertumpuk agar tidak menggulir ke samping.
 */
export function HazardExposure({ kecamatan }: { kecamatan?: string }) {
  const { t } = usePrefs();
  const q = useQuery({ queryKey: ['exposure', kecamatan], queryFn: () => endpoints.exposure(kecamatan), placeholderData: keepPreviousData, staleTime: 5 * 60_000 });
  const rows = (q.data ?? []).filter((r) => r.sekolah + r.faskes + r.wisata + r.jalanKm + r.permukimanHa > 0);
  const gabungan = useSettings().data?.keterpaparan.zona.gabungan;
  const multi = gabungan ? rows.find((r) => r.jenis === gabungan) : undefined;
  const others = rows.filter((r) => r !== multi);
  const max = COLS.map((c) => Math.max(1, ...others.map(c.v)));
  // Urut dari jenis paling terpapar: jumlah porsi tiap kolom terhadap maksimumnya (kelima ukuran berbobot sama).
  const score = (r: Row) => COLS.reduce((s, c, i) => s + c.v(r) / max[i]!, 0);
  const each = [...others].sort((a, b) => score(b) - score(a));
  return (
    <Panel icon={Shield} title={t('ins.exposure')} className="@container h-full">
      {retryOf(q) ? <Empty retry={retryOf(q)} /> : q.isPending ? <span aria-busy className="skeleton block h-56 rounded-xl" /> : !rows.length ? <Empty /> : (
        <>
          {multi && (
            // Ringkasan multi-bahaya: kelima angka disorot merah dengan gaya angka utama KPI lain (font-heading, text-danger,
            // menghitung naik), satuan kecil lebih redup, label di bawah. Kolom sama lebar, rata tengah, tanpa bingkai/garis.
            // Sempit: 3 + 2 (grid 6; tiga pertama span 2, dua terakhir span 3) agar baris kedua tetap simetris di tengah.
            <section aria-label={t('ins.sumLabel')} className="flex flex-col items-center pb-2">
              <dl className="grid w-full max-w-4xl grid-cols-6 gap-x-4 gap-y-6 @3xl:grid-cols-5">
                {COLS.map((c, i) => (
                  <div key={c.k} className={cn('flex min-w-0 flex-col items-center text-center @3xl:col-span-1', i < 3 ? 'col-span-2' : 'col-span-3')}>
                    {/* dt sebelum dd (urutan sah HTML); tampilannya dibalik: angka di atas, label di bawah. */}
                    <dt className="order-2 mt-2 text-xs text-muted">{t(c.k)}</dt>
                    <dd className="order-1 flex items-baseline gap-1 text-danger">
                      <AnimatedNumber value={c.v(multi)} format={fmt}
                        className="font-heading text-[28px] leading-none font-medium tracking-[-0.03em] text-danger @3xl:text-[34px]" />
                      {/* Satuan redup lewat warna teks (bukan opacity merah: kontras 3,9:1 < 4,5:1). */}
                      {c.u && <span className="text-sm font-medium text-muted">{c.u}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {/* Judul bagian rincian: memisahkan ringkasan gabungan dari baris per jenis. */}
          <h3 className="-mb-1 text-sm font-medium text-heading">{t('ins.byHazard')}</h3>
          {/* Lebar: tabel peta-panas. */}
          <table className="hidden w-full border-collapse text-xs @xl:table">
            <thead>
              <tr className="text-left">
                <th scope="col" className={TH}>{t('ins.hazardType')}</th>
                {COLS.map((c) => <th key={c.k} scope="col" className={cn(TH, 'text-right')}>{t(c.k)}{/* Satuan ikut warna judul kolom (text-subtle/70 di tema gelap hanya 3,35:1). */}{c.u && <span className="font-normal"> ({c.u})</span>}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-separator border-t border-separator">
              {each.map((r) => (
                <tr key={r.jenis} className="transition-colors hover:bg-accent/5">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-heading">
                    {/* Klik jenis = peta dengan raster jenis bahaya itu menyala. */}
                    <Link to={hazardLink(r.jenis)} className="rounded-sm transition-colors hover:text-accent-text">{r.jenis}</Link>
                  </th>
                  {COLS.map((c, i) => <td key={c.k} className="py-2 text-right"><Heat v={c.v(r)} max={max[i]!} end /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {/* Sempit: label kolom sekali di atas, tiap jenis = nama + 5 angka sejajar kolom (tanpa gulir ke samping). */}
          <div className="@xl:hidden">
            <div aria-hidden className="grid grid-cols-5 gap-1 pb-2 text-[11px] leading-tight text-subtle">
              {COLS.map((c) => <span key={c.k} className="min-w-0">{t(c.k)}{c.u && <span className="block">({c.u})</span>}</span>)}
            </div>
            <ul className="divide-y divide-separator border-t border-separator">
              {each.map((r) => (
                <li key={r.jenis} className="py-2.5">
                  <Link to={hazardLink(r.jenis)} className="text-sm font-medium text-heading transition-colors hover:text-accent-text">{r.jenis}</Link>
                  <dl className="mt-1.5 grid grid-cols-5 gap-1 text-xs">
                    {COLS.map((c, i) => (
                      <div key={c.k} className="min-w-0">
                        <dt className="sr-only">{t(c.k)}</dt>
                        <dd><Heat v={c.v(r)} max={max[i]!} /></dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-auto text-xs text-muted">{t('ins.exposureNote')}</p>
        </>
      )}
    </Panel>
  );
}
