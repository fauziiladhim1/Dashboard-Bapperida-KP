import { hash, verify } from '@node-rs/argon2';
import type { Sql } from './client.js';
import { FUNGSI_JALAN } from './parse.js';

type Field = { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[]; required?: boolean };
export type LayerSeed = {
  slug: string;
  name: string;
  category: string;
  year?: number;
  geomType: 'Point' | 'LineString' | 'Polygon';
  style: {
    color: string; classField?: string; classes?: Record<string, string>; labels?: Record<string, string>; groups?: Record<string, string[]>; outline?: boolean; ordinal?: string[];
    steps?: { field: string; stops: { min: number; label: string; color: string }[] };
  };
  fields: Field[];
  /** Asal data, tampil di popup peta. */
  sumber?: string;
  source?: string;
  filter?: { field: string; values: string[] };
  visible?: boolean;
};

const select = (key: string, label: string, options: string[], required = true): Field => ({ key, label, type: 'select', options, required });
const text = (key: string, label: string, required = false): Field => ({ key, label, type: 'text', required });
const num = (key: string, label: string): Field => ({ key, label, type: 'number' });
const palette = (keys: string[], colors: string[]): Record<string, string> => Object.fromEntries(keys.map((k, i) => [k, colors[i]!]));

/** Kelas penggunaan lahan (kolom TutupLahan `Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan.shp`, SHP Audit 2024). */
export const KELAS_PL = [
  'Lahan Terbangun', 'Lahan Tidak Terbangun', 'Sawah Irigasi', 'Sawah Tadah Hujan', 'Ladang', 'Perkebunan', 'Perkebunan Campuran',
  'Tanaman Campuran', 'Hutan Lahan Kering', 'Hutan Lahan Basah', 'Semak Belukar', 'Padang Rumput', 'Hamparan Pasir Pantai',
  'Hamparan Pasir Sungai', 'Sungai', 'Danau', 'Waduk', 'Laguna', 'Tambak Udang', 'Tambak Ikan',
];
const KESESUAIAN = ['Sesuai', 'Tidak Sesuai'];
const rgb = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/**
 * Rencana pola ruang (kolom NAMOBJ `Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan.shp`, SHP Audit 2024), dikelompokkan
 * lindung / budi daya / prasarana. Urutan = urutan legenda saat memuat.
 */
const POLA_GROUPS: Record<string, string[]> = {
  'Kawasan lindung': [
    'Kawasan Hutan Lindung', 'Kawasan Perlindungan Setempat', 'Kawasan Konservasi di Wilayah Pesisir dan Pulau-Pulau Kecil',
    'Suaka Margasatwa', 'Kawasan Cagar Alam Geologi', 'Kawasan Ekosistem Mangrove', 'Kawasan Cagar Budaya', 'Badan Air',
  ],
  'Kawasan budi daya': [
    'Kawasan Hutan Produksi Tetap', 'Kawasan Hutan Produksi Terbatas', 'Kawasan Perkebunan', 'Kawasan Perkebunan Rakyat',
    'Kawasan Tanaman Pangan', 'Kawasan Hortikultura', 'Kawasan Perikanan Budi Daya', 'Kawasan Perikanan Tangkap',
    'Kawasan Pertambangan Mineral Logam', 'Kawasan Peruntukan Industri', 'Kawasan Pariwisata', 'Kawasan Permukiman Perkotaan',
    'Kawasan Permukiman Perdesaan', 'Kawasan Transportasi', 'Kawasan Pertahanan dan Keamanan',
  ],
  Prasarana: ['Badan Jalan'],
};
const KELAS_POLA = Object.values(POLA_GROUPS).flat();
// ponytail: rona mendekati Permen ATR/BPN 14/2021 (lindung hijau tua/tosca, pertanian kuning-hijau, permukiman jingga,
// industri ungu, pariwisata RGB 255 165 255); tiap pasangan CIE76 dE >= 15. Ganti dengan RGB lampiran Permen bila tersedia.
const POLA_COLORS = [
  '#1E6B2D', '#7FDCC4', '#3D8B8B', '#0B4F3C', '#A0785A', '#2E9E6B', '#B03A2E', '#97DBF2',
  '#4CAF50', '#8BC34A', '#00A8A8', '#C5E384', '#E6F542', '#F2A93B', '#3F7FD9', '#1A3E8C',
  '#6B4E3D', '#7B2D8E', rgb(255, 165, 255), '#F57C00', '#FFE08A', '#CD6699', '#6C6C9C',
  '#9E9E9E',
];
/** Tutupan lahan (kolom REMARK `TutupanLahan.shp`, SHP Audit 2024); REMARK kosong disimpan null. */
const TUTUPAN_GROUPS: Record<string, string[]> = {
  Permukiman: ['Permukiman dan Tempat Kegiatan'],
  Pertanian: ['Perkebunan/Kebun', 'Sawah', 'Tegalan/Ladang', 'Kebun Campuran'],
  Vegetasi: ['Herba dan Rumput', 'Semak Belukar', 'Hutan Rimba'],
  'Fasilitas Umum': [
    'Sekolah Dasar', 'Sekolah Menengah Pertama', 'Rumah Sakit', 'Gedung Pemerintah', 'Makam', 'Situs Cagar Budaya',
    'Stadion/Tribun/Bangunan Olah Raga', 'Industri Manufaktur Lainnya',
  ],
  Transportasi: ['Jalan Lokal', 'Jalan Arteri', 'Jalan Kolektor', 'Apron', 'Taxiway', 'Landas Pacu', 'Pelabuhan'],
};
const KELAS_TUTUPAN = Object.values(TUTUPAN_GROUPS).flat();
const TUTUPAN_COLORS = [
  '#E8590C', '#6FAE3A', '#E6F59A', '#F2D43A', '#9C8A1F', '#A8D5A2', '#7A8F5A', '#2D6A2E',
  '#C2255C', '#F783AC', '#E03131', '#5F3DC4', '#6D5D4B', '#B03A2E', '#20C997', '#7B2D8E',
  '#ADB5BD', '#343A40', '#7D8590', '#1C7ED6', '#74C0FC', '#1745A3', '#0C8599',
];
/** Kawasan strategis (Permen 14/2021, garis tepi): Sosial dan Budaya, Pertumbuhan Ekonomi, Pendayagunaan SDA. */
const KS_SOSBUD = rgb(197, 0, 255);
const KS_EKONOMI = rgb(255, 0, 197);
const KS_SDA = rgb(137, 68, 68);
/** Kelas kondisi ruas dari km survei (ambang 20%, fungsi SQL ruas_kelas); ruas tanpa data survei = Belum Disurvei. */
const KONDISI_JALAN = ['Baik', 'Sedang', 'Rusak Ringan', 'Rusak Berat', 'Belum Disurvei'];
const UTILITAS = ['Air Bersih', 'Persampahan', 'Drainase', 'Listrik', 'Telekomunikasi', 'Kesehatan', 'Pendidikan', 'Peribadatan', 'Pemerintahan', 'Perdagangan', 'Pos'];
const STRATEGIS = ['SRS', 'Aerotropolis', 'Penyangga KSPN Borobudur', 'Geopark'];
/** SRS (Satuan Ruang Strategis Keistimewaan DIY) yang beririsan dengan Kulon Progo; tiap SRS satu warna. */
const SRS = ['SRS Perbukitan Menoreh', 'SRS Pantai Selatan Kulon Progo', 'SRS Pusat Kota Wates', 'SRS Makam Girigondo'];
/** Kawasan RIPPARDA Kulon Progo: KPPD = Kawasan Pengembangan Pariwisata Daerah, KSPD = Kawasan Strategis Pariwisata Daerah. */
const KAWASAN_WISATA = ['KPPD 1', 'KPPD 2', 'KSPD 1', 'KSPD 2', 'KSPD 3'];
const TEMA_WISATA = ['Perkotaan Wates', 'Nanggulan-Sentolo-Lendah', 'Pansela Kulon Progo - Aerotropolis', 'Menoreh Selatan', 'Menoreh Utara'];
export const JENIS_LAMPU = ['LED', 'SON-T', 'HPL', 'Hilang', 'Tidak Tercatat'];
const SUMBER_AUDIT = 'SHP Audit 2024, Bapperida Kulon Progo';

/** Slug layer penduduk miskin; dibaca juga oleh deret waktu di stats. */
export const MISKIN_SLUG = 'penduduk-miskin';
/**
 * Penduduk miskin per kalurahan (xlsx Dinsos): satu layer untuk semua tahun, tahun di atribut `tahun` (penanda layer bertahun
 * di web, `isTimed`). Atribut ini dan Tahun Data fitur selalu sama: disinkronkan trigger sync_tahun (migrasi 018).
 * Peta menampilkan tahun yang dipilih di pemilih tahun global (filter atribut), bukan satu layer per tahun.
 * Ambang kelas dari kuintil data 2024–2026 (0–2.562 jiwa/kalurahan), dibulatkan: 80, 233, 594, 1.107.
 */
const MISKIN_LAYER: LayerSeed = {
  slug: MISKIN_SLUG, name: 'Penduduk Miskin', category: 'Sosial', geomType: 'Polygon',
  style: {
    // Warna dasar = simbol layer di panel peta; unik antarlayer (potensi bencana sudah #DC2626).
    color: '#9F1239',
    steps: {
      field: 'jumlah',
      stops: [
        // Lima kelas bernama, warna berurutan ColorBrewer OrRd-5 (terang = sedikit, gelap = banyak).
        { min: 0, label: 'Sangat rendah (0–99 jiwa)', color: '#FEF0D9' }, { min: 100, label: 'Rendah (100–249 jiwa)', color: '#FDCC8A' },
        { min: 250, label: 'Sedang (250–599 jiwa)', color: '#FC8D59' }, { min: 600, label: 'Tinggi (600–1.099 jiwa)', color: '#E34A33' },
        { min: 1100, label: 'Sangat tinggi (≥ 1.100 jiwa)', color: '#B30000' },
      ],
    },
  },
  fields: [text('kecamatan', 'Kecamatan', true), text('kalurahan', 'Kalurahan', true), { ...num('tahun', 'Tahun'), required: true }, num('jumlah', 'Jumlah Penduduk Miskin (jiwa)')],
  sumber: 'Dinas Sosial PPPA Kulon Progo',
};

/** Kelas indeks bahaya InaRISK (0–1); warna mengikuti citra InaRISK (sama dengan HAZARD_CLASSES web). */
export const KELAS_BAHAYA = ['Rendah', 'Sedang', 'Tinggi'];
export const JENIS_BAHAYA = ['Banjir', 'Tanah Longsor', 'Gempa Bumi', 'Tsunami', 'Gelombang Ekstrem & Abrasi', 'Kekeringan', 'Cuaca Ekstrem', 'Likuefaksi', 'Multi-Bahaya'];

/** Dataset awal Bapperida. "Data Pendukung" ditambah lewat menu Data > Layer Baru. */
export const LAYERS: LayerSeed[] = [
  // SHP Audit 2024 tanpa field tahun: batas, tutupan, pola ruang & turunannya statis (year null), tidak ikut pemilih tahun.
  {
    slug: 'batas-administrasi', name: 'Batas Administrasi', category: 'Dasar', geomType: 'Polygon', visible: true,
    style: { color: '#111827' },
    fields: [text('kalurahan', 'Kalurahan', true), text('kecamatan', 'Kecamatan', true)],
    sumber: SUMBER_AUDIT,
  },
  ...(['Nasional', 'Provinsi'] as const).map((status, i): LayerSeed => ({
    // Ruas jalan berstatus nasional/provinsi (bukan kewenangan kabupaten); `kapanewon` = kapanewon yang dilalui.
    slug: `jalan-${status.toLowerCase()}`, name: `Jalan ${status}`, category: 'Infrastruktur', geomType: 'LineString',
    style: { color: ['#7C3AED', '#2563EB'][i]! },
    fields: [text('nama_ruas', 'Nama Ruas', true), text('nomor_ruas', 'Nomor Ruas'), text('fungsi', 'Fungsi Jalan'), text('kapanewon', 'Kapanewon'), num('panjang_km', 'Panjang (km)')],
    sumber: `Data Jalan ${status} Kulon Progo`,
  })),
  {
    // Geometri SK Jalan Kabupaten (415 ruas). Kondisi & km per kondisi dihitung saat query dari tabel survei `ruas_jalan`
    // (ruas_props, join nama ruas): field `kondisi` hanya tampil (terkunci di form, untuk urgensi dokumentasi); nilai kiriman
    // dan atribut SHP diabaikan.
    slug: 'jalan-kabupaten', name: 'Ruas Jalan Kabupaten', category: 'Infrastruktur', geomType: 'LineString',
    style: { color: '#DE533C', classField: 'kondisi', ordinal: KONDISI_JALAN, classes: palette(KONDISI_JALAN, ['#16A34A', '#F59E0B', '#F97316', '#DC2626', '#9CA3AF']) },
    fields: [
      text('nama_ruas', 'Nama Ruas', true), text('nomor_ruas', 'Nomor Ruas'), select('fungsi', 'Fungsi Jalan', FUNGSI_JALAN, false),
      text('kapanewon', 'Kapanewon'), num('panjang_km', 'Panjang (km)'), select('kondisi', 'Kondisi', KONDISI_JALAN, false),
    ],
    sumber: 'SK Jalan Kabupaten Kulon Progo (Draft Final rev3), DPUPKP; kondisi dari survei ruas DPUPKP',
  },
  {
    slug: 'potensi-bencana', name: 'Potensi Bencana', category: 'Kebencanaan', geomType: 'Polygon',
    // Diisi skrip `db:inarisk`: zona bahaya vektor dari raster InaRISK BNPB (kelas Rendah/Sedang/Tinggi), dipotong per kalurahan.
    style: { color: '#DC2626', classField: 'kelas', ordinal: KELAS_BAHAYA, classes: palette(KELAS_BAHAYA, ['#A3D02C', '#FFA500', '#FF0000']) },
    fields: [
      select('jenis_bahaya', 'Jenis Bahaya', JENIS_BAHAYA), select('kelas', 'Kelas Bahaya', KELAS_BAHAYA),
      num('luas_ha', 'Luas (ha)'), text('sumber', 'Sumber'), text('tanggal_ambil', 'Tanggal Ambil'),
      text('kalurahan', 'Kalurahan'), text('kecamatan', 'Kecamatan'),
    ],
    sumber: 'InaRISK BNPB',
  },
  {
    slug: 'penggunaan-lahan', name: 'Rencana Pola Ruang', category: 'Tata Ruang', geomType: 'Polygon',
    style: { color: '#16A34A', classField: 'pola_ruang', classes: palette(KELAS_POLA, POLA_COLORS), groups: POLA_GROUPS },
    fields: [
      select('kelas', 'Penggunaan Lahan', KELAS_PL), text('sub_kelas', 'Sub Penggunaan'), text('keterangan', 'Keterangan'),
      select('pola_ruang', 'Rencana Pola Ruang', KELAS_POLA, false), select('kesesuaian', 'Kesesuaian', KESESUAIAN, false),
    ],
    sumber: SUMBER_AUDIT,
  },
  {
    slug: 'tutupan-lahan', name: 'Tutupan Lahan', category: 'Tata Ruang', geomType: 'Polygon',
    style: { color: '#78716C', classField: 'kelas', classes: palette(KELAS_TUTUPAN, TUTUPAN_COLORS), groups: TUTUPAN_GROUPS },
    fields: [select('kelas', 'Tutupan Lahan', KELAS_TUTUPAN, false)],
    sumber: SUMBER_AUDIT,
  },
  {
    slug: 'utilitas-umum', name: 'Kelengkapan Utilitas Umum', category: 'Infrastruktur', geomType: 'Point',
    style: { color: '#0891B2', classField: 'jenis', classes: palette(UTILITAS, ['#0EA5E9', '#78716C', '#6366F1', '#EAB308', '#A855F7', '#EF4444', '#22C55E', '#14B8A6', '#1D4ED8', '#F97316', '#DB2777']) },
    fields: [text('nama', 'Nama', true), select('jenis', 'Jenis Utilitas', UTILITAS), select('kondisi', 'Kondisi', ['Baik', 'Rusak'], false)],
    sumber: 'Peta Rupabumi Indonesia 1:25.000, Badan Informasi Geospasial',
  },
  {
    slug: 'kawasan-strategis', name: 'Kawasan Strategis', category: 'Tata Ruang', geomType: 'Polygon',
    // Kelas per nama SRS (garis tepi): rona dibedakan tegas agar tiap SRS terbaca; kawasan non-SRS
    // (Aerotropolis, Geopark, penyangga KSPN) bila diunggah memakai warna dasar sosial budaya Permen 14/2021.
    style: { color: KS_SOSBUD, classField: 'nama', classes: palette(SRS, ['#7B2FBE', '#0E7490', KS_EKONOMI, KS_SDA]), outline: true },
    fields: [text('nama', 'Nama Kawasan', true), select('jenis', 'Jenis Kawasan', STRATEGIS), num('luas_ha', 'Luas (ha)'), text('dasar_hukum', 'Dasar Hukum')],
    sumber: 'Sebaran 18 SRS DIY (KML), Pemda DIY',
  },
  {
    slug: 'destinasi-pariwisata', name: 'Destinasi Pariwisata', category: 'Pariwisata', geomType: 'Point',
    style: {
      color: '#DB2777', classField: 'kawasan', classes: palette(KAWASAN_WISATA, ['#E11D48', '#F59E0B', '#0891B2', '#16A34A', '#7C3AED']),
      labels: Object.fromEntries(KAWASAN_WISATA.map((k, i) => [k, `${k} ${TEMA_WISATA[i]}`])),
    },
    // Tema kawasan sudah tercakup di label kelas ("KSPD 2 Menoreh Selatan"): tidak disimpan sebagai atribut terpisah.
    fields: [text('nama', 'Nama Destinasi', true), select('kawasan', 'Kawasan Pariwisata', KAWASAN_WISATA)],
    sumber: 'RIPPARDA Kulon Progo 2026–2045 (Perda 10/2025), sebagian koordinat dikoreksi dengan OpenStreetMap',
  },
  {
    slug: 'pju', name: 'Penerangan Jalan Umum', category: 'Infrastruktur', geomType: 'Point',
    // SON-T (sodium) jingga seperti cahayanya, LED biru, lampu hilang merah agar menonjol.
    style: { color: '#EAB308', classField: 'jenis_lampu', classes: palette(JENIS_LAMPU, ['#0EA5E9', '#F59E0B', '#A855F7', '#DC2626', '#9CA3AF']) },
    fields: [
      text('nama', 'Nama Titik', true), text('lokasi', 'Lokasi'), select('jenis_lampu', 'Jenis Lampu', JENIS_LAMPU),
      num('daya_watt', 'Daya Lampu (W)'), text('tinggi_tiang', 'Tinggi Tiang'), num('daya_kwh_va', 'Daya KWH (VA)'),
      num('tahun_pasang', 'Tahun Pemasangan'), text('pengadaan', 'Pengadaan'), text('no_tiang', 'No. Tiang'), text('keterangan', 'Keterangan'),
    ],
    sumber: 'Dinas Perhubungan Kulon Progo (DISHUB_LPJU, Mei 2025)',
  },
  MISKIN_LAYER,
  // Alat gambar halaman Peta: penanda lokasi (titik/garis/area) yang digambar editor di atas peta, dilihat semua pengguna.
  ...(['Point', 'LineString', 'Polygon'] as const).map((geomType, i): LayerSeed => ({
    slug: ['catatan-titik', 'catatan-garis', 'catatan-area'][i]!, name: ['Penanda Titik', 'Penanda Garis', 'Penanda Area'][i]!,
    category: 'Penanda Lokasi', geomType, visible: true, style: { color: ['#4F46E5', '#C026D3', '#0D9488'][i]! },
    fields: [text('judul', 'Judul', true), text('catatan', 'Catatan')],
  })),
];

/** Buat layer dari seed bila belum ada; nama, kategori, simbologi, atribut, sumber, tahun & filter seed selalu disinkronkan. */
export const upsertLayer = async (sql: Sql, l: LayerSeed, sortOrder: number): Promise<void> => {
  const [source] = l.source ? await sql<{ id: number }[]>`SELECT id FROM layers WHERE slug = ${l.source}` : [];
  await sql`
    INSERT INTO layers (slug, name, category, year, geom_type, style, fields, sumber, source_layer_id, filter, visible_default, sort_order)
    VALUES (${l.slug}, ${l.name}, ${l.category}, ${l.year ?? null}, ${l.geomType}, ${sql.json(l.style)}::jsonb,
            ${sql.json(l.fields)}::jsonb, ${l.sumber ?? null}, ${source?.id ?? null}, ${l.filter ? sql.json(l.filter) : null}::jsonb,
            ${l.visible ?? false}, ${sortOrder})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, style = EXCLUDED.style,
      fields = EXCLUDED.fields, sumber = EXCLUDED.sumber, year = EXCLUDED.year, filter = EXCLUDED.filter`;
};

export const seed = async (sql: Sql, admin?: { email: string; password: string }): Promise<void> => {
  for (const [i, l] of LAYERS.entries()) await upsertLayer(sql, l, i);
  // Hanya bila belum ada superadmin: seed dijalankan ulang untuk sinkron simbologi tidak boleh menghidupkan lagi
  // akun bawaan (password dari .env) yang sudah dihapus sesuai checklist DEPLOY.
  if (admin) {
    await sql`
      INSERT INTO users (name, email, password_hash, role, status)
      SELECT 'Superadmin', ${admin.email}, ${await hash(admin.password)}, 'superadmin', 'active'
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin')
      ON CONFLICT DO NOTHING`;
  }
};

/**
 * `.env` sumber password akun SEED_ADMIN_EMAIL: hash DB disamakan dengan SEED_ADMIN_PASSWORD, tapi hanya bila berbeda.
 * Menulis ulang tiap start akan memajukan password_changed_at dan mencabut semua sesi "Ingat saya" di setiap restart.
 * Hasil: 'missing' (akun belum ada), 'same', atau 'updated' (sesi lama akun itu dicabut).
 */
export const syncAdminPassword = async (sql: Sql, admin: { email: string; password: string }): Promise<'missing' | 'same' | 'updated'> => {
  const [row] = await sql<{ id: number; passwordHash: string }[]>`SELECT id, password_hash FROM users WHERE lower(email) = lower(${admin.email})`;
  if (!row) return 'missing';
  if (await verify(row.passwordHash, admin.password)) return 'same';
  await sql`UPDATE users SET password_hash = ${await hash(admin.password)}, password_changed_at = now() WHERE id = ${row.id}`;
  return 'updated';
};
