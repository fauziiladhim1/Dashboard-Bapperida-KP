import { useState } from 'react';
import { ColorArea, ColorSlider, ColorThumb, SliderTrack, parseColor as ariaColor, type Color } from 'react-aria-components';
import { Copy } from '@gravity-ui/icons';
import { Input, Label } from '@heroui/react';
import { colorCodes, parseColor } from '@/lib/color';
import { toast } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';

/**
 * Kanal HSB dibulatkan ke bilangan bulat: input range tersembunyi ColorArea/ColorSlider ber-step 1, dan nilai pecahan
 * (mis. saturasi 76,5 dari hex) membuatnya "tidak valid" sehingga browser menolak submit form induknya.
 */
const snap = (c: Color) => (['hue', 'saturation', 'brightness'] as const).reduce((x, ch) => x.withChannelValue(ch, Math.round(x.getChannelValue(ch))), c);

/**
 * Pemilih warna: swatch cepat, pemilih warna bawaan browser, dan kolom kode yang menerima Hex / RGB / HSL / OKLCH.
 * Nilai selalu hex #RRGGBB; keempat kodenya tampil dan bisa disalin dengan sekali klik.
 */
export function ColorField({ id, label, value, onChange, swatches = [] }: {
  id: string; label: string; value: string; onChange: (hex: string) => void; swatches?: string[];
}) {
  const t = useT();
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  // HSB disimpan sendiri: hue tetap saat saturasi/kecerahan 0 (hex saja kehilangan hue di abu-abu/hitam).
  const [hsb, setHsb] = useState<Color>(() => snap(ariaColor(value).toFormat('hsb')));
  const set = (hex: string) => { onChange(hex); setText(hex); setBad(false); setHsb(snap(ariaColor(hex).toFormat('hsb'))); };
  const drag = (c: Color) => { const v = snap(c); setHsb(v); const hex = v.toString('hex').toUpperCase(); onChange(hex); setText(hex); setBad(false); };
  const commit = () => {
    const hex = parseColor(text);
    if (hex) set(hex); else setBad(true);
  };
  const codes = colorCodes(value);
  const copy = (code: string) => void navigator.clipboard?.writeText(code).then(() => toast(t('color.copied', { code })));
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {swatches.length > 0 && (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
          {swatches.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value.toUpperCase() === c.toUpperCase()} aria-label={c} title={c} onClick={() => set(c)}
              className={cn('size-7 rounded-full ring-offset-2 ring-offset-surface', value.toUpperCase() === c.toUpperCase() && 'ring-2 ring-accent')}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
      {/* Pemilih ala software editing: bidang saturasi × kecerahan, lalu garis hue di bawahnya (seret atau panah keyboard). */}
      <ColorArea aria-label={t('color.pick')} value={hsb} onChange={drag} xChannel="saturation" yChannel="brightness"
        className="h-36 w-full rounded-lg">
        <ColorThumb className="size-5 rounded-full border-2 border-white shadow-md ring-1 ring-black/25 data-[focus-visible]:size-6" />
      </ColorArea>
      <ColorSlider aria-label={t('color.hue')} channel="hue" value={hsb} onChange={drag}>
        <SliderTrack className="h-3.5 w-full rounded-full">
          <ColorThumb className="top-1/2 size-5 rounded-full border-2 border-white shadow-md ring-1 ring-black/25 data-[focus-visible]:size-6" />
        </SliderTrack>
      </ColorSlider>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-10 shrink-0 rounded-lg border border-separator" style={{ backgroundColor: value }} />
        <Input id={id} value={text} onChange={(e) => { setText(e.target.value); setBad(false); }} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder="#2563EB, rgb(…), hsl(…), oklch(…)" aria-invalid={bad} className="flex-1 tabular-nums" />
      </div>
      {bad && <p className="text-xs text-danger">{t('color.bad')}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        {(Object.entries(codes) as [keyof typeof codes, string][]).map(([fmt, code]) => (
          <button key={fmt} type="button" onClick={() => copy(code)} aria-label={t('color.copy', { code })} title={t('color.copy', { code })}
            className="flex min-w-0 items-center gap-1.5 rounded-md border border-separator px-2 py-1 text-left hover:border-accent/50">
            <span className="text-[10px] font-medium text-muted uppercase">{fmt}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-heading tabular-nums">{code}</span>
            <Copy className="size-3 shrink-0 text-muted" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
