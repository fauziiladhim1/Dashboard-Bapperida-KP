import { TriangleExclamation } from '@gravity-ui/icons';
import { useT } from '@/lib/prefs';
import type { Urgency } from '@/lib/urgency';
import { cn } from '@/lib/utils';

const TONE: Record<Urgency, string> = {
  tinggi: 'bg-danger/10 text-danger',
  sedang: 'bg-warning/10 text-warning',
  rendah: 'bg-default text-muted',
};

/** Badge urgensi penanganan (fitur atau foto dokumentasi). `short` = hanya tingkatnya, bila label "Urgensi" sudah ada di dekatnya. */
export function UrgencyBadge({ value, className, short }: { value: Urgency; className?: string; short?: boolean }) {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[value], className)}>
      {value !== 'rendah' && <TriangleExclamation aria-hidden className="size-3" />}
      {short ? t(`urg.${value}`) : t('urg.badge', { level: t(`urg.${value}`) })}
    </span>
  );
}
