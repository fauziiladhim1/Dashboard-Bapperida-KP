# PRD: Dashboard Bapperida Kulon Progo

Dashboard regional dan sistem manajemen data spasial multi-sektor untuk Bapperida Kabupaten Kulon Progo.

| | |
|---|---|
| Pemilik | Bapperida Kabupaten Kulon Progo |
| Pengguna | Internal Bapperida (tidak untuk publik) |
| Status | v1.0, siap uji coba internal |
| Hosting target | Server Diskominfo / Kominfo (VM Linux, Docker) |

## 1. Latar belakang

Data pengembangan wilayah (jalan, penggunaan lahan, kebencanaan, kawasan strategis, PJU, dan lainnya) tersimpan sebagai shapefile yang tersebar di banyak folder dan perangkat. Analisis lintas sektor butuh waktu lama karena data harus dikumpulkan dan dibuka satu per satu di aplikasi GIS desktop. Belum ada satu tempat untuk melihat kondisi wilayah secara ringkas, dan perubahan data tidak tercatat.

## 2. Tujuan

1. Satu sumber data spasial resmi untuk tim internal, tersimpan di PostGIS.
2. Ringkasan kondisi wilayah (KPI dan grafik) yang selalu mutakhir untuk pengambilan keputusan.
3. Peta interaktif untuk meng-overlay data lintas sektor dan memfilter per kecamatan.
4. Pengelolaan data (CRUD) yang bisa dilakukan staf tanpa aplikasi GIS desktop, termasuk unggah `.shp`.
5. Jejak audit: siapa mengubah apa dan kapan.

Di luar cakupan v1: portal publik, editing geometri garis/poligon dengan menggambar di peta, integrasi SSO pemerintah, aplikasi mobile native.

## 3. Pengguna dan hak akses

| Peran | Hak akses |
|---|---|
| **Superadmin** | Semua akses editor, ditambah menyetujui/menolak pendaftaran, mengubah peran, menghapus akun, menghapus layer (lewat API; belum ada tombol di UI). |
| **Editor** | Menambah, mengubah, dan menghapus fitur; mengunggah SHP dan foto; membuat layer (mengubah layer baru tersedia lewat API, belum ada di UI); melihat log aktivitas. |
| **Viewer** | Melihat ringkasan, peta, dan tabel data; mengekspor data. |

Alur akun: pengguna mendaftar (nama, NIP opsional, email, password), status **menunggu**, lalu superadmin menyetujui dan memberi peran. Akun yang ditolak atau dihapus langsung kehilangan akses walaupun masih memegang sesi.

## 4. Data

| Layer | Geometri | Atribut utama (kelas simbol) | Catatan |
|---|---|---|---|
| Batas Administrasi | Poligon | `kecamatan`, `kalurahan` | Dipakai untuk filter dan statistik per kecamatan |
| Kondisi Jalan 2026 | Garis | `nama_ruas`, `status`, **`kondisi`**, `perkerasan`, `lebar_m` | Panjang dihitung otomatis (km) |
| Potensi Bencana | Poligon | `jenis`, **`tingkat`** | Luas dihitung otomatis (ha) |
| Penggunaan Lahan | Poligon | **`kelas`**, `keterangan` | Sumber untuk Kawasan Pertanian |
| Kawasan Pertanian | Poligon | turunan PL: `kelas` ∈ Sawah Irigasi, Sawah Tadah Hujan, Ladang, Perkebunan, Perkebunan Campuran, Tanaman Campuran | Baca-saja, tanpa duplikasi data |
| Kelengkapan Utilitas Umum | Titik | `nama`, **`jenis`**, `kondisi` | |
| Kawasan Strategis | Poligon | `nama`, **`jenis`** (SRS, Aerotropolis, Penyangga KSPN Borobudur, Geopark) | |
| Status Tanah | Poligon | **`status`**, `no_sertipikat` | |
| PJU | Titik | `kode`, `jenis_lampu`, `daya_watt`, **`kondisi`** | |
| Kawasan Pariwisata | Poligon | `nama`, **`jenis`** | |
| Data pendukung (menyusul) | Bebas | Ditentukan saat membuat layer | Dibuat lewat menu Data, tombol Layer baru |

Format rinci dan aturan atribut ada di [DATA-GUIDE.md](DATA-GUIDE.md).

## 5. Fitur dan kriteria penerimaan

### 5.1 Autentikasi
- Login dengan email dan password; sesi berupa cookie `httpOnly`, `SameSite=Strict`, `Secure` di produksi, berlaku 8 jam.
- Register membuat akun berstatus menunggu.
- Login gagal dibatasi 10 kali per 15 menit per IP.
- **Diterima bila:** akun menunggu atau ditolak tidak bisa masuk dan mendapat pesan yang jelas; akun yang dinonaktifkan kehilangan akses pada permintaan berikutnya.

### 5.2 Ringkasan
- KPI (implementasi saat ini): penduduk miskin (dibanding tahun sebelumnya), luas kawasan pertanian, jumlah utilitas umum, jumlah PJU dan persentase menyala. Kondisi jalan tampil di kartu rekap per ruas. KPI jalan baik/rusak berat dan risiko bencana tinggi dari rancangan awal belum ada.
- Grafik cincin komposisi penggunaan lahan; grafik batang bertumpuk kondisi jalan per kecamatan.
- Mini-map, inventaris jumlah fitur per layer, dan aktivitas terbaru (editor ke atas).
- **Diterima bila:** angka sama dengan hasil query PostGIS (panjang dan luas dihitung pada geography, satuan meter).

### 5.3 Peta
- Basemap mapcn (CARTO) dengan mode terang dan gelap.
- Panel layer per kategori: tampilkan/sembunyikan, transparansi, legenda otomatis dari kelas atribut.
- Filter kecamatan; data disajikan sebagai vector tile dari PostGIS.
- Klik fitur untuk melihat atribut dan foto; tombol ubah untuk editor.
- Kontrol zoom, kompas, lokasi saya, layar penuh. Di layar kecil, panel layer menjadi bottom sheet.
- **Diterima bila:** layer berisi lebih dari 10.000 poligon tetap lancar digeser (target di atas 30 fps di laptop kantor).

### 5.4 Analisis pengembangan wilayah

> **Status: belum diimplementasi** (endpoint `/stats/overlay` dan halaman analisis belum ada). Dijadwalkan ulang ke v1.3.

- Indeks prioritas intervensi 0–100 per kecamatan dari enam indikator: jalan rusak, luas risiko bencana tinggi, permukiman di zona risiko tinggi, pertanian di zona rawan, PJU mati, dan kekurangan utilitas (kepadatan relatif).
- Tumpang-tindih (overlay) dihitung PostGIS lewat `GET /api/v1/stats/overlay`.
- Bobot indikator bisa diubah (0–5) untuk menguji skenario; peta tematik kecamatan, peringkat, rincian, dan rekomendasi berbasis aturan ikut berubah.
- Ekspor hasil ke CSV.
- **Diterima bila:** angka indikator bisa ditelusuri ke data sumber (ditampilkan di rincian) dan hasil disebut indikatif, bukan penetapan resmi.

### 5.5 Data (CRUD)
- Tabel per layer dengan paginasi di server, pencarian atribut, pilih banyak, dan hapus massal.
- Form atribut dinamis sesuai skema field layer (teks, angka, pilihan, wajib).
- Geometri: titik ditaruh dengan klik peta; garis/poligon lewat GeoJSON atau unggah SHP.
- Foto per fitur, dikompres otomatis ke WebP dan AVIF (maks 1600 px, metadata EXIF dibuang).
- Unggah SHP (`.zip`, maks 50 MB): periksa dulu (jumlah fitur, kolom yang belum ada, peringatan `.prj`, pratinjau peta), lalu simpan dengan mode **tambah** atau **ganti**.
- Ekspor GeoJSON dan CSV (aman dibuka di Excel).
- Membuat layer baru untuk data pendukung.
- **Diterima bila:** SHP berproyeksi UTM 49S (EPSG:32749) dengan `.prj` tampil di lokasi yang benar; SHP tanpa `.dbf`/`.shx` ditolak dengan pesan jelas; geometri rusak diperbaiki otomatis (`ST_MakeValid`).

### 5.6 Pengguna dan log
- Superadmin: tab menunggu, aktif, ditolak; setujui, tolak, ubah peran, hapus.
- Log aktivitas mencatat login, pendaftaran, dan semua perubahan data beserta IP.

## 6. Kebutuhan non-fungsional

| Aspek | Target |
|---|---|
| Keamanan | Hash password Argon2id; rate limit global, login, dan upload; Helmet dan CSP; validasi seluruh input dengan Zod; query berparameter; `.env` tidak masuk git; database hanya terbuka di localhost |
| Performa | LCP di bawah 2,5 detik di jaringan kantor; halaman login tidak memuat MapLibre atau Recharts (code splitting per halaman); aset hash di-cache 1 tahun; gzip di nginx |
| Aksesibilitas | Label pada semua kontrol, navigasi keyboard (komponen React Aria via HeroUI), menghormati `prefers-reduced-motion` |
| Responsif | Bisa dipakai dari lebar 360 px |
| Bahasa & tema | Bahasa Indonesia dan English; mode terang dan gelap, tersimpan per perangkat |
| Notifikasi | Toast & AlertDialog HeroUI untuk konfirmasi hapus dan pesan sukses/gagal |
| Kualitas | Unit/integration test dengan cakupan 100% di API dan web; TypeScript strict |
| Keandalan | Backup `pg_dump` harian (lihat DEPLOY.md) |

## 7. Arsitektur singkat

```
Browser ──► nginx (web) ──► /api/*  ──► Express API ──► PostgreSQL 17 + PostGIS 3.5
                     └──► aset statis (Vite build)        └─► /data/uploads (foto WebP/AVIF)
```

- Satu tabel `features` (geometry 4326 + `properties` jsonb) untuk semua layer, sehingga ada satu jalur CRUD, satu jalur tile, dan satu jalur statistik.
- Metadata layer (`fields`, `style`) menentukan form, legenda, dan warna peta.
- Vector tile dibuat langsung oleh PostGIS (`ST_AsMVT`); versi tile ikut `updated_at` layer yang diperbarui trigger, sehingga cache browser aman disimpan lama.

## 8. Rencana pengembangan

1. **v1.1:** import data resmi dari OPD, menyesuaikan nama atribut, uji beban.
2. **v1.2:** menggambar dan mengedit garis/poligon langsung di peta; riwayat versi fitur.
3. **v1.3:** analisis overlay (misalnya luas sawah di zona rawan banjir per kecamatan) dan ekspor laporan PDF.
4. **v2:** SSO pemerintah dan portal publik baca-saja untuk data yang boleh dibuka.
