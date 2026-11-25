import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, Eye, Layers, Pencil, Plus, TrashBin } from '@gravity-ui/icons';
import { Button, Card, Checkbox, Chip, Dropdown, Header, Kbd, Label, ListBox, SearchField, Select, Table, type Selection, type SortDescriptor } from '@heroui/react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { SPRING } from '@/components/common/motion';
import { featureLabel } from '@/components/map/MapOverlays';
import { KecamatanSelect } from '@/components/common/KecamatanSelect';
import { Pagination } from '@/components/common/Pagination';
import { Tip } from '@/components/common/Tip';
import { canEdit, useMe } from '@/hooks/use-auth';
import { endpoints, refreshData } from '@/lib/api';
import { sentenceCase } from '@/lib/utils';
import { fmt, fmtDateTime } from '@/lib/format';
import { confirmDanger, toast, toastError } from '@/lib/notify';
import { useT } from '@/lib/prefs';
import type { Feature, Layer } from '@/lib/types';
import { hasDocs, urgencyOf } from '@/lib/urgency';
import { useSettings } from '@/lib/settings';
import { UrgencyBadge } from '@/components/common/UrgencyBadge';
import { DecisionDialog } from './DecisionDialog';
import { FeatureDialog } from './FeatureDialog';
import { LayerDialog } from './LayerDialog';
import { UploadDialog } from './UploadDialog';
import { RUAS_SLUG, RuasTable } from './RuasTable';
import { TrashTable } from './TrashTable';

export default function DataPage() {
  const t = useT();
  // ponytail: default ke layer kondisi jalan terbaru (paling sering diedit); naikkan tahunnya saat seri 2027 diimpor.
  const { slug = 'jalan-kabupaten' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const editor = canEdit(me);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [q, setQ] = useState('');
  // Debounce 250 ms (pola GlobalSearch): satu permintaan setelah berhenti mengetik, bukan per huruf.
  const [query, setQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  // Urutan dari header kolom (klik = naik, klik lagi = turun). Kunci = kolom tetap (id, tahun_data, updated_at) atau atribut.
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);
  const kec = params.get('kec') ?? undefined;
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<null | 'upload' | 'layer'>(null);
  // Aktif = data yang tampil di peta/Ringkasan; Terhapus = tempat sampah (soft delete) layer ini, hanya untuk editor.
  const [view, setView] = useState<'active' | 'trash'>('active');

  const layers = useQuery({ queryKey: ['layers'], queryFn: endpoints.layers });
  const layer = layers.data?.find((l) => l.slug === slug);
  const list = useQuery({
    queryKey: ['features', slug, page, limit, query, kec, sort],
    queryFn: () => endpoints.features(slug, { page, limit, q: query, kecamatan: kec, ...(sort && { sort: sort.key, order: sort.order }) }),
    placeholderData: keepPreviousData,
    enabled: Boolean(layer),
  });

  const editId = params.get('edit');
  // Ubah satu parameter URL tanpa menghapus yang lain (mis. filter kecamatan tetap saat dialog dibuka).
  const setParam = (key: string, value?: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  const setEdit = (id: string | null) => setParam('edit', id);
  const setKec = (k?: string) => { setPage(1); setChecked(new Set()); setParam('kec', k); };

  const refresh = () => {
    setChecked(new Set());
    // ['feature', id] juga: tanpa ini membuka ulang fitur < 60 dtk setelah simpan menampilkan nilai lama, dan simpan lagi menimpanya.
    // Ringkasan (statistik, deret waktu, ruas) ikut: refreshData membuat semua query data basi.
    // 'alerts': keputusan baru langsung mengurangi angka lonceng peringatan di header.
    return refreshData(qc, ['features', 'feature', 'layers', 'alerts']);
  };

  const remove = useMutation({
    mutationFn: (ids: number[]) => endpoints.bulkDelete(slug, ids),
    onSuccess: async (_r, ids) => {
      toast(t('data.trashed', { n: ids.length }));
      await refresh();
    },
    onError: (e) => toastError(e.message),
  });

  const confirmDelete = async (ids: number[]) => {
    const one = ids.length === 1 ? rows.find((r) => Number(r.id) === ids[0]) : undefined;
    const ok = await confirmDanger({
      title: t('data.confirmTitle', { n: ids.length }), text: t('data.confirmSoft'), confirm: t('confirm.yesDelete'), cancel: t('confirm.no'),
      subject: one && layer ? featureLabel(one.properties, layer, one.id) : undefined,
    });
    if (ok) remove.mutate(ids);
  };

  const docs = !!layer && hasDocs(layer);
  // Kolom keputusan untuk semua layer (catatan keputusan universal); dokumentasi foto hanya layer berkondisi (`docs`).
  const columns = layer ? (layer.fields.length ? layer.fields.slice(0, 4).map((f) => ({ key: f.key, label: f.label })) : Object.keys(list.data?.data[0]?.properties ?? {}).slice(0, 4).map((k) => ({ key: k, label: k }))) : [];
  const writable = editor && layer && !layer.sourceLayerId;
  // `?keputusan=<id>` (dari lonceng peringatan): buka notulensi & keputusan fitur itu, di halaman tabel mana pun ia berada.
  const decisionId = params.get('keputusan');
  const decision = useQuery({ queryKey: ['feature', decisionId], queryFn: () => endpoints.feature(decisionId!), enabled: Boolean(decisionId && writable) });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / limit));

  const rows = list.data?.data ?? [];
  const onSelect = (keys: Selection) => setChecked(new Set(keys === 'all' ? rows.map((r) => Number(r.id)) : [...keys].map(Number)));
  const sortDescriptor: SortDescriptor | undefined = sort ? { column: sort.key, direction: sort.order === 'asc' ? 'ascending' : 'descending' } : undefined;
  const onSort = (d: SortDescriptor) => {
    setPage(1);
    setChecked(new Set());
    setSort({ key: String(d.column), order: d.direction === 'descending' ? 'desc' : 'asc' });
  };
  /** Kolom yang bisa diurutkan dari header; judul tidak dipatah agar tidak menumpuk/terpotong. */
  const sortable = (id: string, label: ReactNode, extra?: { isRowHeader?: boolean }) => (
    <Table.Column key={id} id={id} allowsSorting className="whitespace-nowrap" {...extra}>
      {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>{label}</Table.SortableColumnHeader>}
    </Table.Column>
  );
  // Pintasan "/" memfokuskan pencarian (ditampilkan sebagai Kbd di kolom cari).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Pemilih data: layer peta (dikelompokkan per kategori) lalu tabel non-spasial (rekap ruas jalan).
  const picker = (
    <Select aria-label={t('data.pickLayer')} selectedKey={slug} className="w-full sm:w-80"
      onSelectionChange={(s) => { setPage(1); setChecked(new Set()); navigate(`/data/${String(s)}${kec ? `?kec=${encodeURIComponent(kec)}` : ''}`); }}>
      <Select.Trigger className="text-sm font-medium">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Section>
            <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('data.groupLayers')}</Header>
            {(layers.data ?? []).map((l) => <ListBox.Item key={l.slug} id={l.slug} textValue={l.name}>{l.name}<ListBox.ItemIndicator /></ListBox.Item>)}
          </ListBox.Section>
          <ListBox.Section>
            <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('data.groupTables')}</Header>
            <ListBox.Item id={RUAS_SLUG} textValue={t('table.ruasTitle')}>{t('table.ruasTitle')}<ListBox.ItemIndicator /></ListBox.Item>
          </ListBox.Section>
        </ListBox>
      </Select.Popover>
    </Select>
  );
  if (slug === RUAS_SLUG) return <RuasTable picker={picker} />;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4 p-6">
        {/* Baris 1: pemilih layer + aksi; baris 2: keterangan layer berlabel (tidak berdesakan di antara keduanya). */}
        <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            {picker}
          </div>
          <div className="flex flex-wrap gap-2">
            {writable && (
              <>
                <Button onPress={() => setEdit('new')}><Plus className="size-4" /> {t('data.add')}</Button>
                <Button variant="secondary" onPress={() => setDialog('upload')}><ArrowUpFromLine className="size-4" /> {t('data.upload')}</Button>
              </>
            )}
            <Dropdown>
              <Button variant="secondary"><ArrowDownToLine className="size-4" /> {t('data.export')}</Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label={t('data.export')}>
                  <Dropdown.Item id="geojson" href={endpoints.exportUrl(slug, 'geojson', kec)} download textValue="GeoJSON"><Label>GeoJSON</Label></Dropdown.Item>
                  <Dropdown.Item id="csv" href={endpoints.exportUrl(slug, 'csv', kec)} download textValue="CSV (Excel)"><Label>CSV (Excel)</Label></Dropdown.Item>
                  <Dropdown.Item id="shp" href={endpoints.exportUrl(slug, 'shp', kec)} download textValue="Shapefile (SHP)"><Label>Shapefile (SHP, .zip)</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            {editor && <Button variant="secondary" onPress={() => setDialog('layer')}><Layers className="size-4" /> {t('data.newLayer')}</Button>}
          </div>
        </div>
        {layer && <LayerMeta layer={layer} />}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Pencarian dan filter kecamatan dipakai kedua tab (Aktif & Terhapus). */}
          <SearchField aria-label={t('data.search')} value={q} onChange={(v) => { setQ(v); setPage(1); setChecked(new Set()); }} className="w-full sm:w-80">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input ref={searchRef} placeholder={t('data.search')} />
              {q ? <SearchField.ClearButton /> : <Kbd className="mr-2 hidden sm:inline-flex">/</Kbd>}
            </SearchField.Group>
          </SearchField>
          <KecamatanSelect value={kec} onChange={setKec} className="w-full sm:w-60" />
          {writable && (
            // Aktif | Terhapus di ujung kanan baris filter: satu baris kontrol, bukan baris sendiri.
            <div role="radiogroup" aria-label={t('trash.view')} className="flex h-10 w-fit shrink-0 items-center rounded-lg bg-default p-0.5 sm:ml-auto">
              {([['active', t('trash.active')], ['trash', t('trash.tab')]] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={view === id} onClick={() => { setView(id); setChecked(new Set()); }}
                  className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-sm ${view === id ? 'bg-surface font-medium text-heading shadow-sm' : 'text-muted hover:text-heading'}`}>
                  {id === 'trash' ? <TrashBin className="size-3.5" aria-hidden /> : <CircleCheck className="size-3.5" aria-hidden />}{label}
                </button>
              ))}
            </div>
          )}
        </div>
        {writable && view === 'trash' && layer ? <TrashTable key={`${query}|${kec ?? ''}`} layer={layer} q={query} kec={kec} /> : (<>
        <Table className={`data-table transition-opacity duration-200 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
          <Table.ScrollContainer>
            <Table.Content aria-label={layer?.name ?? t('nav.data')} className="min-w-[640px]"
              selectionMode={writable ? 'multiple' : 'none'} selectedKeys={new Set([...checked].map(String))} onSelectionChange={onSelect}
              sortDescriptor={sortDescriptor} onSortChange={onSort}>
              <Table.Header>
                {[
                  ...(writable ? [<Table.Column key="sel" className="w-14"><Checkbox aria-label={t('data.selectAll')} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Column>] : []),
                  sortable('id', 'ID', { isRowHeader: true }),
                  ...columns.map((c) => sortable(c.key, c.label)),
                  // Kolom dokumentasi hanya untuk layer berkondisi (Kondisi Jalan, PJU, Utilitas); data statis tidak.
                  ...(layer ? [<Table.Column key="docs" className="whitespace-nowrap">{t(docs ? 'doc.title' : 'decision.label')}</Table.Column>] : []),
                  sortable('tahun_data', t('data.tahunData')),
                  sortable('updated_at', t('data.updated')),
                  <Table.Column key="act" className="whitespace-nowrap">{t('data.actions')}</Table.Column>,
                ]}
              </Table.Header>
              <Table.Body renderEmptyState={() => (
                <p className="py-12 text-center text-sm text-muted">{layers.data && !layer ? t('data.layerMissing') : list.isPending ? t('common.loading') : t('common.noData')}</p>
              )}>
                {rows.map((f) => (
                  <Table.Row key={f.id} id={String(f.id)}>
                    {[
                      ...(writable ? [<Table.Cell key="sel"><Checkbox aria-label={t('data.select', { id: f.id })} slot="selection"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell>] : []),
                      <Table.Cell key="id" className="font-mono text-xs text-muted">{f.id}</Table.Cell>,
                      ...columns.map((c) => <Table.Cell key={c.key} className="min-w-28 max-w-56 break-words">{String(f.properties[c.key] ?? '–')}</Table.Cell>),
                      ...(layer ? [<Table.Cell key="docs"><DocCell layer={layer!} f={f} writable={Boolean(writable)} onSaved={refresh} /></Table.Cell>] : []),
                      <Table.Cell key="tahun_data" className="text-xs tabular-nums">{f.tahunData}</Table.Cell>,
                      <Table.Cell key="updated_at" className="text-xs whitespace-nowrap text-muted">{fmtDateTime(f.updatedAt)}</Table.Cell>,
                      <Table.Cell key="act" className="whitespace-nowrap">
                        <Tip label={writable ? t('common.edit') : t('common.view')}>
                          <Button isIconOnly size="sm" variant="ghost" onPress={() => setEdit(f.id)} aria-label={`${writable ? t('common.edit') : t('common.view')} ${f.id}`}>
                            {writable ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </Tip>
                        {writable && (
                          <Tip label={t('common.delete')}>
                            <Button isIconOnly size="sm" variant="ghost" onPress={() => confirmDelete([Number(f.id)])} aria-label={`${t('common.delete')} ${f.id}`} className="text-danger"><TrashBin className="size-4" /></Button>
                          </Tip>
                        )}
                      </Table.Cell>,
                    ]}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

        <div className="flex flex-col items-center justify-between gap-3 text-sm text-muted md:flex-row">
          <span className="shrink-0 whitespace-nowrap">{t('data.count', { n: fmt(list.data?.total ?? 0) })}</span>
          {/* Seleksi hanya untuk baris yang terlihat: pindah halaman mengosongkannya agar hapus massal tidak mengenai baris tersembunyi. */}
          <Pagination page={page} pages={pages} onChange={(p) => { setPage(p); setChecked(new Set()); }}
            size={limit} onSize={(n) => { setLimit(n); setPage(1); setChecked(new Set()); }} />
        </div>
        </>)}
      </Card>

      <AnimatePresence>
        {writable && checked.size > 0 && (
          <m.div
            role="toolbar"
            aria-label={t('data.selection')}
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={SPRING}
            className="fixed inset-x-0 bottom-24 z-40 mx-auto flex w-fit items-center gap-2 rounded border border-border bg-surface py-2 pr-2 pl-5 text-sm text-foreground shadow-card-hover lg:bottom-8"
          >
            <span className="mr-2 font-medium tabular-nums">{t('data.selected', { n: checked.size })}</span>
            <Button size="sm" variant="ghost" onPress={() => setChecked(new Set())} className="text-muted hover:text-foreground">{t('common.cancel')}</Button>
            <Button size="sm" variant="danger" onPress={() => confirmDelete([...checked])}><TrashBin className="size-4" /> {t('data.deleteSelected', { n: checked.size })}</Button>
          </m.div>
        )}
      </AnimatePresence>

      {layer && writable && decision.data && (
        <DecisionDialog f={decision.data} layer={layer} subject={featureLabel(decision.data.properties, layer, decision.data.id)}
          onClose={() => setParam('keputusan', null)} onSaved={refresh} />
      )}
      {layer && editId && <FeatureDialog layer={layer} featureId={editId === 'new' ? null : editId} readOnly={!writable} onClose={() => setEdit(null)} onSaved={refresh} />}
      {layer && dialog === 'upload' && <UploadDialog layer={layer} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'layer' && <LayerDialog used={(layers.data ?? []).map((l) => l.style.color)} onClose={() => setDialog(null)} onSaved={(l) => { void refreshData(qc); navigate(`/data/${l.slug}`); }} />}
    </div>
  );
}

/** Sel dokumentasi: badge urgensi dari kondisi + jumlah foto ("Belum ada" bila kosong pada fitur berurgensi). */
function DocCell({ layer, f, writable, onSaved }: { layer: Layer; f: Feature; writable: boolean; onSaved: () => unknown }) {
  const t = useT();
  const settings = useSettings().data;
  const u = urgencyOf(layer, f.properties, settings?.urgensi);
  const n = f.mediaCount ?? 0;
  const keputusan = (f.properties.keputusan as string | null | undefined) ?? null;
  const catatan = (f.properties.catatan_keputusan as string | null | undefined) ?? null;
  const [open, setOpen] = useState(false);
  // Warna chip dari pengaturan keputusan (DB); keputusan lama yang sudah tidak ada di opsi = netral.
  const tone = settings?.keputusan.opsi.find((o) => o.nilai === keputusan)?.warna ?? 'default';
  const chip = keputusan
    ? <Chip size="sm" variant="soft" color={tone}>{keputusan}</Chip>
    : <span className="text-xs text-muted">{t('decision.none')}</span>;
  return (
    <span className="flex max-w-56 flex-wrap items-center justify-center gap-x-2 gap-y-1">
      {u && <UrgencyBadge value={u} />}
      {hasDocs(layer) && (
        <span className={n ? 'text-xs text-muted tabular-nums' : u === 'tinggi' ? 'text-xs font-medium text-danger' : 'text-xs text-muted'}>
          {n ? t('doc.photos', { n }) : t('doc.empty')}
        </span>
      )}
      {writable ? (
        <Tip label={catatan ?? t('decision.label')}>
          <Button size="sm" variant="ghost" onPress={() => setOpen(true)} aria-label={t('decision.of', { id: f.id })} className="h-7 px-2">{chip}</Button>
        </Tip>
      ) : keputusan && <span title={catatan ?? undefined}>{chip}</span>}
      {open && <DecisionDialog f={f} layer={layer} subject={featureLabel(f.properties, layer, f.id)} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </span>
  );
}

function LayerMeta({ layer }: { layer: Layer }) {
  const t = useT();
  return (
    <dl className="-mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-sm">
      <Meta label={t('data.category')}>{sentenceCase(layer.category)}</Meta>
      <Meta label={t('data.geometry')}>{t(`geom.${layer.geomType}`)}</Meta>
      {layer.year && <Meta label={t('data.year')}>{layer.year}</Meta>}
      {layer.sourceLayerId && <Chip size="sm" color="accent" variant="soft">{t('data.derived')}</Chip>}
    </dl>
  );
}

const Meta = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline gap-2">
    <dt className="text-muted">{label}</dt>
    <dd className="font-medium text-heading">{children}</dd>
  </div>
);
