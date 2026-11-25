import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { KECAMATAN_EXPR, kecamatanFilter } from './features.js';
import { getLayer, layerScope } from './layers.js';
import { MISKIN_SLUG } from '../db/seed.js';
import { featuresSrc, JALAN_SLUG } from './tabular.js';
import { getSetting } from './settings.js';

// where + eq: hitung hanya fitur dengan atribut `where` = `eq` (mis. by=jenis_bahaya&where=kelas&eq=Tinggi).
const year = z.coerce.number().int().min(2000).max(2100);
// tahun: kondisi ruas SK dari survei terakhir <= tahun (layer lain mengabaikannya).
// agg: fungsi agregat untuk atribut `sum` (bawaan sum); nilai dari enum, aman disisipkan sebagai nama fungsi SQL.
const statsQuery = z.object({ by: z.string().max(64).optional(), kecamatan: z.string().max(80).optional(), where: z.string().max(64).optional(), eq: z.string().max(120).optional(), sum: z.string().max(64).optional(), agg: z.enum(['sum', 'avg', 'min', 'max']).default('sum'), tahun: year.optional(),
  // nogroup=1: satu baris untuk semua fitur (tanpa kelompok kelas bawaan), mis. AVG keseluruhan yang persis.
  nogroup: z.literal('1').optional() });
const ruasQuery = statsQuery.extend({ dari: year.optional(), sampai: year.optional() });


type Row = { key: string | null; count: number; lengthKm: number; areaHa: number; value?: number | null };

/**
 * Statistik agregat per kelas atribut (default: classField layer).
 * Panjang (km) dan luas (ha) dihitung di geography sehingga akurat dalam meter.
 */
export const statsRouter = (sql: Sql): Router => {
  const router = Router();

  router.get('/kecamatan', async (_req, res) => {
    const rows = await sql<{ name: string }[]>`
      SELECT DISTINCT ${sql.unsafe(KECAMATAN_EXPR)} AS name FROM features a JOIN layers l ON l.id = a.layer_id
      WHERE l.slug = 'batas-administrasi' AND ${sql.unsafe(KECAMATAN_EXPR)} IS NOT NULL ORDER BY 1`;
    res.json(rows.map((r) => r.name));
  });

  router.get('/layers/:slug', async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    // sum: jumlahkan atribut angka (mis. panjang_km resmi SK) sebagai `value`, di samping ukuran geometri.
    const { by = layer.style.classField, kecamatan, where, eq, sum, agg, tahun, nogroup } = statsQuery.parse(req.query);
    const src = featuresSrc(sql, layer, tahun);
    const total = sum ? sql`round(${sql.unsafe(agg)}(nullif(f.properties->>${sum}, '')::numeric), 3)::float` : sql`NULL::float`;
    const key = by && !nogroup ? sql`f.properties->>${by}` : sql`NULL`;
    // Layer multi-tahun dalam satu layer (atribut `tahun`, mis. penduduk miskin): `tahun` = hanya data tahun itu.
    const timed = tahun !== undefined && layer.year === null && layer.fields.some((f) => f.key === 'tahun');
    const only = sql`${where && eq !== undefined ? sql`AND f.properties->>${where} = ${eq}` : sql``} ${timed ? sql`AND f.properties->>'tahun' = ${String(tahun)}` : sql``}`;
    if (!kecamatan) {
      res.json(await sql<Row[]>`
        SELECT ${key} AS key, count(*)::int AS count,
               round((sum(f.length_m) / 1000)::numeric, 2)::float AS length_km,
               round((sum(f.area_m2) / 10000)::numeric, 2)::float AS area_ha, ${total} AS value
        FROM ${src} f WHERE ${layerScope(sql, layer)} ${only}
        GROUP BY 1 ORDER BY count DESC`);
      return;
    }
    // Dengan filter kecamatan, panjang/luas dipotong tepat di batas kecamatan: poligon lintas batas tidak dihitung utuh,
    // dan tetangga yang hanya bersinggungan (ST_Touches) tidak ikut. ST_CoveredBy = jalur cepat tanpa ST_Intersection.
    const rows = await sql<Row[]>`
      WITH k AS (
        SELECT ST_Union(a.geom) AS geom FROM features a JOIN layers al ON al.id = a.layer_id
        WHERE al.slug = 'batas-administrasi' AND lower(${sql.unsafe(KECAMATAN_EXPR)}) = lower(${kecamatan})
      ), clipped AS (
        SELECT ${key} AS key, CASE WHEN ST_CoveredBy(f.geom, k.geom) THEN f.geom ELSE ST_Intersection(f.geom, k.geom) END AS g, f.properties AS p
        FROM ${src} f, k WHERE ${layerScope(sql, layer)} ${only} AND ST_Intersects(f.geom, k.geom) AND NOT ST_Touches(f.geom, k.geom)
      )
      SELECT key, count(*)::int AS count,
             round((sum(ST_Length(g::geography)) / 1000)::numeric, 2)::float AS length_km,
             round((sum(ST_Area(g::geography)) / 10000)::numeric, 2)::float AS area_ha,
             -- Atribut angka (mis. panjang_km SK) dijumlah utuh per fitur, sama dengan tanpa filter: tidak dipotong batas.
             ${sum ? sql`round(${sql.unsafe(agg)}(nullif(p->>${sum}, '')::numeric), 3)::float` : sql`NULL::float`} AS value
      FROM clipped GROUP BY 1 ORDER BY count DESC`;
    res.json(rows);
  });

  /** Rincian per kecamatan; panjang/luas dipotong (ST_Intersection) tepat di batas kecamatan. */
  router.get('/layers/:slug/kecamatan', async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    const { by = layer.style.classField } = statsQuery.parse(req.query);
    const key = by ? sql`f.properties->>${by}` : sql`NULL`;
    // Fitur yang sudah dipotong per kalurahan saat import (mis. pola ruang) membawa properti kecamatan:
    // cukup dikelompokkan, tanpa ST_Intersection (yang memakan puluhan detik pada ribuan poligon).
    const [{ cut } = { cut: false }] = await sql<{ cut: boolean }[]>`
      SELECT bool_and(f.properties ? 'kecamatan') AS cut FROM features f WHERE ${layerScope(sql, layer)}`;
    if (cut) {
      res.json(await sql<(Row & { kecamatan: string })[]>`
        SELECT f.properties->>'kecamatan' AS kecamatan, ${key} AS key, count(*)::int AS count,
               round((sum(f.length_m) / 1000)::numeric, 2)::float AS length_km,
               round((sum(f.area_m2) / 10000)::numeric, 2)::float AS area_ha
        FROM features f WHERE ${layerScope(sql, layer)}
        GROUP BY 1, 2 ORDER BY 1, 2`);
      return;
    }
    const rows = await sql<(Row & { kecamatan: string })[]>`
      WITH kec AS (
        SELECT ${sql.unsafe(KECAMATAN_EXPR)} AS kecamatan, ST_Union(a.geom) AS geom
        FROM features a JOIN layers al ON al.id = a.layer_id WHERE al.slug = 'batas-administrasi' GROUP BY 1
      )
      SELECT k.kecamatan, ${key} AS key, count(*)::int AS count,
             round((sum(ST_Length(ST_Intersection(f.geom, k.geom)::geography)) / 1000)::numeric, 2)::float AS length_km,
             round((sum(ST_Area(ST_Intersection(f.geom, k.geom)::geography)) / 10000)::numeric, 2)::float AS area_ha
      FROM features f JOIN kec k ON ST_Intersects(f.geom, k.geom)
      WHERE ${layerScope(sql, layer)}
      GROUP BY 1, 2 ORDER BY 1, 2`;
    res.json(rows);
  });

  /**
   * Rekap kondisi per ruas jalan (km), tabel non-spasial hasil import CSV. `matched` = nama ruas cocok dengan ruas SK
   * (kunci join yang sama dengan ruas_props); false = baris survei tanpa geometri, tidak tampil di peta.
   */
  router.get('/ruas-jalan', async (req, res) => {
    const { kecamatan, dari, sampai } = ruasQuery.parse(req.query);
    res.json(await sql`
      SELECT kecamatan, wilayah, tahun, ruas, baik::float, sedang::float, rusak_ringan::float, rusak_berat::float, perbaikan::float,
        EXISTS (SELECT 1 FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = ${JALAN_SLUG}
                WHERE r.ruas_k IN (ruas_key(f.properties->>'nama_ruas'), ruas_key_rev(f.properties->>'nama_ruas'))) AS matched
      FROM ruas_jalan r WHERE ${kecamatan ? sql`lower(kecamatan) = lower(${kecamatan})` : sql`true`}
        AND tahun >= ${dari ?? 0} AND tahun <= ${sampai ?? 9999}
      ORDER BY wilayah, ruas`);
  });

  /**
   * Deret waktu per tahun: penduduk miskin, panjang jalan & jalan rusak (km), dan jumlah fitur layer bertahun.
   * Tanpa parameter rentang: barisnya sedikit, klien memotong sesuai rentang dan mengambil min/max tahun dari sini.
   */
  router.get('/timeseries', async (req, res) => {
    const { kecamatan } = statsQuery.parse(req.query);
    // `raw`: ekspresi SQL (atribut JSON), bukan nama kolom.
    const kec = (col: string, raw = false) => (kecamatan ? sql`lower(${raw ? sql.unsafe(col) : sql(col)}) = lower(${kecamatan})` : sql`true`);
    res.json(await sql`
      WITH m AS (
        SELECT nullif(f.properties->>'tahun', '')::int AS tahun, sum(nullif(f.properties->>'jumlah', '')::numeric)::int AS miskin
        FROM layers l JOIN features f ON f.layer_id = l.id
        WHERE l.slug = ${MISKIN_SLUG} AND nullif(f.properties->>'tahun', '') IS NOT NULL AND ${kec("f.properties->>'kecamatan'", true)} GROUP BY 1
      ),
      -- Jiwa miskin per wilayah: per kecamatan (kabupaten), atau per kalurahan bila satu kecamatan dipilih.
      w AS (
        SELECT tahun, jsonb_object_agg(wilayah, n) AS miskin_wilayah FROM (
          SELECT nullif(f.properties->>'tahun', '')::int AS tahun, f.properties->>${kecamatan ? 'kalurahan' : 'kecamatan'} AS wilayah,
            sum(nullif(f.properties->>'jumlah', '')::numeric)::int AS n
          FROM layers l JOIN features f ON f.layer_id = l.id
          WHERE l.slug = ${MISKIN_SLUG} AND nullif(f.properties->>'tahun', '') IS NOT NULL
            AND f.properties->>${kecamatan ? 'kalurahan' : 'kecamatan'} <> '' AND ${kec("f.properties->>'kecamatan'", true)}
          GROUP BY 1, 2
        ) x GROUP BY 1
      ),
      -- Titik PJU menurut tahun pemasangan (atribut tahun_pasang; kosong dilewati): total, rincian per jenis lampu
      -- (jenis kosong = "Tidak Tercatat"), dan daya terpasang (daya_watt, hanya nilai angka).
      p AS (
        SELECT tahun, sum(n)::int AS pju_pasang, jsonb_object_agg(lampu, n) AS pju_lampu, sum(w)::int AS pju_watt FROM (
          SELECT (f.properties->>'tahun_pasang')::int AS tahun, coalesce(nullif(f.properties->>'jenis_lampu', ''), 'Tidak Tercatat') AS lampu,
            count(*)::int AS n, sum(CASE WHEN f.properties->>'daya_watt' ~ '^[0-9]+([.][0-9]+)?$' THEN (f.properties->>'daya_watt')::numeric END) AS w
          FROM layers l JOIN features f ON f.layer_id = l.id
          WHERE l.slug = 'pju' AND f.properties->>'tahun_pasang' ~ '^[0-9]{4}$' ${kecamatanFilter(sql, kecamatan)}
          GROUP BY 1, 2
        ) x GROUP BY 1
      ),
      j AS (
        SELECT tahun, sum(baik + sedang + rusak_ringan + rusak_berat)::float AS jalan_km, sum(rusak_ringan + rusak_berat)::float AS jalan_rusak_km
        FROM ruas_jalan WHERE ${kec('kecamatan')} GROUP BY 1
      ),
      -- Layer bertahun (mis. "PJU 2025", "PJU 2026"): jumlah fitur per seri (nama tanpa tahun), turunan & batas dikecualikan.
      ly AS (
        SELECT tahun, jsonb_object_agg(seri, n) AS layers FROM (
          SELECT l.year AS tahun, regexp_replace(l.name, '\s*\d{4}$', '') AS seri, count(f.id)::int AS n
          FROM layers l JOIN features f ON f.layer_id = l.id
          WHERE l.year IS NOT NULL AND l.source_layer_id IS NULL AND l.slug <> 'batas-administrasi'
            ${kecamatanFilter(sql, kecamatan)}
          GROUP BY 1, 2
        ) x GROUP BY 1
      )
      SELECT tahun, coalesce(miskin, 0) AS miskin, coalesce(jalan_km, 0) AS jalan_km, coalesce(jalan_rusak_km, 0) AS jalan_rusak_km,
             coalesce(layers, '{}'::jsonb) AS layers, coalesce(miskin_wilayah, '{}'::jsonb) AS miskin_wilayah,
             coalesce(pju_pasang, 0) AS pju_pasang, coalesce(pju_lampu, '{}'::jsonb) AS pju_lampu, coalesce(pju_watt, 0) AS pju_watt,
             -- Titik PJU tanpa tahun pasang: tidak masuk deret, disebut di catatan grafik agar total tetap lengkap.
             (SELECT count(*) FROM layers l JOIN features f ON f.layer_id = l.id
              WHERE l.slug = 'pju' AND coalesce(f.properties->>'tahun_pasang', '') !~ '^[0-9]{4}$' ${kecamatanFilter(sql, kecamatan)})::int AS pju_tanpa_tahun
      FROM m FULL JOIN w USING (tahun) FULL JOIN j USING (tahun) FULL JOIN ly USING (tahun) FULL JOIN p USING (tahun)
      WHERE tahun IS NOT NULL ORDER BY tahun`);
  });

  /** Deret waktu per kecamatan (kemiskinan & rekap ruas jalan) untuk membandingkan perubahan antarwilayah. */
  router.get('/timeseries/kecamatan', async (_req, res) => {
    res.json(await sql`
      WITH m AS (
        SELECT nullif(f.properties->>'tahun', '')::int AS tahun, f.properties->>'kecamatan' AS kecamatan, sum(nullif(f.properties->>'jumlah', '')::numeric)::int AS miskin
        FROM layers l JOIN features f ON f.layer_id = l.id
        WHERE l.slug = ${MISKIN_SLUG} AND nullif(f.properties->>'tahun', '') IS NOT NULL GROUP BY 1, 2
      ),
      j AS (
        SELECT tahun, kecamatan, sum(baik + sedang + rusak_ringan + rusak_berat)::float AS jalan_km, sum(rusak_ringan + rusak_berat)::float AS jalan_rusak_km
        FROM ruas_jalan GROUP BY 1, 2
      )
      SELECT tahun, kecamatan, coalesce(miskin, 0) AS miskin, coalesce(jalan_km, 0) AS jalan_km, coalesce(jalan_rusak_km, 0) AS jalan_rusak_km
      FROM m FULL JOIN j USING (tahun, kecamatan) ORDER BY tahun, kecamatan`);
  });

  /**
   * Keterpaparan zona bahaya kelas Tinggi per jenis bahaya: fasilitas pendidikan & kesehatan (titik utilitas umum),
   * destinasi wisata, panjang ruas jalan kabupaten (km) dan luas permukiman tutupan lahan (ha) di dalam zona.
   * Dijoin per poligon zona (indeks GiST), bukan ST_Union: zona Tinggi satu jenis bahaya tidak saling tumpang tindih,
   * jadi luas/panjang tidak terhitung ganda; titik dihitung DISTINCT. `kecamatan`: hanya objek di kecamatan itu.
   * ponytail: cache di memori per (kecamatan, versi layer); pindah ke materialized view bila data membesar.
   */
  const exposureCache = new Map<string, unknown>();
  router.get('/exposure', async (req, res) => {
    const { kecamatan } = statsQuery.parse(req.query);
    // Definisi zona & objek dari tabel pengaturan (key `keterpaparan`), bukan dari kode.
    const c = await getSetting(sql, 'keterpaparan');
    const slugs = [c.zona.layer, c.sekolah.layer, c.faskes.layer, c.wisata.layer, c.jalan.layer, c.permukiman.layer];
    const [ver] = await sql<{ v: string | null }[]>`
      SELECT greatest((SELECT max(updated_at) FROM layers WHERE slug = ANY(${slugs})),
                      (SELECT updated_at FROM pengaturan WHERE key = 'keterpaparan'))::text AS v`;
    const cacheKey = `${kecamatan ?? ''}|${ver?.v ?? ''}`;
    if (!exposureCache.has(cacheKey)) {
      // layer_id di syarat join (bukan JOIN layers): tanpa ini indeks geom menarik semua fitur yang bbox-nya bersinggungan
      // (ribuan poligon tutupan lahan) dan ST_Intersects dijalankan sebelum filter layer (±14 dtk -> ±4 dtk tanpa cache).
      const lid = (slug: string) => sql`(SELECT id FROM layers WHERE slug = ${slug})`;
      // Filter kecamatan: zona dipotong ke batas kecamatan SEKALI di `z`; objek yang bersinggungan dengan zona terpotong
      // otomatis di kecamatan itu, jadi tidak ada lagi uji ST_Intersects tiap objek ke poligon kecamatan
      // (Pengasih: 7 dtk tanpa cache sebelumnya). Panjang jalan / luas permukiman juga hanya bagian di dalam kecamatan.
      const zoneGeom = kecamatan ? sql`ST_CollectionExtract(ST_Intersection(f.geom, (SELECT geom FROM k)), 3)` : sql`f.geom`;
      const zoneInKec = kecamatan ? sql`AND ST_Intersects(f.geom, (SELECT geom FROM k))` : sql``;
      // Objek = layer + (opsional) satu nilai atribut, mis. utilitas umum dengan jenis "Pendidikan". `a` = alias tabel.
      const obj = (o: { layer: string; field?: string; nilai?: string }, a: 'u' | 'r' | 't') =>
        sql`${sql.unsafe(a)}.layer_id = ${lid(o.layer)} ${o.field && o.nilai ? sql`AND ${sql.unsafe(a)}.properties->>${o.field} = ${o.nilai}` : sql``}`;
      const rows = await sql`
        WITH k AS MATERIALIZED (
          SELECT ST_Union(a.geom) AS geom FROM features a JOIN layers al ON al.id = a.layer_id
          WHERE al.slug = 'batas-administrasi' AND lower(${sql.unsafe(KECAMATAN_EXPR)}) = lower(${kecamatan ?? ''})
        ), z AS MATERIALIZED (
          SELECT f.id, f.properties->>${c.zona.jenis} AS jenis, ${zoneGeom} AS geom FROM features f
          WHERE f.layer_id = ${lid(c.zona.layer)} AND f.properties->>${c.zona.field} = ${c.zona.nilai} ${zoneInKec}
        ), titik AS (
          SELECT z.jenis,
            count(DISTINCT u.id) FILTER (WHERE ${obj(c.sekolah, 'u')})::int AS sekolah,
            count(DISTINCT u.id) FILTER (WHERE ${obj(c.faskes, 'u')})::int AS faskes,
            count(DISTINCT u.id) FILTER (WHERE ${obj(c.wisata, 'u')})::int AS wisata
          FROM z JOIN features u ON u.layer_id IN (${lid(c.sekolah.layer)}, ${lid(c.faskes.layer)}, ${lid(c.wisata.layer)}) AND ST_Intersects(u.geom, z.geom)
          GROUP BY 1
        ), jalan AS (
          SELECT z.jenis, sum(ST_Length(ST_Intersection(r.geom, z.geom)::geography)) / 1000 AS km
          FROM z JOIN features r ON ${obj(c.jalan, 'r')} AND ST_Intersects(r.geom, z.geom)
          GROUP BY 1
        ), mukim AS (
          SELECT z.jenis, sum(ST_Area(ST_Intersection(t.geom, z.geom)::geography)) / 10000 AS ha
          FROM z JOIN features t ON ${obj(c.permukiman, 't')} AND ST_Intersects(t.geom, z.geom)
          GROUP BY 1
        )
        SELECT j.jenis, coalesce(sekolah, 0) AS sekolah, coalesce(faskes, 0) AS faskes, coalesce(wisata, 0) AS wisata,
          round(coalesce(km, 0)::numeric, 2)::float AS jalan_km, round(coalesce(ha, 0)::numeric, 1)::float AS permukiman_ha
        FROM (SELECT DISTINCT jenis FROM z) j LEFT JOIN titik USING (jenis) LEFT JOIN jalan USING (jenis) LEFT JOIN mukim USING (jenis)
        ORDER BY permukiman_ha DESC, jenis`;
      if (exposureCache.size > 50) exposureCache.clear();
      exposureCache.set(cacheKey, rows);
    }
    res.json(exposureCache.get(cacheKey));
  });

  /** Garis batas Kabupaten (gabungan kalurahan, disederhanakan ±50 m): masker raster InaRISK & uji titik klik di peta. */
  router.get('/batas-kabupaten', async (_req, res) => {
    const [row] = await sql<{ geometry: unknown }[]>`
      SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union(ST_MakeValid(a.geom)), 0.0005), 5)::json AS geometry
      FROM features a JOIN layers l ON l.id = a.layer_id AND l.slug = 'batas-administrasi'`;
    res.set('Cache-Control', 'public, max-age=86400').json(row!.geometry);
  });

  return router;
};
