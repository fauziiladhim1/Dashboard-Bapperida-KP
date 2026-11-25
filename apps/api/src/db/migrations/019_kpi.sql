-- KPI kustom Ringkasan: dibuat editor lewat dashboard, tanpa kode. Angkanya dihitung endpoint /stats/layers/:slug yang
-- sudah ada (filter kecamatan ikut); tabel ini hanya menyimpan resepnya. Layer dihapus = KPI-nya ikut hilang.
CREATE TABLE kpi (
  id          serial PRIMARY KEY,
  label       text NOT NULL,
  layer_slug  text NOT NULL REFERENCES layers (slug) ON UPDATE CASCADE ON DELETE CASCADE,
  measure     text NOT NULL CHECK (measure IN ('count', 'length_km', 'area_ha', 'sum')),
  sum_field   text CHECK ((measure = 'sum') = (sum_field IS NOT NULL)),
  by_field    text,
  where_field text,
  where_eq    text CHECK ((where_field IS NULL) = (where_eq IS NULL)),
  unit        text,
  warn        boolean NOT NULL DEFAULT false,  -- angka utama merah (peringatan), mis. jumlah kasus
  sort_order  int NOT NULL DEFAULT 100,
  created_by  int REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
