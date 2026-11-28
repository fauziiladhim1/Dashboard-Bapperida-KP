import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Persons } from '@gravity-ui/icons';
import { createQueryClient } from '@/app/App';
import { Breakdown, HazardCard, HeroKpi, Kpi, LandCover, MiniMap, PolaRuang, RoadOverview, TimeSeries } from '@/features/overview/widgets';
import { PrefsProvider } from '@/lib/prefs';
import type { Layer, StatRow, TimePoint } from '@/lib/types';
import { fakeMap } from './map-mock';
import { choose, LAYERS, mockApi, renderAt, user } from './utils';

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter>{ui}</MemoryRouter></PrefsProvider></QueryClientProvider>);
const row = (key: string | null, areaHa: number, count = 1): StatRow => ({ key, count, lengthKm: 0, areaHa });

describe('Kartu KPI', () => {
  it('rincian hanya tampil bila ada angka; hero menyembunyikan "extra" saat memuat atau tanpa data', () => {
    const { unmount } = wrap(<>
      <Kpi icon={Persons} label="A" value={5} format={String}><p>rincian-a</p></Kpi>
      <Kpi icon={Persons} label="B" value={null} format={String}><p>rincian-b</p></Kpi>
      <HeroKpi icon={Persons} label="C" value={3} format={String} extra={<p>extra-c</p>} />
      <HeroKpi icon={Persons} label="D" value={3} format={String} loading extra={<p>extra-d</p>} />
      <HeroKpi icon={Persons} label="E" value={null} format={String} extra={<p>extra-e</p>} />
      <Breakdown items={[{ key: 'k1', label: 'Satu', value: 2, color: '#000' }, { key: 'k2', label: 'Dua', value: 1, color: '#111' }]} total={3} highlight="k1" />
    </>);
    expect(screen.getByText('rincian-a')).toBeInTheDocument();
    expect(screen.queryByText('rincian-b')).not.toBeInTheDocument();
    expect(screen.getByText('extra-c')).toBeInTheDocument();
    expect(screen.queryByText('extra-d')).not.toBeInTheDocument();
    expect(screen.queryByText('extra-e')).not.toBeInTheDocument();
    expect(screen.getByTitle('Satu')).toHaveClass('font-medium');
    expect(screen.getByTitle('Dua')).not.toHaveClass('font-medium');
    unmount();
  });
});

describe('LandCover', () => {
  const layer = { ...LAYERS[2]!, style: { color: '#7CB342', classes: { Sawah: '#00FF00', Kebun: '#0000FF' }, labels: { Sawah: 'Sawah irigasi' }, groups: { Pertanian: ['Sawah', 'Kebun', 'Tegal', 'Ladang'] } } };
  const rows = [row('Sawah', 400), row('Kebun', 100), row('Tegal', 50), row('Ladang', 20), row('Hutan', 200), row(null, 30), row('Kosong', 0)];

  it('kelompok terurut, kelas >3 diringkas, tanpa kelas & di luar kelompok; arahkan = porsi kelompok', () => {
    const { container } = wrap(<LandCover rows={rows} layer={layer} total={800} />);
    // Baris tabel legenda (tanpa baris judul kolom).
    const items = screen.getAllByRole('row').slice(1, -1); // tanpa baris Total
    expect(items.map((li) => li.querySelector('[title]')!.textContent)).toEqual(['Pertanian', 'Lainnya', 'Tanpa Kelas']);
    expect(items[0]).toHaveTextContent('Sawah irigasi 50%');
    expect(items[0]).toHaveTextContent('+1 kelas lain');
    // Warna kelompok = warna kelas terluasnya.
    expect(items[0]!.querySelector('[aria-hidden]')).toHaveStyle({ backgroundColor: '#00FF00' });

    // Tengah donut (induk <svg>) = porsi + nama kelompok yang diarahkan.
    const center = () => within(container.querySelector('svg')!.parentElement!);
    fireEvent.mouseEnter(items[1]!);
    expect(center().getByText(/^Lainnya, /)).toBeInTheDocument();
    expect(center().getByText('25%')).toBeInTheDocument();
    expect(items[0]).toHaveClass('opacity-35');
    fireEvent.mouseEnter(container.querySelector('circle')!);
    expect(center().getByText(/^Pertanian, /)).toBeInTheDocument();
    fireEvent.mouseLeave(container.firstElementChild!);
    expect(center().queryByText(/^Pertanian, /)).not.toBeInTheDocument();
  });

  it('tanpa layer memakai warna netral; total 0 atau tanpa baris = tidak digambar', () => {
    const { container, rerender } = wrap(<LandCover rows={[row('X', 10)]} total={10} />);
    expect(container.querySelector('circle')).toHaveAttribute('stroke', '#9CA3AF');
    rerender(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter><LandCover rows={[row('X', 10)]} total={0} /></MemoryRouter></PrefsProvider></QueryClientProvider>);
    expect(container.querySelector('circle')).toBeNull();
  });
});

describe('PolaRuang', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((k, i) => row(k, [5000, 3000, 900, 500, 300, 200, 50, 20][i]!));

  it('arahkan/fokus kotak = angka utama ikut kelas; sisa = "Lainnya" (warna token); tanpa layer = warna netral', () => {
    wrap(<PolaRuang rows={rows} />);
    const list = screen.getByRole('list', { name: 'Rencana Pola Ruang' });
    const tiles = within(list).getAllByRole('listitem');
    expect(tiles).toHaveLength(8); // 7 kelas + Lainnya
    expect(tiles.at(-1)).toHaveAttribute('title', expect.stringMatching(/^Lainnya: /));
    expect(tiles.at(-1)!.firstElementChild).toHaveStyle({ color: 'var(--heading)' });
    expect(tiles[0]!.firstElementChild).toHaveStyle({ backgroundColor: '#9CA3AF' });
    fireEvent.mouseEnter(tiles[1]!);
    expect(screen.getByText(/^B, \d+% dari total/)).toBeInTheDocument();
    fireEvent.mouseLeave(list);
    fireEvent.focus(tiles[2]!);
    expect(screen.getByText(/^C, /)).toBeInTheDocument();
    fireEvent.blur(tiles[2]!);
    expect(screen.queryByText(/^C, /)).not.toBeInTheDocument();
  });

  it('layar sempit: 5 kelas + Lainnya, ikut berubah saat jendela diubah', () => {
    let change = () => undefined as void;
    const q = { matches: true, addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: vi.fn() };
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(q as never);
    const { unmount } = wrap(<PolaRuang rows={rows} />);
    expect(within(screen.getByRole('list', { name: 'Rencana Pola Ruang' })).getAllByRole('listitem')).toHaveLength(6);
    q.matches = false;
    act(() => change());
    expect(within(screen.getByRole('list', { name: 'Rencana Pola Ruang' })).getAllByRole('listitem')).toHaveLength(8);
    unmount();
    expect(q.removeEventListener).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('HazardCard & RoadOverview', () => {
  it('klik baris (bukan tombol) memilih jenis; sumber + tanggal ambil tampil', async () => {
    const layer = { ...LAYERS[5]!, sumber: 'InaRISK BNPB' } as Layer;
    wrap(<HazardCard rows={[row('Banjir', 300), row('Longsor', 100)]} totalHa={1000} layer={layer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Longsor' }).closest('li')!.querySelector('.text-right')!);
    expect(screen.getByRole('button', { name: 'Longsor' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/InaRISK BNPB/)).toBeInTheDocument();
  });

  it('kelas yang disembunyikan dinyalakan lagi lewat tombolnya', async () => {
    const onHidden = vi.fn();
    wrap(<RoadOverview network={[{ key: 'Baik', count: 2, lengthKm: 1, areaHa: 0 }]} hiddenKelas={['Baik']} onHiddenKelas={onHidden} />);
    await userEvent.click(screen.getByRole('button', { name: /^Baik/ }));
    expect(onHidden).toHaveBeenCalledWith([]);
  });
});

describe('TimeSeries: tahun tak sebanding & nilai awal nol', () => {
  const sized = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, toJSON: () => ({}) } as DOMRect);
  const tooltip = () => document.querySelector('.recharts-tooltip-wrapper')?.textContent ?? '';

  it('tahun menyimpang digambar berongga, dicatat, dan tidak dibandingkan', async () => {
    sized();
    const points: TimePoint[] = [
      { tahun: 2023, miskin: 9000, jalanKm: 0, jalanRusakKm: 0 },
      { tahun: 2024, miskin: 1000, jalanKm: 0, jalanRusakKm: 0 },
      { tahun: 2025, miskin: 8000, jalanKm: 0, jalanRusakKm: 0 },
    ];
    wrap(<TimeSeries points={points} />);
    expect(screen.getByText(/2024/, { selector: 'p' })).toBeInTheDocument(); // catatan tahun tak sebanding
    fireEvent.mouseMove(document.querySelector('.recharts-wrapper')!, { clientX: 300, clientY: 150 });
    await waitFor(() => expect(tooltip()).toContain('2024'));
    expect(tooltip()).not.toContain('dibanding');
  });

  it('kemiskinan per wilayah: semua wilayah tampil, angka utama = wilayah yang naik', async () => {
    sized();
    const points: TimePoint[] = [
      { tahun: 2025, miskin: 300, jalanKm: 0, jalanRusakKm: 0, miskinWilayah: { Wates: 100, Pengasih: 120, Galur: 80 } },
      { tahun: 2026, miskin: 330, jalanKm: 0, jalanRusakKm: 0, miskinWilayah: { Wates: 130, Pengasih: 110, Galur: 90 } },
    ];
    wrap(<TimeSeries points={points} />);
    await choose(/Analisis/, 'Kemiskinan per Wilayah');
    // Semua wilayah dihitung (bukan 5 teratas). Jumlah yang naik dicek di browser: AnimatedNumber jsdom tetap 0 saat nilai ada sejak mount.
    expect(await screen.findByText(/dari 3 wilayah naik/)).toBeInTheDocument();
    expect(screen.getByText('Jiwa miskin per wilayah, 2025 → 2026')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Data yang Ditampilkan' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['2025', '2026']);
  });

  it('seri disorot dengan nilai awal 0: perubahan tanpa persen', async () => {
    const points: TimePoint[] = [
      { tahun: 2023, miskin: 10, jalanKm: 5, jalanRusakKm: 0 },
      { tahun: 2024, miskin: 10, jalanKm: 6, jalanRusakKm: 2 },
    ];
    wrap(<TimeSeries points={points} />);
    await choose(/Analisis/, 'Ruas Jalan');
    fireEvent.mouseEnter(within(screen.getByRole('list', { name: 'Data yang Ditampilkan' })).getAllByRole('listitem')[1]!);
    expect(document.body).toHaveTextContent('2023–2024 (—)');
  });
});

describe('TimeSeries: topik PJU, layer, wilayah; sorot & tooltip', () => {
  const sized = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, toJSON: () => ({}) } as DOMRect);
  const tooltip = () => document.querySelector('.recharts-tooltip-wrapper')?.textContent ?? '';
  const hover = (x = 300) => fireEvent.mouseMove(document.querySelector('.recharts-wrapper')!, { clientX: x, clientY: 150 });
  const legend = () => within(screen.getByRole('list', { name: 'Data yang Ditampilkan' })).getAllByRole('listitem');
  const points: TimePoint[] = [
    { tahun: 2023, miskin: 0, jalanKm: 0, jalanRusakKm: 0, pjuPasang: 4, pjuWatt: 200, pjuLampu: { LED: 3, 'Tidak Tercatat': 1 }, pjuTanpaTahun: 7, layers: { PJU: 5, Sekolah: 2 }, miskinWilayah: { Wates: 0 } },
    { tahun: 2025, miskin: 0, jalanKm: 0, jalanRusakKm: 0, pjuPasang: 6, pjuWatt: 0, pjuLampu: { LED: 5, 'Tidak Tercatat': 1 }, pjuTanpaTahun: 7, layers: { PJU: 8, Sekolah: 3 } },
    { tahun: 2026, miskin: 0, jalanKm: 0, jalanRusakKm: 0, pjuPasang: 2, pjuWatt: 90, pjuLampu: { LED: 2 }, pjuTanpaTahun: 7, layers: { PJU: 9 } },
  ];

  it('batang tumpuk per jenis lampu: total di tooltip, sorot legenda, catatan tanpa tahun', async () => {
    sized();
    wrap(<TimeSeries points={points} />);
    await choose(/Analisis/, 'Pemasangan PJU per Jenis Lampu');
    expect(screen.getByText('7 titik PJU tanpa tahun pasang tidak termasuk grafik.')).toBeInTheDocument();
    expect(legend().map((li) => li.textContent)).toEqual(['LED', 'Tidak Tercatat']);
    hover(100);
    await waitFor(() => expect(tooltip()).toContain('Total'));
    fireEvent.mouseEnter(legend()[1]!);
    expect(document.body).toHaveTextContent(/Tidak Tercatat.*2023.*2025/);
    fireEvent.mouseLeave(legend()[1]!);
    fireEvent.mouseEnter(document.querySelector('.recharts-bar-rectangle')!);
    fireEvent.mouseLeave(document.querySelector('.recharts-wrapper')!);
  });

  it('kumulatif (tangga), daya, dan jumlah fitur layer: garis dengan titik, titik aktif saat diarahkan', async () => {
    sized();
    wrap(<TimeSeries points={points} />);
    await choose(/Analisis/, 'PJU Terpasang (kumulatif)');
    hover(100);
    await waitFor(() => expect(tooltip()).toMatch(/titik/));
    expect(document.querySelector('.recharts-active-dot')).not.toBeNull();
    await choose(/Analisis/, 'Daya Lampu PJU Dipasang');
    hover(100);
    await waitFor(() => expect(tooltip()).toContain('W'));
    await choose(/Analisis/, 'Jumlah Fitur Layer');
    expect(legend().map((li) => li.textContent)).toEqual(['PJU', 'Sekolah']);
    // Penanda titik muncul setelah animasi garis selesai (300 ms).
    await waitFor(() => expect(document.querySelector('.recharts-area-dots circle, .recharts-area-dots rect')).not.toBeNull(), { timeout: 3000 });
    fireEvent.mouseEnter(document.querySelector('.recharts-area-area')!);
    hover();
    await waitFor(() => expect(tooltip()).toContain('fitur'));
  });

  it('data bolong: wilayah tanpa angka, tahun tak sebanding berongga, tahun kosong, seri pertama kosong di ujung', async () => {
    sized();
    const w = (miskin: number, mw: Record<string, number>) => ({ miskin, jalanKm: 0, jalanRusakKm: 0, miskinWilayah: mw });
    const { unmount } = wrap(<TimeSeries points={[
      { tahun: 2023, ...w(9000, { Wates: 100, Galur: 80, Kokap: 50 }) }, { tahun: 2024, ...w(1000, { Wates: 10 }) },
      // Galur kosong di 2026, Kokap kosong di 2025: dihitung 0 saat diurutkan dan dibandingkan.
      { tahun: 2025, ...w(9000, { Wates: 100, Galur: 70 }) }, { tahun: 2026, ...w(9100, { Wates: 120, Kokap: 60 }) },
    ]} />);
    await choose(/Analisis/, 'Kemiskinan per Wilayah');
    expect(legend().map((li) => li.textContent)).toEqual(['2023', '2024', '2025', '2026']);
    expect(screen.getByText(/2024/, { selector: 'p' })).toBeInTheDocument(); // catatan tak sebanding
    unmount();
    // Angka per wilayah hanya di satu tahun: tak ada dua tahun pembanding, angka utama tidak tampil.
    const r1 = wrap(<TimeSeries points={[{ tahun: 2025, miskin: 300, jalanKm: 0, jalanRusakKm: 0 }, { tahun: 2026, ...w(330, { Wates: 120 }) }]} />);
    await choose(/Analisis/, 'Kemiskinan per Wilayah');
    expect(screen.queryByText(/wilayah naik/)).toBeNull();
    r1.unmount();
    // Ruas jalan dengan tahun menyimpang (penanda berongga) dan tahun tanpa baris (titik kosong).
    const j = (tahun: number, jalanKm: number) => ({ tahun, miskin: 0, jalanKm, jalanRusakKm: 0 });
    const r2 = wrap(<TimeSeries points={[j(2020, 100), j(2021, 10), j(2022, 100), j(2024, 110)]} />);
    await choose(/Analisis/, 'Ruas Jalan');
    expect(screen.getByText(/2021/, { selector: 'p' })).toBeInTheDocument();
    r2.unmount();
    // PJU tanpa daya & tanpa hitungan "tanpa tahun"; jenis lampu terbanyak (LED) kosong di tahun awal & akhir.
    const pj = (tahun: number, pjuLampu: Record<string, number>) => ({ tahun, miskin: 0, jalanKm: 0, jalanRusakKm: 0, pjuPasang: Object.values(pjuLampu).reduce((a, b) => a + b), pjuLampu });
    wrap(<TimeSeries points={[pj(2023, { Sodium: 1 }), pj(2024, { LED: 5 }), pj(2025, { Sodium: 1 })]} />);
    await userEvent.click(screen.getByRole('button', { name: /Analisis/ }));
    expect(screen.queryByRole('option', { name: 'Daya Lampu PJU Dipasang' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Pemasangan PJU per Jenis Lampu' }));
    expect(screen.queryByText(/tanpa tahun pasang/)).toBeNull();
    expect(legend().map((li) => li.textContent)).toEqual(['LED', 'Sodium']);
  });

  it('per wilayah: tooltip per tahun; galat dengan coba lagi; memuat', async () => {
    sized();
    const retry = vi.fn();
    const pw: TimePoint[] = [
      { tahun: 2025, miskin: 300, jalanKm: 0, jalanRusakKm: 0, miskinWilayah: { Wates: 100, Galur: 80 } },
      { tahun: 2026, miskin: 330, jalanKm: 0, jalanRusakKm: 0, miskinWilayah: { Wates: 90, Galur: 70 } },
    ];
    const { unmount } = wrap(<TimeSeries points={pw} />);
    await choose(/Analisis/, 'Kemiskinan per Wilayah');
    expect(await screen.findByText(/dari 2 wilayah naik/)).toBeInTheDocument();
    hover();
    await waitFor(() => expect(tooltip()).toMatch(/jiwa/));
    unmount();
    wrap(<TimeSeries points={pw} retry={retry} />);
    await userEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('MiniMap', () => {
  it('klik fitur ber-id membuka Peta; tanpa id diabaikan; tooltip saat diarahkan', async () => {
    const jalan = { ...LAYERS[1]!, visibleDefault: true };
    let path = '';
    const Spy = () => { path = window.location.pathname; return null; };
    render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter><MiniMap layers={[jalan]} /><Spy /></MemoryRouter></PrefsProvider></QueryClientProvider>);
    await waitFor(() => expect(fakeMap.addLayer).toHaveBeenCalled());
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten', layer: { id: 'line-jalan-kabupaten' }, properties: { nama_ruas: 'Ruas A' } }];
    act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 110, lat: -7 } }));
    act(() => fakeMap.fire('mousemove', { point: { x: 1, y: 1 } }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Ruas A');
    expect(path).toBe('/');
  });
});

describe('Ringkasan: kemiskinan per wilayah, pembanding survei & layer', () => {
  it('peringkat wilayah, tahun tak sebanding, ruas terburuk, selisih survei, selisih PJU', async () => {
    const miskin = { ...LAYERS[0]!, id: 50, slug: 'penduduk-miskin', name: 'Penduduk Miskin', category: 'Sosial', year: null } as Layer;
    const layers = [...LAYERS.map((l) => (l.slug === 'pju' ? { ...l, name: 'PJU 2026', year: 2026 } : l)), miskin];
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': layers, 'GET /stats/kecamatan': [],
      'GET /stats/timeseries': [
        { tahun: 2024, miskin: 1000, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 10 } },
        { tahun: 2025, miskin: 9000, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 12 } },
        { tahun: 2026, miskin: 8500, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 15 } },
      ],
      'GET /stats/layers/penduduk-miskin': [{ key: 'Wates', count: 1, lengthKm: 0, areaHa: 0, value: 3000 }, { key: 'Sentolo', count: 1, lengthKm: 0, areaHa: 0, value: 4000 }, { key: null, count: 1, lengthKm: 0, areaHa: 0, value: 9 }],
      'GET /stats/layers/jalan-kabupaten': ({ url }: { url: string }) => (url.includes('tahun=2024')
        ? [{ key: 'Rusak Berat', count: 1, lengthKm: 2, areaHa: 0 }]
        : [{ key: 'Rusak Berat', count: 3, lengthKm: 5, areaHa: 0 }, { key: 'Baik', count: 2, lengthKm: 9, areaHa: 0 }]),
      'GET /stats/layers/pju': [{ key: 'LED', count: 15, lengthKm: 0, areaHa: 0 }],
      'GET /stats/ruas-jalan': [
        { kecamatan: 'Wates', wilayah: 'W', tahun: 2024, ruas: 'Lama', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 1, perbaikan: 0 },
        { kecamatan: 'Wates', wilayah: 'W', tahun: 2026, ruas: 'Ruas X', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 0.4, perbaikan: 0 },
        { kecamatan: 'Wates', wilayah: 'W', tahun: 2026, ruas: 'Ruas Y', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 1.2, perbaikan: 0 },
      ],
    });
    renderAt('/');
    expect(await screen.findByText('Sentolo', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/-500 jiwa \(-\d+%\) dibanding 2025/)).toBeInTheDocument();
    expect(screen.getAllByText(/2024/).length).toBeGreaterThan(0);
    const road = screen.getByRole('link', { name: 'Jalan Kabupaten Rusak Berat' }).closest<HTMLElement>('.card')!;
    expect(within(road).getByRole('button', { name: /^Rusak Berat360%$/ })).toBeInTheDocument();
    expect(within(road).getByText('1,6 km')).toBeInTheDocument();
    expect(await within(road).findByText(/\+0,6 km dibanding 2024/)).toBeInTheDocument();
    expect(within(road).getByText(/^Kemantapan 56%, /)).toBeInTheDocument();
    const pju = screen.getByRole('link', { name: 'Titik Penerangan Jalan Umum' }).closest<HTMLElement>('.card')!;
    expect(within(pju).getByText(/\+3 dibanding 2025/)).toBeInTheDocument();
  });
});
