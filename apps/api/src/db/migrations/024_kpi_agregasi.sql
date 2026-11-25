-- KPI kustom ala Tableau: agregasi atribut angka selain SUM (AVG, MIN, MAX), urutan rincian, dan Top N.
-- sum_field tetap nama kolomnya (= atribut yang diagregasi) agar resep lama tak perlu dipindah.
ALTER TABLE kpi DROP CONSTRAINT kpi_measure_check, DROP CONSTRAINT kpi_check;
ALTER TABLE kpi
  ADD CONSTRAINT kpi_measure_check CHECK (measure IN ('count', 'length_km', 'area_ha', 'sum', 'avg', 'min', 'max')),
  ADD CONSTRAINT kpi_agg_field_check CHECK ((measure IN ('sum', 'avg', 'min', 'max')) = (sum_field IS NOT NULL)),
  -- Urutan kategori rincian: nilai terbesar dulu (bawaan), terkecil dulu, atau abjad/angka (mis. tahun).
  ADD COLUMN sort text NOT NULL DEFAULT 'desc' CHECK (sort IN ('desc', 'asc', 'label')),
  -- Hanya N kategori teratas setelah diurutkan; NULL = bawaan kartu (batang 6, lainnya semua).
  ADD COLUMN top_n int CHECK (top_n BETWEEN 1 AND 50);
