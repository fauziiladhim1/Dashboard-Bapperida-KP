-- Penduduk miskin dipindah dari tabel `kemiskinan` (tanpa geometri) ke layer bertahun `penduduk-miskin-<tahun>`:
-- tiap baris jadi fitur poligon kalurahan (dari layer batas-administrasi), sehingga muncul di menu Data, peta, ekspor,
-- dan bisa diedit/diunggah seperti layer lain. Simbologi (style.steps) disinkronkan oleh seed sesudah migrasi.
INSERT INTO layers (slug, name, category, year, geom_type, style, fields, visible_default, sort_order)
SELECT 'penduduk-miskin-' || tahun, 'Penduduk Miskin ' || tahun, 'Sosial', tahun, 'Polygon', '{"color": "#DC2626"}'::jsonb,
       '[{"key": "kecamatan", "label": "Kecamatan", "type": "text", "required": true},
         {"key": "kalurahan", "label": "Kalurahan", "type": "text", "required": true},
         {"key": "jumlah", "label": "Jumlah Penduduk Miskin (jiwa)", "type": "number"}]'::jsonb,
       false, 100
FROM (SELECT DISTINCT tahun FROM kemiskinan) t
ON CONFLICT (slug) DO NOTHING;

-- Kunci kecamatan + kalurahan: nama kalurahan bisa kembar di kapanewon lain. Baris tanpa poligon tidak bisa dipetakan
-- (impor sudah memperingatkannya) dan tidak ikut dipindah.
INSERT INTO features (layer_id, properties, geom)
SELECT l.id, jsonb_build_object('kecamatan', b.kecamatan, 'kalurahan', b.kalurahan, 'jumlah', k.jumlah), b.geom
FROM kemiskinan k
JOIN layers l ON l.slug = 'penduduk-miskin-' || k.tahun
JOIN (
  SELECT coalesce(a.properties->>'kecamatan', a.properties->>'WADMKC', a.properties->>'KECAMATAN') AS kecamatan, a.properties->>'kalurahan' AS kalurahan,
         ST_Multi(ST_Union(a.geom)) AS geom
  FROM features a JOIN layers al ON al.id = a.layer_id AND al.slug = 'batas-administrasi' GROUP BY 1, 2
) b ON lower(trim(b.kalurahan)) = lower(trim(k.kalurahan)) AND lower(trim(b.kecamatan)) = lower(trim(k.kecamatan));

DROP TABLE kemiskinan;
