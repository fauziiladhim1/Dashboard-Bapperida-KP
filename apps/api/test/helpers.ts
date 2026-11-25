import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, inject } from 'vitest';
import { createApp, type Limits } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';

export const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: inject('dbUrl'),
  JWT_SECRET: 'test-secret-yang-panjangnya-lebih-dari-32-karakter',
  UPLOAD_DIR: path.join(tmpdir(), `sipwil-test-${randomUUID()}`),
});

export const sql = createDb(env.DATABASE_URL, 5);
afterAll(() => sql.end());

export const makeApp = (limits?: Partial<Limits>) => createApp({ sql, env, limits, log: () => undefined });
export const app = makeApp();

export const PASSWORD = 'Rahasia12345';

export const createUser = async (role = 'viewer', status = 'active') => {
  const email = `${randomUUID()}@test.id`;
  const [user] = await sql<{ id: number }[]>`
    INSERT INTO users (name, email, password_hash, role, status)
    VALUES ('Tester', ${email}, ${await hash(PASSWORD)}, ${role}::user_role, ${status}::user_status) RETURNING id`;
  return { id: user!.id, email };
};

export const loginAs = async (role: 'superadmin' | 'editor' | 'viewer', target = app) => {
  const user = await createUser(role);
  const agent = request.agent(target);
  await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  return { agent, ...user };
};

export const API = '/api/v1';

/** Poligon kecamatan uji di sekitar Wates. */
export const WATES = {
  type: 'Polygon' as const,
  coordinates: [[[110.1, -7.9], [110.2, -7.9], [110.2, -7.8], [110.1, -7.8], [110.1, -7.9]]],
};
