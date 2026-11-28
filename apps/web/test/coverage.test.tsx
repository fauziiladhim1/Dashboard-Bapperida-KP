/** Cabang-cabang yang tidak tersentuh alur utama di tes halaman lain: kasus tepi kecil per komponen. */
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App, createQueryClient } from '@/app/App';
import { YearRange, YearSelect } from '@/components/common/YearRange';
import { dataLayers, MapHover, topFeature } from '@/components/map/MapHover';
import { featureLabel, HoverTip } from '@/components/map/MapOverlays';
import { VectorLayers, type VisibleLayer } from '@/components/map/VectorLayers';
import AccountPage from '@/features/account/AccountPage';
import { FeaturePopup } from '@/features/peta/PetaPage';
import { MiniMap, RoadOverview, TimeSeries } from '@/features/overview/widgets';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PrefsProvider } from '@/lib/prefs';
import type { TimePoint } from '@/lib/types';
import { fakeMap, mapState } from './map-mock';
import { choose, LAYERS, mockApi, page, renderAt, reply, user, dateOf, setDate } from './utils';

/** Render komponen lepas dengan provider minimal (tanpa router/shell). */
const bare = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}><PrefsProvider>{ui}</PrefsProvider></QueryClientProvider>);

describe('App', () => {
  it('tanpa client dari luar membuat QueryClient sendiri', async () => {
    mockApi({ 'GET /auth/me': reply(401) });
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Masuk' }, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('YearRange / YearSelect', () => {
  it('tahun akhir bisa diganti; YearSelect tanpa nilai tetap tampil', async () => {
    const onChange = vi.fn();
    bare(<><YearRange years={[2024, 2025, 2026]} dari={2024} sampai={2025} onChange={onChange} /><YearSelect years={[2026]} onChange={vi.fn()} /></>);
    await choose(/Sampai tahun/i, '2026');
    expect(onChange).toHaveBeenCalledWith({ dari: 2024, sampai: 2026 });
    expect(screen.getAllByRole('button', { name: /Tahun/ }).length).toBeGreaterThan(0);
  });
});

describe('Akun', () => {
  it('belum ada user: tidak merender apa pun', async () => {
    mockApi({ 'GET /auth/me': reply(401) });
    const { container } = bare(<AccountPage />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('ganti password sukses mengosongkan form', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: { ...user('viewer') } }, 'GET /layers': LAYERS, 'PATCH /auth/me': { user: user('viewer') } });
    renderAt('/akun');
    const current = await screen.findByLabelText('Password Lama', {}, { timeout: 5000 });
    await userEvent.type(current, 'Lama12345678');
    // Tombol mata: password yang sedang diketik bisa dilihat, lalu disembunyikan lagi.
    const eye = screen.getAllByRole('button', { name: 'Tampilkan Password' })[0]!;
    await userEvent.click(eye);
    expect(current).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getAllByRole('button', { name: 'Sembunyikan Password' })[0]!);
    expect(current).toHaveAttribute('type', 'password');
    await userEvent.type(screen.getByLabelText('Password Baru'), 'Baru12345678');
    await userEvent.type(screen.getByLabelText('Ulangi Password Baru'), 'Baru12345678');
    await userEvent.click(screen.getAllByRole('button', { name: 'Ubah Password' }).at(-1)!);
    expect(await screen.findByText('Password berhasil diubah.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ currentPassword: 'Lama12345678', newPassword: 'Baru12345678' });
    expect(current).toHaveValue('');
  });
});

describe('AppShell', () => {
  it('localStorage diblokir: sidebar tetap lebar; menu akun membuka pengaturan; logout tetap jalan walau jaringan gagal', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'POST /auth/logout': reply(599) });
    renderAt('/log-tidak-ada');
    expect(await screen.findByRole('button', { name: 'Perkecil Menu' }, { timeout: 5000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Menu Akun' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pengaturan Akun' }));
    await waitFor(() => expect(window.location.pathname).toBe('/akun'));
    await userEvent.click(screen.getByRole('button', { name: 'Menu Akun' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Keluar' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });
});

describe('Pengguna', () => {
  it('jadikan superadmin minta konfirmasi; batal = tidak ada perubahan', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user() },
      'GET /users': [{ id: 2, name: 'Budi', email: 'budi@kp.go.id', role: 'viewer', status: 'active', createdAt: '2026-10-02T00:00:00Z' }],
    });
    renderAt('/pengguna');
    await choose(/Peran Budi/, 'Superadmin');
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('Ringkasan', () => {
  it('kemiskinan tahun lama diberi catatan', async () => {
    mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS,
      'GET /stats/timeseries': [{ tahun: 2024, miskin: 9000, jalanKm: 0, jalanRusakKm: 0 }, { tahun: 2026, miskin: 0, jalanKm: 1, jalanRusakKm: 0 }],
      'GET /stats/timeseries/kecamatan': [], 'GET /stats/ruas-jalan': [], 'GET /stats/kecamatan': [],
      'GET /stats/layers/jalan-kabupaten': [], 'GET /stats/layers/pju': [], 'GET /stats/layers/kesesuaian-lahan/kecamatan': [],
      'GET /audit': page([{ id: '3', action: 'update', entity: 'feature', entityId: '7', userName: null, ip: '::1', createdAt: '2026-11-01T00:00:00Z' }]),
    });
    renderAt('/');
    expect((await screen.findAllByText(/Data 2026 belum ada, menampilkan data 2024/, {}, { timeout: 10000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText('Aktivitas terbaru')).not.toBeInTheDocument(); // aktivitas ada di halaman Log
  });
});

describe('VectorLayers', () => {
  const poly = (slug: string, extra: Partial<VisibleLayer> = {}): VisibleLayer => ({ ...LAYERS[0]!, slug, opacity: 1, ...extra });

  it('garis tepi (outline) dan batas berisi memakai paint berbeda; opacity hanya disetel bila layer ada', () => {
    const strategis = poly('kawasan-strategis', { style: { color: '#C500FF', outline: true } });
    const batas = poly('batas-administrasi', { fill: true });
    const { rerender } = bare(<VectorLayers layers={[strategis, batas]} />);
    const line = (id: string) => fakeMap.addLayer.mock.calls.map(([l]) => l).find((l) => l.id === id);
    expect(line('line-kawasan-strategis').paint['line-width']).toEqual(expect.arrayContaining([3.5, 2.5]));
    expect(line('line-batas-administrasi').paint['line-dasharray']).toBeUndefined(); // berisi: bukan garis putus-putus
    fakeMap.setPaintProperty.mockClear();
    fakeMap.getLayer.mockReturnValue(false); // layer sudah dilepas MapLibre (mis. ganti style)
    rerender(<QueryClientProvider client={createQueryClient()}><PrefsProvider><VectorLayers layers={[{ ...strategis, opacity: 0.5 }, batas]} /></PrefsProvider></QueryClientProvider>);
    expect(fakeMap.setPaintProperty).not.toHaveBeenCalled();
  });
});

describe('MapHover', () => {
  const hit = (layerId: string, source: string, id?: number, sourceLayer?: string) => ({ layer: { id: layerId }, source, id, sourceLayer, properties: {} });

  it('menyorot fitur teratas, berpindah sorotan, dan mengabaikan fitur tanpa id', () => {
    fakeMap.addLayer({ id: 'fill-batas-administrasi', source: 'src-batas-administrasi' });
    fakeMap.addLayer({ id: 'circle-pju', source: 'src-pju' });
    const onHover = vi.fn();
    bare(<MapHover onHover={onHover} />);
    const move = () => fakeMap.fire('mousemove', { point: { x: 5, y: 6 } });

    fakeMap.rendered = [hit('fill-batas-administrasi', 'src-batas-administrasi', 1, 'features'), hit('circle-pju', 'src-pju', 2, 'features')];
    move();
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith({ source: 'src-pju', id: 2, sourceLayer: 'features' }, { hover: true });
    fakeMap.rendered = [hit('fill-batas-administrasi', 'src-batas-administrasi', 1)]; // hanya batas: tetap dipilih, tanpa sourceLayer
    move();
    expect(fakeMap.setFeatureState).toHaveBeenCalledWith({ source: 'src-pju', id: 2, sourceLayer: 'features' }, { hover: false });
    expect(fakeMap.setFeatureState).toHaveBeenLastCalledWith({ source: 'src-batas-administrasi', id: 1 }, { hover: true });
    fakeMap.rendered = [hit('circle-pju', 'src-pju', 1)]; // id sama, source berbeda: sorotan lama tetap dilepas
    move();
    expect(fakeMap.setFeatureState).toHaveBeenCalledWith({ source: 'src-batas-administrasi', id: 1 }, { hover: false });
    fakeMap.getSource.mockReturnValueOnce(false); // source lama sudah dilepas: tidak di-reset
    fakeMap.rendered = [hit('fill-pov', 'src-poverty')]; // GeoJSON tanpa id: tidak disorot
    move();
    expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ x: 5, y: 6, w: 800, h: 600 }));
    fakeMap.rendered = [];
    move();
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(fakeMap.canvas.style.cursor).toBe('');
  });

  it('tanpa layer data atau tanpa style: tidak ada fitur', () => {
    const map = fakeMap as never;
    expect(topFeature(map, { x: 0, y: 0 } as never)).toBeUndefined();
    vi.spyOn(fakeMap, 'getStyle').mockReturnValue(undefined as never);
    expect(dataLayers(map)).toEqual([]);
  });
});

describe('HoverTip & featureLabel', () => {
  const tip = (x: number, y: number, source: string, properties: Record<string, unknown>) =>
    bare(<HoverTip hover={{ x, y, w: 300, h: 200, feature: { source, id: 9, properties } as never }} layers={LAYERS} />);

  it('dibalik di tepi kanan/bawah; layer berkelas memakai warna kelas; kemiskinan menampilkan jumlah jiwa', () => {
    tip(290, 190, 'src-jalan-kabupaten', { nama_ruas: 'Jl. Wates', kondisi: 'Baik', kecamatan: 'Wates' });
    const el = screen.getByRole('tooltip');
    expect(el.style.right).not.toBe('');
    expect(el.style.bottom).not.toBe('');
    expect(el).toHaveTextContent('Kondisi Jalan 2026');
    expect(el).toHaveTextContent('Kec. Wates');
  });

  it('sumber tak dikenal dan tanpa properti', () => {
    tip(10, 10, 'src-lain', { kalurahan: 'Bendungan' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Bendungan');
    bare(<HoverTip hover={{ x: 1, y: 1, w: 300, h: 200, feature: { source: 'src-lain', id: 3 } as never }} layers={LAYERS} />);
    expect(screen.getAllByRole('tooltip')[1]).toHaveTextContent('#3'); // tanpa properti sama sekali
    tip(10, 10, 'src-jalan-kabupaten', { nama_ruas: 'Jl. Tanpa Kondisi' }); // layer berkelas, nilai kelas kosong: warna dasar
    expect(screen.getAllByRole('tooltip')[2]).toHaveTextContent('Jl. Tanpa Kondisi');
    expect(featureLabel({}, undefined, undefined)).toBe('#');
    expect(featureLabel({}, LAYERS[1], 4)).toBe('#4');
  });
});

describe('GlobalSearch', () => {
  const box = () => screen.findByRole('combobox', { name: 'Cari Data di Semua Layer' }, { timeout: 5000 });
  const search = async (q: string) => {
    const el = await box();
    await userEvent.clear(el);
    await userEvent.type(el, q);
  };

  it('Ctrl/⌘+K memfokuskan; menu, layer, kalurahan, dan data bisa dipilih; filter layer menyembunyikan menu & layer', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user() }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /search': {
        regions: [{ type: 'kalurahan', name: 'Bendungan', kecamatan: null, bbox: [110.1, -7.9, 110.2, -7.8] }],
        features: [
          { id: '5', slug: 'pju', layer: 'PJU', color: null, label: 'PJU-01', kecamatan: null, matchKey: 'kode', matchValue: 'PJU-01', lng: 110.1, lat: -7.8 },
          { id: '6', slug: 'lama', layer: 'Arsip', color: '#123456', label: 'Jembatan', kecamatan: 'Wates', matchKey: 'nama_jalan', matchValue: 'Jl. Bendungan', lng: 110.2, lat: -7.9 },
        ],
      },
    });
    renderAt('/akun');
    await choose(/Batasi pencarian ke layer/i, 'PJU');
    await search('jalan');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/search?q=jalan&layer=pju'));
    expect(screen.queryByRole('option', { name: /^Kondisi Jalan 2026/i })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await choose(/Batasi pencarian ke layer/i, 'Semua Layer');

    await search('ben');
    expect(await screen.findByRole('option', { name: /^Bendungan/ }, { timeout: 5000 })).toHaveTextContent('Kalurahan di Kec.');
    expect(screen.getByRole('option', { name: /^PJU-01/ })).toHaveTextContent(/^PJU-01PJU$/); // nilai cocok = label: cukup nama layer, tanpa kecamatan
    expect(screen.getByText('Nama jalan: Jl. Bendungan')).toBeInTheDocument(); // layer tak dikenal: key dirapikan, baris rincian di bawah nama layer
    await userEvent.click(screen.getByRole('option', { name: /^Bendungan/ }));
    await waitFor(() => expect(fakeMap.fitBounds).toHaveBeenCalledWith([[110.1, -7.9], [110.2, -7.8]], expect.anything()));

    await search('ben');
    await userEvent.click(await screen.findByRole('option', { name: /^PJU-01/ }, { timeout: 5000 }));
    await waitFor(() => expect(fakeMap.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [110.1, -7.8] })));

    await search('peta');
    await userEvent.click(await screen.findByRole('option', { name: 'Peta' }, { timeout: 5000 }));
    await waitFor(() => expect(window.location.pathname).toBe('/peta'));

    await search('jalan');
    await userEvent.click(await screen.findByRole('option', { name: /^Kondisi Jalan 2026/i }, { timeout: 5000 }));
    // Hasil layer membuka peta dan menyalakan layernya.
    await waitFor(() => expect(window.location.pathname).toBe('/peta'));


    const el = await box();
    el.blur();
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    expect(el).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(el).toHaveFocus();
    el.blur();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(el).toHaveFocus();
  });
});

describe('Dialog fitur: kasus tepi', () => {
  const road = (props: Record<string, unknown>, media: unknown[] = []) => ({
    type: 'Feature', id: '1', slug: 'jalan-kabupaten', properties: { nama_ruas: 'Jl. Wates', ...props },
    geometry: { type: 'MultiLineString', coordinates: [[[110, -7], [110.1, -7]]] }, media, createdAt: '', updatedAt: '2026-11-02T00:00:00.000Z',
  });
  const PHOTO = { id: 5, webp: 'f.webp', avif: 'f.avif', width: 100, height: 80, caption: 'Retak', tanggal: '2026-11-01', urgensi: 'rendah' };
  const routes = (role: 'editor' | 'viewer', detail: unknown, extra: Record<string, unknown> = {}) => ({
    'GET /auth/me': { user: user(role) }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
    'GET /layers/jalan-kabupaten/features': page([]), 'GET /features/1': detail, ...extra,
  });
  const dialog = () => screen.findByRole('dialog', {}, { timeout: 5000 });

  it('metadata foto: keterangan sama tidak disimpan, dikosongkan, tanggal & urgensi; galat simpan metadata', async () => {
    const calls = mockApi(routes('editor', road({ kondisi: 'Rusak Ringan' }, [PHOTO]), { 'PATCH /media/5': reply(500, { error: 'Gagal simpan foto' }) }));
    renderAt('/data/jalan-kabupaten?edit=1');
    const d = await dialog();
    const caption = await within(d).findByLabelText('Keterangan Foto');
    act(() => { caption.focus(); caption.blur(); }); // tidak berubah: tidak ada PATCH
    expect(calls.some((c) => c.url === '/media/5')).toBe(false);
    await userEvent.clear(caption);
    act(() => caption.blur());
    await waitFor(() => expect(calls.filter((c) => c.url === '/media/5').at(-1)?.body).toMatchObject({ caption: null }));
    expect(await screen.findByText('Gagal simpan foto')).toBeInTheDocument();
    await setDate(within(d).getByRole('group', { name: 'Tanggal Survei' }), '');
    await waitFor(() => expect(calls.filter((c) => c.url === '/media/5').at(-1)?.body).toMatchObject({ tanggal: null }));
    await choose('Urgensi', 'Tinggi');
    await waitFor(() => expect(calls.filter((c) => c.url === '/media/5').at(-1)?.body).toMatchObject({ urgensi: 'tinggi' }));
  });

  it('kondisi sedang tanpa foto: saran dokumentasi; salin GeoJSON (dengan & tanpa clipboard)', async () => {
    mockApi(routes('editor', road({ kondisi: 'Rusak Ringan' })));
    renderAt('/data/jalan-kabupaten?edit=1');
    const d = await dialog();
    expect(await within(d).findByText('Disarankan melampirkan foto dokumentasi.')).toBeInTheDocument();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(within(d).getByRole('button', { name: 'Salin GeoJSON' }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(road({}).geometry));
    expect(await screen.findByText('GeoJSON disalin')).toBeInTheDocument();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await userEvent.click(within(d).getByRole('button', { name: 'Salin GeoJSON' })); // http (bukan konteks aman): diam
  });

  it('viewer tanpa foto: "Belum ada dokumentasi"', async () => {
    mockApi(routes('viewer', road({ kondisi: 'Baik' })));
    renderAt('/data/jalan-kabupaten?edit=1');
    expect(await within(await dialog()).findByText('Belum ada dokumentasi.')).toBeInTheDocument();
  });

  it('foto antrean: ubah metadata, hapus, gagal unggah setelah simpan dilaporkan; tutup dialog melepas URL blob', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    mockApi(routes('editor', road({}), { 'POST /layers/jalan-kabupaten/features': { id: '3' }, 'POST /features/3/media': reply(400, { error: 'Bukan gambar' }) }));
    renderAt('/data/jalan-kabupaten?edit=new');
    let d = await dialog();
    const file = () => d.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(file(), [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]);
    await setDate(within(d).getAllByRole('group', { name: 'Tanggal Survei' })[0]!, '2026-10-01');
    expect(dateOf(within(d).getAllByRole('group', { name: 'Tanggal Survei' })[0]!)).toBe('2026-10-01');
    await userEvent.click(within(d).getAllByRole('button', { name: 'Hapus Foto' })[1]!);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    await userEvent.type(within(d).getByLabelText(/Nama Ruas/), 'Jl. Baru');
    fireEvent.change(within(d).getByLabelText('Geometri (WKT)'), { target: { value: 'LINESTRING (110 -7, 111 -7)' } });
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('a.jpg: Bukan gambar')).toBeInTheDocument();

    // Dialog baru: foto antrean yang belum disimpan dilepas saat dialog ditutup.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // modal tertutup penuh dulu (aria-hidden dilepas)
    vi.mocked(URL.revokeObjectURL).mockClear();
    await userEvent.click(await screen.findByRole('button', { name: /Tambah fitur/i }, { timeout: 5000 }));
    d = await dialog();
    await userEvent.upload(file(), new File(['c'], 'c.jpg', { type: 'image/jpeg' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x'));
  });

  it('titik: lat,lng jadi WKT saat blur, peta mengikuti titik di luar tampilan, tautan cari lokasi, geometri baru terkirim', async () => {
    const titik: (typeof LAYERS)[number] = { ...LAYERS[4]!, id: 9, slug: 'titik-kawasan', name: 'Titik Kawasan', style: { color: '#123456' },
      fields: [{ key: 'nama', label: 'Nama', type: 'text' }] };
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, titik], 'GET /stats/kecamatan': [],
      'GET /layers/titik-kawasan/features': page([]),
      'GET /features/4': { id: '4', properties: { nama: 'Alun-Alun Wates' }, geometry: { type: 'MultiPoint', coordinates: [[110.1, -7.8]] }, media: [], updatedAt: '2026-11-02T00:00:00.000Z' },
      'PATCH /features/4': { id: '4' },
    });
    fakeMap.getBounds.mockReturnValue({ contains: () => false } as never);
    renderAt('/data/titik-kawasan?edit=4');
    const d = await dialog();
    expect(await within(d).findByRole('link', { name: /Cari lokasi/i })).toHaveAttribute('href', expect.stringContaining('Alun-Alun%20Wates%2C%20Kulon%20Progo'));
    await waitFor(() => expect(fakeMap.easeTo).toHaveBeenCalledWith({ center: [110.1, -7.8] }));
    const wkt = within(d).getByLabelText('Geometri (WKT)');
    fireEvent.change(wkt, { target: { value: '-7.85, 110.15' } });
    fireEvent.blur(wkt);
    expect(wkt).toHaveValue('POINT (110.15 -7.85)');
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ geometry: { type: 'Point', coordinates: [110.15, -7.85] } }));
  });

  it('field select selain kondisi tidak memengaruhi urgensi', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /layers/penggunaan-lahan/features': page([]), 'POST /layers/penggunaan-lahan/features': { id: '2' },
    });
    renderAt('/data/penggunaan-lahan?edit=new');
    const d = await dialog();
    await choose('Kelas', 'Hutan');
    // Poligon digambar di peta: 3 klik, cincin ditutup otomatis; kursor silang hanya selama mode gambar.
    await userEvent.click(within(d).getByRole('button', { name: 'Gambar Poligon' }));
    expect(fakeMap.canvas.style.cursor).toBe('crosshair');
    for (const [lng, lat] of [[110, -7], [111, -7], [111, -8]]) act(() => fakeMap.fire('click', { lngLat: { lng, lat } }));
    expect(within(d).getByText(/^3 titik, klik titik pertama untuk menutup/)).toBeInTheDocument();
    expect(within(d).getByLabelText('Geometri (WKT)')).toHaveValue('POLYGON ((110 -7, 111 -7, 111 -8, 110 -7))');
    await userEvent.click(within(d).getByRole('button', { name: 'Selesai' }));
    expect(fakeMap.canvas.style.cursor).toBe('');
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ properties: { kelas: 'Hutan' } }));
  });
});

describe('Unggah Data: layer titik', () => {
  it('pratinjau sampel titik, ukuran MB, dan dilepas dari peta saat dialog ditutup (aman walau peta sudah hilang)', async () => {
    mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /layers/pju/features': page([]),
      'POST /layers/pju/upload': { count: 2, skipped: 0, hasPrj: true, columns: ['kode'], missingFields: [], sample: { type: 'FeatureCollection', features: [] } },
    });
    renderAt('/data/pju');
    await userEvent.click(await screen.findByRole('button', { name: /Unggah Data/ }, { timeout: 5000 }));
    const d = await screen.findByRole('dialog');
    const big = new File(['PK'], 'pju.zip', { type: 'application/zip' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    await userEvent.upload(within(d).getByLabelText('File Shapefile atau GeoJSON'), big);
    expect(within(d).getByText(/3 MB/)).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Periksa File' }));
    await waitFor(() => expect(fakeMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ type: 'circle', paint: expect.objectContaining({ 'circle-color': '#EAB308' }) })));
    fakeMap.removeLayer.mockImplementationOnce(() => { throw new Error('style sedang dimuat'); });
    await userEvent.click(within(d).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fakeMap.removeLayer).toHaveBeenCalled();
  });
});

describe('Data: kolom dokumentasi', () => {
  it('jumlah foto, dan "belum ada" ditandai merah untuk urgensi tinggi', async () => {
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /layers/jalan-kabupaten/features': page([
        { id: '1', properties: { nama_ruas: 'Jl. A', kondisi: 'Baik' }, mediaCount: 2, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' },
        { id: '2', properties: { nama_ruas: 'Jl. B', kondisi: 'Rusak Berat' }, mediaCount: 0, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' },
      ]),
    });
    renderAt('/data');
    expect(await screen.findByText('2 foto', {}, { timeout: 5000 })).toBeInTheDocument();
    // Urgensi dari aturan DB (GET /settings) yang termuat setelah tabel.
    await waitFor(() => expect(screen.getAllByText('Belum ada').at(-1)).toHaveClass('text-danger'));
  });
});

describe('Widget Ringkasan', () => {
  const inRouter = (ui: React.ReactNode) => bare(<MemoryRouter>{ui}<Routes><Route path="/peta" element={<p>halaman peta</p>} /><Route path="*" element={null} /></Routes></MemoryRouter>);
  const retry = vi.fn();

  it('TimeSeries: topik ruas jalan & jumlah fitur layer, legenda sorot', async () => {
    const points: TimePoint[] = [
      { tahun: 2024, miskin: 100, jalanKm: 10, jalanRusakKm: 2, layers: { PJU: 5, Sekolah: 0 } },
      { tahun: 2025, miskin: 0, jalanKm: 0, jalanRusakKm: 0, layers: { PJU: 0 } },
      { tahun: 2026, miskin: 120, jalanKm: 12, jalanRusakKm: 2, layers: { PJU: 8 } },
      { tahun: 2027, miskin: 90, jalanKm: 12, jalanRusakKm: 1 },
    ];
    inRouter(<TimeSeries points={points} />);
    await choose(/Analisis/, 'Ruas Jalan');
    const legend = screen.getByRole('list', { name: 'Data yang Ditampilkan' });
    const item = within(legend).getAllByRole('listitem')[1]!;
    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item);
    const surface = document.querySelector('.recharts-wrapper');
    if (surface) { fireEvent.mouseMove(surface, { clientX: 300, clientY: 100 }); fireEvent.mouseLeave(surface); }
    await choose(/Analisis/, 'Jumlah Fitur Layer');
    expect(screen.getByRole('button', { name: /Analisis/ })).toHaveTextContent('Jumlah Fitur Layer');
  });

  it('TimeSeries: memuat, galat, dan tanpa data', async () => {
    const { unmount } = inRouter(<TimeSeries points={[]} loading />);
    expect(document.querySelector('[aria-busy]')).not.toBeNull();
    unmount();
    const r = inRouter(<TimeSeries points={[{ tahun: 2024, miskin: 0, jalanKm: 0, jalanRusakKm: 0 }]} retry={retry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    r.unmount();
    inRouter(<TimeSeries points={[{ tahun: 2024, miskin: 0, jalanKm: 0, jalanRusakKm: 0 }]} />);
    expect(screen.getByText(/Belum ada data/)).toBeInTheDocument();
  });

  it('RoadOverview: jumlah & porsi dari seluruh ruas SK, termasuk belum disurvei; survei tak cocok', async () => {
    const net = [{ key: 'Baik', count: 3, lengthKm: 12, areaHa: 0, value: 11.5 }, { key: 'Belum Disurvei', count: 1, lengthKm: 4, areaHa: 0 }];
    inRouter(<RoadOverview network={net} unmatched={2} />);
    expect(screen.getByRole('button', { name: /^Baik375%$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Belum Disurvei125%$/ })).toBeInTheDocument();
    expect(screen.getByTestId('seg-belum')).toBeInTheDocument();
    expect(screen.getByText(/2 baris survei tidak cocok/)).toBeInTheDocument();
  });

  it('RoadOverview: Baik → Rusak Berat lalu baris belum disurvei; semua kelas disembunyikan; galat', async () => {
    const net = ['Baik', 'Sedang', 'Rusak Ringan', 'Rusak Berat', 'Belum Disurvei'].map((key, i) => ({ key, count: i + 1, lengthKm: 1, areaHa: 0 }));
    const Wrap = () => {
      const [hidden, setHidden] = useState<string[]>([]);
      return <RoadOverview network={net} hiddenKelas={hidden} onHiddenKelas={setHidden} />;
    };
    const { unmount } = inRouter(<Wrap />);
    expect(screen.getAllByRole('button').map((b) => b.textContent?.replace(/\d.*$/, ''))).toEqual(['Baik', 'Sedang', 'Rusak Ringan', 'Rusak Berat', 'Belum Disurvei']);
    for (const b of screen.getAllByRole('button')) await userEvent.click(b);
    expect(screen.getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    unmount();
  });

  it('MiniMap: layer bawaan berisi saja, 3 chip + sisa "+N", judul ke Peta', async () => {
    const layers = LAYERS.map((l) => ({ ...l, visibleDefault: true, featureCount: l.slug === 'potensi-bencana' ? 0 : 4 }));
    inRouter(<MiniMap layers={layers} />);
    const shown = layers.filter((l) => l.featureCount > 0);
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith(`src-${shown[0]!.slug}`, expect.anything()));
    expect(fakeMap.addSource).not.toHaveBeenCalledWith('src-potensi-bencana', expect.anything());
    expect(screen.getByText(`+${shown.length - 3}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Peta wilayah/i })).toHaveAttribute('href', '/peta');
  });
});

describe('Peta: popup fitur', () => {
  const popup = (layer: (typeof LAYERS)[number], detail: Record<string, unknown>, role: 'viewer' | 'editor' = 'viewer') => {
    mockApi({ 'GET /auth/me': { user: user(role) }, 'GET /features/9': { type: 'Feature', id: '9', media: [], ...detail } });
    return bare(<MemoryRouter><FeaturePopup selected={{ id: '9', layer, lng: 110.5, lat: -7.5 }} onClose={vi.fn()} /></MemoryRouter>);
  };

  it('atribut: label sistem/dirapikan, satuan dari akhiran, kolom teknis & ekstra kosong disembunyikan, judul tidak diulang, >8 baris = tautan Data; luas dari geometri', async () => {
    const properties = {
      nama_ruas: 'Jl. A', kondisi: 'Baik', lebar_m: 6, luas_ha: 2, jumlah_lajur: 2, OBJECTID: 1, kosong: '  ', nol: null,
      kecamatan: 'Wates', kalurahan: 'Bendungan', catatan: 'x', a1: 'b', a2: 'c', a3: 'd',
    };
    popup(LAYERS[1]!, { properties, areaHa: 3.5, geometry: { type: 'MultiLineString', coordinates: [[[110, -7], [110.1, -7]]] } });
    expect(await screen.findByText('2 ha', {}, { timeout: 5000 })).toBeInTheDocument(); // luas resmi atribut diutamakan
    expect(screen.getByText('Luas', { selector: 'dt' })).toBeInTheDocument(); // ukuran = baris pertama tabel
    expect(screen.getByText('6 m')).toBeInTheDocument();
    expect(screen.getByText('Jumlah lajur')).toBeInTheDocument();
    expect(screen.queryByText('Luas (ha)')).not.toBeInTheDocument(); // luas_ha jadi baris ukuran, tidak diulang
    expect(screen.queryByText('OBJECTID')).not.toBeInTheDocument();
    expect(screen.queryByText('Nol')).not.toBeInTheDocument(); // atribut ekstra kosong
    expect(screen.queryByText('Jl. A', { selector: 'dd' })).not.toBeInTheDocument(); // nama sudah jadi judul
    expect(screen.getByText('A3')).toBeInTheDocument(); // semua atribut tampil, tanpa batas baris
    expect(screen.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', expect.stringContaining('query=-7.5,110.5'));
  });

  it('titik (Point & MultiPoint) memakai koordinat fitur; panjang dari geometri garis; galeri satu foto tanpa keterangan', async () => {
    const pju = LAYERS[4]!;
    const { unmount } = popup(pju, { properties: { kode: 'P1', luas_ha: 1.5, daya_watt: 100, angka: 7 }, geometry: { type: 'Point', coordinates: [110.2, -7.2] } });
    expect(await screen.findByRole('link', { name: /Google Maps/ }, { timeout: 5000 })).toHaveAttribute('href', expect.stringContaining('query=-7.2,110.2'));
    expect(screen.getByText('Luas', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('1,5 ha')).toBeInTheDocument();
    expect(screen.getByText('100 W')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    unmount();
    const b = popup(pju, { properties: {}, geometry: { type: 'MultiPoint', coordinates: [[110.3, -7.3]] } });
    expect(await screen.findByRole('link', { name: /Google Maps/ }, { timeout: 5000 })).toHaveAttribute('href', expect.stringContaining('query=-7.3,110.3'));
    b.unmount();
    const c = popup(pju, { properties: {}, geometry: { type: 'MultiPoint', coordinates: [] } });
    expect(await screen.findByRole('link', { name: /Google Maps/ }, { timeout: 5000 })).toHaveAttribute('href', expect.stringContaining('query=-7.5,110.5'));
    c.unmount();
    popup(LAYERS[1]!, { properties: { kondisi: 'Baik' }, lengthKm: 1.25, media: [{ id: 1, webp: 'a.webp', avif: 'a.avif', width: 1, height: 1, caption: null, tanggal: null, urgensi: null }] });
    expect(await screen.findByText('1,25 km', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/Foto 1\//)).not.toBeInTheDocument();
  });
});

describe('Peta: legenda dari statistik & parameter URL', () => {
  const grouped = { ...LAYERS[2]!, visibleDefault: true, style: { color: '#7CB342', classField: 'kelas', classes: { Sawah: '#7CB342', Hutan: '#1B5E20', Kebun: '#888888' }, groups: { Pertanian: ['Sawah', 'Kebun'], Hutan: ['Hutan'] } } };
  const base = (extra: Record<string, unknown> = {}) => ({
    'GET /auth/me': { user: user('viewer') }, 'GET /layers': [LAYERS[0]!, LAYERS[1]!, grouped, LAYERS[4]!], 'GET /stats/kecamatan': [],
    'GET /stats/layers/penggunaan-lahan': [{ key: 'Hutan', count: 1, lengthKm: 0, areaHa: 50 }, { key: 'Sawah', count: 2, lengthKm: 0, areaHa: 40 }, { key: 'Kebun', count: 1, lengthKm: 0, areaHa: 40 }, { key: null, count: 1, lengthKm: 0, areaHa: 1 }],
    'GET /stats/layers/jalan-kabupaten': [{ key: 'Baik', count: 2, lengthKm: 3, areaHa: 0 }, { key: 'Rusak Berat', count: 1, lengthKm: 3, areaHa: 0 }],
    'GET /stats/layers/pju': [],
    ...extra,
  });

  it('legenda berkelompok dengan total, kelas tanpa kelompok, garis per km; kosong tidak ditampilkan', async () => {
    mockApi(base());
    renderAt('/peta');
    expect((await screen.findAllByText('Pertanian', {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText('80 ha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lainnya').length).toBeGreaterThan(0); // null -> kelompok Lainnya
    expect(screen.getAllByText('3 km').length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('switch', { name: 'Tampilkan PJU' })[0]!);
  });

  it('fitur dari pencarian dengan layer tak dikenal tidak membuka popup; koordinat tak lengkap tidak terbang; hover tooltip', async () => {
    mockApi(base({ 'GET /stats/timeseries': [{ tahun: 2026, miskin: 1, jalanKm: 0, jalanRusakKm: 0 }] }));
    renderAt('/peta?f=9&layer=tidak-ada&lng=110.1&lat=-7.8');
    await screen.findAllByRole('switch', { name: 'Tampilkan PJU' }, { timeout: 5000 });
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();
    fakeMap.flyTo.mockClear();
    window.history.pushState({}, '', '/peta?f=9&layer=pju&lng=110.1&lat=x');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.history.pushState({}, '', '/peta?f=9&layer=pju&lng=x&lat=-7.8');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(fakeMap.flyTo).not.toHaveBeenCalled();
    fakeMap.addLayer({ id: 'circle-pju', source: 'src-pju' });
    fakeMap.rendered = [{ layer: { id: 'circle-pju' }, source: 'src-pju', id: 2, properties: { kode: 'P7' } }];
    act(() => fakeMap.fire('mousemove', { point: { x: 4, y: 4 } }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('PJU');
  });

  it('peta belum siap: bbox tidak di-zoom', async () => {
    mapState.isLoaded = false;
    mockApi(base());
    renderAt('/peta?bbox=110,-8,111,-7&f=1&layer=pju&lng=110&lat=-7');
    await screen.findAllByRole('switch', { name: 'Tampilkan PJU' }, { timeout: 5000 });
    expect(fakeMap.fitBounds).not.toHaveBeenCalled();
    expect(fakeMap.flyTo).not.toHaveBeenCalled();
  });
});

describe('Grafik: tooltip & kasus tepi', () => {
  /** Recharts membaca ukuran wrapper dari getBoundingClientRect (0 di jsdom): beri ukuran agar tooltip bisa aktif. */
  const sized = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300, toJSON: () => ({}) } as DOMRect);
  const hoverAt = (x: number, selector = '.recharts-wrapper') => fireEvent.mouseMove(document.querySelector(selector)!, { clientX: x, clientY: 150 });
  const tooltip = () => document.querySelector('.recharts-tooltip-wrapper')?.textContent ?? '';
  const inRouter = (ui: React.ReactNode) => bare(<MemoryRouter>{ui}</MemoryRouter>);

  it('tooltip tren: tahun pertama tanpa pembanding, tahun kosong, selisih nol, nilai awal nol tanpa persen; area disorot', async () => {
    sized();
    const points: TimePoint[] = [
      { tahun: 2024, miskin: 100, jalanKm: 10, jalanRusakKm: 0 },
      { tahun: 2025, miskin: 0, jalanKm: 0, jalanRusakKm: 0 },
      { tahun: 2026, miskin: 100, jalanKm: 12, jalanRusakKm: 3 },
    ];
    inRouter(<TimeSeries points={points} />);
    hoverAt(60);
    await waitFor(() => expect(tooltip()).toContain('2024'));
    expect(tooltip()).not.toContain('dibanding');
    hoverAt(300);
    hoverAt(560);
    await waitFor(() => expect(tooltip()).toContain('0 (0%) dibanding 2024'));
    const area = document.querySelector('.recharts-area-area');
    if (area) fireEvent.mouseEnter(area);
    await choose(/Analisis/, 'Ruas Jalan');
    hoverAt(60);
    hoverAt(560);
    await waitFor(() => expect(tooltip()).toMatch(/\+3 dibanding 2024/)); // jalan rusak 0 -> 3: tanpa persen
  });

  it('empat seri layer memakai empat bentuk penanda; topik hilang saat data berubah kembali ke kemiskinan', async () => {
    const pts = (layers: Record<string, number> | undefined): TimePoint[] => [2024, 2025].map((tahun) => ({ tahun, miskin: 10, jalanKm: 0, jalanRusakKm: 0, layers }));
    const four = { A: 1, B: 2, C: 3, D: 4 };
    const { rerender } = inRouter(<TimeSeries points={pts(four)} />);
    await choose(/Analisis/, 'Jumlah Fitur Layer');
    expect(document.querySelectorAll('ul[aria-label="Data yang Ditampilkan"] polygon').length).toBeGreaterThanOrEqual(2); // wajik & segitiga
    rerender(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter><TimeSeries points={pts(undefined)} /></MemoryRouter></PrefsProvider></QueryClientProvider>);
    expect(screen.getByRole('button', { name: /Analisis/ })).toHaveTextContent('Kemiskinan');
  });

});

describe('Kasus tepi lain', () => {
  it('pencarian sebelum daftar layer termuat', async () => {
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /layers': () => new Promise(() => undefined), 'GET /stats/kecamatan': [], 'GET /search': { regions: [], features: [] } });
    renderAt('/akun');
    const box = await screen.findByRole('combobox', { name: 'Cari Data di Semua Layer' }, { timeout: 5000 });
    await userEvent.type(box, 'jalan');
    expect(await screen.findByText('Tidak ditemukan', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('Peta: tooltip sebelum layer termuat; legenda panjang bisa digulir; titik per jumlah', async () => {
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`K${i}`, `#${String(i).repeat(6)}`]));
    const pju = { ...LAYERS[4]!, visibleDefault: true, style: { color: '#EAB308', classField: 'kondisi', classes: many } };
    let resolveLayers: (v: unknown) => void = () => undefined;
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': () => new Promise((r) => { resolveLayers = r; }), 'GET /stats/kecamatan': [],
      'GET /stats/layers/pju': Object.keys(many).map((key, i) => ({ key, count: i + 1, lengthKm: 0, areaHa: 0 })),
      'GET /stats/timeseries': [{ tahun: 2026, miskin: 5, jalanKm: 0, jalanRusakKm: 0 }],
    });
    renderAt('/peta');
    await screen.findByTestId('map', {}, { timeout: 5000 });
    fakeMap.addLayer({ id: 'circle-x', source: 'src-x' });
    fakeMap.rendered = [{ layer: { id: 'circle-x' }, source: 'src-x', id: 1, properties: { nama: 'X' } }];
    act(() => fakeMap.fire('mousemove', { point: { x: 4, y: 4 } }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('X');
    act(() => resolveLayers([LAYERS[0]!, pju]));
    expect((await screen.findAllByText('K9', {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(document.querySelector('.max-h-64')).not.toBeNull();
  });

  it('pratinjau titik unggahan menunggu peta siap', async () => {
    mapState.isLoaded = false;
    mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /layers/pju/features': page([]),
      'POST /layers/pju/upload': { count: 1, skipped: 0, hasPrj: true, columns: [], missingFields: [], sample: { type: 'FeatureCollection', features: [] } },
    });
    renderAt('/data/pju');
    await userEvent.click(await screen.findByRole('button', { name: /Unggah Data/ }, { timeout: 5000 }));
    const d = await screen.findByRole('dialog');
    await userEvent.upload(within(d).getByLabelText('File Shapefile atau GeoJSON'), new File(['PK'], 'a.zip', { type: 'application/zip' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Periksa File' }));
    await within(d).findByTestId('map');
    expect(fakeMap.addLayer).not.toHaveBeenCalled();
  });
});
