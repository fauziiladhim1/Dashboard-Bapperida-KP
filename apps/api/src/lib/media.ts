import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Fragment } from 'postgres';
import type { Sql } from '../db/client.js';

/**
 * Hapus baris foto dokumentasi milik fitur yang cocok dengan `where` (alias tabel fitur: `f`) dan kembalikan nama berkasnya.
 * Wajib dipanggil SEBELUM fitur dihapus (ON DELETE CASCADE hanya menghapus baris `media`), di dalam transaksi yang sama.
 * Berkas di disk baru dihapus lewat `removeFiles` SETELAH commit: bila transaksi gagal, baris & berkas tetap utuh.
 * Membaca `features_all` (termasuk fitur di tempat sampah): hapus permanen & ganti layer ikut membersihkan foto fitur terhapus.
 */
export const takeMedia = async (sql: Sql, where: Fragment): Promise<string[]> => {
  const rows = await sql<{ webp: string; avif: string }[]>`
    DELETE FROM media WHERE feature_id IN (SELECT f.id FROM features_all f WHERE ${where}) RETURNING webp, avif`;
  return rows.flatMap((m) => [m.webp, m.avif]);
};

export const removeFiles = async (uploadDir: string, files: string[]): Promise<void> => {
  await Promise.all(files.map((f) => rm(path.join(uploadDir, f), { force: true })));
};
