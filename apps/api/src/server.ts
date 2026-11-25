import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { syncAdminPassword } from './db/seed.js';

const env = parseEnv(process.env);
const sql = createDb(env.DATABASE_URL);
// .env sumber password superadmin bawaan: disamakan tiap start (hanya bila berbeda, agar sesi "Ingat saya" tidak tercabut).
if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
  const result = await syncAdminPassword(sql, { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });
  if (result === 'updated') console.log(`Password ${env.SEED_ADMIN_EMAIL} disamakan dengan SEED_ADMIN_PASSWORD`);
}
const server = createApp({ sql, env }).listen(env.PORT, () => console.log(`API berjalan di http://localhost:${env.PORT}`));

const shutdown = () => server.close(() => void sql.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
