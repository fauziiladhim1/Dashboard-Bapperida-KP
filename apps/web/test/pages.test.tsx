import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeMap, mapState } from './map-mock';
import { choose, LAYERS, mockApi, page, renderAt, reply, user } from './utils';

const STATS = {
  'GET /stats/timeseries': [{ tahun: 2024, miskin: 9000, jalanKm: 0, jalanRusakKm: 0 }, { tahun: 2025, miskin: 8800, jalanKm: 5.3, jalanRusakKm: 2 }, { tahun: 2026, miskin: 9100, jalanKm: 0, jalanRusakKm: 0 }],
  'GET /stats/layers/jalan-kabupaten': [{ key: 'Baik', count: 2, lengthKm: 30, areaHa: 0 }, { key: 'Rusak Berat', count: 1, lengthKm: 10, areaHa: 0 }],
  'GET /stats/layers/pju': [{ key: 'LED', count: 8, lengthKm: 0, areaHa: 0 }, { key: 'SON-T', count: 2, lengthKm: 0, areaHa: 0 }],
  'GET /stats/layers/tutupan-lahan': [{ key: 'Permukiman dan Tempat Kegiatan', count: 5, lengthKm: 0, areaHa: 250 }, { key: 'Sawah', count: 2, lengthKm: 0, areaHa: 400 }],
  'GET /stats/layers/batas-administrasi': [{ key: null, count: 1, lengthKm: 0, areaHa: 1000 }],
  'GET /stats/layers/kawasan-pertanian': [{ key: 'Sawah', count: 3, lengthKm: 0, areaHa: 15400 }],
  'GET /stats/layers/potensi-bencana': [{ key: 'Tinggi', count: 1, lengthKm: 0, areaHa: 1200 }],
  'GET /stats/layers/penggunaan-lahan': [{ key: 'Sawah', count: 3, lengthKm: 0, areaHa: 15400 }, { key: null, count: 1, lengthKm: 0, areaHa: 100 }],
  'GET /stats/ruas-jalan': [
    { kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2025, ruas: 'Bendo - Bolon', baik: 2.3, sedang: 0.05, rusakRingan: 1.1, rusakBerat: 0, perbaikan: 0 },
    { kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2025, ruas: 'Tanjung - Semagung', baik: 0.8, sedang: 0.1, rusakRingan: 0.2, rusakBerat: 0.71, perbaikan: 0.5 },
  ],
  'GET /stats/layers/jalan-kabupaten/kecamatan': [
    { kecamatan: 'Wates', key: 'Baik', count: 1, lengthKm: 20, areaHa: 0 },
    { kecamatan: 'Wates', key: null, count: 1, lengthKm: 2, areaHa: 0 },
    { kecamatan: 'Sentolo', key: 'Rusak Berat', count: 1, lengthKm: 10, areaHa: 0 },
  ],
};

const AUDIT = page([
  { id: '2', action: 'create', entity: 'feature', entityId: '9', userName: 'Rina', ip: '::1', createdAt: '2026-11-01T01:00:00Z' },
  { id: '1', action: 'login', entity: 'user', entityId: null, userName: null, ip: '::1', createdAt: '2026-11-01T00:00:00Z' },
], 45);

// Nilai terpilih pemilih "Dari tahun" grafik tren (header kartu tanpa subjudul rentang).
const dari = () => screen.getAllByRole('button', { name: /Dari tahun/ })[0]!;

describe('Pencarian global', () => {
  it('mengelompokkan menu, layer, wilayah, dan data; pilih wilayah membuka peta terfilter', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS,
      'GET /search': {
        regions: [{ type: 'kecamatan', name: 'Wates', kecamatan: null, bbox: [110.1, -7.9, 110.2, -7.8] }],
        features: [{ id: '5', slug: 'pju', layer: 'PJU', color: '#EAB308', label: 'Lampu Alun-Alun', kecamatan: 'Wates', matchKey: 'kode', matchValue: 'PJU Wates 01', lng: 110.15, lat: -7.85 }],
      },
    });
    renderAt('/');
    const box = await screen.findByRole('combobox', { name: 'Cari data di semua layer' }, { timeout: 10000 });
    await userEvent.type(box, 'wat');
    expect(await screen.findByText('Wilayah', {}, { timeout: 15_000 })).toBeInTheDocument();
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Data')).toBeInTheDocument();
    // Atribut yang cocok ditampilkan dengan label kolom layer.
    expect(within(list).getByText('Kode: PJU Wates 01')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === '/search?q=wat')).toBe(true));
    await userEvent.click(screen.getByRole('option', { name: /^Wates/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/peta'), { timeout: 15_000 }); // chunk Peta dimuat malas
    expect(new URLSearchParams(window.location.search).get('kec')).toBe('Wates');
  });

  it('wilayah kalurahan (ber-id) membuka fitur batas di titik tengah bbox', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS,
      'GET /search': { regions: [{ type: 'kalurahan', id: '42', name: 'Bendungan', kecamatan: 'Wates', bbox: [110.1, -7.9, 110.3, -7.7] }], features: [] },
    });
    renderAt('/');
    await userEvent.type(await screen.findByRole('combobox', { name: 'Cari data di semua layer' }, { timeout: 10000 }), 'ben');
    await userEvent.click(await screen.findByRole('option', { name: /^Bendungan/ }, { timeout: 5000 }));
    // Halaman Peta membaca lalu membersihkan param URL: yang diuji efeknya (detail fitur 42 diminta, tanpa filter kecamatan).
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/features/42'))).toBe(true), { timeout: 5000 });
    expect(calls.some((c) => c.url.includes('kecamatan=Bendungan'))).toBe(false);
  });
});

describe('Ringkasan', () => {
  it('KPI, kartu jalan ringkas, tren; tanpa donut, utilitas, kesesuaian, dan aktivitas', async () => {
    const tutupan = { ...LAYERS[0]!, id: 99, slug: 'tutupan-lahan', name: 'Tutupan Lahan', year: null };
    const util = { ...LAYERS[0]!, id: 98, slug: 'utilitas-umum', name: 'Utilitas Umum', year: null };
    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': [...LAYERS, tutupan, util], ...STATS, 'GET /audit': AUDIT });
    renderAt('/');
    // Kondisi jalan: jumlah ruas SK per kelas (kelas dari tabel survei lewat nama ruas): 1 dari 3 ruas rusak berat, 10 km SK.
    expect(await screen.findByRole('button', { name: /^Rusak Berat133%$/ }, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/3 dari 3 ruas disurvei \(100%\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Potensi bencana tinggi' })).toHaveAttribute('href', '/peta?layer=potensi-bencana');
    expect(screen.getByRole('link', { name: 'Peta wilayah' })).toHaveAttribute('href', '/peta');
    // KPI ruas rusak berat di kolom kanan atas (paling bisa ditindaklanjuti); wisata tidak lagi jadi KPI.
    const roadKpi = screen.getByRole('link', { name: 'Kondisi jalan kabupaten' });
    expect(roadKpi).toHaveAttribute('href', '/peta?layer=jalan-kabupaten&tahun=2026');
    expect(within(roadKpi.closest<HTMLElement>('.card')!).getByText('1 ruas rusak berat')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Destinasi pariwisata' })).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument(); // PJU tanpa garis progres
    expect(screen.getByTestId('spark')).toBeInTheDocument(); // tren kemiskinan di KPI
    expect(await screen.findByText('10 titik')).toBeInTheDocument();
    // Porsi LED hanya di baris rincian (tidak diulang sebagai keterangan KPI).
    expect(screen.queryByText('80% lampu LED')).not.toBeInTheDocument();
    // Rincian PJU: jenis lampu terbanyak dulu, porsi dari total titik.
    const pjuCard = screen.getByRole('link', { name: 'Titik penerangan jalan umum' }).closest<HTMLElement>('.card')!;
    expect(within(pjuCard).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['LED880%', 'SON-T220%']);
    expect(screen.getByRole('link', { name: /Kelola data/ })).toBeInTheDocument();
    expect(screen.queryByText('Kesesuaian pola ruang')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jumlah penduduk miskin' })).toHaveAttribute('href', '/peta?layer=penduduk-miskin&tahun=2026');
    expect(screen.getByText(/^\+300 jiwa \(\+\d+%\) dibanding 2025$/)).toBeInTheDocument();
    expect(screen.getByText('Tren tahunan')).toBeInTheDocument();
    // Rincian dipindah ke halaman Data / Peta / Log.
    expect(screen.queryByText(/^Survei 2025: 2 ruas/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aktivitas terbaru')).not.toBeInTheDocument();
    expect(screen.queryByText('Fasilitas Umum')).not.toBeInTheDocument();
    expect(screen.queryByText(/Perubahan penduduk miskin per kecamatan/)).not.toBeInTheDocument();
  });

  it('rentang tahun (dropdown) hanya memotong grafik tren: KPI, ruas jalan, URL dan peta tetap', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS });
    renderAt('/');
    await screen.findByRole('group', { name: 'Rentang tahun' }, { timeout: 10000 });
    await choose('Dari tahun', '2025');
    await waitFor(() => expect(dari()).toHaveTextContent('2025'));
    expect(window.location.search).toBe('');
    expect(screen.getByRole('link', { name: 'Jumlah penduduk miskin' })).toHaveAttribute('href', '/peta?layer=penduduk-miskin&tahun=2026');
    expect(calls.filter((c) => c.url.startsWith('/stats/ruas-jalan')).map((c) => c.url)).toEqual(['/stats/ruas-jalan?sampai=2026']);
    expect(screen.getAllByText('2026').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Kembalikan ke seluruh rentang tahun' }));
    await waitFor(() => expect(dari()).toHaveTextContent('2024'));
  });

  it('tahun global (dropdown) mengatur KPI, ruas jalan, layer bertahun dan tautan peta, rentang grafik tetap', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS.map((l) => (l.slug === 'pju' ? { ...l, year: 2026 } : l)), ...STATS });
    renderAt('/');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Jumlah penduduk miskin' })).toHaveAttribute('href', '/peta?layer=penduduk-miskin&tahun=2026'), { timeout: 10000 });
    await choose('Tahun', '2025');
    await waitFor(() => expect(calls.some((c) => c.url === '/stats/ruas-jalan?sampai=2025')).toBe(true));
    expect(window.location.search).toBe('?tahun=2025');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Jumlah penduduk miskin' })).toHaveAttribute('href', '/peta?layer=penduduk-miskin&tahun=2025'));
    expect(screen.getByText(/^-200 jiwa \(-\d+%\) dibanding 2024$/)).toBeInTheDocument();
    // PJU hanya punya versi 2026: di tahun 2025 diberi info belum ada data.
    expect(screen.getAllByText(/Belum ada data sampai tahun 2025/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Buka peta/ })).toHaveAttribute('href', '/peta?tahun=2025');
    expect(dari()).toHaveTextContent('2024');
  });

  it('filter kecamatan menyaring statistik dan peta kecil', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS, 'GET /stats/kecamatan': ['Wates', 'Sentolo'] });
    renderAt('/');
    await choose('Filter kecamatan', 'Sentolo');
    await waitFor(() => expect(calls.some((c) => c.url === '/stats/layers/pju?kecamatan=Sentolo')).toBe(true));
    expect(window.location.search).toBe('?kec=Sentolo');
    await waitFor(() => expect(fakeMap.addSource.mock.calls.some(([, s]) => String(s.tiles[0]).includes('kecamatan=Sentolo'))).toBe(true));
    await choose('Filter kecamatan', 'Semua kecamatan');
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('kosong untuk viewer: grafik menampilkan placeholder, tanpa aktivitas', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': [], 'GET /stats/timeseries': [], 'GET /stats/layers/jalan-kabupaten': [], 'GET /stats/layers/pju': [], 'GET /stats/layers/kawasan-pertanian': [], 'GET /stats/layers/potensi-bencana': [], 'GET /stats/layers/penggunaan-lahan': [], 'GET /stats/layers/jalan-kabupaten/kecamatan': [], 'GET /stats/layers/batas-administrasi': [] });
    renderAt('/');
    // 4 panel (pola ruang, bencana, jalan, tren) + 5 KPI (miskin, PJU, wisata, sawah, SPM): tanpa layer, semua tampil "belum ada data" (bukan 0); viewer tidak disuruh mengunggah.
    await waitFor(() => expect(screen.getAllByText('Belum ada data untuk ditampilkan.')).toHaveLength(3), { timeout: 10000 }); // tren, pola ruang, bencana
    expect(screen.getAllByText('Belum ada data untuk tahun ini')).toHaveLength(5);
    expect(screen.queryByText(/Unggah Data/)).not.toBeInTheDocument();
    expect(screen.queryByText('Aktivitas terbaru')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Kelola data/ })).not.toBeInTheDocument();
  });

  it('query gagal: panel menampilkan galat + coba lagi, bukan "belum ada data"', async () => {
    let fail = true;
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS,
      'GET /stats/timeseries': () => (fail ? reply(500, { error: 'x' }) : STATS['GET /stats/timeseries']) });
    renderAt('/');
    const alert = await screen.findByRole('alert', {}, { timeout: 10000 });
    expect(alert).toHaveTextContent('Gagal memuat data.');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByRole('link', { name: 'Jumlah penduduk miskin' })).toBeInTheDocument();
  });

  it('kelas jalan yang disembunyikan tampil sebagai chip filter; footer hanya hak cipta', async () => {
    const withSrc = LAYERS.map((l) => (l.id <= 2 ? { ...l, sumber: 'DPUPKP 2026' } : l.id === 5 ? { ...l, sumber: 'Dishub' } : l));
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': withSrc, ...STATS });
    renderAt('/');
    const footer = await screen.findByRole('contentinfo', {}, { timeout: 10000 });
    expect(footer).toHaveTextContent(/^© \d{4} Bapperida Kabupaten Kulon Progo\. Hak cipta dilindungi\.$/);
    expect(screen.queryByText(/Sumber data:|bukan penetapan resmi/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter aktif' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /^Rusak Berat/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Baik/ }));
    const chips = screen.getByRole('group', { name: 'Filter aktif' });
    expect(within(chips).getByText('Jalan Rusak Berat disembunyikan')).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole('button', { name: 'Hapus filter Jalan Baik disembunyikan' }));
    expect(screen.getByRole('button', { name: /^Baik/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).queryByText('Jalan Baik disembunyikan')).not.toBeInTheDocument();
    await userEvent.click(within(chips).getByRole('button', { name: 'Hapus semua filter' }));
    expect(screen.queryByRole('group', { name: 'Filter aktif' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rusak Berat/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('KPI ruas rusak berat: km resmi SK + porsi tersurvei; PJU tanpa jenis lampu', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, ...STATS,
      'GET /stats/layers/jalan-kabupaten': [{ key: 'Rusak Berat', count: 1, lengthKm: 3, areaHa: 0, value: 4.5 }],
      'GET /stats/layers/pju': [{ key: null, count: 3, lengthKm: 0, areaHa: 0 }] });
    renderAt('/');
    // Panjang = atribut panjang_km (`value`), bukan panjang geometri.
    expect(await screen.findByText('4,5 km rusak berat, 1 dari 1 ruas disurvei (100%)', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText('Tanpa Kelas')).toBeInTheDocument(); // PJU tanpa jenis lampu
  });

  it('memuat tanpa data (loading)', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': () => new Promise(() => undefined) });
    renderAt('/');
    // KPI layer menampilkan kerangka saat memuat, bukan angka 0.
    expect(await screen.findByText('Titik penerangan jalan umum', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton[aria-busy]').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Log aktivitas', () => {
  it('daftar dan paginasi', async () => {
    const calls = mockApi({ 'GET /auth/me': { user: user() }, 'GET /audit': AUDIT });
    renderAt('/log');
    expect(await screen.findByText('menambah fitur #9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Halaman 3' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Halaman sebelumnya' }));
    expect(calls.filter((c) => c.url.startsWith('/audit')).map((c) => c.url)).toContain('/audit?page=2&limit=20');
  });

  it('log kosong', async () => {
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /audit': () => new Promise(() => undefined) });
    renderAt('/log');
    expect(await screen.findByRole('button', { name: 'Halaman 1' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Pengguna', () => {
  const USERS = [
    { id: 1, name: 'Rina Wulandari', email: 'rina@kp.go.id', role: 'superadmin', status: 'active', createdAt: '2026-10-01T00:00:00Z' },
    { id: 2, name: 'Budi', email: 'budi@kp.go.id', role: 'viewer', status: 'pending', createdAt: '2026-10-02T00:00:00Z' },
    { id: 3, name: 'Sari', email: 'sari@kp.go.id', role: 'editor', status: 'rejected', createdAt: '2026-10-03T00:00:00Z' },
  ];

  it('approve, tolak, ubah peran, hapus, ganti tab', async () => {
    let fail = false;
    const calls = mockApi({
      'GET /auth/me': { user: user() },
      'GET /users': USERS,
      'PATCH /users/2': ({ body }: { body: object }) => (fail ? reply(400, { error: 'Gagal' }) : { ...USERS[1], ...body }),
      'PATCH /users/3': { ...USERS[2], status: 'active' },
      'DELETE /users/2': reply(204),
      'DELETE /users/3': reply(409, { error: 'Masih dipakai' }),
    });
    renderAt('/pengguna');
    expect(await screen.findByText('(Anda)')).toBeInTheDocument();
    expect(screen.getByLabelText('Peran Rina Wulandari')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Hapus Rina Wulandari' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Setujui Budi' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tolak Budi' }));
    await choose(/Peran Budi/, 'Editor');
    await userEvent.click(screen.getByRole('button', { name: 'Setujui Sari' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ status: 'active' }, { status: 'rejected' }, { role: 'editor' }, { status: 'active' }]));
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Tolak Budi' }));
    expect(await screen.findByText('Gagal')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus Budi' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Budi' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Sari' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    expect(await screen.findByText('Masih dipakai')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);

    await userEvent.click(screen.getByRole('tab', { name: 'Aktif' }));
    expect(calls.at(-1)?.url).toBe('/users?status=active');
  });

  it('daftar kosong', async () => {
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /users': [] });
    renderAt('/pengguna');
    expect(await screen.findByText('Tidak ada pengguna.')).toBeInTheDocument();
  });

  it('memuat', async () => {
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /users': () => new Promise(() => undefined) });
    renderAt('/pengguna');
    expect(await screen.findByText('Memuat…')).toBeInTheDocument();
  });
});

describe('Peta', () => {
  const routes = (role: 'editor' | 'viewer' = 'editor') => ({
    'GET /auth/me': { user: user(role) },
    'GET /layers': LAYERS,
    'GET /stats/kecamatan': ['Wates', 'Sentolo'],
    'GET /features/9': { type: 'Feature', id: '9', properties: { nama_ruas: 'Jl. Wates', kondisi: 'Rusak Berat', lain: null }, media: [
      { id: 1, webp: 'a.webp', avif: 'a.avif', width: 10, height: 10, caption: 'Lubang di bahu jalan', tanggal: '2026-11-03', urgensi: 'tinggi' },
      { id: 2, webp: 'b.webp', avif: 'b.avif', width: 10, height: 10, caption: 'Retak rambut', tanggal: null, urgensi: 'rendah' },
    ] },
    'GET /features/10': { type: 'Feature', id: '10', properties: {}, media: [] },
  });

  it('menambah vector layer sesuai tipe geometri dan membersihkannya', async () => {
    mockApi(routes());
    const view = renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 5000 });
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledTimes(2));
    const added = fakeMap.addLayer.mock.calls.map(([l]) => l.id);
    expect(added).toEqual(['fill-batas-administrasi', 'line-batas-administrasi', 'line-jalan-kabupaten']);

    // Nyalakan poligon berkelas dan titik.
    await userEvent.click(await screen.findByRole('switch', { name: 'Tampilkan Penggunaan Lahan' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan PJU' }));
    await waitFor(() => expect(fakeMap.addLayer.mock.calls.map(([l]) => l.id)).toEqual(expect.arrayContaining(['fill-penggunaan-lahan', 'circle-pju'])));
    // Slot layer DB `potensi-bencana` diisi raster InaRISK: satu baris saja, tidak dobel di "Data pendukung".
    expect(screen.getAllByRole('switch', { name: 'Tampilkan Potensi Bencana' })).toHaveLength(1);
    // Jenis bahaya lewat dropdown (popover dikunci ke bawah).
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan Potensi Bencana' }));
    await choose('Jenis bahaya', 'Tanah Longsor');
    expect(screen.getByRole('button', { name: /Jenis bahaya/ })).toHaveTextContent('Tanah Longsor');
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan Potensi Bencana' }));

    // Layer turunan dan sumbernya tidak menyala bersamaan (poligon sama tergambar dua kali).
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan Kawasan Pertanian' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tampilkan Penggunaan Lahan' })).not.toBeChecked());
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan Penggunaan Lahan' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tampilkan Kawasan Pertanian' })).not.toBeChecked());

    // Opasitas lewat input range bawaan.
    const slider = screen.getAllByRole('slider', { name: /Transparansi Kondisi Jalan/ })[0]!;
    fireEvent.change(slider, { target: { value: '90' } });
    // Opacity diubah di tempat (setPaintProperty), layer tidak dibuat ulang.
    await waitFor(() => expect(fakeMap.setPaintProperty).toHaveBeenCalledWith('line-jalan-kabupaten', 'line-opacity', 0.9));

    fireEvent.click(screen.getByRole('switch', { name: 'Tampilkan Kondisi Jalan 2026' }));
    await waitFor(() => expect(fakeMap.removeLayer).toHaveBeenCalledWith('line-jalan-kabupaten'));

    fakeMap.rendered = [{ layer: { id: 'circle-pju' }, source: 'src-pju', properties: {} }];
    fakeMap.fire('mousemove', { point: { x: 10, y: 10 } });
    expect(fakeMap.canvas.style.cursor).toBe('pointer');
    fakeMap.fire('mouseout');
    expect(fakeMap.canvas.style.cursor).toBe('');

    view.unmount();
    expect(fakeMap.removeSource).toHaveBeenCalled();
  });

  it('klik fitur membuka popup dengan atribut dan foto, tanpa tombol ubah', async () => {
    mockApi(routes());
    renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 5000 });
    await waitFor(() => expect(fakeMap.handlers.some((h) => h.event === 'click')).toBe(true));

    fakeMap.rendered = [];
    act(() => fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } }));
    fakeMap.rendered = [{ id: 1, source: 'src-tidak-ada' }];
    act(() => fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } }));
    fakeMap.rendered = [{ source: 'src-jalan-kabupaten' }];
    act(() => fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } }));
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();

    fakeMap.rendered = [{ id: 9, source: 'src-jalan-kabupaten' }];
    act(() => fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } }));
    const popup = await screen.findByTestId('popup');
    expect(within(popup).getByText('Memuat…')).toBeInTheDocument();
    expect((await within(popup).findAllByText('Jl. Wates')).length).toBeGreaterThan(0);
    expect(within(popup).queryByText('Nama Ruas')).not.toBeInTheDocument(); // nama sudah jadi judul, tidak diulang
    expect(within(popup).getByText('Kalurahan')).toBeInTheDocument(); // wilayah selalu ada; kosong = "—"
    expect(within(popup).getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-7,110');
    expect(popup.querySelector('img')).toHaveAttribute('src', '/uploads/a.webp');
    // Dokumentasi: urgensi fitur dari kondisi, galeri foto berketerangan; thumbnail mengganti foto utama.
    expect(within(popup).getAllByText('Urgensi Tinggi').length).toBe(1); // badge kelas sudah tampil: urgensi hanya di foto
    expect(within(popup).getByText('Lubang di bahu jalan')).toBeInTheDocument();
    expect(within(popup).getByText('Foto 1/2')).toBeInTheDocument();
    await userEvent.click(within(popup).getByRole('button', { name: 'Tampilkan foto 2' }));
    expect(within(popup).getByText('Retak rambut')).toBeInTheDocument();
    expect(within(popup).getByText('Urgensi Rendah')).toBeInTheDocument();
    // Popup hanya baca: tidak ada tombol ubah data (penyuntingan lewat menu Data).
    expect(within(popup).queryByRole('link', { name: /Ubah data/ })).not.toBeInTheDocument();
    await userEvent.click(within(popup).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();
  });

  it('viewer tidak melihat tombol ubah; layer turunan juga tidak', async () => {
    mockApi(routes('viewer'));
    renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 5000 });
    await userEvent.click(await screen.findByRole('switch', { name: 'Tampilkan Kawasan Pertanian' }));
    fakeMap.rendered = [{ id: 10, source: 'src-kawasan-pertanian' }];
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('src-kawasan-pertanian', expect.anything()));
    act(() => fakeMap.fire('click', { point: {}, lngLat: { lng: 110, lat: -7 } }));
    const popup = await screen.findByTestId('popup');
    await within(popup).findByText('Fitur #10');
    await waitFor(() => expect(within(popup).queryByText('Memuat…')).not.toBeInTheDocument());
    expect(within(popup).queryByRole('link', { name: /Ubah data/ })).not.toBeInTheDocument();
    expect(within(popup).getByRole('link', { name: /Google Maps/ })).toBeInTheDocument();
  });

  it('?layer= dari pencarian menyalakan layer lalu param dibersihkan; kelas legenda bisa dimatikan', async () => {
    mockApi(routes('viewer'));
    renderAt('/peta?layer=pju');
    await waitFor(() => expect(screen.getAllByRole('switch', { name: 'Tampilkan PJU' })[0]).toBeChecked(), { timeout: 5000 });
    await waitFor(() => expect(window.location.search).toBe(''));
    // Matikan kelas: filter MapLibre membuang kelas itu; Tampilkan semua mengembalikannya.
    const kelas = await screen.findAllByRole('checkbox', { name: /Menyala/ });
    await userEvent.click(kelas[0]!);
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenCalledWith('circle-pju', expect.arrayContaining([['!', ['in', ['coalesce', ['to-string', ['get', 'kondisi']], ''], ['literal', ['Menyala']]]]].flat())));
    await userEvent.click(screen.getAllByRole('button', { name: 'Tampilkan semua' })[0]!);
    await waitFor(() => expect(fakeMap.setFilter).toHaveBeenLastCalledWith('circle-pju', null));
  });

  it('filter kecamatan, basemap gelap, panel mobile, peta belum siap', async () => {
    mapState.isLoaded = false;
    mockApi(routes());
    renderAt('/peta');
    await screen.findByText('Layer peta', {}, { timeout: 5000 });
    expect(fakeMap.addSource).not.toHaveBeenCalled();
    mapState.isLoaded = true;

    await userEvent.click(screen.getAllByRole('button', { name: 'Mode gelap' })[0]!);
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    await userEvent.click(screen.getAllByRole('button', { name: 'Mode terang' })[0]!);
    expect(document.documentElement).toHaveClass('light');

    await choose('Filter kecamatan', 'Wates');
    await waitFor(() => expect(fakeMap.addSource.mock.calls.some(([, s]) => String(s.tiles[0]).includes('kecamatan=Wates'))).toBe(true));
    await choose('Filter kecamatan', 'Semua kecamatan');

    await userEvent.click(screen.getByRole('button', { name: /Layer$/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('layers & kecamatan belum termuat', async () => {
    mockApi({ 'GET /auth/me': { user: user() }, 'GET /layers': () => new Promise(() => undefined), 'GET /stats/kecamatan': () => new Promise(() => undefined) });
    renderAt('/peta');
    expect(await screen.findByText('Layer peta', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('Sidebar', () => {
  it('hanya menu (pengaturan di topbar), tanpa daftar data spasial', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [] });
    renderAt('/data');
    const nav = await screen.findByRole('complementary', {}, { timeout: 5000 });
    expect(within(nav).getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByLabelText('Bahasa')).toBeInTheDocument(); // pengaturan pindah ke topbar
    expect(within(nav).queryByText('PJU')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Pengguna')).not.toBeInTheDocument(); // viewer
    await userEvent.click(within(nav).getByRole('link', { name: 'Peta' }));
    await waitFor(() => expect(window.location.pathname).toBe('/peta'));
  });
});

describe('Layer penduduk miskin (satu layer, filter tahun)', () => {
  const steps = { field: 'jumlah', stops: [{ min: 0, label: '< 100', color: '#FEE2E2' }, { min: 1100, label: '≥ 1.100', color: '#7F1D1D' }] };
  const miskin = { ...LAYERS[0]!, id: 50, slug: 'penduduk-miskin', name: 'Penduduk Miskin', category: 'Sosial', year: null, geomType: 'Polygon' as const,
    style: { color: '#DC2626', steps }, featureCount: 264, visibleDefault: false,
    fields: [{ key: 'kalurahan', label: 'Kalurahan', type: 'text' as const }, { key: 'tahun', label: 'Tahun', type: 'number' as const }, { key: 'jumlah', label: 'Jumlah', type: 'number' as const }] };
  const byYear = [2024, 2025].map((y) => ({ key: String(y), count: 88, lengthKm: 0, areaHa: 0 }));

  it('satu baris di panel; peta memfilter tahun terpilih (fallback tahun terakhir <= terpilih); legenda statis; tooltip bernilai', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': [...LAYERS, miskin], 'GET /stats/kecamatan': [],
      'GET /stats/timeseries': STATS['GET /stats/timeseries'], 'GET /stats/layers/penduduk-miskin?by=tahun': byYear,
    });
    renderAt('/peta');
    await screen.findByText('Sosial', {}, { timeout: 5000 });
    expect(screen.getAllByRole('switch', { name: /Tampilkan Penduduk Miskin/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('switch', { name: 'Tampilkan Penduduk Miskin' }));
    const fillOf = () => fakeMap.addLayer.mock.calls.filter(([l]) => (l as { id: string }).id === 'fill-penduduk-miskin').at(-1)?.[0] as { paint: Record<string, unknown>; filter?: unknown } | undefined;
    // Tahun global terbaru (2026) belum ada datanya: pakai 2025 + catatan tahun.
    await waitFor(() => expect(fillOf()?.filter).toEqual(['==', ['to-number', ['get', 'tahun']], 2025]));
    expect(JSON.stringify(fillOf()!.paint)).toContain('"step"');
    expect(screen.getAllByText(/2025/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('≥ 1.100').length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url === '/stats/layers/penduduk-miskin')).toBe(false); // legenda bertingkat statis

    await choose('Tahun', '2024');
    await waitFor(() => expect(fillOf()?.filter).toEqual(['==', ['to-number', ['get', 'tahun']], 2024]));

    fakeMap.rendered = [{ source: 'src-penduduk-miskin', layer: { id: 'fill-penduduk-miskin' }, properties: { kecamatan: 'Kalibawang', kalurahan: 'Banjararum', tahun: 2024, jumlah: 1633 } }];
    act(() => fakeMap.fire('mousemove', { point: { x: 10, y: 10 } }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Banjararum');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Penduduk MiskinJumlah: 1.633'); // nama layer, lalu nilai berlabel atribut
  });
});

describe('Menu Data > Tabel ruas jalan', () => {
  const row = { id: 7, kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2025, ruas: 'Bendo - Bolon', baik: 2.3, sedang: 0.05, rusakRingan: 1.1, rusakBerat: 0, perbaikan: 0 };

  it('dipilih dari pemilih data; sel diubah lalu disimpan; tambah & hapus ruas', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /layers/jalan-kabupaten/features': page([]),
      'GET /tables/ruas-jalan': [row], 'PATCH /tables/ruas-jalan/7': { id: 7 }, 'POST /tables/ruas-jalan': { ...row, id: 8 }, 'DELETE /tables/ruas-jalan/7': { status: 204 },
    });
    renderAt('/data');
    await choose('Pilih layer', 'Rekap Ruas Jalan');
    const cell = await screen.findByDisplayValue('Bendo - Bolon', {}, { timeout: 5000 });
    expect(screen.getByText(/^3,4\d* km$/)).toBeInTheDocument(); // total kondisi (tanpa kolom perbaikan)

    const berat = screen.getAllByRole('spinbutton', { name: 'Rusak berat (km)' })[0]!;
    // "Tidak": isi sel kembali ke nilai tersimpan, tanpa PATCH.
    await userEvent.clear(berat);
    await userEvent.type(berat, '0.9{Enter}');
    expect(await screen.findByText('Ubah Rusak berat (km) dari 0 menjadi 0,9?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tidak' }));
    await waitFor(() => expect(berat).toHaveValue(0));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.clear(berat);
    await userEvent.type(berat, '0.4{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ rusakBerat: 0.4 }));
    // Fokus lepas tanpa perubahan: tidak ada PATCH kedua.
    await userEvent.click(cell);
    await userEvent.tab();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Tambah ruas/ }));
    const save = screen.getByRole('button', { name: 'Simpan' });
    expect(save).toBeDisabled(); // kecamatan/wilayah/ruas wajib
    const texts = screen.getAllByRole('textbox', { name: 'Ruas jalan' });
    await userEvent.type(texts.at(-1)!, 'Baru - Ruas');
    await userEvent.type(screen.getAllByRole('textbox', { name: 'Kecamatan' }).at(-1)!, 'Kalibawang');
    await userEvent.type(screen.getAllByRole('textbox', { name: 'Wilayah' }).at(-1)!, 'Kalibawang II');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ ruas: 'Baru - Ruas', kecamatan: 'Kalibawang', wilayah: 'Kalibawang II' }));

    await userEvent.click(screen.getByRole('button', { name: 'Hapus Bendo - Bolon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ya, hapus' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/tables/ruas-jalan/7')).toBe(true));
  });

  it('ubah sel teks gagal tersimpan (toast), batal hapus, baris draf angka lalu dibatalkan; tabel kosong', async () => {
    const calls = mockApi({
      'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [],
      'GET /tables/ruas-jalan': [row], 'PATCH /tables/ruas-jalan/7': reply(500, { error: 'Server sibuk' }),
    });
    const { unmount } = renderAt('/data/tabel-ruas-jalan');
    // Sel aktif setelah peran pengguna termuat.
    await waitFor(() => expect(screen.getByDisplayValue('Bendo - Bolon')).toBeEnabled(), { timeout: 5000 });
    const ruas = screen.getByDisplayValue('Bendo - Bolon');
    fireEvent.change(ruas, { target: { value: 'Bendo - Baru' } });
    fireEvent.blur(ruas);
    expect(await screen.findByText('Ubah Ruas jalan dari "Bendo - Bolon" menjadi "Bendo - Baru"?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ya, simpan' }));
    expect(await screen.findByText('Server sibuk')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus Bendo - Bolon' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tidak' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tidak' })).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: /Tambah ruas/ }));
    const baik = screen.getAllByRole('spinbutton', { name: 'Baik (km)' }).at(-1)!;
    await userEvent.clear(baik);
    await userEvent.type(baik, '1.5');
    await userEvent.tab();
    expect(screen.getByText('1,5 km')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(screen.queryByText('1,5 km')).not.toBeInTheDocument();
    unmount();

    mockApi({ 'GET /auth/me': { user: user('editor') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /tables/ruas-jalan': [] });
    renderAt('/data/tabel-ruas-jalan');
    expect(await screen.findByText('Belum ada data.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('viewer hanya melihat: sel nonaktif, tanpa tombol tambah/hapus', async () => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [], 'GET /tables/ruas-jalan': [row] });
    renderAt('/data/tabel-ruas-jalan');
    expect(await screen.findByDisplayValue('Bendo - Bolon', {}, { timeout: 5000 })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Tambah ruas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hapus Bendo - Bolon' })).not.toBeInTheDocument();
  });
});

describe('Sidebar & akun', () => {
  it('akun superadmin bawaan: password diatur dari .env, form ganti password tidak tampil', async () => {
    mockApi({ 'GET /auth/me': { user: { ...user('superadmin'), passwordManaged: true } }, 'GET /layers': LAYERS });
    renderAt('/akun');
    expect(await screen.findByText(/SEED_ADMIN_PASSWORD/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password lama')).not.toBeInTheDocument();
  });

  it('sidebar bisa diperkecil (diingat), halaman akun menyimpan profil dan menolak password tak sama', async () => {
    const me = { ...user('viewer') };
    const calls = mockApi({
      'GET /auth/me': { user: me }, 'GET /layers': LAYERS,
      'PATCH /auth/me': ({ body }: { body: Record<string, string> }) => ({ user: { ...me, ...body } }),
    });
    renderAt('/akun');
    const name = await screen.findByLabelText('Nama lengkap', {}, { timeout: 5000 });

    const toggle = screen.getByRole('button', { name: 'Perkecil menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Perbesar menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('sidebar')).toBe('collapsed');
    await userEvent.click(screen.getByRole('button', { name: 'Perbesar menu' }));

    await userEvent.clear(name);
    await userEvent.type(name, 'Rina W');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Profil tersimpan.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ name: 'Rina W' });

    await userEvent.type(screen.getByLabelText('Password lama'), 'Lama12345678');
    await userEvent.type(screen.getByLabelText('Password baru'), 'Baru12345678');
    await userEvent.type(screen.getByLabelText('Ulangi password baru'), 'Beda12345678');
    await userEvent.click(screen.getAllByRole('button', { name: 'Ubah password' }).at(-1)!);
    expect(await screen.findByText('Ulangan password baru tidak sama.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
});
