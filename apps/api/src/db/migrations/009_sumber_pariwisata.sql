-- Sumber data per layer (tampil di popup peta) dan titik kawasan RIPPARDA dijadikan layer pariwisata.
ALTER TABLE layers ADD COLUMN sumber text;
UPDATE layers SET slug = 'destinasi-pariwisata', name = 'Destinasi Pariwisata', category = 'Pariwisata'
WHERE slug = 'titik-kawasan-strategis';
