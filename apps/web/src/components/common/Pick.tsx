import { Label, ListBox, Select } from '@heroui/react';
import type { Key } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dropdown pilihan tunggal (Select HeroUI) dengan tampilan sama seperti dropdown lain di aplikasi. Pilihan tidak bisa
 * dikosongkan, jadi `onChange` selalu menerima id. `label` tampil di atas; `aria-label` dipakai bila label disembunyikan.
 */
export function Pick({ label, hideLabel, value, onChange, items, placeholder, className, isDisabled, size, tall }: {
  label: string; hideLabel?: boolean; value: string | null; onChange: (v: string) => void; items: { id: string; name: string }[];
  placeholder?: string; className?: string; isDisabled?: boolean;
  /** `sm`: setinggi kontrol rak builder KPI (28px). */
  size?: 'sm';
  /** Daftar panjang (mis. 13 tipe field) tampil utuh tanpa digulir, agar opsi terakhir tidak tersembunyi. */
  tall?: boolean;
}) {
  return (
    <Select selectedKey={value} onSelectionChange={(k: Key | null) => k !== null && onChange(String(k))} placeholder={placeholder}
      aria-label={hideLabel ? label : undefined} isDisabled={isDisabled} className={className ?? 'flex w-full flex-col gap-2'}>
      {!hideLabel && <Label>{label}</Label>}
      <Select.Trigger className={size === 'sm' ? '!h-7 !min-h-7 w-full rounded-md px-2 text-xs' : 'w-full text-sm'}><Select.Value className={cn('truncate', size === 'sm' ? '!text-xs' : '!text-sm')} /><Select.Indicator /></Select.Trigger>
      <Select.Popover className={tall ? 'tall-popover' : undefined}>
        <ListBox items={items} className={size === 'sm' ? 'text-xs' : undefined}>
          {(it: { id: string; name: string }) => <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
