-- Tata letak kartu Ringkasan (urutan, lebar, tersembunyi), diatur editor lewat "Edit ringkasan". Satu baris = satu
-- layout bersama untuk semua pengguna. cards = [{ key, span, hidden }]; kosong = tata letak bawaan web.
CREATE TABLE ringkasan_layout (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cards       jsonb NOT NULL DEFAULT '[]',
  updated_by  int REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
