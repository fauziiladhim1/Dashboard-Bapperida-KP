import { ArrowUpRight } from '@gravity-ui/icons';
import { Card } from '@heroui/react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Link } from 'react-router';

type PanelProps = {
  title: string; subtitle?: ReactNode; action?: ReactNode; className?: string; children: ReactNode; icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Judul jadi tautan (rincian di halaman lain), pengganti tombol aksi di dalam kartu. */
  to?: string;
};

/** Kartu dasbor: chip ikon opsional + judul 18px di kiri, aksi opsional di kanan. Semua kartu Ringkasan memakai header ini. */
export function Panel({ title, subtitle, action, className = '', children, icon: Icon, to }: PanelProps) {
  return (
    <Card className={`card-pad gap-4 ${className}`}>
      {/* Desktop: aksi tetap di kanan judul walau subtitle panjang; layar sempit: aksi turun ke baris berikut. */}
      {/* Baris 1: ikon + judul sejajar tengah, aksi di kanan; baris 2: subjudul. */}
      <Card.Header className="flex-col items-stretch gap-1 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 md:flex-nowrap">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
                <Icon className="size-4" />
              </span>
            )}
            {/* h2: judul kartu berada langsung di bawah h1 halaman (urutan heading). */}
            <h2 className="card__title min-w-0">
              {to ? (
                <Link to={to} className="group/title inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-accent-text">
                  {title}
                  <ArrowUpRight aria-hidden className="size-4 shrink-0 text-accent opacity-40 transition group-hover/title:translate-x-0.5 group-hover/title:-translate-y-0.5 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
                </Link>
              ) : title}
            </h2>
          </div>
          {action && <div className="shrink-0 max-md:w-full">{action}</div>}
        </div>
        {/* Subjudul = ukuran teks keterangan kartu KPI bento (text-xs, muted). Kartu Ringkasan (berikon) tanpa subjudul. */}
        {subtitle && <Card.Description className="text-xs text-muted">{subtitle}</Card.Description>}
      </Card.Header>
      {children}
    </Card>
  );
}
