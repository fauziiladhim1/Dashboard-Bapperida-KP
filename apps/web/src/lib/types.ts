export type Role = 'superadmin' | 'editor' | 'viewer';

export type User = { id: number; name: string; email: string; role: Role;
  /** Password dikelola SEED_ADMIN_PASSWORD di .env (hanya dari GET /auth/me): form ganti password dikunci. */
  passwordManaged?: boolean; status?: 'pending' | 'active' | 'rejected'; createdAt?: string };

/** `hidden`: field "dihapus" dari skema (data tetap); `popup: false`: tidak tampil di popup peta. Urutan array = urutan tampil. */
export type Field = { key: string; label: string; type: import('./field-types').FieldType; options?: string[]; required?: boolean; hidden?: boolean; popup?: boolean };

export type GeomType = 'Point' | 'LineString' | 'Polygon';

/** `outline`: poligon digambar sebagai garis tepi (simbologi kawasan strategis, Permen ATR/BPN 14/2021). `labels`: nama tampilan per kunci kelas. */
export type StyleSteps = { field: string; stops: { min: number; label: string; color: string }[] };
export type LayerStyle = { color: string; classField?: string; classes?: Record<string, string>; labels?: Record<string, string>; groups?: Record<string, string[]>; outline?: boolean; steps?: StyleSteps;
  /**
   * Urutan skala kelas ordinal (kondisi, kelas bahaya): legenda mengikuti urutan ini, bukan besaran. Array, bukan urutan
   * kunci `classes`: jsonb Postgres menyusun ulang kunci objek.
   */
  ordinal?: string[];
  /** Baris teks tambahan popup peta; `{field}` diisi atribut fitur. */
  popupLines?: string[] };

export type Layer = {
  id: number;
  slug: string;
  name: string;
  category: string;
  year: number | null;
  geomType: GeomType;
  style: LayerStyle;
  fields: Field[];
  sourceLayerId: number | null;
  filter: { field: string; values: string[] } | null;
  visibleDefault: boolean;
  sortOrder: number;
  updatedAt: string;
  featureCount: number;
  /** Asal data; null untuk layer tanpa keterangan sumber. */
  sumber?: string | null;
};

export type Props = Record<string, string | number | boolean | null>;

export type Feature = {
  id: string;
  properties: Props;
  geometry?: GeoJSON.Geometry;
  geometryType?: string;
  slug?: string;
  /** Hanya di detail fitur: luas poligon (ha) atau panjang garis (km). */
  areaHa?: number | null;
  lengthKm?: number | null;
  /** Tahun keadaan data (bukan tanggal input); otomatis tahun berjalan saat dibuat, bisa diubah. */
  tahunData: number;
  createdAt: string;
  updatedAt: string;
  /** Hanya di detail fitur: nama pengubah terakhir. */
  updatedByName?: string | null;
  /** Hanya di daftar fitur: jumlah foto dokumentasi. */
  mediaCount?: number;
};

export type MediaMeta = { caption: string | null; tanggal: string | null; urgensi: 'tinggi' | 'sedang' | 'rendah' | null };
export type MediaItem = { id: number; webp: string; avif: string; width: number; height: number } & MediaMeta;

export type Page<T> = { total: number; page: number; limit: number; data: T[] };
/** Fitur di tempat sampah (soft delete): `deletedBy` = nama penghapus (null bila akunnya sudah dihapus). */
export type TrashedFeature = { id: string; properties: Record<string, unknown>; deletedAt: string; deletedBy: string | null };

/** `value`: jumlah atribut angka bila diminta (`sum`), mis. panjang resmi SK. */
/** KPI kustom Ringkasan (dibuat editor tanpa kode); angka dihitung /stats/layers/:slug. */
export type KpiMeasure = 'count' | 'length_km' | 'area_ha' | 'sum' | 'avg' | 'min' | 'max';
export type CustomKpi = {
  id: number; label: string; layerSlug: string; measure: KpiMeasure; sumField: string | null; byField: string | null;
  whereField: string | null; whereEq: string | null; unit: string | null; warn: boolean;
  chart: 'auto' | 'number' | 'bar' | 'column' | 'line' | 'donut' | 'treemap' | 'table';
  /** Urutan kategori rincian (terbesar, terkecil, abjad) dan batas N kategori teratas (null = bawaan kartu). */
  sort: 'desc' | 'asc' | 'label'; topN: number | null; sortOrder: number;
  /** Grafik kedua (format kartu Penduduk Miskin): rincian lain, mis. per tahun, sebagai garis/batang. */
  by2Field: string | null; chart2: 'line' | 'bar';
};
export type CustomKpiInput = Omit<CustomKpi, 'id' | 'sortOrder'>;
/** Satu kartu di tata letak Ringkasan (GET/PUT /kpi/layout): kunci bawaan atau `kpi:<id>`, lebar dari 12 kolom. */
/** Warna chip ikon kartu: token tema atau warna bebas hex #RRGGBB. */
export type CardTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted' | `#${string}`;
/** Kartu Ringkasan: posisi/lebar/tersembunyi + tampilan dari "Edit ringkasan" (judul, catatan, ikon `g:<nama>` atau PNG data URL, warna ikon). */
export type LayoutCard = { key: string; span: 4 | 5 | 6 | 7 | 8 | 12; hidden: boolean; title?: string; note?: string; icon?: string; tone?: CardTone;
  /** Keterangan bawah kartu: teks pengganti (`foot`) atau disembunyikan (`footOff`). */
  foot?: string; footOff?: boolean;
  /** Template baris angka (seperti teks Tableau dengan field): `{nama}` diisi angka terkini dari data. */
  sub?: string; delta?: string; legend?: string; caption?: string;
  /** Penempatan isi kartu KPI: berdampingan, bertumpuk, grafik di atas; `auto`/kosong = ikut lebar kartu. */
  arrange?: 'auto' | 'side' | 'stack' | 'chartFirst' };

export type StatRow = { key: string | null; count: number; lengthKm: number; areaHa: number; value?: number | null };

export type RuasJalan = { kecamatan: string; wilayah: string; tahun: number; ruas: string; baik: number; sedang: number; rusakRingan: number; rusakBerat: number; perbaikan: number;
  /** GET /stats/ruas-jalan: nama ruas cocok dengan ruas SK (punya geometri di peta). */
  matched?: boolean };
/** Satu tahun pada deret waktu Ringkasan (GET /stats/timeseries). */
export type TimePoint = { tahun: number; miskin: number; jalanKm: number; jalanRusakKm: number; layers?: Record<string, number>;
  /** Jiwa miskin per kecamatan, atau per kalurahan bila filter kecamatan aktif. */
  miskinWilayah?: Record<string, number>;
  /** Titik PJU menurut tahun pemasangan: total, per jenis lampu, dan daya terpasang (watt). */
  pjuPasang?: number; pjuLampu?: Record<string, number>; pjuWatt?: number;
  /** Titik PJU tanpa tahun pasang (sama di tiap baris): tidak masuk deret. */
  pjuTanpaTahun?: number };

/** Hasil pencarian global (GET /search). */
/** Fitur hasil pencarian global; `matchKey`/`matchValue` = atribut pertama yang cocok dengan kueri. */
export type SearchHit = { id: string; slug: string; layer: string; color: string | null; label: string; kecamatan: string | null; matchKey: string; matchValue: string; lng: number; lat: number };
/** Wilayah hasil pencarian (dari batas administrasi); bbox [barat, selatan, timur, utara] untuk zoom peta. */
/** `id`: fitur batas kalurahan (null untuk kecamatan). */
export type RegionHit = { type: 'kecamatan' | 'kalurahan'; name: string; kecamatan: string | null; id: string | null; bbox: [number, number, number, number] };
export type SearchResult = { regions: RegionHit[]; features: SearchHit[] };

/** Fitur yang perlu tindak lanjut (lonceng header, `GET /alerts`): urgensi tinggi atau keputusan masih kosong/ditunda. */
export type AlertItem = { id: string; slug: string; layer: string; label: string; kondisi: string | null; urgensi: string | null;
  keputusan: string | null; catatan: string | null; updatedAt: string };


/** Keterpaparan zona bahaya kelas Tinggi per jenis bahaya (`GET /stats/exposure`). */
export type Exposure = { jenis: string; sekolah: number; faskes: number; wisata: number; jalanKm: number; permukimanHa: number };
