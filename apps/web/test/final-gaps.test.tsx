import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/App';
import { MiniMap } from '@/features/overview/widgets';
import { FeaturePopup } from '@/features/peta/PetaPage';
import { PrefsProvider } from '@/lib/prefs';
import type { Layer } from '@/lib/types';
import { fakeMap } from './map-mock';
import { LAYERS, mockApi, page, renderAt, user } from './utils';

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter>{ui}</MemoryRouter></PrefsProvider></QueryClientProvider>);

describe('Data: dialog', () => {
  const base = { 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/ruas-jalan': [], 'GET /layers/pju/features': page([]) };

  it('Layer baru bisa dibuka sebelum daftar layer termuat', async () => {
    mockApi({ ...base, 'GET /layers': () => new Promise(() => undefined) });
    renderAt('/data');
    await userEvent.click(await screen.findByRole('button', { name: 'Layer baru' }, { timeout: 5000 }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('unggah: tahun dikosongkan tidak menghapus nilai sebelumnya', async () => {
    mockApi(base);
    renderAt('/data/pju');
    await userEvent.click(await screen.findByRole('button', { name: /Unggah Data/ }, { timeout: 5000 }));
    const input = within(await screen.findByRole('dialog')).getByLabelText(/Tahun data/);
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveValue(String(new Date().getFullYear()));
    await userEvent.clear(input);
    await userEvent.type(input, '2020');
    await userEvent.tab();
    expect(input).toHaveValue('2020');
  });
});

describe('Peta & peta mini', () => {
  it('popup fitur menyebut pengubah terakhir', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /features/9': { type: 'Feature', id: '9', media: [], properties: { kode: 'P1' }, updatedAt: '2026-11-11T06:46:15.056Z', updatedByName: 'Rina' } });
    wrap(<FeaturePopup selected={{ id: '9', layer: LAYERS[4]!, lng: 110.5, lat: -7.5 }} onClose={vi.fn()} />);
    expect(await screen.findByText(/oleh Rina$/)).toBeInTheDocument();
  });

  it('peta mini: klik fitur ber-id membuka Peta dengan fitur itu', async () => {
    let loc = '';
    const Spy = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
    wrap(<><MiniMap layers={[{ ...LAYERS[1]!, visibleDefault: true }]} /><Spy /></>);
    await waitFor(() => expect(fakeMap.addLayer).toHaveBeenCalled());
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten', layer: { id: 'line-jalan-kabupaten' }, id: 7, properties: {} }];
    act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 110, lat: -7 } }));
    await waitFor(() => expect(loc).toBe('/peta?f=7&layer=jalan-kabupaten&lng=110&lat=-7'));
  });

  it('bahaya menyala: klik kalurahan tidak membuka popup fitur; kelas di luar Rendah–Tinggi memakai labelnya', async () => {
    const zona = LAYERS.map((l) => (l.slug === 'potensi-bencana' ? { ...l, style: { color: '#DC2626', classField: 'kelas', ordinal: ['Lain', 'Tinggi'], classes: { Tinggi: '#FF0000', Lain: '#000000' } } } : l));
    const calls = mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': zona, 'GET /stats/kecamatan': [],
      'GET /layers/batas-administrasi/export': { type: 'FeatureCollection', features: [] },
    });
    renderAt('/peta');
    await userEvent.click((await screen.findAllByRole('switch', { name: 'Tampilkan Potensi Bencana' }, { timeout: 5000 }))[0]!);
    expect(screen.getAllByText('Lain').length).toBeGreaterThan(0);
    fakeMap.rendered = [{ source: 'src-batas-administrasi', layer: { id: 'fill-batas-administrasi' }, id: 3, properties: {} }];
    act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 110, lat: -7 } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.url.startsWith('/features/3'))).toBe(false);
  });
});

describe('Ringkasan: kecamatan, tanpa ruas rusak, selisih nol & turun', () => {
  const miskin = { ...LAYERS[0]!, id: 50, slug: 'penduduk-miskin', name: 'Penduduk Miskin', category: 'Sosial', year: null } as Layer;
  const SURVEY_2026 = { kecamatan: 'Wates', wilayah: 'W', tahun: 2026, ruas: 'Ruas X', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 0, perbaikan: 0 };
  const setup = (jalanNow: unknown[], now: object = SURVEY_2026) => mockApi({
    'GET /auth/me': { user: user('viewer') }, 'GET /stats/kecamatan': ['Wates'],
    'GET /layers': [...LAYERS.map((l) => (l.slug === 'pju' ? { ...l, name: 'PJU 2026', year: 2026 } : l)), miskin],
    'GET /stats/timeseries': [
      { tahun: 2025, miskin: 900, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 12 } },
      { tahun: 2026, miskin: 800, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 12 } },
    ],
    'GET /stats/layers/penduduk-miskin': [{ key: 'Bendungan', count: 1, lengthKm: 0, areaHa: 0, value: 50 }],
    'GET /stats/layers/jalan-kabupaten': ({ url }: { url: string }) => (url.includes('tahun=2025') ? [{ key: 'Rusak Berat', count: 2, lengthKm: 2, areaHa: 0 }] : jalanNow),
    'GET /stats/layers/pju': [{ key: 'LED', count: 12, lengthKm: 0, areaHa: 0 }],
    'GET /stats/ruas-jalan': [
      { kecamatan: 'Wates', wilayah: 'W', tahun: 2025, ruas: 'Lama', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 1, perbaikan: 0 },
      now,
    ],
  });
  const roadCard = () => screen.getByRole('link', { name: 'Jalan kabupaten rusak berat' }).closest<HTMLElement>('.card')!;

  it('kalurahan teratas di kecamatan terpilih; rusak berat turun; PJU tanpa selisih', async () => {
    setup([{ key: 'Baik', count: 3, lengthKm: 9, areaHa: 0 }]);
    renderAt('/?kec=Wates');
    expect(await screen.findByText('Bendungan', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/kalurahan/i, { selector: 'p' })).toBeInTheDocument();
    // Km rusak berat dari tabel survei: 2026 = 0 km, 2025 = 1 km; kemantapan 100% di keterangan.
    expect(await within(roadCard()).findByText(/^-1 km dibanding 2025/)).toBeInTheDocument();
    expect(within(roadCard()).getByText('0 km')).toBeInTheDocument();
    expect(within(roadCard()).getByText(/^Kemantapan 100% · /)).toBeInTheDocument();
    const pju = screen.getByRole('link', { name: 'Titik penerangan jalan umum' }).closest<HTMLElement>('.card')!;
    expect(within(pju).queryByText(/dibanding/)).not.toBeInTheDocument();
  });

  it('belum ada ruas tersurvei', async () => {
    // Survei 2026 lebih buruk: 3 km rusak berat dari 1 km (2025), naik 2 km.
    setup([{ key: 'Belum Disurvei', count: 3, lengthKm: 9, areaHa: 0 }], { ...SURVEY_2026, rusakBerat: 3 });
    renderAt('/');
    await waitFor(() => expect(within(roadCard()).getByText(/^\+2 km dibanding 2025/)).toBeInTheDocument(), { timeout: 10000 });
    // Porsi belum disurvei dari seluruh ruas SK ikut tampil.
    await waitFor(() => expect(within(roadCard()).getByRole('button', { name: /^Belum Disurvei3100%$/ })).toBeInTheDocument(), { timeout: 10000 });
    expect(within(roadCard()).getByText(/0 dari 3 ruas$/)).toBeInTheDocument();
  });
});
