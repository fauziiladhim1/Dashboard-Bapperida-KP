-- Titik Kawasan Strategis: kolom Status Koordinat dihapus (field layer + atribut fitur).
-- Titik yang belum berkalurahan (pesisir/di luar poligon batas) diisi dari poligon kalurahan terdekat.
UPDATE layers
SET fields = coalesce((SELECT jsonb_agg(f) FROM jsonb_array_elements(fields) f WHERE f->>'key' <> 'status_koordinat'), '[]'::jsonb)
WHERE slug = 'titik-kawasan-strategis';

UPDATE features SET properties = properties - 'status_koordinat'
WHERE layer_id = (SELECT id FROM layers WHERE slug = 'titik-kawasan-strategis') AND properties ? 'status_koordinat';

UPDATE features t
SET properties = t.properties || coalesce((
  SELECT jsonb_build_object(
    'kecamatan', coalesce(a.properties->>'kecamatan', a.properties->>'WADMKC', a.properties->>'KECAMATAN'),
    'kalurahan', a.properties->>'kalurahan')
  FROM features a
  WHERE a.layer_id = (SELECT id FROM layers WHERE slug = 'batas-administrasi')
  ORDER BY a.geom <-> t.geom LIMIT 1), '{}'::jsonb)
WHERE t.layer_id = (SELECT id FROM layers WHERE slug = 'titik-kawasan-strategis')
  AND (NOT t.properties ? 'kalurahan' OR t.properties->>'kalurahan' IS NULL);
