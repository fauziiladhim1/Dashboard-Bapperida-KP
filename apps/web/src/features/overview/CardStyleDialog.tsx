import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { ArrowUpFromSquare, ChartColumn } from '@gravity-ui/icons';
import { Button, Input, Label, TextArea } from '@heroui/react';
import { AppModal } from '@/components/common/AppModal';
import { CARD_ICONS, CardStyleProvider, TONES, type CardStyle, type Slot, type TextSlot } from '@/components/common/card-style';
import { TemplateInput } from '@/components/common/TemplateInput';
import { ColorField } from '@/components/common/ColorField';
import { toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { CardTone } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Gambar unggahan diperkecil di browser jadi PNG 64×64 (muat utuh): kecil untuk disimpan di tata letak, dan SVG ikut dirasterkan. */
const toPng = (file: File) => new Promise<string>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const k = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight) || 1;
    const [w, h] = [img.naturalWidth * k, img.naturalHeight * k];
    c.getContext('2d')!.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
    URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/png'));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
  img.src = url;
});

/** Lebar kartu (px) di grid Ringkasan 12 kolom ber-gap 16px; `span` kosong = sepertiga. */
const cardWidth = (span = 4) => {
  // ponytail: rumus grid desktop seperti KpiDialog; di layar sempit dibatasi max-w-full.
  const board = document.querySelector('[data-board]')?.clientWidth || 1200;
  return ((board - 11 * 16) / 12) * span + (span - 1) * 16;
};

const TONE_KEYS = Object.keys(TONES) as (keyof typeof TONES)[];

/**
 * Tampilan satu kartu Ringkasan: judul & catatan pengganti, ikon (pilihan atau unggahan), warna chip ikon. Data kartu
 * (angka, grafik) tidak berubah; isian kosong = teks bawaan.
 */
export function CardStyleDialog({ label, value, texts = {}, preview, span, onRecipe, onSave, onClose }: {
  /** Judul bawaan kartu (placeholder). */
  label: string; value: CardStyle;
  /** Baris angka kartu yang bisa diedit (template bawaan + field angka terkini). */
  texts?: Partial<Record<Slot, TextSlot>>;
  /** Buka builder data & grafik (sumber layer, ukuran, rincian, bentuk grafik). */
  onRecipe?: () => void;
  /** Isi kartu sungguhan untuk pratinjau langsung: ikut berubah saat judul, catatan, ikon, atau warna diganti. */
  preview?: ReactNode;
  /** Lebar kartu di grid (kolom dari 12) untuk pratinjau. */
  span?: number;
  onSave: (s: CardStyle) => void; onClose: () => void;
}) {
  const t = useT();
  const [s, setS] = useState<CardStyle>(value);
  const set = (p: CardStyle) => setS((x) => ({ ...x, ...p }));
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { set({ icon: await toPng(file) }); } catch { toastError(t('style.uploadBad')); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Isian kosong tidak disimpan: kartu kembali memakai teks/ikon bawaan.
    onSave({ title: s.title?.trim() || undefined, note: s.note?.trim() || undefined, icon: s.icon || undefined, tone: s.tone && s.tone !== 'accent' ? s.tone : undefined,
      foot: s.footOff ? undefined : s.foot?.trim() || undefined, footOff: s.footOff || undefined,
      sub: s.sub?.trim() || undefined, delta: s.delta?.trim() || undefined, legend: s.legend?.trim() || undefined, caption: s.caption?.trim() || undefined,
      arrange: s.arrange });
  };
  const choice = (on: boolean) => cn('grid h-9 place-items-center rounded-lg border transition-colors',
    on ? 'border-accent bg-accent/10 text-accent' : 'border-separator text-muted hover:border-accent/50 hover:text-heading');
  const custom = !!s.tone?.startsWith('#');

  return (
    <AppModal size="xl" title={t('style.title')} description={t('style.desc')} onClose={onClose}
      // Aksi di footer modal: tetap terlihat walau isi digulir. Tombol submit terhubung ke form lewat `form`.
      footer={<>
        <Button variant="tertiary" className="mr-auto" onPress={() => setS({})}>{t('style.reset')}</Button>
        <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="card-style">{t('common.save')}</Button>
      </>}>
      <form id="card-style" onSubmit={submit} className="flex flex-col gap-5">
        {/* Pratinjau = kartu yang sama dengan di Ringkasan, dengan gaya draf. Tinggi dibatasi (kartu lebar digulir di
            dalam bingkainya), tidak bisa diklik agar tautan kartu tidak berpindah halaman. */}
        {preview && (
          <div className="max-h-72 overflow-auto rounded-2xl bg-default/50 p-3">
            {/* Lebar = lebar kartu di grid desktop (rumus sama dengan builder KPI), dibatasi lebar dialog. */}
            <div inert className="mx-auto max-w-full [&>*]:min-h-0" style={{ width: cardWidth(span) }}><CardStyleProvider value={s}>{preview}</CardStyleProvider></div>
          </div>
        )}
        {onRecipe && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-default/40 p-3">
            <p className="min-w-0 flex-1 basis-64 text-xs text-muted">{t('style.recipeHint')}</p>
            <Button size="sm" variant="secondary" onPress={onRecipe}><ChartColumn className="size-4" /> {t('style.recipe')}</Button>
          </div>
        )}

        {/* Dua kolom: teks kartu di kiri (yang paling sering diubah), ikon & warna di kanan. Ponsel: bertumpuk. */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_19rem]">
          <section aria-label={t('style.texts')} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-title">{t('kpi.label')}</Label>
              <Input id="card-title" maxLength={80} placeholder={label} value={s.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-note">{t('style.note')}</Label>
              <TextArea id="card-note" rows={2} maxLength={240} placeholder={t('style.noteHint')} value={s.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
            </div>

            {(Object.keys(texts) as Slot[]).map((slot) => <TemplateInput key={slot} id={`card-${slot}`} label={t(`style.slot.${slot}`)}
              def={texts[slot]!.def} vars={texts[slot]!.vars} value={s[slot] ?? ''} onChange={(v) => set({ [slot]: v })} />)}

            {/* Keterangan bawah: petunjuk/sumber/catatan metodologi di dasar kartu (mis. catatan InaRISK di kartu bahaya). */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-foot">{t('style.foot')}</Label>
              <TextArea id="card-foot" rows={3} maxLength={400} disabled={!!s.footOff} placeholder={t('style.footHint')} value={s.foot ?? ''} onChange={(e) => set({ foot: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!s.footOff} onChange={(e) => set({ footOff: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                {t('style.footOff')}
              </label>
            </div>
          </section>

          <section aria-label={t('style.look')} className="flex flex-col gap-4 md:border-l md:border-separator md:pl-6">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-heading">{t('style.icon')}</legend>
              <div role="radiogroup" aria-label={t('style.icon')} className="grid grid-cols-7 gap-1.5">
                <button type="button" role="radio" aria-checked={!s.icon} onClick={() => set({ icon: undefined })} className={cn(choice(!s.icon), 'col-span-3 px-2 text-xs')}>
                  {t('style.iconDefault')}
                </button>
                {/* Unggahan: label membungkus input file agar bisa dibuka dengan keyboard (fokus ke input yang tersembunyi visual). */}
                <label className={cn(choice(!!s.icon?.startsWith('data:')), 'col-span-4 flex cursor-pointer items-center justify-center gap-1.5 px-2 text-xs focus-within:ring-2 focus-within:ring-focus')}>
                  {s.icon?.startsWith('data:') ? <img src={s.icon} alt="" className="size-5 object-contain" /> : <ArrowUpFromSquare className="size-4" aria-hidden />}
                  <span className="truncate">{t('style.upload')}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => void upload(e)} className="sr-only" />
                </label>
                {Object.entries(CARD_ICONS).map(([name, Glyph]) => (
                  <button key={name} type="button" role="radio" aria-checked={s.icon === `g:${name}`} aria-label={name} title={name}
                    onClick={() => set({ icon: `g:${name}` })} className={choice(s.icon === `g:${name}`)}>
                    <Glyph className="size-4" aria-hidden />
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">{t('style.uploadHint')}</p>
            </fieldset>

            {/* Warna: lima nada tema + "Warna Lain"; pemilih warna lengkap hanya dibuka untuk warna lain, agar dialog tidak memanjang. */}
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-heading">{t('style.color')}</p>
              <div role="radiogroup" aria-label={t('style.color')} className="flex flex-wrap items-center gap-2">
                {TONE_KEYS.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={(s.tone ?? 'accent') === k} aria-label={t(`style.tone.${k}`)} title={t(`style.tone.${k}`)}
                    onClick={() => set({ tone: k })}
                    className={cn('grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface', TONES[k], (s.tone ?? 'accent') === k && 'ring-2 ring-accent')}>
                    <span className="size-2.5 rounded-full bg-current" />
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={custom} aria-label={t('style.colorCustom')} title={t('style.colorCustom')}
                  onClick={() => !custom && set({ tone: '#4C6B57' as CardTone })}
                  className={cn('size-8 rounded-full ring-offset-2 ring-offset-surface', custom && 'ring-2 ring-accent')}
                  style={{ background: custom ? s.tone : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)' }} />
              </div>
              {/* Warna bebas: kode Hex/RGB/HSL/OKLCH atau pemilih warna; disimpan sebagai hex. */}
              {custom && <ColorField id="card-color" label={t('style.colorCustom')} value={s.tone!} onChange={(hex) => set({ tone: hex as CardTone })} />}
            </div>
          </section>
        </div>
      </form>
    </AppModal>
  );
}
