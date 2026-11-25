import { useQuery } from '@tanstack/react-query';
import { Bell } from '@gravity-ui/icons';
import { Button, Dropdown, Label } from '@heroui/react';
import { m } from 'motion/react';
import { useNavigate } from 'react-router';
import { UrgencyBadge } from '@/components/common/UrgencyBadge';
import { canEdit, useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { Tip } from '@/components/common/Tip';
import { useT } from '@/lib/prefs';
import { URGENCIES, type Urgency } from '@/lib/urgency';

/**
 * Lonceng peringatan di header: jumlah fitur yang perlu tindak lanjut (urgensi tinggi, atau keputusan/notulensi yang
 * belum diproses). Bukan status baca: angka turun hanya bila fitur diputuskan "Diproses".
 * Pilih item = buka notulensi & keputusan fitur itu di menu Data (viewer: detail fitur, hanya baca).
 */
export function AlertBell() {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  // ponytail: polling 60 dtk; ganti ke SSE/websocket bila peringatan harus muncul seketika.
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: endpoints.alerts, refetchInterval: 60_000 });
  const count = data?.count ?? 0;
  const items = data?.items ?? [];
  const label = t('alert.open', { n: count });
  const open = (key: string) => {
    // Kunci selalu dari item menu yang sedang tampil.
    const a = items.find((i) => i.id === key)!;
    navigate(`/data/${a.slug}?${canEdit(me) ? 'keputusan' : 'edit'}=${a.id}`);
  };

  return (
    <Dropdown>
      <Tip label={label}>
        <Button isIconOnly variant="ghost" aria-label={label} className="relative ml-auto shrink-0">
          {/* Lonceng bergoyang sekali & angka muncul pelan tiap jumlah peringatan berubah (key = count). */}
          <m.span key={count} className="grid" initial={{ rotate: 0 }} animate={count > 0 ? { rotate: [0, 14, -10, 6, 0] } : undefined}
            transition={{ duration: 0.6, ease: 'easeInOut' }} style={{ transformOrigin: '50% 10%' }}>
            <Bell className="size-5" />
          </m.span>
          {count > 0 && (
            <m.span key={`n${count}`} aria-hidden initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
              {count > 99 ? '99+' : count}
            </m.span>
          )}
        </Button>
      </Tip>
      <Dropdown.Popover placement="bottom end" className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <div className="flex items-baseline justify-between gap-3 px-3 pt-3 pb-2">
          <p className="text-sm font-semibold text-heading">{t('alert.title')}</p>
          {count > 0 && <span className="text-xs text-muted tabular-nums">{t('alert.count', { n: count })}</span>}
        </div>
        {items.length === 0 ? (
          <p className="px-3 pb-4 text-sm text-muted">{t('alert.empty')}</p>
        ) : (
          <Dropdown.Menu
            // Tiap peringatan dibatasi garis tipis (header | daftar | item), tanpa garis setelah item terakhir.
            aria-label={t('alert.title')} onAction={(k) => open(String(k))} className="max-h-96 overflow-y-auto border-t border-separator p-0">
            {items.map((a) => (
              <Dropdown.Item key={a.id} id={a.id} textValue={a.label} className="shrink-0 items-start rounded-none border-b border-separator px-3 py-2.5 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <Label className="min-w-0 flex-1 truncate font-medium text-heading">{a.label}</Label>
                    {URGENCIES.includes(a.urgensi as Urgency) && <UrgencyBadge short value={a.urgensi as Urgency} />}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {a.layer}{a.kondisi && `, ${a.kondisi}`}, {a.keputusan ?? t('alert.undecided')}
                  </span>
                  {a.catatan && <span className="line-clamp-2 text-xs text-subtle">{a.catatan}</span>}
                </span>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        )}
        {count > items.length && <p className="border-t border-separator px-3 py-2 text-xs text-muted">{t('alert.more', { n: count - items.length })}</p>}
      </Dropdown.Popover>
    </Dropdown>
  );
}
