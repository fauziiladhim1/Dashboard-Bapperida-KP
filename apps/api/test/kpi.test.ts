import { beforeAll, describe, expect, it } from 'vitest';
import { API, loginAs, sql, WATES } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
let editor: Agent;
let viewer: Agent;

const miskin = { label: 'Miskin Wates', layerSlug: 'penduduk-miskin', measure: 'sum', sumField: 'jumlah', byField: 'kalurahan', whereField: 'kecamatan', whereEq: 'Wates', unit: 'jiwa', warn: true, chart: 'donut' };

beforeAll(async () => {
  editor = (await loginAs('editor')).agent;
  viewer = (await loginAs('viewer')).agent;
  // Atribut di luar isian form (`catatan`) tetap dikenal bila ada di data.
  await editor.post(`${API}/layers/penduduk-miskin/features`)
    .send({ properties: { kecamatan: 'Wates', kalurahan: 'Bendungan', tahun: 2025, jumlah: 120, catatan: 'x' }, geometry: WATES }).expect(201);
});

describe('KPI kustom', () => {
  it('CRUD oleh editor, viewer hanya membaca, tercatat di audit', async () => {
    const created = await editor.post(`${API}/kpi`).send(miskin).expect(201);
    expect(created.body).toMatchObject({ label: 'Miskin Wates', measure: 'sum', sumField: 'jumlah', whereEq: 'Wates', warn: true, chart: 'donut', sortOrder: 100 });
    const id = created.body.id;

    expect((await viewer.get(`${API}/kpi`).expect(200)).body.map((k: { id: number }) => k.id)).toContain(id);
    await viewer.post(`${API}/kpi`).send(miskin).expect(403);
    await viewer.delete(`${API}/kpi/${id}`).expect(403);

    // Ganti ke hitung fitur: sum_field & filter tanpa nilai dikosongkan, atribut di luar form diterima.
    const upd = await editor.patch(`${API}/kpi/${id}`).send({ ...miskin, measure: 'count', whereEq: '', byField: 'catatan', unit: '' }).expect(200);
    expect(upd.body).toMatchObject({ measure: 'count', sumField: null, whereField: null, whereEq: null, byField: 'catatan', unit: null });
    await editor.patch(`${API}/kpi/999999`).send(miskin).expect(404);

    const [log] = await sql`SELECT action FROM audit_logs WHERE entity = 'kpi' AND entity_id = ${String(id)} ORDER BY id DESC LIMIT 1`;
    expect(log!.action).toBe('update');
    await editor.delete(`${API}/kpi/${id}`).expect(204);
    await editor.delete(`${API}/kpi/${id}`).expect(404);
  });

  it('format dua grafik (kartu Penduduk Miskin): rincian kedua & bentuknya tersimpan; atribut tak dikenal ditolak', async () => {
    const hero = { label: 'Miskin', layerSlug: 'penduduk-miskin', measure: 'sum', sumField: 'jumlah', byField: 'kecamatan', by2Field: 'tahun', chart: 'bar', topN: 5 };
    const created = await editor.post(`${API}/kpi`).send(hero).expect(201);
    expect(created.body).toMatchObject({ byField: 'kecamatan', by2Field: 'tahun', chart2: 'line' });
    const upd = await editor.patch(`${API}/kpi/${created.body.id}`).send({ ...hero, chart2: 'bar' }).expect(200);
    expect(upd.body.chart2).toBe('bar');
    expect((await editor.patch(`${API}/kpi/${created.body.id}`).send({ ...hero, by2Field: '' }).expect(200)).body.by2Field).toBeNull();
    await editor.post(`${API}/kpi`).send({ ...hero, by2Field: 'tidak_ada' }).expect(400);
    await editor.post(`${API}/kpi`).send({ ...hero, chart2: 'donut' }).expect(400);
    await editor.delete(`${API}/kpi/${created.body.id}`).expect(204);
  });

  it('menolak resep yang tak bisa dihitung', async () => {
    const err = async (body: object, status = 400) => (await editor.post(`${API}/kpi`).send({ ...miskin, ...body }).expect(status)).body;
    expect((await err({ sumField: null })).issues[0].path).toBe('sumField');
    expect((await err({ byField: 'tidak_ada' })).error).toMatch(/Atribut tidak dikenal.*tidak_ada/);
    expect((await err({ sumField: 'kecamatan' })).error).toMatch(/bukan atribut angka/);
    await err({ layerSlug: 'tidak-ada' }, 404);
    // Field kelas layer (PJU: jenis_lampu) dikenal walau layer belum berisi data.
    const pju = await editor.post(`${API}/kpi`).send({ label: 'PJU', layerSlug: 'pju', measure: 'count', byField: 'jenis_lampu' }).expect(201);
    await editor.delete(`${API}/kpi/${pju.body.id}`).expect(204);
    const plain = await editor.post(`${API}/kpi`).send({ label: 'PJU total', layerSlug: 'pju', measure: 'count', byField: '' }).expect(201);
    expect(plain.body.byField).toBeNull();
    await editor.delete(`${API}/kpi/${plain.body.id}`).expect(204);
  });
});

describe('KPI agregasi ala Tableau', () => {
  it('AVG/MIN/MAX atribut angka, urutan & Top N tersimpan; agregasi tanpa atribut ditolak', async () => {
    const q = (agg: string) => editor.get(`${API}/stats/layers/penduduk-miskin?sum=jumlah&agg=${agg}&by=kecamatan&tahun=2025`).expect(200);
    const wates = async (agg: string) => (await q(agg)).body.find((r: { key: string }) => r.key === 'Wates')?.value as number;
    const [avg, min, max] = [await wates('avg'), await wates('min'), await wates('max')];
    expect(min).toBeLessThanOrEqual(avg);
    expect(avg).toBeLessThanOrEqual(max);
    await editor.get(`${API}/stats/layers/penduduk-miskin?sum=jumlah&agg=drop`).expect(400);
    // nogroup: satu baris (AVG keseluruhan), tidak dikelompokkan per kategori.
    const all = (await editor.get(`${API}/stats/layers/penduduk-miskin?sum=jumlah&agg=avg&by=kecamatan&nogroup=1&tahun=2025`).expect(200)).body;
    expect(all).toHaveLength(1);
    expect(all[0].key).toBeNull();
    const k = await editor.post(`${API}/kpi`).send({ ...miskin, measure: 'avg', sort: 'label', topN: 5 }).expect(201);
    expect(k.body).toMatchObject({ measure: 'avg', sumField: 'jumlah', sort: 'label', topN: 5 });
    await editor.post(`${API}/kpi`).send({ ...miskin, measure: 'max', sumField: null }).expect(400);
    await editor.post(`${API}/kpi`).send({ ...miskin, topN: 0 }).expect(400);
    await editor.delete(`${API}/kpi/${k.body.id}`).expect(204);
  });
});

describe('tata letak Ringkasan', () => {
  it('viewer membaca, editor menyimpan urutan/lebar/sembunyi, kunci asing & ganda ditolak', async () => {
    // Belum pernah disimpan (tanpa baris) = susunan bawaan.
    await sql`DELETE FROM ringkasan_layout`;
    expect((await viewer.get(`${API}/kpi/layout`).expect(200)).body).toEqual({ cards: [] });
    await editor.put(`${API}/kpi/layout`).send({ cards: [] }).expect(200);
    expect((await viewer.get(`${API}/kpi/layout`).expect(200)).body).toEqual({ cards: [] });
    const cards = [{ key: 'trend', span: 12, hidden: false }, { key: 'kpi:7', span: 6, hidden: true }, { key: 'hero', span: 8, hidden: false }, { key: 'exposure', span: 12, hidden: false }];
    await viewer.put(`${API}/kpi/layout`).send({ cards }).expect(403);
    await editor.put(`${API}/kpi/layout`).send({ cards }).expect(200);
    expect((await viewer.get(`${API}/kpi/layout`).expect(200)).body.cards).toEqual(cards);
    await editor.put(`${API}/kpi/layout`).send({ cards: [{ key: 'drop table', span: 4 }] }).expect(400);
    await editor.put(`${API}/kpi/layout`).send({ cards: [cards[0], cards[0]] }).expect(400);
    await editor.put(`${API}/kpi/layout`).send({ cards: [{ key: 'hero', span: 3 }] }).expect(400);
    // Tampilan kartu: judul/catatan/ikon/warna tersimpan; ikon hanya nama ikon atau PNG base64 (bukan SVG/URL).
    const styled = [{ key: 'pju', span: 4, hidden: false, title: 'Lampu jalan', note: 'Sumber: Dishub', icon: 'g:Bulb', tone: 'warning', foot: 'Data per Desember' },
      { key: 'hazard', span: 5, hidden: false, footOff: true, sub: '{jenis}: {pct} wilayah', arrange: 'stack' },
      { key: 'util', span: 4, hidden: false, icon: 'data:image/png;base64,iVBORw0KGgo=', tone: '#2563EB' }];
    await editor.put(`${API}/kpi/layout`).send({ cards: styled }).expect(200);
    expect((await viewer.get(`${API}/kpi/layout`).expect(200)).body.cards).toEqual(styled);
    await editor.put(`${API}/kpi/layout`).send({ cards: [{ key: 'pju', span: 4, icon: 'data:image/svg+xml;base64,PHN2Zz4=' }] }).expect(400);
    await editor.put(`${API}/kpi/layout`).send({ cards: [{ key: 'pju', span: 4, icon: 'https://evil.example/x.png' }] }).expect(400);
    await editor.put(`${API}/kpi/layout`).send({ cards: [{ key: 'pju', span: 4, tone: 'pink' }] }).expect(400);
    await editor.put(`${API}/kpi/layout`).send({ cards: [] }).expect(200);
  });
});

describe('statistik layer multi-tahun', () => {
  it('`tahun` menyaring atribut tahun: data tahun terakhir <= tahun (KPI kustom ikut pemilih tahun global)', async () => {
    const q = (tahun: number, kec = '') => editor.get(`${API}/stats/layers/penduduk-miskin?sum=jumlah&by=kecamatan&tahun=${tahun}${kec}`).expect(200);
    expect((await q(2025)).body.find((r: { key: string }) => r.key === 'Wates')?.value).toBeGreaterThanOrEqual(120);
    expect((await q(2001)).body).toEqual([]);
    // Tahun tanpa data: tahun data terakhir sebelumnya, seperti kartu Penduduk Miskin bawaan.
    const later = (await q(2099)).body;
    expect(later.length).toBeGreaterThan(0);
    expect(later).toEqual((await q(2098)).body);
    expect((await q(2001, '&kecamatan=Wates')).body).toEqual([]);
  });
});
