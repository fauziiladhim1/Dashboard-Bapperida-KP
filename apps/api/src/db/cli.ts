import { createDb } from './client.js';
import { migrate } from './migrate.js';
import { seed, syncAdminPassword } from './seed.js';

const sql = createDb(process.env.DATABASE_URL ?? '', 1);
const cmd = process.argv[2];
const admin = () => {
  const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
  if (!email || !password || password.length < 12) throw new Error('SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD (min 12 karakter) wajib diisi');
  return { email, password };
};
try {
  if (cmd === 'migrate') {
    console.log('Migrasi:', (await migrate(sql)).join(', ') || 'tidak ada yang baru');
  } else if (cmd === 'seed') {
    await seed(sql, admin());
    console.log('Seed selesai');
  } else if (cmd === 'admin-password') {
    // Server juga menjalankan ini tiap start; perintah ini untuk menyamakan tanpa restart.
    const result = await syncAdminPassword(sql, admin());
    if (result === 'missing') throw new Error(`Akun ${process.env.SEED_ADMIN_EMAIL} tidak ada; jalankan db:seed untuk membuatnya`);
    console.log(result === 'same' ? 'Password sudah sama dengan SEED_ADMIN_PASSWORD' : 'Password disamakan dengan SEED_ADMIN_PASSWORD (sesi lama dicabut)');
  } else {
    throw new Error('Perintah: migrate | seed | admin-password');
  }
} finally {
  await sql.end();
}
