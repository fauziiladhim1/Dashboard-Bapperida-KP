import { useMutation } from '@tanstack/react-query';
import { FIELD_TYPES } from '@/lib/field-types';
import { Plus, TrashBin } from '@gravity-ui/icons';
import { useState, type FormEvent } from 'react';
import { Button, ComboBox, Input, Label, ListBox, Select } from '@heroui/react';
import { Pick } from '@/components/common/Pick';
import { TagInput } from '@/components/common/TagInput';
import { ColorField } from '@/components/common/ColorField';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { endpoints } from '@/lib/api';
import { slugify } from '@/lib/format';
import type { Field, Layer } from '@/lib/types';
import { toast } from '@/lib/notify';
import { useT } from '@/lib/prefs';

/** Key atribut dari labelnya: huruf kecil, angka, `_`; tidak diawali angka (aturan key di Kelola Field). */
export const keyOf = (label: string) => { const k = slugify(label).replace(/-/g, '_').slice(0, 64); return /^\d/.test(k) ? `f_${k}` : k; };

type Row = { label: string; type: Field['type']; options: string[] };
const EMPTY: Row = { label: '', type: 'text', options: [] };

/** Baris atribut di form → skema field: baris tanpa label dibuang, opsi hanya untuk tipe Pilihan, key kembar diabaikan. */
export const toFields = (rows: Row[]): Field[] => {
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const key = keyOf(r.label.trim());
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: r.label.trim(), type: r.type, ...(r.type === 'select' && { options: r.options }) }];
  });
};

const COLORS = ['#DE533C', '#D97706', '#16A34A', '#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#475569'];
const GEOMS = ['Point', 'LineString', 'Polygon'] as const;

export function LayerDialog({ onClose, onSaved, used = [], categories = [] }: { onClose: () => void; onSaved: (l: Layer) => void;
  /** Warna dasar layer yang sudah ada: tidak ditawarkan lagi agar simbol tiap layer di peta tidak kembar. */
  used?: string[];
  /** Kategori layer yang sudah ada: dipilih dari dropdown, atau ketik kategori baru. */
  categories?: string[] }) {
  const t = useT();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(t('layer.defaultCategory'));
  const [rows, setRows] = useState<Row[]>([]);
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const typeItems = FIELD_TYPES.map((ft) => ({ id: ft, name: t(`fld.type.${ft}`) }));
  const catItems = [...new Set([t('layer.defaultCategory'), ...categories])].sort().map((c) => ({ id: c, name: c }));
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
        category: category.trim() || t('layer.defaultCategory'),
        year: f.get('year') ? Number(f.get('year')) : null,
        geomType: String(f.get('geomType')),
        style: { color },
        fields: toFields(rows),
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
          {/* Kategori: dropdown kategori yang sudah ada (layer dikelompokkan per kategori), tetap bisa diketik baru. */}
          <ComboBox allowsCustomValue inputValue={category} onInputChange={setCategory} menuTrigger="focus" defaultFilter={() => true}
            onSelectionChange={(k) => k !== null && setCategory(String(k))} className="flex flex-col gap-2">
            <Label>{t('layer.category')}</Label>
            <ComboBox.InputGroup>
              <Input required />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox items={catItems}>
                {(it: { id: string; name: string }) => <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>
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
        {/* Warna dasar: swatch yang belum dipakai layer lain, atau warna bebas (Hex/RGB/HSL/OKLCH). */}
        <ColorField id="layer-color" label={t('layer.color')} value={color} onChange={setColor} swatches={palette} />
        {/* Atribut: satu baris per field (label, tipe dari dropdown); tipe Pilihan = opsi diketik jadi chip, bukan teks berkoma. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="section-title mb-2">{t('layer.fields')}</legend>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-control border border-separator p-2">
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_auto] items-center gap-2">
                <Input aria-label={`${t('fld.label')} ${i + 1}`} placeholder={t('fld.label')} maxLength={80} value={r.label} className="w-full min-w-0"
                  onChange={(e) => patch(i, { label: e.target.value })} />
                <Pick hideLabel tall label={`${t('fld.type')} ${i + 1}`} value={r.type} items={typeItems} className="min-w-0"
                  onChange={(v) => patch(i, { type: v as Field['type'] })} />
                <Button isIconOnly variant="tertiary" size="sm" aria-label={t('layer.removeAttr', { n: i + 1 })} onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <TrashBin className="size-4" />
                </Button>
              </div>
              {r.type === 'select' && <TagInput label={`${t('fld.options')} ${i + 1}`} value={r.options} placeholder={t('fld.optionsHint')} onChange={(options) => patch(i, { options })} />}
            </div>
          ))}
          <div><Button variant="secondary" size="sm" onPress={() => setRows((rs) => [...rs, EMPTY])}><Plus className="size-4" /> {t('fld.add')}</Button></div>
        </fieldset>
        {save.error && <ErrorAlert message={save.error.message} />}
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isDisabled={save.isPending}>{t('layer.create')}</Button>
        </div>
      </form>
    </AppModal>
  );
}
