import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeMap } from './map-mock';
import { choose, LAYERS, mockApi, page, renderAt, reply, user } from './utils';

const ROADS = page(
  [
    { id: '1', properties: { nama_ruas: 'Jl. Wates', kondisi: 'Baik', lebar_m: 6 }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
    { id: '2', properties: { nama_ruas: 'Jl. Sentolo', kondisi: null }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
  ],
  45,
);

const ROAD_DETAIL = {
  type: 'Feature', id: '1', slug: 'jalan-kabupaten',
  properties: { nama_ruas: 'Jl. Wates', kondisi: 'Baik', lebar_m: 6, OBJECTID: 77, catatan: null },
  geometry: { type: 'MultiLineString', coordinates: [[[110, -7], [110.1, -7]]] },
  media: [{ id: 5, webp: 'f.webp', avif: 'f.avif', width: 100, height: 80 }],
  createdAt: '', updatedAt: '2026-11-02T03:04:05.678Z',
};

const base = (role: 'editor' | 'viewer' = 'editor') => ({
  'GET /auth/me': { user: user(role) },
  'GET /layers': LAYERS,
  'GET /stats/ruas-jalan': [],
  'GET /layers/jalan-kabupaten/features': ROADS,
  'GET /features/1': ROAD_DETAIL,
});

const open = async (path = '/data') => {
  renderAt(path);
  return screen.findByText('Jl. Wates', {}, { timeout: 5000 });
};

describe('Data: tabel', () => {
  it('menampilkan kolom dari field layer, cari, paginasi, ganti layer', async () => {
    const calls = mockApi({ ...base(), 'GET /layers/data-sekolah/features': page([{ id: '7', properties: { nama: 'SD 1', alamat: 'Wates' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' }]) });
    await open();
    // Layer berkondisi (Kondisi Jalan) punya kolom Dokumentasi.
    expect(screen.getByRole('columnheader', { name: 'Dokumentasi' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Nama Ruas' })).toBeInTheDocument();
    expect(screen.getByText('Geometri').nextSibling).toHaveTextContent('Garis');
    expect(screen.getByText('45 fitur')).toBeInTheDocument();
    expect(screen.getAllByText('–', { selector: 'td' }).length).toBeGreaterThan(0);

    await userEvent.type(screen.getByLabelText(/Cari atribut/), 'w');
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toBe('/layers/jalan-kabupaten/features?page=1&limit=20&q=w'));
    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/features?page=2'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Halaman sebelumnya' }));
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 3' }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toContain('page=3'));
    expect(screen.getByRole('button', { name: 'Halaman 3' })).toHaveAttribute('aria-current', 'page');

    await choose(/Pilih layer/, 'Sekolah');
    expect(await screen.findByText('SD 1')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'alamat' })).toBeInTheDocument();
    // Meta layer berlabel, bukan deret "a · b · c".
    expect(screen.getByText('Kategori').nextSibling).toHaveTextContent('Data pendukung');
    expect(screen.getByText('Geometri').nextSibling).toHaveTextContent('Titik');
    expect(screen.getByText('Tahun').nextSibling).toHaveTextContent('2025');
  });

  it('layer turunan baca-saja, tabel kosong, ekspor', async () => {
    mockApi({ ...base(), 'GET /layers/kawasan-pertanian/features': page([]) });
    renderAt('/data/kawasan-pertanian');
    expect(await screen.findByText('Turunan (baca-saja)', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('Belum ada data.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tambah fitur/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ekspor/ }));
    expect(await screen.findByRole('menuitem', { name: 'CSV (Excel)' })).toHaveAttribute('href', '/api/v1/layers/kawasan-pertanian/export?format=csv');
  });

  it('filter kecamatan, urutan, dan ekspor mengikuti filter', async () => {
    const calls = mockApi({ ...base(), 'GET /stats/kecamatan': ['Wates', 'Sentolo'], 'GET /layers/data-sekolah/features': page([]) });
    await open();
    await choose('Filter kecamatan', 'Wates');
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toBe('/layers/jalan-kabupaten/features?page=1&limit=20&kecamatan=Wates'));
    expect(window.location.search).toBe('?kec=Wates');

    const sort = screen.getByRole('columnheader', { name: /Diperbarui/ });
    await userEvent.click(sort);
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toContain('sort=updated_at&order=asc'));
    expect(screen.getByRole('columnheader', { name: /Diperbarui/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(sort);
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toContain('order=desc'));
    expect(screen.getByRole('columnheader', { name: /Diperbarui/ })).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(screen.getByRole('button', { name: /Ekspor/ }));
    expect(await screen.findByRole('menuitem', { name: 'GeoJSON' })).toHaveAttribute('href', '/api/v1/layers/jalan-kabupaten/export?format=geojson&kecamatan=Wates');
    await userEvent.keyboard('{Escape}');

    // Membuka dialog tidak menghapus filter; ganti layer membawa filter.
    await userEvent.click(screen.getByRole('button', { name: 'Ubah 1' }));
    expect(window.location.search).toBe('?kec=Wates&edit=1');
    await userEvent.click(await screen.findByRole('button', { name: 'Batal' }));
    await choose(/Pilih layer/, 'Sekolah');
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/features')).at(-1)?.url).toContain('/layers/data-sekolah/features?page=1&limit=20&kecamatan=Wates'));

    await choose('Filter kecamatan', 'Semua kecamatan');
    await waitFor(() => expect(window.location.search).toBe(''));
  }, 30_000); // banyak interaksi; lambat saat suite penuh berjalan paralel

  it('layer tidak dikenal dan status memuat', async () => {
    mockApi({ ...base(), 'GET /layers/jalan-kabupaten/features': () => new Promise(() => undefined) });
    renderAt('/data');
    expect(await screen.findByText('Memuat…', {}, { timeout: 5000 })).toBeInTheDocument();
    mockApi({ ...base(), 'GET /layers': [] });
    renderAt('/data/tidak-ada');
    expect(await screen.findByText('Layer tidak ditemukan.')).toBeInTheDocument();
  });

  it('hapus satu, pilih semua lalu hapus massal, gagal hapus', async () => {
    let fail = false;
    const calls = mockApi({ ...base(), 'POST /layers/jalan-kabupaten/features/bulk-delete': ({ body }: { body: { ids: number[] } }) => (fail ? reply(500, { error: 'Server error' }) : { deleted: body.ids.length }) });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus 1' }));
    expect(await screen.findByRole('dialog', { name: 'Hapus 1 fitur?' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Hapus 1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({ ids: [1] }));

    await userEvent.click(screen.getByRole('checkbox', { name: /^Pilih 2/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Pilih 2/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
    expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /Hapus 2 terpilih/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({ ids: [1, 2] }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));

    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Hapus 2' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    expect(await screen.findByText('Server error')).toBeInTheDocument();
  });
});

describe('Data: urut kolom & paginasi', () => {
  it('semua header kolom bisa diurutkan naik/turun (atribut, tahun data, ID); lompat halaman, jumlah baris', async () => {
    const calls = mockApi(base());
    await open();
    const last = () => calls.filter((c) => c.url.startsWith('/layers/jalan-kabupaten/features')).at(-1)!.url;
    const header = (name: RegExp) => screen.getByRole('columnheader', { name });
    await userEvent.click(header(/Nama Ruas/));
    await waitFor(() => expect(last()).toContain('sort=nama_ruas&order=asc'));
    expect(header(/Nama Ruas/)).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(header(/Nama Ruas/));
    await waitFor(() => expect(last()).toContain('sort=nama_ruas&order=desc'));
    await userEvent.click(header(/Tahun data/));
    await waitFor(() => expect(last()).toContain('sort=tahun_data&order=asc'));
    await userEvent.click(header(/^ID/));
    await waitFor(() => expect(last()).toContain('sort=id&order=asc'));
    // Tanpa pemilih filter atribut terpisah.
    expect(screen.queryByRole('button', { name: /Saring atribut/ })).not.toBeInTheDocument();
    // 45 baris / 20 = 3 halaman: lompat ke 3, lalu 50 baris per halaman = kembali ke halaman 1.
    await userEvent.type(screen.getByRole('spinbutton', { name: /Lompat ke halaman/ }), '3{Enter}');
    await waitFor(() => expect(last()).toContain('page=3&limit=20'));
    await choose('Baris', '50');
    await waitFor(() => expect(last()).toContain('page=1&limit=50'));
  }, 30_000);
});

describe('Data: gambar geometri di peta form fitur', () => {
  it('garis: klik peta menambah titik (WKT ikut), batalkan titik, hapus gambar, selesai; geometri lama disembunyikan saat menggambar', async () => {
    const calls = mockApi({ ...base(), 'PATCH /features/1': ROAD_DETAIL });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Ubah 1' }));
    const dialog = await screen.findByRole('dialog');
    const wkt = within(dialog).getByLabelText('Geometri (WKT)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gambar garis' }));
    expect(wkt).toHaveValue('');
    expect(within(dialog).queryByTestId('geojson')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Batalkan titik' })).toBeDisabled();
    const click = (lng: number, lat: number) => act(() => fakeMap.fire('click', { lngLat: { lng, lat } }));
    click(110.1, -7.8);
    expect(wkt).toHaveValue(''); // 1 titik belum cukup untuk garis
    expect(within(dialog).getByText(/^1 titik/)).toBeInTheDocument();
    click(110.2, -7.81);
    click(110.3, -7.82);
    expect(wkt).toHaveValue('LINESTRING (110.1 -7.8, 110.2 -7.81, 110.3 -7.82)');
    expect(within(dialog).getByTestId('geojson')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batalkan titik' }));
    expect(wkt).toHaveValue('LINESTRING (110.1 -7.8, 110.2 -7.81)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus gambar' }));
    expect(wkt).toHaveValue('');
    click(110.1, -7.8);
    click(110.4, -7.9);
    click(110.4, -7.7);
    click(110.2, -7.95); // ruas ini memotong ruas pertama: ditolak dengan pesan
    expect(within(dialog).getByText('Titik ditolak: garis saling memotong')).toBeInTheDocument();
    click(110.4, -7.7); // klik ulang titik terakhir = selesai
    expect(within(dialog).queryByRole('button', { name: 'Selesai' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gambar garis' }));
    click(110.1, -7.8);
    click(110.4, -7.9);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Selesai' }));
    // Selesai: klik peta tidak menambah titik lagi.
    click(110.5, -7.9);
    expect(wkt).toHaveValue('LINESTRING (110.1 -7.8, 110.4 -7.9)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ geometry: { type: 'LineString', coordinates: [[110.1, -7.8], [110.4, -7.9]] } }));
  }, 30_000);
});

describe('Data: keputusan', () => {
  it('dialog notulensi: pilih keputusan, tanggal rapat, notulensi; batal = tanpa simpan', async () => {
    const calls = mockApi({ ...base(), 'PATCH /features/1': ROAD_DETAIL, 'PATCH /features/2': ROAD_DETAIL });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Keputusan fitur 1' }));
    const d = await screen.findByRole('dialog', { name: 'Notulensi & keputusan' });
    await userEvent.click(within(d).getByRole('radio', { name: /^Ditunda/ }));
    // Urgensi manual menggantikan hasil dari kondisi (badge ringkasan ikut berubah).
    await choose('Urgensi', 'Tinggi');
    expect(within(d).getByText('Ditetapkan manual: menggantikan urgensi dari kondisi di tabel Data dan peta.')).toBeInTheDocument();
    const note = within(d).getByLabelText('Notulensi / catatan rapat (opsional)');
    await userEvent.type(note, '  tunggu anggaran ');
    expect(within(d).getByText('18/2000')).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText('Tanggal rapat'), { target: { value: '2026-11-02' } });
    await userEvent.type(within(d).getByLabelText('Penanggung jawab tindak lanjut'), ' DPUPKP ');
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan notulensi' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/features/1')?.body).toEqual({ properties: { keputusan: 'Ditunda', urgensi: 'tinggi', tanggal_keputusan: '2026-11-02', pj_keputusan: 'DPUPKP', catatan_keputusan: 'tunggu anggaran',
      // Ditunda: kolom pelaksanaan dikosongkan (hanya bermakna untuk Diproses/Selesai).
      anggaran: null, sumber_dana: null, tahun_target: null, tanggal_selesai: null } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Tanggal dikosongkan = null; default keputusan = opsi pertama.
    await userEvent.click(screen.getByRole('button', { name: 'Keputusan fitur 2' }));
    const d2 = await screen.findByRole('dialog', { name: 'Notulensi & keputusan' });
    fireEvent.change(within(d2).getByLabelText('Tanggal rapat'), { target: { value: '' } });
    await userEvent.click(within(d2).getByRole('button', { name: 'Simpan notulensi' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/features/2')?.body).toEqual({ properties: { keputusan: 'Diproses', urgensi: null, tanggal_keputusan: null, pj_keputusan: null, catatan_keputusan: null,
      anggaran: null, sumber_dana: null, tahun_target: null, tanggal_selesai: null } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Batal = tidak ada PATCH baru.
    await userEvent.click(screen.getByRole('button', { name: 'Keputusan fitur 1' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Notulensi & keputusan' })).getByRole('button', { name: 'Batal' }));
    expect(calls.filter((c) => c.url === '/features/1')).toHaveLength(1);
  }, 30_000);

  it('dialog terisi keputusan tersimpan; gagal simpan tampil galat', async () => {
    const saved = { ...ROADS.data[0]!, id: '1', properties: { ...ROADS.data[0]!.properties, keputusan: 'Tidak Diproses', urgensi: 'sedang', tanggal_keputusan: '2026-10-01', pj_keputusan: 'Bina Marga', catatan_keputusan: 'rapat 1' } };
    mockApi({ ...base(), 'GET /layers/jalan-kabupaten/features': page([saved]), 'PATCH /features/1': reply(500, { error: 'Server error' }) });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Keputusan fitur 1' }));
    const d = await screen.findByRole('dialog', { name: 'Notulensi & keputusan' });
    expect(within(d).getByRole('radio', { name: /^Tidak Diproses/ })).toBeChecked();
    expect(within(d).getByLabelText('Tanggal rapat')).toHaveValue('2026-10-01');
    expect(within(d).getByLabelText('Penanggung jawab tindak lanjut')).toHaveValue('Bina Marga');
    expect(within(d).getByLabelText('Notulensi / catatan rapat (opsional)')).toHaveValue('rapat 1');
    // Konteks fitur: nama layer + id dan urgensi dari kondisinya.
    expect(within(d).getByText('Kondisi Jalan 2026 #1')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Simpan notulensi' }));
    expect(await within(d).findByText('Server error')).toBeInTheDocument();
  });

  it('viewer hanya melihat keputusan', async () => {
    const row = (id: string, keputusan: string, catatan_keputusan: string | null = null) =>
      ({ ...ROADS.data[0]!, id, properties: { ...ROADS.data[0]!.properties, keputusan, catatan_keputusan } });
    mockApi({ ...base('viewer'), 'GET /layers/jalan-kabupaten/features': page([row('1', 'Diproses', 'segera'), row('2', 'Ditunda'), row('3', 'Tidak Diproses')]) });
    renderAt('/data');
    expect(await screen.findByText('Tidak Diproses', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Diproses').closest('[title]')).toHaveAttribute('title', 'segera');
    expect(screen.getByText('Ditunda')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keputusan fitur/ })).not.toBeInTheDocument();
  });
});

describe('Data: form fitur', () => {
  it('ubah atribut, geometri WKT terisi & diubah, metadata foto, hapus foto', async () => {
    const calls = mockApi({
      ...base(),
      'PATCH /features/1': ROAD_DETAIL,
      'POST /features/1/media': ({ body }: { body: FormData }) => (body.get('file') ? { id: 6 } : reply(400)),
      'PATCH /media/5': { id: 5 },
      'DELETE /media/5': reply(204),
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Ubah 1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ubah fitur #1')).toBeInTheDocument();
    expect(within(dialog).getByText('OBJECTID')).toBeInTheDocument();
    expect(within(dialog).getByTestId('geojson')).toBeInTheDocument();
    // Geometri tersimpan tampil sebagai WKT (Terraformer) dan bisa diubah.
    const wkt = within(dialog).getByLabelText('Geometri (WKT)');
    expect(wkt).toHaveValue('MULTILINESTRING ((110 -7, 110.1 -7))');

    const lebar = within(dialog).getByLabelText('Lebar');
    await userEvent.clear(lebar);
    await userEvent.type(lebar, '7.5');
    // Kondisi ruas SK dari tabel survei: tampil terkunci, tidak ikut dikirim.
    expect(within(dialog).getByLabelText(/Kondisi/)).toBeDisabled();
    fireEvent.change(wkt, { target: { value: 'POINT (110 -7)' } });
    expect(within(dialog).getByText('Tipe geometri tidak sesuai layer (LineString).')).toBeInTheDocument();
    fireEvent.change(wkt, { target: { value: 'LINESTRING (110 -7, 111 -7)' } });

    // Metadata foto disimpan lewat PATCH saat keterangan ditinggalkan.
    const caption = within(dialog).getByLabelText('Keterangan foto');
    await userEvent.type(caption, 'Retak memanjang');
    act(() => caption.blur());
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url === '/media/5')?.body).toMatchObject({ caption: 'Retak memanjang' }));

    const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['img'], 'foto.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/features/1/media')).toBe(true));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus foto' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yakin hapus?' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/media/5')).toBe(true));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'PATCH' && c.url === '/features/1')?.body).toEqual({
      properties: { nama_ruas: 'Jl. Wates', lebar_m: 7.5 },
      geometry: { type: 'LineString', coordinates: [[110, -7], [111, -7]] },
      tahunData: new Date().getFullYear(),
      updatedAt: '2026-11-02T03:04:05.678Z', // versi yang dibuka: server menolak 409 bila sudah diubah orang lain
    });
  });

  it('upload foto gagal menampilkan toast', async () => {
    mockApi({ ...base(), 'POST /features/1/media': reply(400, { error: 'Bukan gambar' }) });
    await open('/data/jalan-kabupaten?edit=1');
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('Bukan gambar')).toBeInTheDocument();
  });

  it('tambah fitur garis: wajib WKT, WKT rusak, kondisi terkunci, foto antrean diunggah setelah simpan', async () => {
    URL.createObjectURL = () => 'blob:foto';
    URL.revokeObjectURL = () => undefined;
    const calls = mockApi({ ...base(), 'POST /layers/jalan-kabupaten/features': { id: '3' }, 'POST /features/3/media': { id: 7 } });
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Tambah fitur/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Tambah Kondisi Jalan 2026')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Nama Ruas/), 'Jl. Baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Isi geometri LineString dalam format WKT.');
    const wkt = within(dialog).getByLabelText('Geometri (WKT)');
    fireEvent.change(wkt, { target: { value: 'LINESTRING (110 -7' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('WKT/GeoJSON tidak valid');
    fireEvent.change(wkt, { target: { value: 'LINESTRING (110 -7, 111 -7)' } });

    // Kondisi ruas SK tidak diisi tangan (dihitung dari tabel survei setelah nama ruasnya cocok).
    expect(within(dialog).getByLabelText(/Kondisi/)).toBeDisabled();
    await userEvent.upload(dialog.querySelector('input[type=file]') as HTMLInputElement, new File(['img'], 'lubang.jpg', { type: 'image/jpeg' }));
    expect(within(dialog).getByText('Diunggah saat fitur disimpan.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/media'))).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST' && c.url === '/layers/jalan-kabupaten/features')?.body).toMatchObject({
      properties: { nama_ruas: 'Jl. Baru' }, geometry: { type: 'LineString', coordinates: [[110, -7], [111, -7]] },
    });
    const upload = calls.find((c) => c.url === '/features/3/media')!.body as FormData;
    expect(upload.get('tanggal')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(screen.getByRole('button', { name: /Tambah fitur/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('tambah titik PJU: klik peta menulis WKT POINT; edit titik tanpa ubah geometri', async () => {
    const calls = mockApi({
      ...base(),
      'GET /layers/pju/features': page([{ id: '8', properties: { kode: 'P1' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' }]),
      'GET /features/8': { id: '8', properties: { kode: 'P1' }, geometry: { type: 'MultiPoint', coordinates: [[110.1, -7.8]] }, media: [], updatedAt: '2026-11-02T03:04:05.678Z' },
      'POST /layers/pju/features': { id: '9' },
      'PATCH /features/8': { id: '8' },
    });
    renderAt('/data/pju?edit=new');
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(within(dialog).getByText(/Klik peta, tulis WKT/)).toBeInTheDocument();
    // Layer tanpa field kondisi = data statis: tanpa bagian dokumentasi foto.
    expect(within(dialog).queryByText('Dokumentasi')).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type=file]')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/Kode/), 'P2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Isi geometri Point dalam format WKT.');
    act(() => fakeMap.fire('click', { lngLat: { lng: 110.123456789, lat: -7.8 } }));
    expect(within(dialog).getByLabelText('Geometri (WKT)')).toHaveValue('POINT (110.1234568 -7.8)');
    expect(within(dialog).getByTestId('marker')).toHaveAttribute('data-lng', '110.1234568');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ properties: { kode: 'P2', daya_watt: null }, geometry: { type: 'Point', coordinates: [110.1234568, -7.8] }, tahunData: new Date().getFullYear() }));

    await userEvent.click(await screen.findByRole('button', { name: 'Ubah 8' }, { timeout: 5000 }));
    const edit = await screen.findByRole('dialog');
    await waitFor(() => expect(within(edit).getByLabelText('Geometri (WKT)')).toHaveValue('POINT (110.1 -7.8)'));
    await userEvent.click(within(edit).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ properties: { kode: 'P1', daya_watt: null }, tahunData: new Date().getFullYear() }));
  });

  it('PJU berkondisi: "Mati" wajib foto (pesan & tolak simpan), kondisi dikosongkan lalu tersimpan; batal ubah fitur yang gagal dimuat', async () => {
    const pju = { ...LAYERS[4]!, fields: [...LAYERS[4]!.fields, { key: 'kondisi', label: 'Kondisi', type: 'select' as const, options: ['Menyala', 'Mati'] }] };
    const calls = mockApi({
      ...base(), 'GET /layers': LAYERS.map((l) => (l.slug === 'pju' ? pju : l)),
      'GET /layers/pju/features': page([{ id: '8', properties: { kode: 'P1' }, createdAt: '', updatedAt: '2026-11-01T00:00:00Z' }]),
      'GET /features/8': reply(500, { error: 'x' }),
      'POST /layers/pju/features': { id: '9' },
    });
    renderAt('/data/pju?edit=new');
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await userEvent.type(within(dialog).getByLabelText(/Kode/), 'P2');
    await userEvent.type(within(dialog).getByLabelText('Geometri (WKT)'), 'POINT (110.1 -7.8)');
    await choose('Kondisi', 'Mati');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('lampirkan minimal 1 foto');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    // Galat simpan = pesan wajib foto yang sudah tampil: tidak digandakan.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(within(dialog).getAllByRole('alert')).toHaveLength(1);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    // Tombol hapus pilihan HeroUI = span aria-hidden (pintasan keyboard ada di trigger).
    await userEvent.click(dialog.querySelector('#kondisi [data-slot="select-clear-button"], [data-slot="select-clear-button"]:not([data-empty])')!);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ properties: { kode: 'P2', kondisi: null } }));

    await userEvent.click(await screen.findByRole('button', { name: 'Ubah 8' }, { timeout: 5000 }));
    const edit = await screen.findByRole('dialog');
    // Detail gagal dimuat: form kosong, Kode wajib diisi dulu agar konfirmasi muncul.
    await userEvent.type(await within(edit).findByLabelText(/Kode/, {}, { timeout: 5000 }), 'P9');
    await userEvent.click(within(edit).getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tidak' })).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('viewer melihat detail baca-saja', async () => {
    mockApi({ ...base('viewer'), 'GET /features/1': { ...ROAD_DETAIL, properties: { nama_ruas: 'Jl. Wates' }, geometry: undefined } });
    await open('/data/jalan-kabupaten?edit=1');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Detail fitur #1')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Simpan' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Geometri (WKT)')).toHaveAttribute('readonly');
    expect(within(dialog).queryByRole('button', { name: 'Hapus foto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hapus 1' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('viewer pada titik: peta tanpa klik-untuk-taruh; memuat detail', async () => {
    mockApi({
      ...base('viewer'),
      'GET /layers/pju/features': page([]),
      'GET /features/8': { id: '8', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[110.1, -7.8]] }, media: [], updatedAt: '2026-11-02T03:04:05.678Z' },
      'GET /features/9': () => new Promise(() => undefined),
    });
    renderAt('/data/pju?edit=8');
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    await within(dialog).findByTestId('marker');
    expect(fakeMap.handlers.some((h) => h.event === 'click')).toBe(false);
    window.history.pushState({}, '', '/data/pju?edit=9');
  });

  it('dialog memuat detail', async () => {
    mockApi({ ...base(), 'GET /features/1': () => new Promise(() => undefined) });
    await open('/data/jalan-kabupaten?edit=1');
    expect(within(await screen.findByRole('dialog')).getByText('Memuat…')).toBeInTheDocument();
  });
});

describe('Data: unggah SHP & layer baru', () => {
  const zip = new File(['PK'], 'jalan.zip', { type: 'application/zip' });

  it('periksa -> peringatan -> simpan (mode ganti)', async () => {
    const calls = mockApi({
      ...base(),
      'POST /layers/jalan-kabupaten/upload': ({ url }: { url: string }) =>
        url.includes('dryRun=true')
          ? { count: 1200, skipped: 3, hasPrj: false, columns: ['Nama_Ruas', 'KONDISI_X'], missingFields: ['kondisi'], sample: { type: 'FeatureCollection', features: [
            { type: 'Feature', geometry: null, properties: { Nama_Ruas: '', KONDISI_X: null } },
            { type: 'Feature', geometry: null, properties: { Nama_Ruas: 'Jl. Wates' } },
          ] } }
          : { count: 1200 },
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Unggah Data/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Periksa file' })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText('File shapefile atau GeoJSON'), zip);
    expect(within(dialog).getByText('jalan.zip')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Ganti semua' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Periksa file' }));
    expect(await within(dialog).findByText('1.200')).toBeInTheDocument();
    expect(within(dialog).getByText(/Tidak ada file .prj/)).toBeInTheDocument();
    expect(within(dialog).getByText(/menghapus 3 fitur lama/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('geojson')).toBeInTheDocument();
    // Pencocokan kolom: Nama_Ruas otomatis ke nama_ruas (contoh nilai dari fitur pertama yang terisi).
    expect(within(dialog).getByText('1 dari 3 kolom terpasang')).toBeInTheDocument();
    expect(within(dialog).getByText('Jl. Wates')).toBeInTheDocument();
    await choose('Kolom berkas untuk Kondisi', 'KONDISI_X');
    expect(within(dialog).getByText('Kolom ini kosong di contoh')).toBeInTheDocument();
    await choose('Kolom berkas untuk Nama Ruas', 'Tidak diisi');
    expect(within(dialog).getByText(/Kolom wajib belum dipasangkan: Nama Ruas/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Simpan 1.200 fitur/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unggahan selesai' })).getByRole('button', { name: 'Oke' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.url.includes('/upload')).map((c) => c.url)).toEqual([
      '/layers/jalan-kabupaten/upload?mode=replace&dryRun=true',
      `/layers/jalan-kabupaten/upload?mode=replace&dryRun=false&tahun=${new Date().getFullYear()}&${new URLSearchParams({ map: '{"kondisi":"KONDISI_X"}' })}`,
    ]);
  });

  it('ringkasan tanpa peringatan, error server, ganti file, batal', async () => {
    mockApi({
      ...base(),
      'POST /layers/jalan-kabupaten/upload': ({ url }: { url: string }) =>
        url.includes('dryRun=true') ? { count: 2, skipped: 0, hasPrj: true, columns: [], missingFields: [] } : reply(400, { error: '2 fitur tidak valid' }),
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Unggah Data/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(within(dialog).getByLabelText('File shapefile atau GeoJSON'), zip);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Ganti semua' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Tambahkan' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Periksa file' }));
    await within(dialog).findByText('Fitur valid');
    expect(within(dialog).queryByText(/Tidak ada file .prj/)).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('geojson')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Simpan 2 fitur/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('2 fitur tidak valid');
    fireEvent.change(within(dialog).getByLabelText('File shapefile atau GeoJSON'), { target: { files: [] } });
    expect(within(dialog).getByText('Seret file shapefile (.zip) atau GeoJSON ke sini')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('layer baru: gagal lalu sukses dan pindah ke layer baru', async () => {
    let fail = true;
    const calls = mockApi({
      ...base(),
      'POST /layers': ({ body }: { body: { slug: string } }) => (fail ? reply(409, { error: 'Data sudah ada (duplikat)' }) : { ...LAYERS[6], ...body }),
      'GET /layers/sekolah-dasar/features': page([]),
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Layer baru' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nama layer'), 'Sekolah Dasar');
    expect(within(dialog).getByText('Slug: sekolah-dasar')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Atribut (opsional)'), 'nama | Nama');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat layer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('duplikat');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ slug: 'sekolah-dasar', name: 'Sekolah Dasar', category: 'Data Pendukung', year: null, geomType: 'Point', style: { color: '#D97706' }, fields: [{ key: 'nama', label: 'Nama', type: 'text' }], sumber: null }); // #DE533C dipakai Kondisi Jalan: tidak ditawarkan
    fail = false;
    await userEvent.type(within(dialog).getByLabelText('Tahun'), '2026');
    await userEvent.type(within(dialog).getByLabelText('Sumber data'), '  BPS Kulon Progo ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buat layer' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({ year: 2026, sumber: 'BPS Kulon Progo' }));
    await waitFor(() => expect(window.location.pathname).toBe('/data/sekolah-dasar'));
    expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({ year: 2026 });
    await userEvent.click(screen.getByRole('button', { name: 'Layer baru' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }));
  });
});

describe('Data: tempat sampah (soft delete)', () => {
  const TRASH = page([
    { id: '9', properties: { nama_ruas: 'Jl. Lama', kondisi: 'Baik' }, deletedAt: '2026-11-20T01:02:03Z', deletedBy: 'Rina Wulandari' },
    { id: '8', properties: { nama_ruas: 'Jl. Yatim' }, deletedAt: '2026-11-19T01:02:03Z', deletedBy: null },
  ], 45);

  it('editor: tab Terhapus, pulihkan (berhasil & gagal), ganti ukuran halaman, tanpa hapus permanen', async () => {
    let fail = false;
    const calls = mockApi({
      ...base(), 'GET /stats/kecamatan': ['Wates', 'Sentolo'],
      'GET /layers/jalan-kabupaten/features/trash': ({ url }: { url: string }) => (url.includes('q=zzz') ? page([]) : TRASH),
      'POST /features/9/restore': () => (fail ? reply(500, { error: 'Server error' }) : ROAD_DETAIL),
      'POST /layers/jalan-kabupaten/features/bulk-restore': () => (fail ? reply(500, { error: 'Bulk gagal' }) : { restored: 2 }),
    });
    await open();
    await userEvent.click(screen.getByRole('radio', { name: 'Terhapus' }));
    expect(await screen.findByText('Jl. Lama')).toBeInTheDocument();
    expect(screen.getByText(/tidak tampil di peta, Ringkasan, maupun ekspor/)).toBeInTheDocument();
    // Pencarian dan filter kecamatan ikut ke tab Terhapus; tanpa hasil = pesan menyebut kata kuncinya.
    await choose('Filter kecamatan', 'Wates');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/layers/jalan-kabupaten/features/trash') && c.url.includes('kecamatan=Wates'))).toBe(true));
    await choose('Filter kecamatan', 'Semua kecamatan');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('Tidak ada fitur terhapus yang cocok dengan "zzz".')).toBeInTheDocument();
    // Urut kolom Fitur saat daftar kosong: tanpa atribut nama, jatuh ke id.
    await userEvent.click(screen.getByRole('columnheader', { name: /Fitur/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=zzz') && c.url.includes('sort=id') && c.url.includes('order=asc'))).toBe(true));
    await userEvent.clear(screen.getByRole('searchbox'));
    expect(await screen.findByText('Jl. Lama')).toBeInTheDocument();
    // Urut header (server-side): Fitur = atribut nama fitur, lalu ID & penghapus; klik ulang = arah dibalik.
    await userEvent.click(screen.getByRole('columnheader', { name: /Fitur/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('sort=nama_ruas'))).toBe(true));
    await userEvent.click(screen.getByRole('columnheader', { name: /^ID/ }));
    await userEvent.click(screen.getByRole('columnheader', { name: /^ID/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('sort=id&order=desc'))).toBe(true));
    await userEvent.click(screen.getByRole('columnheader', { name: /Dihapus oleh/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('sort=deleted_by'))).toBe(true));
    expect(await screen.findByText('Jl. Lama')).toBeInTheDocument();
    // Penghapus yang akunnya sudah dihapus = "–".
    expect(within(screen.getAllByRole('row').find((r) => r.textContent?.includes('Jl. Yatim'))!).getByText('–')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hapus permanen/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Jl. Lama' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/features/9/restore')).toBe(true));
    expect(await screen.findByText('Fitur dipulihkan')).toBeInTheDocument();
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Jl. Lama' }));
    expect(await screen.findByText('Server error')).toBeInTheDocument();

    // Pilih semua -> bilah aksi -> pulihkan massal (berhasil, lalu gagal); batal mengosongkan pilihan.
    fail = false;
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Pulihkan 2' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/layers/jalan-kabupaten/features/bulk-restore')?.body).toEqual({ ids: [9, 8] }));
    expect(await screen.findByText('2 fitur dipulihkan')).toBeInTheDocument();
    fail = true;
    await userEvent.click(await screen.findByRole('checkbox', { name: /^Pilih 9/ }));
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Pulihkan 1' }));
    expect(await screen.findByText('Bulk gagal')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/layers/jalan-kabupaten/features/trash') && c.url.includes('page=2'))).toBe(true));
    await choose('Baris', '50');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/layers/jalan-kabupaten/features/trash') && c.url.includes('limit=50'))).toBe(true));
    await userEvent.click(screen.getByRole('radio', { name: 'Aktif' }));
    expect(await screen.findByText('Jl. Wates')).toBeInTheDocument();
  });

  it('superadmin: hapus permanen lewat konfirmasi (batal lalu ya), tempat sampah lalu kosong', async () => {
    let purged = false;
    const calls = mockApi({
      ...base(), 'GET /auth/me': { user: user('superadmin') },
      'GET /layers/jalan-kabupaten/features/trash': () => (purged ? page([]) : TRASH),
      'DELETE /features/9/purge': () => { purged = true; return reply(204); },
    });
    await open();
    await userEvent.click(screen.getByRole('radio', { name: 'Terhapus' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus permanen Jl. Lama' }));
    expect(await screen.findByRole('dialog', { name: 'Hapus permanen fitur ini?' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Hapus permanen Jl. Lama' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Hapus permanen fitur ini?' })).getByRole('button', { name: 'Hapus permanen' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/features/9/purge')).toBe(true));
    expect(await screen.findByText('Fitur dihapus permanen')).toBeInTheDocument();
    expect(await screen.findByText('Belum ada fitur yang dihapus.')).toBeInTheDocument();
  });
});
