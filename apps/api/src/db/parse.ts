/** Parser file sumber (CSV ruas jalan, sheet xlsx kemiskinan) untuk CLI import. */

export type Ruas = { ruas: string; baik: number; sedang: number; rusakRingan: number; rusakBerat: number; perbaikan: number };
export type Miskin = { kecamatan: string; kalurahan: string; tahun: number; jumlah: number };

/**
 * Satu baris CSV -> sel. Sel berkutip boleh berisi pemisah ("Jl. A, B") dan kutip ganda ("" -> ").
 * ponytail: baris baru di dalam sel tidak didukung; berkas sumber (ruas jalan, titik kawasan) satu baris per data.
 */
export const splitCsvLine = (line: string, sep = ','): string[] => {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted && c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) { cells.push(cell); cell = ''; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
};

const num = (v: string | undefined) => {
  const n = Number.parseFloat(v ?? ''); // "01.05" -> 1.05
  return Number.isFinite(n) ? n : 0;
};

/** CSV: Ruas Jalan,Baik,Sedang,Rusak Ringan,Rusak Berat,Perbaikan 2026 (km). */
export const parseRuasCsv = (text: string): Ruas[] =>
  text.split(/\r?\n/).slice(1).map((l) => splitCsvLine(l)).filter((c) => c[0]?.trim()).map(([ruas, ...v]) => ({
    ruas: ruas!.trim(), baik: num(v[0]), sedang: num(v[1]), rusakRingan: num(v[2]), rusakBerat: num(v[3]), perbaikan: num(v[4]),
  }));

/** "Data Jalan  - KALIBAWANG II 2025.csv" -> wilayah "Kalibawang II", kecamatan "Kalibawang", tahun 2025. */
export const ruasMeta = (file: string) => {
  const m = /-\s*(.+?)\s+(\d{4})\.csv$/i.exec(file);
  if (!m) throw new Error(`Nama file CSV tidak dikenali: ${file}`);
  const wilayah = m[1]!.split(/\s+/).map((w) => (/^[IVX]+$/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join(' ');
  return { wilayah, kecamatan: wilayah.split(' ')[0]!, tahun: Number(m[2]) };
};

/**
 * Sheet: [Kapanewon, Kalurahan, <tahun>...]; baris header berisi angka tahun.
 * Kapanewon hanya terisi di baris pertama tiap kelompok (sel merge), baris "Total" dilewati.
 */
export const parseMiskin = (rows: unknown[][]): Miskin[] => {
  const header = rows.find((r) => r.slice(2).some((c) => typeof c === 'number'));
  if (!header) throw new Error('Header tahun tidak ditemukan');
  const years = header.slice(2).map(Number);
  const out: Miskin[] = [];
  let kecamatan = '';
  for (const r of rows.slice(rows.indexOf(header) + 1)) {
    if (typeof r[0] === 'string' && r[0].trim()) kecamatan = r[0].trim();
    const kalurahan = typeof r[1] === 'string' ? r[1].trim() : '';
    if (!kalurahan || /^(total|jumlah)/i.test(kalurahan)) continue;
    years.forEach((tahun, i) => {
      const v = r[i + 2];
      if (typeof v === 'number') out.push({ kecamatan, kalurahan, tahun, jumlah: Math.round(v) });
    });
  }
  return out;
};

/**
 * Tahun yang totalnya < 1/4 atau > 4× tahun data berikutnya (ambang sama dengan `incomparableYears` di Ringkasan):
 * biasanya salah ketik (kurang/lebih satu digit) atau satuan lain (KK, bukan jiwa). Hanya peringatan, data tidak diubah.
 */
export const miskinOutliers = (rows: Miskin[]): string[] => {
  const total = new Map<number, number>();
  for (const r of rows) total.set(r.tahun, (total.get(r.tahun) ?? 0) + r.jumlah);
  const years = [...total.keys()].sort((a, b) => a - b);
  return years.slice(0, -1).flatMap((y, i) => {
    const [a, b] = [total.get(y)!, total.get(years[i + 1]!)!];
    return a && b && (a < b / 4 || a > b * 4) ? [`penduduk miskin ${y}: total ${a} vs ${years[i + 1]} ${b} (${(b / a).toFixed(1)}×), cek angka sumber`] : [];
  });
};

/**
 * Koordinat CSV bertitik ribuan: "-7.859.664" → -7.859664, "110.157.833" → 110.157833.
 * Digit dibuang titiknya lalu desimal disisipkan setelah `intDigits` digit; ini juga membetulkan
 * baris rusak seperti "11.013.136…" (lng Kulon Progo selalu 110.x, lat selalu -7.x).
 */
export const parseKoordinat = (v: string, intDigits: 1 | 3): number => {
  const s = v.trim();
  const digits = s.replace(/\D/g, '');
  const n = Number(`${digits.slice(0, intDigits)}.${digits.slice(intDigits)}`);
  return s.startsWith('-') ? -n : n;
};

export type TitikKawasan = { kawasan: string; tema: string; nama: string; lat: number; lng: number };

/** CSV `;`: Kawasan;Tema;Nama_Tempat;Latitude;Longitude. */
export const parseKawasanCsv = (text: string): TitikKawasan[] =>
  text.split(/\r?\n/).slice(1).map((l) => splitCsvLine(l, ';')).filter((c) => c[2]?.trim()).map(([kawasan, tema, nama, lat, lng]) => ({
    kawasan: kawasan!.trim(), tema: tema!.trim(), nama: nama!.trim(), lat: parseKoordinat(lat!, 1), lng: parseKoordinat(lng!, 3),
  }));

type Ring = number[][];

/** Placemark poligon dari KML (Google My Maps): nama + MultiPolygon. Placemark tanpa poligon dilewati. */
export const parseKmlPolygons = (kml: string, namePrefix = '') => {
  const ring = (s: string): Ring => s.trim().split(/\s+/).map((p) => p.split(',').slice(0, 2).map(Number));
  const coords = (s: string) => [...s.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].map((m) => ring(m[1]!));
  return [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].flatMap(([, body]) => {
    const name = /<name>([^<]*)<\/name>/.exec(body!)?.[1]?.trim() ?? '';
    if (!name.startsWith(namePrefix)) return [];
    const polygons = [...body!.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)].map(([, p]) => {
      const outer = coords(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/.exec(p!)?.[1] ?? '');
      const inner = [...p!.matchAll(/<innerBoundaryIs>([\s\S]*?)<\/innerBoundaryIs>/g)].flatMap((m) => coords(m[1]!));
      return [...outer, ...inner];
    }).filter((p) => p.length);
    return polygons.length ? [{ name, geometry: { type: 'MultiPolygon' as const, coordinates: polygons } }] : [];
  });
};


/** Teks atribut LPJU Dishub: kosong atau "-" berarti tidak tercatat. */
const lpjuText = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && s !== '-' ? s : null;
};
/** Angka pertama dalam teks ("250 watt" -> 250, "4400 VA" -> 4400); tanpa angka -> null. */
const lpjuNum = (v: unknown) => {
  const m = String(v ?? '').match(/\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
};
const LAMPU: Record<string, string> = { LED: 'LED', 'SON T': 'SON-T', SONT: 'SON-T', HPL: 'HPL', HILANG: 'Hilang' };

/**
 * Satu baris DBF `DISHUB_LPJU` -> atribut layer PJU. ID_PEL dibuang (angka DBF kehilangan presisi, "5.21e+11"),
 * NAMA_SESUA dibuang (penamaan rekening tidak konsisten). Awalan "JL" alamat jadi "Jl. ".
 */
export const parseLpju = (p: Record<string, unknown>) => {
  const tinggi = lpjuText(p.Tinggi_Tia);
  const lokasi = lpjuText(p.ALAMAT);
  return {
    nama: lpjuText(p.NAMA),
    lokasi: lokasi && lokasi.replace(/^JL\.?\s*/i, 'Jl. ').replace(/\s+/g, ' '),
    jenis_lampu: LAMPU[String(p.Jenis_Lamp ?? '').trim().toUpperCase()] ?? 'Tidak Tercatat',
    daya_watt: lpjuNum(p.Daya_Lampu),
    tinggi_tiang: tinggi && tinggi.replace(/\s*meter$/i, ' m').replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
    daya_kwh_va: lpjuNum(p.Daya_KWH),
    tahun_pasang: lpjuNum(p.Tahun_Peng),
    pengadaan: lpjuText(p.Pengadaan)?.toUpperCase() ?? null,
    no_tiang: lpjuText(p.NO_TIANG),
    keterangan: lpjuText(p.KET),
  };
};

/** Fungsi jalan baku SK (singkatan seragam: `JLing.P` -> `Jling.P`). */
export const FUNGSI_JALAN = [
  'Jalan Kolektor Primer (JKP4)', 'Jalan Lokal Primer (JLP)', 'Jalan Lingkungan Primer (Jling.P)',
  'Jalan Kolektor Sekunder (JKS)', 'Jalan Lokal Sekunder (JLS)', 'Jalan Lingkungan Sekunder (Jling.S)',
];

/**
 * Satu baris DBF SK Jalan Kabupaten -> atribut layer `jalan-kabupaten`. Kapanewon tanpa kode urut ("912 Samigaluh -  Kalibawang"
 * -> "Samigaluh - Kalibawang"); kecamatan = kapanewon pertama. Nomor ruas + sub ruas -> "109.2" (sub 0 -> "109").
 */
export const parseRuasSk = (p: Record<string, unknown>) => {
  const kapanewon = String(p.Kapanewon ?? '')
    .split('-').map((s) => s.replace(/^\s*\d+\s*/, '').trim().replace(/^Samiguluh$/i, 'Samigaluh')).filter(Boolean).join(' - ');
  const no = Number(p.Nomor_Ruas);
  const sub = Number(p.Sub_Ruas) || 0;
  return {
    nama_ruas: String(p.Nama_Ruas ?? '').replace(/�/g, '–').replace(/\s+/g, ' ').trim() || null,
    nomor_ruas: Number.isFinite(no) ? (sub ? `${no}.${sub}` : String(no)) : null,
    fungsi: String(p.Fungsi_Jln ?? '').trim().replace('(JLing.', '(Jling.') || null,
    kapanewon: kapanewon || null,
    kecamatan: kapanewon.split(' - ')[0] || null,
    panjang_km: Number.isFinite(Number(p.Panjang)) ? Math.round(Number(p.Panjang) * 1000) / 1000 : null,
  };
};
