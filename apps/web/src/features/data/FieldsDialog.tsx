import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeSlash, Plus, TrashBin } from '@gravity-ui/icons';
import { Button, Checkbox, Input, Label } from '@heroui/react';
import { Pick } from '@/components/common/Pick';
import { FIELD_TYPES, INPUT_TYPE, parseRaw } from '@/lib/field-types';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { DateInput } from '@/components/common/DateInput';
import { keyOf } from './LayerDialog';
import { TagInput } from '@/components/common/TagInput';
import { TemplateInput } from '@/components/common/TemplateInput';
import { Tip } from '@/components/common/Tip';
import { endpoints, refreshData } from '@/lib/api';
import { confirmDanger, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { Field, Layer } from '@/lib/types';
import { cn } from '@/lib/utils';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Tabel atribut ala QGIS untuk skema layer: ganti label, tipe, urutan, wajib, tampil di popup; sembunyikan field (datanya
 * tetap, bisa ditampilkan lagi) atau hapus permanen ("Delete field" QGIS: key dibuang dari data); tambah field baru
 * dengan nilai awal; masukkan kolom impor yang belum di skema; baris teks tambahan popup. Key field tidak bisa diganti:
 * dipakai data, simbologi, dan resep KPI.
 */
export function FieldsDialog({ layer, onClose }: { layer: Layer; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [fields, setFields] = useState<Field[]>(layer.fields);
  const [lines, setLines] = useState<string[]>(layer.style.popupLines ?? []);
  // Nilai awal field baru (key -> teks), diisikan setelah skema tersimpan.
  const [fills, setFills] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ key: '', label: '', type: 'text' as Field['type'], options: [] as string[], fill: '' });
  const isNew = (k: string) => !layer.fields.some((f) => f.key === k);
  const keys = useQuery({ queryKey: ['layer-keys', layer.id], queryFn: () => endpoints.layerKeys(layer.id) });
  const unmapped = (keys.data ?? []).filter((k) => !fields.some((f) => f.key === k));

  const patch = (i: number, p: Partial<Field>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) => setFields((fs) => {
    const next = [...fs];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    return next;
  });
  // Ganti ke Pilihan: opsi awal = nilai yang sudah ada di data, agar data lama tetap sah.
  const changeType = async (i: number, type: Field['type']) => {
    const f = fields[i]!;
    if (type !== 'select' || f.options?.length || isNew(f.key)) return patch(i, { type });
    const rows = await endpoints.stats(layer.slug, { by: f.key }).catch(() => []);
    patch(i, { type, options: rows.map((r) => r.key).filter((k): k is string => !!k).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })) });
  };
  const keyError = draft.key && (!KEY_RE.test(draft.key) ? t('fld.keyBad') : fields.some((f) => f.key === draft.key) ? t('fld.keyTaken') : null);
  const addField = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.key || keyError) return;
    setFields((fs) => [...fs, { key: draft.key, label: draft.label.trim() || draft.key, type: draft.type,
      ...(draft.type === 'select' && { options: draft.options }) }]);
    if (draft.fill.trim()) setFills((x) => ({ ...x, [draft.key]: draft.fill.trim() }));
    setDraft({ key: '', label: '', type: 'text', options: [], fill: '' });
  };

  const save = useMutation({
    mutationFn: async () => {
      await endpoints.updateLayer(layer.id, { fields, style: { ...layer.style, popupLines: lines.map((l) => l.trim()).filter(Boolean) } });
      for (const [key, raw] of Object.entries(fills)) {
        const f = fields.find((x) => x.key === key);
        if (!f || f.hidden) continue;
        const value = parseRaw(f.type, raw);
        if (value === null) continue;
        const r = await endpoints.fillField(layer.id, key, value);
        if (r.updated) toast(t('fld.filled', { n: r.updated, f: f.label }));
      }
    },
    onSuccess: async () => { toast(t('fld.saved', { layer: layer.name })); await refreshData(qc, ['layers']); onClose(); },
  });

  const active = fields.filter((f) => !f.hidden);
  const typeItems = FIELD_TYPES.map((ty) => ({ id: ty, name: t(`fld.type.${ty}`) }));
  // Hapus permanen langsung ke API (bukan saat Simpan): tidak bisa diurungkan, jadi dikonfirmasi per field.
  const drop = useMutation({
    mutationFn: (key: string) => endpoints.dropField(layer.id, key),
    onSuccess: async (r, key) => {
      setFields((fs) => fs.filter((f) => f.key !== key));
      toast(t('fld.dropped', { f: key, n: r.cleared }));
      await refreshData(qc, ['layers']);
    },
    onError: (e) => toastError(e.message),
  });
  const confirmDrop = async (f: Field) => {
    if (await confirmDanger({ title: t('fld.dropTitle'), text: t('fld.dropText'), confirm: t('confirm.yesDelete'), cancel: t('confirm.no'), subject: `${f.label} (${f.key})` })) drop.mutate(f.key);
  };
  return (
    <AppModal size="xl" title={t('fld.title', { layer: layer.name })} description={t('fld.desc')} onClose={onClose} dismissable={false}
      // Tombol simpan di footer modal: tetap terlihat walau daftar field panjang digulir.
      footer={<>
        {save.error && <div className="mr-auto min-w-0"><ErrorAlert message={save.error.message} /></div>}
        <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
        <Button isDisabled={save.isPending} onPress={() => save.mutate()}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
      </>}>
      <div className="flex flex-col gap-6">
        {/* Tabel padat ala tabel atribut QGIS: semua kontrol 28px, lebar kolom tetap, baris disorot saat diarahkan. */}
        <section className="flex flex-col gap-2">
          <p className="section-title">{t('fld.list', { n: active.length })}</p>
          <div className="overflow-x-auto rounded-xl border border-separator">
          <table className="w-full min-w-[720px] table-fixed text-left text-xs">
            <colgroup><col /><col className="w-36" /><col className="w-40" /><col className="w-16" /><col className="w-16" /><col className="w-32" /></colgroup>
            <thead className="bg-default/60 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t('fld.label')}</th>
                <th className="px-2 py-2 font-medium">{t('fld.key')}</th>
                <th className="px-2 py-2 font-medium">{t('fld.type')}</th>
                <th className="px-2 py-2 text-center font-medium">{t('fld.required')}</th>
                <th className="px-2 py-2 text-center font-medium">{t('fld.popup')}</th>
                <th className="px-2 py-2"><span className="sr-only">{t('data.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => (
                <Fragment key={f.key}>
                <tr className={cn('border-t border-separator align-middle transition-colors hover:bg-default/40', f.hidden && 'opacity-50')}>
                  <td className="py-1.5 pr-2 pl-3">
                    <Input aria-label={`${t('fld.label')} ${f.key}`} value={f.label} maxLength={80} disabled={f.hidden}
                      onChange={(e) => patch(i, { label: e.target.value })} className="!h-7 w-full rounded-md px-2 text-xs" />
                  </td>
                  <td className="truncate px-2 py-1.5 text-muted" title={f.key}>
                    {f.key}{f.hidden && <span className="ml-1.5 italic">({t('fld.hiddenTag')})</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {/* Semua field bisa ganti tipe; API menolak bila data yang ada tak cocok (mis. teks jadi Angka). */}
                    <Pick hideLabel tall label={`${t('fld.type')} ${f.key}`} value={f.type} onChange={(v) => void changeType(i, v as Field['type'])} items={typeItems}
                      isDisabled={f.hidden} size="sm" className="w-full" />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Check label={`${t('fld.required')} ${f.label}`} checked={!!f.required} disabled={f.hidden} onChange={(v) => patch(i, { required: v || undefined })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Check label={`${t('fld.popup')} ${f.label}`} checked={f.popup !== false} disabled={f.hidden} onChange={(v) => patch(i, { popup: v ? undefined : false })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex justify-end gap-0.5">
                      <IconBtn label={t('fld.up', { f: f.label })} disabled={i === 0} onPress={() => move(i, -1)}><ArrowUp className="size-3.5" /></IconBtn>
                      <IconBtn label={t('fld.down', { f: f.label })} disabled={i === fields.length - 1} onPress={() => move(i, 1)}><ArrowDown className="size-3.5" /></IconBtn>
                      {/* Field baru yang belum tersimpan boleh dibuang betul; field lama hanya disembunyikan (data tetap). */}
                      {isNew(f.key) ? (
                        <IconBtn label={t('common.delete')} onPress={() => { setFields((fs) => fs.filter((_, j) => j !== i)); setFills(({ [f.key]: _, ...x }) => x); }}>
                          <TrashBin className="size-3.5" />
                        </IconBtn>
                      ) : (
                        <>
                          <IconBtn label={t(f.hidden ? 'fld.show' : 'fld.hide', { f: f.label })} onPress={() => patch(i, { hidden: f.hidden ? undefined : true })}>
                            {f.hidden ? <Eye className="size-3.5" /> : <EyeSlash className="size-3.5" />}
                          </IconBtn>
                          {!layer.sourceLayerId && (
                            <IconBtn label={t('fld.drop', { f: f.label })} disabled={drop.isPending} onPress={() => void confirmDrop(f)} className="text-danger">
                              <TrashBin className="size-3.5" />
                            </IconBtn>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {/* Opsi Pilihan selebar tabel di bawah barisnya: chip per opsi, ketik lalu Enter untuk menambah. */}
                {f.type === 'select' && !f.hidden && (
                  <tr>
                    <td colSpan={6} className="px-3 pb-2">
                      <TagInput label={`${t('fld.options')} ${f.key}`} value={f.options ?? []} placeholder={t('fld.optionsHint')} onChange={(options) => patch(i, { options })} className="min-h-8 rounded-md py-1" />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
          <p className="text-xs text-muted">{t('fld.typeHint')}</p>
        </section>

        {/* Tambah field: key + label + tipe (+ opsi) + nilai awal opsional. */}
        <form onSubmit={addField} className="flex flex-col gap-3 rounded-xl bg-default/40 p-4">
          <p className="section-title">{t('fld.add')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {/* Label dulu: key ikut terisi dari label (status_aset dari "Status Aset") selama key belum diubah sendiri. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fld-label">{t('fld.label')}</Label>
              <Input id="fld-label" value={draft.label} maxLength={80} placeholder="mis. Status Aset"
                onChange={(e) => { const label = e.target.value; setDraft((d) => ({ ...d, label, key: d.key === keyOf(d.label) ? keyOf(label) : d.key })); }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fld-key">{t('fld.key')}</Label>
              <Input id="fld-key" value={draft.key} maxLength={64} placeholder="mis. status_aset"
                onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))} aria-invalid={!!keyError} />
            </div>
            <Pick tall label={t('fld.type')} value={draft.type} onChange={(v) => setDraft((d) => ({ ...d, type: v as Field['type'], fill: '' }))} items={typeItems} className="flex flex-col gap-1.5" />
            {/* Nilai awal mengikuti tipe: Ya/Tidak lewat dropdown, tanggal lewat DateInput, waktu lewat input bawaan browser. */}
            {draft.type === 'boolean' ? (
              <Pick label={t('fld.default')} value={draft.fill || null} placeholder="–" isDisabled={!!layer.sourceLayerId} className="flex flex-col gap-1.5"
                items={[{ id: 'true', name: t('fld.yes') }, { id: 'false', name: t('fld.no') }]} onChange={(v) => setDraft((d) => ({ ...d, fill: v }))} />
            ) : draft.type === 'date' ? (
              <DateInput id="fld-fill" label={t('fld.default')} value={draft.fill || null} isDisabled={!!layer.sourceLayerId} className="flex flex-col gap-1.5"
                onChange={(v) => setDraft((d) => ({ ...d, fill: v ?? '' }))} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fld-fill">{t('fld.default')}</Label>
                <Input id="fld-fill" value={draft.fill} maxLength={500} disabled={!!layer.sourceLayerId}
                  type={INPUT_TYPE[draft.type] ?? 'text'} placeholder={draft.type === 'color' ? '#2563EB' : undefined}
                  step={draft.type === 'number' ? 'any' : undefined} onChange={(e) => setDraft((d) => ({ ...d, fill: e.target.value }))} />
              </div>
            )}
          </div>
          {draft.type === 'select' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fld-opts">{t('fld.options')}</Label>
              <TagInput id="fld-opts" label={t('fld.options')} value={draft.options} placeholder={t('fld.optionsHint')} onChange={(options) => setDraft((d) => ({ ...d, options }))} />
            </div>
          )}
          {keyError && <p className="text-xs text-danger">{keyError}</p>}
          <p className="text-xs text-muted">{layer.sourceLayerId ? t('fld.derived') : t('fld.defaultHint')}</p>
          <div><Button type="submit" variant="secondary" size="sm" isDisabled={!draft.key || !!keyError}><Plus className="size-4" /> {t('fld.add')}</Button></div>
        </form>

        {unmapped.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-separator pt-5">
            <p className="section-title">{t('fld.unmapped')}</p>
            <div className="flex flex-wrap gap-1.5">
              {unmapped.map((k) => (
                <button key={k} type="button" aria-label={t('fld.addKey', { k })} onClick={() => setFields((fs) => [...fs, { key: k, label: k, type: 'text' }])}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-accent/30 bg-accent/5 px-2 text-xs text-accent hover:bg-accent/10">
                  <Plus className="size-3" aria-hidden />{k}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-separator pt-5">
          <div>
            <p className="section-title">{t('fld.lines')}</p>
            <p className="text-xs text-muted">{t('fld.linesHint')}</p>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <TemplateInput id={`popup-line-${i}`} label={t('fld.line', { n: i + 1 })} value={l} preview={false}
                  vars={Object.fromEntries(active.map((f) => [f.key, f.label]))} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? v : x)))} />
              </div>
              <IconBtn label={t('fld.removeLine', { n: i + 1 })} onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))}><TrashBin className="size-3.5" /></IconBtn>
            </div>
          ))}
          {lines.length < 10 && (
            <div><Button variant="secondary" size="sm" onPress={() => setLines((ls) => [...ls, ''])}><Plus className="size-4" /> {t('fld.addLine')}</Button></div>
          )}
        </div>

      </div>
    </AppModal>
  );
}

function IconBtn({ label, disabled, onPress, children, className }: { label: string; disabled?: boolean; onPress: () => void; children: ReactNode; className?: string }) {
  return (
    <Tip label={label}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} isDisabled={disabled} onPress={onPress} className={cn('size-7 min-w-7 text-muted', className)}>{children}</Button>
    </Tip>
  );
}

/** Checkbox HeroUI (sama dengan centang tabel data) untuk kolom Wajib/Popup. */
function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Checkbox aria-label={label} isSelected={checked} isDisabled={disabled} onChange={onChange} className="inline-flex">
      <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
    </Checkbox>
  );
}
