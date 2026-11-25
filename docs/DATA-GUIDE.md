# Panduan Data Shapefile

## Format unggahan

- Satu file **`.zip`** berisi **tepat satu** shapefile, maks 50 MB.
- Wajib: `.shp`, `.shx`, `.dbf`. Sangat dianjurkan: `.prj` (proyeksi) dan `.cpg` (encoding atribut, idealnya UTF-8).
- Nama file bebas; folder di dalam zip boleh.
- Proyeksi apa pun yang tertulis di `.prj` dikonversi otomatis ke WGS84 (EPSG:4326). Data Kulon Progo biasanya UTM zona 49S (EPSG:32749) atau TM-3.
- **Tanpa `.prj`**, koordinat dianggap sudah WGS84. Jika ternyata masih UTM, unggahan ditolak dengan pesan *"Koordinat di luar rentang WGS84"*.

## Tipe geometri

Geometri harus sama dengan tipe layer: titik (Point/MultiPoint), garis (LineString/MultiLineString), atau poligon (Polygon/MultiPolygon). Semua disimpan sebagai Multi*. Fitur tanpa geometri dilewati dan dihitung sebagai "Tanpa geometri". Geometri yang self-intersect diperbaiki otomatis.

## Nama atribut

Atribut yang dicetak **tebal** menentukan warna dan legenda di peta serta pengelompokan statistik. Jika kolomnya tidak ada atau namanya berbeda, data tetap tersimpan tetapi tampil dengan warna dasar layer. Ubah nama kolom di QGIS (*Layer Properties → Fields*) sebelum mengunggah.

| Layer (slug) | Kolom | Nilai yang dikenali |
|---|---|---|
| `batas-administrasi` | **`kecamatan`** (atau `WADMKC` dari RBI) | Nama kecamatan (12 poligon, tahun 2024) |
| `jalan-kabupaten` | **`nama_ruas`**, `nomor_ruas`, `fungsi`, `kapanewon`, `panjang_km`; kondisi diisi otomatis | kondisi: Baik, Sedang, Rusak Ringan, Rusak Berat, Belum Disurvei |
| `potensi-bencana` | `jenis`, **`tingkat`** | tingkat: Rendah, Sedang, Tinggi |
| `penggunaan-lahan` (Tutupan Lahan) | **`kelas`**, `keterangan` | Permukiman dan Tempat Kegiatan, Sawah, Tegalan/Ladang, Perkebunan/Kebun, Kebun Campuran, Hutan Rimba, Semak Belukar, Herba dan Rumput, Lainnya, Tidak Teridentifikasi |
| `utilitas-umum` | `nama`, **`jenis`**, `kondisi` | jenis: Air Bersih, Persampahan, Drainase, Listrik, Telekomunikasi, Kesehatan, Pendidikan |
| `kawasan-strategis` | `nama`, **`jenis`**, `luas_ha`, `dasar_hukum` | jenis: SRS, Aerotropolis, Penyangga KSPN Borobudur, Geopark |
| `destinasi-pariwisata` (titik) | `nama`, **`kawasan`** | kawasan: KPPD 1 Perkotaan Wates, KPPD 2 Nanggulan-Sentolo-Lendah, KSPD 1 Pansela Kulon Progo - Aerotropolis, KSPD 2 Menoreh Selatan, KSPD 3 Menoreh Utara (nilai data cukup kodenya, mis. `KSPD 2`) |
| `status-tanah` | **`status`**, `no_sertipikat` | Hak Milik, HGB, Hak Pakai, Tanah Kas Desa, Sultan Ground, Pakualaman Ground, Tanah Negara |
| `pju` | `nama`, `lokasi`, **`jenis_lampu`**, `daya_watt`, `tinggi_tiang`, `daya_kwh_va`, `tahun_pasang`, `pengadaan`, `no_tiang`, `keterangan` | jenis_lampu: LED, SON-T, HPL, Hilang, Tidak tercatat |

Layer `jalan-kabupaten` berisi 415 ruas dari SK Jalan Kabupaten (`SK Jalan Kabupaten Kulon Progo/Draft_Final_rev3.shp`, 809 km). Kondisinya diambil dari tabel survei `ruas_jalan` (menu Data > Rekap ruas jalan): nama ruas dicocokkan tanpa tanda baca dan spasi, lalu km per kondisi tahun survei terbaru ditempel ke ruas itu. Warna peta = kondisi dengan km terbesar; bila seri, kondisi yang lebih buruk. Ruas tanpa data survei berwarna abu (Belum Disurvei). Setiap baris tabel ruas yang ditambah, diubah, atau dihapus langsung memperbarui peta.

Kawasan Pertanian **tidak perlu diunggah**: datanya diambil otomatis dari Tutupan Lahan dengan kelas Sawah, Tegalan/Ladang, Perkebunan/Kebun, dan Kebun Campuran.

Popup peta menampilkan luas (ha) untuk poligon, panjang (km) untuk garis, dan tautan *Buka di Google Maps*. Kolom berakhiran `_m`, `_km`, `_ha`, `_watt` otomatis diberi satuan.

## Import awal (CLI)

`npm run db:import -- "<folder data>"` membaca: `SHP Audit 2024/SHP Audit 2024/BatasAdminKec.shp` (batas kecamatan, kolom `WADMKC`) dan `TutupanLahan.shp` (kelas dari `REMARK`; objek kecil seperti jalan/sekolah/makam menjadi Lainnya, `REMARK` kosong menjadi Tidak Teridentifikasi), utilitas dari RBI `KAB. KULONPROGO/`, `Layer_Titik_Kawasan_Strategis_Kulon_Progo.csv` (pemisah `;`, koordinat bertitik ribuan dibetulkan otomatis), `Sebaran 18 SRS DIY.kml` (dipotong ke batas Kulon Progo; SRS di luar kabupaten dan potongan tepi < 20 ha dibuang, `luas_ha` dihitung ulang; warna per SRS), `DATA DISHUB LPJU/DATA DISHUB LPJU/DISHUB_LPJU.shp` (917 titik lampu Dishub; jenis lampu diseragamkan, `ID_PEL` dibuang karena angkanya terpotong di DBF), `SK Jalan Kabupaten Kulon Progo/Draft_Final_rev3.shp` (kode kapanewon dibuang, nomor + sub ruas digabung), CSV ruas jalan, dan xlsx kemiskinan (sheet pertama). Bagian tertentu bisa diimpor ulang sendiri dengan `--only=titik`, `--only=pju`, atau `--only=jalan`.

Kolom lain dari `.dbf` tetap disimpan dan bisa dilihat di detail fitur ("Atribut tambahan dari SHP").

## Simbologi

Warna layer tata ruang mengikuti **Permen ATR/BPN No. 14 Tahun 2021** (Lampiran, tabel Klasifikasi Turunan Unsur Rencana Pola Ruang RTRW Kabupaten, kolom RGB):

| Kelas | RGB |
|---|---|
| Sawah (Tanaman Pangan) | 200 245 70 |
| Tegalan/Ladang (Hortikultura) | 230 255 75 |
| Perkebunan/Kebun | 175 175 55 |
| Hutan Rimba | 75 155 55 |
| Permukiman dan Tempat Kegiatan | 245 155 30 |
| Kawasan Pariwisata | 255 165 255 |
| Kawasan strategis sosial budaya (SRS, penyangga KSPN) | garis 197 0 255 |
| Kawasan strategis pertumbuhan ekonomi (Aerotropolis) | garis 255 0 197 |
| Kawasan strategis pendayagunaan SDA (Geopark) | garis 137 68 68 |

Kebun Campuran (200 205 110), Semak Belukar (130 170 90), dan Herba dan Rumput (185 225 150) tidak ada di Permen, jadi diberi gradasi hijau. Lainnya memakai abu netral (200 200 200), Tidak Teridentifikasi abu muda (232 232 232). Legenda peta hanya menampilkan kelas yang ada di data beserta luasnya. Kondisi jalan tidak diatur di Permen tersebut, jadi tetap memakai skema hijau, kuning, oranye, merah. Warna disimpan di `apps/api/src/db/seed.ts`; `npm run db:seed` menyinkronkan style layer bawaan ke database.

## Mode simpan

- **Tambahkan:** fitur baru ditambahkan ke data yang ada.
- **Ganti:** seluruh fitur lama di layer dihapus lalu diganti isi SHP. Prosesnya dalam satu transaksi, jadi bila gagal, data lama tetap utuh.

Selalu klik **Periksa file** dulu: jumlah fitur, kolom yang belum ada, dan pratinjau peta tampil sebelum data disimpan.

## Data pendukung baru

Menu **Data → Layer baru**. Isi nama, kategori, tipe geometri, warna, dan **sumber data** (instansi dan tahun; tampil di bagian bawah popup peta). Atribut ditulis satu baris per kolom:

```
nama | Nama Sekolah | text
jenjang | Jenjang | select | SD, SMP, SMA
jumlah_siswa | Jumlah Siswa | number
```

## Sumber data terbuka

Hasil penelusuran 11 November 2026. Data di bawah belum diimpor ke dashboard.

**Kondisi jalan.** API Satu Data Kulon Progo menyediakan panjang jalan kabupaten per kondisi (Baik, Sedang, Rusak Ringan, Rusak Berat, dalam km) untuk 2019–2026, ditambah panjang per jenis permukaan dan jumlah jembatan per kondisi. Sumbernya Dinas PUPKP, elemen "Pekerjaan Umum › Kondisi Jalan":
`https://satudata.kulonprogokab.go.id/api/public/data-ku/child-elements/abe9021e-4df2-432b-ae6f-51ae6ce0a8bf?from=2019&to=2026`.
Total panjang tercatat 636 km sampai 2024 dan 807,758 km sejak 2025. Data ini berupa angka total kabupaten, bukan per ruas dan tanpa geometri, sehingga tidak bisa digambar di peta.

**Pariwisata.** Dari Dinas Pariwisata tersedia:
- kunjungan wisatawan per objek beretribusi (10 objek, antara lain Pantai Glagah, Waduk Sermo, dan Puncak Suroloyo, 2021–2026) dan per desa wisata (13 desa, 2023–2026), elemen `69d92976-3695-4902-abdd-c5dc602de456`;
- jumlah desa wisata per klasifikasi (mandiri, maju, berkembang, rintisan) dan jumlah Pokdarwis untuk 2024–2026, elemen `160f6be5-502d-405e-b025-15e9d2fa8b2d`.

Pola URL-nya sama dengan data jalan. Keduanya tidak memuat koordinat. Untuk titik peta, OpenStreetMap memiliki sekitar 43 objek wisata bernama di Kulon Progo (lisensi ODbL, wajib mencantumkan atribusi). Delineasi kawasan pariwisata mengacu pada Perda 10/2025 RIPPARDA 2026–2045.

**PJU.** Sudah diimpor dari data Dinas Perhubungan (`DISHUB_LPJU.shp`, Mei 2025). Data ini tidak memuat status menyala/mati, jadi peta diklasifikasikan per jenis lampu dan Ringkasan menampilkan porsi lampu LED. Untuk status nyala, minta pembaruan Dishub dengan kolom kondisi.

## Tips kualitas data

- Simplifikasi poligon yang sangat detail di QGIS (*Vector → Geometry Tools → Simplify*, toleransi sekitar 1 m) agar unggahan lebih cepat. Peta tetap ringan karena memakai vector tile.
- Pastikan encoding `.dbf` UTF-8 (sertakan `.cpg`) agar huruf seperti "é" tidak rusak.
- Gunakan satu layer per tahun bila data bertahun (contoh: buat layer `pju-2027` pada 2027) dan isi **Tahun** layer. Filter rentang tahun di Ringkasan dan Peta menyembunyikan layer bertahun di luar rentang; layer tanpa tahun selalu tampil.
