-- PERF-01: panjang/luas geography di-precompute sekali saat tulis (kolom GENERATED STORED),
-- agar /stats dan KPI cukup menjumlahkan kolom alih-alih menghitung ST_Length/ST_Area tiap request
-- (3.849 poligon ~556 ms -> jumlah kolom). Kolom ikut dihitung ulang otomatis saat geom berubah.
-- ST_Length pada poligon = 0 dan ST_Area pada garis = 0, sama persis dengan agregat lama yang
-- menjumlahkan keduanya tanpa pandang tipe geometri. ST_Length/ST_Area(geography) IMMUTABLE.
ALTER TABLE features
  ADD COLUMN length_m double precision GENERATED ALWAYS AS (ST_Length(geom::geography)) STORED,
  ADD COLUMN area_m2  double precision GENERATED ALWAYS AS (ST_Area(geom::geography))  STORED;
