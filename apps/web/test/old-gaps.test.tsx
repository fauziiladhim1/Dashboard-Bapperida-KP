import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/App';
import { HazardExposure } from '@/features/overview/insights';
import { PrefsProvider } from '@/lib/prefs';
import { LAYERS, mockApi, page, renderAt, reply, SETTINGS, user } from './utils';

const ROAD = { id: '1', properties: { nama_ruas: 'Jl. Wates', kondisi: 'Rusak Berat' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' };
const ALERTS = {
  count: 120,
  items: [
    { id: '1', slug: 'jalan-kabupaten', layer: 'Ruas Jalan', label: 'Jl. Wates', kondisi: 'Rusak Berat', urgensi: 'tinggi', keputusan: null, catatan: 'cek lubang', updatedAt: '' },
    { id: '2', slug: 'jalan-kabupaten', layer: 'Ruas Jalan', label: 'Jl. Sentolo', kondisi: null, urgensi: 'lain', keputusan: 'Ditunda', catatan: null, updatedAt: '' },
  ],
};
const routes = (role: 'editor' | 'viewer') => ({
  'GET /auth/me': { user: user(role) }, 'GET /layers': LAYERS, 'GET /alerts': ALERTS, 'GET /stats/ruas-jalan': [],
  'GET /layers/jalan-kabupaten/features': page([ROAD]), 'GET /features/1': { ...ROAD, geometry: null, media: [] }, 'GET /decision-funds': ['APBD', 'DAK'],
});
const openBell = async (n = 120) => {
  await userEvent.click(await screen.findByRole('button', { name: `Peringatan tindak lanjut (${n})` }, { timeout: 5000 }));
  return screen.findByRole('menu');
};

describe('Lonceng peringatan', () => {
  it('editor: item -> notulensi fitur (isi pelaksanaan Selesai lalu simpan); jumlah 99+ dan sisa', async () => {
    // Setelah simpan, fitur memuat isian pelaksanaan: dibuka lagi = form terisi nilai tersimpan.
    let detail = { ...ROAD, geometry: null, media: [] } as Record<string, unknown>;
    const calls = mockApi({ ...routes('editor'), 'GET /features/1': () => detail, 'PATCH /features/1': ({ body }: { body: unknown }) => {
      detail = { ...detail, properties: { ...ROAD.properties, ...(body as { properties: object }).properties } };
      return ROAD;
    } });
    renderAt('/data/jalan-kabupaten');
    const menu = await openBell();
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByText('+118 lainnya: lihat kolom Keputusan di menu Data.')).toBeInTheDocument();
    expect(within(menu).getByText('Ruas Jalan, Ditunda')).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Jl. Wates/ }));

    const d = await screen.findByRole('dialog', { name: 'Notulensi & keputusan' });
    await userEvent.click(within(d).getByRole('radio', { name: /^Selesai/ }));
    expect(within(d).getByText(/^Tercatat selesai pada/)).toBeInTheDocument();
    await userEvent.type(within(d).getByLabelText('Anggaran (Rp)'), '5000000');
    await userEvent.type(within(d).getByLabelText('Sumber dana'), ' DAK ');
    await userEvent.type(within(d).getByLabelText('Tahun target'), '2027');
    expect(d.querySelectorAll('#decision-fund-list option')).toHaveLength(2);
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan notulensi' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      properties: { keputusan: 'Selesai', anggaran: 5000000, sumber_dana: 'DAK', tahun_target: 2027, tanggal_selesai: expect.any(String) },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Dibuka lagi dari lonceng lalu Batal: param ?keputusan dibersihkan, dialog tertutup.
    await userEvent.click(within(await openBell()).getByRole('menuitem', { name: /Jl. Wates/ }));
    const d2 = await screen.findByRole('dialog', { name: 'Notulensi & keputusan' });
    await waitFor(() => expect(within(d2).getByLabelText('Anggaran (Rp)')).toHaveValue(5000000));
    expect(within(d2).getByLabelText('Tahun target')).toHaveValue(2027);
    await userEvent.click(within(d2).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  }, 30_000);

  it('viewer: item membuka detail fitur (hanya baca)', async () => {
    mockApi({ ...routes('viewer'), 'GET /alerts': { ...ALERTS, count: 2 } });
    renderAt('/data/jalan-kabupaten');
    await userEvent.click(within(await openBell(2)).getByRole('menuitem', { name: /Jl. Sentolo/ }));
    expect(screen.queryByText('99+')).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe('?edit=2'));
  });
});

describe('Peta: tautan bahaya dari Ringkasan', () => {
  it('?layer=potensi-bencana&bahaya=Tanah Longsor menyalakan raster jenis itu', async () => {
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /layers/batas-administrasi/export': { type: 'FeatureCollection', features: [] },
    });
    renderAt('/peta?layer=potensi-bencana&bahaya=Tanah%20Longsor');
    const sw = (await screen.findAllByRole('switch', { name: 'Tampilkan Potensi Bencana' }, { timeout: 5000 }))[0]!;
    await waitFor(() => expect(sw).toBeChecked());
    expect(screen.getAllByText('Tanah Longsor').length).toBeGreaterThan(0);
  });

  it('?layer=potensi-bencana tanpa jenis -> multi-bahaya', async () => {
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /layers/batas-administrasi/export': { type: 'FeatureCollection', features: [] },
    });
    renderAt('/peta?layer=potensi-bencana');
    expect((await screen.findAllByText('Multi-Bahaya', {}, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});

describe('Keterpaparan: tanpa jenis gabungan di pengaturan, nilai nol', () => {
  it('semua jenis jadi baris (tanpa ringkasan multi-bahaya); nilai 0 diredupkan', async () => {
    const { gabungan: _, ...zona } = SETTINGS.keterpaparan.zona;
    mockApi({
      'GET /settings': { ...SETTINGS, keterpaparan: { ...SETTINGS.keterpaparan, zona } },
      'GET /stats/exposure': [{ jenis: 'Banjir', sekolah: 0, faskes: 2, wisata: 1, jalanKm: 3, permukimanHa: 4 },
        { jenis: 'Tsunami', sekolah: 9, faskes: 9, wisata: 9, jalanKm: 9, permukimanHa: 9 }],
    });
    render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter><HazardExposure /></MemoryRouter></PrefsProvider></QueryClientProvider>);
    await screen.findByRole('rowheader', { name: 'Banjir' });
    // Jenis paling terpapar di atas.
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Tsunami', 'Banjir']);
    expect(screen.queryByRole('region', { name: /Total di dalam zona multi-bahaya/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('0')[0]).toHaveClass('text-subtle');
  });

  it('gagal memuat: pesan galat + coba lagi', async () => {
    let fail = true;
    mockApi({ 'GET /stats/exposure': () => (fail ? reply(500, { error: 'x' }) : []) });
    render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter><HazardExposure /></MemoryRouter></PrefsProvider></QueryClientProvider>);
    const retry = await screen.findByRole('button', { name: 'Coba lagi' }, { timeout: 5000 });
    fail = false;
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument());
  });
});
