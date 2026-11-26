// Audit Lighthouse dengan login sungguhan + batas skor per halaman (gagal = exit 1).
//
// Login lewat browser (bukan header --extra-headers): cookie sesi ikut terkirim pada fetch worker MapLibre, jadi tile
// vektor tidak 401 dan skor Best Practices halaman berpeta mencerminkan aplikasi, bukan artefak audit.
//
// Pakai (aplikasi sudah jalan, mis. `docker compose --profile prod up -d`):
//   npm run lighthouse -w apps/web
// Profil desktop saja (preset desktop Lighthouse): target pemakaian dasbor ini adalah komputer kantor.
// Kredensial: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD dari env atau .env di root repo. URL: LH_URL (bawaan :8080).
// Laporan HTML per halaman: apps/web/.lighthouse/<halaman>.html
//
// ponytail: tidak dipasang di CI. Di CI database kosong & tumpukan produksi tidak jalan, jadi skornya tidak bermakna;
// jalankan terhadap staging/lokal berisi data. Pindah ke CI bila ada job e2e dengan data contoh.
import fs from 'node:fs';
import path from 'node:path';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { Launcher } from 'chrome-launcher';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '../../..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const BASE = process.env.LH_URL ?? 'http://localhost:8080';
const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD wajib diisi (env atau .env)');

const OUT = path.resolve(import.meta.dirname, '../.lighthouse');

// Batas = hasil audit tahap 1–4 dikurangi margin derau antar-run (±6 poin). Naikkan bila skor membaik, jangan turunkan
// tanpa alasan. A11y/BP/SEO wajib 100 di semua halaman. Peta: MapLibre (GIS) sengaja tidak dipangkas demi skor.
const PERF = { login: 0.95, ringkasan: 0.88, peta: 0.6, data: 0.92, pengguna: 0.92, log: 0.92, akun: 0.93 };
const ALL = { login: '/login', ringkasan: '/', peta: '/peta', data: '/data/jalan-kabupaten', pengguna: '/pengguna', log: '/log', akun: '/akun' };
// Argumen opsional: nama halaman yang diaudit (mis. `-- peta data`); tanpa argumen semua halaman.
const only = process.argv.slice(2);
const PAGES = only.length ? Object.fromEntries(Object.entries(ALL).filter(([k]) => only.includes(k))) : ALL;
const MAX_CLS = 0.1;

const failures = [];
fs.mkdirSync(OUT, { recursive: true });

for (const [name, url] of Object.entries(PAGES)) {
  // Chrome baru per halaman (setara CLI lighthouse): cache HTTP & cache kompilasi V8 di proses renderer tidak terbawa
  // dari halaman sebelumnya, jadi skor = kunjungan pertama, bukan kunjungan ulang.
  const browser = await puppeteer.launch({ executablePath: Launcher.getFirstInstallation(), headless: true, defaultViewport: null });
  try {
    const page = await browser.newPage();
    // Halaman login diaudit sebagai tamu; sisanya setelah login (cookie sesi di browser).
    if (name !== 'login') {
      // Login dari respons JSON (origin sama, tanpa JS aplikasi): index.js belum pernah dikompilasi sebelum audit.
      await page.goto(`${BASE}/api/v1/auth/me`);
      const status = await page.evaluate(async (body) => (await fetch('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).status, { email, password });
      if (status !== 200) throw new Error(`Login gagal (HTTP ${status})`);
      // Jaga-jaga: kosongkan cache HTTP (cookie tetap).
      const cdp = await page.createCDPSession();
      await cdp.send('Network.clearBrowserCache');
      await cdp.detach();
    }
    // disableStorageReset: tanpa ini Lighthouse menghapus cookie sesi sebelum memuat halaman.
    const { lhr, report } = await lighthouse(`${BASE}${url}`, { output: 'html', logLevel: 'error', disableStorageReset: true },
      desktopConfig, page);
    fs.writeFileSync(path.join(OUT, `${name}.html`), report);

    const score = (k) => lhr.categories[k].score;
    const cls = lhr.audits['cumulative-layout-shift'].numericValue;
    const checks = [
      ['performance', score('performance'), PERF[name]],
      ['accessibility', score('accessibility'), 1],
      ['best-practices', score('best-practices'), 1],
      ['seo', score('seo'), 1],
    ];
    const bad = checks.filter(([, s, min]) => s < min).map(([k, s, min]) => `${k} ${Math.round(s * 100)} < ${min * 100}`);
    if (cls > MAX_CLS) bad.push(`CLS ${cls.toFixed(3)} > ${MAX_CLS}`);
    if (lhr.finalDisplayedUrl.endsWith('/login') && name !== 'login') bad.push('teralih ke /login (sesi tidak terbawa)');
    failures.push(...bad.map((b) => `${name}: ${b}`));
    console.log(`${bad.length ? 'GAGAL' : 'ok   '} ${name.padEnd(10)} ${checks.map(([, s]) => Math.round(s * 100)).join('/')}  CLS ${cls.toFixed(3)}`);
  } finally {
    await browser.close();
  }
}


