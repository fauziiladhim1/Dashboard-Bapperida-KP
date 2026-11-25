import { Breadcrumbs } from '@heroui/react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/prefs';

/** Judul halaman FreeDash (.page-title + .page-breadcrumb): judul 500 gelap, breadcrumb 14px di bawahnya, aksi di kanan. */
/** `subtitle` menggantikan breadcrumb (mis. beranda yang tidak punya jalur). */
export function PageHeader({ title, crumb, subtitle, action }: { title: ReactNode; crumb?: string; subtitle?: ReactNode; action?: ReactNode }) {
  const t = useT();
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      {/* Judul tidak menyusut di bawah 16rem: aksi yang turun ke baris baru, bukan teks yang terpotong/bertumpuk. */}
      <div className="max-w-full min-w-[min(16rem,100%)]">
        <h1 className="mb-1 text-2xl font-medium text-balance break-words">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : (
          <Breadcrumbs className="text-sm text-muted">
            <Breadcrumbs.Item href="/">{t('app.name')}</Breadcrumbs.Item>
            {crumb && <Breadcrumbs.Item>{crumb}</Breadcrumbs.Item>}
          </Breadcrumbs>
        )}
      </div>
      {action}
    </div>
  );
}
