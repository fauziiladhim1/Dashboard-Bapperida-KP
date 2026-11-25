import { MapPin } from '@gravity-ui/icons';
import { ListBox, Select } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { endpoints } from '@/lib/api';
import { useT } from '@/lib/prefs';

const ALL = '__all__';

/** Tombol dropdown kecamatan dari layer batas administrasi; `undefined` = seluruh kabupaten. */
export function KecamatanSelect({ value, onChange, className }: { value?: string; onChange: (k?: string) => void; className?: string }) {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ['kecamatan'], queryFn: endpoints.kecamatan });
  const items = [{ id: ALL, name: t('map.allKec') }, ...data.map((k) => ({ id: k, name: k }))];
  return (
    <Select aria-label={t('map.filterKec')} className={className} selectedKey={value ?? ALL}
      onSelectionChange={(k) => k !== null && onChange(k === ALL ? undefined : String(k))}>
      <Select.Trigger className="min-h-10 gap-2 bg-surface text-sm text-heading">
        <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
        <Select.Value className="break-words" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(it: { id: string; name: string }) => (
            <ListBox.Item id={it.id} textValue={it.name}>
              {it.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
