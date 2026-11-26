import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Akun yang passwordnya dikelola .env (disinkronkan tiap start, tak bisa diganti dari aplikasi). Kosong = tidak ada.
  SEED_ADMIN_EMAIL: z.string().optional().transform((e) => e?.trim().toLowerCase() || undefined),
  // Perbarui layer potensi-bencana dari InaRISK BNPB bila salinannya > 30 hari (cek tiap 24 jam). `false` = matikan.
  INARISK_AUTO: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SEED_ADMIN_PASSWORD: z.string().min(12, 'SEED_ADMIN_PASSWORD minimal 12 karakter').optional().or(z.literal('').transform(() => undefined)),
});

export type Env = z.infer<typeof schema>;

export const parseEnv = (source: Record<string, string | undefined>): Env => schema.parse(source);
