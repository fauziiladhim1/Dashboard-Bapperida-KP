import { existsSync } from 'node:fs';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seed, upsertLayer } from '../src/db/seed.js';

/** Database tes terpisah (nama DB + "_test") direset setiap kali tes dijalankan. */
export default async function setup(project: TestProject): Promise<void> {
  if (existsSync('../../.env')) process.loadEnvFile('../../.env');
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/(\w+)$/, '/$1_test');
  if (!url) throw new Error('Set TEST_DATABASE_URL atau DATABASE_URL');
  project.provide('dbUrl', url);
  const sql = createDb(url, 1);
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await sql`DROP TYPE IF EXISTS user_role, user_status CASCADE`;
  await migrate(sql);
  await seed(sql);
  // Fikstur layer turunan (saringan layer lain, hanya baca): seed produksi tidak lagi memuatnya (migrasi 020),
  // tetapi mekanisme source_layer_id tetap dipakai dan diuji lewat layer ini.
  await upsertLayer(sql, {
    slug: 'kawasan-pertanian', name: 'Kawasan Pertanian', category: 'Tata Ruang', geomType: 'Polygon',
    style: { color: '#65A30D', classField: 'kelas' }, fields: [], source: 'penggunaan-lahan', filter: { field: 'kelas', values: ['Sawah Irigasi'] },
  }, 99);
  await sql.end();
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
