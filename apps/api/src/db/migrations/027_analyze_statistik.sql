-- Statistik planner untuk kolom deleted_at (migrasi 025) belum pernah dikumpulkan: tanpa pg_stats, planner menebak
-- `deleted_at IS NULL` = 0,5% baris (55 dari ±11 rb fitur) lalu memilih nested loop untuk semua query lewat view
-- `features` (peta, KPI, Data, peringatan). Autoanalyze baru jalan lagi setelah ±10% baris berubah, jadi dipaksa sekali.
-- ANALYZE boleh di dalam transaksi migrasi (beda dengan VACUUM).
ANALYZE features_all;
ANALYZE layers;
ANALYZE ruas_jalan;
