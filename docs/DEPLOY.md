# Deploy ke Server Kominfo

Target: VM Linux (Ubuntu/Debian/RHEL) dengan Docker Engine dan Docker Compose v2. Minimal 2 vCPU, 4 GB RAM, dan 20 GB disk (lebih jika fotonya banyak).

## 1. Siapkan konfigurasi

```bash
git clone <repo> sipwil && cd sipwil
cp .env.example .env
```

Isi `.env`:

| Variabel | Isi |
|---|---|
| `POSTGRES_PASSWORD` | password acak yang kuat, juga dipakai di `DATABASE_URL` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | akun superadmin pertama; passwordnya disamakan dengan `.env` setiap API start (tak bisa diganti dari aplikasi) |

`.env` sudah masuk `.gitignore` dan `.dockerignore`. Jangan pernah meng-commit file ini; bagikan secret lewat kanal resmi, bukan lewat chat atau repo.

## 2. Jalankan

```bash
docker compose --profile prod up -d --build
docker compose --profile prod run --rm api node dist/db/cli.js migrate
docker compose --profile prod run --rm api node dist/db/cli.js seed
```

Aplikasi berjalan di port `8080`. PostGIS hanya terbuka di `127.0.0.1:5433` (tidak dapat diakses dari luar server).

## 3. HTTPS dan domain

Arahkan reverse proxy Kominfo (atau nginx/Caddy di host) ke `http://127.0.0.1:8080` dengan TLS, misalnya `https://sipwil.kulonprogokab.go.id`. Port 8080 hanya terbuka di localhost, jadi aplikasi tidak bisa diakses tanpa TLS. Header `X-Forwarded-For` dan `X-Forwarded-Proto` wajib diteruskan.

`TRUST_PROXY` = jumlah proxy di depan API, diatur lewat `PROD_TRUST_PROXY` di `.env` (default `1` = hanya nginx container; `TRUST_PROXY` di `.env` hanya untuk API yang dijalankan langsung saat dev). Isi `2` bila ada proxy TLS di depan (Kominfo, atau Caddy/nginx di host). Nilai harus tepat:

- Terlalu kecil: semua pengguna terbaca ber-IP proxy dan berbagi satu kuota rate limit (satu orang salah password 10 kali mengunci semua).
- Terlalu besar: header `X-Forwarded-For` palsu dari klien dipercaya, sehingga penyerang bisa berganti "IP" tiap percobaan dan lolos dari limit login per IP.

Tanpa proxy depan, TLS harus dipasang langsung di nginx (port 443), karena compose hanya membuka `127.0.0.1:8080`. Pasang juga HSTS (`Strict-Transport-Security`) di titik yang memegang TLS.

Perlindungan brute-force login berlapis: nginx `limit_req` 10 permintaan/menit per IP (burst 5), lalu API: 10 percobaan gagal per IP dan 5 percobaan gagal per email per 15 menit. Limit API disimpan di memori proses: hilang saat restart dan tidak dibagi bila API dijalankan lebih dari satu replika.

Aktifkan Brotli dan HTTP/2 di reverse proxy depan bila tersedia. nginx bawaan container sudah memakai gzip.

## 4. Jika Kominfo menyediakan PostgreSQL sendiri

1. Minta PostgreSQL 15 atau lebih baru dengan ekstensi PostGIS 3.
2. Superuser DB menjalankan sekali: `CREATE EXTENSION postgis;`
3. Buat user aplikasi tanpa hak superuser, lalu isi `DATABASE_URL` dengan user tersebut.
4. Hapus service `db` dari compose (atau jangan jalankan), lalu jalankan migrasi seperti langkah 2.

## 5. Backup

Backup harian lewat cron di host:

```bash
# /etc/cron.d/sipwil-backup (setiap pukul 01.30, simpan 14 hari)
30 1 * * * root cd /opt/sipwil && docker compose exec -T db pg_dump -U sipwil -Fc sipwil > /backup/sipwil-$(date +\%F).dump && find /backup -name 'sipwil-*.dump' -mtime +14 -delete
```

Foto berada di volume `sipwil_uploads`. Backup dengan:
`docker run --rm -v sipwil_uploads:/d -v /backup:/b alpine tar czf /b/uploads-$(date +%F).tgz -C /d .`

Restore: `docker compose exec -T db pg_restore -U sipwil -d sipwil --clean < file.dump`

## 6. Update versi

```bash
git pull
docker compose --profile prod up -d --build
docker compose --profile prod run --rm api node dist/db/cli.js migrate
# Sinkronkan layer bawaan (mis. layer baru Catatan Rencana). Idempoten; akun seed yang sudah dihapus tidak dibuat ulang.
docker compose --profile prod run --rm api node dist/db/cli.js seed
```

Migrasi bersifat maju saja dan tercatat di tabel `_migrations`, jadi aman dijalankan berulang.

## 7. Checklist keamanan

- [ ] `.env` tidak ada di repo (`git ls-files | grep .env` hanya menampilkan `.env.example`)
- [ ] Password superadmin awal diganti setelah login pertama (buat akun baru, lalu hapus akun seed). `seed` hanya membuat akun bawaan bila belum ada superadmin, jadi akun yang dihapus tidak hidup lagi
- [ ] Port 5433 (DB) tertutup dari luar; hanya 443 yang terbuka publik
- [ ] HTTPS aktif (cookie sesi memakai flag `Secure` di production)
- [ ] Backup diuji dengan restore minimal sebulan sekali
- [ ] `docker compose logs api` dipantau untuk error 500 dan lonjakan 429 (indikasi brute force)

## 8. Optimasi yang sudah aktif

- Vector tile PostGIS (`ST_AsMVT`) dengan index GIST, sehingga hanya data di layar yang dikirim
- Code splitting per halaman; MapLibre dan Recharts terpisah dari bundle awal
- Minifikasi JS (Rolldown) dan CSS (LightningCSS), tanpa sourcemap di produksi
- Cache: aset hash `max-age` maksimal, `index.html` selalu divalidasi ulang, foto `immutable` 1 tahun, tile `private` 1 hari dengan versi di URL
- Foto dikonversi ke WebP dan AVIF, maks 1600 px, `loading="lazy"`
- Font Rubik dari Google Fonts, dimuat tanpa memblokir render (`theme.js`); tanpa internet jatuh ke font sistem
- Worker MapLibre di-host sendiri (`/vendor`), tidak bergantung CDN; logo WebP 3 KB di-cache 30 hari
- Animasi minimal dan menghormati `prefers-reduced-motion`
- Kompresi gzip di nginx dan `compression` di API
