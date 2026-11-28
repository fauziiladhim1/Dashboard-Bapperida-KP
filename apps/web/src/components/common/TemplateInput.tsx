import { useRef } from 'react';
import { Label, TextArea } from '@heroui/react';
import { fill } from '@/components/common/card-style';
import { useT } from '@/lib/prefs';

/**
 * Teks bebas + field `{nama}` ala Tableau (baris angka kartu, baris popup peta). Klik chip field = sisipkan di posisi
 * kursor. `vars` = nilai yang ditampilkan di chip (angka terkini, atau label field bila nilai belum diketahui);
 * `preview` menampilkan hasil isian di bawahnya.
 */
export function TemplateInput({ id, label, def = '', vars, value, onChange, preview = true }: {
  id: string; label: string; def?: string; vars: Record<string, string | number>; value: string; onChange: (v: string) => void; preview?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (field: string) => {
    const el = ref.current;
    const base = value || def;
    const [a, b] = el && value ? [el.selectionStart, el.selectionEnd] : [base.length, base.length];
    onChange(`${base.slice(0, a)}{${field}}${base.slice(b)}`);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + field.length + 2, a + field.length + 2); });
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <TextArea ref={ref} id={id} rows={2} maxLength={300} placeholder={def} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{t('style.fields')}</span>
        {Object.entries(vars).map(([k, v]) => (
          <button key={k} type="button" onClick={() => insert(k)} aria-label={`{${k}} = ${String(v)}`}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-success/30 bg-success/5 px-1.5 text-xs text-success hover:bg-success/10">
            {`{${k}}`}<span className="text-muted">= {String(v)}</span>
          </button>
        ))}
      </div>
      {preview && <p className="text-xs text-muted">{t('style.result')} <span className="text-heading">{fill(value || def, vars)}</span></p>}
    </div>
  );
}
