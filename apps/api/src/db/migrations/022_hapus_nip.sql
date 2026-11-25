-- NIP tidak dipakai di mana pun (tidak diminta saat daftar, tidak dipakai untuk otorisasi): kolom dihapus.
ALTER TABLE users DROP COLUMN IF EXISTS nip;
