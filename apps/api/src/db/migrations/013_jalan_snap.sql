-- Celah digitasi SK Jalan: ujung ruas yang berhenti beberapa meter sebelum ruas lain disambung ke titik terdekat
-- ruas tersebut. Hanya titik ujung yang ditambah; titik tengah tidak diubah, dan ruas tidak pernah dibuat baru.
-- Fitur yang disambung diberi `disambung: true` + `celah_m` (celah terbesar yang ditutup) agar terlihat di popup.
-- Ujung yang sudah menempel (<= 0,5 m) dilewati, jadi aman dijalankan ulang.
-- ponytail: hanya ruas satu bagian (MultiLineString 1 part); ruas yang terpecah ST_MakeValid dilewati.
CREATE FUNCTION snap_jalan(lid int, tol_m float) RETURNS int LANGUAGE plpgsql AS $$
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
      UPDATE features SET
        geom = ST_Multi(CASE e WHEN 0 THEN ST_AddPoint(line, ST_ClosestPoint(o, p), 0) ELSE ST_AddPoint(line, ST_ClosestPoint(o, p)) END),
        properties = properties || jsonb_build_object('disambung', true,
          'celah_m', greatest(coalesce((properties->>'celah_m')::float, 0), round(d::numeric, 1)))
      WHERE id = f.id;
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;
