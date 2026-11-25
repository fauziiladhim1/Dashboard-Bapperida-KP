-- Keputusan yang menandai pekerjaan terealisasi: form notulensi mengisi `tanggal_selesai` otomatis untuk keputusan ini.
UPDATE pengaturan SET value = value || '{"selesai": "Selesai"}'::jsonb, updated_at = now() WHERE key = 'keputusan';
