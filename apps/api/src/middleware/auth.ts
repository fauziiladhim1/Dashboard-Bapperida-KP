import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import type { Sql } from '../db/client.js';
import { HttpError } from '../lib/http.js';

export type Role = 'superadmin' | 'editor' | 'viewer';
export type SessionUser = { id: number; name: string; email: string; role: Role };

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const SESSION_COOKIE = 'sipwil_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
/** Masa berlaku sesi saat "Ingat saya" dicentang. */
export const REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;

const key = (secret: string) => new TextEncoder().encode(secret);

export const signSession = (userId: number, secret: string, ttl = SESSION_TTL_SECONDS): Promise<string> =>
  new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(userId)).setIssuedAt()
    .setExpirationTime(`${ttl}s`).sign(key(secret));

/** Memverifikasi cookie sesi dan memuat ulang user dari DB, sehingga akun yang dinonaktifkan langsung kehilangan akses. */
export const requireAuth = (sql: Sql, secret: string): RequestHandler => async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') throw new HttpError(401, 'Silakan login terlebih dahulu');
  const payload = await jwtVerify(token, key(secret), { algorithms: ['HS256'] }).then((r) => r.payload, () => null);
  if (!payload) throw new HttpError(401, 'Sesi tidak valid atau kedaluwarsa');
  // Token yang terbit sebelum ganti password terakhir ditolak (iat dalam detik, jadi dibandingkan per detik).
  const [user] = await sql<SessionUser[]>`
    SELECT id, name, email, role FROM users WHERE id = ${Number(payload.sub)} AND status = 'active'
      AND (password_changed_at IS NULL OR date_trunc('second', password_changed_at) <= to_timestamp(${payload.iat ?? 0}))`;
  if (!user) throw new HttpError(401, 'Akun tidak aktif');
  req.user = user;
  next();
};

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction): void => {
  if (!roles.includes(req.user!.role)) throw new HttpError(403, 'Anda tidak memiliki akses untuk aksi ini');
  next();
};

export const EDITORS: Role[] = ['superadmin', 'editor'];
