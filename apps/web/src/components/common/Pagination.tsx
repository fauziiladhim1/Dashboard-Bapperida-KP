import { Pagination as HeroPagination, ListBox, Select } from '@heroui/react';
import { useState } from 'react';
import { useT } from '@/lib/prefs';

/** Nomor halaman yang ditampilkan: halaman pertama, terakhir, dan satu di kiri-kanan halaman aktif; celah jadi '…'. */
export function pageList(page: number, pages: number): (number | '…')[] {
  const out: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p);
    else if (out.at(-1) !== '…') out.push('…');
  }
  return out;
}

const field = 'h-9 rounded-xl border border-field-border bg-surface px-3 text-sm text-heading tabular-nums';

/** Kolom "ke halaman": Enter/keluar fokus melompat; nilai di luar rentang dijepit ke 1..pages. */
function PageJump({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  const t = useT();
  const [v, setV] = useState('');
  const go = () => {
    const n = Math.min(pages, Math.max(1, Math.round(Number(v))));
    if (v && n !== page) onChange(n);
    setV('');
  };
  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
      {t('common.goTo')}
      <input type="number" inputMode="numeric" min={1} max={pages} value={v} placeholder={String(page)} aria-label={t('common.goToPage', { pages })}
        onChange={(e) => setV(e.target.value)} onBlur={go} onKeyDown={(e) => e.key === 'Enter' && go()} className={`${field} w-16`} />
      <span>/ {pages}</span>
    </label>
  );
}

/**
 * Navigasi halaman + kolom lompat halaman (bila > 1 halaman). `size`/`onSize`: pilihan jumlah baris per halaman.
 */
export function Pagination({ page, pages, onChange, className, size, onSize }: {
  page: number; pages: number; onChange: (p: number) => void; className?: string; size?: number; onSize?: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap ${className ?? ''}`}>
      {onSize && (
        // Gaya sama dengan dropdown kecamatan/tahun (Select HeroUI), label di depan nilai.
        <Select aria-label={t('common.perPage')} selectedKey={String(size)} onSelectionChange={(k) => k !== null && onSize(Number(k))} className="w-36 shrink-0">
          <Select.Trigger className="min-h-9 gap-2 bg-surface text-sm text-heading">
            <span className="shrink-0 text-muted">{t('common.perPage')}</span>
            <Select.Value className="font-medium tabular-nums" />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {[10, 20, 50].map((n) => <ListBox.Item key={n} id={String(n)} textValue={String(n)}><span className="tabular-nums">{n}</span><ListBox.ItemIndicator /></ListBox.Item>)}
            </ListBox>
          </Select.Popover>
        </Select>
      )}
    <HeroPagination aria-label={t('common.pagination')} className="w-auto shrink-0">
      <HeroPagination.Content>
        <HeroPagination.Item>
          <HeroPagination.Previous isDisabled={page <= 1} onPress={() => onChange(page - 1)} aria-label={t('common.prev')}>
            <HeroPagination.PreviousIcon />
          </HeroPagination.Previous>
        </HeroPagination.Item>
        {pageList(page, pages).map((p, i) => (
          <HeroPagination.Item key={p === '…' ? `gap-${i}` : p}>
            {p === '…' ? <HeroPagination.Ellipsis /> : (
              <HeroPagination.Link isActive={p === page} onPress={() => onChange(p)} aria-label={t('common.page', { n: p })} aria-current={p === page ? 'page' : undefined}>
                {p}
              </HeroPagination.Link>
            )}
          </HeroPagination.Item>
        ))}
        <HeroPagination.Item>
          <HeroPagination.Next isDisabled={page >= pages} onPress={() => onChange(page + 1)} aria-label={t('common.next')}>
            <HeroPagination.NextIcon />
          </HeroPagination.Next>
        </HeroPagination.Item>
      </HeroPagination.Content>
    </HeroPagination>
      {pages > 1 && <PageJump page={page} pages={pages} onChange={onChange} />}
    </div>
  );
}
