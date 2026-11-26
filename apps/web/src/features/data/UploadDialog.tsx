import { useMutation } from '@tanstack/react-query';
import { FileZipper } from '@gravity-ui/icons';
import { Alert, Button, Card, Label, ListBox, NumberField, ProgressBar, Select } from '@heroui/react';
import { useEffect, useId, useState } from 'react';
import { Map, MapGeoJSON, useMap } from '@/components/ui/map';
import { endpoints, type UploadSummary } from '@/lib/api';
import { fmt } from '@/lib/format';
import { KULON_PROGO_CENTER } from '@/lib/layer-style';
import type { Layer } from '@/lib/types';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { Segmented, SPRING } from '@/components/common/motion';
import { cn } from '@/lib/utils';
import { m } from 'motion/react';
import { success } from '@/lib/notify';
import { useT } from '@/lib/prefs';

type Props = { layer: Layer; onClose: () => void; onSaved: () => unknown };

/** Field yang server isi dari geometri bila kosong (sama dengan DERIVED di API). */
export const DERIVED = new Set(['kecamatan', 'kalurahan', 'kapanewon', 'panjang_km', 'luas_ha']);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Tebakan awal pemetaan: kolom berkas yang namanya sama dengan kunci atau label field (abaikan huruf besar & tanda baca). */
export const suggestMap = (fields: Layer['fields'], columns: string[]): Record<string, string> =>
  Object.fromEntries(fields.flatMap((f) => {
    const col = columns.find((c) => norm(c) === norm(f.key) || norm(c) === norm(f.label));
    return col ? [[f.key, col]] : [];
  }));

const NONE = '__none__';

/** Alur tiga langkah: pilih, periksa (dry run + pratinjau peta), lalu simpan. */
export function UploadDialog({ layer, onClose, onSaved }: Props) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  // Tahun keadaan data untuk semua fitur di berkas (kolom tahun_data); default tahun berjalan.
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState(false);
  const pick = (f?: File) => {
    setFile(f ?? null);
    setSummary(null);
  };

  const check = useMutation({
    mutationFn: (f: File) => endpoints.uploadShp(layer.slug, f, mode, true),
    onSuccess: (s) => { setSummary(s); setMap(suggestMap(layer.fields, s.columns)); },
  });
  const commit = useMutation({
    mutationFn: (f: File) => endpoints.uploadShp(layer.slug, f, mode, false, tahun, map),
    onSuccess: async (r) => {
      await onSaved();
      onClose();
      void success(t('up.doneTitle'), t('up.doneText', { n: fmt(r.count), name: layer.name }), t('common.ok'));
    },
  });
  const error = check.error ?? commit.error;

  return (
    <AppModal size="lg" dismissable={false} title={t('up.title')} description={t('up.desc', { name: layer.name })} onClose={onClose}
      footer={<>
        <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
        {summary ? (
          <Button isDisabled={commit.isPending} onPress={() => commit.mutate(file!)}>{commit.isPending ? t('common.saving') : t('up.save', { n: fmt(summary.count) })}</Button>
        ) : (
          <Button isDisabled={!file || check.isPending} onPress={() => check.mutate(file!)}>{check.isPending ? t('up.checking') : t('up.check')}</Button>
        )}
      </>}>

        <Stepper step={summary ? 2 : file ? 1 : 0} labels={[t('up.step1'), t('up.step2'), t('up.step3')]} label={t('up.steps')} />

        {/* Tiga bagian berjudul sama (Berkas, Pengaturan simpan, Hasil pemeriksaan): urutan baca mengikuti langkah di atas. */}
        <section aria-labelledby="upload-file" className="flex flex-col gap-3">
        <h3 id="upload-file" className="text-sm font-semibold text-heading">{t('up.fileSection')}</h3>
        <m.label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          animate={{ scale: drag ? 1.015 : 1 }}
          transition={SPRING}
          className={cn('flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed p-5 transition-colors', drag ? 'border-accent bg-accent/5' : file ? 'border-accent/40 bg-accent/5' : 'border-separator hover:border-field-border hover:bg-default/40')}
        >
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl transition-colors', file ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent')}>
            <FileZipper className="size-5" />
          </span>
          {/* Syarat berkas di bawah ajakan memilih (satu blok, bukan daftar terpisah di atas). */}
          <span className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-medium break-words text-heading">{file ? file.name : drag ? t('up.drop') : t('up.drag')}</span>
            <span className="text-xs text-muted">{file ? t('up.size', { size: fileSize(file.size) }) : t('up.orClick')}</span>
            {!file && <span className="text-xs text-muted">{[t('up.req.files'), t('up.req.size'), t('up.req.crs')].join(', ')}</span>}
          </span>
          <input type="file" accept=".zip,.geojson,.json,application/zip,application/geo+json,application/json" className="sr-only" aria-label={t('up.file')} onChange={(e) => pick(e.target.files?.[0])} />
        </m.label>
        </section>

        {/* Pengaturan simpan: dua kolom berlabel di atas + keterangan, gaya label sama dengan form lain (tanpa bingkai). */}
        <section aria-labelledby="upload-settings" className="flex flex-col gap-3">
        <h3 id="upload-settings" className="text-sm font-semibold text-heading">{t('up.settings')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="flex flex-col gap-2">
            <Label id="upload-mode-label">{t('up.mode')}</Label>
            <Segmented id="upload-mode" label={t('up.mode')} value={mode} onChange={(v) => { setMode(v); setSummary(null); }} className="w-full"
              options={[{ value: 'append', label: t('up.append') }, { value: 'replace', label: t('up.replace') }]} />
            <p className="text-xs text-muted">{t(mode === 'append' ? 'up.appendHint' : 'up.replaceHint', { n: fmt(layer.featureCount) })}</p>
          </div>
          <NumberField isRequired minValue={1900} maxValue={2100} value={tahun} onChange={(v) => Number.isFinite(v) && setTahun(v)}
            formatOptions={{ useGrouping: false }} className="flex flex-col gap-2">
            <Label htmlFor="upload-tahun">{t('data.tahunData')}</Label>
            <NumberField.Group><NumberField.Input id="upload-tahun" /></NumberField.Group>
            <p className="text-xs text-muted">{t('up.yearHint')}</p>
          </NumberField>
        </div>
        </section>

        {summary && (
          <section aria-labelledby="upload-result" className="flex flex-col gap-3">
            <h3 id="upload-result" className="text-sm font-semibold text-heading">{t('up.result')}</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label={t('up.valid')} value={fmt(summary.count)} />
              <Stat label={t('up.noGeom')} value={fmt(summary.skipped)} />
              <Stat label={t('up.columns')} value={fmt(summary.columns.length)} />
            </div>
            {(!summary.hasPrj || mode === 'replace') && (
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <ul className="flex flex-col gap-1 text-xs">
                    {!summary.hasPrj && <li>{t('up.noPrj')}</li>}
                    {mode === 'replace' && <li>{t('up.replaceWarn', { n: fmt(layer.featureCount) })}</li>}
                  </ul>
                </Alert.Content>
              </Alert>
            )}
            <ColumnMap fields={layer.fields} columns={summary.columns} sample={summary.sample} value={map} onChange={setMap} />
            {/* Kolom wajib tanpa pasangan: fitur tetap tersimpan, tapi isiannya kosong sampai dilengkapi di tabel Data. */}
            {layer.fields.some((f) => f.required && !map[f.key] && !DERIVED.has(f.key)) && (
              <p className="text-xs text-warning">{t('up.requiredEmpty', { cols: layer.fields.filter((f) => f.required && !map[f.key] && !DERIVED.has(f.key)).map((f) => f.label).join(', ') })}</p>
            )}
            {summary.sample && (
              <div className="h-60 overflow-hidden rounded-xl">
                <Map center={KULON_PROGO_CENTER} zoom={9.5}>
                  {layer.geomType === 'Point'
                    ? <SamplePoints data={summary.sample} color={layer.style.color} />
                    : <MapGeoJSON data={summary.sample} fillPaint={{ 'fill-color': layer.style.color, 'fill-opacity': 0.4 }} linePaint={{ 'line-color': layer.style.color, 'line-width': 2 }} />}
                </Map>
              </div>
            )}
          </section>
        )}

        {error && <ErrorAlert message={error.message} />}
    </AppModal>
  );
}

/** Pencocokan kolom: tiap field layer -> kolom berkas, dengan contoh nilai dari fitur pertama yang terisi. */
export function ColumnMap({ fields, columns, sample, value, onChange }: {
  fields: Layer['fields']; columns: string[]; sample?: GeoJSON.FeatureCollection;
  value: Record<string, string>; onChange: (m: Record<string, string>) => void;
}) {
  const t = useT();
  if (!fields.length) return null;
  const example = (col?: string) => {
    if (!col) return undefined;
    const v = sample?.features.map((f) => f.properties?.[col]).find((x) => x !== null && x !== undefined && x !== '');
    return v === undefined ? undefined : String(v);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-heading">{t('up.mapTitle')}</p>
        <p className="text-xs text-muted tabular-nums">{t('up.mapCount', { n: Object.keys(value).length, total: fields.length })}</p>
      </div>
      <div className="divide-y divide-separator overflow-hidden rounded-xl border border-separator">
        {fields.map((f) => {
          const col = value[f.key];
          const auto = !col && DERIVED.has(f.key);
          const items = [{ id: NONE, name: auto ? t('up.mapAuto') : t('up.mapNone') }, ...columns.map((c) => ({ id: c, name: c }))];
          const ex = example(col);
          return (
            <div key={f.key} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,12rem)_minmax(0,1fr)]">
              <span className="text-sm text-heading break-words">{f.label}{f.required && <span className="text-danger" aria-hidden> *</span>}</span>
              <Select aria-label={t('up.mapFor', { field: f.label })} selectedKey={col ?? NONE}
                onSelectionChange={(k) => {
                  const { [f.key]: _drop, ...rest } = value;
                  onChange(k === null || k === NONE ? rest : { ...rest, [f.key]: String(k) });
                }}>
                <Select.Trigger className={cn('min-h-9 text-sm', !col && 'text-muted')}>
                  <Select.Value className="truncate" />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox items={items}>
                    {(it: { id: string; name: string }) => (
                      <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>
                    )}
                  </ListBox>
                </Select.Popover>
              </Select>
              <span className={cn('truncate text-xs', ex ? 'text-foreground' : 'text-muted')} title={ex}>
                {ex ?? (auto ? t('up.mapAutoHint') : col ? t('up.mapEmpty') : '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <Card variant="secondary" className="gap-0.5 rounded-xl p-3">
    <p className="font-heading text-lg font-medium">{value}</p>
    <p className="text-xs text-muted">{label}</p>
  </Card>
);

function Stepper({ step, labels, label: name }: { step: number; labels: string[]; label: string }) {
  return (
    <ol className="relative grid grid-cols-3 gap-2" aria-label={name}>
      {labels.map((label, i) => (
        <li key={label} aria-current={i === step ? 'step' : undefined} className="flex flex-col gap-2">
          {/* Langkah selesai = penuh, langkah aktif = separuh, sisanya kosong. */}
          <ProgressBar aria-hidden value={i < step ? 100 : i === step ? 50 : 0} size="sm">
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <span className={cn('text-xs', i === step ? 'font-semibold text-heading' : i < step ? 'font-medium text-foreground' : 'text-muted')}>{i + 1}. {label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Ukuran berkas terbaca: < 1 MB ditulis dalam KB (bukan "0 MB"). */
const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${fmt(Math.max(1, Math.round(bytes / 1024)))} KB` : `${fmt(bytes / 1024 / 1024)} MB`);

/** Pratinjau layer titik: MapGeoJSON (mapcn) hanya menggambar isian & garis, jadi titik digambar sebagai lingkaran di sini. */
function SamplePoints({ data, color }: { data: GeoJSON.FeatureCollection; color: string }) {
  const { map, isLoaded } = useMap();
  const id = `sample-points-${useId()}`;
  useEffect(() => {
    if (!map || !isLoaded) return;
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id, type: 'circle', source: id, paint: { 'circle-radius': 5, 'circle-color': color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    return () => {
      // Layer/source bisa sudah hilang (peta dihancurkan atau gaya dimuat ulang): galat dibuang.
      try { map.removeLayer(id); map.removeSource(id); } catch { /* gaya peta sedang dimuat ulang */ }
    };
  }, [map, isLoaded, id, data, color]);
  return null;
}
