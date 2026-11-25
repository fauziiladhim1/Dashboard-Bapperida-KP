import { Layers, Magnifier, MapPin } from '@gravity-ui/icons';
import { ComboBox, Header, Input, ListBox, Select } from '@heroui/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { NAV } from '@/components/layout/Sidebar';
import { can, useMe } from '@/hooks/use-auth';
import { endpoints } from '@/lib/api';
import { useT } from '@/lib/prefs';
import type { Layer, RegionHit, SearchHit } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const norm = (s: string) => s.toLocaleLowerCase('id');

/** Satu baris hasil: ikon/titik warna, judul, keterangan kecil (dan baris rincian), info kanan opsional. */
function Row({ lead, title, sub, detail, aside }: { lead: ReactNode; title: string; sub?: string; detail?: string; aside?: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-default text-muted">{lead}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm break-words text-heading">{title}</span>
        {sub && <span className="block text-xs break-words text-muted">{sub}</span>}
        {detail && <span className="block text-xs break-words text-heading">{detail}</span>}
      </span>
      {aside && <span className="shrink-0 text-xs text-muted">{aside}</span>}
    </span>
  );
}

/**
 * Cari dari topbar, dikelompokkan: Menu & Layer (disaring di klien), Wilayah dan Data. Hasil peta dipilih di peta:
 * layer dinyalakan; kecamatan = filter + zoom; kalurahan & fitur = layer dinyalakan, zoom, popup, dan sorotan.
 * Dropdown layer membatasi pencarian Data ke satu layer. Ctrl+K memfokuskan.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState<string>();

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const layers = useQuery({ queryKey: ['layers'], queryFn: endpoints.layers });
  // Hanya layer sumber berisi data yang bisa jadi filter (layer turunan berbagi fitur dengan sumbernya).
  const sources = useMemo(() => (layers.data ?? []).filter((l) => !l.sourceLayerId && l.featureCount > 0 && l.slug !== 'batas-administrasi'), [layers.data]);
  const ready = q.length >= 2;
  const { data } = useQuery({ queryKey: ['search', q, layer], queryFn: () => endpoints.search(q, layer), enabled: ready, placeholderData: keepPreviousData });

  const nq = norm(q);
  const menu = ready && !layer ? NAV.filter((n) => (!n.roles || can(me, ...n.roles)) && norm(t(n.label)).includes(nq)) : [];
  const layerHits = ready && !layer ? (layers.data ?? []).filter((l) => norm(l.name).includes(nq)).slice(0, 5) : [];
  const regions = ready ? (data?.regions ?? []) : [];
  const features = ready ? (data?.features ?? []) : [];
  const fieldLabel = (h: SearchHit) => layers.data?.find((l) => l.slug === h.slug)?.fields.find((f) => f.key === h.matchKey)?.label ?? h.matchKey.replace(/_/g, ' ').replace(/^\p{L}/u, (c) => c.toUpperCase());

  const go = (to: string) => {
    setText('');
    ref.current?.blur();
    navigate(to);
  };
  const actions = new Map<string, () => void>([
    ...menu.map((n) => [`m:${n.to}`, () => go(n.to)] as const),
    ...layerHits.map((l: Layer) => [`l:${l.slug}`, () => go(`/peta?layer=${l.slug}`)] as const),
    ...regions.map((r: RegionHit) => [`r:${r.type}:${r.name}:${r.kecamatan ?? ''}`, () => {
      const [w, s, e, n] = r.bbox;
      const pick: Record<string, string> = r.id ? { f: r.id, lng: String((w + e) / 2), lat: String((s + n) / 2) } : { kec: r.name };
      go(`/peta?${new URLSearchParams({ ...pick, layer: 'batas-administrasi', bbox: r.bbox.join(',') })}`);
    }] as const),
    ...features.map((h) => [`f:${h.id}`, () => go(`/peta?f=${h.id}&layer=${h.slug}&lng=${h.lng}&lat=${h.lat}`)] as const),
  ]);

  return (
    // Cincin fokus lembut saat kotak cari aktif (transisi box-shadow, bukan ukuran).
    <div className={cn('flex h-10 w-full min-w-0 items-center gap-1 rounded-control bg-surface p-1 custom-shadow transition-shadow duration-300 focus-within:ring-2 focus-within:ring-accent/25', className)}>
      <Select aria-label={t('search.filterLayer')} selectedKey={layer ?? ALL} className="hidden w-fit shrink-0 md:block"
        onSelectionChange={(k) => k !== null && setLayer(k === ALL ? undefined : String(k))}>
        <Select.Trigger className="min-h-8! h-8 gap-1.5 rounded-md border-0 bg-default pr-8 pl-3 text-xs text-heading">
          <Layers className="size-3.5 shrink-0 text-muted" aria-hidden />
          <Select.Value className="whitespace-nowrap" />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="min-w-56">
          <ListBox items={[{ id: ALL, name: t('search.allLayers') }, ...sources.map((l) => ({ id: l.slug, name: l.name }))]}>
            {(it: { id: string; name: string }) => <ListBox.Item id={it.id} textValue={it.name}>{it.name}<ListBox.ItemIndicator /></ListBox.Item>}
          </ListBox>
        </Select.Popover>
      </Select>
      <ComboBox aria-label={t('search.label')} className="min-w-0 flex-1" inputValue={text} onInputChange={setText}
        menuTrigger="input" allowsCustomValue allowsEmptyCollection selectedKey={null} defaultFilter={() => true}
        onSelectionChange={(k) => k !== null && actions.get(String(k))?.()}>
        {/* Tombol cari = ComboBox.Trigger sungguhan di samping input (bukan ikon yang menumpuk di dalamnya): klik membuka hasil & memfokuskan input. */}
        <div className="flex min-w-0 items-center gap-1">
          <Input ref={ref} placeholder={t('search.placeholder')} className="h-8! min-w-0 flex-1 rounded-md! border-0! bg-transparent pl-3 text-sm shadow-none!" />
          <ComboBox.Trigger aria-label={t('search.label')}
            className="static grid size-8 shrink-0 translate-none cursor-pointer place-items-center rounded-md bg-transparent p-0 text-muted transition hover:text-accent active:scale-90 data-[pressed=true]:opacity-100">
            <Magnifier className="size-4" aria-hidden />
          </ComboBox.Trigger>
        </div>
        <ComboBox.Popover className="max-h-[70vh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
          <ListBox renderEmptyState={() => <p className="px-3 py-2 text-sm text-muted">{!ready ? t('search.hint') : t('search.empty')}</p>}>
            {menu.length > 0 && (
              <ListBox.Section>
                <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('search.menu')}</Header>
                {menu.map((n) => (
                  <ListBox.Item key={n.to} id={`m:${n.to}`} textValue={t(n.label)}>
                    <Row lead={<n.icon className="size-3.5" aria-hidden />} title={t(n.label)} />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            )}
            {layerHits.length > 0 && (
              <ListBox.Section>
                <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('search.layers')}</Header>
                {layerHits.map((l) => (
                  <ListBox.Item key={l.slug} id={`l:${l.slug}`} textValue={l.name}>
                    <Row lead={<span className="size-2.5 rounded-full" style={{ backgroundColor: l.style.color }} />} title={l.name} sub={l.category} aside={t('map.nFeatures', { n: l.featureCount.toLocaleString('id') })} />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            )}
            {regions.length > 0 && (
              <ListBox.Section>
                <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('search.regions')}</Header>
                {regions.map((r) => (
                  <ListBox.Item key={`r:${r.type}:${r.name}:${r.kecamatan ?? ''}`} id={`r:${r.type}:${r.name}:${r.kecamatan ?? ''}`} textValue={r.name}>
                    <Row lead={<MapPin className="size-3.5" aria-hidden />} title={r.name}
                      sub={r.type === 'kecamatan' ? t('search.kecamatan') : t('search.kalurahan', { kec: r.kecamatan ?? '' })} />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            )}
            {features.length > 0 && (
              <ListBox.Section>
                <Header className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{t('search.features')}</Header>
                {features.map((h) => (
                  <ListBox.Item key={h.id} id={`f:${h.id}`} textValue={h.label}>
                    <Row lead={<span className="size-2.5 rounded-full ring-1 ring-black/15 ring-inset dark:ring-white/25" style={{ backgroundColor: h.color ?? 'var(--accent)' }} />}
                      title={h.label} sub={h.layer} detail={h.matchValue === h.label ? undefined : `${fieldLabel(h)}: ${h.matchValue}`}
                      aside={h.kecamatan ? t('common.kec', { name: h.kecamatan }) : undefined} />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
    </div>
  );
}
