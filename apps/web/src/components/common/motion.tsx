import { Tip } from '@/components/common/Tip';
import { AnimatePresence, animate, m, useMotionValue, useTransform } from 'motion/react';
import { Switch, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Kurva standar: cepat di awal, mendarat halus. Dipakai semua transisi agar terasa satu sistem. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as const;

/** Muncul pelan dari bawah 8px; `index` memberi jeda bertingkat untuk daftar/grid. */
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <m.div
      className={className}
      // Geser pendek + jeda rapat: kartu terakhir sudah tampil < 0,8 s, tidak terasa menunggu.
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: Math.min(index, 8) * 0.04 }}
    >
      {children}
    </m.div>
  );
}

/** Angka yang menghitung naik/turun ke nilai baru. */
export function AnimatedNumber({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(0);
  // Angka antara selama animasi dibulatkan: format menerima bilangan bulat.
  const text = useTransform(mv, (n) => format(Math.round(n)));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.8, ease: EASE });
    return () => controls.stop();
  }, [mv, value]);
  return <m.span className={cn('tabular-nums', className)}>{text}</m.span>;
}

/** `tip`: tooltip opsi (mis. nama lengkap bahasa untuk label singkat ID/EN). */
type Option<T extends string> = { value: T; label: ReactNode; tip?: string };

/** Pilihan tunggal (ToggleButtonGroup HeroUI); `id` dipakai sebagai prefix kunci tombol. */
export function Segmented<T extends string>({
  id, label, value, options, onChange, className,
}: { id: string; label: string; value: T; options: Option<T>[]; onChange: (v: T) => void; className?: string }) {
  return (
    <ToggleButtonGroup aria-label={label} selectionMode="single" disallowEmptySelection size="sm" className={className}
      selectedKeys={[value]} onSelectionChange={(keys) => onChange([...keys][0] as T)}>
      {options.map((o, i) => {
        const btn = (
          <ToggleButton key={o.value} id={o.value} data-group={id} className="flex-1 gap-2 text-sm font-medium whitespace-nowrap">
            {i > 0 && <ToggleButtonGroup.Separator />}
            {o.label}
          </ToggleButton>
        );
        return o.tip ? <Tip key={o.value} label={o.tip}>{btn}</Tip> : btn;
      })}
    </ToggleButtonGroup>
  );
}

/** Saklar (Switch HeroUI); jalur aktif berwarna sesuai warna layer. */
/** Switch kecil; aktif selalu warna primer (accent) agar kontras dengan thumb putih, apa pun warna layernya. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Switch isSelected={checked} onChange={onChange} isDisabled={disabled} aria-label={label} size="sm" className="shrink-0">
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

/** Buka/tutup dengan animasi tinggi. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}
