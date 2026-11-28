import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Input, Label, ListBox, Radio, RadioGroup, Select, TextArea, type Key } from '@heroui/react';
import { DateInput } from '@/components/common/DateInput';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { UrgencyBadge } from '@/components/common/UrgencyBadge';
import { endpoints } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/lib/notify';
import { usePrefs } from '@/lib/prefs';
import type { Feature, Layer } from '@/lib/types';
import { conditionUrgency, hasDocs, URGENCIES, type Urgency } from '@/lib/urgency';
import { useSettings, type Settings } from '@/lib/settings';
import { cn } from '@/lib/utils';

const today = () => new Date().toISOString().slice(0, 10);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Notulensi & keputusan tindak lanjut satu fitur, di layer mana pun (mis. ruas rusak berat, kawasan strategis). Disimpan sebagai atribut fitur:
 * `keputusan`, `tanggal_keputusan` (tanggal rapat), `pj_keputusan` (penanggung jawab), `catatan_keputusan` (notulensi),
 * dan `urgensi` (penetapan manual; kosong = otomatis dari kondisi), sehingga ikut ekspor & riwayat perubahan fitur.
 * Pelaksanaan (Diproses/Selesai): `anggaran` (Rp), `sumber_dana`, `tahun_target`; `tanggal_selesai` terisi saat Selesai.
 */
type Props = { f: Feature; layer: Layer; subject: string; onClose: () => void; onSaved: () => unknown };

/** Opsi keputusan & aturan urgensi dari tabel pengaturan (DB): form dirender setelah pengaturan termuat. */
export function DecisionDialog(props: Props) {
  const settings = useSettings().data;
  return settings ? <DecisionForm {...props} settings={settings} /> : null;
}

function DecisionForm({ f, layer, subject, onClose, onSaved, settings }: Props & { settings: Settings }) {
  const { t, lang } = usePrefs();
  const p = f.properties;
  const opsi = settings.keputusan.opsi;
  const [keputusan, setKeputusan] = useState<string>(opsi.some((o) => o.nilai === p.keputusan) ? String(p.keputusan) : opsi[0]!.nilai);
  const [tanggal, setTanggal] = useState(str(p.tanggal_keputusan) || today());
  const [pj, setPj] = useState(str(p.pj_keputusan));
  const [catatan, setCatatan] = useState(str(p.catatan_keputusan));
  const [anggaran, setAnggaran] = useState(p.anggaran === null || p.anggaran === undefined ? '' : String(p.anggaran));
  const [sumber, setSumber] = useState(str(p.sumber_dana));
  const [target, setTarget] = useState(p.tahun_target === null || p.tahun_target === undefined ? '' : String(p.tahun_target));
  // Pelaksanaan hanya bermakna bila keputusan dijalankan.
  const jalan = settings.keputusan.pelaksanaan.includes(keputusan);
  const selesai = settings.keputusan.selesai !== null && keputusan === settings.keputusan.selesai;
  // Saran sumber dana = nilai yang sudah tersimpan di DB (bisa ditambah lewat isian ini), bukan daftar tetap di kode.
  const funds = useQuery({ queryKey: ['decision-funds'], queryFn: endpoints.decisionFunds, enabled: jalan }).data ?? [];
  // Urgensi: "auto" = mengikuti kondisi; pilihan manual disimpan di `urgensi` dan menggantikan hasil dari kondisi.
  const auto = conditionUrgency(layer, p, settings.urgensi);
  const [urg, setUrg] = useState<Urgency | 'auto'>(URGENCIES.includes(p.urgensi as Urgency) ? (p.urgensi as Urgency) : 'auto');
  const urgency = urg === 'auto' ? auto : urg;
  const urgItems = [{ id: 'auto', name: t('urg.auto', { level: auto ? t(`urg.${auto}`) : t('urg.none').toLowerCase() }) },
    ...URGENCIES.map((u) => ({ id: u, name: t(`urg.${u}`) }))];
  const save = useMutation({
    mutationFn: () => endpoints.updateFeature(f.id, {
      properties: { keputusan, urgensi: urg === 'auto' ? null : urg, tanggal_keputusan: tanggal || null, pj_keputusan: pj.trim() || null, catatan_keputusan: catatan.trim() || null,
        anggaran: jalan && anggaran !== '' ? Number(anggaran) : null, sumber_dana: jalan && sumber.trim() ? sumber.trim() : null,
        tahun_target: jalan && target !== '' ? Number(target) : null,
        // Tanggal selesai dipertahankan bila sudah ada (simpan ulang tidak menggeser tanggal realisasi).
        tanggal_selesai: selesai ? (str(p.tanggal_selesai) || today()) : null },
    }),
    onSuccess: async () => { toast(t('decision.saved')); await onSaved(); onClose(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <AppModal size="lg" title={t('decision.title')} description={`${layer.name} #${f.id}`} onClose={onClose} dismissable={false}
      footer={<>
        <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="decision-form" isPending={save.isPending}>{t('decision.submit')}</Button>
      </>}>
      <form id="decision-form" onSubmit={submit} className="flex flex-col gap-6">
        {/* Ringkasan fitur: nama (baris penuh), kondisi, urgensi efektif (ikut pilihan di bawah), terakhir diubah. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-separator p-4 sm:grid-cols-3">
          <div className="col-span-2 min-w-0 sm:col-span-3">
            <dt className="text-xs text-muted">{t('decision.subject')}</dt>
            <dd className="mt-1 truncate text-base font-medium text-heading" title={subject}>{subject}</dd>
          </div>
          {/* Layer tanpa field kondisi (catatan keputusan berlaku untuk semua data): baris kondisi tidak relevan. */}
          {hasDocs(layer) && (
            <div className="min-w-0">
              <dt className="text-xs text-muted">{t('decision.condition')}</dt>
              <dd className="mt-1 text-sm text-heading">{str(p.kondisi) || '—'}</dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('urg.label')}</dt>
            <dd className="mt-1">{urgency ? <UrgencyBadge short value={urgency} className="text-sm" /> : <span className="text-sm text-muted">{t('urg.none')}</span>}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('decision.lastUpdate')}</dt>
            <dd className="mt-1 text-sm text-heading tabular-nums">{fmtDateTime(f.updatedAt)}</dd>
          </div>
        </dl>

        {/* Hierarki: judul dialog > judul bagian (overline xs, redup, kapital) > label isian (medium) > teks bantu (xs, redup). */}
        <section aria-labelledby="decision-assess" className="flex flex-col gap-4">
          <h3 id="decision-assess" className="section-title">{t('decision.assess')}</h3>
          <Select selectedKey={urg} onSelectionChange={(k: Key | null) => k !== null && setUrg(String(k) as Urgency | 'auto')} className="flex flex-col gap-2 sm:max-w-sm">
            <Label>{t('urg.label')}</Label>
            <Select.Trigger className="w-full"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox items={urgItems}>
                {(it: { id: string; name: string }) => <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>}
              </ListBox>
            </Select.Popover>
            <p className="text-xs text-muted">{t(urg === 'auto' ? 'urg.autoHint' : 'urg.manualHint')}</p>
          </Select>

          <RadioGroup value={keputusan} onChange={setKeputusan} className="flex flex-col gap-2">
            <Label>{t('decision.label')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {opsi.map(({ nilai: k, keterangan }) => (
                <Radio key={k} value={k} className={cn('mt-0 h-full rounded-xl border p-3.5 transition-colors',
                  keputusan === k ? 'border-accent bg-accent/5' : 'border-separator hover:border-field-border')}>
                  <Radio.Content className="items-start gap-2.5">
                    <Radio.Control className="mt-0.5"><Radio.Indicator /></Radio.Control>
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-heading">{k}</span>
                      <span className="text-xs leading-snug font-normal text-muted">{keterangan[lang]}</span>
                    </span>
                  </Radio.Content>
                </Radio>
              ))}
            </div>
          </RadioGroup>
        </section>

        {jalan && (
          <section aria-labelledby="decision-exec" className="flex flex-col gap-4">
            <h3 id="decision-exec" className="section-title">{t('decision.exec')}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="decision-budget">{t('decision.budget')}</Label>
                <Input id="decision-budget" type="number" inputMode="numeric" min={0} step={1000} value={anggaran} onChange={(e) => setAnggaran(e.target.value)} placeholder="0" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="decision-fund">{t('decision.fund')}</Label>
                <Input id="decision-fund" list="decision-fund-list" maxLength={80} value={sumber} onChange={(e) => setSumber(e.target.value)} placeholder={t('decision.fundPlaceholder')} />
                <datalist id="decision-fund-list">{funds.map((f) => <option key={f} value={f} />)}</datalist>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="decision-target">{t('decision.target')}</Label>
                <Input id="decision-target" type="number" inputMode="numeric" min={2020} max={2100} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={String(new Date().getFullYear())} />
              </div>
            </div>
            {selesai && <p className="text-xs text-muted">{t('decision.doneOn', { date: str(p.tanggal_selesai) || today() })}</p>}
          </section>
        )}

        <section aria-labelledby="decision-meeting" className="flex flex-col gap-4">
        <h3 id="decision-meeting" className="section-title">{t('decision.meeting')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <DateInput id="decision-date" label={t('decision.date')} max={today()} value={tanggal} onChange={(v) => setTanggal(v ?? '')} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="decision-pj">{t('decision.pic')}</Label>
            <Input id="decision-pj" maxLength={120} value={pj} onChange={(e) => setPj(e.target.value)} placeholder={t('decision.picPlaceholder')} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="decision-note">{t('decision.note')} <span className="font-normal text-muted">{t('common.optional')}</span></Label>
            <span className="text-xs text-muted tabular-nums">{catatan.length}/2000</span>
          </div>
          <TextArea id="decision-note" rows={7} maxLength={2000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={t('decision.notePlaceholder')} />
        </div>
        </section>

        {save.error && <ErrorAlert message={save.error.message} />}
      </form>
    </AppModal>
  );
}
