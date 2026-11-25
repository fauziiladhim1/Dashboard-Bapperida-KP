import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, loginAs, sql } from './helpers.js';

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
let admin: Agent;
let editor: Agent;
let original: Record<string, object>;

beforeAll(async () => {
  admin = (await loginAs('superadmin')).agent;
  editor = (await loginAs('editor')).agent;
  original = (await editor.get(`${API}/settings`).expect(200)).body;
});
// Pengaturan dipakai bersama tes lain: kembalikan nilai awal.
afterAll(async () => {
  for (const [k, v] of Object.entries(original)) await admin.put(`${API}/settings/${k}`).send(v).expect(200);
});

describe('pengaturan (DB)', () => {
  it('terbaca semua kunci; hanya superadmin boleh mengubah; regex tidak sah ditolak', async () => {
    expect(Object.keys(original).sort()).toEqual(['keputusan', 'keterpaparan', 'urgensi']);
    await editor.put(`${API}/settings/urgensi`).send(original.urgensi).expect(403);
    await admin.put(`${API}/settings/urgensi`).send({ ...(original.urgensi as object), abaikan: '(' }).expect(400);
    await admin.put(`${API}/settings/tidak-ada`).send({}).expect(404);
  });

  it('aturan urgensi dari DB menentukan peringatan: aturan diubah, peringatan ikut berubah tanpa ubah kode', async () => {
    const f = (await editor.post(`${API}/layers/utilitas-umum/features`).send({ properties: { nama: 'Pustu Uji', jenis: 'Kesehatan', kondisi: 'Baik' }, geometry: { type: 'Point', coordinates: [110.15, -7.85] } }).expect(201)).body;
    const ids = async () => ((await editor.get(`${API}/alerts`).expect(200)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids()).not.toContain(f.id);
    const u = original.urgensi as { abaikan: string; aturan: { field: string; tinggi: string }[] };
    await admin.put(`${API}/settings/urgensi`).send({ ...u, aturan: u.aturan.map((a) => (a.field === 'kondisi' ? { ...a, tinggi: `${a.tinggi}|^baik$` } : a)) }).expect(200);
    expect(await ids()).toContain(f.id);
  });

  it('pola sah di JS tetapi tidak di PostgreSQL ditolak; sedang null diterima', async () => {
    const u = (await admin.get(`${API}/settings`).expect(200)).body.urgensi as { abaikan: string; aturan: { sedang: string | null }[] };
    await admin.put(`${API}/settings/urgensi`).send({ ...u, abaikan: '(?<x>a)' }).expect(400);
    await admin.put(`${API}/settings/urgensi`).send({ ...u, aturan: u.aturan.map((a) => ({ ...a, sedang: null })) }).expect(200);
    await admin.put(`${API}/settings/urgensi`).send(u).expect(200);
  });

  it('baris pengaturan hilang: dibaca -> 500, diubah -> 404', async () => {
    const [row] = await sql<{ value: object }[]>`DELETE FROM pengaturan WHERE key = 'keterpaparan' RETURNING value`;
    try {
      await editor.get(`${API}/stats/exposure`).expect(500);
      await admin.put(`${API}/settings/keterpaparan`).send(row!.value).expect(404);
    } finally {
      await sql`INSERT INTO pengaturan (key, value) VALUES ('keterpaparan', ${sql.json(row!.value as never)})`;
    }
  });
});
