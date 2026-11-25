import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeMap, mapState } from './map-mock';
import { LAYERS, mockApi, page, renderAt, user } from './utils';

const STATS = {
  'GET /stats/layers/jalan-kabupaten': [{ key: 'Baik', count: 2, lengthKm: 30, areaHa: 0 }, { key: 'Rusak Berat', count: 1, lengthKm: 10, areaHa: 0 }],
  'GET /stats/ruas-jalan': [
    { kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2025, ruas: 'A - B', baik: 30, sedang: 0, rusakRingan: 0, rusakBerat: 10, perbaikan: 0 },
  ],
  'GET /stats/layers/pju': [],
  'GET /stats/layers/kawasan-pertanian': [],
  'GET /stats/layers/potensi-bencana': [],
  'GET /stats/layers/penggunaan-lahan': [{ key: 'Sawah', count: 3, lengthKm: 0, areaHa: 300 }, { key: 'Hutan', count: 1, lengthKm: 0, areaHa: 100 }, { key: null, count: 1, lengthKm: 0, areaHa: 100 }],
  'GET /stats/layers/jalan-kabupaten/kecamatan': [
    { kecamatan: 'Wates', key: 'Baik', count: 1, lengthKm: 20, areaHa: 0 },
    { kecamatan: 'Sentolo', key: 'Rusak Berat', count: 1, lengthKm: 10, areaHa: 0 },
  ],
};

describe('interaksi Ringkasan', () => {
  it('kondisi jalan: sorot & sembunyikan kelas; peta mini tanpa chip', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS });
    renderAt('/');
    await screen.findByText('Kondisi jalan kabupaten', {}, { timeout: 12000 }); // muat pertama: chunk Ringkasan di-transform

    // Sorot kelas lewat batang atau daftar kelas: kelas lain diredupkan.
    const berat = await screen.findByRole('button', { name: /^Rusak Berat/ });
    fireEvent.mouseEnter(screen.getByTestId('seg-baik'));
    expect(berat).toHaveClass('opacity-50');
    fireEvent.mouseLeave(screen.getByTestId('seg-baik'));
    const chip = screen.getByRole('button', { name: /^Baik/ });
    fireEvent.focus(chip);
    expect(berat).toHaveClass('opacity-50');
    fireEvent.blur(chip);
    expect(berat).not.toHaveClass('opacity-50');
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    // Ringkasan tidak lagi memuat donut tutupan lahan.
    expect(screen.queryByText('Total')).not.toBeInTheDocument();

    // Peta mini: hanya layer bawaan (visibleDefault), tanpa chip pemilih layer.
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('src-jalan-kabupaten', expect.anything()));
    expect(fakeMap.addSource).not.toHaveBeenCalledWith('src-pju', expect.anything());
    expect(screen.queryByRole('button', { name: 'PJU' })).not.toBeInTheDocument();
  });
});

describe('interaksi lain', () => {
  it('panel layer peta bisa diciutkan; batas wilayah terang di basemap gelap', async () => {
    mapState.theme = 'dark';
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [] });
    renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 5000 });
    await waitFor(() => expect(fakeMap.addLayer.mock.calls.some(([l]) => l.id === 'line-batas-administrasi' && l.paint['line-color'] === '#E5E7EB')).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Ciutkan panel layer' }));
    const fab = await screen.findByRole('button', { name: 'Buka panel layer' });
    expect(fab.parentElement).toHaveTextContent('2');
    await userEvent.click(fab);
    expect(await screen.findByRole('button', { name: 'Ciutkan panel layer' })).toBeInTheDocument();
  });

  it('pilihan baris bisa dibatalkan dari action bar; seret file ke dropzone', async () => {
    mockApi({
      'GET /auth/me': { user: user('editor') },
      'GET /layers': LAYERS,
      'GET /layers/jalan-kabupaten/features': page([{ id: '1', properties: { nama_ruas: 'A' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' }]),
    });
    renderAt('/data');
    await userEvent.click(await screen.findByRole('checkbox', { name: /^Pilih 1/ }, { timeout: 5000 }));
    const bar = await screen.findByRole('toolbar', { name: 'Aksi fitur terpilih' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Unggah Data/ }));
    const dialog = await screen.findByRole('dialog');
    const zone = within(dialog).getByText('Seret file shapefile (.zip) atau GeoJSON ke sini').closest('label')!;
    fireEvent.dragOver(zone);
    expect(within(dialog).getByText('Lepaskan file di sini')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['PK'], 'jalan.zip')] } });
    expect(within(dialog).getByText('jalan.zip')).toBeInTheDocument();
    expect(within(dialog).getByText('2. Periksa').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('Log: filter rentang tanggal lewat kalender, breadcrumb kembali ke beranda', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: user() }, 'GET /audit': page([]), 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /stats/ruas-jalan': [] });
    renderAt('/log');
    const picker = await screen.findByRole('group', { name: 'Rentang tanggal' }, { timeout: 5000 });
    await userEvent.click(within(picker).getByRole('button'));
    const grid = await screen.findByRole('grid');
    await userEvent.click(within(grid).getByText('10'));
    await userEvent.click(within(grid).getByText('12'));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/audit')).at(-1)?.url).toMatch(/^\/audit\?page=1&limit=20&from=\d{4}-\d{2}-10&to=\d{4}-\d{2}-12$/));
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard Bapperida' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('pintasan "/" fokus ke pencarian; Escape membatalkan konfirmasi; warna layer baru', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') },
      'GET /layers': LAYERS,
      'GET /stats/kecamatan': [],
      'GET /layers/jalan-kabupaten/features': page([{ id: '1', properties: { nama_ruas: 'A' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' }]),
      'POST /layers': ({ body }: { body: object }) => ({ ...LAYERS[6], ...body }),
    });
    renderAt('/data');
    const search = await screen.findByRole('searchbox', { name: 'Cari atribut…' }, { timeout: 5000 });
    await userEvent.keyboard('/');
    expect(search).toHaveFocus();
    await userEvent.keyboard('/');
    expect(search).toHaveValue('/');

    await userEvent.click(await screen.findByRole('button', { name: 'Hapus 1' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Layer baru' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama layer'), 'Taman');
    // Opsi ke-4: #DE533C (dipakai Kondisi Jalan) tidak ditawarkan, jadi biru kini di indeks 3.
    await userEvent.click(within(dialog).getAllByRole('option')[3]!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat layer' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ style: { color: '#2563EB' } }));
  });
});
