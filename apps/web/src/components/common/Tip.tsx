import { Tooltip } from '@heroui/react';
import type { ReactElement } from 'react';

/** Tooltip ringkas untuk tombol ikon; anak harus komponen pressable HeroUI (mis. `Button`). */
export function Tip({ label, children, side = 'bottom' }: { label: string; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip delay={200}>
      {children}
      <Tooltip.Content placement={side} offset={8} className="px-2 py-1 text-[11px] font-medium">{label}</Tooltip.Content>
    </Tooltip>
  );
}
