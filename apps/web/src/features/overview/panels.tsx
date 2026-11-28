import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { squarify } from './widgets';

/** Satu kategori rincian KPI: kunci, label tampil, nilai, warna. */
type Part = { key: string; label: string; value: number; color: string };
const share = (v: number, total: number) => (total ? Math.round((100 * v) / total) : 0);

/** Batang vertikal (kolom): kategori berurutan kiri ke kanan, tinggi relatif nilai terbesar. */
export function ColumnBars({ items, format }: { items: Part[]; format: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex h-36 items-end gap-2" aria-label={items.map((i) => `${i.label}: ${format(i.value)}`).join(', ')}>
      {items.map((i) => (
        <li key={i.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${i.label}: ${format(i.value)}`}>
          <span className="text-[11px] text-heading tabular-nums">{format(i.value)}</span>
          <span className="w-full max-w-10 rounded-t-md" style={{ height: `${Math.max(2, (100 * i.value) / max)}%`, backgroundColor: i.color }} />
          <span className="w-full truncate text-center text-[11px] text-muted">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Treemap: luas kotak sebanding porsi (pakai `squarify` yang sama dengan kartu Pola Ruang). */
export function TreemapPanel({ items, total, format }: { items: Part[]; total: number; format: (n: number) => string }) {
  const boxes = squarify(items.map((i) => ({ ...i, v: i.value })), 100, 100);
  return (
    <ul className="relative h-40 overflow-hidden rounded-lg">
      {boxes.map((b) => (
        <li key={b.key} className="absolute p-[2px]" title={`${b.label}: ${format(b.value)} (${share(b.value, total)}%)`}
          style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}>
          <span className="flex size-full flex-col justify-between overflow-hidden rounded-md p-1.5 text-white" style={{ backgroundColor: b.color }}>
            <span className={cn('truncate text-[11px] font-medium', (b.w < 15 || b.h < 25) && 'sr-only')}>{b.label}</span>
            <span className={cn('text-[11px] tabular-nums', (b.w < 15 || b.h < 25) && 'sr-only')}>{share(b.value, total)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tabel rincian (gaya sama dengan tabel Tutupan Lahan): kategori, nilai, porsi dari total. `additive` (jumlah/panjang/luas):
 * kategori di luar N teratas digabung jadi baris "Lainnya" dan ada baris Total 100%, jadi porsi selalu genap.
 * Rata-rata/min/maks bukan porsi dari total: tanpa Lainnya & Total.
 */
export function TablePanel({ items, total, format, by, additive = true }: {
  items: Part[]; total: number; format: (n: number) => string; by: string; additive?: boolean;
}) {
  const t = useT();
  const rest = additive ? total - items.reduce((n, i) => n + i.value, 0) : 0;
  // ponytail: sisa < 0,05% dari total = pembulatan, bukan kategori tersembunyi.
  const rows = rest > total * 0.0005 ? [...items, { key: '__rest', label: t('ov.other'), value: rest, color: '#A9AFA9' }] : items;
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th scope="col" className="pb-2 font-medium">{by}</th>
          <th scope="col" className="w-28 pb-2 text-right font-medium">{t('kpi.value')}</th>
          {additive && <th scope="col" className="w-14 pb-2 text-right font-medium">{t('ov.lcShare')}</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-separator border-t border-separator">
        {rows.map((i) => (
          <tr key={i.key}>
            <th scope="row" className="py-2 pr-2 text-left font-normal">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: i.color }} />
                <span className="truncate text-heading" title={i.label}>{i.label}</span>
              </span>
            </th>
            <td className="py-2 text-right text-heading tabular-nums">{format(i.value)}</td>
            {additive && <td className="py-2 text-right text-muted tabular-nums">{share(i.value, total) || '<1'}%</td>}
          </tr>
        ))}
      </tbody>
      {additive && (
        <tfoot className="border-t border-separator">
          <tr>
            <th scope="row" className="pt-2 pr-2 text-left font-medium text-heading">{t('ov.lcTotal')}</th>
            <td className="pt-2 text-right font-medium text-heading tabular-nums">{format(total)}</td>
            <td className="pt-2 text-right text-muted tabular-nums">100%</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
