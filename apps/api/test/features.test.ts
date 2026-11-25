import { beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '../src/modules/features.js';
import { API, loginAs, sql, WATES } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
let editor: Agent;
let viewer: Agent;

const road = { type: 'LineString', coordinates: [[110.12, -7.85], [110.18, -7.85]] };

beforeAll(async () => {
  editor = (await loginAs('editor')).agent;
  viewer = (await loginAs('viewer')).agent;
  await editor.post(`${API}/layers/batas-administrasi/features`).send({ properties: { kecamatan: 'Wates', kalurahan: 'Bendungan' }, geometry: WATES }).expect(201);
  await editor.post(`${API}/layers/penggunaan-lahan/features`).send({ properties: { kelas: 'Sawah Irigasi', pola_ruang: 'Kawasan Tanaman Pangan', kesesuaian: 'Sesuai' }, geometry: WATES }).expect(201);
  await editor.post(`${API}/layers/penggunaan-lahan/features`).send({ properties: { kelas: 'Lahan Terbangun', pola_ruang: 'Kawasan Permukiman Perkotaan', kesesuaian: 'Tidak Sesuai' }, geometry: WATES }).expect(201);
});

describe('features CRUD', () => {
  it('membuat, membaca, mengubah, menghapus fitur jalan', async () => {
    const created = await editor.post(`${API}/layers/jalan-kabupaten/features`)
      .send({ properties: { nama_ruas: 'Jl. Wates', fungsi: 'Jalan Lokal Primer (JLP)', kondisi: 'Baik', panjang_km: 6 }, geometry: road }).expect(201);
    expect(created.body.geometry.type).toBe('MultiLineString');
    const id = created.body.id;

    const got = await viewer.get(`${API}/features/${id}`).expect(200);
    expect(got.body).toMatchObject({ type: 'Feature', slug: 'jalan-kabupaten', media: [] });
    expect(got.body.lengthKm).toBeGreaterThan(0);
    expect(got.body.areaHa).toBeNull();

    // Kondisi tidak bisa diisi tangan: selalu dari tabel survei (ruas tanpa survei = Belum Disurvei).
    const upd = await editor.patch(`${API}/features/${id}`).send({ properties: { kondisi: 'Rusak Berat', panjang_km: 7 } }).expect(200);
    expect(upd.body.properties).toMatchObject({ nama_ruas: 'Jl. Wates', kondisi: 'Belum Disurvei', panjang_km: 7 });
    const geo = await editor.patch(`${API}/features/${id}`).send({ geometry: { type: 'LineString', coordinates: [[110.12, -7.86], [110.15, -7.86]] } }).expect(200);
    expect(geo.body.geometry.coordinates[0][0]).toEqual([110.12, -7.86]);
    // Versi terbaru diterima; versi lama (editor lain sudah menyimpan) ditolak 409 tanpa mengubah data.
    const fresh = await editor.patch(`${API}/features/${id}`).send({ properties: { kondisi: 'Sedang' }, updatedAt: geo.body.updatedAt }).expect(200);
    expect((await editor.patch(`${API}/features/${id}`).send({ properties: { kondisi: 'Baik' }, updatedAt: geo.body.updatedAt }).expect(409)).body.error).toMatch(/diubah pengguna lain/);
    expect((await editor.get(`${API}/features/${id}`)).body.properties.kondisi).toBe(fresh.body.properties.kondisi);
    await editor.patch(`${API}/features/${id}`).send({ geometry: { type: 'Point', coordinates: [110, -7] } }).expect(400);

    await viewer.delete(`${API}/features/${id}`).expect(403);
    await editor.delete(`${API}/features/${id}`).expect(204);
    await editor.delete(`${API}/features/${id}`).expect(404);
    await viewer.get(`${API}/features/${id}`).expect(404);
  });

  it('memvalidasi atribut dan geometri', async () => {
    const post = (body: object) => editor.post(`${API}/layers/pju/features`).send(body);
    const point = { type: 'Point', coordinates: [110.15, -7.85] };
    expect((await post({ properties: {}, geometry: point }).expect(400)).body.error).toMatch(/nama wajib diisi.*jenis_lampu wajib/);
    expect((await post({ properties: { nama: 'P1', jenis_lampu: 'Neon', daya_watt: 'besar' }, geometry: point }).expect(400)).body.error)
      .toMatch(/jenis_lampu harus salah satu.*daya_watt harus angka/);
    expect((await post({ properties: { nama: 'P1', jenis_lampu: 'LED' }, geometry: road }).expect(400)).body.error).toMatch(/tidak sesuai layer/);
    expect((await post({ properties: { nama: 'P1', jenis_lampu: 'LED' }, geometry: { type: 'Point', coordinates: [430000, 9130000] } }).expect(400)).body.issues[0].message)
      .toMatch(/WGS84/);
    await post({ properties: { nama: 'P1', jenis_lampu: 'LED', lokasi: null }, geometry: point }).expect(201);
    await editor.post(`${API}/layers/kawasan-pertanian/features`).send({ properties: {}, geometry: WATES }).expect(409);
    await editor.post(`${API}/layers/tidak-ada/features`).send({ properties: {}, geometry: point }).expect(404);
  });

  it('list dengan paginasi, pencarian, filter kecamatan, urutan; layer turunan terfilter', async () => {
    const list = await viewer.get(`${API}/layers/penggunaan-lahan/features?limit=1`).expect(200);
    expect(list.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(list.body.data[0]).not.toHaveProperty('total');
    expect(list.body.data[0].geometryType).toBe('MULTIPOLYGON');

    const q = await viewer.get(`${API}/layers/penggunaan-lahan/features?q=sawah&sort=updated_at&order=asc`).expect(200);
    expect(q.body.total).toBe(1);
    expect((await viewer.get(`${API}/layers/penggunaan-lahan/features?kecamatan=wates`).expect(200)).body.total).toBe(2);
    expect((await viewer.get(`${API}/layers/penggunaan-lahan/features?kecamatan=Sentolo`).expect(200)).body).toMatchObject({ total: 0, data: [] });
    // Urut per atribut (header kolom tabel): teks A-Z / Z-A; kunci tidak sah ditolak.
    const byKelas = async (order: string) => (await viewer.get(`${API}/layers/penggunaan-lahan/features?sort=kelas&order=${order}`).expect(200)).body.data.map((f: { properties: { kelas: string } }) => f.properties.kelas);
    expect(await byKelas('asc')).toEqual(['Lahan Terbangun', 'Sawah Irigasi']);
    expect(await byKelas('desc')).toEqual(['Sawah Irigasi', 'Lahan Terbangun']);
    await viewer.get(`${API}/layers/penggunaan-lahan/features?sort=kelas;drop`).expect(400);
    // Nama dicocokkan persis (tanpa wildcard LIKE).
    expect((await viewer.get(`${API}/layers/penggunaan-lahan/features?kecamatan=W_tes`).expect(200)).body.total).toBe(0);

    const derived = await viewer.get(`${API}/layers/kawasan-pertanian/features`).expect(200);
    expect(derived.body.data.map((f: { properties: { kelas: string } }) => f.properties.kelas)).toEqual(['Sawah Irigasi']);
    await viewer.get(`${API}/layers/pju/features?sort=1nama`).expect(400);
  });

  it('titik kawasan: kecamatan/kalurahan dari poligon batas terdekat saat dibuat & dipindah', async () => {
    const t = await editor.post(`${API}/layers/destinasi-pariwisata/features`)
      .send({ properties: { nama: 'Uji', kawasan: 'KPPD 1' }, geometry: { type: 'Point', coordinates: [110.4, -7.9] } }).expect(201);
    expect(t.body.properties).toMatchObject({ kecamatan: 'Wates', kalurahan: 'Bendungan' }); // di luar poligon: terdekat
    expect(t.body.properties).not.toHaveProperty('status_koordinat');
    await sql`UPDATE features SET properties = properties - 'kalurahan' WHERE id = ${t.body.id}`;
    const moved = await editor.patch(`${API}/features/${t.body.id}`).send({ geometry: { type: 'Point', coordinates: [110.16, -7.86] } }).expect(200);
    expect(moved.body.properties).toMatchObject({ kalurahan: 'Bendungan' });
  });

  it('bulk delete hanya untuk layer yang bisa ditulis', async () => {
    const a = await editor.post(`${API}/layers/utilitas-umum/features`).send({ properties: { nama: 'A', jenis: 'Drainase' }, geometry: { type: 'Point', coordinates: [110.1, -7.8] } });
    const res = await editor.post(`${API}/layers/utilitas-umum/features/bulk-delete`).send({ ids: [Number(a.body.id), 999999] }).expect(200);
    expect(res.body).toEqual({ deleted: 1 });
    await editor.post(`${API}/layers/kawasan-pertanian/features/bulk-delete`).send({ ids: [1] }).expect(409);
    await editor.post(`${API}/layers/utilitas-umum/features/bulk-delete`).send({ ids: [] }).expect(400);
  });

  it('ekspor GeoJSON dan CSV', async () => {
    const gj = await viewer.get(`${API}/layers/penggunaan-lahan/export`).expect(200);
    expect(gj.headers['content-type']).toMatch(/geo\+json/);
    expect(gj.headers['content-disposition']).toMatch(/penggunaan-lahan\.geojson/);
    expect(JSON.parse(gj.text).features).toHaveLength(2);

    const empty = await viewer.get(`${API}/layers/potensi-bencana/export?kecamatan=Wates`).expect(200);
    expect(JSON.parse(empty.text).features).toEqual([]);

    const csv = await viewer.get(`${API}/layers/kawasan-pertanian/export?format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/^﻿id,kelas,kesesuaian,pola_ruang,tahun_data,diperbarui,geometry_wkt\r\n\d+,Sawah Irigasi,Sesuai,Kawasan Tanaman Pangan,\d{4},\d{4}-\d{2}-\d{2},"MULTIPOLYGON/);
    expect(JSON.parse(gj.text).features[0].properties).toMatchObject({ tahun_data: expect.any(Number), diperbarui: expect.stringMatching(/^\d{4}-/) });

    const shp = await viewer.get(`${API}/layers/penggunaan-lahan/export?format=shp`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(shp.headers['content-type']).toMatch(/zip/);
    expect(shp.headers['content-disposition']).toMatch(/penggunaan-lahan\.zip/);
    const names = (shp.body as Buffer).toString('latin1');
    for (const ext of ['shp', 'shx', 'dbf', 'prj']) expect(names).toContain(`penggunaan-lahan.${ext}`);

    // Layer titik (disimpan MultiPoint): SHP tetap berisi berkas titik, bukan zip kosong 22 byte.
    const pt = await editor.post(`${API}/layers/pju/features`).send({ properties: { nama: 'PJU uji', jenis_lampu: 'LED' }, geometry: { type: 'Point', coordinates: [110.16, -7.86] } }).expect(201);
    const pshp = await viewer.get(`${API}/layers/pju/export?format=shp`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((pshp.body as Buffer).toString('latin1')).toContain('pju.shp');
    await editor.delete(`${API}/features/${pt.body.id}`).expect(204);
  });

  it('nama kolom DBF <= 10 karakter tanpa bentrok; objek jadi JSON', async () => {
    const { dbfProps } = await import('../src/modules/features.js');
    const [r] = dbfProps([{ luas_terdampak_ha: 1, luas_terdampak_x: 2, a: { b: 1 } as never }]);
    expect(Object.keys(r!)).toEqual(['luas_terda', 'luas_ter_1', 'a']);
    expect(r!.a).toBe('{"b":1}');
  });

  it('tahun data: default tahun berjalan, bisa diisi saat buat & ubah; detail memuat pengubah', async () => {
    const road = { type: 'LineString', coordinates: [[110.12, -7.85], [110.18, -7.85]] };
    const made = await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Jl. T' }, geometry: road }).expect(201);
    expect(made.body.tahunData).toBe(new Date().getFullYear());
    const old = await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Jl. U' }, geometry: road, tahunData: 2019 }).expect(201);
    expect(old.body.tahunData).toBe(2019);
    const upd = await editor.patch(`${API}/features/${made.body.id}`).send({ tahunData: 2024 }).expect(200);
    expect(upd.body).toMatchObject({ tahunData: 2024, updatedByName: expect.any(String) });
    await editor.patch(`${API}/features/${made.body.id}`).send({ tahunData: 1800 }).expect(400);
  });
});

describe('ekspor gagal', () => {
  it('galat sebelum header -> 500 JSON, galat di tengah aliran -> koneksi diputus', async () => {
    // Byte NUL ditolak Postgres (encoding UTF8) saat query dijalankan: CSV gagal sebelum menulis apa pun,
    // GeoJSON gagal setelah pembuka koleksi terkirim.
    await viewer.get(`${API}/layers/penggunaan-lahan/export`).query({ format: 'csv', kecamatan: '\0' }).expect(500);
    await expect(viewer.get(`${API}/layers/penggunaan-lahan/export`).query({ kecamatan: '\0' })).rejects.toThrow();
  });

  it('ekspor besar tetap utuh saat buffer respons penuh (backpressure)', async () => {
    const [layer] = await sql<{ id: number }[]>`
      INSERT INTO layers (slug, name, category, geom_type) VALUES ('uji-ekspor-besar', 'Uji', 'Uji', 'Point') RETURNING id`;
    await sql`
      INSERT INTO features (layer_id, properties, geom)
      SELECT ${layer!.id}, jsonb_build_object('teks', repeat(md5(i::text), 60)), ST_Multi(ST_SetSRID(ST_MakePoint(110, -7.8), 4326))
      FROM generate_series(1, 300) i`;
    const res = await viewer.get(`${API}/layers/uji-ekspor-besar/export`).expect(200);
    expect(JSON.parse(res.text).features).toHaveLength(300);
    await sql`DELETE FROM layers WHERE id = ${layer!.id}`;
  });
});

describe('toCsv', () => {
  it('meng-escape kutip, koma, baris baru dan mencegah formula injection', () => {
    const csv = toCsv([
      { id: '1', properties: { a: '=SUM(A1)', b: 'x,"y"' }, wkt: 'POINT(1 2)' },
      { id: '2', properties: { a: null, c: 'baris\nbaru' }, wkt: 'POINT(3 4)' },
    ]);
    expect(csv.split('\r\n')).toEqual(['id,a,b,c,geometry_wkt', `1,'=SUM(A1),"x,""y""",,POINT(1 2)`, '2,,,"baris\nbaru",POINT(3 4)']);
  });
});

describe('tiles & stats', () => {
  it('vector tile berisi fitur, tile kosong, cache header, koordinat tidak valid', async () => {
    // Tile zoom 10 yang memuat Wates (110.15, -7.85).
    const tile = await viewer.get(`${API}/tiles/penggunaan-lahan/10/825/534.pbf?kecamatan=Wates`).responseType('blob').expect(200);
    expect(tile.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    expect(tile.headers['cache-control']).toBe('private, max-age=86400');
    expect(tile.body.length).toBeGreaterThan(50);
    const empty = await viewer.get(`${API}/tiles/penggunaan-lahan/10/0/0`).responseType('blob').expect(200);
    expect(empty.body.length).toBe(0);
    await viewer.get(`${API}/tiles/penggunaan-lahan/2/9/0`).expect(400);
    await viewer.get(`${API}/tiles/penggunaan-lahan/2/0/abc`).expect(400);
  });

  it('statistik per kelas (luas ha), tanpa kelas, dan per kecamatan', async () => {
    const pl = await viewer.get(`${API}/stats/layers/penggunaan-lahan`).expect(200);
    expect(pl.body).toHaveLength(2);
    expect(pl.body[0].areaHa).toBeGreaterThan(10000);
    expect(pl.body[0].lengthKm).toBe(0);

    const filtered = await viewer.get(`${API}/stats/layers/penggunaan-lahan?kecamatan=Sentolo`).expect(200);
    expect(filtered.body).toEqual([]);
    // Filter kecamatan memotong poligon di batas: poligon lintas batas hanya dihitung bagian dalamnya,
    // poligon tetangga yang hanya bersinggungan tidak ikut.
    const across = { type: 'Polygon', coordinates: [[[110.1, -7.9], [110.3, -7.9], [110.3, -7.8], [110.1, -7.8], [110.1, -7.9]]] };
    const touching = { type: 'Polygon', coordinates: [[[110.2, -7.9], [110.3, -7.9], [110.3, -7.8], [110.2, -7.8], [110.2, -7.9]]] };
    await editor.post(`${API}/layers/tutupan-lahan/features`).send({ properties: { kelas: 'Sawah' }, geometry: across }).expect(201);
    await editor.post(`${API}/layers/tutupan-lahan/features`).send({ properties: { kelas: 'Semak Belukar' }, geometry: touching }).expect(201);
    const wates = (await viewer.get(`${API}/stats/layers/batas-administrasi?kecamatan=Wates`).expect(200)).body[0].areaHa;
    const clipped = (await viewer.get(`${API}/stats/layers/tutupan-lahan?kecamatan=Wates`).expect(200)).body;
    expect(clipped).toEqual([expect.objectContaining({ key: 'Sawah', count: 1 })]);
    expect(clipped[0].areaHa).toBeCloseTo(wates, 0);

    const admin = await viewer.get(`${API}/stats/layers/batas-administrasi`).expect(200);
    expect(admin.body).toEqual([expect.objectContaining({ key: null, count: 1 })]);

    const byKec = await viewer.get(`${API}/stats/layers/kawasan-pertanian/kecamatan`).expect(200);
    expect(byKec.body).toEqual([expect.objectContaining({ kecamatan: 'Wates', key: 'Sawah Irigasi', count: 1 })]);
    const noClass = await viewer.get(`${API}/stats/layers/batas-administrasi/kecamatan`).expect(200);
    expect(noClass.body[0]).toMatchObject({ kecamatan: 'Wates', key: null });

    const fit = await viewer.get(`${API}/stats/layers/penggunaan-lahan?by=kesesuaian`).expect(200);
    expect(fit.body.map((r: { key: string }) => r.key).sort()).toEqual(['Sesuai', 'Tidak Sesuai']);

    expect((await viewer.get(`${API}/stats/kecamatan`).expect(200)).body).toEqual(['Wates']);
  });

  it('ruas jalan (filter kecamatan & tahun), layer penduduk miskin (atribut tahun), deret waktu', async () => {
    await sql`INSERT INTO ruas_jalan (kecamatan, wilayah, tahun, ruas, baik, rusak_berat) VALUES ('Kalibawang', 'Kalibawang II', 2025, 'Bendo - Bolon', 2.3, 0.7)`;
    // Penduduk miskin = satu layer; tahun di atribut, fitur = poligon kalurahan + tahun + jumlah.
    const miskin = (tahun: number, kecamatan: string, jumlah: number) =>
      editor.post(`${API}/layers/penduduk-miskin/features`).send({ properties: { kecamatan, kalurahan: 'Bendungan', tahun, jumlah }, geometry: WATES }).expect(201);
    await miskin(2026, 'Wates', 120);
    await miskin(2024, 'Wates', 30);
    await miskin(2026, 'Wates', 9);
    await miskin(2026, 'Pengasih', 77);

    const all = await viewer.get(`${API}/stats/ruas-jalan`).expect(200);
    expect(all.body).toEqual([expect.objectContaining({ ruas: 'Bendo - Bolon', baik: 2.3, rusakBerat: 0.7, sedang: 0 })]);
    expect((await viewer.get(`${API}/stats/ruas-jalan?kecamatan=kalibawang`).expect(200)).body).toHaveLength(1);
    expect((await viewer.get(`${API}/stats/ruas-jalan?kecamatan=Wates`).expect(200)).body).toEqual([]);
    expect((await viewer.get(`${API}/stats/ruas-jalan?dari=2025&sampai=2025`).expect(200)).body).toHaveLength(1);
    expect((await viewer.get(`${API}/stats/ruas-jalan?dari=2026`).expect(200)).body).toEqual([]);

    const layers = (await viewer.get(`${API}/layers`).expect(200)).body as { slug: string; year: number; category: string; style: { steps?: unknown } }[];
    expect(layers.find((l) => l.slug === 'penduduk-miskin')).toMatchObject({ year: null, category: 'Sosial', style: { steps: expect.anything() } });
    expect(layers.some((l) => l.slug.startsWith('penduduk-miskin-'))).toBe(false);

    // Deret waktu per kecamatan: kemiskinan dan ruas jalan digabung per (tahun, kecamatan).
    const byKec = (await viewer.get(`${API}/stats/timeseries/kecamatan`).expect(200)).body;
    expect(byKec).toEqual([
      { tahun: 2024, kecamatan: 'Wates', miskin: 30, jalanKm: 0, jalanRusakKm: 0 },
      { tahun: 2025, kecamatan: 'Kalibawang', miskin: 0, jalanKm: 3, jalanRusakKm: 0.7 },
      { tahun: 2026, kecamatan: 'Pengasih', miskin: 77, jalanKm: 0, jalanRusakKm: 0 },
      { tahun: 2026, kecamatan: 'Wates', miskin: 129, jalanKm: 0, jalanRusakKm: 0 },
    ]);

    const ts = await viewer.get(`${API}/stats/timeseries`).expect(200);
    expect(ts.body).toEqual([
      expect.objectContaining({ tahun: 2024, miskin: 30, jalanKm: 0 }),
      expect.objectContaining({ tahun: 2025, miskin: 0, jalanKm: 3, jalanRusakKm: 0.7 }),
      expect.objectContaining({ tahun: 2026, miskin: 206 }),
    ]);
    // Seri tambahan tren: jiwa miskin per kecamatan; objek kosong di tahun tanpa data kemiskinan.
    expect(ts.body[2]).toMatchObject({ miskinWilayah: { Wates: 129, Pengasih: 77 } });
    // Titik PJU tanpa tahun pasang tidak masuk deret, tetapi dihitung di pjuTanpaTahun (DB tes dipakai bersama berkas tes lain: cek bentuk).
    expect(ts.body[0]).toMatchObject({ pjuPasang: expect.any(Number), pjuLampu: expect.any(Object), pjuWatt: expect.any(Number) });
    expect(ts.body[0].pjuTanpaTahun).toBeGreaterThanOrEqual(1);
    expect(ts.body[1]).toMatchObject({ miskinWilayah: {} });
    // Filter kecamatan: rincian turun ke kalurahan.
    expect((await viewer.get(`${API}/stats/timeseries?kecamatan=Pengasih`).expect(200)).body).toEqual([expect.objectContaining({ tahun: 2026, miskin: 77, miskinWilayah: { Bendungan: 77 } })]);
    expect((await viewer.get(`${API}/stats/timeseries?kecamatan=Sentolo`).expect(200)).body).toEqual([]);
  });

  it('tabel ruas jalan: daftar, tambah, ubah, hapus, ekspor CSV; viewer hanya baca', async () => {
    const row = { kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2024, ruas: 'Uji - Coba', baik: 1, sedang: 0, rusakRingan: 0.2, rusakBerat: 0, perbaikan: 0 };
    await viewer.post(`${API}/tables/ruas-jalan`).send(row).expect(403);
    const { id } = (await editor.post(`${API}/tables/ruas-jalan`).send(row).expect(201)).body;
    await editor.post(`${API}/tables/ruas-jalan`).send(row).expect(409);
    await editor.post(`${API}/tables/ruas-jalan`).send({ ...row, ruas: 'Lain', baik: -1 }).expect(400);
    await editor.patch(`${API}/tables/ruas-jalan/${id}`).send({ rusakBerat: 0.4 }).expect(200);
    const list = (await viewer.get(`${API}/tables/ruas-jalan?tahun=2024`).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ id, ruas: 'Uji - Coba', rusakBerat: 0.4, rusakRingan: 0.2 })]);
    const csv = await viewer.get(`${API}/tables/ruas-jalan/export?tahun=2024`).expect(200);
    expect(csv.text).toContain('rusak_berat');
    expect(csv.text).toContain('Uji - Coba');
    await editor.delete(`${API}/tables/ruas-jalan/${id}`).expect(204);
    await editor.delete(`${API}/tables/ruas-jalan/${id}`).expect(404);
  });

  it('kondisi ruas SK ikut tabel survei: ambang 20% dari kelas terburuk, tanpa survei = Belum Disurvei', async () => {
    const f = (await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Sinkron - Uji' }, geometry: road }).expect(201)).body;
    const kondisi = async () => (await viewer.get(`${API}/features/${f.id}`).expect(200)).body.properties;
    const row = { kecamatan: 'Kalibawang', wilayah: 'Kalibawang II', tahun: 2025, ruas: 'Sinkron Uji', baik: 1, sedang: 0, rusakRingan: 0, rusakBerat: 1, perbaikan: 0 };
    const { id } = (await editor.post(`${API}/tables/ruas-jalan`).send(row).expect(201)).body;
    // Nama dicocokkan tanpa tanda baca/spasi; rusak berat 50% -> Rusak Berat.
    expect(await kondisi()).toMatchObject({ kondisi: 'Rusak Berat', baik_km: 1, rusak_berat_km: 1, tahun_survei: 2025 });
    // Kelas ikut tahun global: survei 2025 tidak berlaku untuk tahun 2024.
    expect((await viewer.get(`${API}/features/${f.id}?tahun=2024`).expect(200)).body.properties).toEqual({ nama_ruas: 'Sinkron - Uji', kondisi: 'Belum Disurvei' });
    const rb = async (tahun: number) => ((await viewer.get(`${API}/stats/layers/jalan-kabupaten?by=kondisi&tahun=${tahun}`).expect(200)).body as { key: string; count: number }[])
      .find((r) => r.key === 'Rusak Berat')?.count ?? 0;
    expect(await rb(2025)).toBe((await rb(2024)) + 1);
    // Atribut kondisi bawaan SHP diabaikan: kelas selalu dari tabel survei.
    await sql`UPDATE features SET properties = properties || '{"kondisi": "Baik", "baik_km": 9}'::jsonb WHERE id = ${f.id}`;
    expect(await kondisi()).toMatchObject({ kondisi: 'Rusak Berat', baik_km: 1 });
    // Baris survei melapor apakah namanya punya ruas SK (geometri di peta).
    const ruas = (await viewer.get(`${API}/stats/ruas-jalan`).expect(200)).body as { ruas: string; matched: boolean }[];
    expect(ruas.find((r) => r.ruas === 'Sinkron Uji')?.matched).toBe(true);
    expect(ruas.find((r) => r.ruas === 'Bendo - Bolon')?.matched).toBe(false);
    // Rusak berat 25% tetap Rusak Berat walau Baik terpanjang; 10% saja -> Baik.
    await editor.patch(`${API}/tables/ruas-jalan/${id}`).send({ baik: 3 }).expect(200);
    expect((await kondisi()).kondisi).toBe('Rusak Berat');
    await editor.patch(`${API}/tables/ruas-jalan/${id}`).send({ baik: 9 }).expect(200);
    expect((await kondisi()).kondisi).toBe('Baik');
    await editor.patch(`${API}/tables/ruas-jalan/${id}`).send({ rusakBerat: 0, rusakRingan: 3 }).expect(200);
    expect((await kondisi()).kondisi).toBe('Rusak Ringan');
    await editor.patch(`${API}/tables/ruas-jalan/${id}`).send({ rusakRingan: 0, sedang: 3 }).expect(200);
    expect((await kondisi()).kondisi).toBe('Sedang');
    await editor.delete(`${API}/tables/ruas-jalan/${id}`).expect(204);
    const after = await kondisi();
    expect(after.kondisi).toBe('Belum Disurvei');
    // Awalan "Jl." diabaikan dan ujung ruas boleh terbalik: "Jl. Balik - Ujung" (SHP) = "Ujung - Balik" (tabel).
    const g = (await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Jl. Balik - Ujung' }, geometry: road }).expect(201)).body;
    const rev = (await editor.post(`${API}/tables/ruas-jalan`).send({ ...row, ruas: 'Ujung - Balik', baik: 0, sedang: 2, rusakBerat: 0 }).expect(201)).body;
    expect((await viewer.get(`${API}/features/${g.id}`).expect(200)).body.properties.kondisi).toBe('Sedang');
    await editor.delete(`${API}/tables/ruas-jalan/${rev.id}`).expect(204);
    expect(after).not.toHaveProperty('baik_km');
  });
});

describe('search', () => {
  it('wilayah (kecamatan/kalurahan + bbox), fitur dengan atribut cocok, filter layer, kueri terlalu pendek', async () => {
    const res = await viewer.get(`${API}/search`).query({ q: 'wates' }).expect(200);
    expect(res.body.regions[0]).toMatchObject({ type: 'kecamatan', name: 'Wates' });
    expect(res.body.regions[0].bbox).toHaveLength(4);
    // Batas administrasi muncul sebagai wilayah, bukan fitur.
    expect(res.body.features.every((f: { slug: string }) => f.slug !== 'batas-administrasi')).toBe(true);

    const kal = await viewer.get(`${API}/search`).query({ q: 'bendung' }).expect(200);
    expect(kal.body.regions[0]).toMatchObject({ type: 'kalurahan', name: 'Bendungan', kecamatan: 'Wates' });

    const pl = await viewer.get(`${API}/search`).query({ q: 'tanaman pangan' }).expect(200);
    expect(pl.body.features[0]).toMatchObject({ slug: 'penggunaan-lahan', matchKey: 'pola_ruang', matchValue: 'Kawasan Tanaman Pangan' });
    expect(typeof pl.body.features[0].lng).toBe('number');

    const filtered = await viewer.get(`${API}/search`).query({ q: 'sawah', layer: 'utilitas-umum' }).expect(200);
    expect(filtered.body).toEqual({ regions: [], features: [] });
    // % dicari apa adanya, bukan wildcard.
    expect((await viewer.get(`${API}/search`).query({ q: '%%' }).expect(200)).body.features).toEqual([]);
    await viewer.get(`${API}/search`).query({ q: 'b' }).expect(400);
  });
});

describe('sinkron tahun', () => {
  it('atribut tahun dan Tahun Data selalu sama (Ringkasan membaca atribut)', async () => {
    const f = await editor.post(`${API}/layers/penduduk-miskin/features`)
      .send({ properties: { kecamatan: 'Wates', kalurahan: 'Bendungan', tahun: 2024, jumlah: 50 }, geometry: WATES, tahunData: 2030 }).expect(201);
    // INSERT: atribut per baris menang atas Tahun Data unggahan.
    expect(f.body).toMatchObject({ tahunData: 2024, properties: { tahun: 2024 } });
    const a = await editor.patch(`${API}/features/${f.body.id}`).send({ tahunData: 2026 }).expect(200);
    expect(a.body).toMatchObject({ tahunData: 2026, properties: { tahun: 2026 } });
    const b = await editor.patch(`${API}/features/${f.body.id}`).send({ properties: { tahun: 2025 } }).expect(200);
    expect(b.body).toMatchObject({ tahunData: 2025, properties: { tahun: 2025 } });
    await editor.delete(`${API}/features/${f.body.id}`).expect(204);
  });
});

describe('GET /alerts', () => {
  it('urgensi tinggi tampil sampai Diproses; Ditunda & Tidak Diproses tetap tampil', async () => {
    const f = (await editor.post(`${API}/layers/kawasan-strategis/features`).send({ properties: { nama: 'Uji Peringatan', jenis: 'SRS' }, geometry: WATES }).expect(201)).body;
    const ids = async () => ((await viewer.get(`${API}/alerts`).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids()).not.toContain(f.id);
    // Urgensi manual tinggi pada layer tanpa kondisi (catatan keputusan universal) memicu peringatan.
    await editor.patch(`${API}/features/${f.id}`).send({ properties: { urgensi: 'tinggi' } }).expect(200);
    expect(await ids()).toContain(f.id);
    await editor.patch(`${API}/features/${f.id}`).send({ properties: { keputusan: 'Ditunda', catatan_keputusan: 'Menunggu anggaran' } }).expect(200);
    expect(await ids()).toContain(f.id);
    await editor.patch(`${API}/features/${f.id}`).send({ properties: { keputusan: 'Tidak Diproses' } }).expect(200);
    expect(await ids()).toContain(f.id);
    await editor.patch(`${API}/features/${f.id}`).send({ properties: { keputusan: 'Diproses' } }).expect(200);
    expect(await ids()).not.toContain(f.id);
  });

  it('PJU berjenis lampu "Hilang" otomatis jadi peringatan tanpa urgensi manual', async () => {
    const pt = { type: 'Point', coordinates: [110.16, -7.86] };
    const ok = (await editor.post(`${API}/layers/pju/features`).send({ properties: { nama: 'PJU Uji 1', jenis_lampu: 'LED' }, geometry: pt }).expect(201)).body;
    const lost = (await editor.post(`${API}/layers/pju/features`).send({ properties: { nama: 'PJU Uji 2', jenis_lampu: 'Hilang' }, geometry: pt }).expect(201)).body;
    const items = (await viewer.get(`${API}/alerts`).expect(200)).body.items as { id: string; urgensi: string; kondisi: string }[];
    expect(items.find((i) => i.id === lost.id)).toMatchObject({ urgensi: 'tinggi', kondisi: 'Hilang' });
    expect(items.map((i) => i.id)).not.toContain(ok.id);
  });
});

describe('statistik keputusan wilayah', () => {
  const box = (x: number, y: number, d = 0.01) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });

  it('keterpaparan: titik sekolah di dalam zona Tinggi dihitung, di luar tidak', async () => {
    const banjir = async () => ((await viewer.get(`${API}/stats/exposure`).expect(200)).body as { jenis: string; sekolah: number }[])
      .find((r) => r.jenis === 'Banjir')?.sekolah ?? 0;
    const before = await banjir();
    await editor.post(`${API}/layers/potensi-bencana/features`).send({ properties: { jenis_bahaya: 'Banjir', kelas: 'Tinggi' }, geometry: box(110.3, -7.7) }).expect(201);
    await editor.post(`${API}/layers/utilitas-umum/features`).send({ properties: { nama: 'SD Dalam Zona', jenis: 'Pendidikan' }, geometry: { type: 'Point', coordinates: [110.305, -7.695] } }).expect(201);
    await editor.post(`${API}/layers/utilitas-umum/features`).send({ properties: { nama: 'SD Luar Zona', jenis: 'Pendidikan' }, geometry: { type: 'Point', coordinates: [110.32, -7.695] } }).expect(201);
    expect(await banjir()).toBe(before + 1);
  });

  it('keterpaparan per kecamatan: zona dipotong ke batas kecamatan (titik & panjang jalan hanya bagian dalam)', async () => {
    type Row = { jenis: string; sekolah: number; jalanKm: number };
    const tsunami = async (q = '') => ((await viewer.get(`${API}/stats/exposure${q}`).expect(200)).body as Row[]).find((r) => r.jenis === 'Tsunami');
    // Zona melintasi batas timur Wates (lon 110.2): separuh di dalam, separuh di luar.
    await editor.post(`${API}/layers/potensi-bencana/features`).send({ properties: { jenis_bahaya: 'Tsunami', kelas: 'Tinggi' }, geometry: box(110.19, -7.85, 0.02) }).expect(201);
    for (const [nama, x] of [['SD Tsunami Dalam', 110.195], ['SD Tsunami Luar', 110.205]] as const) {
      await editor.post(`${API}/layers/utilitas-umum/features`).send({ properties: { nama, jenis: 'Pendidikan' }, geometry: { type: 'Point', coordinates: [x, -7.845] } }).expect(201);
    }
    await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Ruas Uji Tsunami' }, geometry: { type: 'LineString', coordinates: [[110.185, -7.845], [110.215, -7.845]] } }).expect(201);
    const all = await tsunami();
    const wates = await tsunami('?kecamatan=Wates');
    expect(all).toMatchObject({ sekolah: 2 });
    expect(wates).toMatchObject({ sekolah: 1 });
    // ±2,2 km di seluruh zona, ±1,1 km di bagian Wates saja.
    expect(all!.jalanKm).toBeCloseTo(2.2, 0);
    expect(wates!.jalanKm).toBeCloseTo(1.1, 0);
  });

  it('keputusan Selesai (dengan anggaran & sumber dana): hilang dari peringatan', async () => {
    const f = (await editor.post(`${API}/layers/kawasan-strategis/features`).send({ properties: { nama: 'Uji Selesai', jenis: 'SRS' }, geometry: WATES }).expect(201)).body;
    await editor.patch(`${API}/features/${f.id}`).send({ properties: { urgensi: 'tinggi', keputusan: 'Selesai', anggaran: 1500000, sumber_dana: 'APBD Kabupaten' } }).expect(200);
    const alerts = (await viewer.get(`${API}/alerts`).expect(200)).body.items as { id: string }[];
    expect(alerts.map((i) => i.id)).not.toContain(f.id);
  });
});
