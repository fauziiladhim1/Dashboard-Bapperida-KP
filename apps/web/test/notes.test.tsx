import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Layer } from '@/lib/types';
import { fakeMap } from './map-mock';
import { LAYERS, mockApi, renderAt, user } from './utils';

const marker = (id: number, slug: string, name: string, geomType: Layer['geomType'], color: string): Layer => ({
  ...LAYERS[4]!, id, slug, name, geomType, category: 'Penanda Lokasi', featureCount: 0, visibleDefault: true, style: { color },
  fields: [{ key: 'judul', label: 'Judul', type: 'text', required: true }, { key: 'catatan', label: 'Catatan', type: 'text' }],
});
const MARKERS = [
  marker(8, 'catatan-titik', 'Penanda Titik', 'Point', '#4F46E5'),
  marker(9, 'catatan-garis', 'Penanda Garis', 'LineString', '#C026D3'),
  marker(10, 'catatan-area', 'Penanda Area', 'Polygon', '#0D9488'),
];
const click = (lng: number, lat: number) => act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng, lat } }));
const saved = { id: 50, properties: {}, geometry: null, updatedAt: '2026-11-25T00:00:00Z' };

describe('Peta: alat gambar penanda lokasi', () => {
  it('viewer dan editor tanpa layer penanda tidak melihat alat gambar', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    const { unmount } = renderAt('/peta');
    await screen.findAllByText('Penanda Titik', {}, { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Alat gambar' })).not.toBeInTheDocument();
    unmount();

    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await screen.findAllByText('PJU', {}, { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Alat gambar' })).not.toBeInTheDocument();
  });

  it('titik: batal, lalu satu klik peta (klik fitur diabaikan) membuka dialog berisi titik dan menyimpan', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [],
      'POST /layers/catatan-titik/features': saved,
    });
    renderAt('/peta');
    await userEvent.click(await screen.findByRole('button', { name: 'Tandai titik' }, { timeout: 5000 }));
    expect(screen.getByText('Klik peta untuk menandai titik')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.queryByText('Klik peta untuk menandai titik')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Tandai titik' }));
    await waitFor(() => expect(fakeMap.canvas.style.cursor).toBe('crosshair'));
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten', layer: { id: 'line-jalan-kabupaten' }, id: 7, properties: {} }];
    click(110.2, -7.85);
    expect(await screen.findByText('Tambah Penanda Titik')).toBeInTheDocument();
    expect(screen.getByDisplayValue('POINT (110.2 -7.85)')).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/features/7'))).toBe(false);

    await userEvent.type(screen.getByLabelText(/Judul/), 'Lokasi pasar baru');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      properties: { judul: 'Lokasi pasar baru' }, geometry: { type: 'Point', coordinates: [110.2, -7.85] },
    }));
  });

  it('area: titik sudut di peta utama, batalkan titik, Selesai aktif mulai 3 titik, dialog berisi poligon tertutup', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await userEvent.click(await screen.findByRole('button', { name: 'Gambar poligon' }, { timeout: 5000 }));
    const done = screen.getByRole('button', { name: 'Selesai' });
    expect(done).toBeDisabled();
    click(110, -7.8);
    click(110.1, -7.8);
    click(110.9, -7.1);
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan titik' }));
    expect(screen.getByText(/^2 titik/)).toBeInTheDocument();
    expect(done).toBeDisabled();
    click(110.1, -7.9);
    await userEvent.click(done);
    expect(await screen.findByText('Tambah Penanda Area')).toBeInTheDocument();
    expect(screen.getByDisplayValue('POLYGON ((110 -7.8, 110.1 -7.8, 110.1 -7.9, 110 -7.8))')).toBeInTheDocument();
  });

  it('garis: dua titik cukup untuk Selesai', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, ...MARKERS], 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await userEvent.click(await screen.findByRole('button', { name: 'Gambar garis' }, { timeout: 5000 }));
    click(110, -7.8);
    click(110.1, -7.9);
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(await screen.findByDisplayValue('LINESTRING (110 -7.8, 110.1 -7.9)')).toBeInTheDocument();
  });
});
