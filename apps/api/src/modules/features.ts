import shpwrite from '@mapbox/shp-write';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { baseGeomType, geometrySchema, idParam, pageQuery, propertiesSchema, type Geometry } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { removeFiles, takeMedia } from '../lib/media.js';
import { audit } from './audit.js';
import { assertWritable, getLayer, layerScope, type Layer } from './layers.js';
import { getSetting, type Settings } from './settings.js';
import { featuresSrc, JALAN_SLUG } from './tabular.js';

type Props = z.infer<typeof propertiesSchema>;

const ADMIN_LAYER = 'batas-administrasi';
/** Nama kecamatan pada layer batas administrasi; mendukung atribut standar RBI (WADMKC). */
export const KECAMATAN_EXPR = `coalesce(a.properties->>'kecamatan', a.properties->>'WADMKC', a.properties->>'KECAMATAN')`;

/** Wilayah diturunkan otomatis hanya untuk layer titik yang tidak mengisi kecamatan/kalurahan lewat form (mis. Destinasi Pariwisata). */
const derivesWilayah = (layer: { geomType: string; fields: { key: string }[] }) =>
  layer.geomType === 'Point' && !layer.fields.some((f) => f.key === 'kecamatan' || f.key === 'kalurahan');

/**
 * Kecamatan & kalurahan fitur dari poligon `batas-administrasi` terdekat ke ST_PointOnSurface geometrinya
 * (fitur di luar poligon darat, mis. titik pesisir, memakai kalurahan terdekat). Dipanggil saat geometri dibuat/dipindah.
 */
export const fillWilayah = (sql: Sql, id: number | string) => sql`
  UPDATE features f SET properties = f.properties || coalesce((
    SELECT jsonb_build_object('kecamatan', ${sql.unsafe(KECAMATAN_EXPR)}, 'kalurahan', a.properties->>'kalurahan')
    FROM features a JOIN layers b ON b.id = a.layer_id AND b.slug = 'batas-administrasi'
    ORDER BY a.geom <-> ST_PointOnSurface(f.geom) LIMIT 1), '{}'::jsonb)
  WHERE f.id = ${id} AND f.layer_id <> (SELECT id FROM layers WHERE slug = 'batas-administrasi')`;

/**
 * Fitur (alias f) yang beririsan dengan poligon kecamatan tertentu.
 * Poligon kecamatan di-ST_Union sekali (subquery skalar tak terkait = InitPlan), lalu tiap fitur diuji ST_Intersects
 * terhadap satu geometri itu; jauh lebih murah daripada EXISTS yang mengulang filter nama + ST_Intersects per fitur per
 * kalurahan (tile tutupan-lahan: ~500 ms -> ~75 ms). Setara: f memotong union(A) iff memotong salah satu a di A;
 * nama tak cocok -> union NULL -> ST_Intersects NULL -> tak lolos, sama dengan EXISTS kosong.
 */
export const kecamatanFilter = (sql: Sql, kecamatan?: string) =>
  kecamatan
    ? sql`AND ST_Intersects(f.geom, (SELECT ST_Union(a.geom) FROM features a JOIN layers al ON al.id = a.layer_id
            WHERE al.slug = ${ADMIN_LAYER} AND lower(${sql.unsafe(KECAMATAN_EXPR)}) = lower(${kecamatan})))`
    : sql``;

const GEOM_CODE = { Point: 1, LineString: 2, Polygon: 3 } as const;

/** GeoJSON -> geometry valid, 2D, SRID 4326, dipaksa ke tipe layer (Multi*). */
export const geomFrom = (sql: Sql, geometry: Geometry, geomType: Layer['geomType']) =>
  sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326))), ${GEOM_CODE[geomType]}))`;

export const assertGeomType = (layer: Layer, geometry: Geometry): void => {
  if (baseGeomType(geometry.type) !== layer.geomType)
    throw new HttpError(400, `Geometri ${geometry.type} tidak sesuai layer (${layer.geomType})`);
};

/**
 * Tipe sesuai layer DAN tidak runtuh jadi kosong setelah dirapikan (ST_MakeValid): mis. area yang semua titiknya segaris
 * atau garis dua titik sama. Tanpa ini fitur tersimpan tanpa bentuk dan tak pernah tampil di peta.
 */
const assertDrawable = async (sql: Sql, layer: Layer, geometry: Geometry) => {
  assertGeomType(layer, geometry);
  const [r] = await sql<{ empty: boolean }[]>`SELECT ST_IsEmpty(${geomFrom(sql, geometry, layer.geomType)}) AS empty`;
  if (r!.empty) throw new HttpError(400, 'Geometri tidak sah: luas/panjangnya nol (titik segaris atau berimpit)');
};

/** Validasi atribut terhadap skema field layer. Atribut tambahan dari SHP tetap disimpan. */
export const validateProperties = (layer: Layer, props: Props, partial = false): Props => {
  const errors: string[] = [];
  for (const f of layer.fields) {
    const v = props[f.key];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required && !partial) errors.push(`${f.key} wajib diisi`);
      continue;
    }
    if (f.type === 'number' && typeof v !== 'number') errors.push(`${f.key} harus angka`);
    if (f.type === 'select' && f.options && !f.options.includes(String(v))) errors.push(`${f.key} harus salah satu: ${f.options.join(', ')}`);
  }
  if (errors.length) throw new HttpError(400, errors.join('; '));
  return props;
};

const listQuery = pageQuery.extend({
  q: z.string().max(100).optional(),
  kecamatan: z.string().max(80).optional(),
  // Kolom tabel menu Data: kolom tetap (id, updated_at, tahun_data) atau kunci atribut (properties) mana pun.
  sort: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/).default('id'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
const searchQuery = z.object({ q: z.string().trim().min(2).max(100), layer: z.string().max(64).optional() });
/** Pola ILIKE "mengandung"; %, _ dan \ dari input di-escape agar dicari apa adanya. */
const escLike = (q: string) => q.replace(/[\\%_]/g, '\\$&');
const likeAny = (q: string) => `%${escLike(q)}%`;
/** Tahun keadaan data (bukan tanggal input); kosong saat dibuat = tahun berjalan (default kolom). */
const tahunData = z.number().int().min(1900).max(2100);
const createSchema = z.object({ properties: propertiesSchema.default({}), geometry: geometrySchema, tahunData: tahunData.optional() });
// `updatedAt` = versi yang dibuka klien (opsional): bila fitur sudah diubah orang lain sejak itu, simpan ditolak 409.
const updateSchema = z.object({ properties: propertiesSchema, geometry: geometrySchema, tahunData, updatedAt: z.iso.datetime({ offset: true }) }).partial();
const bulkSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });
const exportQuery = z.object({ format: z.enum(['geojson', 'csv', 'shp']).default('geojson'), kecamatan: z.string().max(80).optional() });

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Cegah CSV/formula injection saat dibuka di Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

type CsvRow = { id: string; properties: Props; wkt: string };
const csvHeader = (keys: string[]) => ['id', ...keys, 'geometry_wkt'].map(csvCell).join(',');
const csvLine = (keys: string[], r: CsvRow) => [r.id, ...keys.map((k) => r.properties[k]), r.wkt].map(csvCell).join(',');

export const toCsv = (rows: CsvRow[]): string => {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.properties)))];
  return [csvHeader(keys), ...rows.map((r) => csvLine(keys, r))].join('\r\n');
};

/**
 * Nama kolom DBF maks. 10 karakter: dipotong, bentrok diberi akhiran angka (`luas_terda`, `luas_ter_1`). Nilai objek/array
 * jadi teks JSON, karena DBF hanya kenal teks/angka.
 */
export const dbfProps = (rows: Props[]): Props[] => {
  const map = new Map<string, string>();
  for (const k of new Set(rows.flatMap((r) => Object.keys(r)))) {
    let name = k.slice(0, 10);
    for (let i = 1; [...map.values()].includes(name); i++) name = `${k.slice(0, 10 - String(i).length - 1)}_${i}`;
    map.set(k, name);
  }
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [map.get(k)!, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
};

/** Tulis ke respons dengan menghormati backpressure (tunggu 'drain' bila buffer socket penuh). */
const write = (res: Response, chunk: string) =>
  res.write(chunk) ? Promise.resolve() : new Promise<void>((resolve) => res.once('drain', resolve));

/** Atribut ruas SK yang diturunkan dari tabel survei (ruas_props); tidak pernah disimpan ke fitur. */
const DERIVED = ['kondisi', 'baik_km', 'sedang_km', 'rusak_ringan_km', 'rusak_berat_km', 'tahun_survei'];
const ownProps = (slug: string, p: Props): Props => (slug === JALAN_SLUG ? Object.fromEntries(Object.entries(p).filter(([k]) => !DERIVED.includes(k))) : p);

/** `tahun`: kondisi ruas SK dari survei terakhir <= tahun (tanpa tahun = survei terbaru). */
const loadFeature = async (sql: Sql, id: number, tahun?: number) => {
  const [feature] = await sql<{ id: string; layerId: number; slug: string; properties: Props; geometry: Geometry; areaHa: number | null; lengthKm: number | null; tahunData: number; createdAt: Date; updatedAt: Date; updatedByName: string | null }[]>`
    SELECT f.id, f.layer_id, l.slug,
      CASE WHEN l.slug = ${JALAN_SLUG} THEN ruas_props(f.properties, ${tahun ?? null}::int) ELSE f.properties END AS properties,
      ST_AsGeoJSON(f.geom, 7)::json AS geometry,
      CASE WHEN GeometryType(f.geom) LIKE '%POLYGON' THEN ST_Area(f.geom::geography) / 1e4 END AS area_ha,
      CASE WHEN GeometryType(f.geom) LIKE '%LINESTRING' THEN ST_Length(f.geom::geography) / 1000 END AS length_km,
      f.tahun_data, f.created_at, f.updated_at, u.name AS updated_by_name
    FROM features f JOIN layers l ON l.id = f.layer_id LEFT JOIN users u ON u.id = f.updated_by WHERE f.id = ${id}`;
  if (!feature) throw notFound('Fitur');
  return feature;
};

const COLUMNS = ['id', 'updated_at', 'tahun_data'];
/**
 * Urutan tabel: kolom tetap apa adanya; atribut diurutkan angka bila berupa angka (2 < 10), selain itu teks.
 * Kosong selalu di akhir, lalu id sebagai pengurai seri agar halaman stabil.
 */
const orderBy = (sql: Sql, key: string, order: 'asc' | 'desc') => {
  const dir = order === 'asc' ? sql`ASC` : sql`DESC`;
  if (COLUMNS.includes(key)) return sql`${sql('f.' + key)} ${dir}, f.id`;
  const v = sql`nullif(f.properties->>${key}, '')`;
  return sql`CASE WHEN ${v} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (${v})::numeric END ${dir} NULLS LAST, ${v} ${dir} NULLS LAST, f.id`;
};

/**
 * CTE `u`: fitur yang bisa memicu tindak lanjut beserta urgensi efektifnya (`p` = properti, ruas SK dari survei terbaru)
 * dan `status` (nilai atribut yang menentukan urgensi). Aturan dari tabel `pengaturan` (key `urgensi`), sama dengan
 * `conditionUrgency` di web: aturan pertama yang field-nya ada di layer dan nilainya terisi yang dipakai.
 * Dipakai lonceng peringatan (`/alerts`).
 */
export const urgencyCte = (sql: Sql, rules: Settings['urgensi']) => {
  // Gabung fragmen SQL dengan pemisah (postgres.js tidak menggabungkan array fragmen sendiri).
  const join = <F,>(parts: F[], sep: F): F =>
    parts.reduce((acc, p, i) => (i ? (sql`${acc as never}${sep as never}${p as never}` as F) : p), sql`` as F);
  // Kolom h0, h1, ...: layer punya field aturan ke-i (nama kolom dari indeks angka, aman untuk sql.unsafe).
  const has = rules.aturan.map((r, i) => sql`fields @> ${sql.json([{ key: r.field }])} AS ${sql.unsafe(`h${i}`)}`);
  const v = (f: string) => sql`trim(p->>${f})`;
  const applies = (i: number, f: string) => sql`${sql.unsafe(`h${i}`)} AND coalesce(${v(f)}, '') <> ''`;
  const level = rules.aturan.map((r, i) => sql`WHEN ${applies(i, r.field)} THEN CASE
    WHEN ${v(r.field)} ~* ${rules.abaikan} THEN NULL
    WHEN ${v(r.field)} ~* ${r.tinggi} THEN 'tinggi'
    ${r.sedang ? sql`WHEN ${v(r.field)} ~* ${r.sedang} THEN 'sedang'` : sql``}
    ELSE ${r.lainnya}::text END`);
  const status = rules.aturan.map((r, i) => sql`WHEN ${applies(i, r.field)} THEN p->>${r.field}`);
  const anyField = rules.aturan.map((_r, i) => sql`l.${sql.unsafe(`h${i}`)} OR`);
  return sql`
      -- Flag layer dihitung sekali (MATERIALIZED): tanpa ini planner menguji jsonb @> pada layers per fitur (~240 ms).
      WITH l AS MATERIALIZED (
        SELECT id, slug, name, ${join(has, sql`, `)}
        FROM layers WHERE source_layer_id IS NULL AND slug <> ${ADMIN_LAYER}
      -- f MATERIALIZED: ruas_props dipanggil sekali per ruas; bila di-inline, tiap rujukan p di bawah memanggilnya ulang.
      ), f AS MATERIALIZED (
        SELECT f.id, l.slug, l.name AS layer, f.updated_at, ${sql.unsafe(rules.aturan.map((_r, i) => `l.h${i}`).join(', '))},
          -- Ruas SK: kondisi dari survei terbaru (ruas_props), sama dengan tabel Data & peta.
          CASE WHEN l.slug = ${JALAN_SLUG} THEN ruas_props(f.properties, NULL::int) ELSE f.properties END AS p
        FROM features f JOIN l ON l.id = f.layer_id
        -- Saring dini (sebelum ruas_props & regex): hanya layer yang punya field aturan, atau fitur yang punya
        -- urgensi/keputusan manual. Layer besar tanpa status (tutupan lahan, pola ruang) tidak ikut dihitung.
        WHERE ${join(anyField, sql` `)} f.properties ?| array['urgensi', 'keputusan', 'catatan_keputusan']
      ), u AS (
        SELECT *, coalesce(nullif(p->>'urgensi', ''), CASE ${join(level, sql` `)} END) AS urgensi, CASE ${join(status, sql` `)} END AS status
        FROM f
      )`;
};

export const featuresRouter = (sql: Sql, uploadDir: string): Router => {
  const router = Router();
  const editor = requireRole(...EDITORS);

  router.get('/layers/:slug/features', async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    const { page, limit, q, kecamatan, sort, order } = listQuery.parse(req.query);
    const rows = await sql`
      SELECT f.id, f.properties, GeometryType(f.geom) AS geometry_type, f.tahun_data, f.created_at, f.updated_at, count(*) OVER () AS total,
             (SELECT count(*) FROM media m WHERE m.feature_id = f.id)::int AS media_count
      -- Ruas SK: kondisi turunan survei ikut tampil & bisa disaring (featuresSrc), sama dengan peta dan Ringkasan.
      FROM ${featuresSrc(sql, layer)} f
      WHERE ${layerScope(sql, layer)} ${q ? sql`AND EXISTS (SELECT 1 FROM jsonb_each_text(f.properties) WHERE value ILIKE ${likeAny(q)})` : sql``} ${kecamatanFilter(sql, kecamatan)}
      ORDER BY ${orderBy(sql, sort, order)}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    res.json({ total: Number(rows[0]?.total ?? 0), page, limit, data: rows.map(({ total: _t, ...r }) => r) });
  });

  /**
   * Pencarian global (kotak cari topbar). `regions`: kecamatan & kalurahan dari batas administrasi beserta bbox untuk
   * zoom (hanya tanpa filter layer). `features`: fitur layer sumber (bukan turunan, bukan batas), atribut pertama yang
   * cocok (selain kecamatan/kalurahan, yang sudah dicakup `regions`) dikembalikan sebagai `matchKey`/`matchValue`, warna mengikuti kelas fitur agar sama dengan legenda peta.
   */
  router.get('/search', async (req, res) => {
    const { q, layer } = searchQuery.parse(req.query);
    const pattern = likeAny(q);
    const regions = layer ? [] : await sql`
      WITH a AS (
        SELECT a.id, ${sql.unsafe(KECAMATAN_EXPR)} AS kecamatan, a.properties->>'kalurahan' AS kalurahan, a.geom
        FROM features a JOIN layers l ON l.id = a.layer_id WHERE l.slug = ${ADMIN_LAYER}
      ), r AS (
        SELECT 'kecamatan' AS type, kecamatan AS name, NULL AS kecamatan, NULL::bigint AS id, ST_Extent(geom) AS e FROM a WHERE kecamatan ILIKE ${pattern} GROUP BY 2
        UNION ALL
        -- id: fitur batas kalurahan itu, agar hasil pencarian bisa dipilih (popup + sorotan) di peta.
        SELECT 'kalurahan', kalurahan, kecamatan, min(id), ST_Extent(geom) FROM a WHERE kalurahan ILIKE ${pattern} GROUP BY 2, 3
      )
      SELECT type, name, kecamatan, id::text, json_build_array(ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)) AS bbox
      FROM r ORDER BY type DESC, (name ILIKE ${escLike(q) + '%'}) DESC, name LIMIT 8`;
    const features = await sql`
      SELECT * FROM (
        -- Satu baris per (layer, label, nilai cocok, kecamatan): poligon yang dipotong per kalurahan tidak berulang.
        SELECT DISTINCT ON (l.slug, label, m.value, f.properties->>'kecamatan') f.id, l.slug, l.name AS layer,
          coalesce(l.style->'classes'->>(f.properties->>(l.style->>'classField')), l.style->>'color') AS color,
          -- Nama objek/kelas lebih dulu; kalurahan terakhir karena sudah tampil sebagai atribut cocok/kecamatan.
          coalesce(f.properties->>'nama', f.properties->>'nama_ruas', f.properties->>'name', f.properties->>'pola_ruang',
                   f.properties->>'kelas', f.properties->>'jenis', f.properties->>'kalurahan', '#' || f.id) AS label,
          f.properties->>'kecamatan' AS kecamatan, m.key AS match_key, m.value AS match_value,
          ST_X(ST_PointOnSurface(f.geom)) AS lng, ST_Y(ST_PointOnSurface(f.geom)) AS lat
        FROM features f JOIN layers l ON l.id = f.layer_id
        CROSS JOIN LATERAL (SELECT key, value FROM jsonb_each_text(f.properties) WHERE key NOT IN ('kecamatan', 'kalurahan') AND value ILIKE ${pattern} LIMIT 1) m
        WHERE l.slug <> ${ADMIN_LAYER} AND l.source_layer_id IS NULL ${layer ? sql`AND l.slug = ${layer}` : sql``}
        ORDER BY l.slug, label, m.value, f.properties->>'kecamatan', f.id
      ) x
      ORDER BY (label ILIKE ${escLike(q) + '%'}) DESC, (match_value ILIKE ${escLike(q) + '%'}) DESC, layer, label, id
      LIMIT 20`;
    res.json({ regions, features });
  });

  /** Sumber dana yang pernah dipakai di keputusan (saran isian form notulensi): diambil dari DB, bukan daftar di kode. */
  router.get('/decision-funds', async (_req, res) => {
    const rows = await sql<{ v: string }[]>`
      SELECT DISTINCT trim(properties->>'sumber_dana') AS v FROM features
      WHERE coalesce(trim(properties->>'sumber_dana'), '') <> '' ORDER BY 1 LIMIT 100`;
    res.json(rows.map((r) => r.v));
  });

  /**
   * Peringatan tindak lanjut (lonceng di header): fitur yang perlu keputusan. Perlu tindakan = keputusan belum termasuk
   * `tuntas` (pengaturan `keputusan`), DAN (urgensi efektif tinggi ATAU sudah ada keputusan/notulensi). Urgensi efektif =
   * `urgensi` manual, selain itu dari aturan pengaturan `urgensi`. Tanpa status baca per pengguna.
   * ponytail: dihitung saat diminta (tanpa tabel notifikasi); tambahkan indeks/materialisasi bila fitur > ~100 rb.
   */
  router.get('/alerts', async (_req, res) => {
    const [rules, keputusan] = await Promise.all([getSetting(sql, 'urgensi'), getSetting(sql, 'keputusan')]);
    const rows = await sql<{ id: string; slug: string; layer: string; label: string; kondisi: string | null; urgensi: string | null;
      keputusan: string | null; catatan: string | null; updatedAt: Date; total: string }[]>`
      ${urgencyCte(sql, rules)}
      SELECT id, slug, layer, updated_at,
        coalesce(p->>'nama', p->>'nama_ruas', p->>'name', p->>'kelas', p->>'jenis', p->>'kalurahan', '#' || id) AS label,
        -- Status yang memicu peringatan (mis. kondisi "Rusak Berat", jenis lampu "Hilang").
        status AS kondisi, urgensi, p->>'keputusan' AS keputusan, nullif(p->>'catatan_keputusan', '') AS catatan,
        count(*) OVER () AS total
      FROM u
      WHERE coalesce(p->>'keputusan', '') <> ALL(${keputusan.tuntas}::text[])
        AND (urgensi = 'tinggi' OR coalesce(p->>'keputusan', '') <> '' OR coalesce(p->>'catatan_keputusan', '') <> '')
      ORDER BY (urgensi = 'tinggi') DESC NULLS LAST, updated_at DESC, id
      LIMIT 20`;
    res.json({ count: Number(rows[0]?.total ?? 0), items: rows.map(({ total: _t, ...r }) => r) });
  });

  router.get('/layers/:slug/export', async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    const { format, kecamatan } = exportQuery.parse(req.query);
    const where = sql`${layerScope(sql, layer)} ${kecamatanFilter(sql, kecamatan)}`;
    // Ekspor ruas SK: kondisi survei terbaru (sama dengan peta tanpa filter tahun).
    const src = featuresSrc(sql, layer);
    // Atribut + tahun data & tanggal diperbarui (kolom fitur), di semua format ekspor.
    const props = sql`(f.properties || jsonb_build_object('tahun_data', f.tahun_data, 'diperbarui', to_char(f.updated_at, 'YYYY-MM-DD')))`;
    if (format === 'shp') {
      // ponytail: SHP dirakit di memori (zip shp/shx/dbf/prj); cukup untuk layer ribuan fitur, alirkan bila jutaan.
      const rows = await sql<{ properties: Props; geometry: Geometry }[]>`
        SELECT ${props} AS properties,
          -- shp-write hanya mengenal Point (bukan MultiPoint): titik satu bagian dibuka dulu, tanpa ini zip titik kosong.
          -- ponytail: MultiPoint >1 bagian tetap terlewat; belum ada di data (semua titik 1 bagian), pecah per bagian bila muncul.
          ST_AsGeoJSON(CASE WHEN GeometryType(f.geom) = 'MULTIPOINT' AND ST_NumGeometries(f.geom) = 1 THEN ST_GeometryN(f.geom, 1) ELSE f.geom END, 7)::json AS geometry
        FROM ${src} f WHERE ${where} ORDER BY f.id`;
      const fixed = dbfProps(rows.map((r) => r.properties));
      const zip = await shpwrite.zip<'nodebuffer'>(
        { type: 'FeatureCollection', features: rows.map((r, i) => ({ type: 'Feature', properties: fixed[i]!, geometry: r.geometry })) } as never,
        { outputType: 'nodebuffer', compression: 'DEFLATE', types: { point: layer.slug, polygon: layer.slug, polyline: layer.slug, multipolygon: layer.slug, multipolyline: layer.slug } as never },
      );
      res.attachment(`${layer.slug}.zip`).type('application/zip').send(zip);
      return;
    }
    // Dialirkan per 500 fitur (cursor): layer ribuan poligon tidak dirakit jadi satu string di memori Node.
    // Galat setelah header terkirim tak bisa jadi JSON lagi: koneksi diputus agar unduhan gagal, bukan terpotong diam-diam.
    res.attachment(`${layer.slug}.${format}`);
    try {
      if (format === 'csv') {
        // Urutan kolom = urutan kemunculan pertama (sama dengan toCsv).
        const keys = (await sql<{ key: string }[]>`
          SELECT key FROM (
            SELECT DISTINCT ON (k.key) k.key, f.id, k.ord FROM ${src} f, jsonb_object_keys(f.properties) WITH ORDINALITY k(key, ord)
            WHERE ${where} ORDER BY k.key, f.id, k.ord
          ) x ORDER BY id, ord`).map((r) => r.key).filter((k) => k !== 'tahun_data' && k !== 'diperbarui').concat('tahun_data', 'diperbarui');
        res.type('text/csv');
        await write(res, '﻿' + csvHeader(keys));
        await sql<CsvRow[]>`SELECT f.id, ${props} AS properties, ST_AsText(f.geom) AS wkt FROM ${src} f WHERE ${where} ORDER BY f.id`
          .cursor(500, (rows) => write(res, rows.map((r) => '\r\n' + csvLine(keys, r)).join('')));
      } else {
        res.type('application/geo+json');
        await write(res, '{"type":"FeatureCollection","features":[');
        let sep = '';
        await sql<{ f: string }[]>`
          SELECT json_build_object('type', 'Feature', 'id', f.id, 'properties', ${props}, 'geometry', ST_AsGeoJSON(f.geom, 7)::json)::text AS f
          FROM ${src} f WHERE ${where} ORDER BY f.id`
          .cursor(500, async (rows) => {
            await write(res, sep + rows.map((r) => r.f).join(','));
            sep = ',';
          });
        await write(res, ']}');
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) throw err;
      res.destroy(err as Error);
    }
  });

  router.get('/features/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { tahun } = z.object({ tahun: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const feature = await loadFeature(sql, id, tahun);
    // Dokumentasi: paling urgen dulu, lalu tanggal survei terbaru.
    const media = await sql`
      SELECT id, webp, avif, width, height, caption, tanggal::text AS tanggal, urgensi FROM media WHERE feature_id = ${id}
      ORDER BY array_position(ARRAY['tinggi','sedang','rendah'], urgensi) NULLS LAST, tanggal DESC NULLS LAST, id`;
    res.json({ type: 'Feature', ...feature, media });
  });

  router.post('/layers/:slug/features', editor, async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    assertWritable(layer);
    const { properties: raw, geometry, tahunData: tahun } = createSchema.parse(req.body);
    const properties = ownProps(layer.slug, raw);
    validateProperties(layer, properties);
    await assertDrawable(sql, layer, geometry);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO features (layer_id, properties, geom, created_by, updated_by, tahun_data)
      VALUES (${layer.id}, ${sql.json(properties)}::jsonb, ${geomFrom(sql, geometry, layer.geomType)}, ${req.user!.id}, ${req.user!.id},
              coalesce(${tahun ?? null}::int, extract(year FROM now())::int))
      RETURNING id`;
    if (derivesWilayah(layer)) await fillWilayah(sql, row!.id);
    await audit(sql, req, 'create', 'feature', row!.id, { layer: layer.slug });
    res.status(201).json(await loadFeature(sql, Number(row!.id)));
  });

  router.patch('/features/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const current = await loadFeature(sql, id);
    const layer = await getLayer(sql, current.slug);
    const properties = body.properties ? validateProperties(layer, ownProps(layer.slug, { ...current.properties, ...body.properties })) : undefined;
    if (body.geometry) await assertDrawable(sql, layer, body.geometry);
    const { count } = await sql`
      UPDATE features SET
        properties = coalesce(${properties ? sql.json(properties) : null}::jsonb, properties),
        geom = ${body.geometry ? geomFrom(sql, body.geometry, layer.geomType) : sql`geom`},
        tahun_data = coalesce(${body.tahunData ?? null}::int, tahun_data),
        updated_by = ${req.user!.id}, updated_at = now()
      WHERE id = ${id} ${body.updatedAt ? sql`AND date_trunc('milliseconds', updated_at) = ${body.updatedAt}::timestamptz` : sql``}`;
    if (!count) throw new HttpError(409, 'Fitur sudah diubah pengguna lain sejak dibuka; muat ulang lalu ulangi perubahan');
    if (body.geometry && derivesWilayah(layer)) await fillWilayah(sql, id);
    await audit(sql, req, 'update', 'feature', id, { before: current.properties, after: properties, geometry: Boolean(body.geometry), tahunData: body.tahunData });
    res.json(await loadFeature(sql, id));
  });

  // Hapus = soft delete: fitur pindah ke tempat sampah (deleted_at), foto tetap di disk, bisa dipulihkan dari tab Terhapus.
  // UPDATE features_all memicu trigger touch_layer, jadi versi tile naik dan peta/KPI langsung tidak menampilkannya.
  router.delete('/features/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [row] = await sql`
      UPDATE features_all SET deleted_at = now(), deleted_by = ${req.user!.id}
      WHERE id = ${id} AND deleted_at IS NULL RETURNING properties`;
    if (!row) throw notFound('Fitur');
    await audit(sql, req, 'delete', 'feature', id, row.properties);
    res.status(204).end();
  });

  router.post('/layers/:slug/features/bulk-delete', editor, async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    assertWritable(layer);
    const { ids } = bulkSchema.parse(req.body);
    const { count } = await sql`
      UPDATE features_all SET deleted_at = now(), deleted_by = ${req.user!.id}
      WHERE layer_id = ${layer.id} AND id = ANY(${ids}::bigint[]) AND deleted_at IS NULL`;
    await audit(sql, req, 'bulk-delete', 'feature', null, { layer: layer.slug, ids });
    res.json({ deleted: count });
  });

  /** Tempat sampah satu layer: fitur terhapus terbaru dulu, beserta siapa yang menghapus. */
  router.get('/layers/:slug/features/trash', editor, async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    const { page, limit, q, kecamatan, sort, order } = pageQuery.extend({
      q: z.string().trim().max(100).optional(), kecamatan: z.string().max(80).optional(),
      // Urutan header tabel Terhapus: waktu/penghapus = kolom khusus tempat sampah, selain itu sama dengan tab Aktif (id/atribut).
      sort: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/).default('deleted_at'), order: z.enum(['asc', 'desc']).default('desc'),
    }).parse(req.query);
    const dir = order === 'asc' ? sql`ASC` : sql`DESC`;
    const rows = await sql`
      SELECT f.id, f.properties, f.deleted_at, u.name AS deleted_by, count(*) OVER () AS total
      FROM features_all f LEFT JOIN users u ON u.id = f.deleted_by
      WHERE f.layer_id = ${layer.id} AND f.deleted_at IS NOT NULL
        -- Cari: ID, nilai atribut mana pun, atau nama penghapus (sama dengan pencarian tab Aktif).
        ${q ? sql`AND (f.id::text = ${q} OR u.name ILIKE ${likeAny(q)} OR EXISTS (SELECT 1 FROM jsonb_each_text(f.properties) WHERE value ILIKE ${likeAny(q)}))` : sql``}
        ${kecamatanFilter(sql, kecamatan)}
      ORDER BY ${sort === 'deleted_at' ? sql`f.deleted_at ${dir}, f.id ${dir}` : sort === 'deleted_by' ? sql`u.name ${dir} NULLS LAST, f.id` : orderBy(sql, sort, order)}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    res.json({ total: Number(rows[0]?.total ?? 0), page, limit, data: rows.map(({ total: _t, ...r }) => r) });
  });

  // Pulihkan banyak sekaligus (pilihan baris tab Terhapus), pasangan bulk-delete.
  router.post('/layers/:slug/features/bulk-restore', editor, async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    const { ids } = bulkSchema.parse(req.body);
    const { count } = await sql`
      UPDATE features_all SET deleted_at = NULL, deleted_by = NULL
      WHERE layer_id = ${layer.id} AND id = ANY(${ids}::bigint[]) AND deleted_at IS NOT NULL`;
    await audit(sql, req, 'bulk-restore', 'feature', null, { layer: layer.slug, ids });
    res.json({ restored: count });
  });

  router.post('/features/:id/restore', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [row] = await sql`
      UPDATE features_all SET deleted_at = NULL, deleted_by = NULL WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
    if (!row) throw notFound('Fitur terhapus');
    await audit(sql, req, 'restore', 'feature', id);
    res.json(await loadFeature(sql, id));
  });

  // Hapus permanen hanya dari tempat sampah dan hanya superadmin; foto ikut dihapus dari disk setelah commit.
  router.delete('/features/:id/purge', requireRole('superadmin'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [files, row] = await sql.begin(async (tx) => {
      const taken = await takeMedia(tx as unknown as Sql, tx`f.id = ${id} AND f.deleted_at IS NOT NULL`);
      const [deleted] = await tx`DELETE FROM features_all WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING properties`;
      return [taken, deleted] as const;
    });
    if (!row) throw notFound('Fitur terhapus');
    await removeFiles(uploadDir, files);
    await audit(sql, req, 'purge', 'feature', id, row.properties);
    res.status(204).end();
  });

  return router;
};
