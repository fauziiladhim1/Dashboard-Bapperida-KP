import { Skeleton } from '@heroui/react';
import { useT } from '@/lib/prefs';

const BLOCKS = ['lg:col-span-8 h-56', 'lg:col-span-4 h-56', 'lg:col-span-4 h-32', 'lg:col-span-4 h-32', 'lg:col-span-4 h-32'];

/** Kerangka kartu berkilau selama halaman/data dimuat; teks tetap dibacakan pembaca layar. */
export function Loading() {
  const t = useT();
  return (
    <div role="status" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <span className="sr-only">{t('common.loading')}</span>
      {BLOCKS.map((c, i) => <Skeleton key={i} aria-hidden className={`rounded ${c}`} />)}
    </div>
  );
}
