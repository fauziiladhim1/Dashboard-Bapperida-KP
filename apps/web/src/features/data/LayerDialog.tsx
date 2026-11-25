import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, ColorSwatchPicker, Input, Label, ListBox, Select, TextArea } from '@heroui/react';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { endpoints } from '@/lib/api';
import { slugify } from '@/lib/format';
import type { Field, Layer } from '@/lib/types';
import { toast } from '@/lib/notify';
import { useT } from '@/lib/prefs';

/**
 * Satu baris per atribut: key | Label | tipe | opsi1, opsi2
 * contoh: "jenis | Jenis Sekolah | select | SD, SMP, SMA"
 */
export const parseFields = (text: string): Field[] =>
  text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [key = '', label = key, type = 'text', options = ''] = line.split('|').map((s) => s.trim());
    const t = (['text', 'number', 'select'].includes(type) ? type : 'text') as Field['type'];
    return { key, label, type: t, ...(t === 'select' && { options: options.split(',').map((o) => o.trim()).filter(Boolean) }) };
  });

const COLORS = ['#DE533C', '#D97706', '#16A34A', '#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#475569'];
const GEOMS = ['Point', 'LineString', 'Polygon'] as const;

export function LayerDialog({ onClose, onSaved, used = [] }: { onClose: () => void; onSaved: (l: Layer) => void;
  /** Warna dasar layer yang sudah ada: tidak ditawarkan lagi agar simbol tiap layer di peta tidak kembar. */
  used?: string[] }) {
  const t = useT();
  const [name, setName] = useState('');
  const taken = new Set(used.map((c) => c.toUpperCase()));
  const free = COLORS.filter((c) => !taken.has(c.toUpperCase()));
  // ponytail: 8 warna; semua terpakai = tampilkan semuanya lagi, tambah palet bila layer buatan sendiri > 8.
  const palette = free.length ? free : COLORS;
  const [color, setColor] = useState(palette[0]!);
  const save = useMutation({
    mutationFn: (f: FormData) =>
      endpoints.createLayer({
        slug: slugify(name),
        name,
        category: String(f.get('category')),
        year: f.get('year') ? Number(f.get('year')) : null,
        geomType: String(f.get('geomType')),
        style: { color },
        fields: parseFields(String(f.get('fields'))),
        sumber: String(f.get('sumber')).trim() || null, // input selalu ada di form
      }),
    onSuccess: (l) => {
      toast(t('layer.created', { name: l.name }));
      onSaved(l);
      onClose();
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate(new FormData(e.currentTarget));
  };

  return (
    <AppModal title={t('data.newLayer')} description={t('layer.desc')} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t('layer.name')}</Label>
          <Input id="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          {name && <p className="text-xs text-muted">{t('layer.slug', { slug: slugify(name) })}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">{t('layer.category')}</Label>
            <Input id="category" name="category" required defaultValue={t('layer.defaultCategory')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="year">{t('layer.year')}</Label>
            <Input id="year" name="year" type="number" min={1900} max={2100} />
          </div>
          <Select name="geomType" defaultSelectedKey="Point" className="col-span-2 flex flex-col gap-2">
            <Label>{t('layer.geom')}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {GEOMS.map((g) => <ListBox.Item key={g} id={g} textValue={t(`geom.${g}`)}>{t(`geom.${g}`)}<ListBox.ItemIndicator /></ListBox.Item>)}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sumber">{t('layer.source')}</Label>
          <Input id="sumber" name="sumber" maxLength={200} placeholder={t('layer.sourceHint')} />
        </div>
        <div className="flex flex-col gap-2">
          <Label id="color-label">{t('layer.color')}</Label>
          <ColorSwatchPicker aria-labelledby="color-label" value={color} onChange={(c) => setColor(c.toString('hex'))} size="sm">
            {palette.map((c) => (
              <ColorSwatchPicker.Item key={c} color={c}>
                <ColorSwatchPicker.Swatch />
                <ColorSwatchPicker.Indicator />
              </ColorSwatchPicker.Item>
            ))}
          </ColorSwatchPicker>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fields">{t('layer.fields')}</Label>
          <TextArea id="fields" name="fields" rows={3} placeholder={'nama | Nama | text\njenis | Jenis | select | SD, SMP, SMA'} className="font-mono text-xs" />
        </div>
        {save.error && <ErrorAlert message={save.error.message} />}
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isDisabled={save.isPending}>{t('layer.create')}</Button>
        </div>
      </form>
    </AppModal>
  );
}
