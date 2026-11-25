-- Salah ketik kelas tutupan lahan dari SHP Audit (REMARK "Taxiwy") dibetulkan jadi "Taxiway": data fitur, warna kelas,
-- kelompok, dan opsi isian layer. Impor ulang ikut membetulkannya (import.ts).
UPDATE features SET properties = jsonb_set(properties, '{kelas}', '"Taxiway"')
WHERE properties->>'kelas' = 'Taxiwy' AND layer_id = (SELECT id FROM layers WHERE slug = 'tutupan-lahan');
UPDATE layers SET style = replace(style::text, '"Taxiwy"', '"Taxiway"')::jsonb, fields = replace(fields::text, '"Taxiwy"', '"Taxiway"')::jsonb
WHERE slug = 'tutupan-lahan';
