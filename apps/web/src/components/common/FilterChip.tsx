import { Xmark } from '@gravity-ui/icons';
import { useT } from '@/lib/prefs';

/** Filter aktif yang bisa dilepas (mis. kelas jalan yang disembunyikan di kartu, ikut menyaring peta mini). */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-control bg-accent/10 pr-1 pl-3 text-xs text-accent-text">
      {label}
      <button type="button" onClick={onRemove} aria-label={t('common.removeFilter', { name: label })}
        className="grid size-6 place-items-center rounded-md hover:bg-accent/15">
        <Xmark className="size-3" aria-hidden />
      </button>
    </span>
  );
}
