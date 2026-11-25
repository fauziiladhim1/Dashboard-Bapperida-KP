import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { haLabel, kmLabel } from '@/features/overview/widgets';
import { fakeMap, mapState } from './map-mock';
import { LAYERS, mockApi, page, renderAt, user } from './utils';

const pending = () => new Promise(() => undefined);

describe('kasus tepi', () => {
  it('label tooltip grafik', () => {
    expect(haLabel(1500)).toBe('1.500 ha');
    expect(kmLabel('2.5')).toBe('2,5 km');
  });

  it('tombol login menampilkan status memproses', async () => {
    mockApi({ 'GET /auth/me': { status: 401, body: {}, __reply: true }, 'POST /auth/login': pending });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.id');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /Masuk/ }));
    expect(await screen.findByRole('button', { name: /Memproses/ })).toBeDisabled();
  });

  it('peta: layer sudah hilang saat cleanup, popup ditutup dari peta, map belum dibuat', async () => {
    mockApi({
      'GET /auth/me': { user: user() },
      'GET /layers': LAYERS,
      'GET /stats/kecamatan': [],
      'GET /features/9': { id: '9', properties: {}, media: [], updatedAt: '2026-11-02T03:04:05.678Z' },
    });
    const view = renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 15_000 }); // chunk Peta dimuat malas: lambat saat 19 worker paralel
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalled());
    fakeMap.rendered = [{ id: 9, source: 'src-jalan-kabupaten' }];
    fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } });
    await userEvent.click(await screen.findByRole('button', { name: 'popup-close' }));
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();
    // Popup ditutup: sorotan fitur ikut dilepas.
    expect(fakeMap.removeLayer).toHaveBeenCalledWith('sel-jalan-kabupaten');
    fakeMap.removeLayer.mockClear();

    fakeMap.getLayer.mockReturnValue(false);
    fakeMap.getSource.mockReturnValueOnce(false);
    view.unmount();
    expect(fakeMap.removeLayer).not.toHaveBeenCalled();

    mapState.hasMap = false;
    renderAt('/data/pju?edit=new');
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(fakeMap.handlers.some((h) => h.event === 'click')).toBe(false);
  });

  it('dialog: status menyimpan, Escape menutup upload & layer baru', async () => {
    mockApi({
      'GET /auth/me': { user: user('editor') },
      'GET /layers': LAYERS,
      'GET /layers/jalan-kabupaten/features': page([]),
      'GET /features/1': { id: '1', properties: { nama_ruas: 'A' }, media: [], updatedAt: '2026-11-02T03:04:05.678Z' },
      'PATCH /features/1': pending,
    });
    renderAt('/data/jalan-kabupaten?edit=1');
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await within(dialog).findByDisplayValue('A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    expect(await within(dialog).findByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
    act(() => dialog.focus()); // tombol disabled melepas fokus; Escape ditangani oleh dialog
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Unggah Data/ }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Layer baru' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('kasus tepi 2', () => {
  it('upload: status memeriksa & menyimpan', async () => {
    let resolveCheck: (v: unknown) => void = () => undefined;
    mockApi({
      'GET /auth/me': { user: user('editor') },
      'GET /layers': LAYERS,
      'GET /layers/jalan-kabupaten/features': page([]),
      'POST /layers/jalan-kabupaten/upload': ({ url }: { url: string }) =>
        url.includes('dryRun=true') ? new Promise((r) => (resolveCheck = r)) : pending(),
    });
    renderAt('/data');
    await userEvent.click(await screen.findByRole('button', { name: /Unggah Data/ }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(within(dialog).getByLabelText('File shapefile atau GeoJSON'), new File(['PK'], 'a.zip'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Periksa file' }));
    expect(await within(dialog).findByRole('button', { name: 'Memeriksa…' })).toBeDisabled();
    resolveCheck({ count: 1, skipped: 0, hasPrj: true, columns: [], missingFields: [] });
    await userEvent.click(await within(dialog).findByRole('button', { name: /Simpan 1 fitur/ }));
    expect(await within(dialog).findByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
  });

  it('kondisi jalan tanpa data ruas; popup gagal memuat atribut', async () => {
    const plainRoads = LAYERS.map((l) => (l.slug === 'jalan-kabupaten' ? { ...l, style: { color: '#DE533C' } } : l));
    mockApi({
      'GET /auth/me': { user: user('viewer') },
      'GET /layers': plainRoads,
      'GET /stats/layers/jalan-kabupaten': [], 'GET /stats/layers/pju': [], 'GET /stats/layers/kawasan-pertanian': [],
      'GET /stats/layers/potensi-bencana': [], 'GET /stats/layers/penggunaan-lahan': [],
      'GET /stats/layers/jalan-kabupaten/kecamatan': [{ kecamatan: 'Wates', key: null, count: 1, lengthKm: 1, areaHa: 0 }],
      'GET /stats/kecamatan': [],
      'GET /features/9': { status: 500, body: { error: 'x' }, __reply: true },
    });
    renderAt('/');
    await screen.findByText('Jalan kabupaten rusak berat', {}, { timeout: 5000 });
    expect(screen.queryByRole('radio', { name: 'Per ruas' })).not.toBeInTheDocument(); // tanpa data: tak ada pengalih grafik

    window.history.pushState({}, '', '/peta');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByText('Layer peta', {}, { timeout: 15_000 }); // chunk Peta dimuat malas: lambat saat 19 worker paralel
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalled());
    fakeMap.rendered = [{ id: 9, source: 'src-jalan-kabupaten' }];
    fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } });
    const popup = await screen.findByTestId('popup');
    await waitFor(() => expect(within(popup).queryByText('Memuat…')).not.toBeInTheDocument(), { timeout: 5000 });
    expect(popup.querySelectorAll('dt')).toHaveLength(0);
  });
});

describe('hapus foto inline', () => {
  it('batal saat fokus pindah; galat hapus ditampilkan', async () => {
    mockApi({
      'GET /auth/me': { user: user('editor') },
      'GET /layers': LAYERS,
      'GET /layers/jalan-kabupaten/features': page([]),
      'GET /features/1': { id: '1', properties: {}, media: [{ id: 5, webp: 'f.webp', avif: 'f.avif', width: 10, height: 10 }], updatedAt: '2026-11-02T03:04:05.678Z' },
      'DELETE /media/5': { status: 500, body: { error: 'Gagal hapus' }, __reply: true },
    });
    renderAt('/data/jalan-kabupaten?edit=1');
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Hapus foto' }));
    const confirm = within(dialog).getByRole('button', { name: 'Yakin hapus?' });
    act(() => confirm.blur());
    expect(within(dialog).queryByRole('button', { name: 'Yakin hapus?' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus foto' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yakin hapus?' }));
    expect(await screen.findByText('Gagal hapus')).toBeInTheDocument();
  });
});
