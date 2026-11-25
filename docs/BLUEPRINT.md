# Blueprint Dashboard Spasial SIPWIL Kulon Progo

Pedoman desain dan backlog untuk Dashboard Bapperida. Dokumen ini berangkat dari aplikasi yang sudah berjalan (lihat [PRD.md](PRD.md)), bukan desain dari nol: pola yang ada dijadikan standar, gap ditandai **Gap**, dan contoh kode memakai komponen serta class yang sudah ada di `apps/web/src`.

Status per 2026-11-15. Item bertanda **Gap** adalah backlog, belum dikerjakan.

---

## A. Persona, hierarki informasi, IA

### Persona

| Persona | Pertanyaan utama | Layar utama | Kepadatan | Peran RBAC |
|---|---|---|---|---|
| Kepala Daerah / Kepala Bapperida | Wilayah mana yang paling butuh intervensi tahun ini? | Ringkasan: 4 KPI, insight, peta | Rendah. Muat 1 layar di 1440px | `viewer` |
| Kepala Dinas (PUPR, Pariwisata, BPBD) | Bagaimana kondisi sektor saya per kecamatan dibanding tahun lalu? | Peta dengan preset sektor, kartu Ringkasan sektornya | Sedang: chart + ranking | `viewer` |
| Analis Perencana | Berapa ha sawah di zona rawan banjir tinggi per kecamatan? | Peta multi-layer, Analisis (v1.3), ekspor CSV/GeoJSON | Tinggi: tabel, filter, overlay | `viewer` / `editor` |
| Operator Lapangan | Ruas/PJU ini kondisinya apa, fotonya mana, saya perbarui. | Data (CRUD), peta mobile (bottom sheet) | Fokus 1 fitur, target sentuh 40px | `editor` |

Admin sistem memegang `superadmin` (persetujuan akun, peran, log).

### Hierarki metrik

- **Primary**, baris KPI Ringkasan: penduduk miskin + selisih tahun sebelumnya, ruas Rusak Berat (jumlah + km), jumlah PJU + % LED, jumlah destinasi wisata.
- **Secondary**, panel di bawah KPI: kondisi jalan per kecamatan, kalurahan risiko bencana tinggi per jenis, kesesuaian pola ruang per kecamatan, tren tahunan.
- **Tertiary**, lewat hover, klik, atau tabel: atribut fitur, foto dokumentasi, parcel status tanah, inventaris layer, log aktivitas.

Aturan: angka primary harus terbaca dalam 5 detik tanpa interaksi. Semua yang butuh klik masuk secondary atau tertiary.

### Sitemap

```
/              Ringkasan (eksekutif)
/peta          Peta multi-layer
/analisis      Gap: indeks prioritas & overlay (PRD 5.4, v1.3)
/data/:slug    Tabel + CRUD per layer
/pengguna      superadmin
/log           editor, superadmin
/akun          semua
```

Modul tematik (Jalan, Bencana, Wisata, Pertanian) **tidak** dibuat sebagai halaman terpisah. **Gap:** preset layer lewat URL, `/peta?preset=jalan`, yang menyalakan layer sektor itu dan membuka legendanya. Sepuluh dataset dengan halaman masing-masing berarti sepuluh halaman yang harus dirawat. Preset cukup satu halaman dengan sepuluh konfigurasi, dan URL-nya bisa dibagikan seperti filter `kec`/`tahun` yang sudah ada.

---

## B. Struktur layout

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ Logo SIPWIL  │ Header: [Cari… Ctrl+K]              [ID|EN] [☾] [🔔] [Akun]│
│──────────────├────────────────────────────────────────────────────────────┤
│ UTAMA        │ PageHeader: Salam, nama · tanggal                          │
│ ▣ Ringkasan  │   [Kecamatan ▾] [Tahun ▾] │ [Kelola data] [Buka peta →]    │
│ ◎ Peta       ├───────────┬───────────┬───────────┬────────────────────────┤
│ ◇ Analisis   │ Miskin    │ Jalan RB  │ PJU · LED │ Wisata    3+3+3+3 kol  │
│ ▤ Data       ├───────────┴───────────┴───────────┼────────────────────────┤
│ ADMIN        │ MiniMap (8 kol)                   │ Potensi Bencana (4)    │
│ ☺ Pengguna   │                                   │                        │
│ ≡ Log        ├───────────────────────────────────┼────────────────────────┤
│ AKUN         │ Kondisi Jalan (6)                 │ Kesesuaian Ruang (6)   │
│ ⚙ Akun       ├───────────────────────────────────┴────────────────────────┤
│ ⇥ Keluar     │ Tren tahunan + rentang tahun lokal (12)                    │
│              ├────────────────────────────────────────────────────────────┤
│              │ Footer: ©                                                  │
└──────────────┴────────────────────────────────────────────────────────────┘
```

| Bagian | Implementasi | Catatan |
|---|---|---|
| Header | `components/layout/AppShell.tsx`, `GlobalSearch.tsx` (Ctrl/⌘+K sudah terpasang), `PrefControls.tsx` (bahasa, tema) | **Gap:** ikon notifikasi, diisi alert (bagian E) |
| Filter global | `KecamatanSelect`, `YearSelect` di `PageHeader`; state `kec`/`tahun` di URL (`lib/year-range.ts`) | `YearRange` di panel tren sengaja lokal. Subtitle panel menyebut rentangnya agar pengguna tahu dua kontrol waktu itu terpisah |
| KPI | `features/overview/widgets.tsx#Kpi`, grid `lg:grid-cols-12`, tiap KPI `lg:col-span-3` | 4 KPI. KPI ke-5/6 (kalurahan risiko tinggi, luas pertanian) hanya ditambah bila diminta pimpinan |
| Visual utama | `MiniMap` (8 kolom) di Ringkasan; `PetaPage` layar penuh | Klik fitur di peta mini membuka `/peta?f=…` dengan popup |
| Panel analitik | `Panel` + `HazardCard`, `RoadOverview`, `Kesesuaian`, `TimeSeries` | Pola sama: judul, satu angka sorot, satu pembanding, rincian |
| Sidebar | `components/layout/Sidebar.tsx`: penuh, ringkas 80px, drawer mobile | |
| Footer | `AppShell.tsx`: © saja. Sumber per layer tampil di popup fitur Peta (`layer.sumber`) | Diputuskan 2026-11-15: footer tanpa sumber/disclaimer |

---

## C. Design system

Sumber kebenaran: `apps/web/src/index.css`. Token baru hanya ditambah di file itu.

### Warna

| Peran | Token | Light | Dark |
|---|---|---|---|
| Latar halaman | `--background` | `#ecebe6` | `#141815` |
| Kartu | `--surface` | `#ffffff` | `#1c211e` |
| Judul | `--heading` | `#1d2420` | `#eef0ec` |
| Teks | `--foreground` | `#5b625c` (6.3:1) | `#b4bbb5` (8.3:1) |
| Primary | `--accent` | `#3f6650` (6.5:1 dgn putih) | `#8fbf9f` |
| Success / Warning / Danger | `--success` `--warning` `--danger` | `#13875a` `#9a6a10` `#d9304f` | `#4ade9a` `#fdc16a` `#ff7a93` |
| Kategori chart | `--chart-1..5` | sage, mint, pasir, tosca, lavender | sama |

**Skala spasial (Gap, satu-satunya tambahan palet):**

```css
:root {
  /* Sekuensial, satu hue hijau: magnitudo (luas, kepadatan, % rusak). */
  --seq-1: #e8efe9; --seq-2: #bcd3c2; --seq-3: #8bb197; --seq-4: #5a8a6b; --seq-5: #2f5040;
  /* Divergen: baik -> netral -> buruk (indeks prioritas, risiko). */
  --div-1: #2f6b4f; --div-2: #8fbf9f; --div-3: #e5d5ae; --div-4: #e08a5c; --div-5: #b3261e;
}
```

Aturan pakai:
- Kategori (jenis lahan, jenis utilitas) memakai `--chart-*` atau warna kelas di `layer.style`.
- Magnitudo memakai `--seq-*`. Jangan pakai pelangi.
- Arah baik-buruk memakai `--div-*`. Merah hanya untuk arah buruk, aturan yang sudah dipakai di `OverviewPage`.
- Warna layer data tidak berubah antara tema terang dan gelap, supaya legenda bermakna sama. Basemap saja yang mengikuti tema.
- Kelas risiko selalu punya label teks; jangan mengandalkan warna saja. Uji dengan simulasi deuteranopia sebelum rilis.

Nilai `--seq`/`--div` di atas adalah titik awal. Kontrasnya harus dicek terhadap basemap CARTO terang dan gelap sebelum dipakai.

### Tipografi

Font: Rubik, fallback `system-ui`. Ukuran dasar 14px (`text-sm` di `body`).

| Level | Ukuran / line-height | Berat | Dipakai di |
|---|---|---|---|
| H1 | 24 / 32 | 500 | Judul halaman (`PageHeader`) |
| H2 | 18 / 24 | 500 | Judul kartu (`.card__title`) |
| H3 | 16 / 24 | 500 | Subjudul dalam panel |
| Angka KPI | 32 / 40 | 500, `tabular-nums` | `Kpi` |
| Body | 14 / 20 | 400 | Teks umum |
| Caption | 12 / 16 | 400–500 | Kolom tabel (`.table__column`), legend, keterangan |

H4–H6 tidak dipakai. Tiga level heading cukup untuk dashboard, dan level tambahan hanya menambah keputusan desain.

### Spacing & bentuk

Grid 4pt: 4, 8, 12, 16, 24, 32.

| Elemen | Nilai |
|---|---|
| Tinggi kontrol (tombol, select, field) | 40px |
| Gap grid dashboard | 24px (`gap-6`) |
| Padding kartu | 24px (`p-6`) |
| Radius kontrol / kartu / modal / popover | 10px / 20px / 16px / 12px |

### Komponen

| Komponen | Implementasi | Status |
|---|---|---|
| Card / panel | `components/common/Panel.tsx`, utility `card-surface`, `card-lift` | Ada |
| KPI tile | `features/overview/widgets.tsx#Kpi` | Ada |
| Filter | `KecamatanSelect`, `YearSelect`, `YearRange` | Ada |
| Filter chip (filter aktif, bisa dihapus) | `components/common/FilterChip.tsx`; dipakai di Ringkasan untuk kelas jalan yang disembunyikan | Ada |
| Legend peta | `features/peta/PetaPage.tsx#Legend`, `LegendSymbol` | Ada, belum di-export |
| Tabel | HeroUI `Table` (`.table-root`), `components/common/Pagination.tsx` | Ada |
| Tooltip | `components/common/Tip.tsx`, `components/map/MapOverlays.tsx#HoverTip` | Ada |
| Empty state | `widgets.tsx#Empty`: "belum ada data" berbeda dari 0, ajakan unggah hanya untuk editor | Ada |
| Loading skeleton | utility `skeleton`, `components/common/Loading.tsx` | Ada |
| Error state | `Empty` dengan `retry`, `ErrorAlert`, `ErrorBoundary`, `features/errors/ErrorPage.tsx` | Ada |
| Badge urgensi | `components/common/UrgencyBadge.tsx` | Ada |

### Ikon

Gravity UI Icons (`@gravity-ui/icons`) sudah terpasang dan dipakai di seluruh aplikasi. Jangan menambah Lucide, Heroicons, atau Phosphor: dua set ikon membuat ketebalan garis tidak seragam dan menambah ukuran bundle.

### Dark / light mode

Sudah ada lewat class `.dark` dan `PrefsProvider` (tersimpan per perangkat). Saat menambah warna, definisikan untuk `:root` dan `.dark` sekaligus, lalu cek kontras teks ≥ 4.5:1 dan elemen grafis ≥ 3:1 di atas `--surface` kedua tema.

### Breakpoint

| Nama | Lebar | Perilaku |
|---|---|---|
| Mobile | < 640 | 1 kolom; panel layer peta jadi bottom sheet (`MobilePanel`); sidebar jadi drawer |
| Tablet (`sm`/`md`) | 640–1023 | 2 kolom; KPI 2×2 |
| Desktop (`lg`) | 1024–1439 | Grid 12 kolom penuh |
| Wide | ≥ 1440 | **Gap:** batasi konten `max-w-[1600px] mx-auto` agar kartu KPI tidak melebar berlebihan |

Lebar minimum yang didukung: 360px (PRD).

---

## D. Visualisasi per dataset

| Dataset | Peta / chart | Alasan | Interaksi | Status |
|---|---|---|---|---|
| Kondisi Jalan | Garis ruas berwarna kelas kondisi; stacked bar km per kecamatan | Kondisi melekat pada ruas, bukan area. Choropleth kecamatan menyembunyikan ruas mana yang rusak | Klik kelas di kartu = sembunyikan di peta mini; tahun survei ikut filter global | Ada (`RoadOverview`) |
| Potensi Bencana | Poligon kelas Rendah/Sedang/Tinggi per jenis; bar jumlah kalurahan risiko tinggi | Data InaRISK sudah berkelas. Heatmap dari poligon berkelas menciptakan gradasi yang tidak ada di data | Pilih jenis bahaya; hover kalurahan | Ada (`HazardLayer`, `HazardCard`). Risk matrix menunggu data kerentanan & eksposur |
| Penggunaan Lahan | Poligon per kelas; donut maksimal 6 irisan (sisanya "Lainnya") | Komposisi bagian-dari-keseluruhan. Lebih dari 6 irisan sudah sulit dibedakan | Klik irisan = filter peta | Sebagian. Sankey hanya bila ada data PL dua periode |
| Utilitas Umum | Titik per jenis; bar coverage per kecamatan terurut | Radar 88 kalurahan tidak bisa dibandingkan sekilas; bar terurut bisa | Filter jenis; klik titik = atribut + foto | Titik ada. **Gap:** bar coverage |
| Batas Administrasi | Garis batas + label sebagai rangka; host choropleth | Acuan semua layer lain | Pilih kecamatan; **Gap:** drill ke kalurahan | Filter kecamatan ada |
| Kawasan Strategis (SRS, Aerotropolis, Penyangga KSPN Borobudur, Geopark) | Poligon outline tebal + isi transparan | Dipakai sebagai overlay; isi pekat menutupi data di bawahnya | Toggle per jenis, slider opacity | Ada |
| Status Tanah | Poligon parcel per status; stacked bar luas per kecamatan | Sengketa harus menonjol (`--danger`), status lain netral | Filter status; klik parcel | Menunggu data |
| PJU | Titik, cluster di zoom rendah; rasio PJU per km jalan per kecamatan; meter % LED | Ribuan titik bertumpuk di zoom kabupaten. Rasio per km membuat kecamatan sebanding | Expand cluster; filter jenis lampu | Titik + meter LED ada. **Gap:** cluster, rasio/km |
| Kawasan Pertanian | Turunan PL; choropleth luas per kecamatan (`--seq`); tren produktivitas | Luas adalah magnitudo | Klik kecamatan | Luas ada. Produktivitas butuh data BPS/Distan |
| Kawasan Pariwisata | Titik destinasi per jenis; bar top 10 | Dinas Pariwisata butuh ranking | Klik bar = terbang ke titik | KPI ada. Flow map menunggu data asal-tujuan pengunjung |

Prinsip: pilih visual dari bentuk data yang ada, bukan dari daftar chart yang menarik. Risk matrix, Sankey, dan flow map ditunda sampai datanya tersedia; menggambarnya dari data yang belum ada berarti mengarang.

---

## E. Fitur interaktif & analitik

| Fitur | Status | Rencana |
|---|---|---|
| Filter global tahun & kecamatan | Ada, di URL | |
| Cross-filter | Sebagian: kelas di kartu jalan menyaring peta mini (`hidden: Record<slug, string[]>`) | Pakai pola `hidden` yang sama untuk kartu lain; tampilkan filter aktif sebagai `FilterChip` di PageHeader |
| Drill-down Kab → Kec → Kalurahan | Kecamatan ada | **Gap:** param `kal` di URL + `FitBounds` ke bbox kalurahan |
| Compare mode | Tidak ada | `?kec=A&vs=B`, KPI tampil dua kolom. Prioritas rendah |
| Time-series | `YearRange` di panel tren | Cukup. Slider animasi tidak berguna untuk 3–5 titik data tahunan |
| Export | GeoJSON & CSV per layer | **Gap:** PDF ringkasan lewat `window.print()` + `@media print` dulu; generator PDF server di v1.3 |
| Share / bookmark | State sudah di URL | **Gap:** tombol "Salin tautan" (`navigator.clipboard.writeText(location.href)`) |
| Alert / anomali | Tidak ada | **Gap:** aturan di API, mis. selisih tahunan > ambang, kalurahan risiko tinggi yang juga punya ruas rusak berat. Tampil di insight card dan ikon lonceng |
| Command palette | `GlobalSearch`, Ctrl/⌘+K | Tambah aksi navigasi (buka halaman, ganti tema) di samping pencarian fitur |

---

## F. Narasi data

Alur Ringkasan: **Overview** (baris KPI) → **Insight** (kartu kalimat di bawah KPI, **Gap**) → **Action** (tautan ke `/peta` dengan preset dan filter terisi).

Insight dihasilkan dari template + angka query, deterministik, bukan LLM. Angka harus bisa ditelusuri ke data sumber (syarat PRD 5.4).

### Contoh template

```
1. Jalan
   "Ruas Rusak Berat di Kec. {kec} naik {delta_km} km ({delta_pct}%) dibanding survei {tahun_lalu}.
    Terpanjang: {nama_ruas}, {km} km."
   Aksi: Lihat ruas di peta  ->  /peta?preset=jalan&kec={kec}&tahun={tahun}

2. Bencana × pertanian (butuh overlay v1.3)
   "{ha} ha sawah irigasi berada di zona rawan banjir tinggi; {pct}% di antaranya di Kec. {kec_top}."
   Aksi: Buka overlay  ->  /analisis?a=banjir-sawah

3. Kemiskinan
   "Penduduk miskin {tahun} {naik|turun} {abs_delta} jiwa ({pct}%) dari {tahun_lalu}."
   Aksi: Lihat tren  ->  #tren
```

### Aturan insight card

- Tampil hanya bila |selisih| ≥ ambang (awal: 5%) dan data dua periode tersedia. Tanpa itu, kartu tidak muncul. Jangan tampilkan kalimat kosong.
- Selalu cantumkan tahun dan sumber data.
- Kata kerja netral: naik, turun, tetap. Tanpa kata sifat penilaian seperti "mengkhawatirkan".
- Isi kartu: kalimat, satu angka sorot, satu tautan aksi, tag sumber.
- Maksimal 3 kartu, diurutkan dari selisih terbesar.

---

## G. Aksesibilitas & performa

### Aksesibilitas (WCAG 2.1 AA)

- Kontras token sudah dihitung di komentar `index.css`. Setiap token baru (termasuk `--seq`/`--div`) dicek dengan cara yang sama.
- Chart: `aria-label` berisi ringkasan, plus tabel data `sr-only` atau tombol "Lihat sebagai tabel".
- Peta: `aria-label` menyebut layer aktif dan filter; insight card berfungsi sebagai deskripsi teks peta. Peta Ringkasan sudah memakai `cooperativeGestures` agar scroll halaman tidak terjebak.
- Keyboard: komponen React Aria (HeroUI) sudah bisa dioperasikan keyboard. Uji urutan tab Header → PageHeader → KPI → panel. Item legend memakai checkbox `sr-only` dengan fokus terlihat (`has-focus-visible:ring-2`).
- `prefers-reduced-motion` sudah dihormati di CSS dan `MotionConfig`.

### Performa

| Teknik | Status |
|---|---|
| Vector tile dari PostGIS (`ST_AsMVT`), versi tile mengikuti `updatedAt` layer | Ada |
| Code splitting per route; halaman login tanpa MapLibre/Recharts | Ada |
| `placeholderData: keepPreviousData` agar ganti filter tidak berkedip | Ada |
| Simplifikasi geometri per zoom di SQL tile | Cek, tambah bila poligon PL berat |
| Cluster titik PJU di zoom rendah | **Gap** |

Target: LCP < 2,5 detik di jaringan kantor, peta interaktif < 3 detik, ≥ 30 fps untuk 10.000 poligon (PRD 5.3).

---

## H. Stack

| Opsi | Komponen | Alasan |
|---|---|---|
| **Custom, pertahankan yang ada (rekomendasi)** | React 19, Vite 8, Tailwind 4, HeroUI v3, mapcn/MapLibre, Recharts, TanStack Query; Express 5, Zod; PostgreSQL 17 + PostGIS 3.5; Docker + nginx | Sudah berjalan dengan coverage tes 100% dan siap deploy ke VM Diskominfo. Next.js tidak menambah nilai: aplikasi internal di balik login, tanpa kebutuhan SEO atau SSR. Supabase adalah layanan cloud, bertentangan dengan hosting on-premise pemda |
| **Low-code pendamping** | Apache Superset (open source, self-host Docker), koneksi read-only ke PostGIS | Untuk analis yang butuh query dan chart ad-hoc tanpa developer. Power BI butuh lisensi dan cenderung membawa data keluar server pemda. Metabase lemah untuk data spasial |

Superset melengkapi, tidak menggantikan: dashboard utama tetap aplikasi custom karena butuh RBAC, CRUD, unggah SHP, dan audit.

---

## I. Struktur folder

Struktur di [README.md](../README.md) dipertahankan. File baru hanya dibuat ketika fiturnya dikerjakan:

```
apps/web/src/
  components/map/Legend.tsx            Gap: pindahkan Legend + LegendSymbol dari PetaPage agar bisa dipakai ulang
  features/overview/insights.tsx       Gap: InsightCard + template kalimat
  features/analisis/AnalisisPage.tsx   v1.3
apps/api/src/modules/stats.ts          Gap: GET /stats/insights, GET /stats/overlay (v1.3)
```

---

## J. Class & komponen siap pakai

### Konvensi penamaan

1. Tailwind utility langsung di JSX untuk hampir semua styling.
2. Pola yang berulang di banyak file dijadikan `@utility` di `index.css`: `card-surface`, `card-lift`, `nav-active`, `custom-shadow`, `skeleton`.
3. Class BEM bawaan HeroUI (`.card`, `.card__title`, `.button--primary`, `.table__cell`, `.chip`) ditimpa tampilannya di `@layer components`, tidak diganti nama.
4. Class khusus non-Tailwind hanya untuk elemen yang dibangun JS di luar React, mis. `.gloc` (marker lokasi).

Bila ada class lain di dashboard yang ingin dipertahankan, petakan ke salah satu dari empat kelompok di atas sebelum dipakai.

### 1. KPI card

Pemakaian komponen yang ada:

```tsx
import { Car } from '@gravity-ui/icons';
import { Kpi } from '@/features/overview/widgets';

<Kpi
  icon={Car}
  label="Ruas rusak berat"
  tone="bad"                                   // angka > 0 tampil merah
  value={jalan ? sum(jalan, 'count', 'Rusak Berat') : null}   // null = belum ada data, bukan 0
  format={(n) => `${fmt(n)} ruas`}
  loading={jalanQ.loading}
  delta={{ text: '+4 dari 2025', up: true, bad: true }}
  sub="38,2 km dari 412 ruas"
/>
```

Varian dengan sparkline, lewat `children` (dirender di dasar kartu):

```tsx
import { Line, LineChart, ResponsiveContainer } from 'recharts';

<Kpi icon={Persons} label="Penduduk miskin 2026" value={last.miskin} format={(n) => `${fmt(n)} jiwa`}
  delta={{ text: '−1.204 dari 2025', up: false, bad: false }}>
  <div className="h-10" role="img" aria-label={`Tren ${points[0].tahun}–${last.tahun}: ${points.map((p) => fmt(p.miskin)).join(', ')}`}>
    <ResponsiveContainer>
      <LineChart data={points}>
        <Line dataKey="miskin" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
</Kpi>
```

Sparkline tanpa sumbu dan tooltip: tugasnya hanya menunjukkan arah. Angka rinci ada di panel tren.

### 2. Container peta interaktif

Ringkasan memakai `MiniMap`. Untuk peta baru, ikuti pola yang sama:

```tsx
import { Card } from '@heroui/react';
import { Map, MapControls } from '@/components/ui/map';
import { VectorLayers } from '@/components/map/VectorLayers';
import { KULON_PROGO_CENTER } from '@/lib/layer-style';

<Card className="relative h-full min-h-[360px] overflow-hidden p-0">
  <div role="region" aria-label={`Peta ${layers.map((l) => l.name).join(', ')}${kec ? `, Kec. ${kec}` : ''}`} className="absolute inset-0">
    <Map center={KULON_PROGO_CENTER} zoom={9.6} attributionControl={{ compact: true }} cooperativeGestures>
      <MapControls position="bottom-right" showZoom />
      <VectorLayers layers={layers} kecamatan={kec} tahun={tahun} onFeatureClick={open} />
    </Map>
  </div>

  {/* Overlay judul: pointer-events-none agar peta tetap bisa digeser di bawahnya. */}
  <div className="pointer-events-none absolute top-4 left-4 max-w-[calc(100%-2rem)]">
    <div className="rounded-2xl bg-surface/90 px-4 py-2.5 shadow-card backdrop-blur">
      <h2 className="text-sm font-medium text-heading">Peta wilayah{kec ? `, ${kec}` : ''}</h2>
      <p className="text-xs text-muted">Diperbarui {fmtDateTime(updated)}</p>
    </div>
  </div>
</Card>
```

`components/ui/map.tsx` adalah hasil generate mapcn; jangan diedit manual.

### 3. Panel filter

```tsx
<div className="flex flex-wrap items-center gap-2">
  <KecamatanSelect value={kec} onChange={setKec} className="w-full sm:w-56" />
  <YearSelect years={years} value={tahun} onChange={setTahun} />
  <span aria-hidden className="mx-1 hidden h-6 w-px bg-separator sm:block" />
  {active.map((f) => <FilterChip key={f.key} label={f.label} onRemove={() => clear(f.key)} />)}
  {active.length > 0 && (
    <button type="button" onClick={clearAll} className="text-xs text-accent hover:underline">Hapus semua filter</button>
  )}
</div>
```

`FilterChip` (sudah ada, label tombol hapus lewat i18n `common.removeFilter`):

```tsx
// components/common/FilterChip.tsx
import { Xmark } from '@gravity-ui/icons';

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-control bg-accent/10 pr-1 pl-3 text-xs text-accent-text">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Hapus filter ${label}`}
        className="grid size-6 place-items-center rounded-md hover:bg-accent/15">
        <Xmark className="size-3" aria-hidden />
      </button>
    </span>
  );
}
```

Urutan dalam baris filter: filter, pemisah, aksi sekunder, aksi primer di ujung kanan (sama dengan `OverviewPage`).

### 4. Tabel data

```tsx
import { Table } from '@heroui/react';
import { Pagination } from '@/components/common/Pagination';

<Table>
  <Table.ScrollContainer>
    <Table.Content aria-label="Kondisi jalan per kecamatan" className="min-w-[720px]">
      <Table.Header>
        <Table.Column isRowHeader>Kecamatan</Table.Column>
        <Table.Column className="text-right">Baik (km)</Table.Column>
        <Table.Column className="text-right">Rusak berat (km)</Table.Column>
        <Table.Column className="text-right">% rusak berat</Table.Column>
      </Table.Header>
      <Table.Body renderEmptyState={() => <p className="py-12 text-center text-sm text-muted">{loading ? 'Memuat…' : 'Belum ada data'}</p>}>
        {rows.map((r) => (
          <Table.Row key={r.kecamatan} id={r.kecamatan}>
            <Table.Cell>{r.kecamatan}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{fmt(r.baik)}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{fmt(r.rusakBerat)}</Table.Cell>
            <Table.Cell className={cn('text-right tabular-nums', r.pct >= 20 && 'font-medium text-danger')}>{pct(r.pct)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Content>
  </Table.ScrollContainer>
</Table>
<Pagination page={page} pages={pages} onChange={setPage} className="mt-4" />
```

Angka rata kanan dengan `tabular-nums` agar digit sejajar. Warna merah hanya untuk sel yang melewati ambang, bukan seluruh kolom.

### 5. Legend peta

Pakai `Legend` yang sudah ada di `PetaPage.tsx` (perlu di-export atau dipindah ke `components/map/Legend.tsx`, lihat bagian I):

```tsx
<Legend
  title="Kondisi"
  geom="LineString"                        // simbol: Point = bulat, LineString = batang, Polygon = kotak
  items={legendOf(layer.style).map((c) => ({ ...c, value: `${fmt(kmOf(c.key))} km` }))}
  hidden={hidden}                          // kelas yang dimatikan
  onHidden={setHidden}                     // state yang sama diteruskan ke VectorLayers & chart = cross-filter
/>
```

Setiap kelas adalah checkbox `sr-only` di dalam `<label>`, sehingga bisa diklik, di-tab, dan diumumkan pembaca layar. Kelas yang dimatikan ditampilkan dengan swatch kosong dan teks dicoret, tidak disembunyikan, agar pengguna tahu masih ada yang bisa dinyalakan.

---

## Checklist QA sebelum produksi

**Data**
- [ ] Angka KPI sama dengan query PostGIS langsung (panjang/luas dihitung pada geography, satuan meter)
- [ ] Setiap panel membedakan "belum ada data" dari 0, dan galat dari kosong (dengan tombol coba lagi)
- [ ] Insight card hanya tampil bila datanya cukup; angka bisa ditelusuri ke sumber
- [ ] Disclaimer "indikatif" tampil pada analisis dan insight

**Tampilan & aksesibilitas**
- [ ] Kontras AA di tema terang dan gelap, termasuk legend dan choropleth
- [ ] Peta dan chart lolos simulasi deuteranopia; kelas risiko punya label teks
- [ ] Semua kontrol bisa dioperasikan keyboard, fokus terlihat, urutan tab logis
- [ ] `prefers-reduced-motion` dihormati
- [ ] Lebar 360px: tanpa scroll horizontal, bottom sheet peta berfungsi
- [ ] Teks ID dan EN lengkap (`lib/i18n.ts`)

**Perilaku**
- [ ] `kec`/`tahun` di URL; reload dan tautan yang dibagikan memulihkan tampilan yang sama
- [ ] Viewer tidak melihat tombol ubah; API menolak permintaan tanpa peran yang sesuai

**Performa**
- [ ] Lighthouse LCP < 2,5 detik dengan throttling setara jaringan kantor
- [ ] Peta 10.000 poligon ≥ 30 fps di laptop kantor

**Rilis**
- [ ] `npm test` lulus (coverage 100%) dan `npm run lint` bersih
- [ ] Backup `pg_dump` harian aktif (lihat [DEPLOY.md](DEPLOY.md))
