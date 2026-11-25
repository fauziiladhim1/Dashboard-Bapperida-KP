-- Data non-spasial: rekap kondisi per ruas jalan dan jumlah penduduk miskin per kalurahan.
CREATE TABLE ruas_jalan (
  id           serial PRIMARY KEY,
  kecamatan    text NOT NULL,
  wilayah      text NOT NULL,
  tahun        int NOT NULL,
  ruas         text NOT NULL,
  baik         numeric NOT NULL DEFAULT 0,
  sedang       numeric NOT NULL DEFAULT 0,
  rusak_ringan numeric NOT NULL DEFAULT 0,
  rusak_berat  numeric NOT NULL DEFAULT 0,
  perbaikan    numeric NOT NULL DEFAULT 0,
  UNIQUE (wilayah, tahun, ruas)
);

CREATE TABLE kemiskinan (
  kecamatan text NOT NULL,
  kalurahan text NOT NULL,
  tahun     int NOT NULL,
  jumlah    int NOT NULL,
  PRIMARY KEY (kecamatan, kalurahan, tahun)
);
