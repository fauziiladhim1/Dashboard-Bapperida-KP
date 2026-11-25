# Audit Halaman Ringkasan dan Rujukan Riset

Status per 2026-11-19. Audit ini membaca kode `apps/web/src/features/overview/` dan `apps/api/src/modules/stats.ts`, lalu membandingkannya dengan [BLUEPRINT.md](BLUEPRINT.md) dan literatur di bagian 4. Aplikasi tidak sedang berjalan (web, API, dan Docker mati), jadi temuan tampilan berasal dari kode, bukan tangkapan layar. Cek ulang di browser sebelum dikerjakan.

Prioritas: **P1** mengubah makna angka atau keputusan, **P2** mengurangi beban baca, **P3** kerapian.

---

## 1. Masalah data dan metrik (paling penting)

| # | Temuan | Lokasi | Kenapa bermasalah | Usulan | Prio |
|---|---|---|---|---|---|
| D1 | Hero dan peringkat wilayah memakai **jumlah jiwa miskin absolut** | `OverviewPage.tsx:83-96` | Kecamatan berpenduduk banyak selalu tampak "terparah". Riset spasial kemiskinan membandingkan wilayah dengan rasio atau persentase, bukan jumlah mentah (Hasibuan dkk. 2019; Khoir dkk. 2025) | Tampilkan **% penduduk miskin** (jiwa miskin / penduduk) sebagai angka utama dan dasar peringkat; jumlah jiwa jadi keterangan. Perlu tabel penduduk per kalurahan (BPS/Dukcapil) | P1 |
| D2 | Satuan kemiskinan 2024 berbeda (tampak KK, bukan jiwa); ditambal heuristik rasio 25% | `widgets.tsx:450-459`, `OverviewPage.tsx:85` | Heuristik menebak; tahun lain yang turun tajam secara wajar bisa salah ditandai "tak sebanding" | Perbaiki di sumber: kolom `satuan` saat `db:import`, atau konversi KK → jiwa dengan faktor resmi. Setelah itu hapus `incomparableYears` | P1 |
| D3 | KPI jalan menghitung **jumlah ruas**, bukan km | `OverviewPage.tsx:113-116, 196` | Ruas 0,3 km dan 12 km dihitung sama. Indikator resmi PUPR untuk jalan kabupaten adalah **kemantapan jalan** (% panjang Baik + Sedang) | Angka utama = **% kemantapan (km)**; km rusak berat jadi keterangan. Data km sudah ada (`panjang_km`, `rusak_berat`) | P1 |
| D4 | Ambang kelas kondisi ruas 20% adalah aturan buatan sendiri | komentar `OverviewPage.tsx:51-52`, fungsi SQL `ruas_props` | Angka "ruas rusak berat" bergantung pada ambang yang tidak dirujuk ke pedoman | Cantumkan dasar ambang (pedoman Bina Marga atau keputusan Dinas PU) di catatan kartu, atau langsung pakai km per kondisi tanpa reklasifikasi ruas | P1 |
| D5 | Kartu bencana menyebut "potensi", padahal yang dihitung **kelas bahaya**, bukan risiko | `HazardCard`, `widgets.tsx:653-682` | Risiko = bahaya × kerentanan ÷ kapasitas. Penentuan bencana prioritas Kulon Progo juga memakai jiwa terpapar dan frekuensi kejadian, bukan luas bahaya saja (Media Komunikasi Geografi 2024) | Ganti label jadi "Kalurahan berkelas bahaya tinggi". Tambahkan **jiwa terpapar** bila InaRISK menyediakannya | P1 |
| D6 | KPI Utilitas Umum menjumlah semua jenis fasilitas | `OverviewPage.tsx:213-217` | Masjid + sekolah + puskesmas dijumlah jadi satu angka yang tidak bisa ditindaklanjuti. Kunci i18n `ov.kpiSpm` menunjukkan niat awal SPM, tapi isinya inventaris | Ganti dengan indikator layanan: mis. fasilitas kesehatan per 10.000 penduduk per kecamatan. Bila data penduduk belum ada, pindahkan kartu ini ke Peta | P2 |
| D7 | KPI Tutupan Lahan menampilkan **luas total** semua kelas | `OverviewPage.tsx:222-227` | Luas total tutupan ≈ luas kabupaten. Angkanya hampir tetap dan tidak menjawab pertanyaan apa pun. Kunci `ov.kpiSawah` menunjukkan niat awal "luas sawah" | Pilih satu: luas sawah/pertanian dan perubahannya, atau hapus kartu dari Ringkasan (komposisi tetap ada di Peta) | P2 |
| D8 | Treemap Pola Ruang menampilkan **luas total rencana** | `PolaRuang`, `widgets.tsx:751-801` | Sama dengan D7: total rencana ≈ luas wilayah. Data `Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan` sudah diimpor tapi kesesuaiannya tidak ditampilkan | Angka utama = **% luas penggunaan lahan yang tidak sesuai pola ruang**, rincian per kecamatan. Ini yang dibutuhkan perencana | P2 |
| D9 | KPI PJU hanya jumlah titik | `OverviewPage.tsx:205-211` | Blueprint menjanjikan "PJU · % LED" dan rasio per km jalan. Jumlah titik tanpa pembanding tidak menunjukkan cukup atau kurang | Rasio PJU per km jalan per kecamatan, atau pindahkan ke Peta | P2 |
| D10 | Topik "Layer" di grafik tren menghitung jumlah fitur per tahun | `widgets.tsx:484, 490-491` | Jumlah fitur adalah hasil input data, bukan kondisi wilayah. Fitur yang belum diunggah terbaca sebagai "turun" | Hapus topik ini dari tren | P3 |

## 2. Yang belum ada: sintesis lintas indikator

Pertanyaan persona utama di Blueprint A adalah *"Wilayah mana yang paling butuh intervensi tahun ini?"*. Halaman sekarang menjawabnya per sektor secara terpisah: kemiskinan, jalan, bahaya, dan lahan masing-masing punya kartu sendiri, dan pengguna harus menggabungkannya di kepala.

Usulan minimum, tanpa halaman baru:

1. **Tabel prioritas kecamatan/kalurahan** (5–10 baris) dengan kolom: % miskin, % jalan tidak mantap, jumlah jenis bahaya tinggi, dan skor gabungan.
2. Skor gabungan = rata-rata nilai yang dinormalisasi min–max (0–1) per indikator. Bobot sama dulu; bobot AHP baru dipakai bila Bapperida menetapkannya. Tampilkan rumusnya di kartu agar angka bisa ditelusuri (syarat PRD 5.4).
3. Tahap berikutnya: **LISA** (Local Moran's I) pada % miskin per kalurahan untuk menandai klaster *high-high*. Metode ini dipakai pada 165 desa di Bandung Barat (Hasibuan dkk. 2019) dan pada desa di Kulon Progo (Rahayu & Muta'ali 2024). PostGIS tidak punya LISA bawaan, jadi hitung sekali di skrip import (PySAL/GeoDa), bukan per permintaan.

Kartu insight teks (Blueprint F) bisa dibuat dari tabel ini, tanpa query tambahan.

## 3. Tampilan dan interaksi

| # | Temuan | Lokasi | Usulan | Prio |
|---|---|---|---|---|
| U1 | Halaman terlalu panjang untuk persona pimpinan: hero, 3 KPI, tutupan lahan selebar penuh, peta + jalan, tren, pola ruang + bencana (9 blok). Blueprint menargetkan "muat 1 layar di 1440px, 4 KPI" | `OverviewPage.tsx:172-254` | Urutan baru: (1) 4 KPI: % miskin, % kemantapan jalan, kalurahan bahaya tinggi, % lahan tidak sesuai pola ruang; (2) tabel prioritas + peta; (3) tren. Tutupan lahan, PJU, dan utilitas pindah ke Peta | P2 |
| U2 | Jalan tampil dua kali: KPI ruas rusak berat dan panel Kondisi Jalan | `OverviewPage.tsx:196-203, 234-235` | Gabungkan: panel Kondisi Jalan memuat angka kemantapan (D3) dan daftar 3 ruas terburuk | P2 |
| U3 | Kalimat pembuka "Kondisi wilayah ... **hari ini**" padahal data tahunan (survei/BPS 2023–2025) | `i18n.ts:111` | "Kondisi wilayah Kabupaten Kulon Progo menurut data terakhir {tahun}." | P2 |
| U4 | Dua kontrol waktu: tahun global di header dan rentang lokal di panel tren | `OverviewPage.tsx:42-45, 241` | Dengan 3–5 titik tahunan, rentang lokal hampir tidak berguna. Hapus `YearRange`; tren selalu menampilkan semua tahun | P3 |
| U5 | Rincian hanya muncul saat kursor diarahkan: donut tutupan lahan (`li` tanpa `tabIndex`), `RowTip`, sparkline `aria-hidden` | `widgets.tsx:177-183, 285, 321` | Pengguna sentuh dan keyboard tidak mendapat angka tersebut. Tampilkan angka inti tanpa hover; tambah tombol "Lihat sebagai tabel" (Blueprint G) | P2 |
| U6 | Sumber dan tanggal data hanya ada di kartu bencana | `widgets.tsx:677-679` | Tiap kartu menyebut sumber + tahun data (aturan Blueprint F) | P2 |
| U7 | Warna seri dan kelas jalan ditulis hex di komponen (`POOR_COLOR`, `SEGMENT_PARTS`), bukan token `index.css`; hijau–merah kelas jalan rawan bagi deuteranopia | `widgets.tsx:383-386, 599-606` | Pakai token `--div-*` dari Blueprint C. Label teks sudah ada, jadi risikonya kecil | P3 |
| U8 | Judul halaman = salam + nama pengguna; konteks wilayah dan tahun tidak tampil di judul | `OverviewPage.tsx:136` | Judul "Ringkasan Kulon Progo · {tahun}", salam jadi subjudul | P3 |
| U9 | Konten melebar tanpa batas di layar ≥ 1440px (Gap Blueprint C) | `AppShell.tsx` | `max-w-[1600px] mx-auto` | P3 |

## 4. Yang dikurangi

Berdasarkan bagian 1–3, berikut yang dihapus dari Ringkasan (tetap ada di Peta atau Data):

- Kartu Tutupan Lahan selebar penuh (D7)
- KPI PJU dan KPI Utilitas Umum, sampai ada rasio atau data penduduk (D6, D9)
- KPI "ruas rusak berat", digabung ke panel Kondisi Jalan (U2)
- Topik "Layer" di grafik tren (D10)
- `YearRange` lokal di panel tren (U4)
- Heuristik `incomparableYears`, setelah satuan diperbaiki di data (D2)

Hasilnya halaman lebih pendek dan setiap angka yang tersisa bisa ditindaklanjuti.

## 5. Evaluasi setelah perbaikan

Belum ada pengukuran kegunaan dengan pengguna Bapperida. Dua studi di bawah memakai **System Usability Scale (SUS)** untuk dashboard dan WebGIS pemerintah, dengan skor 69,72 dan 70,50. Rencana minimum:

1. 5–10 responden dari Bapperida dan OPD (pimpinan, analis, operator).
2. Tugas berwaktu, mis. "Sebutkan 3 kalurahan prioritas tahun 2025", "Berapa km jalan rusak berat di Kec. Wates?". Catat waktu, klik, dan galat, seperti metrik efisiensi dan error rate pada studi Zetroem 2025.
3. Kuesioner SUS 10 butir. Acuan umum skor rata-rata adalah 68; di bawahnya berarti perlu perbaikan.

## 5a. Cek ulang 2026-11-20

**Sudah diperbaiki.** Lint web gagal karena redesign Ringkasan (bagian 4) sempat dikerjakan lalu di-rewind: komponen kembali ke versi lama, tetapi `lib/i18n.ts`, `test/pages.test.tsx`, dan `test/gaps.test.tsx` tertinggal di versi redesign. Atas keputusan pemilik proyek, ketiganya dikembalikan ke versi lama (dari backup riwayat sesi), jadi dashboard tetap versi lama dan usulan di bagian 1–4 masih berupa backlog.

Coverage API kembali 100% dengan tiga tes baru: registrasi dengan password yang memuat nama, PATCH `/auth/me` dengan `nip: ''`, dan raster InaRISK tanpa data serta seed layer tanpa `sumber`.

**Cek 2026-11-21.** Coverage web kembali 100% (200 tes) lewat tiga berkas tes baru: `test/hazard.test.tsx`, `test/overview-gaps.test.tsx`, dan `test/final-gaps.test.tsx`. Cabang yang tidak mungkin tercapai dihapus, bukan dibuatkan tes: properti `where` di `VectorLayers` (tidak pernah diisi), cabang legenda tanpa `onHidden`, guard `matchMedia` di `PolaRuang`, dan fallback `|| undefined` untuk Tahun data (isiannya wajib). Tes yang gagal acak saat suite penuh disebabkan batas `findBy` 1 detik; batas itu dinaikkan ke 5 detik di `test/setup.tsx`. Mode "Ganti semua" pada unggah SHP sudah dicoba di browser pada layer uji (fitur lama terhapus, tahun data ikut berubah), lalu layer uji dihapus.

## 5b. Keamanan dan infrastruktur

| Aspek | Kondisi | Keputusan |
|---|---|---|
| Brute force login | express-rate-limit: 10 gagal/15 menit per IP | **Ditambah** limit per email (5 gagal/15 menit, `app.ts`) dan nginx `limit_req` 10/menit per IP, burst 5 (`docker/nginx.conf`) |
| `TRUST_PROXY` | Dikunci `2` di compose, padahal produksi tanpa proxy depan: header `X-Forwarded-For` palsu dipercaya dan limit per IP bisa dilewati | **Diperbaiki**: `PROD_TRUST_PROXY` di `.env`, default `1` |
| Rate limit lain / throttling | Global 1500/15 menit (tile dikecualikan), registrasi 5, upload 30 | Sudah cukup |
| Caching | Aset hash `max-age` maksimal, `index.html` divalidasi ulang, tile `private` 1 hari dengan versi di URL, foto `immutable`, TanStack Query di klien | `/stats/batas-kabupaten` memakai `public` padahal di balik login. Risiko rendah (batas wilayah = data publik); ganti ke `private` bila ingin konsisten. Cache sisi server (Redis) belum perlu |
| Load balancing | 1 VM, 1 container API | Belum perlu. Bila API diskalakan, store rate limit harus dipindah ke Postgres/Redis karena sekarang di memori proses |
| Reverse proxy | nginx: gzip, header keamanan, CSP, batas body 55 MB | TLS + HSTS wajib dipasang di nginx karena tidak ada proxy depan |
| API gateway | nginx sudah merutekan `/api` dan `/uploads` | Tidak perlu gateway terpisah |
| CI/CD | Belum ada | **Ditambah** `.github/workflows/ci.yml`: lint, tes dengan PostGIS, build, build image Docker. Deploy tetap manual (`docs/DEPLOY.md` bagian 6) |
| Health check & shutdown | `/health` menguji DB; SIGTERM menutup server lalu pool DB | Sudah ada |

---

## 6. Rujukan

Peringkat SINTA dicek langsung di profil jurnal pada sinta.kemdiktisaintek.go.id pada 2026-11-19. Peringkat bisa berubah tiap periode akreditasi.

### Kemiskinan dan analisis spasial

| Rujukan | SINTA | Dipakai untuk |
|---|---|---|
| Khoir, R. A., Sambodo, N. P., & Salim, A. (2025). Analisis Pola Spasial Persebaran Penduduk Miskin di Kota Yogyakarta. *Jurnal Pembangunan Wilayah dan Kota*, 21(3), 331–344. https://doi.org/10.14710/pwk.v21i3.68421 | S2 | D1, bagian 2. Data DTKS 2023 (29.481 sasaran), pola berkelompok dengan Average Nearest Neighbor. Salah satu penulis dari Bappeda Kota Yogyakarta |
| Hasibuan, Juanda, & Mulatsih (2019). Analisis Sebaran dan Faktor Penyebab Kemiskinan di Kabupaten Bandung Barat. *Jurnal Agribisnis Indonesia*, 7(2), 79–91. https://doi.org/10.29244/jai.2019.7.2.79-91 | S2 | Bagian 2. Moran's I 0,464 pada 165 desa; LISA: 17 desa high-high, 31 low-low |
| Rahayu, D., & Muta'ali, L. (2024). Pola Spasial Pergeseran Pusat Pertumbuhan Desa di Kabupaten Kulon Progo. *Journal of Regional and Rural Development Planning*, 8(3), 197–212. https://doi.org/10.29244/jp2wd.2024.8.3.197-212 | S3 | Bagian 2. Kulon Progo kabupaten termiskin dan paling timpang di DIY; Moran's I dan LISA; pusat pertumbuhan desa tidak menimbulkan efek tetes ke bawah |
| Widiyanto, D. (2018). An Exploration of Food Insecurity, Poverty, Livelihood and Local Food Potentials in Kulon Progo Regency, Indonesia. *Forum Geografi*, 32(1). https://doi.org/10.23917/forgeo.v32i1.5818 | S1 | D1, bagian 2. 20 dari 88 desa berkategori parah (11 kemiskinan, 7 rawan pangan, 2 keduanya); mayoritas di zona perbukitan. Contoh tipologi 3×3 kemiskinan × kerawanan pangan |
| Prawoto, N., & Basuki, A. T. Penyusunan indikator dan pemetaan kantong kemiskinan Kabupaten Kulon Progo. *Jurnal Ekonomi & Studi Pembangunan* (UMY). https://journal.umy.ac.id/index.php/esp/article/download/1239/1297/3492 | S2 | Bagian 2. Kantong kemiskinan per kecamatan dengan LQ dan Tipologi Klassen. Volume dan tahun belum terverifikasi (PDF tidak bisa diakses otomatis); cek sebelum dikutip |

### Bencana

| Rujukan | SINTA | Dipakai untuk |
|---|---|---|
| Menentukan Jenis Bencana Prioritas pada Level Kabupaten: Studi Kasus Kabupaten Kulon Progo. *Media Komunikasi Geografi*, 25(1), 243–256 (2024). https://ejournal.undiksha.ac.id/index.php/MKG/article/view/74329 | S3 | D5. Prioritas Kulon Progo: longsor dan banjir; kriteria luas bahaya, jiwa terpapar, frekuensi kejadian dari InaRISK. Nama penulis belum terverifikasi (halaman menolak akses otomatis) |

### Dashboard, WebGIS, dan evaluasi kegunaan

| Rujukan | SINTA | Dipakai untuk |
|---|---|---|
| Mulyani, E., Yusuf, D., & Rini, E. M. (2025). Implementasi Usability Testing dengan System Usability Scale pada Dashboard Monitoring Dinas Kesehatan Kabupaten Banyuwangi. *Journal Zetroem*, 7(1), 1–10. https://doi.org/10.36526/ztr.v7i1.4184 | S2 | Bagian 5. SUS 69,72; efisiensi 96,13%; error rate 2,22%; klik turun dari 8 ke 5 |
| Evaluasi Usability pada Web GIS Pemantauan Kesehatan Hutan Menggunakan Metode System Usability Scale (SUS). *MATRIK*, Universitas Bumigora (2020). https://journal.universitasbumigora.ac.id/index.php/matrik/article/view/709 | S2 | Bagian 5. SUS 70,50 (kategori *good*) untuk WebGIS. Nama penulis belum terverifikasi |
| Fatoni (2026). Optimizing Regional Financial Information Systems in Indonesia: A CIPP Evaluation Approach to Institutional Capacity Asymmetry. *Jurnal Bina Praja*, 18(1), 35–45. https://doi.org/10.21787/jbp.18.2026.3280 | S2 | Konteks: kesenjangan SDM dan infrastruktur digital pemda dalam sistem data terpadu (SIPD). Relevan untuk bab latar belakang, bukan desain |

### Pendukung internasional (bukan SINTA, terindeks Scopus Q1)

- Sarikaya, A., Correll, M., Bartram, L., Tory, M., & Fisher, D. (2019). What Do We Talk About When We Talk About Dashboards? *IEEE TVCG*, 25(1). https://doi.org/10.1109/TVCG.2018.2864903 — tipologi tujuan dashboard (strategis vs operasional). Dasar memisahkan Ringkasan (pimpinan) dari Peta/Data (analis/operator).
- Bach, B., dkk. (2023). Dashboard Design Patterns. *IEEE TVCG*, 29(1). https://doi.org/10.1109/TVCG.2022.3209448 — pola tata letak, jumlah halaman, dan abstraksi metrik. Dasar U1.

### Dicek tetapi tidak dipakai (di bawah SINTA 3 atau peringkat tidak ditemukan)

JATISI (S5 saat ini), Jurnal Pendidikan Teknologi dan Kejuruan Undiksha (S4, studi E-Musrenbang Badung), Teknika Sains (S5, prioritas jalan Ogan Ilir dengan TOPSIS), Resolusi (S4–S5), Jurnal Geodesi Undip (peringkat tidak ditemukan). Untuk prioritas penanganan jalan dengan AHP/SIG belum ada rujukan SINTA ≤ 3 yang terverifikasi. Kandidat yang bisa dicari manual: *Jurnal Aplikasi Teknik Sipil* ITS (S3) dan *Jurnal Teknik Sipil* ITB (S2).
