-- Bersih-bersih data yang tidak dipakai:
-- 1. Atribut sisa snap jalan (`disambung`, `celah_m`): hanya jejak proses impor, tidak dibaca Ringkasan/peta/ekspor.
--    snap_jalan tetap menyambung geometri, tetapi tidak lagi menulis atribut itu.
-- 2. `nomor_ruas` jalan nasional yang kosong di semua fitur, dan `keterangan` utilitas umum (salinan REMARK = nama).
-- 3. Layer turunan Kawasan Pertanian & Kesesuaian Pola Ruang: hanya saringan Rencana Pola Ruang (0 fitur sendiri),
--    tampil ganda di Data & Peta. Datanya tetap utuh di layer penggunaan-lahan (atribut kelas & kesesuaian).
UPDATE features SET properties = properties - 'disambung' - 'celah_m' WHERE properties ?| array['disambung', 'celah_m'];
UPDATE features f SET properties = f.properties - 'nomor_ruas'
FROM layers l WHERE l.id = f.layer_id AND l.slug = 'jalan-nasional' AND coalesce(f.properties->>'nomor_ruas', '') = '';
UPDATE features f SET properties = f.properties - 'keterangan'
FROM layers l WHERE l.id = f.layer_id AND l.slug = 'utilitas-umum';
DELETE FROM layers WHERE slug IN ('kawasan-pertanian', 'kesesuaian-lahan');

CREATE OR REPLACE FUNCTION snap_jalan(lid int, tol_m float) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  f record;
  e int;
  line geometry;
  p geometry;
  o geometry;
  d float;
  n int := 0;
BEGIN
  FOR f IN SELECT id FROM features WHERE layer_id = lid AND ST_NumGeometries(geom) = 1 ORDER BY id LOOP
    FOR e IN 0..1 LOOP
      SELECT ST_GeometryN(geom, 1) INTO line FROM features WHERE id = f.id;
      p := CASE e WHEN 0 THEN ST_StartPoint(line) ELSE ST_EndPoint(line) END;
      SELECT x.geom, ST_Distance(x.geom::geography, p::geography) INTO o, d
      FROM features x
      WHERE x.layer_id = lid AND x.id <> f.id AND ST_DWithin(x.geom::geography, p::geography, tol_m)
      ORDER BY ST_Distance(x.geom::geography, p::geography) LIMIT 1;
      CONTINUE WHEN o IS NULL OR d <= 0.5;
      UPDATE features SET geom = ST_Multi(CASE e WHEN 0 THEN ST_AddPoint(line, ST_ClosestPoint(o, p), 0) ELSE ST_AddPoint(line, ST_ClosestPoint(o, p)) END)
      WHERE id = f.id;
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;
