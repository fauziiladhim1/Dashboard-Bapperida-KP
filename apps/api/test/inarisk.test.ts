import { describe, expect, it } from 'vitest';
import { kelasOf, toRows, writeZones } from '../src/db/inarisk.js';
import { LAYERS, upsertLayer } from '../src/db/seed.js';
import { sql } from './helpers.js';

describe('zona bahaya InaRISK', () => {
  it('kelas indeks; piksel tanpa data jadi -1, indeks dijepit ke 1', () => {
    expect([kelasOf(0.1), kelasOf(0.5), kelasOf(0.9)]).toEqual(['Rendah', 'Sedang', 'Tinggi']);
    expect(toRows([0.2, Number.NaN, 1.4, -9999], 2, 2)).toEqual([[0.2, -1], [1, -1]]);
  });

  it('raster -> poligon per kelas, dipotong per kalurahan; nodata dilewati', async () => {
    const [b] = await sql<{ id: number }[]>`INSERT INTO layers (slug, name, category, geom_type) VALUES ('zona-test', 'Zona', 'Tes', 'Polygon') RETURNING id`;
    // Kalurahan uji di layer batas sungguhan (dibersihkan di akhir): kotak 110.0–110.003 × -7.003–-7.0.
    const [batas] = await sql<{ id: number }[]>`SELECT id FROM layers WHERE slug = 'batas-administrasi'`;
    const [kal] = await sql<{ id: number }[]>`
      INSERT INTO features (layer_id, properties, geom) VALUES (${batas!.id}, '{"kecamatan":"Uji","kalurahan":"Uji"}',
        ST_Multi(ST_MakeEnvelope(110.0, -7.003, 110.003, -7.0, 4326))) RETURNING id`;
    // 3×3 piksel 0,001° (~110 m): kolom = Rendah, Sedang, Tinggi; baris bawah tengah tanpa data.
    const grid = { vals: [[0.1, 0.5, 0.9], [0.1, 0.5, 0.9], [0.1, -1, 0.9]], w: 3, h: 3, ulx: 110.0, uly: -7.0, dx: 0.001, dy: 0.001 };
    expect(await writeZones(sql, b!.id, 'Banjir', grid, '2026-01-01')).toBe(3);
    const rows = await sql<{ kelas: string; luas: number; kalurahan: string }[]>`
      SELECT properties->>'kelas' AS kelas, (properties->>'luas_ha')::float AS luas, properties->>'kalurahan' AS kalurahan
      FROM features WHERE layer_id = ${b!.id} ORDER BY 1`;
    expect(rows.map((r) => r.kelas)).toEqual(['Rendah', 'Sedang', 'Tinggi']);
    expect(rows.every((r) => r.kalurahan === 'Uji')).toBe(true);
    // Sedang kehilangan satu piksel nodata: 2/3 luas kelas lain.
    const [rendah, sedang] = [rows[0]!.luas, rows[1]!.luas];
    expect(sedang / rendah).toBeCloseTo(2 / 3, 1);
    // Raster tanpa data sama sekali: tidak ada zona, tanpa query tulis.
    expect(await writeZones(sql, b!.id, 'Banjir', { ...grid, vals: [[-1, -1], [-1, -1]], w: 2, h: 2 }, '2026-01-01')).toBe(0);
    await sql`DELETE FROM features WHERE id = ${kal!.id}`;
    await sql`DELETE FROM layers WHERE id = ${b!.id}`;
  });

  it('upsertLayer: seed tanpa sumber disimpan sebagai NULL', async () => {
    const seed = { ...LAYERS[0]!, slug: 'seed-tanpa-sumber', sumber: undefined };
    await upsertLayer(sql, seed, 999);
    const [row] = await sql<{ sumber: string | null }[]>`SELECT sumber FROM layers WHERE slug = ${seed.slug}`;
    expect(row!.sumber).toBeNull();
    await sql`DELETE FROM layers WHERE slug = ${seed.slug}`;
  });
});
