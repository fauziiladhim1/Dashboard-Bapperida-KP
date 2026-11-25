-- Bentuk grafik KPI kustom: auto (dipilih dari bentuk data), number (angka saja), bar, line (deret berurutan, mis. per tahun), donut (porsi).
ALTER TABLE kpi ADD COLUMN chart text NOT NULL DEFAULT 'auto' CHECK (chart IN ('auto', 'number', 'bar', 'line', 'donut'));
