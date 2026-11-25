-- Penduduk miskin: layer per tahun (`penduduk-miskin-<tahun>`, migrasi 006) digabung jadi satu layer `penduduk-miskin`
-- dengan atribut `tahun`. Peta memfilter fitur ke tahun yang dipilih; menu Data cukup satu layer. Simbologi disinkronkan seed.
INSERT INTO layers (slug, name, category, year, geom_type, style, fields, visible_default, sort_order)
VALUES ('penduduk-miskin', 'Penduduk Miskin', 'Sosial', NULL, 'Polygon', '{"color": "#DC2626"}'::jsonb,
        '[{"key": "kecamatan", "label": "Kecamatan", "type": "text", "required": true},
          {"key": "kalurahan", "label": "Kalurahan", "type": "text", "required": true},
          {"key": "tahun", "label": "Tahun", "type": "number", "required": true},
          {"key": "jumlah", "label": "Jumlah Penduduk Miskin (jiwa)", "type": "number"}]'::jsonb,
        false, 100)
ON CONFLICT (slug) DO NOTHING;

UPDATE features f
SET layer_id = (SELECT id FROM layers WHERE slug = 'penduduk-miskin'),
    properties = f.properties || jsonb_build_object('tahun', l.year)
FROM layers l
WHERE f.layer_id = l.id AND l.slug LIKE 'penduduk-miskin-%';

DELETE FROM layers WHERE slug LIKE 'penduduk-miskin-%';
