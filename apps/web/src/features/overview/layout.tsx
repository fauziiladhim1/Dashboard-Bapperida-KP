import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeSlash, Grip, Pencil } from '@gravity-ui/icons';
import { CardStyleProvider, type Slot, type TextSlot } from '@/components/common/card-style';
import { CardStyleDialog } from './CardStyleDialog';
import { Button } from '@heroui/react';
import { Reveal } from '@/components/common/motion';
import { Tip } from '@/components/common/Tip';
import { endpoints } from '@/lib/api';
import { toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { LayoutCard } from '@/lib/types';
import { cn } from '@/lib/utils';

type Span = LayoutCard['span'];
/** Kartu Ringkasan: kunci tata letak, nama (aksesibilitas toolbar), lebar bawaan, isi. */
export type BoardEntry = { key: string; label: string; span: Span; node: ReactNode;
  /** Aksi isi kartu (mis. ubah/duplikat/hapus KPI) di ujung toolbar tata letak: satu toolbar per objek seperti dasbor Tableau. */
  actions?: ReactNode;
  /** Baris angka kartu yang bisa diedit (template + field angka terkini), untuk dialog Tampilan kartu. */
  texts?: Partial<Record<Slot, TextSlot>>;
  /** Buka builder data, grafik & tata letak (KPI kustom, atau kartu bawaan yang bisa jadi resep); tombolnya di dialog edit. */
  onRecipe?: () => void };

/** Lebar di grid 12 kolom desktop; di tablet kartu < 12 jadi setengah lebar, penuh = 2 kolom. Kelas literal agar ikut build Tailwind. */
const SPAN: Record<Span, string> = {
  4: 'lg:col-span-4', 5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 8: 'lg:col-span-8', 12: 'sm:col-span-2 lg:col-span-12',
};
/** Pilihan lebar di toolbar (5/7 hanya bawaan peta + bahaya, tetap sah bila disimpan). */
export const WIDTHS: { span: Span; label: string }[] = [{ span: 4, label: '⅓' }, { span: 6, label: '½' }, { span: 8, label: '⅔' }, { span: 12, label: '1' }];

/**
 * Susunan akhir: urutan & lebar dari DB, kartu yang belum tercatat (kartu/KPI baru) di akhir dengan lebar bawaan,
 * kunci yatim (KPI terhapus) dibuang. Layout kosong = urutan bawaan `entries`.
 */
export const arrange = (saved: LayoutCard[], entries: BoardEntry[]): LayoutCard[] => {
  const keys = new Set(entries.map((e) => e.key));
  const out = saved.filter((c) => keys.has(c.key));
  const seen = new Set(out.map((c) => c.key));
  return [...out, ...entries.filter((e) => !seen.has(e.key)).map((e) => ({ key: e.key, span: e.span, hidden: false }))];
};

/**
 * Lebar satu kartu diubah dari builder KPI. KPI yang baru dibuat belum ada di susunan: ditaruh setelah KPI kustom
 * terakhir (posisi bawaannya), atau sebelum tutupan lahan bila belum ada KPI kustom.
 */
export const withSpan = (cards: LayoutCard[], key: string, span: Span): LayoutCard[] => {
  if (cards.some((c) => c.key === key)) return cards.map((c) => (c.key === key ? { ...c, span } : c));
  const lastKpi = cards.findLastIndex((c) => c.key.startsWith('kpi:'));
  const tutupan = cards.findIndex((c) => c.key === 'tutupan');
  return cards.toSpliced(lastKpi >= 0 ? lastKpi + 1 : tutupan >= 0 ? tutupan : cards.length, 0, { key, span, hidden: false });
};

/** Tata letak bersama (tabel ringkasan_layout); simpan optimistis, gagal = kembali ke versi sebelumnya + toast. */
export function useLayout() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['layout'], queryFn: endpoints.layout });
  const save = useMutation({
    mutationFn: endpoints.saveLayout,
    onMutate: async (cards: LayoutCard[]) => {
      await qc.cancelQueries({ queryKey: ['layout'] });
      const prev = qc.getQueryData<{ cards: LayoutCard[] }>(['layout']);
      qc.setQueryData(['layout'], { cards });
      return { prev };
    },
    onError: (e, _cards, ctx) => { qc.setQueryData(['layout'], ctx?.prev); toastError(e.message); },
  });
  // Urungkan/ulangi ala Tableau: tiap perubahan tata letak = satu langkah; urungkan juga tersimpan ke DB.
  const [hist, setHist] = useState<{ past: LayoutCard[][]; future: LayoutCard[][] }>({ past: [], future: [] });
  const cards = q.data?.cards ?? [];
  return {
    cards,
    save: (next: LayoutCard[]) => { setHist((h) => ({ past: [...h.past, cards], future: [] })); save.mutate(next); },
    undo: () => { const prev = hist.past.at(-1); if (!prev) return; setHist((h) => ({ past: h.past.slice(0, -1), future: [cards, ...h.future] })); save.mutate(prev); },
    redo: () => { const next = hist.future[0]; if (!next) return; setHist((h) => ({ past: [...h.past, cards], future: h.future.slice(1) })); save.mutate(next); },
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0,
  };
}

/**
 * Grid Ringkasan. Di mode edit tiap kartu punya toolbar: pegangan seret (tukar posisi), ← → (keyboard), lebar, dan
 * sembunyikan. Kartu tersembunyi hanya tampil (redup) di mode edit.
 */
export function Board({ entries, cards, editing, onChange, tail }: {
  entries: BoardEntry[]; cards: LayoutCard[]; editing: boolean; onChange: (cards: LayoutCard[]) => void;
  /** Isi tambahan di akhir grid saat edit (mis. kartu "Tambah KPI"). */
  tail?: ReactNode;
}) {
  const t = useT();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Kartu yang sedang diubah tampilannya (judul, catatan, ikon, warna).
  const [styling, setStyling] = useState<string | null>(null);
  const layout = arrange(cards, entries);
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const move = (key: string, to: number) => {
    const from = layout.findIndex((c) => c.key === key);
    if (from < 0 || to < 0 || to >= layout.length || from === to) return;
    const next = [...layout];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    onChange(next);
  };
  const patch = (key: string, p: Partial<LayoutCard>) => onChange(layout.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const shown = editing ? layout : layout.filter((c) => !c.hidden);
  // Tablet (2 kolom): kartu setengah yang sendirian sebelum kartu penuh/akhir grid melebar penuh, agar tak ada celah.
  const fillRow = new Set<string>();
  let run: string[] = [];
  for (const c of [...shown, null]) {
    if (c && c.span !== 12) { run.push(c.key); continue; }
    if (run.length % 2) fillRow.add(run.at(-1)!);
    run = [];
  }

  return (
    // Di luar mode edit garis kartu disembunyikan (kartu dipisah latar & bayangan); mode edit menampilkannya sebagai
    // garis objek seperti dasbor Tableau.
    <div data-board className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12', !editing && '[&_.card]:border-transparent')}>
      {shown.map((c, i) => {
        const e = byKey.get(c.key)!;
        return (
          <Reveal key={c.key} index={i} className={cn(SPAN[c.span], fillRow.has(c.key) && 'sm:max-lg:col-span-2', '[&>*]:h-full')}>
          {/* Sasaran jatuh = seluruh sel. Mode edit ala software editing: kartu bergaris seleksi putus-putus, toolbar
              mengambang di pojok kanan atas (muncul saat diarahkan/fokus), tanpa baris header judul di atas kartu. */}
          <div role={editing ? 'group' : undefined} aria-label={editing ? c.title || e.label : undefined}
            className={cn('group/card relative flex flex-col', editing && 'rounded-[20px] outline-1 outline-offset-4 outline-dashed outline-separator transition-[outline-color] hover:outline-accent/60 focus-within:outline-accent/60',
              editing && over === c.key && drag !== c.key && 'outline-2 outline-solid outline-accent')}
            onDragOver={editing ? (ev) => { if (drag) { ev.preventDefault(); setOver(c.key); } } : undefined}
            onDragLeave={editing ? () => setOver((o) => (o === c.key ? null : o)) : undefined}
            onDrop={editing ? (ev) => { ev.preventDefault(); if (drag) move(drag, layout.findIndex((x) => x.key === c.key)); setDrag(null); setOver(null); } : undefined}>
            {editing && c.hidden && (
              <span className="absolute top-3 left-3 z-10 rounded-md bg-surface px-2 py-1 text-xs text-muted shadow-card">{t('lay.hidden')}</span>
            )}
            {editing && (
              <div className="absolute -top-4 right-4 z-10 flex items-center gap-0.5 rounded-xl bg-surface p-1 text-xs shadow-float opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100 dark:ring-1 dark:ring-white/10">
                <span draggable onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', c.key); setDrag(c.key); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }} aria-label={t('lay.move', { card: e.label })} title={t('lay.move', { card: e.label })}
                  className="grid size-7 cursor-grab place-items-center rounded-md text-muted hover:bg-default active:cursor-grabbing">
                  <Grip className="size-4" aria-hidden />
                </span>
                <ToolBtn label={t('lay.left', { card: e.label })} disabled={i === 0} onPress={() => move(c.key, i - 1)}><ArrowLeft className="size-3.5 max-sm:rotate-90" /></ToolBtn>
                <ToolBtn label={t('lay.right', { card: e.label })} disabled={i === shown.length - 1} onPress={() => move(c.key, i + 1)}><ArrowRight className="size-3.5 max-sm:rotate-90" /></ToolBtn>
                <div role="group" aria-label={t('lay.width', { card: e.label })} className="hidden rounded-md bg-default p-0.5 lg:flex">
                  {WIDTHS.map((w) => (
                    <button key={w.span} type="button" aria-pressed={c.span === w.span} onClick={() => patch(c.key, { span: w.span })}
                      className={cn('h-6 min-w-7 rounded px-1.5 tabular-nums', c.span === w.span ? 'bg-surface font-medium text-heading shadow-sm' : 'text-muted hover:text-heading')}>
                      {w.label}
                    </button>
                  ))}
                </div>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-separator" />
                {/* Satu pintu edit per kartu: tampilan, teks, dan (bila ada resep) data, grafik & tata letak. */}
                <ToolBtn label={`${t('common.edit')} ${e.label}`} onPress={() => setStyling(c.key)}><Pencil className="size-3.5" /></ToolBtn>
                <ToolBtn label={t(c.hidden ? 'lay.show' : 'lay.hide', { card: e.label })} onPress={() => patch(c.key, { hidden: !c.hidden })}>
                  {c.hidden ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
                </ToolBtn>
                {e.actions}
              </div>
            )}
            {/* Tanpa kelas `.card`: itu gaya kartu global (border + bayangan) dan akan membingkai kartu dua kali. */}
            <div className={cn('flex flex-1 flex-col [&>*]:flex-1', editing && c.hidden && 'opacity-40')}>
              <CardStyleProvider value={c}>{e.node}</CardStyleProvider>
            </div>
          </div>
          </Reveal>
        );
      })}
      {editing && tail}
      {styling && (() => {
        const c = layout.find((x) => x.key === styling);
        const e = byKey.get(styling);
        return c && e && <CardStyleDialog label={e.label} value={c} texts={e.texts} preview={e.node} span={c.span}
          onRecipe={e.onRecipe && (() => { setStyling(null); e.onRecipe!(); })} onClose={() => setStyling(null)}
          onSave={(st) => { onChange(layout.map((x) => (x.key === styling ? { key: x.key, span: x.span, hidden: x.hidden, ...st } : x))); setStyling(null); }} />;
      })()}
    </div>
  );
}

/** Tombol ikon toolbar kartu (28px), juga dipakai aksi KPI agar semua ikon toolbar sejajar. */
export function ToolBtn({ label, disabled, onPress, children, className }: { label: string; disabled?: boolean; onPress: () => void; children: ReactNode; className?: string }) {
  return (
    <Tip label={label}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} isDisabled={disabled} onPress={onPress} className={cn('size-7 min-w-7 text-muted', className)}>
        {children}
      </Button>
    </Tip>
  );
}
