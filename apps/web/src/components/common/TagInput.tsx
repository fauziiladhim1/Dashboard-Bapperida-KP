import { useState } from 'react';
import { Xmark } from '@gravity-ui/icons';
import { cn } from '@/lib/utils';

/**
 * Daftar opsi sebagai chip (seperti Value Map QGIS): ketik lalu Enter/koma/Tab untuk menambah, × atau Backspace di isian
 * kosong untuk menghapus. Duplikat diabaikan; teks yang ditempel berkoma dipecah jadi beberapa opsi.
 */
export function TagInput({ id, label, value, onChange, placeholder, className, disabled }: {
  id?: string; label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const items = raw.split(',').map((s) => s.trim().slice(0, 80)).filter((s) => s && !value.includes(s));
    if (items.length) onChange([...value, ...new Set(items)].slice(0, 50));
    setText('');
  };
  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5 rounded-control border border-border bg-field px-2 py-1.5 focus-within:ring-2 focus-within:ring-focus', disabled && 'opacity-50', className)}>
      {value.map((v) => (
        <span key={v} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-accent/10 pr-1 pl-2 text-xs text-accent">
          <span className="truncate">{v}</span>
          {!disabled && (
            <button type="button" aria-label={`Hapus ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="grid size-4 place-items-center rounded hover:bg-accent/15">
              <Xmark className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <input id={id} aria-label={label} value={text} disabled={disabled} placeholder={value.length ? undefined : placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) { e.preventDefault(); add(text); }
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-field-placeholder" />
    </div>
  );
}
