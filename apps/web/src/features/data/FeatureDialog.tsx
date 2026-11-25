import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRotateLeft, Check, Copy, Magnifier, Pencil, Picture, TrashBin } from '@gravity-ui/icons';
import { Button, buttonVariants, Input, Label, ListBox, NumberField, Select, TextArea } from '@heroui/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Map, MapGeoJSON, MapMarker, MarkerContent, useMap } from '@/components/ui/map';
import { endpoints } from '@/lib/api';
import { addVertex, type DrawProblem } from '@/lib/draw';
import { parseGeometryText, toWkt, WKT_EXAMPLE } from '@/lib/geometry';
import { KULON_PROGO_CENTER } from '@/lib/layer-style';
import type { Layer, MediaItem, MediaMeta, Props } from '@/lib/types';
import { hasDocs, URGENCIES, urgencyOf, type Urgency } from '@/lib/urgency';
import { useSettings } from '@/lib/settings';
import { AppModal } from '@/components/common/AppModal';
import { ErrorAlert } from '@/components/common/ErrorAlert';
import { Tip } from '@/components/common/Tip';
import { UrgencyBadge } from '@/components/common/UrgencyBadge';
import { featureLabel } from '@/components/map/MapOverlays';
import { fmtDateTime } from '@/lib/format';
import { confirmEdit, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import { cn } from '@/lib/utils';

type Point = [number, number];

/** Klik peta untuk menaruh titik. `crosshair`: kursor silang (mode gambar), agar jelas klik menambah titik sudut. */
export function ClickToPlace({ onPick, crosshair }: { onPick: (p: Point) => void; crosshair?: boolean }) {
  const { map } = useMap();
  useEffect(() => {
    if (!map) return;
    const handler = (e: { lngLat: { lng: number; lat: number } }) => onPick([+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)]);
    map.on('click', handler);
    if (crosshair) map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', handler);
      if (crosshair) map.getCanvas().style.cursor = '';
    };
  }, [map, onPick, crosshair]);
  return null;
}

/**
 * Titik sudut gambar -> WKT. Garis butuh >= 2 titik, poligon >= 3 (cincin ditutup otomatis); kurang dari itu kosong
 * (penanda sudut tetap tampil, teks WKT belum diisi).
 */
export const drawnWkt = (pts: Point[], geom: 'LineString' | 'Polygon'): string =>
  geom === 'LineString'
    ? pts.length >= 2 ? toWkt({ type: 'LineString', coordinates: pts }) : ''
    : pts.length >= 3 ? toWkt({ type: 'Polygon', coordinates: [[...pts, pts[0]!]] }) : '';

/** Geser peta ke titik bila titik (mis. koordinat yang ditempel) berada di luar tampilan. */
function FollowPoint({ p }: { p: Point | null }) {
  const { map } = useMap();
  useEffect(() => {
    if (map && p && !map.getBounds().contains(p)) map.easeTo({ center: p });
  }, [map, p?.[0], p?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Posisi pertama geometri (pusat pratinjau / penanda titik). Geometri sudah divalidasi: selalu punya koordinat. */
const firstPosition = (g: GeoJSON.Geometry): Point => {
  let c = (g as GeoJSON.Point).coordinates as unknown;
  while (Array.isArray((c as unknown[])[0])) c = (c as unknown[])[0];
  return c as Point;
};

/** Foto yang belum diunggah (fitur baru / ditambahkan sebelum simpan): diunggah setelah fitur tersimpan. */
type Queued = { key: string; file: File; url: string } & MediaMeta;

/** Tanggal lokal (WIB di perangkat pengguna), bukan UTC: toISOString() memberi tanggal kemarin sebelum pukul 07.00. */
const today = () => new Date().toLocaleDateString('en-CA');

type DialogProps = {
  layer: Layer; featureId: string | null; readOnly: boolean; onClose: () => void; onSaved: () => unknown;
  /** Fitur baru: geometri awal WKT (hasil alat gambar halaman Peta). */
  draftWkt?: string;
};

export function FeatureDialog({ layer, featureId, readOnly, onClose, onSaved, draftWkt }: DialogProps) {
  const t = useT();
  const qc = useQueryClient();
  const isNew = featureId === null;
  const feature = useQuery({ queryKey: ['feature', featureId], queryFn: () => endpoints.feature(featureId!), enabled: !isNew });
  const current = feature.data;

  // Geometri diedit sebagai WKT (Terraformer); GeoJSON juga diterima. Teks awal = geometri tersimpan.
  const initialWkt = useMemo(() => (current?.geometry ? toWkt(current.geometry) : draftWkt ?? ''),
    [current?.geometry]); // eslint-disable-line react-hooks/exhaustive-deps -- geometri awal hanya dibaca sekali
  const [geomText, setGeomText] = useState<string | null>(null);
  const text = geomText ?? initialWkt;
  const parsed = useMemo(() => parseGeometryText(text, layer.geomType), [text, layer.geomType]);
  const shown = parsed.ok ? parsed.geometry : current?.geometry ?? null;
  const shownPoint = shown && layer.geomType === 'Point' ? firstPosition(shown) : null;
  const center = shown ? firstPosition(shown) : null;
  // Mode gambar (garis/poligon): tiap klik peta menambah titik sudut; null = tidak sedang menggambar.
  const [draft, setDraft] = useState<Point[] | null>(null);
  const drawable = !readOnly && layer.geomType !== 'Point';
  const preview = draft ? (parsed.ok ? parsed.geometry : null) : shown;
  // Titik yang membuat gambar memotong dirinya ditolak (pesan di toolbar); klik ulang titik terakhir/pertama = selesai.
  const [problem, setProblem] = useState<DrawProblem | null>(null);
  const pick = (p: Point) => {
    const r = addVertex(draft!, p, layer.geomType as 'LineString' | 'Polygon');
    setProblem(r.problem ?? null);
    if (r.done) setDraft(null);
    else if (!r.problem) draw(r.pts);
  };
  const draw = (pts: Point[]) => {
    setProblem(null);
    setDraft(pts);
    setGeomText(drawnWkt(pts, layer.geomType as 'LineString' | 'Polygon'));
  };

  // Urgensi fitur dihitung langsung dari field `kondisi` yang sedang dipilih di form; layer statis (tanpa kondisi) tanpa dokumentasi.
  const docs = hasDocs(layer);
  const [kondisi, setKondisi] = useState<string | null | undefined>(undefined);
  const kondisiNow = kondisi === undefined ? (current?.properties.kondisi ?? null) : kondisi;
  // Hanya layer berkondisi: urgensi di form ini menentukan wajib-foto, padahal layer lain tak punya dokumentasi.
  const rules = useSettings().data?.urgensi;
  const urgency = docs ? urgencyOf(layer, { ...current?.properties, kondisi: kondisiNow, urgensi: current?.properties.urgensi ?? null }, rules) : null;

  const [queued, setQueued] = useState<Queued[]>([]);
  // Ref, bukan `queued` langsung: cleanup [] menangkap nilai awal (kosong) sehingga URL blob foto antrean tak pernah dilepas.
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  useEffect(() => () => queuedRef.current.forEach((q) => URL.revokeObjectURL(q.url)), []);
  const photoCount = (current?.media.length ?? 0) + queued.length;

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const properties: Props = {};
      for (const f of layer.fields) {
        // Field tanpa input (mis. kondisi ruas SK yang terkunci) tidak dikirim, bukan dikirim sebagai teks "null".
        if (!form.has(f.key)) continue;
        const raw = String(form.get(f.key)).trim();
        properties[f.key] = raw === '' ? null : f.type === 'number' ? Number(raw) : raw;
      }
      // Geometri dikirim hanya bila diisi/diubah; teks tak valid ditolak dengan alasan yang jelas.
      const changed = text.trim() !== initialWkt.trim();
      if (isNew || changed) {
        if (!parsed.ok) throw new Error(t(`feat.geomErr.${parsed.reason}`, { type: layer.geomType }));
      }
      if (urgency === 'tinggi' && photoCount === 0) throw new Error(t('doc.required'));
      const geometry = (isNew || changed) && parsed.ok ? parsed.geometry : undefined;
      const tahunData = Number(form.get('tahun_data')); // isian wajib (isRequired, 1900–2100): selalu terisi saat simpan
      const saved = isNew
        ? await endpoints.createFeature(layer.slug, { properties, geometry, tahunData })
        : await endpoints.updateFeature(featureId, { properties, ...(geometry && { geometry }), tahunData, updatedAt: current!.updatedAt });
      // Foto antrean diunggah berurutan setelah fitur punya id. Fitur sudah tersimpan: foto yang gagal hanya dilaporkan,
      // bukan galat mutasi (dialog tetap mode "baru" lalu Simpan ulang akan membuat fitur duplikat).
      // Swal menampilkan satu popup sekaligus: kegagalan dikumpulkan lalu dilaporkan sekali di onSuccess (tak tertimpa toast sukses).
      const failed: string[] = [];
      for (const q of queued) {
        await endpoints.uploadMedia(saved.id, q.file, { caption: q.caption, tanggal: q.tanggal, urgensi: q.urgensi })
          .catch((e: Error) => failed.push(`${q.file.name}: ${e.message}`));
      }
      return failed;
    },
    onSuccess: async (failed) => {
      if (failed.length) toastError(failed.join('; '));
      else toast(isNew ? t('feat.added') : t('feat.saved'));
      await onSaved();
      onClose();
    },
  });

  const refreshFeature = () => qc.invalidateQueries({ queryKey: ['feature', featureId] });
  const updateMeta = useMutation({
    mutationFn: ({ id, meta }: { id: number; meta: MediaMeta }) => endpoints.updateMedia(id, meta),
    onSuccess: refreshFeature,
    onError: (e) => toastError(e.message),
  });
  // Konfirmasi hapus foto dibuat inline (dua klik) agar tidak menumpuk AlertDialog di atas modal ini.
  const [armed, setArmed] = useState<number | null>(null);
  const removeMedia = useMutation({
    mutationFn: endpoints.deleteMedia,
    onSuccess: () => {
      setArmed(null);
      toast(t('feat.photoDeleted'));
      return refreshFeature();
    },
    onError: (e) => toastError(e.message),
  });
  // Fitur yang sudah ada: foto langsung diunggah (dengan urgensi awal dari kondisi); fitur baru: diantrikan.
  const media = useMutation({
    mutationFn: (file: File) => endpoints.uploadMedia(featureId!, file, { tanggal: today(), urgensi: urgency }),
    onSuccess: () => {
      toast(t('feat.photoAdded'));
      return refreshFeature();
    },
    onError: (e) => toastError(e.message),
  });
  const addFiles = (files: FileList) => {
    for (const file of files) {
      if (isNew) setQueued((q) => [...q, { key: `${file.name}-${file.lastModified}-${q.length}`, file, url: URL.createObjectURL(file), caption: null, tanggal: today(), urgensi: urgency }]);
      else media.mutate(file);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    // Ubah data yang sudah ada: tanya Ya/Tidak dulu; tambah baru langsung disimpan.
    if (!isNew && !(await confirmEdit({
      title: t('confirm.editTitle'), text: t('confirm.editText'), confirm: t('confirm.yesSave'), cancel: t('confirm.no'),
      subject: current ? featureLabel(current.properties, layer, featureId) : undefined,
      target: form.closest<HTMLElement>('[role="dialog"]'),
    }))) return;
    save.mutate(new FormData(form));
  };

  // ponytail: clipboard hanya ada di konteks aman (https/localhost); di http tombol diam saja.
  const copyGeojson = (g: GeoJSON.Geometry) => void navigator.clipboard?.writeText(JSON.stringify(g)).then(() => toast(t('feat.copied')));

  return (
    <AppModal size="lg" dismissable={readOnly} onClose={onClose} title={isNew ? t('feat.addTitle', { name: layer.name }) : t(readOnly ? 'feat.viewTitle' : 'feat.editTitle', { id: featureId })} description={layer.name}>

        {!isNew && feature.isPending ? (
          <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <fieldset disabled={readOnly} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {layer.fields.map((f) => {
                const value = current?.properties[f.key];
                const def = value === null || value === undefined ? '' : String(value);
                // Select/NumberField HeroUI menambah tanda * sendiri bila isRequired; teks biasa diberi tanda manual.
                const label = <Label htmlFor={f.key}>{f.label}{f.required && f.type === 'text' && <span className="text-accent"> *</span>}</Label>;
                // Kondisi ruas SK dihitung dari tabel survei (API ruas_props): tampil terkunci, tidak diisi tangan.
                const derived = layer.slug === 'jalan-kabupaten' && f.key === 'kondisi';
                if (f.type === 'select') return (
                  <Select key={f.key} name={derived ? undefined : f.key} isRequired={f.required} isDisabled={readOnly || derived} defaultSelectedKey={def || null} placeholder={t('feat.choose')} className="flex flex-col gap-2"
                    onSelectionChange={f.key === 'kondisi' ? (k) => setKondisi(k === null ? null : String(k)) : undefined}>
                    {label}
                    <Select.Trigger id={f.key}><Select.Value />{!f.required && !readOnly && <Select.ClearButton />}<Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>{f.options?.map((o) => <ListBox.Item key={o} id={o} textValue={o}>{o}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox>
                    </Select.Popover>
                  </Select>
                );
                if (f.type === 'number') return (
                  <NumberField key={f.key} name={f.key} isRequired={f.required} isDisabled={readOnly} defaultValue={def === '' ? undefined : Number(def)} formatOptions={{ useGrouping: false, maximumFractionDigits: 7 }} className="flex flex-col gap-2">
                    {label}
                    <NumberField.Group><NumberField.Input id={f.key} /></NumberField.Group>
                  </NumberField>
                );
                // ponytail: kolom `catatan` (catatan rencana) = teks panjang menurut nama field; tipe field khusus bila layer lain butuh.
                if (f.key === 'catatan') return (
                  <div key={f.key} className="flex flex-col gap-2 sm:col-span-2">
                    {label}
                    <TextArea id={f.key} name={f.key} required={f.required} defaultValue={def} rows={5} className="min-h-28 resize-y" />
                  </div>
                );
                return (
                  <div key={f.key} className="flex flex-col gap-2">
                    {label}
                    <Input id={f.key} name={f.key} required={f.required} defaultValue={def} />
                  </div>
                );
              })}
              {/* Tahun keadaan data: wajib, otomatis tahun berjalan untuk data baru. */}
              <NumberField name="tahun_data" isRequired isDisabled={readOnly} minValue={1900} maxValue={2100} defaultValue={current?.tahunData ?? new Date().getFullYear()}
                formatOptions={{ useGrouping: false }} className="flex flex-col gap-2">
                <Label htmlFor="tahun_data">{t('data.tahunData')}</Label>
                <NumberField.Group><NumberField.Input id="tahun_data" /></NumberField.Group>
              </NumberField>
            </fieldset>
            {current && (
              <p className="-mt-2 text-xs text-muted">
                {t('feat.updatedBy', { date: fmtDateTime(current.updatedAt), name: current.updatedByName ?? '—' })}
              </p>
            )}

            {current && Object.keys(current.properties).some((k) => !layer.fields.some((f) => f.key === k)) && (
              <details className="rounded bg-default px-4 py-2 text-xs">
                <summary className="cursor-pointer font-medium">{t('feat.extra')}</summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  {Object.entries(current.properties).filter(([k]) => !layer.fields.some((f) => f.key === k)).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{String(v ?? '–')}</dd></div>
                  ))}
                </dl>
              </details>
            )}

            {/* Lokasi: pratinjau peta mengikuti teks WKT yang valid; titik juga bisa ditaruh dengan klik peta. */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="geom-wkt">{t('feat.location')}</Label>
                <div className="flex gap-1">
                  {/* Pencarian dibuka di browser pengguna; aplikasi tidak mengambil data dari layanan peta pihak ketiga. */}
                  {!readOnly && layer.geomType === 'Point' && typeof current?.properties.nama === 'string' && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${current.properties.nama}, Kulon Progo`)}`}
                      target="_blank" rel="noopener noreferrer" title={t('feat.findPlaceHint')} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
                      <Magnifier className="size-4" />{t('feat.findPlace')}
                    </a>
                  )}
                  {parsed.ok && (
                    <Button size="sm" variant="ghost" onPress={() => copyGeojson(parsed.geometry)}><Copy className="size-4" />{t('feat.copyGeojson')}</Button>
                  )}
                </div>
              </div>
              {drawable && (
                // Alat gambar: mulai = geometri lama diganti gambar baru; batalkan = hapus titik terakhir; selesai = kunci.
                <div role="toolbar" aria-label={t('draw.tools')} className="flex flex-wrap items-center gap-2">
                  {draft === null ? (
                    <Button size="sm" variant="secondary" onPress={() => draw([])}><Pencil className="size-4" />{t(layer.geomType === 'Polygon' ? 'draw.polygon' : 'draw.line')}</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" isDisabled={!draft.length} onPress={() => draw(draft.slice(0, -1))}><ArrowRotateLeft className="size-4" />{t('draw.undo')}</Button>
                      <Button size="sm" variant="secondary" isDisabled={!draft.length} onPress={() => draw([])}><TrashBin className="size-4" />{t('draw.clear')}</Button>
                      <Button size="sm" onPress={() => setDraft(null)}><Check className="size-4" />{t('draw.done')}</Button>
                      <span aria-live="polite" className={cn('text-xs tabular-nums', problem ? 'text-danger' : 'text-muted')}>
                        {problem ? t(`draw.${problem}`) : t(layer.geomType === 'Polygon' ? 'draw.hintPolygon' : 'draw.hintLine', { n: draft.length })}
                      </span>
                    </>
                  )}
                </div>
              )}
              <div className={cn('overflow-hidden rounded', drawable ? 'h-72' : 'h-56')}>
                {/* Kunci tetap selama menggambar: peta tidak dipasang ulang (dan tidak melompat) tiap titik ditambah. */}
                <Map key={draft ? 'draw' : center ? 'at' : 'all'} center={center ?? KULON_PROGO_CENTER} zoom={center ? (layer.geomType === 'Point' ? 15 : 13) : 10}>
                  {!readOnly && layer.geomType === 'Point' && <ClickToPlace onPick={(p) => setGeomText(`POINT (${p[0]} ${p[1]})`)} />}
                  {draft && (
                    <>
                      <ClickToPlace crosshair onPick={pick} />
                      {draft.map((p, i) => (
                        <MapMarker key={`${i}-${p[0]}-${p[1]}`} longitude={p[0]} latitude={p[1]}>
                          <MarkerContent><span className="block size-2.5 rounded-full border-2 border-white shadow" style={{ backgroundColor: layer.style.color }} /></MarkerContent>
                        </MapMarker>
                      ))}
                    </>
                  )}
                  <FollowPoint p={shownPoint} />
                  {shownPoint && (
                    <MapMarker longitude={shownPoint[0]} latitude={shownPoint[1]}>
                      <MarkerContent><span className="block size-4 rounded-full border-2 border-white bg-accent shadow" /></MarkerContent>
                    </MapMarker>
                  )}
                  {/* Saat menggambar hanya gambar baru yang tampil (bukan geometri lama yang akan diganti). */}
                  {preview && layer.geomType !== 'Point' && (
                    <MapGeoJSON key={text} data={{ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: preview }] }}
                      fillPaint={{ 'fill-color': layer.style.color, 'fill-opacity': layer.geomType === 'Polygon' ? 0.4 : 0 }} linePaint={{ 'line-color': layer.style.color, 'line-width': 3 }} />
                  )}
                </Map>
              </div>
              <TextArea id="geom-wkt" value={text} onChange={(e) => setGeomText(e.target.value)} readOnly={readOnly}
                onBlur={() => parsed.ok && /^-?\d/.test(text.trim()) && setGeomText(toWkt(parsed.geometry))} rows={3} spellCheck={false}
                aria-label={t('feat.geom')} aria-invalid={!!text.trim() && !parsed.ok}
                placeholder={WKT_EXAMPLE[layer.geomType]} className="font-mono text-xs" />
              <p className={cn('text-xs', text.trim() && !parsed.ok ? 'text-danger' : 'text-muted')}>
                {text.trim() && !parsed.ok
                  ? t(`feat.geomErr.${parsed.reason}`, { type: layer.geomType })
                  : layer.geomType === 'Point' && !readOnly ? t('feat.geomHintPoint') : drawable ? t('draw.hint') : t('feat.geomHint')}
              </p>
            </section>

            {/* Dokumentasi: urgensi fitur dari kondisi; foto wajib bila urgensi tinggi. Tiap foto punya keterangan, tanggal, urgensi. */}
            {docs && <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Label>{t('doc.title')}</Label>
                {urgency && <UrgencyBadge value={urgency} />}
              </div>
              {!readOnly && urgency === 'tinggi' && photoCount === 0 && <p role="alert" className="text-xs text-danger">{t('doc.required')}</p>}
              {!readOnly && urgency === 'sedang' && photoCount === 0 && <p className="text-xs text-warning">{t('doc.suggested')}</p>}
              <ul className="flex flex-col gap-3">
                {current?.media.map((m) => (
                  <MediaRow key={m.id} img={<Photo m={m} />} meta={m} readOnly={readOnly}
                    onChange={(meta) => updateMeta.mutate({ id: m.id, meta })}
                    remove={!readOnly && (armed === m.id ? (
                      <Button size="sm" variant="danger" onPress={() => removeMedia.mutate(m.id)} onBlur={() => setArmed(null)} autoFocus>
                        {t('feat.photoConfirm')}
                      </Button>
                    ) : (
                      <Tip label={t('feat.photoDelete')}>
                        <Button isIconOnly size="sm" variant="ghost" onPress={() => setArmed(m.id)} aria-label={t('feat.photoDelete')} className="text-danger">
                          <TrashBin className="size-4" />
                        </Button>
                      </Tip>
                    ))} />
                ))}
                {queued.map((q) => (
                  <MediaRow key={q.key} img={<img src={q.url} alt="" className="size-full object-cover" />} meta={q} note={t('doc.queued')}
                    onChange={(meta) => setQueued((all) => all.map((x) => (x.key === q.key ? { ...x, ...meta } : x)))}
                    remove={
                      <Button isIconOnly size="sm" variant="ghost" aria-label={t('feat.photoDelete')} className="text-danger"
                        onPress={() => { URL.revokeObjectURL(q.url); setQueued((all) => all.filter((x) => x.key !== q.key)); }}>
                        <TrashBin className="size-4" />
                      </Button>
                    } />
                ))}
              </ul>
              {!readOnly && (
                <label className="flex cursor-pointer items-center gap-3 rounded-control border-2 border-dashed border-foreground/10 p-3 text-sm text-muted transition hover:border-accent hover:text-accent">
                  <Picture className="size-5 shrink-0" />
                  <span>{t('feat.photoUpload')}<span className="block text-xs">{t('feat.photoHint')}</span></span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files!); e.target.value = ''; }} />
                </label>
              )}
              {readOnly && !photoCount && <p className="text-xs text-muted">{t('doc.none')}</p>}
            </section>}

            {save.error && save.error.message !== t('doc.required') && <ErrorAlert message={save.error.message} />}
            <div className="flex justify-end gap-2">
              <Button variant="tertiary" onPress={onClose}>{readOnly ? t('common.close') : t('common.cancel')}</Button>
              {!readOnly && <Button type="submit" isDisabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>}
            </div>
          </form>
        )}
    </AppModal>
  );
}

const Photo = ({ m }: { m: MediaItem }) => (
  <picture>
    <source srcSet={`/uploads/${m.avif}`} type="image/avif" />
    <img src={`/uploads/${m.webp}`} alt={m.caption ?? ''} width={m.width} height={m.height} loading="lazy" decoding="async" className="size-full object-cover" />
  </picture>
);

/** Satu foto dokumentasi: gambar + keterangan, tanggal survei, urgensi (disimpan saat field ditinggalkan / diubah). */
function MediaRow({ img, meta, readOnly, note, onChange, remove }: {
  img: React.ReactNode; meta: MediaMeta; readOnly?: boolean; note?: string; onChange: (m: MediaMeta) => void; remove?: React.ReactNode;
}) {
  const t = useT();
  const set = (patch: Partial<MediaMeta>) => onChange({ caption: meta.caption, tanggal: meta.tanggal, urgensi: meta.urgensi, ...patch });
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-control border border-border p-2">
      <div className="size-[5.5rem] overflow-hidden rounded-md bg-default">{img}</div>
      <div className="flex min-w-0 flex-col gap-2">
        <Input aria-label={t('doc.caption')} placeholder={t('doc.caption')} defaultValue={meta.caption ?? ''} readOnly={readOnly}
          onBlur={(e) => e.target.value.trim() !== (meta.caption ?? '') && set({ caption: e.target.value.trim() || null })} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label={t('doc.date')} value={meta.tanggal ?? ''} readOnly={readOnly} max={today()}
            onChange={(e) => set({ tanggal: e.target.value || null })}
            className="input h-10 rounded-control border border-field-border bg-field-background px-3 text-sm" />
          <Select aria-label={t('doc.urgency')} selectedKey={meta.urgensi} isDisabled={readOnly} placeholder={t('doc.urgency')} className="w-36"
            onSelectionChange={(k) => set({ urgensi: k as Urgency })}>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>{URGENCIES.map((u) => <ListBox.Item key={u} id={u} textValue={t(`urg.${u}`)}>{t(`urg.${u}`)}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox>
            </Select.Popover>
          </Select>
          {remove && <span className="ml-auto">{remove}</span>}
        </div>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
    </li>
  );
}
