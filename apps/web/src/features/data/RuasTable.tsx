import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Plus, TrashBin } from '@gravity-ui/icons';
import { Button, buttonVariants, Card, Table } from '@heroui/react';
import { useState, type ReactNode } from 'react';
import { KecamatanSelect } from '@/components/common/KecamatanSelect';
import { Tip } from '@/components/common/Tip';
import { canEdit, useMe } from '@/hooks/use-auth';
import { endpoints, refreshData } from '@/lib/api';
import { fmt } from '@/lib/format';
import { confirmDanger, confirmEdit, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { RuasJalan } from '@/lib/types';

/** Slug semu menu Data untuk tabel rekap ruas jalan (bukan layer: tanpa koordinat). */
export const RUAS_SLUG = 'tabel-ruas-jalan';

type Row = RuasJalan & { id: number };
const NUMS = ['baik', 'sedang', 'rusakRingan', 'rusakBerat', 'perbaikan'] as const;
const TEXTS = ['kecamatan', 'wilayah', 'ruas'] as const;
const blank = (kecamatan = ''): Omit<Row, 'id'> => ({ kecamatan, wilayah: '', tahun: new Date().getFullYear(), ruas: '', baik: 0, sedang: 0, rusakRingan: 0, rusakBerat: 0, perbaikan: 0 });
/** Lebar minimum per kolom agar nama ruas tidak terpotong; kolom angka cukup 80px. */
const WIDTH: Partial<Record<keyof RuasJalan, string>> = { ruas: 'min-w-40', kecamatan: 'min-w-24', wilayah: 'min-w-24', tahun: 'min-w-16' };
const cell = 'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-center text-sm text-heading hover:border-border focus:border-[var(--field-border)] focus:bg-surface focus:outline-none disabled:hover:border-transparent';

/**
 * Rekap kondisi ruas jalan (km per kondisi) yang dipakai Ringkasan. Sel bisa diubah langsung (simpan saat fokus lepas),
 * baris baru ditambah lewat baris draf di bawah tabel. Tanpa geometri: pindahkan ke layer Kondisi Jalan bila ada SHP ruasnya.
 */
export function RuasTable({ picker }: { picker: ReactNode }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const editor = canEdit(me);
  const [kec, setKec] = useState<string>();
  const [draft, setDraft] = useState<Omit<Row, 'id'> | null>(null);
  const rows = useQuery({ queryKey: ['tables', 'ruas-jalan', kec], queryFn: () => endpoints.ruasTable(kec) });
  // Ringkasan membaca /stats/ruas-jalan, deret waktu, dan kelas kondisi ruas SK (dihitung dari tabel ini): ikut disegarkan.
  const refresh = () => refreshData(qc, ['tables']);
  const onError = (e: Error) => toastError(e.message);
  const patch = useMutation({ mutationFn: ({ id, ...b }: Partial<Row> & { id: number }) => endpoints.updateRuas(id, b), onSuccess: () => { toast(t('table.saved')); return refresh(); }, onError });
  const create = useMutation({ mutationFn: endpoints.createRuas, onSuccess: () => { setDraft(null); toast(t('table.saved')); return refresh(); }, onError });
  const remove = useMutation({ mutationFn: endpoints.deleteRuas, onSuccess: () => { toast(t('data.deleted', { n: 1 })); return refresh(); }, onError });

  const save = async (r: Row, key: keyof RuasJalan, el: HTMLInputElement) => {
    const value = NUMS.includes(key as (typeof NUMS)[number]) || key === 'tahun' ? Number(el.value) : el.value.trim();
    if (value === r[key] || (typeof value === 'number' && Number.isNaN(value))) return;
    const field = cols.find((c) => c.key === key)!.label;
    const shown = (v: unknown) => (typeof v === 'number' ? fmt(v) : `"${String(v)}"`);
    // Ubah sel: tanya Ya/Tidak; "Tidak" mengembalikan isi sel ke nilai tersimpan.
    if (await confirmEdit({
      title: t('confirm.editTitle'), text: t('confirm.editCell', { field, from: shown(r[key]), to: shown(value) }),
      confirm: t('confirm.yesSave'), cancel: t('confirm.no'), subject: r.ruas,
    })) patch.mutate({ id: r.id, [key]: value });
    else el.value = String(r[key]);
  };
  const del = async (r: Row) => {
    if (await confirmDanger({ title: t('table.confirmDelete', { name: r.ruas }), text: t('data.confirmText'), confirm: t('confirm.yesDelete'), cancel: t('confirm.no') })) remove.mutate(r.id);
  };
  const total = (r: Omit<Row, 'id'>) => r.baik + r.sedang + r.rusakRingan + r.rusakBerat;
  const cols: { key: keyof RuasJalan; label: string; num?: boolean }[] = [
    { key: 'kecamatan', label: t('table.kecamatan') }, { key: 'wilayah', label: t('table.wilayah') }, { key: 'tahun', label: t('data.year'), num: true },
    { key: 'ruas', label: t('table.ruas') }, ...NUMS.map((k) => ({ key: k, label: t(`table.${k}`), num: true })),
  ];
  const input = (r: Omit<Row, 'id'>, c: (typeof cols)[number], onCommit: (el: HTMLInputElement) => void) => (
    <input key={`${c.key}-${String(r[c.key])}`} defaultValue={String(r[c.key])} disabled={!editor} aria-label={c.label}
      type={c.num ? 'number' : 'text'} min={c.num ? 0 : undefined} step={c.key === 'tahun' ? 1 : 0.01}
      onBlur={(e) => onCommit(e.currentTarget)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`${cell} ${WIDTH[c.key] ?? 'min-w-14'} ${c.num ? 'tabular-nums' : ''}`} />
  );

  return (
    <Card className="gap-4 p-6">
      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
        {picker}
        <div className="flex flex-wrap gap-2">
          {editor && <Button onPress={() => setDraft(blank(kec))} isDisabled={!!draft}><Plus className="size-4" /> {t('table.add')}</Button>}
          <a href={endpoints.ruasExportUrl(kec)} download className={buttonVariants({ variant: 'secondary' })}><ArrowDownToLine className="size-4" /> CSV (Excel)</a>
        </div>
      </div>
      <p className="-mt-1 px-1 text-sm text-muted">{t('table.ruasNote')}</p>
      <KecamatanSelect value={kec} onChange={setKec} className="w-full sm:w-60" />

      <Table className="data-table">
        <Table.ScrollContainer>
          <Table.Content aria-label={t('table.ruasTitle')} className="min-w-[960px]">
            <Table.Header>
              {[...cols.map((c) => <Table.Column key={c.key} isRowHeader={c.key === 'ruas'}>{c.label}</Table.Column>),
                <Table.Column key="total">{t('table.total')}</Table.Column>,
                <Table.Column key="act" className="whitespace-nowrap">{t('data.actions')}</Table.Column>]}
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-12 text-center text-sm text-muted">{rows.isPending ? t('common.loading') : t('common.noData')}</p>}>
              {[...(rows.data ?? []).map((r) => (
                <Table.Row key={r.id} id={String(r.id)}>
                  {[...cols.map((c) => <Table.Cell key={c.key} className="px-1 py-1">{input(r, c, (el) => void save(r, c.key, el))}</Table.Cell>),
                    <Table.Cell key="total" className="text-sm font-medium whitespace-nowrap tabular-nums">{fmt(total(r))} km</Table.Cell>,
                    <Table.Cell key="act">
                      {editor && (
                        <Tip label={t('common.delete')}>
                          <Button isIconOnly size="sm" variant="ghost" onPress={() => del(r)} aria-label={`${t('common.delete')} ${r.ruas}`} className="text-danger"><TrashBin className="size-4" /></Button>
                        </Tip>
                      )}
                    </Table.Cell>]}
                </Table.Row>
              )),
              ...(draft ? [(
                <Table.Row key="draft" id="draft" className="bg-accent/[0.06]">
                  {[...cols.map((c) => <Table.Cell key={c.key} className="px-1 py-1">{input(draft, c, ({ value: v }) => setDraft((d) => d && { ...d, [c.key]: c.num ? Number(v) : v }))}</Table.Cell>),
                    <Table.Cell key="total" className="text-sm whitespace-nowrap tabular-nums">{fmt(total(draft))} km</Table.Cell>,
                    <Table.Cell key="act" className="whitespace-nowrap">
                      <Button size="sm" isPending={create.isPending} isDisabled={TEXTS.some((k) => !draft[k].trim())} onPress={() => create.mutate(draft)}>{t('common.save')}</Button>
                      <Button size="sm" variant="ghost" onPress={() => setDraft(null)}>{t('common.cancel')}</Button>
                    </Table.Cell>]}
                </Table.Row>
              )] : [])]}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <p className="text-sm text-muted">{t('table.count', { n: fmt(rows.data?.length ?? 0) })}</p>
    </Card>
  );
}
