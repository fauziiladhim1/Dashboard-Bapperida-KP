# Dashboard Bapperida Kulon Progo

Dashboard regional dan WebGIS pengembangan wilayah untuk internal Bapperida Kabupaten Kulon Progo: ringkasan KPI dengan filter kecamatan, peta interaktif multi-layer, CRUD data spasial, unggah shapefile, manajemen pengguna, dan log audit. Tersedia bahasa Indonesia/English serta mode terang/gelap.

- Kebutuhan produk: [docs/PRD.md](docs/PRD.md)
- Blueprint desain & backlog dashboard: [docs/BLUEPRINT.md](docs/BLUEPRINT.md)
- Standar data SHP: [docs/DATA-GUIDE.md](docs/DATA-GUIDE.md)
- Deploy ke server Kominfo: [docs/DEPLOY.md](docs/DEPLOY.md)

## Stack

| Bagian | Teknologi |
|---|---|
| Web | React 19, Vite 8, Tailwind CSS 4, HeroUI v3 (React Aria), Gravity UI Icons, mapcn (MapLibre GL), Motion, TanStack Query, Recharts; font Rubik dari Google Fonts (cadangan system-ui bila tanpa internet) |
| API | Node 22, Express 5, Zod, postgres.js, shpjs, sharp, Argon2, jose |
| Database | PostgreSQL 17 + PostGIS 3.5 |
| Tes | Vitest + Testing Library + Supertest, ambang coverage 100% (API & web terpenuhi per 2026-11-15) |

## Struktur

```
apps/
  api/
    src/
      config/env.ts          validasi variabel lingkungan
      db/                    koneksi, migrasi SQL, seed layer, CLI
      middleware/            auth (cookie JWT + cek DB), RBAC, error handler
      modules/               auth, users, layers, features, tiles, upload, stats, audit
      app.ts  server.ts
    test/                    integration test ke DB *_test
  web/
    src/
      app/                   App (provider + route), ErrorBoundary
      components/ui/         mapcn (jangan diedit manual)
      components/layout/     AppShell, Logo, PrefControls
      components/common/     Panel, PillButton, Tip, Loading, KecamatanSelect, motion
      components/map/        VectorLayers (vector tile PostGIS di atas mapcn)
      features/              auth, overview, peta, data, users, audit, errors (404/403/500)
      lib/                   api client, i18n (id/en), prefs (bahasa & tema), notify (Toast + AlertDialog HeroUI), format
    test/                    tes komponen (MapLibre & fetch di-mock)
docker/                      Dockerfile api/web + nginx.conf
docs/                        PRD, panduan data, panduan deploy
```

## Menjalankan di lokal

Prasyarat: Node 22+, Docker.

```bash
cp .env.example .env            # isi password & JWT_SECRET
npm install
docker compose up -d db         # PostGIS di 127.0.0.1:5433
npm run db:migrate
npm run db:seed                 # layer awal + akun superadmin dari .env
npm run db:import -- "C:\KULIAH FZL\MAGANG\data"   # opsional: RBI 25K, ruas jalan CSV, kemiskinan xlsx
npm run dev:api                 # terminal 1 -> http://localhost:4000
npm run dev:web                 # terminal 2 -> http://localhost:5173
```

Masuk memakai `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, lalu unggah SHP di menu **Data**. Password akun ini selalu mengikuti `.env`: ubah `SEED_ADMIN_PASSWORD` lalu restart API (atau `npm run db:admin-password`). Hash di DB hanya ditulis ulang bila berbeda, jadi restart biasa tidak mencabut sesi "Ingat saya".

`db:import` mengisi Batas Administrasi (88 kalurahan, `SHP Audit 2024/BatasAdminKel`), Penggunaan Lahan (`Kesesuaian_Pola_Ruang_dan_Penggunaan_Lahan`, dipotong per kalurahan; otomatis juga Kawasan Pertanian dan Kesesuaian Pola Ruang), Utilitas Umum dari shapefile RBI 25K, serta tabel `ruas_jalan` dan `kemiskinan` (choropleth per kalurahan). Perintah ini mengganti isi layer/tabel tersebut: aman dijalankan ulang, tetapi fitur, edit manual, dan **foto dokumentasi** pada layer itu (mis. Utilitas Umum) ikut terhapus.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm test` | tes API + web dengan coverage (gagal bila di bawah 100%). Tes API memakai database `<nama>_test` yang dibuat otomatis dari skema di atas; buat sekali dengan `docker compose exec db psql -U sipwil -c "create database sipwil_test"` |
| `npm run lint` | type check seluruh workspace |
| `npm run build` | build produksi |

## Keamanan singkat

Cookie sesi `httpOnly` + `SameSite=Strict`, hash Argon2, rate limiter (global, login, upload), Helmet/CSP, validasi Zod di semua input, dan query berparameter. `.env` tidak boleh di-commit (sudah di `.gitignore`).
