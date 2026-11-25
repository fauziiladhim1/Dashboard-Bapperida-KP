import { hash, verify } from '@node-rs/argon2';
import { Router, type RequestHandler } from 'express';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError } from '../lib/http.js';
import { REMEMBER_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '../middleware/auth.js';
import { audit } from './audit.js';

const email = z.email('Email tidak valid').max(254).transform((e) => e.toLowerCase());

/** Aturan password (dicerminkan `RULES` di AuthPage): >= 12 karakter, huruf besar + kecil, angka, simbol. */
const password = z.string().min(12, 'Password minimal 12 karakter').max(128)
  .regex(/[a-z]/, 'Password harus mengandung huruf kecil').regex(/[A-Z]/, 'Password harus mengandung huruf besar')
  .regex(/\d/, 'Password harus mengandung angka').regex(/[^A-Za-z0-9]/, 'Password harus mengandung simbol');

export const registerSchema = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120),
  email,
  password,
});

const loginSchema = z.object({ email, password: z.string().min(1).max(128), remember: z.boolean().optional() });

/** Ubah akun sendiri: email & peran tidak bisa diubah di sini; ganti password wajib menyertakan password lama. */
const updateMeSchema = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(120).optional(),
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: password.optional(),
}).refine((b) => !b.newPassword || b.currentPassword, { message: 'Isi password lama', path: ['currentPassword'] });

// Hash dummy agar waktu respons login sama untuk email terdaftar/tidak (mencegah enumerasi akun).
const DUMMY_HASH = hash('dummy-password-for-timing');

type Deps = { sql: Sql; secret: string; secure: boolean; requireAuth: RequestHandler;
  /** Email akun yang passwordnya dikelola SEED_ADMIN_PASSWORD di .env (disinkronkan tiap start): tak bisa diganti dari aplikasi. */
  managedEmail?: string };

export const authRouter = ({ sql, secret, secure, requireAuth, managedEmail }: Deps): Router => {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' } as const;
  const isManaged = (mail: string) => !!managedEmail && mail.toLowerCase() === managedEmail;
  /** "Ingat saya": JWT 30 hari dalam cookie yang bertahan setelah browser ditutup; selain itu JWT 8 jam dalam cookie sesi. */
  const setSession = async (res: Parameters<RequestHandler>[1], id: number, remember: boolean) => {
    if (remember) res.cookie(SESSION_COOKIE, await signSession(id, secret, REMEMBER_TTL_SECONDS), { ...cookieOptions, maxAge: REMEMBER_TTL_SECONDS * 1000 });
    else res.cookie(SESSION_COOKIE, await signSession(id, secret), cookieOptions);
  };

  router.post('/register', async (req, res) => {
    const body = registerSchema.parse(req.body);
    // Password tidak boleh memuat bagian lokal email atau nama depan (>= 3 huruf): mudah ditebak.
    const pw = body.password.toLowerCase();
    const personal = [body.email.split('@')[0]!, body.name.split(/\s+/)[0]!.toLowerCase()].filter((w) => w.length >= 3);
    if (personal.some((w) => pw.includes(w))) throw new HttpError(400, 'Password tidak boleh memuat nama atau email');
    const [user] = await sql<{ id: number }[]>`
      INSERT INTO users (name, email, password_hash)
      VALUES (${body.name}, ${body.email}, ${await hash(body.password)}) RETURNING id`;
    await audit(sql, req, 'register', 'user', user!.id);
    res.status(201).json({ message: 'Pendaftaran berhasil. Akun menunggu persetujuan superadmin.' });
  });

  router.post('/login', async (req, res) => {
    const { email: mail, password, remember } = loginSchema.parse(req.body);
    const [user] = await sql<{ id: number; name: string; email: string; role: string; status: string; passwordHash: string }[]>`
      SELECT id, name, email, role, status, password_hash FROM users WHERE lower(email) = ${mail}`;
    const valid = await verify(user?.passwordHash ?? (await DUMMY_HASH), password);
    if (!user || !valid) throw new HttpError(401, 'Email atau password salah');
    if (user.status === 'pending') throw new HttpError(403, 'Akun menunggu persetujuan superadmin');
    if (user.status === 'rejected') throw new HttpError(403, 'Pendaftaran akun ditolak');
    await setSession(res, user.id, !!remember);
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role as 'viewer' };
    await audit(sql, req, 'login', 'user', user.id);
    res.json({ user: req.user });
  });

  // Logout mencabut token di sisi server lewat gerbang yang sama dengan ganti password (requireAuth menolak JWT
  // terbit sebelum `password_changed_at`): sekadar menghapus cookie tidak mencegah token yang terlanjur dicuri dipakai.
  // ponytail: menandai per-pengguna, jadi logout mencabut semua sesi pengguna itu; jti denylist bila butuh per-perangkat.
  router.post('/logout', requireAuth, async (req, res) => {
    await sql`UPDATE users SET password_changed_at = now() WHERE id = ${req.user!.id}`;
    res.clearCookie(SESSION_COOKIE, { path: '/' }).status(204).end();
  });

  // Tamu/sesi kedaluwarsa = 200 { user: null }, bukan 401: halaman login memanggil ini di setiap muat,
  // dan 401 tercatat sebagai galat konsol (Lighthouse Best Practices). Endpoint lain tetap 401.
  router.get('/me', async (req, res) => {
    const authed = await new Promise<boolean>((resolve, reject) => {
      Promise.resolve(requireAuth(req, res, () => resolve(true))).catch((e: unknown) =>
        e instanceof HttpError && e.status === 401 ? resolve(false) : reject(e));
    });
    if (!authed) return void res.json({ user: null });
    const [user] = await sql<{ email: string }[]>`SELECT id, name, email, role FROM users WHERE id = ${req.user!.id}`;
    res.json({ user: { ...user!, passwordManaged: isManaged(user!.email) } }); // requireAuth baru saja memuat user aktif yang sama
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const body = updateMeSchema.parse(req.body);
    const id = req.user!.id;
    let passwordHash: string | null = null;
    if (body.newPassword) {
      if (isManaged(req.user!.email)) throw new HttpError(400, 'Password akun ini diatur lewat SEED_ADMIN_PASSWORD di .env');
      const [row] = await sql<{ passwordHash: string }[]>`SELECT password_hash FROM users WHERE id = ${id}`;
      if (!(await verify(row!.passwordHash, body.currentPassword!))) throw new HttpError(400, 'Password lama salah');
      passwordHash = await hash(body.newPassword);
    }
    const [user] = await sql`
      UPDATE users SET name = coalesce(${body.name ?? null}, name),
        password_hash = coalesce(${passwordHash}, password_hash),
        password_changed_at = CASE WHEN ${passwordHash !== null} THEN now() ELSE password_changed_at END
      WHERE id = ${id} RETURNING id, name, email, role`;
    // Ganti password mencabut semua sesi lain (requireAuth); sesi ini diberi cookie baru agar tidak ikut terlempar,
    // dengan jenis sesi yang sama: token lama berumur > 8 jam = sesi "Ingat saya" (token sudah diverifikasi requireAuth).
    if (passwordHash) {
      const { iat = 0, exp = 0 } = decodeJwt(String(req.cookies[SESSION_COOKIE]));
      await setSession(res, id, exp - iat > SESSION_TTL_SECONDS);
    }
    await audit(sql, req, 'update', 'user', id, { name: body.name, password: !!passwordHash });
    res.json({ user });
  });

  return router;
};
