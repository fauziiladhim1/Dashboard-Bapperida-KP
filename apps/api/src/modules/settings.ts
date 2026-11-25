import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from './audit.js';

/** Pola regex: harus sah di JavaScript (web) dan PostgreSQL (`~*`), karena aturan yang sama dipakai di keduanya. */
const pola = z.string().min(1).max(300).refine((s) => { try { new RegExp(s, 'i'); return true; } catch { return false; } }, 'Pola regex tidak sah');
const level = z.enum(['tinggi', 'sedang', 'rendah']);
const sumber = z.object({ layer: z.string().min(1).max(80), field: z.string().max(64).optional(), nilai: z.string().max(200).optional() });

export const SETTINGS = {
  urgensi: z.object({
    abaikan: pola,
    aturan: z.array(z.object({ field: z.string().min(1).max(64), tinggi: pola, sedang: pola.nullable(), lainnya: level.nullable() })).min(1).max(20),
  }),
  keputusan: z.object({
    opsi: z.array(z.object({
      nilai: z.string().min(1).max(60), warna: z.enum(['success', 'warning', 'danger', 'default']),
      keterangan: z.object({ id: z.string().max(120), en: z.string().max(120) }),
    })).min(1).max(12),
    tuntas: z.array(z.string().max(60)),
    pelaksanaan: z.array(z.string().max(60)),
    /** Keputusan yang menandai pekerjaan terealisasi (mengisi tanggal_selesai); null = tidak dicatat. */
    selesai: z.string().max(60).nullable(),
  }),
  keterpaparan: z.object({
    zona: z.object({ layer: z.string().min(1), field: z.string().min(1), nilai: z.string().min(1), jenis: z.string().min(1), gabungan: z.string() }),
    sekolah: sumber, faskes: sumber, wisata: sumber, jalan: sumber, permukiman: sumber,
  }),
};
export type Settings = { [K in keyof typeof SETTINGS]: z.infer<(typeof SETTINGS)[K]> };

/** Satu pengaturan dari DB. Tidak ada nilai cadangan di kode: baris hilang = galat (migrasi 028 mengisinya). */
export const getSetting = async <K extends keyof Settings>(sql: Sql, key: K): Promise<Settings[K]> => {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM pengaturan WHERE key = ${key}`;
  if (!row) throw new HttpError(500, `Pengaturan "${key}" belum ada di database`);
  return row.value as Settings[K];
};

export const settingsRouter = (sql: Sql): Router => {
  const router = Router();

  router.get('/', async (_req, res) => {
    const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM pengaturan ORDER BY key`;
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });

  router.put('/:key', requireRole('superadmin'), async (req, res) => {
    const key = req.params.key as keyof Settings;
    const schema = SETTINGS[key];
    if (!schema) throw notFound('Pengaturan');
    const value = schema.parse(req.body);
    // Pola juga harus sah untuk regex PostgreSQL (dialek ARE berbeda dari JavaScript di beberapa sintaks).
    if (key === 'urgensi') {
      const u = value as Settings['urgensi'];
      for (const p of [u.abaikan, ...u.aturan.flatMap((a) => [a.tinggi, a.sedang ?? '.'])]) {
        await sql`SELECT '' ~* ${p}`.catch(() => { throw new HttpError(400, `Pola regex tidak sah di database: ${p}`); });
      }
    }
    const [row] = await sql`UPDATE pengaturan SET value = ${sql.json(value as never)}, updated_by = ${req.user!.id}, updated_at = now()
      WHERE key = ${key} RETURNING key`;
    if (!row) throw notFound('Pengaturan');
    await audit(sql, req, 'update', 'pengaturan', key, value);
    res.json(value);
  });

  return router;
};
