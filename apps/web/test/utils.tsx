import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { App, createQueryClient } from '@/app/App';
import type { Layer, User } from '@/lib/types';

type Reply = { status: number; body?: unknown };
type Route = unknown | Reply | ((req: { url: string; body: unknown }) => unknown | Reply);

export const reply = (status: number, body?: unknown): Reply => ({ status, body, __reply: true }) as Reply;
const isReply = (v: unknown): v is Reply => typeof v === 'object' && v !== null && '__reply' in v;

export type Call = { method: string; url: string; body: unknown };

/**
 * Tiruan fetch berbasis tabel rute: kunci "METHOD /path" (tanpa prefix /api/v1).
 * Kunci tanpa query cocok dengan URL apa pun yang path-nya sama.
 */
export const mockApi = (routes: Record<string, Route>) => {
  // Pengaturan DB selalu tersedia (bisa ditimpa tes), sama dengan server yang sudah dimigrasi.
  routes = { 'GET /settings': SETTINGS, ...routes };
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    const key = Object.keys(routes).find((k) => k === `${method} ${url}`) ?? Object.keys(routes).find((k) => k === `${method} ${url.split('?')[0]}`);
    if (!key) return new Response(JSON.stringify({ error: `Tidak dimock: ${method} ${url}` }), { status: 599 });
    const route = routes[key];
    const result = await (typeof route === 'function' ? route({ url, body }) : route);
    const { status, body: resBody } = isReply(result) ? result : { status: 200, body: result };
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(resBody ?? {}), { status });
  });
  return calls;
};

export const renderAt = (path: string) => {
  window.history.pushState({}, '', path);
  const client = createQueryClient();
  return { client, ...render(<App client={client} />) };
};

export const user = (role: User['role'] = 'superadmin', id = 1): User => ({ id, name: 'Rina Wulandari', email: 'rina@kp.go.id', role });

const base = { category: 'Infrastruktur', year: null, sourceLayerId: null, filter: null, visibleDefault: false, sortOrder: 0, updatedAt: '2026-11-01T00:00:00Z', featureCount: 3 };

export const LAYERS: Layer[] = [
  { ...base, id: 1, slug: 'batas-administrasi', name: 'Batas Administrasi', category: 'Dasar', geomType: 'Polygon', style: { color: '#111827' }, fields: [{ key: 'kecamatan', label: 'Kecamatan', type: 'text', required: true }], visibleDefault: true },
  {
    ...base, id: 2, slug: 'jalan-kabupaten', name: 'Kondisi Jalan 2026', year: 2026, geomType: 'LineString', visibleDefault: true,
    style: { color: '#DE533C', classField: 'kondisi', classes: { Baik: '#16A34A', 'Rusak Berat': '#DC2626' } },
    fields: [{ key: 'nama_ruas', label: 'Nama Ruas', type: 'text', required: true }, { key: 'kondisi', label: 'Kondisi', type: 'select', options: ['Baik', 'Rusak Berat'] }, { key: 'lebar_m', label: 'Lebar', type: 'number' }],
  },
  { ...base, id: 3, slug: 'penggunaan-lahan', name: 'Penggunaan Lahan', category: 'Tata Ruang', geomType: 'Polygon', style: { color: '#7CB342', classField: 'kelas', classes: { Sawah: '#7CB342', Hutan: '#1B5E20' } }, fields: [{ key: 'kelas', label: 'Kelas', type: 'select', options: ['Sawah', 'Hutan'] }] },
  { ...base, id: 4, slug: 'kawasan-pertanian', name: 'Kawasan Pertanian', category: 'Tata Ruang', geomType: 'Polygon', style: { color: '#65A30D' }, fields: [], sourceLayerId: 3, filter: { field: 'kelas', values: ['Sawah'] } },
  { ...base, id: 5, slug: 'pju', name: 'PJU', geomType: 'Point', style: { color: '#EAB308', classField: 'kondisi', classes: { Menyala: '#EAB308', Mati: '#6B7280' } }, fields: [{ key: 'kode', label: 'Kode', type: 'text', required: true }, { key: 'daya_watt', label: 'Daya', type: 'number' }] },
  { ...base, id: 6, slug: 'potensi-bencana', name: 'Potensi Bencana', category: 'Kebencanaan', geomType: 'Polygon', style: { color: '#DC2626' }, fields: [], featureCount: 0 },
  { ...base, id: 7, slug: 'data-sekolah', name: 'Sekolah', category: 'Data Pendukung', geomType: 'Point', style: { color: '#123456' }, fields: [], year: 2025 },
];

export const page = <T,>(data: T[], total = data.length) => ({ total, page: 1, limit: 20, data });

/** Pilih opsi pada Select/ComboBox HeroUI (react-aria): buka lewat tombol pemicu, lalu klik opsi. */
export const choose = async (label: string | RegExp, option: string, index = 0) => {
  const trigger = await waitFor(() => {
    const combo = screen.queryAllByRole('combobox', { name: label })[index];
    // Trigger Select dinamai label + nilai terpilih, jadi label string dicocokkan sebagian.
    const name = typeof label === 'string' ? (n: string) => n.includes(label) : label;
    return combo ? within(combo.parentElement!).getByRole('button') : screen.getAllByRole('button', { name })[index]!;
  }, { timeout: 5000 });
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

/** Isi tabel `pengaturan` hasil migrasi 028/029 (fixture tes; aplikasi selalu membacanya dari `GET /settings`). */
export const SETTINGS = {
  urgensi: {
    abaikan: 'belum|tidak diketahui|tidak tercatat',
    aturan: [
      { field: 'jenis_lampu', tinggi: '^hilang$', sedang: null, lainnya: null },
      { field: 'kondisi', tinggi: 'rusak berat|mati|hilang|^rusak$', sedang: 'rusak|sedang', lainnya: 'rendah' as const },
    ],
  },
  keputusan: {
    opsi: [
      { nilai: 'Diproses', warna: 'success' as const, keterangan: { id: 'Masuk rencana penanganan', en: 'Included in the handling plan' } },
      { nilai: 'Ditunda', warna: 'warning' as const, keterangan: { id: 'Menunggu anggaran / data', en: 'Waiting for budget / data' } },
      { nilai: 'Tidak Diproses', warna: 'danger' as const, keterangan: { id: 'Tidak ditindaklanjuti', en: 'No follow-up' } },
      { nilai: 'Selesai', warna: 'success' as const, keterangan: { id: 'Pekerjaan sudah terealisasi', en: 'Work has been completed' } },
    ],
    tuntas: ['Diproses', 'Selesai'], pelaksanaan: ['Diproses', 'Selesai'], selesai: 'Selesai',
  },
  keterpaparan: {
    zona: { layer: 'potensi-bencana', field: 'kelas', nilai: 'Tinggi', jenis: 'jenis_bahaya', gabungan: 'Multi-Bahaya' },
    sekolah: { layer: 'utilitas-umum', field: 'jenis', nilai: 'Pendidikan' }, faskes: { layer: 'utilitas-umum', field: 'jenis', nilai: 'Kesehatan' },
    wisata: { layer: 'destinasi-pariwisata' }, jalan: { layer: 'jalan-kabupaten' },
    permukiman: { layer: 'tutupan-lahan', field: 'kelas', nilai: 'Permukiman dan Tempat Kegiatan' },
  },
};
