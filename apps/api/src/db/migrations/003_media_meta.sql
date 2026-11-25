-- Metadata dokumentasi per foto: keterangan, tanggal survei, dan tingkat urgensi penanganan.
ALTER TABLE media
  ADD COLUMN caption text,
  ADD COLUMN tanggal date,
  ADD COLUMN urgensi text CHECK (urgensi IN ('tinggi', 'sedang', 'rendah'));
