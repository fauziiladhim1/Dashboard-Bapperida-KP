import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient, preloadPage } from '@/app/App';
import { BUILDINGS_3D, Buildings3D } from '@/components/map/Buildings3D';
import { HoverTip } from '@/components/map/MapOverlays';
import { VectorLayers } from '@/components/map/VectorLayers';
import { Breakdown, HazardCard, incomparableYears, ink, Kpi, RankBars, RoadOverview, Spark, TimeSeries, useNearViewport } from '@/features/overview/widgets';
import { ColumnMap, mapIssues, suggestMap } from '@/features/data/UploadDialog';
import { needsDecision } from '@/lib/urgency';
import { DecisionDialog } from '@/features/data/DecisionDialog';
import { PrefsProvider } from '@/lib/prefs';
import { fakeMap } from './map-mock';
import { choose, LAYERS, mockApi } from './utils';

const bare = (ui: ReactNode) => render(<QueryClientProvider client={createQueryClient()}><PrefsProvider>{ui}</PrefsProvider></QueryClientProvider>);

describe('Buildings3D: cabang style', () => {
  it('tema terang, disisipkan di bawah label pertama; tapak datar tanpa minzoom / tidak ada', () => {
    const zoomRange = vi.fn();
    (fakeMap as Record<string, unknown>).setLayerZoomRange = zoomRange;
    fakeMap.addLayer({ id: 'label-kota', type: 'symbol' });
    fakeMap.getLayer.mockImplementation(((id: string) => (id === 'building' ? {} : undefined)) as never);
    render(<Buildings3D />);
    const call = fakeMap.addLayer.mock.calls.find(([l]) => (l as { id: string }).id === BUILDINGS_3D)!;
    expect((call[0] as { paint: Record<string, unknown> }).paint['fill-extrusion-color']).toBe('#d6d6d6');
    expect(call[1]).toBe('label-kota');
    expect(zoomRange).toHaveBeenCalledTimes(1);
    expect(zoomRange).toHaveBeenCalledWith('building', 0, 15);
  });
});

describe('HoverTip: layer bertingkat', () => {
  it('nilai di bawah stop terendah tanpa label kelas; atribut tanpa label memakai nama field', () => {
    const layer = { ...LAYERS[0]!, slug: 'indeks', name: 'Indeks', fields: [], style: { color: '#000', steps: { field: 'skor', stops: [{ min: 100, label: '≥ 100 (tinggi)', color: '#f00' }] } } };
    bare(<HoverTip hover={{ x: 1, y: 1, w: 300, h: 200, feature: { source: 'src-indeks', id: 1, properties: { skor: 5 } } as never }} layers={[layer]} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('skor: 5');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('tinggi');
  });
});

describe('VectorLayers: filter gabungan & sorotan', () => {
  it('tahun + kelas tersembunyi digabung "all"; sorotan yang layernya sudah hilang tidak dihapus lagi', () => {
    const jalan = { ...LAYERS[1]!, opacity: 1, tahun: 2026, hidden: ['Baik'] };
    const { unmount } = bare(<VectorLayers layers={[jalan]} selected={{ slug: 'jalan-kabupaten', id: 4 }} />);
    expect(fakeMap.setFilter).toHaveBeenCalledWith(expect.any(String), ['all', ['==', ['to-number', ['get', 'tahun']], 2026], expect.anything()]);
    expect(fakeMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'sel-jalan-kabupaten', type: 'line' }));
    fakeMap.getLayer.mockReturnValue(false);
    fakeMap.removeLayer.mockClear();
    unmount();
    expect(fakeMap.removeLayer).not.toHaveBeenCalledWith('sel-jalan-kabupaten');
  });
});

describe('widgets Ringkasan: cabang tepi', () => {
  const inRouter = (ui: ReactNode) => bare(<MemoryRouter>{ui}</MemoryRouter>);

  it('HazardCard: luas zona tinggi; kunci kosong, multi-bahaya & luas 0 dikeluarkan, urut terluas; galat & memuat', async () => {
    mockApi({}); // nama jenis gabungan (multi-bahaya) dari GET /settings
    const rows = [{ key: null, areaHa: 9 }, { key: 'Multi-Bahaya', areaHa: 800 }, { key: 'Banjir', areaHa: 300.4 }, { key: 'Longsor', areaHa: 500 }, { key: 'Tsunami', areaHa: 0 }]
      .map((r) => ({ ...r, count: 1, lengthKm: 0 }));
    const { unmount } = inRouter(<HazardCard rows={rows} totalHa={10000} />);
    // Rincian hover ikut di DOM.
    await waitFor(() => expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Longsor500 ha5% dari luas wilayah', 'Banjir300 ha3% dari luas wilayah']));
    unmount();
    inRouter(<HazardCard rows={[]} totalHa={10000} retry={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const { container } = inRouter(<HazardCard rows={[]} totalHa={10000} loading />);
    expect(container.querySelector('.skeleton[aria-busy]')).not.toBeNull();
  });

  it('HazardCard: angka utama = multi-bahaya, klik jenis = angka jenis itu, klik lagi = kembali; tanpa multi = jenis terluas', () => {
    const rows = [{ key: 'Multi-Bahaya', areaHa: 800 }, { key: 'Banjir', areaHa: 30 }].map((r) => ({ ...r, count: 1, lengthKm: 0 }));
    const { unmount } = inRouter(<HazardCard rows={rows} totalHa={10000} />);
    expect(screen.getByText('Multi-Bahaya, 8% dari luas wilayah')).toBeInTheDocument();
    const banjir = screen.getByRole('button', { name: 'Banjir' });
    fireEvent.click(banjir);
    expect(banjir).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Banjir, <1% dari luas wilayah')).toBeInTheDocument();
    fireEvent.click(banjir);
    expect(screen.getByText('Multi-Bahaya, 8% dari luas wilayah')).toBeInTheDocument();
    unmount();
    inRouter(<HazardCard rows={rows.slice(1)} totalHa={10000} />);
    expect(screen.getByText('Banjir, <1% dari luas wilayah')).toBeInTheDocument();
  });

  it('RankBars: semua nilai 0 tidak membagi dengan nol', () => {
    const { container } = bare(<RankBars items={[{ key: 'a', label: 'A', value: 0, color: '#000' }]} format={String} />);
    expect(container.querySelector('li')).toHaveTextContent('A0');
  });

  it('RoadOverview: sorot kelas lewat hover & fokus', () => {
    inRouter(<RoadOverview network={[{ key: 'Baik', count: 2, lengthKm: 3, areaHa: 0 }]} />);
    const baik = screen.getByRole('button', { name: /^Baik/ });
    fireEvent.mouseEnter(baik);
    expect(screen.getByRole('button', { name: /^Sedang/ })).toHaveClass('opacity-50');
    fireEvent.mouseLeave(baik);
    fireEvent.focus(baik);
    expect(screen.getByRole('button', { name: /^Sedang/ })).toHaveClass('opacity-50');
    fireEvent.blur(baik);
    expect(screen.getByRole('button', { name: /^Sedang/ })).not.toHaveClass('opacity-50');
  });

  it('TimeSeries topik layer: tooltip memakai satuan fitur', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, toJSON: () => ({}) } as DOMRect);
    const points = [2024, 2025].map((tahun) => ({ tahun, miskin: 10, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: tahun - 2000 } }));
    inRouter(<TimeSeries points={points} />);
    await choose(/Analisis/, 'Jumlah Fitur Layer');
    fireEvent.mouseMove(document.querySelector('.recharts-wrapper')!, { clientX: 560, clientY: 150 });
    await waitFor(() => expect(document.querySelector('.recharts-tooltip-wrapper')?.textContent).toContain('25 fitur'));
  });

});

describe('KPI: sparkline & rincian', () => {
  it('Spark: < 2 titik tidak digambar; nilai sama digambar datar tanpa bagi nol', () => {
    const pts = (v: number[]) => v.map((value, i) => ({ label: String(2020 + i), value }));
    const { container, rerender } = render(<Spark points={pts([5])} />);
    expect(container.firstChild).toBeNull();
    rerender(<Spark points={pts([5, 5, 5])} />);
    expect(container.querySelector('polyline')!.getAttribute('points')).toBe('0,30 50,30 100,30');
  });

  it('Spark diarahkan: nilai tahun terdekat tampil, hilang saat kursor keluar', () => {
    render(<Spark points={[{ label: '2020', value: 10 }, { label: '2021', value: 20 }, { label: '2022', value: 30 }]} />);
    const area = screen.getByTestId('spark-area');
    fireEvent.pointerMove(area); // jsdom: lebar 0 -> tahun terakhir
    expect(area).toHaveTextContent('2022: 30');
    area.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.pointerMove(area, { clientX: 0 });
    expect(area).toHaveTextContent('2020: 10');
    fireEvent.pointerMove(area, { clientX: 50 });
    expect(area).toHaveTextContent('2021: 20');
    fireEvent.pointerLeave(area);
    expect(area).not.toHaveTextContent('2021');
  });

  it('Breakdown kosong tidak dirender; Kpi tanpa `to` bukan tautan', () => {
    const { container } = render(<Breakdown items={[]} total={0} />);
    expect(container.firstChild).toBeNull();
    inRouterKpi();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
const inRouterKpi = () => bare(<MemoryRouter><Kpi icon={() => null} label="Uji" value={3} format={String} /></MemoryRouter>);

describe('incomparableYears', () => {
  it('menandai tahun < 25% tahun berikutnya (kemiskinan 2024), nol & data kosong tidak', () => {
    expect([...incomparableYears([{ tahun: 2024, v: 9821 }, { tahun: 2025, v: 71432 }, { tahun: 2026, v: 67250 }])]).toEqual([2024]);
    expect(incomparableYears([{ tahun: 2024, v: 0 }, { tahun: 2025, v: 3 }]).size).toBe(0);
    expect(incomparableYears([{ tahun: 2024, v: 10 }, { tahun: 2025, v: null }, { tahun: 2026, v: 12 }]).size).toBe(0);
  });
});

describe('unggah: pencocokan kolom', () => {
  it('suggestMap mencocokkan kunci/label tanpa peduli huruf besar & tanda baca', () => {
    const fields = [{ key: 'nama_ruas', label: 'Nama Ruas', type: 'text' }, { key: 'fungsi', label: 'Fungsi Jalan', type: 'text' }, { key: 'x', label: 'X', type: 'text' }] as never;
    expect(suggestMap(fields, ['NAMA_RUAS', 'Fungsi jalan', 'LENGTH'])).toEqual({ nama_ruas: 'NAMA_RUAS', fungsi: 'Fungsi jalan' });
  });

  it('field turunan tanpa kolom = otomatis dari peta; tanpa field tidak tampil', () => {
    const kec = [{ key: 'kecamatan', label: 'Kecamatan', type: 'text' }] as never;
    const { unmount } = bare(<ColumnMap fields={kec} columns={['A']} value={{}} onChange={() => {}} />);
    expect(screen.getByText('Dihitung dari geometri saat disimpan')).toBeInTheDocument();
    unmount();
    const { container } = bare(<ColumnMap fields={[]} columns={[]} value={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('unggah: cek nilai & kolom keputusan', () => {
  it('mapIssues: angka bukan angka & pilihan di luar opsi; kolom tak dipetakan/teks dilewati', () => {
    const fields = [
      { key: 'n', label: 'N', type: 'number' }, { key: 's', label: 'S', type: 'select', options: ['A'] },
      { key: 't', label: 'T', type: 'text' }, { key: 'o', label: 'O', type: 'select' },
    ] as never;
    const sample = { type: 'FeatureCollection', features: [{ properties: { N: 'x', S: 'B', T: 1, O: 'z' } }, { properties: { N: '5', S: 'A' } }, { properties: null }] } as never;
    expect(mapIssues(fields, { n: 'N', s: 'S', t: 'T', o: 'O' }, sample)).toEqual({ n: 1, s: 1 });
    expect(mapIssues(fields, { n: 'N' })).toEqual({});
  });

  it('ColumnMap menandai nilai yang akan ditolak', () => {
    const fields = [{ key: 'n', label: 'N', type: 'number' }, { key: 's', label: 'S', type: 'select', options: ['A', 'B'] }] as never;
    bare(<ColumnMap fields={fields} columns={['N', 'S']} value={{ n: 'N', s: 'S' }} onChange={() => {}}
      sample={{ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null as never, properties: { N: 'x', S: 'C' } }] }} />);
    expect(screen.getByText('1 nilai bukan desimal; pilih kolom lain')).toBeInTheDocument();
    expect(screen.getByText('1 nilai di luar opsi (A, B); pilih kolom lain')).toBeInTheDocument();
  });

  it('needsDecision: catatan rencana, kesesuaian, field aturan urgensi; statis tidak', () => {
    const rules = { abaikan: '', aturan: [{ field: 'kondisi', tinggi: 'x', sedang: null, lainnya: null }] };
    expect(needsDecision({ category: 'Catatan Rencana', fields: [] }, undefined)).toBe(true);
    expect(needsDecision({ category: 'Tata Ruang', fields: [{ key: 'kesesuaian' }] } as never, undefined)).toBe(true);
    expect(needsDecision({ category: 'Infrastruktur', fields: [{ key: 'kondisi' }] } as never, rules)).toBe(true);
    expect(needsDecision({ category: 'Dasar', fields: [{ key: 'kecamatan' }] } as never, rules)).toBe(false);
  });
});

it('DecisionDialog kosong sampai pengaturan termuat', () => {
  mockApi({ 'GET /settings': () => new Promise(() => {}) });
  const { container } = bare(<DecisionDialog f={{ id: '1', properties: {} } as never} layer={LAYERS[1]!} subject="x" onClose={() => {}} onSaved={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it('ink: warna teks treemap dipilih dari kontras WCAG tertinggi', () => {
  expect(ink('#f57c00')).toBe('#1d2420'); // oranye: putih hanya 2,7:1
  expect(ink('#1B5E20')).toBe('#ffffff');
  expect(ink('#000000')).toBe('#ffffff');
  expect(ink('hsl(0 0% 50%)')).toBe('var(--heading)');
});

it('useNearViewport: menunggu elemen mendekati viewport, lalu melepas observer', () => {
  let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof fire) { fire = cb; } observe() {} disconnect = disconnect; });
  const { result, rerender } = renderHook(({ on }) => useNearViewport(on), { initialProps: { on: false } });
  act(() => result.current[0](document.createElement('div')));
  act(() => fire([{ isIntersecting: true }])); // belum diamati selama enabled=false
  expect(result.current[1]).toBe(false);
  rerender({ on: true });
  act(() => fire([{ isIntersecting: false }]));
  expect(result.current[1]).toBe(false);
  act(() => fire([{ isIntersecting: true }]));
  expect(result.current[1]).toBe(true);
  expect(disconnect).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('preloadPage: segmen dikenal memuat chunk halaman, segmen asing diabaikan', async () => {
  // Ditunggu: import() yang masih jalan saat environment dibongkar memicu EnvironmentTeardownError.
  await expect(preloadPage('')).resolves.toBeDefined();
  await expect(preloadPage('/peta')).resolves.toBeDefined();
  expect(preloadPage('/tidak-ada')).toBeUndefined();
});
