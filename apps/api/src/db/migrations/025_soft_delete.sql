-- Soft delete fitur: hapus dari menu Data memindah fitur ke "tempat sampah" (deleted_at terisi) dan bisa dipulihkan.
-- Tabel fisik jadi `features_all`; `features` jadi view fitur aktif sehingga semua pembaca (stats, tiles, pencarian,
-- ekspor, KPI, fungsi snap_jalan) otomatis mengabaikan fitur terhapus tanpa diubah satu per satu. View sederhana ini
-- bisa di-INSERT/UPDATE/DELETE langsung (auto-updatable); trigger touch_layer & sync_tahun, index, dan FK media ikut
-- pindah ke features_all bersama rename, jadi soft delete (UPDATE) tetap menaikkan layers.updated_at (versi tile peta).
-- PERHATIAN: kolom view dibekukan saat dibuat. Migrasi yang menambah kolom ke features_all harus membuat ulang view ini.
ALTER TABLE features RENAME TO features_all;
ALTER TABLE features_all
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by integer REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX features_all_trash_idx ON features_all (layer_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE VIEW features AS SELECT * FROM features_all WHERE deleted_at IS NULL;
