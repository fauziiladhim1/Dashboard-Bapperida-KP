-- Tahun keadaan data per fitur (bukan tanggal input): wajib di semua CRUD/upload, default tahun berjalan.
-- Data lama: atribut `tahun` (mis. penduduk miskin), lalu tahun versi layer, lalu tahun dibuat.
ALTER TABLE features ADD COLUMN tahun_data int NOT NULL DEFAULT extract(year FROM now())::int
  CHECK (tahun_data BETWEEN 1900 AND 2100);
UPDATE features f SET tahun_data = coalesce(
    CASE WHEN f.properties->>'tahun' ~ '^\d{4}$' THEN (f.properties->>'tahun')::int END,
    l.year, extract(year FROM f.created_at)::int)
FROM layers l WHERE l.id = f.layer_id;
CREATE INDEX features_layer_tahun_idx ON features (layer_id, tahun_data);
