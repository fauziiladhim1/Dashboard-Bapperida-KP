/**
 * Isi layer `potensi-bencana` dari raster bahaya InaRISK BNPB, dikonversi ke vektor: zona poligon per kelas
 * (Rendah/Sedang/Tinggi) per jenis bahaya, dipotong per kalurahan. Hasilnya fitur biasa (bisa diedit, diunggah ulang,
 * diekspor GeoJSON/SHP).
 *   npm run db:inarisk -w apps/api
 * Butuh layer batas-administrasi sudah terisi (db:import). Mode replace: seluruh fitur potensi-bencana diganti.
 * Semua raster diunduh dulu, baru ditulis dalam satu transaksi; gagal jaringan = database tidak berubah.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import { createDb, type Sql } from './client.js';
import { KECAMATAN_EXPR } from '../modules/features.js';
import { LAYERS, upsertLayer } from './seed.js';

const BASE = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
/** Label = opsi `jenis_bahaya` di seed (sama dengan HAZARDS web). */
const HAZARDS = [
  ['Banjir', 'layer_bahaya_banjir'], ['Tanah Longsor', 'layer_bahaya_tanah_longsor'], ['Gempa Bumi', 'layer_bahaya_gempabumi'],
  ['Tsunami', 'layer_bahaya_tsunami'], ['Gelombang Ekstrem & Abrasi', 'layer_bahaya_gelombang_ekstrim_dan_abrasi'],
  ['Kekeringan', 'layer_bahaya_kekeringan'], ['Cuaca Ekstrem', 'layer_bahaya_cuaca_ekstrim'], ['Likuefaksi', 'layer_bahaya_likuefaksi'],
  ['Multi-Bahaya', 'layer_bahaya_multi'],
] as const;
const SLUG = 'potensi-bencana';
/** Ukuran piksel unduhan (derajat, ~100 m = resolusi asli InaRISK). */
const RES = 0.0009;

/** Grid raster: `vals[baris][kolom]`, -1 = tanpa data; (ulx, uly) = pojok kiri atas, dx/dy = ukuran piksel (derajat). */
export type Grid = { vals: number[][]; w: number; h: number; ulx: number; uly: number; dx: number; dy: number };

/** Kelas indeks InaRISK (0–1): rendah < 1/3, sedang < 2/3, tinggi; sama dengan HAZARD_CLASSES web. */
export const kelasOf = (v: number) => (v < 1 / 3 ? 'Rendah' : v < 2 / 3 ? 'Sedang' : 'Tinggi');

/** Raster datar -> baris. NaN/negatif (nodata, mis. -9999) jadi -1; indeks > 1 dijepit ke 1. */
export const toRows = (arr: ArrayLike<number>, w: number, h: number): number[][] =>
  Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => {
    const v = arr[r * w + c]!;
    return Number.isNaN(v) || v < 0 ? -1 : Math.min(v, 1);
  }));

/**
 * Tulis zona satu jenis bahaya: piksel sekelas digabung (run horizontal dulu agar ST_Union ringan), lalu dipotong
 * per kalurahan batas-administrasi. Luas dari geografi. Mengembalikan jumlah fitur yang ditulis.
 */
export const writeZones = async (sql: Sql, layerId: number, jenis: string, g: Grid, tanggal: string): Promise<number> => {
  const runs: { k: string; r: number; c0: number; c1: number }[] = [];
  g.vals.forEach((row, r) => {
    let c0 = 0;
    for (let c = 1; c <= row.length; c++) {
      const k = row[c0]! < 0 ? null : kelasOf(row[c0]!);
      const next = c < row.length ? (row[c]! < 0 ? null : kelasOf(row[c]!)) : undefined;
      if (next === k) continue;
      if (k) runs.push({ k, r, c0, c1: c });
      c0 = c;
    }
  });
  if (!runs.length) return 0;
  const [res] = await sql<{ n: number }[]>`
    WITH cells AS (
      SELECT x.k AS kelas, ST_MakeEnvelope(${g.ulx} + x.c0 * ${g.dx}::float8, ${g.uly} - (x.r + 1) * ${g.dy}::float8,
                                          ${g.ulx} + x.c1 * ${g.dx}::float8, ${g.uly} - x.r * ${g.dy}::float8, 4326) AS g
      FROM jsonb_to_recordset(${sql.json(runs)}::jsonb) AS x(k text, r int, c0 int, c1 int)
    ), z AS (SELECT kelas, ST_Union(g) AS g FROM cells GROUP BY kelas),
    kal AS (
      SELECT ${sql.unsafe(KECAMATAN_EXPR)} AS kecamatan, a.properties->>'kalurahan' AS kalurahan, ST_Union(a.geom) AS g
      FROM features a JOIN layers l ON l.id = a.layer_id AND l.slug = 'batas-administrasi' GROUP BY 1, 2
    ), ins AS (
      INSERT INTO features (layer_id, properties, geom, tahun_data)
      SELECT ${layerId}, jsonb_build_object('jenis_bahaya', ${jenis}::text, 'kelas', z.kelas,
               'luas_ha', round((ST_Area(p.g::geography) / 1e4)::numeric, 1), 'kalurahan', kal.kalurahan, 'kecamatan', kal.kecamatan,
               'sumber', 'InaRISK BNPB', 'tanggal_ambil', ${tanggal}::text),
             ST_Multi(p.g), ${Number(tanggal.slice(0, 4))}
      FROM z JOIN kal ON ST_Intersects(z.g, kal.g)
      CROSS JOIN LATERAL (SELECT ST_CollectionExtract(ST_Intersection(z.g, kal.g), 3) AS g) p
      WHERE NOT ST_IsEmpty(p.g) AND ST_Area(p.g) > 0
      RETURNING 1
    ) SELECT count(*)::int AS n FROM ins`;
  return res!.n;
};

/** Unduh raster satu layanan (GeoTIFF float) se-kotak kabupaten; dicoba 3x. */
const download = async (service: string, [x0, y0, x1, y1]: number[]): Promise<Grid> => {
  const size = `${Math.ceil((x1! - x0!) / RES)},${Math.ceil((y1! - y0!) / RES)}`;
  const q = new URLSearchParams({
    bbox: [x0, y0, x1, y1].join(','), bboxSR: '4326', imageSR: '4326', size, format: 'tiff', pixelType: 'F32',
    interpolation: 'RSP_NearestNeighbor', f: 'image',
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/${service}/ImageServer/exportImage?${q}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const img = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
      const [w, h] = [img.getWidth(), img.getHeight()];
      const [ulx, uly] = img.getOrigin();
      const [dx, dy] = img.getResolution();
      const [band] = (await img.readRasters()) as unknown as ArrayLike<number>[];
      return { vals: toRows(band!, w, h), w, h, ulx: ulx!, uly: uly!, dx: dx!, dy: Math.abs(dy!) };
    } catch (e) {
      if (attempt >= 2) throw new Error(`${service}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
};

export const run = async (sql: Sql) => {
  const [{ b } = { b: null }] = await sql<{ b: number[] | null }[]>`
    SELECT CASE WHEN e IS NULL THEN NULL ELSE json_build_array(ST_XMin(e) - 0.005, ST_YMin(e) - 0.005, ST_XMax(e) + 0.005, ST_YMax(e) + 0.005) END AS b
    FROM (SELECT ST_Extent(a.geom) AS e FROM features a JOIN layers l ON l.id = a.layer_id AND l.slug = 'batas-administrasi') x`;
  if (!b) throw new Error('Layer batas-administrasi kosong; jalankan db:import dulu');

  // Berurutan (bukan paralel): gagal satu layanan langsung berhenti, BNPB tidak dibanjiri unduhan besar.
  const grids: [string, Grid][] = [];
  for (const [jenis, service] of HAZARDS) {
    grids.push([jenis, await download(service, b)]);
    console.log(`  ${jenis}: raster diunduh`);
  }

  const tanggal = new Date().toISOString().slice(0, 10);
  let total = 0;
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const seed = LAYERS.find((l) => l.slug === SLUG)!;
    await upsertLayer(t, seed, LAYERS.indexOf(seed));
    const [layer] = await t<{ id: number }[]>`SELECT id FROM layers WHERE slug = ${SLUG}`;
    await t`DELETE FROM features_all WHERE layer_id = ${layer!.id}`;
    for (const [jenis, grid] of grids) total += await writeZones(t, layer!.id, jenis, grid, tanggal);
  });
  console.log(`potensi-bencana: ${total} zona (${HAZARDS.length} jenis bahaya × kelas × kalurahan)`);
};

/** Umur maksimum salinan InaRISK di database sebelum diperbarui otomatis. */
export const MAX_AGE_DAYS = 30;

/**
 * Pembaruan otomatis (dipanggil server tiap hari): jalankan `refresh` hanya bila salinan tertua dari MAX_AGE_DAYS atau
 * layer masih kosong. Dilewati bila layer berisi fitur yang bukan hasil skrip ini (unggahan/editan manual) agar tidak
 * tertimpa; jalankan `db:inarisk` manual untuk sengaja menggantinya.
 */
export const autoUpdate = async (sql: Sql, now = new Date(), refresh: (sql: Sql) => Promise<void> = run, slug = SLUG) => {
  const [s] = await sql<{ last: string | null; manual: number }[]>`
    SELECT max(f.properties->>'tanggal_ambil') AS last,
           count(*) FILTER (WHERE f.properties->>'sumber' IS DISTINCT FROM 'InaRISK BNPB')::int AS manual
    FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = ${slug}`;
  if (s!.manual > 0) return 'manual' as const;
  if (s!.last && now.getTime() - Date.parse(s!.last) < MAX_AGE_DAYS * 864e5) return 'fresh' as const;
  await refresh(sql);
  return 'updated' as const;
};

// Dijalankan langsung (bukan diimpor tes): ambil data & tulis. Entry CLI, dikecualikan dari coverage seperti cli.ts/import.ts.
/* v8 ignore start */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sql = createDb(process.env.DATABASE_URL ?? '', 1);
  try {
    await run(sql);
  } finally {
    await sql.end();
  }
}
/* v8 ignore stop */
