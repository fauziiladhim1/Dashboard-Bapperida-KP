/**
 * Koreksi koordinat Titik Kawasan Strategis dengan geocoding OpenStreetMap Nominatim (data terbuka, ODbL).
 * Google Maps tidak di-scrape: ToS-nya melarang ekstraksi otomatis & penyimpanan koordinat.
 *
 * Jalankan: npx tsx scripts/geocode-titik.ts <folder-data>
 * Keluaran (di folder data, CSV asli tidak diubah):
 *  - titik-kawasan-verifikasi.csv  : per titik koordinat lama/OSM, jarak, status, tautan Google Maps untuk cek manual
 *  - Layer_Titik_Kawasan_Strategis_Kulon_Progo_terkoreksi.csv : format sama dengan CSV asli, status OSM sudah diganti
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseKawasanCsv, type TitikKawasan } from '../src/db/parse.js';

const dir = process.argv[2];
if (!dir) throw new Error('Pakai: npx tsx scripts/geocode-titik.ts <folder-data>');
const SRC = path.join(dir, 'Layer_Titik_Kawasan_Strategis_Kulon_Progo.csv');
const rows = parseKawasanCsv(readFileSync(SRC, 'utf8').replace(/^﻿/, ''));

/** Desimal berpola buatan: tiga digit sama berturut, atau akhiran 211/221/111/222 yang berulang di banyak titik. */
const synthetic = (v: number) => {
  const d = Math.abs(v).toFixed(6).split('.')[1]!;
  return /(\d)\1\1/.test(d) || /(211|221|111|222|121)$/.test(d);
};
const key = (r: TitikKawasan) => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
const counts = new Map<string, number>();
for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);

/** Jarak haversine (meter). */
const meters = (a: [number, number], b: [number, number]) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type Hit = { lat: string; lon: string; display_name: string; category: string; type: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Kebijakan Nominatim: maks 1 permintaan/detik, User-Agent yang mengidentifikasi aplikasi, hasil boleh disimpan dgn atribusi.
const geocode = async (q: string): Promise<Hit | undefined> => {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: 'jsonv2', limit: '1', countrycodes: 'id', viewbox: '110.0,-7.6,110.35,-8.0', bounded: '1',
  })}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SIPWIL-KulonProgo/1.0 (dashboard Bapperida, koreksi titik kawasan)' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return ((await res.json()) as Hit[])[0];
};

const out: string[][] = [['kawasan', 'tema', 'nama', 'lat_lama', 'lng_lama', 'lat_osm', 'lng_osm', 'jarak_m', 'alasan', 'status', 'osm_nama', 'google_maps_cek', 'sumber']];
const fixed: TitikKawasan[] = [];
const tally = { OSM: 0, OK: 0, PERLU_CEK: 0 };
for (const r of rows) {
  const suspect = synthetic(r.lat) || synthetic(r.lng) || counts.get(key(r))! > 1;
  // Nama asli dulu; hanya "Desa Wisata X" yang dicari ulang sebagai desa X (nama tempat lain tidak dipangkas).
  const desa = /^desa w[iu]sata\s+/i.test(r.nama);
  const core = r.nama.replace(/^desa w[iu]sata\s+/i, '').toLowerCase();
  let hit = await geocode(`${r.nama}, Kulon Progo`);
  await sleep(1100);
  if (!hit && desa) { hit = await geocode(`${core}, Kulon Progo`); await sleep(1100); }
  // Tolak kecocokan yang salah tempat: ruas jalan, nama yang tak memuat nama inti, atau POI lain untuk "Desa Wisata".
  const first = hit?.display_name.split(',')[0]!.trim().toLowerCase() ?? '';
  const trusted = !!hit && hit.category !== 'highway' && first.includes(core)
    && (!desa || first === core || ['boundary', 'place'].includes(hit.category) || (hit.category === 'amenity' && hit.type === 'townhall'));
  if (hit && !trusted) hit = undefined;
  const osm: [number, number] | null = hit ? [Number(hit.lon), Number(hit.lat)] : null;
  const dist = osm ? Math.round(meters([r.lng, r.lat], osm)) : null;
  const status: keyof typeof tally = suspect ? (osm ? 'OSM' : 'PERLU_CEK') : !osm || dist! <= 1000 ? 'OK' : 'PERLU_CEK';
  tally[status]++;
  const use = status === 'OSM' ? { ...r, lat: osm![1], lng: osm![0] } : r;
  fixed.push(use);
  out.push([r.kawasan, r.tema, r.nama, String(r.lat), String(r.lng), osm ? String(osm[1]) : '', osm ? String(osm[0]) : '', dist === null ? '' : String(dist),
    suspect ? 'pola koordinat buatan / duplikat' : '', status, hit?.display_name ?? '',
    `https://www.google.com/maps/search/?api=1&query=${use.lat},${use.lng}`, hit ? '© OpenStreetMap contributors (ODbL)' : '']);
  console.log(`${status.padEnd(9)} ${r.nama}${dist !== null ? ` (${dist} m)` : ''}`);
}

const csv = (rs: string[][], sep: string) => rs.map((c) => c.map((v) => (/[";\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(sep)).join('\r\n');
writeFileSync(path.join(dir, 'titik-kawasan-verifikasi.csv'), `﻿${csv(out, ',')}\r\n`);
// Format sama dengan CSV asli (`;`, desimal titik biasa; parseKoordinat membaca digit sehingga tetap kompatibel).
writeFileSync(path.join(dir, 'Layer_Titik_Kawasan_Strategis_Kulon_Progo_terkoreksi.csv'),
  `Kawasan;Tema;Nama_Tempat;Latitude;Longitude\r\n${fixed.map((r) => [r.kawasan, r.tema, r.nama, r.lat.toFixed(6), r.lng.toFixed(6)].join(';')).join('\r\n')}\r\n`);
console.log(JSON.stringify(tally));
