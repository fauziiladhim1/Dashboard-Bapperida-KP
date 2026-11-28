import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CustomKpi, Layer } from '@/lib/types';
import { choose, LAYERS, mockApi, renderAt, reply, user } from './utils';

const BASE = { 'GET /kpi/layout': { cards: [] }, 'GET /stats/timeseries': [{ tahun: 2026, miskin: 0, jalanKm: 0, jalanRusakKm: 0 }], 'GET /stats/ruas-jalan': [], 'GET /stats/layers/jalan-kabupaten': [] };
const SEKOLAH_2026 = { ...LAYERS[6]!, id: 70, slug: 'data-sekolah-2026', name: 'Sekolah 2026', year: 2026 };
// Layer multi-tahun dalam satu layer (atribut `tahun`), mis. penduduk miskin.
const MISKIN: Layer = {
  ...LAYERS[0]!, id: 80, slug: 'penduduk-miskin', name: 'Penduduk Miskin', category: 'Sosial', year: null,
  fields: [{ key: 'kecamatan', label: 'Kecamatan', type: 'text' }, { key: 'tahun', label: 'Tahun', type: 'number' }, { key: 'jumlah', label: 'Jumlah', type: 'number' }],
};
const kpi = (o: Partial<CustomKpi>): CustomKpi => ({ id: 1, label: 'KPI', layerSlug: 'pju', measure: 'count', sumField: null, byField: null, by2Field: null, chart2: 'line', whereField: null, whereEq: null, unit: null, warn: false, chart: 'auto', sort: 'desc', topN: null, sortOrder: 100, ...o });
const [TOP5, TOP_ALL] = ['5 teratas', 'Semua'];
const KPIS = [
  kpi({ id: 1, label: 'Daya PJU', measure: 'sum', sumField: 'daya_watt', byField: 'kondisi', whereField: 'kode', whereEq: 'A', unit: 'watt', warn: true }),
  // Layer bertahun: kartu memakai versi seri yang sama pada tahun global (Sekolah 2026).
  kpi({ id: 2, label: 'Jumlah sekolah', layerSlug: 'data-sekolah' }),
  kpi({ id: 3, label: 'Panjang jalan', layerSlug: 'jalan-kabupaten', measure: 'length_km', byField: 'lain' }),
  // Versi layer tak tersedia di tahun global: kartu belum ada data, bukan galat.
  kpi({ id: 4, label: 'Yatim', layerSlug: 'sudah-dihapus' }),
  kpi({ id: 5, label: 'Miskin per tahun', layerSlug: 'penduduk-miskin', measure: 'sum', sumField: 'jumlah', byField: 'tahun', unit: 'jiwa' }),
  kpi({ id: 6, label: 'PJU batang', byField: 'kode', chart: 'bar' }),
  kpi({ id: 7, label: 'PJU angka', byField: 'kondisi', chart: 'number' }),
];
// 7 jenis fasilitas: terlalu banyak untuk donut, KPI bawaan utilitas memakai batang rincian.
const UTIL: Layer = { ...LAYERS[0]!, id: 81, slug: 'utilitas-umum', name: 'Utilitas Umum', geomType: 'Point', style: { color: '#2563EB', classField: 'jenis' }, fields: [{ key: 'jenis', label: 'Jenis', type: 'text' }] };
const card = (name: string) => screen.getByRole('link', { name }).closest<HTMLElement>('.card')!;

describe('KPI kustom', () => {
  it('kartu dari resep: angka, bentuk grafik sesuai data, filter, versi tahun; kelola hanya di mode edit', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, SEKOLAH_2026, MISKIN, UTIL], ...BASE, 'GET /kpi': KPIS,
      'GET /stats/layers/utilitas-umum': ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k, i) => ({ key: k, count: 10 - i, lengthKm: 0, areaHa: 0 })),
      'GET /stats/layers/pju': [{ key: 'Menyala', count: 3, lengthKm: 0, areaHa: 0, value: 300 }, { key: null, count: 1, lengthKm: 0, areaHa: 0, value: 50.5 }, { key: 'Mati', count: 1, lengthKm: 0, areaHa: 0, value: 0 }],
      'GET /stats/layers/data-sekolah-2026': [{ key: null, count: 12, lengthKm: 0, areaHa: 0 }],
      'GET /stats/layers/penduduk-miskin': [{ key: '2026', count: 1, lengthKm: 0, areaHa: 0, value: 900 }, { key: '2025', count: 1, lengthKm: 0, areaHa: 0, value: 1000 }],
      'PATCH /kpi/2': (r: { body: unknown }) => ({ ...KPIS[1], ...(r.body as object) }),
      'DELETE /kpi/4': reply(204),
    });
    renderAt('/');
    const daya = await screen.findByRole('link', { name: 'Daya PJU' }, { timeout: 10000 });
    expect(daya).toHaveAttribute('href', '/peta?layer=pju&tahun=2026');
    // Otomatis, kategori sedikit = donut komposisi. Angka utama dibulatkan; legenda 2 desimal; key kosong = tanpa kelas.
    await waitFor(() => expect(card('Daya PJU').textContent).toContain('351 watt'));
    expect(card('Daya PJU').textContent).toContain('Komposisi per kondisi');
    expect(card('Daya PJU').textContent).toContain('50,5 watt');
    expect(within(card('Daya PJU')).getByText('PJU, Kode: A')).toBeInTheDocument();
    expect(within(card('Daya PJU')).getAllByRole('listitem').map((li) => li.textContent?.slice(0, 7))).toEqual(['Menyala', 'Tanpa K']);
    expect(calls.some((c) => c.url.startsWith('/stats/layers/pju?') && c.url.includes('where=kode') && c.url.includes('eq=A') && c.url.includes('sum=daya_watt'))).toBe(true);
    // Rincian per tahun = garis; angka utama = tahun terakhir (bukan jumlah semua tahun); tahun global tidak menyaringnya.
    await waitFor(() => expect(card('Miskin per tahun').textContent).toContain('900 jiwa'));
    expect(card('Miskin per tahun').textContent).toContain('Penduduk Miskin, 2026');
    expect(within(card('Miskin per tahun')).getByTestId('spark')).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith('/stats/layers/penduduk-miskin'))!.url).not.toContain('tahun=2026');
    // Bentuk dipilih tangan: batang (peringkat), angka saja (tanpa grafik).
    expect(within(card('PJU batang')).getByText('Terbanyak per Kode')).toBeInTheDocument();
    expect(within(card('PJU angka')).queryAllByRole('listitem')).toHaveLength(0);
    const sekolah = screen.getByRole('link', { name: 'Jumlah sekolah' });
    expect(sekolah).toHaveAttribute('href', '/peta?layer=data-sekolah-2026&tahun=2026');
    expect(await within(card('Jumlah sekolah')).findByText('12')).toBeInTheDocument();
    expect(within(screen.getByText('Yatim').closest<HTMLElement>('.card')!).getByText('Belum ada data untuk tahun ini')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Panjang jalan' })).toBeInTheDocument();
    await waitFor(() => expect(card('Utilitas Umum').textContent).toContain('jenis fasilitas'));
    expect(card('Utilitas Umum').querySelector('svg circle')).toBeNull(); // batang, bukan donut

    // Di luar mode edit: tanpa tombol kelola.
    expect(screen.queryByRole('button', { name: 'Ubah Jumlah sekolah' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tambah KPI/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ringkasan' }));
    expect(screen.getByRole('button', { name: 'Selesai' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Ubah Jumlah sekolah' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah Data, Grafik & Tata Letak' }));
    const label = await screen.findByLabelText('Judul Kartu');
    await userEvent.clear(label);
    await userEvent.type(label, 'Sekolah aktif');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ label: 'Sekolah aktif', layerSlug: 'data-sekolah', chart: 'auto' }));

    // "Tidak" = batal, tanpa DELETE.
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Yatim' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tidak' })).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Yatim' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/kpi/4')).toBe(true));
    expect(await screen.findByText('KPI dihapus')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByRole('button', { name: 'Hapus Yatim' })).not.toBeInTheDocument();
  }, 90_000); // banyak interaksi; saat suite API + web jalan bersamaan (npm test di root) bisa lewat 40 dtk

  it('builder: field diklik ke rak, ukuran per geometri, nilai filter dari data, pratinjau dari /stats, galat API tampil', async () => {
    let n = 0;
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, MISKIN], ...BASE, 'GET /kpi': [],
      'GET /stats/layers/jalan-kabupaten': [{ key: 'Jl. Wates', count: 2, lengthKm: 3, areaHa: 0, value: 14 }],
      'POST /kpi': () => (++n === 1 ? reply(400, { error: 'Atribut tidak dikenal' }) : kpi({ id: 9 })),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ringkasan' }, { timeout: 10000 }));
    await userEvent.click(screen.getByRole('button', { name: /Tambah KPI/ }));
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Judul Kartu'), 'Lebar jalan');
    // Poligon tanpa atribut angka: hanya jumlah fitur & luas.
    await choose('Layer Data', 'Penggunaan Lahan');
    expect(screen.getByRole('button', { name: 'Total Luas (ha)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lebar' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Batang' })).toBeDisabled();
    // Field kelas di luar isian form (PJU: kondisi) tetap jadi dimensi.
    await choose('Layer Data', 'PJU');
    expect(screen.getByRole('button', { name: 'kondisi' })).toBeInTheDocument();
    // Atribut angka = ukuran, bukan dimensi; kecuali tahun.
    await choose('Layer Data', 'Penduduk Miskin');
    expect(screen.getByRole('button', { name: 'Tahun' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jumlah' })).toBeInTheDocument();
    await choose('Layer Data', 'Kondisi Jalan 2026');
    // Atribut angka di rak Nilai = SUM; agregasi diganti di pil (AVG), lalu diurungkan kembali ke SUM.
    await userEvent.click(screen.getByRole('button', { name: 'Lebar' }));
    expect(screen.getByText('SUM(Lebar)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Rata-rata Atribut' }));
    expect(screen.getByText('AVG(Lebar)')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Donut' })).toBeDisabled(); // rata-rata bukan porsi
    await userEvent.click(screen.getByRole('button', { name: 'Urungkan (Ctrl+Z)' }));
    expect(screen.getByText('SUM(Lebar)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ulangi (Ctrl+Y)' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Jumlah Nilai Atribut' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kondisi' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Batang' }));
    // Urutan & Top N pada pil Rincian.
    await userEvent.click(screen.getByRole('radio', { name: 'Terkecil Dulu' }));
    await choose('Tampilkan', TOP5);
    // Filter di rak: atribut lalu nilainya (dari data layer), keduanya dropdown di rak Filter.
    await choose('Hanya Bila Atribut', 'Nama Ruas');
    await choose('Nilai Filter', 'Jl. Wates');
    await userEvent.type(screen.getByLabelText('Satuan (opsional)'), 'm');
    await userEvent.click(screen.getByRole('switch', { name: 'Angka Peringatan' }));
    // Pratinjau = kartu sungguhan dari /stats dengan resep draf.
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/stats/layers/jalan-kabupaten?') && c.url.includes('by=kondisi') && c.url.includes('sum=lebar_m') && c.url.includes('eq=Jl.'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/Atribut tidak dikenal/)).toBeInTheDocument();
    // Rak filter dikosongkan: nilainya ikut kosong; satuan dikosongkan = null.
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Filter' }));
    await userEvent.clear(screen.getByLabelText('Satuan (opsional)'));
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({
      label: 'Lebar jalan', layerSlug: 'jalan-kabupaten', measure: 'sum', sumField: 'lebar_m', byField: 'kondisi', by2Field: null, chart2: 'line', whereField: null, whereEq: null, unit: null, warn: true, chart: 'bar',
      sort: 'asc', topN: 5,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }, 40_000);

  it('gagal hapus KPI: galat tampil, kartu tetap', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, ...BASE, 'GET /kpi': [KPIS[3]], 'DELETE /kpi/4': reply(500, { error: 'Gagal hapus' }) });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ringkasan' }, { timeout: 10000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Yatim' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    expect(await screen.findByText('Gagal hapus')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus Yatim' })).toBeInTheDocument();
  }, 30_000);

  it('viewer: tanpa tombol Edit ringkasan, tanpa kartu tambah', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...BASE, 'GET /kpi': [] });
    renderAt('/');
    await screen.findByRole('link', { name: 'Jumlah Penduduk Miskin' }, { timeout: 10000 });
    expect(screen.queryByRole('button', { name: 'Edit Ringkasan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tambah KPI/ })).not.toBeInTheDocument();
  });

  it('tata letak dari DB: urutan & tersembunyi; geser di mode edit menyimpan PUT', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, ...BASE, 'GET /kpi': [],
      'GET /kpi/layout': { cards: [{ key: 'trend', span: 12, hidden: false }, { key: 'pola', span: 12, hidden: true }] },
      'PUT /kpi/layout': (r: { body: unknown }) => r.body,
    });
    renderAt('/');
    const hero = await screen.findByRole('link', { name: 'Jumlah Penduduk Miskin' }, { timeout: 10000 });
    // Tren disimpan paling depan: mendahului hero di DOM. Pola ruang tersembunyi di luar mode edit.
    await waitFor(() => expect(screen.getByText('Tren Tahunan').compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.queryByText('Rencana Pola Ruang')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ringkasan' }));
    expect(screen.getAllByText('Rencana Pola Ruang').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Geser Tren Tahunan ke Belakang' }));
    type Put = { cards: { key: string; hidden: boolean }[] };
    const puts = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as Put);
    // Seluruh susunan dikirim (kartu bawaan ikut tercatat), dua teratas tertukar.
    await waitFor(() => expect(puts()[0]?.cards.slice(0, 2).map((c) => c.key)).toEqual(['pola', 'trend']));
    // 9 kartu bawaan + kartu keterpaparan bahaya.
    expect(puts()[0]!.cards).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan Rencana Pola Ruang' }));
    await waitFor(() => expect(puts().at(-1)?.cards.find((c) => c.key === 'pola')?.hidden).toBe(false));
  }, 30_000);
});

describe('KPI kustom: min/maks, urutan, duplikat, seret field ke rak', () => {
  it('kartu MIN/MAX dengan urutan terkecil & abjad; duplikat berhasil lalu gagal', async () => {
    let dup = 0;
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, ...BASE,
      'GET /kpi': [kpi({ id: 11, label: 'Daya min', measure: 'min', sumField: 'daya_watt', byField: 'kode', sort: 'asc' }),
        kpi({ id: 12, label: 'Daya maks', measure: 'max', sumField: 'daya_watt', byField: 'kode', sort: 'label', chart: 'bar' }),
        // Resep lama: SUM tanpa atribut; baris statistik tanpa `value` dihitung 0.
        kpi({ id: 14, label: 'Tanpa atribut', layerSlug: 'jalan-kabupaten', measure: 'sum', byField: 'kondisi', chart: 'number' })],
      'GET /stats/layers/jalan-kabupaten': [{ key: 'Baik', count: 3, lengthKm: 1, areaHa: 0 }],
      'GET /stats/layers/pju': [{ key: 'B2', count: 1, lengthKm: 0, areaHa: 0, value: 40 }, { key: 'B10', count: 1, lengthKm: 0, areaHa: 0, value: 90 }],
      'POST /kpi': () => (++dup === 1 ? kpi({ id: 13 }) : reply(500, { error: 'Gagal duplikat' })),
    });
    renderAt('/');
    await screen.findByRole('link', { name: 'Daya min' }, { timeout: 10000 });
    await waitFor(() => expect(within(card('Daya min')).getByText('Terkecil per Kode')).toBeInTheDocument());
    expect(card('Daya min').textContent).toContain('40');
    expect(within(card('Daya maks')).getByText('Per Kode')).toBeInTheDocument();
    expect(card('Daya maks').textContent).toContain('90');
    // Urut abjad numerik: B2 sebelum B10.
    expect(card('Daya maks').textContent!.indexOf('B2')).toBeLessThan(card('Daya maks').textContent!.indexOf('B10'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ringkasan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duplikat Daya min' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ label: 'Daya min (salinan)', measure: 'min' }));
    expect(calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('id');
    await userEvent.click(screen.getByRole('button', { name: 'Duplikat Daya min' }));
    expect(await screen.findByText('Gagal duplikat')).toBeInTheDocument();
    expect(within(card('Tanpa atribut')).getByText('0')).toBeInTheDocument();
    // Dialog resep SUM tanpa atribut: rak Nilai kosong (petunjuk seret).
    await userEvent.click(screen.getByRole('button', { name: 'Ubah Tanpa atribut' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah Data, Grafik & Tata Letak' }));
    expect(within(screen.getByText('Nilai', { selector: 'span' }).nextElementSibling as HTMLElement).getByText('Seret atau Klik Field ke Sini')).toBeInTheDocument();
  }, 30_000);

  it('builder: chip diseret ke rak (jenis salah & data asing diabaikan); Ctrl+Z/Y tanpa riwayat aman', async () => {
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, ...BASE, 'GET /kpi': [], 'GET /stats/layers/jalan-kabupaten': [{ key: 'Jl. A', count: 1, lengthKm: 1, areaHa: 0 }] });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ringkasan' }, { timeout: 10000 }));
    await userEvent.click(screen.getByRole('button', { name: /Tambah KPI/ }));
    await userEvent.keyboard('{Control>}z{/Control}{Control>}y{/Control}'); // riwayat kosong: tak berubah
    await choose('Layer Data', 'Kondisi Jalan 2026');
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '', effectAllowed: '' };
    const shelf = (name: string) => screen.getByText(name, { selector: 'span' }).nextElementSibling as HTMLElement;
    // Chip ukuran ke rak Rincian: ditolak (jenis berbeda).
    fireEvent.dragStart(screen.getByRole('button', { name: 'Lebar' }), { dataTransfer: dt });
    fireEvent.dragOver(shelf('Rincian'), { dataTransfer: dt });
    fireEvent.dragLeave(shelf('Rincian'));
    fireEvent.drop(shelf('Rincian'), { dataTransfer: dt });
    expect(screen.queryByRole('radio', { name: 'Terkecil Dulu' })).toBeNull();
    // Data bukan chip: diabaikan tanpa galat.
    fireEvent.drop(shelf('Rincian'), { dataTransfer: { getData: () => 'bukan json' } });
    // Chip dimensi ke Rincian; ukuran ke Nilai; dimensi ke Filter.
    fireEvent.dragStart(screen.getByRole('button', { name: 'Kondisi' }), { dataTransfer: dt });
    fireEvent.drop(shelf('Rincian'), { dataTransfer: dt });
    expect(await screen.findByRole('radio', { name: 'Terkecil Dulu' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Abjad / Angka' }));
    fireEvent.dragStart(screen.getByRole('button', { name: 'Lebar' }), { dataTransfer: dt });
    fireEvent.drop(shelf('Nilai'), { dataTransfer: dt });
    expect(screen.getByText('SUM(Lebar)')).toBeInTheDocument();
    // Donut lalu agregasi bukan porsi (MAX): grafik kembali Otomatis. Chip atribut lagi = agregasi tetap MAX.
    await userEvent.click(screen.getByRole('radio', { name: 'Donut' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nilai Terbesar Atribut' }));
    expect(screen.getByText('MAX(Lebar)')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Otomatis' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Jumlah Nilai Atribut' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lebar' }));
    expect(screen.getByText('SUM(Lebar)')).toBeInTheDocument();
    await choose('Tampilkan', TOP5);
    await choose('Tampilkan', TOP_ALL);
    fireEvent.dragStart(screen.getByRole('button', { name: 'Nama Ruas' }), { dataTransfer: dt });
    fireEvent.drop(shelf('Filter'), { dataTransfer: dt });
    await choose('Nilai Filter', 'Jl. A');
    await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Rincian' }));
    expect(screen.queryByRole('radio', { name: 'Terkecil Dulu' })).toBeNull();
    // Ukuran bawaan (bukan atribut) lewat chip; field kelas di luar isian (PJU: kondisi) tampil dengan kuncinya.
    await userEvent.click(screen.getByRole('button', { name: 'Total Panjang (km)' }));
    expect(screen.getByText('Total Panjang (km)', { selector: 'span' })).toBeInTheDocument();
    await choose('Layer Data', 'PJU');
    await userEvent.click(screen.getByRole('button', { name: 'kondisi' }));
    expect(screen.getByText('kondisi', { selector: 'span' })).toBeInTheDocument();
  }, 30_000);
});

describe('Tata letak Ringkasan: lebar, seret, urungkan/ulangi, gagal simpan', () => {
  it('seret-lepas menukar kartu; lebar; Ctrl+Z/Y dan tombol urungkan; PUT gagal = kembali + toast', async () => {
    let fail = false;
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, ...BASE, 'GET /kpi': [],
      'PUT /kpi/layout': (r: { body: unknown }) => (fail ? reply(500, { error: 'Gagal simpan' }) : r.body),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Ringkasan' }, { timeout: 10000 }));
    type Put = { cards: { key: string; span: number }[] };
    const puts = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body as Put);
    const keys = () => puts().at(-1)!.cards.map((c) => c.key);
    await userEvent.keyboard('{Control>}z{/Control}'); // belum ada langkah: tanpa simpan
    expect(puts()).toHaveLength(0);
    // Grip kartu pertama diseret ke sel kartu kedua: dragOver menandai tujuan, dragLeave/dragEnd membersihkan.
    const grips = screen.getAllByLabelText(/^Seret untuk memindah /i);
    const cell = (i: number) => grips[i]!.closest<HTMLElement>('[role="group"]')!;
    const dt = { effectAllowed: '', setData: () => {} };
    fireEvent.dragOver(cell(1)); // belum menyeret: diabaikan
    fireEvent.dragStart(grips[0]!, { dataTransfer: dt });
    fireEvent.dragOver(cell(1));
    fireEvent.dragLeave(cell(1));
    fireEvent.dragLeave(cell(2));
    fireEvent.drop(cell(0), { dataTransfer: dt }); // jatuh di tempat sendiri: tanpa simpan
    expect(puts()).toHaveLength(0);
    fireEvent.dragStart(grips[0]!, { dataTransfer: dt });
    fireEvent.drop(cell(1), { dataTransfer: dt });
    await waitFor(() => expect(puts()).toHaveLength(1));
    const first = keys();
    fireEvent.drop(cell(1)); // tanpa seret aktif: diabaikan
    fireEvent.dragEnd(grips[0]!);
    // Lebar ½ untuk kartu pertama baru.
    await userEvent.click(within(screen.getAllByRole('group', { name: /^Lebar / })[0]!).getByRole('button', { name: '½' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]!.cards[0]!.span).toBe(6);
    // Urungkan lewat tombol, ulangi lewat Ctrl+Y, urungkan lagi lewat Ctrl+Z; di dalam isian pintasan diabaikan.
    await userEvent.click(screen.getByRole('button', { name: 'Urungkan Tata Letak (Ctrl+Z)' }));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(keys()).toEqual(first);
    await userEvent.keyboard('{Control>}y{/Control}');
    await waitFor(() => expect(puts()).toHaveLength(4));
    expect(puts()[3]!.cards[0]!.span).toBe(6);
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}'); // tak ada langkah ulangi: tanpa simpan
    await userEvent.keyboard('z'); // tanpa Ctrl: diabaikan
    await userEvent.click(screen.getByRole('combobox', { name: 'Cari Data di Semua Layer' }));
    await userEvent.keyboard('{Control>}z{/Control}');
    await userEvent.click(document.body);
    expect(puts()).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Ulangi Tata Letak (Ctrl+Y)' })); // nonaktif
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(puts()).toHaveLength(5));
    // Ulangi via tombol, lalu urungkan sampai habis (langkah ketiga tak ada: tanpa simpan).
    await userEvent.click(screen.getByRole('button', { name: 'Ulangi Tata Letak (Ctrl+Y)' }));
    await waitFor(() => expect(puts()).toHaveLength(6));
    // Geser kartu kedua ke depan.
    await userEvent.click(screen.getAllByRole('button', { name: /ke depan$/i })[1]!);
    await waitFor(() => expect(puts()).toHaveLength(7));
    // Simpan gagal: susunan kembali ke versi sebelumnya dan galat tampil.
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Kembalikan Tata Letak Bawaan' }));
    expect(await screen.findByText('Gagal simpan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kembalikan Tata Letak Bawaan' })).toBeEnabled();
  }, 30_000);
});

describe('withSpan (lebar kartu dari builder KPI)', () => {
  const c = (key: string, span: 4 | 6 | 8 | 12 = 4) => ({ key, span, hidden: false });
  it('mengubah lebar kartu yang ada tanpa mengubah urutan', async () => {
    const { withSpan } = await import('@/features/overview/layout');
    expect(withSpan([c('hero', 12), c('kpi:1'), c('tutupan', 12)], 'kpi:1', 8).map((x) => `${x.key}:${x.span}`)).toEqual(['hero:12', 'kpi:1:8', 'tutupan:12']);
  });
  it('KPI baru: setelah KPI kustom terakhir, atau sebelum tutupan lahan', async () => {
    const { withSpan } = await import('@/features/overview/layout');
    expect(withSpan([c('hero'), c('kpi:1'), c('tutupan')], 'kpi:2', 6).map((x) => x.key)).toEqual(['hero', 'kpi:1', 'kpi:2', 'tutupan']);
    expect(withSpan([c('hero'), c('tutupan')], 'kpi:2', 6).map((x) => x.key)).toEqual(['hero', 'kpi:2', 'tutupan']);
    expect(withSpan([c('hero')], 'kpi:2', 6).map((x) => x.key)).toEqual(['hero', 'kpi:2']);
  });
});

describe('KPI kustom: ukuran kartu dari builder', () => {
  it('pratinjau diskalakan ke kanvas; ganti ukuran lalu simpan = lebar kartu ikut tersimpan ke tata letak', async () => {
    // Stub ResizeObserver bawaan setup tidak memanggil callback: di tes ini kanvas melapor lebar 300px.
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(private cb: ResizeObserverCallback) {} observe() { this.cb([{ contentRect: { width: 300 } }] as never, this as never); } unobserve() {} disconnect() {} } as never;
    try {
      const calls = mockApi({
        'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, SEKOLAH_2026], ...BASE, 'GET /kpi': [KPIS[1]!],
        'GET /stats/layers/data-sekolah-2026': [{ key: null, count: 12, lengthKm: 0, areaHa: 0 }],
        'PATCH /kpi/2': (r: { body: unknown }) => ({ ...KPIS[1], ...(r.body as object) }),
        'PUT /kpi/layout': (r: { body: unknown }) => r.body,
      });
      renderAt('/');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Ringkasan' }, { timeout: 10000 }));
      await userEvent.click(screen.getByRole('button', { name: 'Ubah Jumlah sekolah' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah Data, Grafik & Tata Letak' }));
      expect(screen.getByRole('radio', { name: '4 dari 12 kolom' })).toBeChecked(); // lebar bawaan KPI kustom
      expect(screen.getByRole('slider', { name: 'Lebar' })).toHaveAttribute('aria-valuenow', '4');
      await userEvent.click(screen.getByRole('radio', { name: '12 dari 12 kolom' }));
      await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/kpi/layout')?.body)
        .toEqual({ cards: expect.arrayContaining([{ key: 'kpi:2', span: 12, hidden: false }]) }));
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });
});
