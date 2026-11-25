import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { syncAdminPassword } from '../src/db/seed.js';
import { SESSION_COOKIE } from '../src/middleware/auth.js';
import { API, app, createUser, env, loginAs, makeApp, PASSWORD, sql } from './helpers.js';

describe('env', () => {
  it('memakai default dan menolak secret pendek', () => {
    const e = parseEnv({ DATABASE_URL: 'postgres://u:p@h:5432/d', JWT_SECRET: 'x'.repeat(32) });
    expect(e).toMatchObject({ NODE_ENV: 'development', PORT: 4000, UPLOAD_DIR: 'uploads', TRUST_PROXY: 0 });
    expect(() => parseEnv({ DATABASE_URL: 'postgres://u:p@h/d', JWT_SECRET: 'pendek' })).toThrow();
    // SEED_ADMIN_PASSWORD kosong di .env = tidak ada akun terkelola; terisi tapi pendek = ditolak.
    const base = { DATABASE_URL: 'postgres://u:p@h/d', JWT_SECRET: 'x'.repeat(32) };
    expect(parseEnv({ ...base, SEED_ADMIN_PASSWORD: '' }).SEED_ADMIN_PASSWORD).toBeUndefined();
    expect(() => parseEnv({ ...base, SEED_ADMIN_PASSWORD: 'pendek' })).toThrow();
  });
});

describe('auth', () => {
  it('register membuat akun pending, lalu duplikat ditolak', async () => {
    const body = { name: 'Budi Santoso', email: 'Budi@Kulonprogo.go.id', password: 'Kunci-Rahasia-2026' };
    await request(app).post(`${API}/auth/register`).send(body).expect(201);
    const [u] = await sql`SELECT status, email FROM users WHERE email = 'budi@kulonprogo.go.id'`;
    expect(u).toMatchObject({ status: 'pending' });
    await request(app).post(`${API}/auth/register`).send(body).expect(409);
  });

  it('register menolak password yang memuat nama depan atau bagian lokal email', async () => {
    const res = await request(app).post(`${API}/auth/register`)
      .send({ name: 'Sulastri Wijaya', email: `${Date.now()}@test.id`, password: 'Sulastri#2026x' }).expect(400);
    expect(res.body.error).toBe('Password tidak boleh memuat nama atau email');
  });

  it('register memvalidasi input', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({ name: 'A', email: 'x', password: 'short' }).expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    const own = makeApp(); // percobaan gagal dihitung limiter /auth; app sendiri agar tak menguras kuota tes lain
    const weak = await request(own).post(`${API}/auth/register`)
      .send({ name: 'Siti', email: 'siti@test.id', password: 'kuncirahasia2026' }).expect(400);
    expect(weak.body.issues.map((i: { path: string }) => i.path)).toContain('password');
    await request(app).post(`${API}/auth/register`)
      .send({ name: 'Siti', email: 'siti@test.id', password: 'Kunci-Rahasia-2026' }).expect(201);
  });

  it('login menolak kredensial salah, akun pending dan ditolak', async () => {
    await request(app).post(`${API}/auth/login`).send({ email: 'tidak@ada.id', password: 'x' }).expect(401);
    const active = await createUser();
    await request(app).post(`${API}/auth/login`).send({ email: active.email, password: 'salah' }).expect(401);
    const pending = await createUser('viewer', 'pending');
    expect((await request(app).post(`${API}/auth/login`).send({ email: pending.email, password: PASSWORD }).expect(403)).body.error).toMatch(/menunggu/);
    const rejected = await createUser('viewer', 'rejected');
    expect((await request(app).post(`${API}/auth/login`).send({ email: rejected.email, password: PASSWORD }).expect(403)).body.error).toMatch(/ditolak/);
  });

  it('"Ingat saya" memberi cookie 30 hari; tanpa centang cookie sesi (tanpa Max-Age)', async () => {
    const own = makeApp();
    const user = await createUser();
    const cookie = async (remember?: boolean) =>
      String((await request(own).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD, remember }).expect(200)).headers['set-cookie']);
    expect(await cookie(true)).toContain('Max-Age=2592000');
    expect(await cookie(false)).not.toContain('Max-Age');
  });

  it('login sukses memberi cookie httpOnly, me dan logout bekerja', async () => {
    const { agent, email } = await loginAs('editor');
    const me = await agent.get(`${API}/auth/me`).expect(200);
    expect(me.body.user).toMatchObject({ email, role: 'editor' });
    const res = await agent.post(`${API}/auth/logout`).expect(204);
    expect(String(res.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    expect((await agent.get(`${API}/auth/me`).expect(200)).body).toEqual({ user: null }); // tamu: bukan 401 (tanpa galat konsol)
  });

  it('logout mencabut token di sisi server (token lama tak bisa dipakai lagi)', async () => {
    const own = makeApp(); // /me ke-401 dihitung limiter /auth; app sendiri agar tak menguras kuota tes lain
    const { email } = await createUser('editor');
    const login = await request(own).post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!; // token mentah, lepas dari agent
    await request(own).get(`${API}/auth/me`).set('Cookie', cookie).expect(200);
    await new Promise((r) => setTimeout(r, 1100)); // iat dalam detik; gerbang pakai <=, jadi tunggu lewat batas detik
    await request(own).post(`${API}/auth/logout`).set('Cookie', cookie).expect(204);
    expect((await request(own).get(`${API}/auth/me`).set('Cookie', cookie).expect(200)).body).toEqual({ user: null });
    await request(own).get(`${API}/layers/pju/features`).set('Cookie', cookie).expect(401); // endpoint lain tetap menolak
  });

  it('ubah akun sendiri: nama dan password (wajib password lama yang benar)', async () => {
    const { agent, email } = await loginAs('viewer');
    const upd = await agent.patch(`${API}/auth/me`).send({ name: 'Nama Baru' }).expect(200);
    expect(upd.body.user).toEqual({ id: expect.any(Number), name: 'Nama Baru', email, role: 'viewer' });
    expect((await agent.get(`${API}/auth/me`).expect(200)).body.user).toMatchObject({ name: 'Nama Baru', passwordManaged: false });
    await agent.patch(`${API}/auth/me`).send({ newPassword: 'Sandi#Baru-2026' }).expect(400);
    await agent.patch(`${API}/auth/me`).send({ currentPassword: 'salah', newPassword: 'Sandi#Baru-2026' }).expect(400);
    await agent.patch(`${API}/auth/me`).send({ role: 'superadmin' }).expect(200);
    expect((await agent.get(`${API}/auth/me`)).body.user.role).toBe('viewer');
    await agent.patch(`${API}/auth/me`).send({ currentPassword: PASSWORD, newPassword: 'Sandi#Baru-2026' }).expect(200);
    await request(app).post(`${API}/auth/login`).send({ email, password: 'Sandi#Baru-2026' }).expect(200);
  });

  it('ganti password mempertahankan jenis sesi: "Ingat saya" tetap 30 hari, sesi biasa tetap cookie sesi', async () => {
    const own = makeApp();
    for (const remember of [true, false]) {
      const user = await createUser();
      const agent = request.agent(own);
      await agent.post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD, remember }).expect(200);
      const res = await agent.patch(`${API}/auth/me`).send({ currentPassword: PASSWORD, newPassword: 'Sandi#Baru-2026' }).expect(200);
      const cookie = String(res.headers['set-cookie']);
      if (remember) expect(cookie).toContain('Max-Age=2592000');
      else expect(cookie).not.toContain('Max-Age');
    }
  });

  it('akun SEED_ADMIN_EMAIL: password dikelola .env, tak bisa diganti dari aplikasi', async () => {
    // Peran viewer: yang menentukan adalah email; superadmin di sini membuat seed (layers.test) melewati pembuatan admin.
    const user = await createUser();
    const managed = createApp({ sql, env: { ...env, SEED_ADMIN_EMAIL: user.email, SEED_ADMIN_PASSWORD: PASSWORD }, log: () => undefined });
    const agent = request.agent(managed);
    await agent.post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD }).expect(200);
    expect((await agent.get(`${API}/auth/me`).expect(200)).body.user.passwordManaged).toBe(true);
    const res = await agent.patch(`${API}/auth/me`).send({ currentPassword: PASSWORD, newPassword: 'Sandi#Baru-2026' }).expect(400);
    expect(res.body.error).toMatch(/SEED_ADMIN_PASSWORD/);
    await agent.patch(`${API}/auth/me`).send({ name: 'Admin Baru' }).expect(200); // profil tetap bisa diubah
  });

  it('syncAdminPassword menulis hash hanya bila berbeda (restart tak mencabut sesi)', async () => {
    const user = await createUser();
    const changedAt = async () => (await sql<{ t: Date | null }[]>`SELECT password_changed_at AS t FROM users WHERE id = ${user.id}`)[0]!.t;
    expect(await syncAdminPassword(sql, { email: user.email.toUpperCase(), password: PASSWORD })).toBe('same');
    expect(await changedAt()).toBeNull();
    expect(await syncAdminPassword(sql, { email: user.email, password: 'Sandi#Baru-2026' })).toBe('updated');
    expect(await changedAt()).not.toBeNull();
    await request(makeApp()).post(`${API}/auth/login`).send({ email: user.email, password: 'Sandi#Baru-2026' }).expect(200);
    expect(await syncAdminPassword(sql, { email: 'tidak@ada.id', password: PASSWORD })).toBe('missing');
  });

  it('ganti password mencabut sesi lama, sesi yang mengganti tetap aktif', async () => {
    const own = makeApp(); // limiter /auth sendiri: app bersama sudah terisi percobaan gagal tes lain
    const { agent, id } = await loginAs('viewer', own);
    // Sesi lain (perangkat lain) yang terbit 10 detik sebelumnya.
    const old = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(id))
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10).setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    await request(own).get(`${API}/auth/me`).set('Cookie', `${SESSION_COOKIE}=${old}`).expect(200);
    await agent.patch(`${API}/auth/me`).send({ currentPassword: PASSWORD, newPassword: 'Sandi#Baru-2026' }).expect(200);
    expect((await request(own).get(`${API}/auth/me`).set('Cookie', `${SESSION_COOKIE}=${old}`).expect(200)).body).toEqual({ user: null });
    await request(own).get(`${API}/layers/pju/features`).set('Cookie', `${SESSION_COOKIE}=${old}`).expect(401);
    expect((await agent.get(`${API}/auth/me`).expect(200)).body.user).not.toBeNull();
  });

  it('rate limiter registrasi menghitung pendaftaran sukses', async () => {
    const limited = makeApp({ register: 1 });
    const body = { name: 'Rina Lestari', email: `${Date.now()}@test.id`, password: 'Kunci-Rahasia-2026' };
    await request(limited).post(`${API}/auth/register`).send(body).expect(201);
    await request(limited).post(`${API}/auth/register`).send({ ...body, email: `b${body.email}` }).expect(429);
  });

  it('cookie secure di production', async () => {
    const prodApp = createApp({ sql, env: { ...env, NODE_ENV: 'production' }, log: () => undefined });
    const user = await createUser();
    const res = await request(prodApp).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD }).expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/);
  });

  it('token tidak valid / user nonaktif ditolak', async () => {
    await request(app).get(`${API}/layers`).expect(401);
    await request(app).get(`${API}/layers`).set('Cookie', `${SESSION_COOKIE}=palsu`).expect(401);
    const user = await createUser('viewer', 'rejected');
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(user.id))
      .setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    await request(app).get(`${API}/layers`).set('Cookie', `${SESSION_COOKIE}=${token}`).expect(401);
  });

  it('rate limiter auth hanya menghitung percobaan gagal', async () => {
    const limited = makeApp({ auth: 2 });
    const user = await createUser();
    await request(limited).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD }).expect(200);
    await request(limited).post(`${API}/auth/login`).send({ email: user.email, password: 'x' }).expect(401);
    await request(limited).post(`${API}/auth/login`).send({ email: user.email, password: 'x' }).expect(401);
    const res = await request(limited).post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD }).expect(429);
    expect(res.body.error).toMatch(/Terlalu banyak/);
  });

  it('rate limiter login per email, terpisah dari limit per IP', async () => {
    const limited = makeApp({ loginEmail: 2 });
    const [a, b] = [await createUser(), await createUser()];
    await request(limited).post(`${API}/auth/login`).send({ email: a.email.toUpperCase(), password: 'x' }).expect(401);
    await request(limited).post(`${API}/auth/login`).send({ email: a.email, password: 'x' }).expect(401);
    const res = await request(limited).post(`${API}/auth/login`).send({ email: a.email, password: PASSWORD }).expect(429);
    expect(res.body.error).toMatch(/Terlalu banyak/);
    await request(limited).post(`${API}/auth/login`).send({ email: b.email, password: 'x' }).expect(401);
    // Tanpa body: kunci "undefined", tetap ditolak validasi.
    await request(limited).post(`${API}/auth/login`).expect(400);
  });

  it('rate limiter global', async () => {
    const limited = makeApp({ global: 1 });
    await request(limited).get(`${API}/health`).expect(200, { status: 'ok' });
    await request(limited).get(`${API}/health`).expect(429);
  });

  it('404, JSON rusak, dan header keamanan', async () => {
    const res = await request(app).get('/tidak-ada').expect(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await request(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{rusak').expect(400);
  });
});
