import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { notFound } from '../lib/http.js';
import { idParam } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { audit } from './audit.js';
import { csvCell } from './features.js';

/** Data non-spasial yang tampil di dashboard (rekap ruas jalan): dikelola dari menu Data > Tabel. */
const km = z.number().min(0).max(1000);
const ruasSchema = z.object({
  kecamatan: z.string().trim().min(1).max(80), wilayah: z.string().trim().min(1).max(80), tahun: z.number().int().min(2000).max(2100),
  ruas: z.string().trim().min(1).max(160), baik: km, sedang: km, rusakRingan: km, rusakBerat: km, perbaikan: km,
});
const listQuery = z.object({ kecamatan: z.string().max(80).optional(), tahun: z.coerce.number().int().optional() });
const COLS = ['kecamatan', 'wilayah', 'tahun', 'ruas', 'baik', 'sedang', 'rusakRingan', 'rusakBerat', 'perbaikan'] as const;
const SNAKE: Record<string, string> = { rusakRingan: 'rusak_ringan', rusakBerat: 'rusak_berat' };

/** Slug layer ruas jalan SK yang diberi kondisi dari tabel survei `ruas_jalan`. */
export const JALAN_SLUG = 'jalan-kabupaten';

/**
 * Sumber fitur untuk query baca (stats, tiles, detail, ekspor). Ruas SK: kondisi + km dihitung saat query oleh fungsi SQL
 * `ruas_props` (migrasi 012) dari survei `ruas_jalan` terakhir <= `tahun`, dijoin lewat nama ruas. Atribut kondisi dari
 * SHP tidak pernah dipakai; SHP hanya geometri + nama_ruas. Layer lain: tabel `features` apa adanya.
 */
export const featuresSrc = (sql: Sql, layer: { slug: string }, tahun?: number) =>
  layer.slug === JALAN_SLUG
    ? sql`(SELECT id, layer_id, geom, length_m, area_m2, tahun_data, created_at, updated_at, ruas_props(properties, ${tahun ?? null}::int) AS properties FROM features)`
    : sql`features`;

/** Tabel survei berubah: naikkan updated_at layer ruas agar vector tile (cache ?v=updated_at) tidak basi. */
export const touchJalan = (sql: Sql) => sql`UPDATE layers SET updated_at = clock_timestamp() WHERE slug = ${JALAN_SLUG}`;

export const tabularRouter = (sql: Sql): Router => {
  const router = Router();
  const editor = requireRole(...EDITORS);
  const list = (kecamatan?: string, tahun?: number) => sql`
    SELECT id, kecamatan, wilayah, tahun, ruas, baik::float, sedang::float, rusak_ringan::float, rusak_berat::float, perbaikan::float
    FROM ruas_jalan WHERE ${kecamatan ? sql`lower(kecamatan) = lower(${kecamatan})` : sql`true`} AND ${tahun ? sql`tahun = ${tahun}` : sql`true`}
    ORDER BY tahun DESC, wilayah, ruas`;

  router.get('/ruas-jalan', async (req, res) => {
    const { kecamatan, tahun } = listQuery.parse(req.query);
    res.json(await list(kecamatan, tahun));
  });

  router.get('/ruas-jalan/export', async (req, res) => {
    const { kecamatan, tahun } = listQuery.parse(req.query);
    const rows = (await list(kecamatan, tahun)) as unknown as Record<string, unknown>[];
    const head = ['id', ...COLS.map((c) => SNAKE[c] ?? c)];
    res.attachment('ruas-jalan.csv').type('text/csv');
    // BOM agar Excel membaca UTF-8 dengan benar (sama dengan ekspor layer).
    res.send('﻿' + [head.join(','), ...rows.map((r) => ['id', ...COLS].map((c) => csvCell(r[c])).join(','))].join('\r\n'));
  });

  router.post('/ruas-jalan', editor, async (req, res) => {
    const b = ruasSchema.parse(req.body);
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO ruas_jalan (kecamatan, wilayah, tahun, ruas, baik, sedang, rusak_ringan, rusak_berat, perbaikan)
      VALUES (${b.kecamatan}, ${b.wilayah}, ${b.tahun}, ${b.ruas}, ${b.baik}, ${b.sedang}, ${b.rusakRingan}, ${b.rusakBerat}, ${b.perbaikan})
      RETURNING id`;
    await audit(sql, req, 'create', 'ruas_jalan', row!.id, b);
    await touchJalan(sql);
    res.status(201).json({ id: row!.id, ...b });
  });

  router.patch('/ruas-jalan/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const patch = ruasSchema.partial().parse(req.body);
    const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [SNAKE[k] ?? k, v]));
    if (!Object.keys(set).length) return void res.status(400).json({ error: 'Tidak ada perubahan' });
    const [row] = await sql`UPDATE ruas_jalan SET ${sql(set)} WHERE id = ${id} RETURNING id`;
    if (!row) throw notFound('Ruas jalan');
    await audit(sql, req, 'update', 'ruas_jalan', id, patch);
    await touchJalan(sql);
    res.json({ id });
  });

  router.delete('/ruas-jalan/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [row] = await sql`DELETE FROM ruas_jalan WHERE id = ${id} RETURNING ruas`;
    if (!row) throw notFound('Ruas jalan');
    await audit(sql, req, 'delete', 'ruas_jalan', id, row);
    await touchJalan(sql);
    res.status(204).end();
  });

  return router;
};
