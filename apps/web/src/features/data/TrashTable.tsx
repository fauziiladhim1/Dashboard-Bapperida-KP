import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRotateLeft, TrashBin } from '@gravity-ui/icons';
import { Button, Checkbox, Table, type Selection, type SortDescriptor } from '@heroui/react';
import { AnimatePresence, m } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { SPRING } from '@/components/common/motion';
import { featureLabel, labelKey } from '@/components/map/MapOverlays';
import { Pagination } from '@/components/common/Pagination';
import { Tip } from '@/components/common/Tip';
import { useMe } from '@/hooks/use-auth';
import { endpoints, refreshData } from '@/lib/api';
import { fmt, fmtDateTime } from '@/lib/format';
import { confirmDanger, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { Layer } from '@/lib/types';

/**
 * Tab "Terhapus" menu Data: fitur yang dihapus (soft delete) per layer. Pulihkan = kembali ke peta, Ringkasan, dan ekspor;
 * hapus permanen (superadmin saja) membuang fitur beserta fotonya dan tidak bisa dibatalkan.
 */
/**
 * `q` dan `kec`: kata kunci dan kecamatan dari baris filter menu Data (sama dengan tab Aktif); komponen di-key per filter
 * agar halaman kembali ke 1 dan pilihan baris kosong.
 */
export function TrashTable({ layer, q, kec }: { layer: Layer; q?: string; kec?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = me?.role === 'superadmin';
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // Urutan dari header kolom (server-side, berlaku untuk semua halaman); bawaan = terbaru dihapus dulu.
  const [sort, setSort] = useState<SortDescriptor>({ column: 'at', direction: 'descending' });
  const [labelProp, setLabelProp] = useState<string>('id');
  const apiSort = ({ id: 'id', feature: labelProp, by: 'deleted_by', at: 'deleted_at' } as Record<string, string>)[String(sort.column)]!;
  const order = sort.direction === 'ascending' ? 'asc' as const : 'desc' as const;
  const list = useQuery({
    queryKey: ['trash', layer.slug, page, limit, q, kec, apiSort, order],
    queryFn: () => endpoints.trash(layer.slug, { page, limit, q: q || undefined, kecamatan: kec, sort: apiSort, order }),
    placeholderData: keepPreviousData,
  });
  // Pulihkan mengubah peta/KPI/statistik (versi tile naik): seluruh query data ikut basi, bukan hanya daftar ini.
  const refresh = () => { setChecked(new Set()); return refreshData(qc, ['trash', 'features', 'layers']); };
  const onError = (e: Error) => toastError(e.message);
  const restore = useMutation({ mutationFn: endpoints.restoreFeature, onSuccess: () => { toast(t('trash.restored')); return refresh(); }, onError });
  const restoreMany = useMutation({
    mutationFn: (ids: number[]) => endpoints.bulkRestore(layer.slug, ids),
    onSuccess: (r) => { toast(t('trash.restoredN', { n: r.restored })); return refresh(); }, onError,
  });
  const purge = useMutation({ mutationFn: endpoints.purgeFeature, onSuccess: () => { toast(t('trash.purged')); return refresh(); }, onError });
  const purgeMany = useMutation({
    mutationFn: (ids: number[]) => endpoints.bulkPurge(layer.slug, ids),
    onSuccess: (r) => { toast(t('trash.purgedN', { n: r.purged })); return refresh(); }, onError,
  });
  const confirmPurgeMany = async () => {
    if (await confirmDanger({ title: t('trash.purgeManyTitle', { n: checked.size }), text: t('trash.purgeText'), confirm: t('trash.purge'), cancel: t('confirm.no') })) purgeMany.mutate([...checked]);
  };

  const rows = list.data?.data ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / limit));
  const onSort = (d: SortDescriptor) => {
    // Kolom Fitur diurutkan menurut atribut yang menjadi nama fitur (sama dengan isi kolomnya).
    if (d.column === 'feature') setLabelProp(labelKey(rows[0]?.properties ?? {}, layer) ?? 'id');
    setSort(d); setPage(1); setChecked(new Set());
  };
  /** Kolom yang bisa diurutkan naik/turun dari header (pola sama dengan tab Aktif). */
  const sortable = (id: string, label: ReactNode, className: string, extra?: { isRowHeader?: boolean }) => (
    <Table.Column id={id} allowsSorting className={className} {...extra}>
      {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>{label}</Table.SortableColumnHeader>}
    </Table.Column>
  );
  const onSelect = (keys: Selection) => setChecked(new Set(keys === 'all' ? rows.map((r) => Number(r.id)) : [...keys].map(Number)));
  const confirmPurge = async (id: string, label: string) => {
    if (await confirmDanger({ title: t('trash.purgeTitle'), text: t('trash.purgeText'), confirm: t('trash.purge'), cancel: t('confirm.no'), subject: label })) purge.mutate(id);
  };

  return (
    <>
      <p className="-mt-1 px-1 text-sm text-muted">{t('trash.note')}</p>
      <Table className={`data-table transition-opacity duration-200 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
        <Table.ScrollContainer>
          {/* Lebar kolom: ID, penghapus, waktu & aksi tetap; nama fitur mengisi sisa dan rata kiri agar tidak mengambang di tengah celah lebar. */}
          <Table.Content aria-label={`${t('trash.tab')}: ${layer.name}`} className="min-w-[640px] table-fixed"
            selectionMode="multiple" selectedKeys={new Set([...checked].map(String))} onSelectionChange={onSelect}
            sortDescriptor={sort} onSortChange={onSort}>
            <Table.Header>
              <Table.Column id="sel" className="w-14"><Checkbox aria-label={t('data.selectAll')} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Column>
              {sortable('id', 'ID', 'w-24 whitespace-nowrap', { isRowHeader: true })}
              {sortable('feature', t('trash.feature'), 'w-auto !text-left')}
              {sortable('by', t('trash.by'), 'w-44 whitespace-nowrap')}
              {sortable('at', t('trash.at'), 'w-48 whitespace-nowrap')}
              <Table.Column id="act" className="w-28 whitespace-nowrap">{t('data.actions')}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-12 text-center text-sm text-muted">{list.isPending ? t('common.loading') : q ? t('trash.noMatch', { q }) : t('trash.empty')}</p>}>
              {rows.map((f) => {
                const label = featureLabel(f.properties, layer, f.id);
                return (
                  <Table.Row key={f.id} id={f.id}>
                    <Table.Cell><Checkbox aria-label={t('data.select', { id: f.id })} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell>
                    <Table.Cell className="font-mono text-xs text-muted">{f.id}</Table.Cell>
                    <Table.Cell className="break-words !text-left text-heading">{label}</Table.Cell>
                    <Table.Cell className="text-sm text-muted">{f.deletedBy ?? '–'}</Table.Cell>
                    <Table.Cell className="text-xs whitespace-nowrap text-muted">{fmtDateTime(f.deletedAt)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap">
                      {/* Ikon saja tanpa latar, seperti aksi baris di tab Aktif; namanya lewat tooltip & label aksesibel. */}
                      <div className="flex items-center justify-center gap-1">
                        <Tip label={t('trash.restore')}>
                          <Button isIconOnly size="sm" variant="ghost" className="text-accent" isDisabled={restore.isPending}
                            onPress={() => restore.mutate(f.id)} aria-label={`${t('trash.restore')} ${label}`}><ArrowRotateLeft className="size-4" /></Button>
                        </Tip>
                        {admin && (
                          <Tip label={t('trash.purge')}>
                            <Button isIconOnly size="sm" variant="ghost" className="text-danger" isDisabled={purge.isPending}
                              onPress={() => void confirmPurge(f.id, label)} aria-label={`${t('trash.purge')} ${label}`}><TrashBin className="size-4" /></Button>
                          </Tip>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="flex flex-col items-center justify-between gap-3 text-sm text-muted md:flex-row">
        <span className="shrink-0 whitespace-nowrap">{t('trash.count', { n: fmt(list.data?.total ?? 0) })}</span>
        <Pagination page={page} pages={pages} onChange={(p) => { setPage(p); setChecked(new Set()); }}
          size={limit} onSize={(n) => { setLimit(n); setPage(1); setChecked(new Set()); }} />
      </div>

      {/* Bilah aksi pilihan: bentuk dan posisi sama dengan tab Aktif, aksinya Pulihkan (+ Hapus permanen untuk superadmin). */}
      <AnimatePresence>
        {checked.size > 0 && (
          <m.div role="toolbar" aria-label={t('data.selection')} initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={SPRING}
            className="fixed inset-x-0 bottom-24 z-40 mx-auto flex w-fit items-center gap-2 rounded-[calc(var(--radius-control)+0.5rem)] border border-border bg-surface py-2 pr-2 pl-5 text-sm text-foreground shadow-card-hover lg:bottom-8">
            <span className="mr-2 font-medium tabular-nums">{t('data.selected', { n: checked.size })}</span>
            <Button size="sm" variant="ghost" onPress={() => setChecked(new Set())} className="text-muted hover:text-foreground">{t('common.cancel')}</Button>
            <Button size="sm" isDisabled={restoreMany.isPending} onPress={() => restoreMany.mutate([...checked])}><ArrowRotateLeft className="size-4" /> {t('trash.restoreSelected', { n: checked.size })}</Button>
            {/* Hapus permanen hanya superadmin (sama dengan tombol per baris). */}
            {admin && (
              <Button size="sm" variant="danger" isDisabled={purgeMany.isPending} onPress={() => void confirmPurgeMany()}><TrashBin className="size-4" /> {t('trash.purgeSelected', { n: checked.size })}</Button>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
