import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Layer } from '@/lib/types';
import { fakeMap } from './map-mock';
import { LAYERS, mockApi, renderAt, user } from './utils';

const marker = (id: number, slug: string, name: string, geomType: Layer['geomType'], color: string): Layer => ({
  ...LAYERS[4]!, id, slug, name, geomType, category: 'Catatan Rencana', featureCount: 0, visibleDefault: true, style: { color },
  fields: [{ key: 'judul', label: 'Judul', type: 'text', required: true }, { key: 'catatan', label: 'Catatan', type: 'text' }],
});
const MARKERS = [
  marker(8, 'catatan-titik', 'Rencana Titik', 'Point', '#4F46E5'),
  marker(9, 'catatan-garis', 'Rencana Garis', 'LineString', '#C026D3'),
  marker(10, 'catatan-area', 'Rencana Area', 'Polygon', '#0D9488'),
];
const click = (lng: number, lat: number) => act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng, lat } }));
/** Panel penanda tertutup saat halaman dibuka: buka dulu lewat tombol mengambangnya. */
const openPanel = async () => userEvent.click(await screen.findByRole('button', { name: 'Buka Catatan Rencana' }, { timeout: 5000 }));
const saved = { id: 50, properties: {}, geometry: null, updatedAt: '2026-11-25T00:00:00Z' };

describe('Peta: alat gambar penanda lokasi', () => {
  it('viewer dan editor tanpa layer penanda tidak melihat alat gambar', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    const { unmount } = renderAt('/peta');
    await screen.findAllByText('Rencana Titik', {}, { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Alat Gambar' })).not.toBeInTheDocument();
    unmount();

    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await screen.findAllByText('PJU', {}, { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Alat Gambar' })).not.toBeInTheDocument();
  });

  it('titik: batal, lalu satu klik peta (klik fitur diabaikan) membuka dialog berisi titik dan menyimpan', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [],
      'POST /layers/catatan-titik/features': saved,
    });
    renderAt('/peta');
    await openPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Tandai Titik' }));
    expect(screen.getByText('Klik peta untuk menandai titik')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.queryByText('Klik peta untuk menandai titik')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Tandai Titik' }));
    await waitFor(() => expect(fakeMap.canvas.style.cursor).toBe('crosshair'));
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten', layer: { id: 'line-jalan-kabupaten' }, id: 7, properties: {} }];
    click(110.2, -7.85);
    expect(await screen.findByText('Tambah Rencana Titik')).toBeInTheDocument();
    expect(screen.getByDisplayValue('POINT (110.2 -7.85)')).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/features/7'))).toBe(false);

    await userEvent.type(screen.getByLabelText(/Judul/), 'Lokasi pasar baru');
    // Catatan = area teks lebar (bukan kolom satu baris).
    expect(screen.getByLabelText('Catatan').tagName).toBe('TEXTAREA');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      properties: { judul: 'Lokasi pasar baru' }, geometry: { type: 'Point', coordinates: [110.2, -7.85] },
    }));
  });

  it('area: titik sudut di peta utama, batalkan titik, Selesai aktif mulai 3 titik, dialog berisi poligon tertutup', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await openPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Gambar Poligon' }));
    const done = screen.getByRole('button', { name: 'Selesai' });
    expect(done).toBeDisabled();
    click(110, -7.8);
    click(110.1, -7.8);
    click(110.9, -7.1);
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan Titik' }));
    expect(screen.getByText(/^2 titik/)).toBeInTheDocument();
    expect(done).toBeDisabled();
    click(110.1, -7.9);
    await userEvent.click(done);
    expect(await screen.findByText('Tambah Rencana Area')).toBeInTheDocument();
    expect(screen.getByDisplayValue('POLYGON ((110 -7.8, 110.1 -7.8, 110.1 -7.9, 110 -7.8))')).toBeInTheDocument();
  });

  it('garis: dua titik cukup untuk Selesai', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await openPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Gambar Garis' }));
    click(110, -7.8);
    click(110.1, -7.9);
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(await screen.findByDisplayValue('LINESTRING (110 -7.8, 110.1 -7.9)')).toBeInTheDocument();
  });

  const move = (lng: number, lat: number) => act(() => fakeMap.fire('mousemove', { point: { x: 1, y: 1 }, lngLat: { lng, lat } }));
  const editorMap = async (tool: string) => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await openPanel();
    await userEvent.click(screen.getByRole('button', { name: tool }));
  };

  it('snap: klik dekat sudut objek data menempel tepat ke sudutnya; lingkar tempel tampil saat kursor mendekat', async () => {
    await editorMap('Tandai Titik');
    // Tanpa layer data tampil: tidak ada yang bisa ditempeli.
    fakeMap.addLayer.mockClear();
    move(110.2005, -7.8504);
    expect(screen.queryByTestId('snap-ring')).not.toBeInTheDocument();
    fakeMap.addLayer({ id: 'line-jalan-kabupaten', source: 'src-jalan-kabupaten' });
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten', geometry: { type: 'LineString', coordinates: [[110.20001234, -7.85], [110.3, -7.9]] }, properties: {} },
      { source: 'src-x', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} }];
    move(110.2005, -7.8504);
    expect(await screen.findByTestId('snap-ring')).toBeInTheDocument();
    click(110.2005, -7.8504);
    expect(await screen.findByDisplayValue('POINT (110.2000123 -7.85)')).toBeInTheDocument();
  });

  it('area: klik titik pertama menutup; titik yang memotong ditolak dengan pesan; Esc batal; alat ditekan lagi = batal', async () => {
    await editorMap('Gambar Poligon');
    expect(fakeMap.canvas.style.cursor).toBe('crosshair');
    move(110, -7.8); // belum ada titik: tanpa garis bantu
    click(110, -7.8);
    move(110.05, -7.8); // satu titik: garis bantu lurus
    click(110.1, -7.8); click(110.1, -7.9);
    move(110.05, -7.85);
    click(110.05, -7.7); // ruas (110.1,-7.9)->(110.05,-7.7) memotong ruas pertama
    expect(screen.getByText('Titik ditolak: garis saling memotong')).toBeInTheDocument();
    expect(screen.getByText(/^3 titik/)).toBeInTheDocument();
    click(110.0005, -7.8003); // menempel ke titik pertama -> selesai
    expect(await screen.findByDisplayValue('POLYGON ((110 -7.8, 110.1 -7.8, 110.1 -7.9, 110 -7.8))')).toBeInTheDocument();
  });

  it('keyboard: Backspace hapus titik, Enter selesai garis, Esc batal; area segaris diblokir', async () => {
    await editorMap('Gambar Poligon');
    click(110, -7.8); click(110.1, -7.8); click(110.2, -7.8);
    expect(screen.getByText('Area tidak sah: titik segaris')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selesai' })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(screen.getByText(/^2 titik/)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'x' });
    // Mengetik di kolom isian (mis. pencarian) tidak memicu pintasan gambar.
    const input = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText(/^2 titik/)).toBeInTheDocument();
    input.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText(/^2 titik/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Gambar Garis' }));
    expect(screen.getByRole('button', { name: 'Gambar Garis' })).toHaveAttribute('aria-pressed', 'true');
    click(110, -7.8); click(110.1, -7.9);
    click(110.1, -7.9); // klik ulang titik terakhir = selesai
    expect(await screen.findByDisplayValue('LINESTRING (110 -7.8, 110.1 -7.9)')).toBeInTheDocument();
  });

  it('Enter menyelesaikan garis; menekan alat aktif lagi membatalkan', async () => {
    await editorMap('Gambar Garis');
    await userEvent.click(screen.getByRole('button', { name: 'Gambar Garis' }));
    expect(screen.queryByRole('button', { name: 'Selesai' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gambar Garis' }));
    click(110, -7.8); click(110.1, -7.9);
    fireEvent.keyDown(document.body, { key: 'Backspace' }); fireEvent.keyDown(document.body, { key: 'Backspace' }); fireEvent.keyDown(document.body, { key: 'Backspace' });
    click(110, -7.8); click(110.1, -7.9);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await screen.findByDisplayValue('LINESTRING (110 -7.8, 110.1 -7.9)')).toBeInTheDocument();
  });

  it('panel penanda: tutup membatalkan gambar dan menyisakan tombol berisi jumlah penanda; dibuka lagi', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS.map((l, i) => ({ ...l, featureCount: i + 1 }))], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    // Tertutup saat halaman dibuka; lencana tombolnya = jumlah semua penanda (1 + 2 + 3).
    expect(screen.queryByRole('complementary', { name: 'Catatan Rencana' })).not.toBeInTheDocument();
    expect(await screen.findByText('6', {}, { timeout: 5000 })).toBeInTheDocument();
    await openPanel();
    const panel = await screen.findByRole('complementary', { name: 'Catatan Rencana' });
    expect(within(panel).getByText('Min. 3 titik')).toBeInTheDocument();
    expect(within(panel).getByText('3 fitur')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Gambar Garis' }));
    click(110, -7.8);
    await userEvent.click(screen.getByRole('button', { name: 'Tutup Catatan Rencana' }));
    expect(fakeMap.canvas.style.cursor).toBe('');
    await openPanel();
    expect(await screen.findByRole('button', { name: 'Gambar Garis' })).toHaveAttribute('aria-pressed', 'false');
  });
});

