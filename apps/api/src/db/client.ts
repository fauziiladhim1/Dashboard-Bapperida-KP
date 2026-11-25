import postgres from 'postgres';

export type Sql = postgres.Sql;

export const createDb = (url: string, max = 10): Sql =>
  postgres(url, {
    max,
    // Hanya nama kolom yang di-camelCase; kunci di dalam jsonb (atribut SHP) dibiarkan apa adanya.
    transform: { column: { from: postgres.toCamel } },
    onnotice: () => undefined,
  });
