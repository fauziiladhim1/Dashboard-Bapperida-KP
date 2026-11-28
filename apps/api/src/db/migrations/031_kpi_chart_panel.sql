-- Jenis grafik panel KPI kustom tambahan: kolom (batang vertikal), treemap (porsi berupa kotak), dan tabel rincian.
ALTER TABLE kpi DROP CONSTRAINT kpi_chart_check;
ALTER TABLE kpi ADD CONSTRAINT kpi_chart_check CHECK (chart IN ('auto', 'number', 'bar', 'column', 'line', 'donut', 'treemap', 'table'));
