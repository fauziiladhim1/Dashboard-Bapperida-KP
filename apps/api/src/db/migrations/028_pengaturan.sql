-- Pengaturan aplikasi yang bisa diubah setelah deploy (tanpa ubah kode): aturan urgensi, opsi keputusan, dan definisi
-- kartu keterpaparan bahaya. Satu baris per kunci; nilai = jsonb. Diubah superadmin lewat PUT /api/v1/settings/:key.
CREATE TABLE pengaturan (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  keterangan  text,
  updated_by  int REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Urgensi otomatis dari atribut fitur. `aturan` diperiksa berurutan; aturan pertama yang field-nya ada di layer dan
-- nilainya terisi yang dipakai. Pola = regex tanpa beda huruf besar/kecil (dipakai di web dan SQL), diuji pada nilai
-- yang sudah di-trim. `abaikan` = nilai yang belum dapat dinilai (tanpa urgensi). `lainnya` = urgensi bila tidak cocok.
INSERT INTO pengaturan (key, value, keterangan) VALUES ('urgensi', $${
  "abaikan": "belum|tidak diketahui|tidak tercatat",
  "aturan": [
    { "field": "jenis_lampu", "tinggi": "^hilang$", "sedang": null, "lainnya": null },
    { "field": "kondisi", "tinggi": "rusak berat|mati|hilang|^rusak$", "sedang": "rusak|sedang", "lainnya": "rendah" }
  ]
}$$, 'Aturan urgensi otomatis dari atribut fitur (lonceng peringatan, badge urgensi, wajib foto)');

-- Opsi keputusan tindak lanjut (urutan = urutan di form). `tuntas` = keputusan yang menghilangkan peringatan;
-- `pelaksanaan` = keputusan yang menampilkan isian anggaran/sumber dana/tahun target. `warna`: success|warning|danger|default.
INSERT INTO pengaturan (key, value, keterangan) VALUES ('keputusan', $${
  "opsi": [
    { "nilai": "Diproses", "warna": "success", "keterangan": { "id": "Masuk rencana penanganan", "en": "Included in the handling plan" } },
    { "nilai": "Ditunda", "warna": "warning", "keterangan": { "id": "Menunggu anggaran / data", "en": "Waiting for budget / data" } },
    { "nilai": "Tidak Diproses", "warna": "danger", "keterangan": { "id": "Tidak ditindaklanjuti", "en": "No follow-up" } },
    { "nilai": "Selesai", "warna": "success", "keterangan": { "id": "Pekerjaan sudah terealisasi", "en": "Work has been completed" } }
  ],
  "tuntas": ["Diproses", "Selesai"],
  "pelaksanaan": ["Diproses", "Selesai"]
}$$, 'Opsi keputusan tindak lanjut di form notulensi');

-- Kartu "Keterpaparan bahaya tinggi": zona bahaya dan objek yang dihitung di dalamnya. `gabungan` = nilai jenis bahaya
-- gabungan (ditampilkan sebagai ringkasan, tidak dijumlah dengan jenis lain).
INSERT INTO pengaturan (key, value, keterangan) VALUES ('keterpaparan', $${
  "zona": { "layer": "potensi-bencana", "field": "kelas", "nilai": "Tinggi", "jenis": "jenis_bahaya", "gabungan": "Multi-Bahaya" },
  "sekolah": { "layer": "utilitas-umum", "field": "jenis", "nilai": "Pendidikan" },
  "faskes": { "layer": "utilitas-umum", "field": "jenis", "nilai": "Kesehatan" },
  "wisata": { "layer": "destinasi-pariwisata" },
  "jalan": { "layer": "jalan-kabupaten" },
  "permukiman": { "layer": "tutupan-lahan", "field": "kelas", "nilai": "Permukiman dan Tempat Kegiatan" }
}$$, 'Definisi kartu keterpaparan bahaya tinggi');
