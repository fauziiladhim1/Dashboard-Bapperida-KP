import { TriangleExclamation } from '@gravity-ui/icons';
import { useT } from '@/lib/prefs';
import type { Urgency } from '@/lib/urgency';
import { cn } from '@/lib/utils';

// Tanpa latar: tingkat urgensi dibaca dari warna teks + ikon, agar tidak bersaing dengan chip keputusan di sebelahnya.
const TONE: Record<Urgency, string> = {
  tinggi: 'text-danger',
  sedang: 'text-warning',
  rendah: 'text-muted',
};

/** Badge urgensi penanganan (fitur atau foto dokumentasi). `short` = hanya tingkatnya, bila label "Urgensi" sudah ada di dekatnya. */
export function UrgencyBadge({ value, className, short }: { value: Urgency; className?: string; short?: boolean }) {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', TONE[value], className)}>
      {value !== 'rendah' && <TriangleExclamation aria-hidden className="size-3" />}
      {short ? t(`urg.${value}`) : t('urg.badge', { level: t(`urg.${value}`) })}
    </span>
  );
}
