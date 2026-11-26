import { existsSync } from 'node:fs';
import path from 'node:path';
import shpwrite from '@mapbox/shp-write';
import JSZip from 'jszip';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMap, inspectZip, normalizeFeatures } from '../src/modules/upload.js';
import { API, env, loginAs, makeApp, sql } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
let editor: Agent;

const pjuGeojson = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, properties: { nama: 'PJU-01', daya_watt: 60 }, geometry: { type: 'Point' as const, coordinates: [110.15, -7.85] } },
    { type: 'Feature' as const, properties: { nama: 'PJU-02', daya_watt: 90 }, geometry: { type: 'Point' as const, coordinates: [110.16, -7.86] } },
  ],
};

const shpZip = async () => Buffer.from(await shpwrite.zip(pjuGeojson, { outputType: 'nodebuffer' } as never) as unknown as ArrayBuffer);

const zipOf = async (files: Record<string, string | Uint8Array>) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
};

const upload = (slug: string, buf: Buffer, query = '', filename = 'data.zip') =>
  editor.post(`${API}/layers/${slug}/upload${query}`).attach('file', buf, filename);

beforeAll(async () => {
  editor = (await loginAs('editor')).agent;
});

describe('upload GeoJSON', () => {
  const json = (v: unknown) => Buffer.from(JSON.stringify(v));
  // App sendiri: kuota unggah (30/15 menit) dipakai bersama tes upload lain di file ini.
  let geo: Agent;
  beforeAll(async () => { geo = (await loginAs('editor', makeApp({ upload: 100 }))).agent; });
  const upload = (slug: string, buf: Buffer, query: string, filename: string) => geo.post(`${API}/layers/${slug}/upload${query}`).attach('file', buf, filename);
  it('FeatureCollection & satu Feature: jalur sama dengan shapefile (dry run, lalu tambah)', async () => {
    const dry = await upload('pju', json(pjuGeojson), '?dryRun=true', 'pju.geojson').expect(200);
    expect(dry.body).toMatchObject({ count: 2, skipped: 0, hasPrj: true });
    const before = (await editor.get(`${API}/layers/pju/features`)).body.total;
    await upload('pju', json(pjuGeojson.features[0]), '?mode=append', 'satu.json').expect(201);
    expect((await editor.get(`${API}/layers/pju/features`)).body.total).toBe(before + 1);
    // CRS lama 4326/CRS84 diterima.
    await upload('pju', json({ ...pjuGeojson, crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } }), '?dryRun=true', 'a.geojson').expect(200);
  });
  it('menolak JSON rusak, proyeksi selain WGS84, tipe salah, dan koleksi kosong', async () => {
    expect((await upload('pju', Buffer.from('{bukan json'), '', 'a.geojson').expect(400)).body.error).toBe('File GeoJSON tidak dapat dibaca');
    expect((await upload('pju', json({ ...pjuGeojson, crs: { properties: { name: 'EPSG:32749' } } }), '', 'a.geojson').expect(400)).body.error).toMatch(/WGS84/);
    expect((await upload('pju', json({ type: 'Point', coordinates: [110, -7] }), '', 'a.geojson').expect(400)).body.error).toMatch(/FeatureCollection/);
    expect((await upload('pju', json({ type: 'FeatureCollection', features: [] }), '', 'a.geojson').expect(400)).body.error).toBe('GeoJSON tidak berisi fitur');
    await upload('pju', json(pjuGeojson), '', 'a.txt').expect(400);
  });

  it('pemetaan kolom (map) + atribut turunan: kecamatan, kapanewon, panjang dari geometri', async () => {
    const [batas] = await sql<{ id: number }[]>`SELECT id FROM layers WHERE slug = 'batas-administrasi'`;
    const kec = await sql<{ id: number }[]>`
      INSERT INTO features (layer_id, properties, geom) VALUES
        (${batas!.id}, '{"kecamatan":"UjiA","kalurahan":"A1"}', ST_Multi(ST_MakeEnvelope(120.0, -8.0, 120.01, -7.99, 4326))),
        (${batas!.id}, '{"kecamatan":"UjiB","kalurahan":"B1"}', ST_Multi(ST_MakeEnvelope(120.01, -8.0, 120.02, -7.99, 4326)))
      RETURNING id`;
    // Garis 0,015° melintasi dua kecamatan (lebih panjang di UjiA); LEN = 0 -> panjang dihitung ulang.
    const road = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { Nama: 'Ruas Uji', LEN: 0, Sampah: 'x' },
      geometry: { type: 'LineString', coordinates: [[120.0, -7.995], [120.015, -7.995]] } }] };
    const map = encodeURIComponent(JSON.stringify({ nama_ruas: 'Nama', panjang_km: 'LEN', tidak_ada: 'X' }));
    await upload('jalan-nasional', json(road), `?map=${map}`, 'r.geojson').expect(201);
    const [row] = await sql<{ id: number; p: Record<string, unknown> }[]>`
      SELECT f.id, f.properties AS p FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = 'jalan-nasional'
      WHERE f.properties->>'nama_ruas' = 'Ruas Uji'`;
    expect(row!.p).toMatchObject({ nama_ruas: 'Ruas Uji', kapanewon: 'UjiA, UjiB', kecamatan: 'UjiA' });
    expect(row!.p).not.toHaveProperty('Sampah');
    expect(row!.p.panjang_km as number).toBeCloseTo(1.653, 1); // 0,015° bujur di 8° LS
    // Nilai dari berkas tidak ditimpa; map rusak ditolak.
    const keep = { ...road, features: [{ ...road.features[0]!, properties: { Nama: 'Ruas Dua', LEN: 9 } }] };
    await upload('jalan-nasional', json(keep), `?map=${map}`, 'r.geojson').expect(201);
    const [two] = await sql<{ p: Record<string, unknown> }[]>`SELECT properties AS p FROM features WHERE properties->>'nama_ruas' = 'Ruas Dua'`;
    expect(two!.p.panjang_km).toBe(9);
    await upload('jalan-nasional', json(road), '?map=%7Bbukan', 'r.geojson').expect(400);
    // Fitur tanpa atribut / kolom tak ada di fitur: field terpetakan jadi null.
    const bare = [{ type: 'Feature' as const, geometry: null, properties: null }];
    applyMap(bare, { nama_ruas: 'Nama' }, { fields: [{ key: 'nama_ruas', label: 'Nama', type: 'text' }] } as never);
    expect(bare[0]!.properties).toEqual({ nama_ruas: null });
    await sql`DELETE FROM features_all WHERE properties->>'nama_ruas' IN ('Ruas Uji', 'Ruas Dua') OR id = ANY(${kec.map((k) => k.id)}::int[])`;
  });
});

describe('upload shapefile', () => {
  it('dry run menampilkan ringkasan tanpa menyimpan', async () => {
    const before = (await editor.get(`${API}/layers/pju/features`)).body.total;
    const res = await upload('pju', await shpZip(), '?dryRun=true').expect(200);
    expect(res.body).toMatchObject({ count: 2, skipped: 0, hasPrj: true, missingFields: ['lokasi', 'jenis_lampu', 'tinggi_tiang', 'daya_kwh_va', 'tahun_pasang', 'pengadaan', 'no_tiang', 'keterangan'] });
    expect(res.body.columns).toEqual(['nama', 'daya_watt']);
    expect(res.body.sample.features).toHaveLength(2);
    expect((await editor.get(`${API}/layers/pju/features`)).body.total).toBe(before);
  });

  it('append menambah, replace mengganti seluruh data layer', async () => {
    const buf = await shpZip();
    const before = (await editor.get(`${API}/layers/pju/features`)).body.total;
    await upload('pju', buf).expect(201);
    await upload('pju', buf, '?mode=append').expect(201);
    expect((await editor.get(`${API}/layers/pju/features`)).body.total).toBe(before + 4);
    await upload('pju', buf, '?mode=replace').expect(201);
    const list = (await editor.get(`${API}/layers/pju/features`)).body;
    expect(list.total).toBe(2);
    expect(list.data[0].geometryType).toBe('MULTIPOINT');
  });

  it('menolak file tidak valid', async () => {
    const err = async (res: Promise<{ body: { error: string } }>) => (await res).body.error;
    expect(await err(upload('pju', Buffer.from('x'), '', 'data.txt').expect(400))).toMatch(/Format file/);
    expect(await err(upload('pju', Buffer.from('bukan zip'), '').expect(400))).toMatch(/bukan arsip/);
    expect(await err(upload('pju', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])).expect(400))).toMatch(/rusak/);
    expect(await err(upload('pju', await zipOf({ 'a.shp': 'x', 'b.shp': 'x' })).expect(400))).toMatch(/ditemukan 2/);
    expect(await err(upload('pju', await zipOf({ 'a.shp': 'x', 'a.shx': 'x' })).expect(400))).toMatch(/\.dbf/);
    expect(await err(upload('pju', await zipOf({ 'a.shp': 'x', 'a.shx': 'x', 'a.dbf': 'x' })).expect(400))).toMatch(/tidak dapat dibaca/);
    expect(await err(upload('jalan-kabupaten', await shpZip()).expect(400))).toMatch(/2 fitur tidak valid/);
    await upload('kawasan-pertanian', await shpZip()).expect(409);
    await editor.post(`${API}/layers/pju/upload`).expect(400);
    await editor.post(`${API}/layers/pju/upload`).attach('lain', Buffer.from('x'), 'a.zip').expect(400);
  });

  it('menolak file melebihi batas ukuran', async () => {
    await editor.post(`${API}/features/1/media`).attach('file', Buffer.alloc(11 * 1024 * 1024), 'besar.jpg').expect(413);
  });
});

describe('inspectZip & normalizeFeatures', () => {
  it('mendeteksi .prj dan mengabaikan __MACOSX', async () => {
    expect(await inspectZip(await zipOf({ 'A.SHP': 'x', 'A.SHX': 'x', 'A.DBF': 'x', '__MACOSX/A.shp': 'x' }))).toEqual({ hasPrj: false });
  });

  it('menolak zip bomb (isi terdekompresi melebihi batas)', async () => {
    const zip = new JSZip();
    zip.file('a.shp', Buffer.alloc(0)); zip.file('a.shx', Buffer.alloc(0));
    zip.file('a.dbf', Buffer.alloc(250 * 1024 * 1024)); // 250 MB nol -> sangat kecil terkompresi, > cap 200 MB
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await expect(inspectZip(bomb)).rejects.toThrow(/terlalu besar setelah dekompresi/);
    // ponytail: membuat & membuka 250 MB lambat di bawah instrumentasi coverage (~25 dtk); batas waktu khusus tes ini.
  }, 90_000);

  it('membersihkan nilai atribut dan menghitung geometri kosong', () => {
    const { valid, errors, skipped } = normalizeFeatures([
      { type: 'Feature', geometry: null, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [500000, 9000000] }, properties: {} },
      {
        type: 'Feature', geometry: { type: 'Point', coordinates: [110, -7] },
        properties: { tgl: new Date('2026-01-02'), rusak: new Date('x'), teks: '  a  ', kosong: '  ', n: 5, inf: Infinity, b: true, obj: {} },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [110, -7] }, properties: null },
    ], 'Point');
    expect(skipped).toBe(1);
    expect(errors).toEqual([expect.stringMatching(/^Fitur #2: Koordinat/)]);
    expect(valid[0]!.properties).toEqual({ tgl: '2026-01-02', rusak: null, teks: 'a', kosong: null, n: 5, inf: null, b: true, obj: null });
    expect(valid[1]!.properties).toEqual({});
  });

  it('memvalidasi atribut terhadap skema layer (angka teks dikonversi)', () => {
    const fields = [{ key: 'n', type: 'number' }, { key: 'k', type: 'select', options: ['A'] }];
    const pt = (properties: Record<string, unknown>) => ({ type: 'Feature' as const, geometry: { type: 'Point', coordinates: [110, -7] }, properties });
    const { valid, errors } = normalizeFeatures([pt({ n: '5', k: 'A' }), pt({ n: 'x', k: 'B' })], 'Point', { fields });
    expect(valid[0]!.properties).toEqual({ n: 5, k: 'A' });
    expect(errors).toEqual([expect.stringMatching(/^Fitur #2: n harus angka; k harus salah satu: A/)]);
  });
});

describe('media', () => {
  let featureId: number;
  beforeAll(async () => {
    const list = (await editor.get(`${API}/layers/pju/features`)).body;
    featureId = list.data[0].id;
  });

  it('foto dikonversi ke WebP + AVIF, bisa diakses, lalu dihapus', async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#DE533C' } }).png().toBuffer();
    const res = await editor.post(`${API}/features/${featureId}/media`).attach('file', png, 'foto.png').expect(201);
    expect(res.body).toMatchObject({ width: 1600, height: 800 });
    expect(res.body.webp).toMatch(/\.webp$/);
    expect(existsSync(path.join(env.UPLOAD_DIR, res.body.avif))).toBe(true);

    const file = await editor.get(`/uploads/${res.body.webp}`).expect(200);
    expect(file.headers['cache-control']).toMatch(/immutable/);
    expect((await editor.get(`${API}/features/${featureId}`)).body.media).toHaveLength(1);

    await editor.delete(`${API}/media/${res.body.id}`).expect(204);
    expect(existsSync(path.join(env.UPLOAD_DIR, res.body.webp))).toBe(false);
    await editor.delete(`${API}/media/${res.body.id}`).expect(404);
    await editor.get(`/uploads/${res.body.webp}`).expect(404);
  });

  it('metadata dokumentasi: unggah dengan keterangan/tanggal/urgensi, ubah via PATCH, urut paling urgen dulu', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#000' } }).png().toBuffer();
    const low = await editor.post(`${API}/features/${featureId}/media`).field('urgensi', 'rendah').attach('file', png, 'a.png').expect(201);
    const high = await editor.post(`${API}/features/${featureId}/media`)
      .field('caption', 'Lubang 1 m di bahu jalan').field('tanggal', '2026-11-03').field('urgensi', 'tinggi').attach('file', png, 'b.png').expect(201);
    expect(high.body).toMatchObject({ caption: 'Lubang 1 m di bahu jalan', tanggal: '2026-11-03', urgensi: 'tinggi' });
    expect((await editor.get(`${API}/features/${featureId}`)).body.media.map((m: { id: number }) => m.id)).toEqual([high.body.id, low.body.id]);

    const patched = await editor.patch(`${API}/media/${low.body.id}`).send({ caption: 'Sudah ditambal', urgensi: 'sedang' }).expect(200);
    expect(patched.body).toMatchObject({ caption: 'Sudah ditambal', urgensi: 'sedang', tanggal: null });
    await editor.patch(`${API}/media/${low.body.id}`).send({ urgensi: 'darurat' }).expect(400);
    // Field form kosong ("") = dikosongkan, bukan galat validasi.
    expect((await editor.patch(`${API}/media/${low.body.id}`).send({ tanggal: '', urgensi: '' }).expect(200)).body).toMatchObject({ tanggal: null, urgensi: null });
    expect((await editor.patch(`${API}/media/${low.body.id}`).expect(200)).body).toMatchObject({ caption: null });
    await editor.patch(`${API}/media/999999`).send({ caption: 'x' }).expect(404);
    for (const m of [low, high]) await editor.delete(`${API}/media/${m.body.id}`).expect(204);
  });

  it('hapus = soft delete: foto tetap, bisa dipulihkan; hapus permanen (superadmin) membersihkan berkas', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const make = async (kode: string) => {
      const f = await editor.post(`${API}/layers/pju/features`).send({ properties: { nama: kode, jenis_lampu: 'LED' }, geometry: { type: 'Point', coordinates: [110.15, -7.86] } }).expect(201);
      const m = await editor.post(`${API}/features/${f.body.id}/media`).attach('file', png, 'p.png').expect(201);
      return { id: f.body.id as string, files: [m.body.webp, m.body.avif] as string[] };
    };
    const exists = (files: string[]) => files.map((f) => existsSync(path.join(env.UPLOAD_DIR, f)));
    const listed = async (id: string) => (await editor.get(`${API}/features/${id}`)).status === 200;
    const trash = async () => (await editor.get(`${API}/layers/pju/features/trash`).expect(200)).body as { total: number; data: { id: string; deletedBy: string }[] };

    // Hapus tunggal: hilang dari daftar & detail, masuk tempat sampah, foto tetap di disk.
    const one = await make('YATIM-1');
    await editor.delete(`${API}/features/${one.id}`).expect(204);
    await editor.delete(`${API}/features/${one.id}`).expect(404); // sudah di tempat sampah
    expect(await listed(one.id)).toBe(false);
    expect((await trash()).data.find((r) => r.id === one.id)?.deletedBy).toBe('Tester');
    expect(exists(one.files)).toEqual([true, true]);
    // Cari di tempat sampah: nilai atribut, ID, nama penghapus; tanpa hasil = kosong.
    const find = async (q: string) => (await editor.get(`${API}/layers/pju/features/trash?q=${encodeURIComponent(q)}`).expect(200)).body.data.map((r: { id: string }) => r.id);
    expect(await find('yatim-1')).toEqual([one.id]);
    expect(await find(one.id)).toEqual([one.id]);
    expect(await find('Tester')).toContain(one.id);
    expect(await find('tidak-ada-xyz')).toEqual([]);

    // Pulihkan: kembali aktif bersama fotonya; memulihkan fitur aktif = 404.
    expect((await editor.post(`${API}/features/${one.id}/restore`).expect(200)).body.id).toBe(one.id);
    expect((await editor.get(`${API}/features/${one.id}`).expect(200)).body.media).toHaveLength(1);
    await editor.post(`${API}/features/${one.id}/restore`).expect(404);

    // Hapus massal lalu hapus permanen: hanya superadmin, hanya dari tempat sampah, berkas ikut terhapus.
    const a = await make('YATIM-2'), b = await make('YATIM-3');
    await editor.post(`${API}/layers/pju/features/bulk-delete`).send({ ids: [Number(a.id), Number(b.id)] }).expect(200);
    // Filter kecamatan ikut di tempat sampah; pulihkan massal mengembalikan keduanya, lalu dihapus lagi untuk uji permanen.
    expect((await editor.get(`${API}/layers/pju/features/trash?kecamatan=Tidak%20Ada`).expect(200)).body.total).toBe(0);
    expect((await editor.post(`${API}/layers/pju/features/bulk-restore`).send({ ids: [Number(a.id), Number(b.id)] }).expect(200)).body).toEqual({ restored: 2 });
    expect(await listed(a.id) && await listed(b.id)).toBe(true);
    await editor.post(`${API}/layers/pju/features/bulk-delete`).send({ ids: [Number(a.id), Number(b.id)] }).expect(200);
    expect(exists([...a.files, ...b.files])).toEqual([true, true, true, true]);
    // Urutan header tabel Terhapus: id/atribut naik-turun, penghapus, dan waktu (bawaan terbaru dulu).
    const order = async (qs: string) => ((await editor.get(`${API}/layers/pju/features/trash?q=yatim&${qs}`).expect(200)).body.data as { id: string }[]).map((r) => r.id);
    const [lo, hi] = [a.id, b.id].sort((x, y) => Number(x) - Number(y));
    expect(await order('sort=id&order=asc')).toEqual([lo, hi]);
    expect(await order('sort=id&order=desc')).toEqual([hi, lo]);
    expect(await order('sort=nama&order=desc')).toEqual([b.id, a.id]);
    expect(await order('sort=deleted_by&order=asc')).toHaveLength(2);
    expect(await order('sort=deleted_at&order=asc')).toHaveLength(2);
    await editor.get(`${API}/layers/pju/features/trash?sort=1x`).expect(400);
    await editor.delete(`${API}/features/${a.id}/purge`).expect(403);
    const { agent: admin, id: adminId } = await loginAs('superadmin');
    await admin.delete(`${API}/features/${one.id}/purge`).expect(404); // masih aktif, bukan di tempat sampah
    await admin.delete(`${API}/features/${a.id}/purge`).expect(204);
    // Hapus permanen massal: editor ditolak; fitur aktif (one) di daftar ids tidak ikut terhapus.
    await editor.post(`${API}/layers/pju/features/bulk-purge`).send({ ids: [Number(b.id)] }).expect(403);
    expect((await admin.post(`${API}/layers/pju/features/bulk-purge`).send({ ids: [Number(b.id), Number(one.id)] }).expect(200)).body).toEqual({ purged: 1 });
    expect(await listed(one.id)).toBe(true);
    expect(exists([...a.files, ...b.files])).toEqual([false, false, false, false]);
    expect((await trash()).data.some((r) => r.id === a.id || r.id === b.id)).toBe(false);
    expect((await sql`SELECT count(*)::int AS n FROM features_all WHERE id IN (${a.id}, ${b.id})`)[0]!.n).toBe(0);
    // Tes seed mengandaikan belum ada superadmin di DB tes: akun sementara ini dibuang lagi (FK ke users = SET NULL).
    await sql`DELETE FROM users WHERE id = ${adminId}`;
  });

  it('menolak non-gambar dan fitur yang tidak ada', async () => {
    await editor.post(`${API}/features/${featureId}/media`).attach('file', Buffer.from('bukan gambar'), 'palsu.jpg').expect(400);
    await editor.post(`${API}/features/999999/media`).attach('file', Buffer.from('x'), 'a.jpg').expect(404);
  });
});
