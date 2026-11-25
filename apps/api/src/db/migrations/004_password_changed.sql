-- Waktu ganti password terakhir: sesi (JWT) yang terbit sebelumnya ditolak requireAuth.
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
