import shpwrite from '@mapbox/shp-write';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDb, type Sql } from '../src/db/client.js';
import { writeArrayBuffer } from 'geotiff';
import { run } from '../src/db/inarisk.js';
import { parseLpju, parseRuasSk } from '../src/db/parse.js';
import { API, createUser, env, loginAs, PASSWORD, sql, WATES } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
let editor: Agent;
let viewer: Agent;
const road = { type: 'LineString' as const, coordinates: [[110.12, -7.85], [110.18, -7.85]] };

beforeAll(async () => {
  editor = (await loginAs('editor')).agent;
  viewer = (await loginAs('viewer')).agent;
});
// DB tes dipakai bersama semua file (berurutan): data uji di sini dihapus agar hitungan tes lain tidak berubah.
afterAll(async () => {
  await sql`DELETE FROM features WHERE properties->>'kalurahan' = 'Gapsatu' OR properties->>'nama' = 'G1'
    OR properties->>'nama_ruas' IN ('Gap - Uji', 'Sk - Mentah') OR properties->>'kecamatan' = 'UjiBencana'
    OR layer_id = (SELECT id FROM layers WHERE slug = 'potensi-bencana')`;
  await sql`DELETE FROM ruas_jalan WHERE ruas = 'Gap Tabel'`;
});

describe('parse: kolom DBF kosong', () => {
  it('LPJU tanpa jenis lampu; ruas SK tanpa kapanewon/nomor', () => {
    expect(parseLpju({}).jenis_lampu).toBe('Tidak Tercatat');
    expect(parseRuasSk({})).toMatchObject({ nomor_ruas: null, kapanewon: null, kecamatan: null, nama_ruas: null, fungsi: null });
    expect(parseRuasSk({ Nomor_Ruas: 'x' }).nomor_ruas).toBeNull();
  });
});

describe('auth /me', () => {
  it('galat database saat memeriksa sesi = 500, bukan dianggap tamu', async () => {
    const { email } = await createUser('viewer');
    const login = await request(createApp({ sql, env, log: () => undefined })).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const dead = createDb('postgres://x:y@127.0.0.1:1/none', 1);
    await request(createApp({ sql: dead, env, log: () => undefined })).get(`${API}/auth/me`).set('Cookie', cookie).expect(500);
    await dead.end();
  });
});

describe('stats & tabel ruas: cabang filter', () => {
  it('sum, where tanpa eq, kecamatan + sum; batas kabupaten', async () => {
    await editor.post(`${API}/layers/batas-administrasi/features`).send({ properties: { kecamatan: 'Wates', kalurahan: 'Gapsatu' }, geometry: WATES }).expect(201);
    await editor.post(`${API}/layers/pju/features`).send({ properties: { nama: 'G1', jenis_lampu: 'LED', daya_watt: 60 }, geometry: { type: 'Point', coordinates: [110.15, -7.85] } }).expect(201);
    const total = (await viewer.get(`${API}/stats/layers/pju?by=nama&sum=daya_watt`).expect(200)).body;
    expect(total.find((r: { key: string }) => r.key === 'G1').value).toBe(60);
    // where tanpa eq diabaikan (tidak menyaring).
    const noEq = (await viewer.get(`${API}/stats/layers/pju?by=nama&where=nama`).expect(200)).body;
    expect(noEq.some((r: { key: string }) => r.key === 'G1')).toBe(true);
    // where + eq: hanya fitur yang cocok.
    expect((await viewer.get(`${API}/stats/layers/pju?by=nama&where=nama&eq=G1`).expect(200)).body).toEqual([expect.objectContaining({ key: 'G1', count: 1 })]);
    // eq tanpa where juga diabaikan.
    const noWhere = (await viewer.get(`${API}/stats/layers/pju?by=nama&eq=tidak-ada`).expect(200)).body;
    expect(noWhere.some((r: { key: string }) => r.key === 'G1')).toBe(true);
    const clipped = (await viewer.get(`${API}/stats/layers/pju?by=nama&sum=daya_watt&kecamatan=Wates`).expect(200)).body;
    expect(clipped.find((r: { key: string }) => r.key === 'G1').value).toBe(60);
    const batas = await viewer.get(`${API}/stats/batas-kabupaten`).expect(200);
    expect(batas.headers['cache-control']).toContain('max-age=86400');
    expect(['Polygon', 'MultiPolygon']).toContain(batas.body.type);
  });

  it('ruas SK tanpa tahun (survei terakhir); daftar per kecamatan; PATCH kosong & id tak ada', async () => {
    await editor.post(`${API}/layers/jalan-kabupaten/features`).send({ properties: { nama_ruas: 'Gap - Uji', panjang_km: 2 }, geometry: road }).expect(201);
    const jalan = (await viewer.get(`${API}/stats/layers/jalan-kabupaten?sum=panjang_km`).expect(200)).body;
    expect(jalan.some((r: { value: number }) => r.value >= 2)).toBe(true);
    await sql`INSERT INTO ruas_jalan (kecamatan, wilayah, tahun, ruas, baik) VALUES ('Galur', 'Galur I', 2023, 'Gap Tabel', 1)`;
    const list = (await viewer.get(`${API}/tables/ruas-jalan?kecamatan=galur`).expect(200)).body;
    expect(list.map((r: { ruas: string }) => r.ruas)).toContain('Gap Tabel');
    await editor.patch(`${API}/tables/ruas-jalan/1`).send({}).expect(400);
    await editor.patch(`${API}/tables/ruas-jalan/999999`).send({ baik: 1 }).expect(404);
  });
});

describe('upload SHP SK jalan mentah', () => {
  it('kolom Nama_Ruas/Kapanewon/Panjang dipetakan ke atribut layer', async () => {
    const geojson = { type: 'FeatureCollection' as const, features: [
      { type: 'Feature' as const, properties: { Nama_Ruas: 'Sk - Mentah', Nomor_Ruas: 7, Sub_Ruas: 1, Kapanewon: '901 Wates', Panjang: 1.5 }, geometry: road },
    ] };
    const zip = Buffer.from(await shpwrite.zip(geojson, { outputType: 'nodebuffer' } as never) as unknown as ArrayBuffer);
    const res = await editor.post(`${API}/layers/jalan-kabupaten/upload?mode=append&dryRun=true`).attach('file', zip, 'jalan.zip').expect(200);
    expect(res.body).toBeTruthy();
    await editor.post(`${API}/layers/jalan-kabupaten/upload?mode=append`).attach('file', zip, 'jalan.zip').expect(201);
    const [f] = await sql<{ p: Record<string, unknown> }[]>`SELECT properties AS p FROM features WHERE properties->>'nama_ruas' = 'Sk - Mentah'`;
    expect(f!.p).toMatchObject({ nomor_ruas: '7.1', kapanewon: 'Wates', kecamatan: 'Wates', panjang_km: 1.5 });
  });
});

describe('inarisk: unduh raster BNPB lalu tulis zona potensi-bencana', () => {
  const KEC = 'UjiBencana';
  // Kalurahan uji di atas kotak raster 4×4 piksel 0,005° (110.10–110.12 × -7.92–-7.90).
  const box = [[[110.1, -7.92], [110.12, -7.92], [110.12, -7.9], [110.1, -7.9], [110.1, -7.92]]];
  /** GeoTIFF float 4×4: kiri Rendah, tengah Sedang, kanan Tinggi; satu piksel tanpa data. */
  const tiff = () => writeArrayBuffer(new Float32Array([0.1, 0.5, 0.9, 0.9, 0.1, 0.5, 0.9, 0.9, 0.1, -1, 0.9, 0.9, 0.1, 0.5, 0.9, 0.9]), {
    width: 4, height: 4, ModelPixelScale: [0.005, 0.005, 0], ModelTiepoint: [0, 0, 0, 110.1, -7.9, 0],
    GeographicTypeGeoKey: 4326, GTModelTypeGeoKey: 2, SampleFormat: [3], BitsPerSample: [32],
  } as never);

  it('batas administrasi kosong ditolak', async () => {
    const empty = Object.assign(async () => [{ b: null }], { unsafe: () => '' }) as unknown as Sql;
    await expect(run(empty)).rejects.toThrow(/batas-administrasi kosong/);
  });

  it('raster diunduh (HTTP gagal dicoba ulang), dijadikan zona per kelas, menggantikan fitur lama', async () => {
    await editor.post(`${API}/layers/batas-administrasi/features`).send({ properties: { kecamatan: KEC, kalurahan: 'K0' }, geometry: { type: 'Polygon', coordinates: box } }).expect(201);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let failedOnce = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('layer_bahaya_banjir') && !failedOnce) { failedOnce = true; return new Response('', { status: 502 }); }
      return new Response(tiff());
    });
    await run(sql);
    vi.restoreAllMocks();
    const rows = await sql<{ p: Record<string, unknown> }[]>`
      SELECT f.properties AS p FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = 'potensi-bencana'
      WHERE f.properties->>'kecamatan' = ${KEC} AND f.properties->>'jenis_bahaya' = 'Banjir' ORDER BY f.properties->>'kelas'`;
    expect(rows.map((r) => r.p.kelas)).toEqual(['Rendah', 'Sedang', 'Tinggi']);
    expect(rows[0]!.p).toMatchObject({ kalurahan: 'K0', sumber: 'InaRISK BNPB', luas_ha: expect.any(Number) });
    expect(failedOnce).toBe(true);
  }, 30_000);

  it('BNPB gagal terus: dilaporkan dengan nama layanan, database tidak berubah', async () => {
    const before = await sql`SELECT count(*)::int AS n FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = 'potensi-bencana'`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 500 }));
    await expect(run(sql)).rejects.toThrow(/layer_bahaya_banjir: HTTP 500/);
    expect(fetchMock.mock.calls.length).toBe(3);
    vi.restoreAllMocks();
    expect(await sql`SELECT count(*)::int AS n FROM features f JOIN layers l ON l.id = f.layer_id AND l.slug = 'potensi-bencana'`).toEqual(before);
  }, 30_000);
});
