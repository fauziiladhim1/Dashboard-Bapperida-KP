import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { autoUpdate } from './db/inarisk.js';
import { syncAdminPassword } from './db/seed.js';

const env = parseEnv(process.env);
const sql = createDb(env.DATABASE_URL);
// .env sumber password superadmin bawaan: disamakan tiap start (hanya bila berbeda, agar sesi "Ingat saya" tidak tercabut).
if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
  const result = await syncAdminPassword(sql, { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });
  if (result === 'updated') console.log(`Password ${env.SEED_ADMIN_EMAIL} disamakan dengan SEED_ADMIN_PASSWORD`);
}
const server = createApp({ sql, env }).listen(env.PORT, () => console.log(`API berjalan di http://localhost:${env.PORT}`));

// Data potensi bencana: cek 1 menit setelah start lalu tiap 24 jam; unduhan InaRISK hanya bila salinan > 30 hari.
// ponytail: timer dalam proses, cukup untuk satu instance API. Bila API diskalakan >1 replika, pindahkan ke cron host.
if (env.INARISK_AUTO && env.NODE_ENV === 'production') {
  let busy = false;
  const check = () => {
    if (busy) return;
    busy = true;
    autoUpdate(sql)
      .then((r) => r !== 'fresh' && console.log(`InaRISK otomatis: ${r === 'manual' ? 'dilewati, layer berisi data manual' : 'diperbarui'}`))
      .catch((e: Error) => console.error(`InaRISK otomatis gagal (data lama tetap dipakai): ${e.message}`))
      .finally(() => { busy = false; });
  };
  setTimeout(check, 60_000).unref();
  setInterval(check, 24 * 3600_000).unref();
}

const shutdown =() => server.close(() => void sql.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
