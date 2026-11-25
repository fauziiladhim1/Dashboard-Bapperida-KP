-- Potensi bencana kini zona vektor per kelas (db:inarisk, raster InaRISK -> poligon). Fitur format lama
-- (statistik per kalurahan, atribut indeks_rata/luas_terdampak_ha) dibuang agar tidak tercampur; isi ulang dengan db:inarisk.
DELETE FROM features f USING layers l
WHERE l.id = f.layer_id AND l.slug = 'potensi-bencana' AND f.properties ? 'indeks_rata';
