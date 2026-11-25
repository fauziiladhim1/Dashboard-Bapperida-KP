import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
};

const PG_MESSAGES: Record<string, [number, string]> = {
  '23505': [409, 'Data sudah ada (duplikat)'],
  '23503': [409, 'Data masih dipakai atau referensi tidak valid'],
  '23514': [400, 'Data tidak memenuhi aturan validasi'],
};

export const errorHandler = (log: (err: unknown) => void = console.error): ErrorRequestHandler => (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: 'Input tidak valid', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  } else if (err instanceof MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: `Upload gagal: ${err.message}` });
  } else if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(err.status).json({ error: 'Body request tidak valid atau terlalu besar' });
  } else if (typeof err?.code === 'string' && PG_MESSAGES[err.code]) {
    const [status, error] = PG_MESSAGES[err.code]!;
    res.status(status).json({ error });
  } else {
    log(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
};
