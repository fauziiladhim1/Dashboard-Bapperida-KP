import { expect, it } from 'vitest';
import { sql } from './helpers.js';

// 0,0001 derajat bujur di lintang -7,85 ≈ 11 m.
const line = (coords: number[][]) => JSON.stringify({ type: 'LineString', coordinates: coords });

it('snap_jalan menyambung celah <= toleransi (tanpa menulis atribut), membiarkan celah besar, dan idempoten', async () => {
  const [layer] = await sql<{ id: number }[]>`
    INSERT INTO layers (slug, name, category, geom_type) VALUES ('snap-test', 'Snap', 'Tes', 'LineString') RETURNING id`;
  const add = async (coords: number[][]) => (await sql<{ id: number }[]>`
    INSERT INTO features (layer_id, geom) VALUES (${layer!.id}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${line(coords)}), 4326))) RETURNING id`)[0]!.id;
  const a = await add([[110.10, -7.85], [110.11, -7.85]]);
  await add([[110.1101, -7.851], [110.1101, -7.849]]); // ujung timur A ≈ 11 m dari B
  const far = await add([[110.13, -7.85], [110.14, -7.85]]); // ≥ 1 km dari ruas lain

  expect((await sql`SELECT snap_jalan(${layer!.id}, 15) AS n`)[0]!.n).toBe(1);
  const [ra, rf] = await sql<{ id: number; gap: number; disambung: boolean | null; celah: number | null }[]>`
    SELECT f.id, ST_Distance(ST_EndPoint(ST_GeometryN(f.geom, 1))::geography, o.geom::geography) AS gap,
      (f.properties->>'disambung')::boolean AS disambung, (f.properties->>'celah_m')::float AS celah
    FROM features f, features o WHERE f.id IN (${a}, ${far}) AND o.layer_id = f.layer_id AND o.id NOT IN (${a}, ${far}) ORDER BY f.id`;
  expect(ra).toMatchObject({ disambung: null, celah: null });
  expect(ra!.gap).toBeLessThan(0.01);
  expect(rf!.gap).toBeGreaterThan(1000);
  expect((await sql`SELECT snap_jalan(${layer!.id}, 15) AS n`)[0]!.n).toBe(0);
  await sql`DELETE FROM layers WHERE id = ${layer!.id}`;
});
