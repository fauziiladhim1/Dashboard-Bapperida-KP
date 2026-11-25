import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client.js';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Menjalankan file .sql di migrations/ secara berurutan, masing-masing sekali. */
export const migrate = async (sql: Sql): Promise<string[]> => {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name));
  const pending = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
  for (const file of pending) {
    const body = await readFile(dir + file, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
  }
  return pending;
};
