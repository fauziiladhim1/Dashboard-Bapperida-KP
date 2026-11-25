import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { LAYERS, seed, upsertLayer } from '../src/db/seed.js';
import { API, env, loginAs, sql } from './helpers.js';

const newLayer = {
  slug: 'data-pendukung-sekolah',
  name: 'Sekolah',
  category: 'Data Pendukung',
  geomType: 'Point',
  style: { color: '#123456' },
  fields: [{ key: 'nama', label: 'Nama', type: 'text', required: true }],
};

describe('db', () => {
  it('migrasi berjalan di database kosong', async () => {
    await sql`DROP DATABASE IF EXISTS sipwil_migrate_test`;
    await sql`CREATE DATABASE sipwil_migrate_test`;
    const fresh = createDb(env.DATABASE_URL.replace(/\/\w+$/, '/sipwil_migrate_test'), 1);
    expect(await migrate(fresh)).toEqual(['001_init.sql', '002_tabular.sql', '003_media_meta.sql', '004_password_changed.sql', '005_feature_measures.sql', '006_kemiskinan_layer.sql', '007_kemiskinan_satu_layer.sql', '008_titik_tanpa_status.sql', '009_sumber_pariwisata.sql', '010_hapus_kawasan_pariwisata.sql', '011_jalan_kabupaten.sql', '012_ruas_kondisi.sql', '013_jalan_snap.sql', '014_hapus_rbi_status_tanah.sql', '015_tahun_data.sql', '016_zona_bahaya.sql', '017_taxiway.sql', '018_sync_tahun.sql', '019_kpi.sql', '020_bersih_data.sql', '021_kpi_chart.sql', '022_hapus_nip.sql', '023_ringkasan_layout.sql', '024_kpi_agregasi.sql', '025_soft_delete.sql', '026_tampilan_awal_dan_huruf.sql', '027_analyze_statistik.sql', '028_pengaturan.sql', '029_pengaturan_selesai.sql']);
    await fresh.end();
    await sql`DROP DATABASE sipwil_migrate_test`;
  });

  it('migrasi idempoten dan seed admin', async () => {
    expect(await migrate(sql)).toEqual([]);
    await seed(sql);
    await seed(sql, { email: 'seed@test.id', password: 'Kunci-Rahasia-2026' });
    await seed(sql, { email: 'seed@test.id', password: 'Kunci-Rahasia-2026' });
    const [u] = await sql`SELECT role, status FROM users WHERE email = 'seed@test.id'`;
    expect(u).toMatchObject({ role: 'superadmin', status: 'active' });
  });
});

describe('seed layer turunan', () => {
  it('warna dasar (simbol panel peta) unik antarlayer', () => {
    const colors = LAYERS.map((l) => l.style.color.toUpperCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('upsertLayer menautkan layer sumber dan menyimpan saringannya', async () => {
    await upsertLayer(sql, { slug: 'tes-turunan', name: 'Tes Turunan', category: 'Tes', geomType: 'Polygon', style: { color: '#000000' }, fields: [],
      source: 'penggunaan-lahan', filter: { field: 'kelas', values: ['Sawah Irigasi'] } }, 999);
    const [l] = await sql<{ src: string; filter: unknown }[]>`
      SELECT s.slug AS src, l.filter FROM layers l JOIN layers s ON s.id = l.source_layer_id WHERE l.slug = 'tes-turunan'`;
    expect(l).toEqual({ src: 'penggunaan-lahan', filter: { field: 'kelas', values: ['Sawah Irigasi'] } });
    await sql`DELETE FROM layers WHERE slug = 'tes-turunan'`;
  });
});

describe('layers', () => {
  it('daftar layer berurutan dengan jumlah fitur, termasuk layer turunan', async () => {
    const { agent } = await loginAs('viewer');
    const res = await agent.get(`${API}/layers`).expect(200);
    expect(res.body[0].slug).toBe('batas-administrasi');
    const pertanian = res.body.find((l: { slug: string }) => l.slug === 'kawasan-pertanian');
    expect(pertanian).toMatchObject({ featureCount: expect.any(Number), filter: { field: 'kelas' } });
    expect(pertanian.sourceLayerId).toBeTypeOf('number');
    await agent.get(`${API}/layers/pju`).expect(200);
    await agent.get(`${API}/layers/tidak-ada`).expect(404);
  });

  it('viewer tidak boleh membuat layer', async () => {
    const { agent } = await loginAs('viewer');
    await agent.post(`${API}/layers`).send(newLayer).expect(403);
  });

  it('editor membuat & mengubah layer, superadmin menghapus', async () => {
    const { agent } = await loginAs('editor');
    const created = await agent.post(`${API}/layers`).send(newLayer).expect(201);
    expect(created.body).toMatchObject({ slug: newLayer.slug, year: null, visibleDefault: false, sortOrder: 100 });
    await agent.post(`${API}/layers`).send(newLayer).expect(409);
    await agent.post(`${API}/layers`).send({ ...newLayer, slug: 'Bad Slug' }).expect(400);

    const id = created.body.id;
    const patched = await agent.patch(`${API}/layers/${id}`).send({ name: 'Sekolah Dasar', year: 2026, style: { color: '#654321' }, fields: [], visibleDefault: true, sortOrder: 5 }).expect(200);
    expect(patched.body).toMatchObject({ name: 'Sekolah Dasar', year: 2026, style: { color: '#654321' }, fields: [], visibleDefault: true, sortOrder: 5 });
    const cleared = await agent.patch(`${API}/layers/${id}`).send({ year: null }).expect(200);
    expect(cleared.body).toMatchObject({ year: null, name: 'Sekolah Dasar' });
    expect((await agent.patch(`${API}/layers/${id}`).send({ category: 'Pendidikan' }).expect(200)).body).toMatchObject({ category: 'Pendidikan', sortOrder: 5 });
    await agent.patch(`${API}/layers/999999`).send({ name: 'X' + 'y'.repeat(3) }).expect(404);

    await agent.delete(`${API}/layers/${id}`).expect(403);
    const admin = await loginAs('superadmin');
    await admin.agent.delete(`${API}/layers/${id}`).expect(204);
    await admin.agent.delete(`${API}/layers/${id}`).expect(404);
  });

  it('log audit tercatat dan dapat dibaca editor', async () => {
    const { agent } = await loginAs('editor');
    const res = await agent.get(`${API}/audit?limit=5`).expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('action');
    expect(res.body.data[0]).not.toHaveProperty('total');
    const viewer = await loginAs('viewer');
    await viewer.agent.get(`${API}/audit`).expect(403);
  });

  it('audit kosong mengembalikan total 0', async () => {
    const { agent } = await loginAs('editor');
    const res = await agent.get(`${API}/audit?page=99999`).expect(200);
    expect(res.body).toMatchObject({ total: 0, data: [] });
  });

  it('audit difilter rentang tanggal (inklusif)', async () => {
    const { agent } = await loginAs('editor');
    // Tanggal hari ini menurut WIB, sama dengan filter API (bukan UTC: 00.00-07.00 WIB masih tanggal kemarin di UTC).
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const hit = await agent.get(`${API}/audit?from=${today}&to=${today}`).expect(200);
    expect(hit.body.total).toBeGreaterThan(0);
    const miss = await agent.get(`${API}/audit?from=2000-01-01&to=2000-01-02`).expect(200);
    expect(miss.body.total).toBe(0);
    await agent.get(`${API}/audit?from=bukan-tanggal`).expect(400);
  });
});
