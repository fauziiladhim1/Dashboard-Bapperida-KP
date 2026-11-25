-- Peta pertama kali dibuka hanya dengan Batas Administrasi; layer lain (jalan, PJU, dst.) dinyalakan pengguna.
-- Peta mini Ringkasan memakai pengaturan yang sama.
UPDATE layers SET visible_default = (slug = 'batas-administrasi');

-- Nilai kategori diseragamkan ke Title Case seperti kategori lain ("Rusak Berat", "Tanah Longsor", "Kawasan Hutan Lindung").
-- Nilai data, kunci warna simbologi, opsi isian, dan resep KPI ikut diganti agar tetap cocok satu sama lain.
UPDATE features_all SET properties = jsonb_set(properties, '{jenis_lampu}', '"Tidak Tercatat"')
  WHERE properties->>'jenis_lampu' = 'Tidak tercatat';
UPDATE features_all SET properties = jsonb_set(properties, '{jenis_bahaya}', '"Multi-Bahaya"')
  WHERE properties->>'jenis_bahaya' = 'Multi-bahaya';
UPDATE layers SET
  style = replace(replace(style::text, '"Tidak tercatat"', '"Tidak Tercatat"'), '"Multi-bahaya"', '"Multi-Bahaya"')::jsonb,
  fields = replace(replace(fields::text, '"Tidak tercatat"', '"Tidak Tercatat"'), '"Multi-bahaya"', '"Multi-Bahaya"')::jsonb
  WHERE slug IN ('pju', 'potensi-bencana');
UPDATE kpi SET where_eq = 'Tidak Tercatat' WHERE where_eq = 'Tidak tercatat';
UPDATE kpi SET where_eq = 'Multi-Bahaya' WHERE where_eq = 'Multi-bahaya';
UPDATE features_all SET properties = jsonb_set(properties, '{keputusan}', '"Tidak Diproses"')
  WHERE properties->>'keputusan' = 'Tidak diproses';
-- Nama kelompok tutupan lahan ikut Title Case.
UPDATE layers SET style = replace(style::text, '"Fasilitas umum"', '"Fasilitas Umum"')::jsonb WHERE slug = 'tutupan-lahan';
