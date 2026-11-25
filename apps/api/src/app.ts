import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import type { Sql } from './db/client.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { auditRouter } from './modules/audit.js';
import { authRouter } from './modules/auth.js';
import { featuresRouter } from './modules/features.js';
import { kpiRouter } from './modules/kpi.js';
import { layersRouter } from './modules/layers.js';
import { statsRouter } from './modules/stats.js';
import { tabularRouter } from './modules/tabular.js';
import { tilesRouter } from './modules/tiles.js';
import { uploadRouter } from './modules/upload.js';
import { usersRouter } from './modules/users.js';
import { settingsRouter } from './modules/settings.js';

export type Limits = { windowMs: number; global: number; auth: number; loginEmail: number; register: number; upload: number };

const DEFAULT_LIMITS: Limits = { windowMs: 15 * 60 * 1000, global: 1500, auth: 10, loginEmail: 5, register: 5, upload: 30 };

type Options = { sql: Sql; env: Env; limits?: Partial<Limits>; log?: (err: unknown) => void };

export const createApp = ({ sql, env, limits, log }: Options): Express => {
  const l = { ...DEFAULT_LIMITS, ...limits };
  const limiter = (limit: number, message: string, skipSuccessfulRequests = false, keyGenerator?: (req: Request) => string) =>
    rateLimit({ windowMs: l.windowMs, limit, skipSuccessfulRequests, keyGenerator, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: message } });
  const AUTH_MSG = 'Terlalu banyak percobaan login, coba lagi 15 menit lagi';
  const auth = requireAuth(sql, env.JWT_SECRET);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  const api = express.Router();
  // Vector tile tidak ikut limiter global: satu kali geser peta memuat puluhan tile (tetap wajib login).
  const globalLimiter = limiter(l.global, 'Terlalu banyak permintaan, coba lagi nanti');
  api.use((req, res, next) => (req.path.startsWith('/tiles/') ? next() : globalLimiter(req, res, next)));
  api.get('/health', async (_req, res) => {
    await sql`SELECT 1`;
    res.json({ status: 'ok' });
  });
  // Registrasi dihitung semua (sukses pun), agar tidak bisa membanjiri antrean akun pending.
  api.use('/auth/register', limiter(l.register, 'Terlalu banyak pendaftaran, coba lagi nanti'));
  // Per email: limit per IP tidak menahan penyerang yang berganti-ganti IP untuk menebak password satu akun.
  // Pesan sama dengan limit per IP agar tidak membocorkan email mana yang terdaftar.
  // ponytail: store memori (reset saat restart, tidak dibagi antar-replika); pakai store bersama bila API > 1 instance.
  api.post('/auth/login', limiter(l.loginEmail, AUTH_MSG, true, (req) => `email:${String(req.body?.email).toLowerCase()}`));
  // Auth ketat dan hanya menghitung percobaan gagal (anti brute-force).
  api.use('/auth', limiter(l.auth, AUTH_MSG, true),
    authRouter({ sql, secret: env.JWT_SECRET, secure: env.NODE_ENV === 'production', requireAuth: auth,
      managedEmail: env.SEED_ADMIN_PASSWORD ? env.SEED_ADMIN_EMAIL : undefined }));

  api.use(auth);
  api.use(['/layers/:slug/upload', '/features/:id/media'], limiter(l.upload, 'Batas upload tercapai, coba lagi nanti'));
  api.use('/users', usersRouter(sql));
  api.use('/audit', auditRouter(sql));
  api.use('/tiles', tilesRouter(sql));
  api.use('/stats', statsRouter(sql));
  api.use('/kpi', kpiRouter(sql));
  api.use('/settings', settingsRouter(sql));
  api.use('/tables', tabularRouter(sql));
  api.use('/layers', layersRouter(sql, env.UPLOAD_DIR));
  api.use(featuresRouter(sql, env.UPLOAD_DIR));
  api.use(uploadRouter(sql, env.UPLOAD_DIR));

  app.use('/api/v1', api);
  // Nama file media berupa UUID (tidak pernah berubah), jadi aman di-cache 1 tahun — tetapi hanya di browser (private):
  // foto butuh login, reverse proxy tidak boleh menyimpan dan menyajikannya ke orang lain.
  app.use('/uploads', auth, express.static(env.UPLOAD_DIR, {
    index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'),
  }));
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
};
