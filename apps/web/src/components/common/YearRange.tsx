import { ArrowRotateLeft, Calendar, TriangleExclamation } from '@gravity-ui/icons';
import { buttonVariants, ListBox, Select } from '@heroui/react';
import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';

type Item = { id: string; name: string; disabled?: boolean };

/** Dropdown tahun bergaya sama dengan KecamatanSelect; `label` tampil di depan nilai agar maknanya jelas. */
function YearDropdown({ label, aria = label, years, value, onChange, disabled, className }: {
  label: string; aria?: string; years: number[]; value?: number; onChange: (y: number) => void; disabled?: (y: number) => boolean; className?: string;
}) {
  // Terbaru di atas: tahun yang biasa dipilih ada tepat di bawah trigger, bukan di dasar daftar 2000–sekarang.
  const items: Item[] = [...years].sort((a, b) => b - a).map((y) => ({ id: String(y), name: String(y), disabled: disabled?.(y) }));
  return (
    <Select aria-label={aria} className={className} selectedKey={value === undefined ? null : String(value)}
      disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)} onSelectionChange={(k) => k !== null && onChange(Number(k))}>
      <Select.Trigger className="min-h-10 gap-2 bg-surface text-sm text-heading">
        <Calendar className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="shrink-0 text-muted">{label}</span>
        <Select.Value className="whitespace-nowrap font-medium tabular-nums" />
        <Select.Indicator />
      </Select.Trigger>
      {/* Rapat ke trigger; tinggi maksimum & gulir sama dengan semua dropdown (aturan .select__popover di index.css). */}
      <Select.Popover offset={4}>
        <ListBox items={items}>
          {(it: Item) => (
            <ListBox.Item id={it.id} textValue={it.name}>
              <span className="tabular-nums">{it.name}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Pemilih satu tahun global: mengatur peta, legenda, dan statistik (bukan grafik tren). */
export function YearSelect({ years, value, onChange, className }: { years: number[]; value?: number; onChange: (y: number) => void; className?: string }) {
  const t = useT();
  return <YearDropdown label={t('year.single')} years={years} value={value} onChange={onChange} className={cn('w-full sm:w-40', className)} />;
}

/** Rentang tahun lokal grafik tren: dropdown awal & akhir; opsi yang membuat rentang terbalik dinonaktifkan. */
export function YearRange({ years, dari, sampai, onChange, onReset, isFull, className }: {
  years: number[]; dari?: number; sampai?: number; onChange: (r: { dari: number; sampai: number }) => void;
  onReset?: () => void; isFull?: boolean; className?: string;
}) {
  const t = useT();
  if (dari === undefined || sampai === undefined) return null;
  return (
    <div role="group" aria-label={t('year.range')} className={cn('flex flex-wrap items-center gap-2', className)}>
      <YearDropdown label={t('year.fromShort')} aria={t('year.from')} years={years} value={dari} onChange={(y) => onChange({ dari: y, sampai })} disabled={(y) => y > sampai} className="min-w-fit flex-1 sm:w-40 sm:flex-none" />
      <YearDropdown label={t('year.toShort')} aria={t('year.to')} years={years} value={sampai} onChange={(y) => onChange({ dari, sampai: y })} disabled={(y) => y < dari} className="min-w-fit flex-1 sm:w-40 sm:flex-none" />
      {onReset && (
        <button type="button" onClick={onReset} disabled={isFull} aria-label={t('year.resetLabel')} title={t('year.resetLabel')}
          className={cn(buttonVariants({ variant: 'outline', isIconOnly: true }), 'shrink-0')}>
          <ArrowRotateLeft className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * Info tahun tanpa data, sebaris di dalam kartu pemilik datanya (bukan kartu terpisah):
 * `year` = versi lama yang ditampilkan; tanpa `year` = belum ada data sampai `tahun`. `name` opsional untuk daftar seri.
 */
export function YearNote({ tahun, year, name, className }: { tahun: number; year?: number; name?: string; className?: string }) {
  const t = useT();
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-warning', className)}>
      <TriangleExclamation aria-hidden className="mt-0.5 size-3 shrink-0" />
      <span>{name && <b className="font-medium">{name}: </b>}{year ? t('year.fallback', { tahun, year }) : t('year.missing', { tahun })}</span>
    </p>
  );
}
