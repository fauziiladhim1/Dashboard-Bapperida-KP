-- KPI kustom dua grafik (format kartu Penduduk Miskin): rincian kedua, biasanya deret per tahun, digambar di samping
-- rincian utama. by2_field NULL = kartu satu grafik seperti sebelumnya.
ALTER TABLE kpi
  ADD COLUMN by2_field text,
  ADD COLUMN chart2 text NOT NULL DEFAULT 'line' CHECK (chart2 IN ('line', 'bar'));
