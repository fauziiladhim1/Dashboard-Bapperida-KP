/**
 * Import data awal Bapperida dari folder sumber:
 *   npm run db:import -w apps/api -- "C:\KULIAH FZL\MAGANG\data"
 * Mode replace per layer/tabel: aman dijalankan ulang, tetapi fitur, edit manual, dan foto dokumentasi pada layer yang diimpor ikut terganti.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import shp from 'shpjs';
import { KECAMATAN_EXPR } from '../modules/features.js';
import { getLayer } from '../modules/layers.js';
import { insertFeatures, normalizeFeatures } from '../modules/upload.js';
import { createDb, type Sql } from './client.js';
import { miskinOutliers, parseKawasanCsv, parseKmlPolygons, parseLpju, parseMiskin, parseRuasCsv, parseRuasSk, ruasMeta } from './parse.js';
import { JALAN_SLUG, touchJalan } from '../modules/tabular.js';
import { LAYERS, MISKIN_SLUG, type LayerSeed } from './seed.js';
import { removeFiles, takeMedia } from '../lib/media.js';

type Props = Record<string, unknown>;
type ShpFeature = { type: 'Feature'; geometry: unknown; properties: Props | null };
type Source = { file: string; map: (p: Props) => Props | null };

const rbi = (file: string, map: Source['map']): Source => ({ file, map });
const jenis = (j: string) => (p: Props) => ({ jenis: j, nama: p.NAMOBJ || p.REMARK });

const SOURCES: Record<string, Source[]> = {
  'utilitas-umum': [
    rbi('KESEHATAN_PT_25K', jenis('Kesehatan')),
    rbi('RUMAHSAKIT_PT_25K', jenis('Kesehatan')),
    rbi('PENDIDIKAN_PT_25K', jenis('Pendidikan')),
    rbi('SARANAIBADAH_PT_25K', jenis('Peribadatan')),
    rbi('PEMERINTAHAN_PT_25K', jenis('Pemerintahan')),
    rbi('NIAGA_PT_25K', jenis('Perdagangan')),
    rbi('KANTORPOS_PT_25K', jenis('Pos')),
  ],
};

// Hanya <nama>.shp/.dbf/.prj/.cpg yang dibaca; .sr.lock, .shp.xml, .sbn/.sbx di folder yang sama diabaikan.
const readShp = async (dir: string, name: string): Promise<ShpFeature[]> => {
  const file = (ext: string) => path.join(dir, name + ext);
  const opt = (ext: string) => (existsSync(file(ext)) ? readFile(file(ext)) : undefined);
  const [shpBuf, dbf, prj, cpg] = await Promise.all([readFile(file('.shp')), readFile(file('.dbf')), opt('.prj'), opt('.cpg')]);
  return ((await shp({ shp: shpBuf, dbf, prj, cpg } as never)) as { features: ShpFeature[] }).features;
};

/** Berkas foto milik fitur yang diganti; dihapus dari disk hanya setelah transaksi import commit. */
const orphanFiles: string[] = [];

/** Ganti seluruh fitur layer + sinkronkan nama/kategori/style/fields/sumber dari seed. Foto dokumentasi fitur lama ikut terhapus. */
const resetLayer = async (tx: Sql, slug: string, seed: LayerSeed = LAYERS.find((l) => l.slug === slug)!) => {
  const layer = await getLayer(tx, slug);
  await tx`
    UPDATE layers SET name = ${seed.name}, category = ${seed.category}, style = ${tx.json(seed.style)}::jsonb,
      fields = ${tx.json(seed.fields)}::jsonb, sumber = ${seed.sumber ?? null} WHERE id = ${layer.id}`;
  const files = await takeMedia(tx, tx`f.layer_id = ${layer.id}`);
  if (files.length) console.warn(`  ${slug}: ${files.length / 2} foto dokumentasi ikut terhapus`);
  orphanFiles.push(...files);
  await tx`DELETE FROM features_all WHERE layer_id = ${layer.id}`;
  return layer;
};

const insert = async (tx: Sql, layer: Awaited<ReturnType<typeof getLayer>>, label: string, features: Parameters<typeof normalizeFeatures>[0]) => {
  const { valid, errors } = normalizeFeatures(features, layer.geomType);
  if (errors.length) console.warn(`  ${label}: ${errors.length} fitur dilewati (${errors[0]})`);
  await insertFeatures(tx, layer, valid, null);
  console.log(`  ${layer.slug} <- ${label}: ${valid.length}`);
};

/** SHP Audit 2024: batas kalurahan (BatasAdminKel; kalurahan di WADMKD, kecamatan di WADMKC). */
const importBatas = async (tx: Sql, auditDir: string) => {
  const layer = await resetLayer(tx, 'batas-administrasi');
  const features = (await readShp(auditDir, 'BatasAdminKel')).map((f) => ({
    ...f, properties: { kalurahan: f.properties?.WADMKD ?? f.properties?.NAMOBJ, kecamatan: f.properties?.WADMKC },
  }));
  await insert(tx, layer, 'BatasAdminKel', features);
  return layer.id;
};

const str = (v: unknown) => String(v ?? '').trim() || null;

/** SHP Audit 2024: tutupan lahan RBI (kelas di REMARK; kosong -> null). Kecamatan diisi di importLayers. */
const importTutupan = async (tx: Sql, auditDir: string) => {
  const layer = await resetLayer(tx, 'tutupan-lahan');
  // REMARK sumber salah ketik "Taxiwy": dibetulkan saat impor agar sama dengan kelas di seed.
  const fix = (k: string | null) => (k === 'Taxiwy' ? 'Taxiway' : k);
  const features = (await readShp(auditDir, 'TutupanLahan')).map((f) => ({ ...f, properties: { kelas: fix(str(f.properties?.REMARK)) } }));
  await insert(tx, layer, 'TutupanLahan', features);
  return layer.id;
};

/**
 * SHP Audit 2024: penggunaan lahan + kesesuaian pola ruang. Poligon sumber sudah di-dissolve se-kabupaten,
 * jadi dipotong per kalurahan agar filter kecamatan dan luas per wilayah benar.
 */
const importPL = async (tx: Sql, auditDir: string, batasId: number) => {
  const layer = await resetLayer(tx, 'penggunaan-lahan');
  const features = (await readShp(auditDir, 'Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan')).map((f) => {
    const p = f.properties ?? {};
    return { ...f, properties: { kelas: str(p.TutupLahan), sub_kelas: str(p.SubTutupan), keterangan: str(p.Keterangan), pola_ruang: str(p.NAMOBJ), kesesuaian: str(p.Kesesuaian) } };
  });
  await insert(tx, layer, 'Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan', features);
  const [last] = await tx<{ max: string }[]>`SELECT coalesce(max(id), 0) AS max FROM features WHERE layer_id = ${layer.id}`;
  const max = last!.max;
  await tx`
    INSERT INTO features (layer_id, properties, geom)
    SELECT f.layer_id, f.properties || jsonb_build_object('kecamatan', a.properties->>'kecamatan', 'kalurahan', a.properties->>'kalurahan'),
           ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(f.geom, a.geom)), 3))
    FROM features f JOIN features a ON a.layer_id = ${batasId} AND ST_Intersects(f.geom, a.geom)
    WHERE f.layer_id = ${layer.id} AND f.id <= ${max}`;
  await tx`DELETE FROM features WHERE layer_id = ${layer.id} AND (id <= ${max} OR ST_IsEmpty(geom) OR ST_Area(geom::geography) < 1)`;
  const [count] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM features WHERE layer_id = ${layer.id}`;
  console.log(`  penggunaan-lahan: dipotong per kalurahan -> ${count!.n} poligon`);
  return layer.id;
};

/**
 * Koreksi koordinat dari Bapperida (Nov 2026) untuk baris CSV yang jatuh di luar Kulon Progo, ditambah titik yang
 * dipindah penyunting di menu Data (agar impor ulang tidak mengembalikan lokasi lama).
 * ponytail: ditaruh di kode karena CSV sering disimpan ulang dari Excel; hapus entri bila CSV sudah benar.
 */
// Diperbarui 23 Nov 2026 dari posisi terakhir di database (23 titik yang dipindah penyunting lewat menu Data/peta).
const KOREKSI_TITIK: Record<string, [lat: number, lng: number]> = {
  'Agrowisata Kelengkeng Banjarharjo': [-7.68165, 110.250172],
  'Bukit Cubung': [-7.927914, 110.229735],
  'Bukit Proman': [-7.650705, 110.146685],
  'Desa Wisata Banjarharjo': [-7.682429, 110.249892],
  'Desa Wisata Hargomulyo': [-7.865481, 110.074356],
  'Desa Wisata Jatirejo': [-7.93012, 110.230918],
  'Desa Wisata Nglinggo': [-7.647669, 110.141877],
  'Embung Dlingseng': [-7.658272, 110.228854],
  'Embung Krapyak': [-7.670792, 110.262227],
  'Formasi Nanggulan Eosen Watu Puru': [-7.732626, 110.198508],
  'Glamping Menoreh': [-7.656493, 110.140129],
  'Grojogan Sewu': [-7.7654, 110.1189],
  'Gunung Kucir': [-7.703613, 110.166944],
  'Kawasan Kopi Jl. Raya Kaligesing': [-7.750205, 110.191363],
  'Kawasan Kopi Menoreh Utara': [-7.664383, 110.149331],
  'Kebun Teh Nglinggo': [-7.645952, 110.143673],
  'Paralayang Banjarasri': [-7.695784, 110.213368],
  'Pelabuhan Tanjung Adikarto': [-7.916494, 110.085773],
  'Puncak Gunung Jaran': [-7.645243, 110.142199],
  'Puncak Kleco': [-7.712546, 110.20451],
  'Rajendra Farm': [-7.6578, 110.158365],
  'River Tubing': [-7.787338, 110.214484],
  'Situs Petilasan Diponegoro': [-7.8012, 110.1541],
};
/** Baris CSV yang dihapus permanen penyunting (duplikat): dilewati saat impor ulang. */
const HAPUS_TITIK = new Set(['Kawasan Kopi Jl Raya Kaligesing']);

/** Titik kawasan dari CSV (koordinat bertitik ribuan) + kecamatan/kalurahan dari poligon batas. */
/**
 * Kecamatan/kalurahan titik dari poligon batas; titik di luar poligon darat (pesisir, atau koordinat sedikit melewati
 * batas kabupaten) memakai kalurahan terdekat.
 */
const assignWilayah = async (tx: Sql, layerId: number) => {
  const batas = (await getLayer(tx, 'batas-administrasi')).id;
  await tx`
    UPDATE features f SET properties = f.properties || jsonb_build_object('kecamatan', a.properties->>'kecamatan', 'kalurahan', a.properties->>'kalurahan')
    FROM features a WHERE a.layer_id = ${batas} AND f.layer_id = ${layerId} AND ST_Intersects(a.geom, f.geom)`;
  await tx`
    UPDATE features t SET properties = t.properties || coalesce((
      SELECT jsonb_build_object('kecamatan', a.properties->>'kecamatan', 'kalurahan', a.properties->>'kalurahan')
      FROM features a WHERE a.layer_id = ${batas} ORDER BY a.geom <-> t.geom LIMIT 1), '{}'::jsonb)
    WHERE t.layer_id = ${layerId} AND NOT t.properties ? 'kalurahan'`;
};

/** Titik destinasi RIPPARDA (CSV kawasan KPPD/KSPD) -> layer `destinasi-pariwisata`. */
const importTitikKawasan = async (tx: Sql, file: string) => {
  const layer = await resetLayer(tx, 'destinasi-pariwisata');
  const features = parseKawasanCsv(await readFile(file, 'utf8')).filter((r) => !HAPUS_TITIK.has(r.nama)).map((r) => {
    const [lat, lng] = KOREKSI_TITIK[r.nama] ?? [r.lat, r.lng];
    return {
      type: 'Feature' as const, geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { nama: r.nama, kawasan: r.kawasan },
    };
  });
  await insert(tx, layer, path.basename(file), features);
  await assignWilayah(tx, layer.id);
};

/** Ruas jalan kabupaten SK (`SK Jalan Kabupaten Kulon Progo/Draft_Final_rev3.shp`) -> layer `jalan-kabupaten`: geometri + nama ruas saja; kondisi dihitung dari tabel survei saat query (ruas_props). */
const skDir = (dataDir: string) => path.join(dataDir, 'SK Jalan Kabupaten Kulon Progo');
const importJalanSk = async (tx: Sql, dataDir: string) => {
  const layer = await resetLayer(tx, JALAN_SLUG);
  const features = (await readShp(skDir(dataDir), 'Draft_Final_rev3')).map((f) => ({ ...f, properties: parseRuasSk(f.properties ?? {}) }));
  await insert(tx, layer, 'Draft_Final_rev3', features);
  // Celah digitasi <= 15 m antarujung ruas disambung (lihat 013_jalan_snap.sql); panjang resmi tetap `panjang_km` SK.
  // ponytail: toleransi tetap 15 m; jadikan argumen bila surveyor butuh nilai lain.
  const [row] = await tx<{ n: number }[]>`SELECT snap_jalan(${layer.id}, 15) AS n`;
  console.log(`  ${JALAN_SLUG}: ${row?.n ?? 0} ujung ruas disambung (celah <= 15 m)`);
};

/**
 * Jalan nasional/provinsi (`Jalan Nasional/JalanArteriNasional.shp`, `Jalan Provinsi/JalanProvinsi.shp`, UTM 49S; shpjs
 * memproyeksikan ulang lewat .prj). `kapanewon` = kapanewon yang dilalui (terpanjang dulu), `kecamatan` = yang terpanjang.
 */
const STATUS_ROADS = { 'jalan-nasional': ['Jalan Nasional', 'JalanArteriNasional'], 'jalan-provinsi': ['Jalan Provinsi', 'JalanProvinsi'] } as const;
type StatusRoad = keyof typeof STATUS_ROADS;
const importJalanStatus = async (tx: Sql, dataDir: string, slug: StatusRoad) => {
  const [folder, file] = STATUS_ROADS[slug];
  const layer = await resetLayer(tx, slug);
  const features = (await readShp(path.join(dataDir, folder), file)).map((f) => {
    const p = f.properties ?? {};
    const len = Number(p.LENGTH);
    return { ...f, properties: {
      nama_ruas: String(p.Nama_Ruas || p.TOPONIM || folder), nomor_ruas: Number(p.Nomor_Ruas) ? String(p.Nomor_Ruas) : null,
      fungsi: p.TOPONIM || null, panjang_km: len > 0 ? Math.round(len * 1000) / 1000 : null,
    } };
  });
  await insert(tx, layer, file, features);
  const batas = (await getLayer(tx, 'batas-administrasi')).id;
  await tx`
    UPDATE features f SET properties = f.properties || jsonb_build_object('kapanewon', k.names, 'kecamatan', k.top)
    FROM (
      SELECT r.id, string_agg(x.kec, ', ' ORDER BY x.len DESC) AS names, (array_agg(x.kec ORDER BY x.len DESC))[1] AS top
      FROM features r CROSS JOIN LATERAL (
        SELECT a.properties->>'kecamatan' AS kec, sum(ST_Length(ST_Intersection(a.geom, r.geom)::geography)) AS len
        FROM features a WHERE a.layer_id = ${batas} AND ST_Intersects(a.geom, r.geom) GROUP BY 1
      ) x WHERE r.layer_id = ${layer.id} GROUP BY r.id
    ) k WHERE f.id = k.id`;
  // LENGTH kosong/0 di sebagian ruas: panjang dari geometri.
  await tx`
    UPDATE features SET properties = properties || jsonb_build_object('panjang_km', round((ST_Length(geom::geography) / 1000)::numeric, 3))
    WHERE layer_id = ${layer.id} AND (properties->>'panjang_km') IS NULL`;
};

/** Titik lampu PJU Dishub (`DATA DISHUB LPJU/DATA DISHUB LPJU/DISHUB_LPJU.shp`, WGS84) -> layer `pju`. */
const pjuDir = (dataDir: string) => path.join(dataDir, 'DATA DISHUB LPJU', 'DATA DISHUB LPJU');
const importPju = async (tx: Sql, dataDir: string) => {
  const layer = await resetLayer(tx, 'pju');
  const features = (await readShp(pjuDir(dataDir), 'DISHUB_LPJU')).map((f) => ({ ...f, properties: parseLpju(f.properties ?? {}) }));
  await insert(tx, layer, 'DISHUB_LPJU', features);
  await assignWilayah(tx, layer.id);
};

const titikFile = (dataDir: string) => {
  // ponytail: versi `_terkoreksi` (hasil scripts/geocode-titik.ts, koordinat OSM untuk titik berpola buatan) dipakai bila ada.
  const asli = path.join(dataDir, 'Layer_Titik_Kawasan_Strategis_Kulon_Progo.csv');
  const koreksi = asli.replace(/\.csv$/, '_terkoreksi.csv');
  return existsSync(koreksi) ? koreksi : existsSync(asli) ? asli : null;
};

/** SRS se-DIY dari KML, dipotong ke batas Kulon Progo; yang tidak beririsan dibuang, luas dihitung ulang. */
const importSrs = async (tx: Sql, file: string, batasId: number) => {
  const layer = await resetLayer(tx, 'kawasan-strategis');
  const features = parseKmlPolygons(await readFile(file, 'utf8'), 'SRS ').map((p) => ({
    type: 'Feature' as const, geometry: p.geometry, properties: { nama: p.name, jenis: 'SRS' },
  }));
  await insert(tx, layer, path.basename(file), features);
  await tx`
    UPDATE features f SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(f.geom, k.geom)), 3))
    FROM (SELECT ST_Union(geom) AS geom FROM features WHERE layer_id = ${batasId}) k
    WHERE f.layer_id = ${layer.id}`;
  // < 20 ha = potongan tepi akibat selisih batas (mis. SRS Pantai Samas–Parangtritis 5 ha), bukan bagian SRS di Kulon Progo.
  const dropped = await tx`DELETE FROM features WHERE layer_id = ${layer.id} AND (ST_IsEmpty(geom) OR ST_Area(geom::geography) < 2e5)`;
  await tx`
    UPDATE features SET properties = properties || jsonb_build_object('luas_ha', round((ST_Area(geom::geography) / 1e4)::numeric, 2))
    WHERE layer_id = ${layer.id}`;
  console.log(`  kawasan-strategis: ${dropped.count} SRS di luar Kulon Progo dibuang`);
};

const importLayers = async (tx: Sql, rbiDir: string, dataDir: string) => {
  const auditDir = path.join(dataDir, 'SHP Audit 2024', 'SHP Audit 2024');
  const ids: Record<string, number> = { 'batas-administrasi': await importBatas(tx, auditDir) };
  for (const [slug, sources] of Object.entries(SOURCES)) {
    const layer = await resetLayer(tx, slug);
    for (const { file, map } of sources) {
      const mapped = (await readShp(rbiDir, file)).flatMap((f) => {
        const properties = map(f.properties ?? {});
        return properties ? [{ ...f, properties }] : [];
      });
      await insert(tx, layer, file, mapped);
    }
    ids[slug] = layer.id;
  }
  const batas = ids['batas-administrasi']!;
  ids['penggunaan-lahan'] = await importPL(tx, auditDir, batas);
  ids['tutupan-lahan'] = await importTutupan(tx, auditDir);
  const titik = titikFile(dataDir);
  if (titik) await importTitikKawasan(tx, titik);
  const srs = path.join(dataDir, 'Sebaran 18 SRS DIY.kml');
  if (existsSync(srs)) await importSrs(tx, srs, batas);
  if (existsSync(path.join(pjuDir(dataDir), 'DISHUB_LPJU.shp'))) await importPju(tx, dataDir);
  if (existsSync(path.join(skDir(dataDir), 'Draft_Final_rev3.shp'))) await importJalanSk(tx, dataDir);
  for (const slug of Object.keys(STATUS_ROADS) as StatusRoad[]) {
    const [folder, file] = STATUS_ROADS[slug];
    if (existsSync(path.join(dataDir, folder, `${file}.shp`))) await importJalanStatus(tx, dataDir, slug);
  }

  // Kecamatan/kalurahan untuk utilitas & tutupan lahan diambil dari poligon batas; yang di luar Kulon Progo dibuang.
  // PL sudah berkecamatan dari pemotongan di importPL; titik kawasan di importTitikKawasan.
  const targets = [ids['utilitas-umum']!, ids['tutupan-lahan']!];
  await tx`
    UPDATE features f SET properties = f.properties || jsonb_build_object('kecamatan', a.properties->>'kecamatan', 'kalurahan', a.properties->>'kalurahan')
    FROM features a
    WHERE a.layer_id = ${batas} AND f.layer_id = ANY(${targets}) AND ST_Intersects(a.geom, ST_PointOnSurface(f.geom))`;
  const dropped = await tx`DELETE FROM features WHERE layer_id = ANY(${targets}) AND NOT properties ? 'kecamatan'`;
  console.log(`  ${dropped.count} fitur di luar Kulon Progo dibuang`);
};

const importRuas = async (tx: Sql, file: string) => {
  const meta = ruasMeta(path.basename(file));
  const rows = parseRuasCsv(await readFile(file, 'utf8'));
  await tx`DELETE FROM ruas_jalan WHERE wilayah = ${meta.wilayah} AND tahun = ${meta.tahun}`;
  for (const r of rows) {
    await tx`
      INSERT INTO ruas_jalan (kecamatan, wilayah, tahun, ruas, baik, sedang, rusak_ringan, rusak_berat, perbaikan)
      VALUES (${meta.kecamatan}, ${meta.wilayah}, ${meta.tahun}, ${r.ruas}, ${r.baik}, ${r.sedang}, ${r.rusakRingan}, ${r.rusakBerat}, ${r.perbaikan})`;
  }
  console.log(`  ruas_jalan <- ${meta.wilayah} ${meta.tahun}: ${rows.length}`);
};

/** xlsx penduduk miskin -> layer `penduduk-miskin` (semua tahun), fitur = poligon kalurahan + tahun + jumlah. */
const importMiskin = async (tx: Sql, file: string) => {
  const [sheet] = await readXlsxFile(file);
  const rows = parseMiskin(sheet!.data as unknown[][]);
  const layer = await resetLayer(tx, MISKIN_SLUG);
  // Kunci kecamatan + kalurahan: nama kalurahan bisa kembar di kapanewon lain.
  const done = await tx<{ key: string }[]>`
    INSERT INTO features (layer_id, properties, geom)
    SELECT ${layer.id}, jsonb_build_object('kecamatan', b.kecamatan, 'kalurahan', b.kalurahan, 'tahun', r.tahun, 'jumlah', r.jumlah), b.geom
    FROM jsonb_to_recordset(${tx.json(rows)}::jsonb) AS r(kecamatan text, kalurahan text, tahun int, jumlah int)
    JOIN (
      SELECT ${tx.unsafe(KECAMATAN_EXPR)} AS kecamatan, a.properties->>'kalurahan' AS kalurahan, ST_Multi(ST_Union(a.geom)) AS geom
      FROM features a JOIN layers l ON l.id = a.layer_id AND l.slug = 'batas-administrasi' GROUP BY 1, 2
    ) b ON lower(trim(b.kalurahan)) = lower(trim(r.kalurahan)) AND lower(trim(b.kecamatan)) = lower(trim(r.kecamatan))
    RETURNING lower(properties->>'kecamatan') || '/' || lower(properties->>'kalurahan') AS key`;
  console.log(`  ${MISKIN_SLUG}: ${done.length}/${rows.length} baris (kalurahan × tahun)`);
  const got = new Set(done.map((d) => d.key));
  const missing = [...new Set(rows.map((r) => `${r.kecamatan}/${r.kalurahan}`))].filter((k) => !got.has(k.toLowerCase()));
  if (missing.length) console.warn(`  ${missing.length} kalurahan tanpa poligon: ${missing.join(', ')}`);
  for (const w of miskinOutliers(rows)) console.warn(`  PERIKSA ${w}`);
};

const dir = process.argv[2];
if (!dir) throw new Error('Pakai: npm run db:import -- <folder data> [--only=titik|pju|jalan|jalan-nasional|jalan-provinsi]');
// --only=titik|pju|jalan: ganti layer destinasi-pariwisata, pju, atau jalan-kabupaten saja; layer & tabel lain tidak disentuh.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const files = await readdir(dir);
const pick = (re: RegExp) => files.filter((f) => re.test(f)).map((f) => path.join(dir, f));
const rbiDir = path.join(dir, 'KAB. KULONPROGO', 'KAB. KULONPROGO');

const sql = createDb(process.env.DATABASE_URL ?? '', 1);
try {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    if (only === 'titik') {
      const titik = titikFile(dir);
      if (!titik) throw new Error(`CSV titik kawasan tidak ada di ${dir}`);
      return importTitikKawasan(t, titik);
    }
    if (only === 'pju') return importPju(t, dir);
    if (only === 'jalan') return importJalanSk(t, dir);
    if (only === 'jalan-nasional' || only === 'jalan-provinsi') return importJalanStatus(t, dir, only);
    if (only) throw new Error(`--only=${only} tidak dikenal (pakai: titik, pju, jalan, jalan-nasional, jalan-provinsi)`);
    console.log('Layer RBI:');
    await importLayers(t, rbiDir, dir);
    console.log('Tabel:');
    for (const f of pick(/^Data Jalan.*\.csv$/i)) await importRuas(t, f);
    for (const f of pick(/miskin.*\.xlsx$/i)) await importMiskin(t, f);
    // Kondisi ruas dihitung saat query dari tabel survei; cukup segarkan cache tile layer ruas.
    await touchJalan(t);
  });
  await removeFiles(process.env.UPLOAD_DIR ?? 'uploads', orphanFiles);
  console.log('Import selesai');
} finally {
  await sql.end();
}
