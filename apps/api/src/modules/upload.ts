import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { iter } from 'but-unzip';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import shp from 'shpjs';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { baseGeomType, geometrySchema, idParam } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { removeFiles, takeMedia } from '../lib/media.js';
import { audit } from './audit.js';
import { validateProperties } from './features.js';
import { assertWritable, getLayer, type Layer } from './layers.js';
import { parseRuasSk } from '../db/parse.js';
import { JALAN_SLUG } from './tabular.js';

const MB = 1024 * 1024;
const CHUNK = 500;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Batas total ukuran terdekompresi isi zip. multer hanya membatasi 50 MB terkompresi, sedangkan .dbf
// bisa mengembang ribuan kali (zip bomb) dan menghabiskan memori saat shpjs mem-parse. 200 MB cukup untuk
// shapefile >10.000 poligon, jauh di atas kebutuhan nyata.
const DECOMP_CAP = 200 * MB;
// Inflate dengan batas keluaran: melempar sebelum mengalokasikan melebihi sisa kuota (bukan setelah).
const boundedInflate = (raw: Uint8Array, remaining: number) => inflateRawSync(raw, { maxOutputLength: remaining });

/** Metadata dokumentasi foto (field multipart/JSON); kosong = null. */
const mediaMeta = z.object({
  caption: z.string().trim().max(300).optional().transform((v) => v || null),
  tanggal: z.iso.date().optional().or(z.literal('').transform(() => undefined)),
  urgensi: z.enum(['tinggi', 'sedang', 'rendah']).optional().or(z.literal('').transform(() => undefined)),
});
const MEDIA_COLS = 'id, webp, avif, width, height, caption, tanggal::text AS tanggal, urgensi';

const memory = (maxMb: number, ext: RegExp) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * MB, files: 1 },
    fileFilter: (_req, file, cb) => (ext.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, 'Format file tidak didukung'))),
  }).single('file');

const requireFile = (file?: Express.Multer.File): Express.Multer.File => {
  if (!file) throw new HttpError(400, 'File wajib diunggah (field "file")');
  return file;
};

type ShpFeature = { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> | null };

/**
 * Isi file GeoJSON (FeatureCollection atau satu Feature) jadi daftar fitur, jalur yang sama dengan isi shapefile.
 * GeoJSON menurut spesifikasi (RFC 7946) selalu WGS84; anggota `crs` lama hanya diterima bila memang 4326/CRS84,
 * proyeksi lain (mis. UTM 49S) ditolak alih-alih tergambar di tempat yang salah.
 */
export const parseGeoJson = (buf: Buffer): ShpFeature[] => {
  let doc: { type?: string; features?: unknown; crs?: { properties?: { name?: string } } };
  try {
    doc = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'File GeoJSON tidak dapat dibaca');
  }
  const crs = doc?.crs?.properties?.name;
  if (crs && !/(4326|CRS84)$/i.test(crs)) throw new HttpError(400, `GeoJSON harus berkoordinat WGS84 (EPSG:4326), bukan ${crs}`);
  if (doc?.type === 'FeatureCollection' && Array.isArray(doc.features)) return doc.features as ShpFeature[];
  if (doc?.type === 'Feature') return [doc as unknown as ShpFeature];
  throw new HttpError(400, 'GeoJSON harus berupa FeatureCollection atau Feature');
};

/** Memastikan zip berisi tepat satu shapefile lengkap (.shp + .shx + .dbf) dan isi terdekompresi di bawah DECOMP_CAP. */
export const inspectZip = async (buf: Buffer): Promise<{ hasPrj: boolean }> => {
  if (!buf.subarray(0, 4).equals(ZIP_MAGIC)) throw new HttpError(400, 'File bukan arsip .zip yang valid');
  let names: string[];
  try {
    // Baca (inflate) tiap entri dengan batas keluaran sisa agar zip bomb ditolak sebelum memori terkuras;
    // nama dikumpulkan dari iterasi yang sama. shpjs kelak mem-parse isi yang sudah terbukti ≤ DECOMP_CAP ini.
    let used = 0;
    const inflate = (raw: Uint8Array) => {
      const out = boundedInflate(raw, DECOMP_CAP - used);
      used += out.length;
      return out;
    };
    names = [];
    for (const e of iter(buf, inflate)) {
      await e.read();
      names.push(e.filename.toLowerCase());
    }
    names = names.filter((n) => !n.includes('__macosx'));
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError(400, `Isi arsip terlalu besar setelah dekompresi (maks ${DECOMP_CAP / MB} MB)`);
    throw new HttpError(400, 'Arsip .zip rusak');
  }
  const shps = names.filter((n) => n.endsWith('.shp'));
  if (shps.length !== 1) throw new HttpError(400, `Zip harus berisi tepat 1 file .shp (ditemukan ${shps.length})`);
  const base = shps[0]!.slice(0, -4);
  const missing = ['.shx', '.dbf'].filter((ext) => !names.includes(base + ext));
  if (missing.length) throw new HttpError(400, `File pendamping tidak lengkap: ${missing.join(', ')}`);
  return { hasPrj: names.includes(base + '.prj') };
};

const cleanValue = (v: unknown): string | number | boolean | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.trim().slice(0, 2000) || null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  return null;
};

/**
 * `layer` diisi saat upload dari aplikasi: atribut divalidasi terhadap skema field layer (tipe & opsi pilihan;
 * kolom yang tidak ada dilaporkan sebagai `missingFields`, bukan galat). Angka bertipe teks di DBF dikonversi dulu.
 */
export const normalizeFeatures = (features: ShpFeature[], geomType: string, layer?: Pick<Layer, 'fields'>) => {
  const valid: { properties: Record<string, unknown>; geometry: unknown }[] = [];
  const errors: string[] = [];
  let skipped = 0;
  features.forEach((f, i) => {
    if (!f.geometry) return void skipped++;
    const g = geometrySchema.safeParse(f.geometry);
    if (!g.success) return void errors.push(`Fitur #${i + 1}: ${g.error.issues[0]!.message}`);
    if (baseGeomType(g.data.type) !== geomType) return void errors.push(`Fitur #${i + 1}: tipe ${g.data.type}, layer butuh ${geomType}`);
    const properties = Object.fromEntries(Object.entries(f.properties ?? {}).map(([k, v]) => [k.slice(0, 64), cleanValue(v)]));
    if (layer) {
      for (const fd of layer.fields) {
        const v = properties[fd.key];
        if (fd.type === 'number' && typeof v === 'string' && Number.isFinite(Number(v))) properties[fd.key] = Number(v);
      }
      try {
        validateProperties(layer as Layer, properties as never, true);
      } catch (e) {
        return void errors.push(`Fitur #${i + 1}: ${(e as Error).message}`);
      }
    }
    valid.push({ properties, geometry: g.data });
  });
  return { valid, errors, skipped };
};

type Row = { properties: Record<string, unknown>; geometry: unknown };

/** Insert massal per 500 fitur; geometri dirapikan (2D, valid, multi) sesuai tipe layer. */
export const insertFeatures = async (tx: Sql, layer: { id: number; geomType: string }, rows: Row[], userId: number | null, tahun?: number) => {
  const code = { Point: 1, LineString: 2, Polygon: 3 }[layer.geomType];
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx`
      INSERT INTO features (layer_id, properties, geom, created_by, updated_by, tahun_data)
      SELECT ${layer.id}, e->'properties',
             ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(e->>'geometry'), 4326))), ${code!})),
             ${userId}, ${userId}, coalesce(${tahun ?? null}::int, extract(year FROM now())::int)
      FROM jsonb_array_elements(${tx.json(rows.slice(i, i + CHUNK) as never)}::jsonb) e`;
  }
};

const uploadQuery = z.object({
  mode: z.enum(['append', 'replace']).default('append'),
  dryRun: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Tahun keadaan data semua fitur unggahan; kosong = tahun berjalan. */
  tahun: z.coerce.number().int().min(1900).max(2100).optional(),
});

export const uploadRouter = (sql: Sql, uploadDir: string): Router => {
  const router = Router();
  const editor = requireRole(...EDITORS);

  // Shapefile (.zip) atau GeoJSON (.geojson/.json); setelah dibaca keduanya lewat validasi & simpan yang sama.
  router.post('/layers/:slug/upload', editor, memory(50, /\.(zip|geojson|json)$/i), async (req, res) => {
    const layer = await getLayer(sql, req.params.slug);
    assertWritable(layer);
    const { mode, dryRun, tahun } = uploadQuery.parse(req.query);
    const file = requireFile(req.file);
    const geojson = !/\.zip$/i.test(file.originalname);
    const { hasPrj } = geojson ? { hasPrj: true } : await inspectZip(file.buffer);
    const parsed = geojson ? { features: parseGeoJson(file.buffer) } : (await shp(file.buffer).catch(() => {
      throw new HttpError(400, 'Shapefile tidak dapat dibaca');
    })) as { features: ShpFeature[] };
    // SHP SK mentah (kolom Nama_Ruas, Panjang, ...) dipetakan ke atribut layer, sama seperti skrip import.
    if (layer.slug === JALAN_SLUG) for (const f of parsed.features) if (f.properties && 'Nama_Ruas' in f.properties) f.properties = parseRuasSk(f.properties);
    const { valid, errors, skipped } = normalizeFeatures(parsed.features, layer.geomType, layer);
    if (errors.length) throw new HttpError(400, `${errors.length} fitur tidak valid. ${errors.slice(0, 5).join('; ')}`);
    if (!valid.length) throw new HttpError(400, geojson ? 'GeoJSON tidak berisi fitur' : 'Shapefile tidak berisi fitur');

    const columns = Object.keys(valid[0]!.properties);
    const summary = { count: valid.length, skipped, hasPrj, columns, missingFields: layer.fields.map((f) => f.key).filter((k) => !columns.includes(k)) };
    if (dryRun) {
      res.json({ ...summary, sample: { type: 'FeatureCollection', features: valid.slice(0, 300).map((f) => ({ type: 'Feature', ...f })) } });
      return;
    }

    // Berkas foto dihapus setelah commit: bila insert gagal, rollback mengembalikan baris media DAN berkasnya masih ada.
    const files = await sql.begin(async (tx) => {
      // Unggahan ke layer yang sama berurutan: tanpa kunci, dua `replace` serentak sama-sama lolos (DELETE yang kedua
      // tidak melihat baris baru yang pertama) dan datanya jadi ganda. Layer berbeda tetap paralel; lepas saat commit/rollback.
      // ponytail: multer memoryStorage menahan file (maks 50 MB) per unggahan serentak; ganti diskStorage bila RAM server kecil.
      await tx`SELECT pg_advisory_xact_lock(${layer.id})`;
      let taken: string[] = [];
      if (mode === 'replace') {
        taken = await takeMedia(tx as unknown as Sql, tx`f.layer_id = ${layer.id}`);
        await tx`DELETE FROM features_all WHERE layer_id = ${layer.id}`;
      }
      await insertFeatures(tx as unknown as Sql, layer, valid, req.user!.id, tahun);
      return taken;
    });
    await removeFiles(uploadDir, files);
    await audit(sql, req, `upload-${mode}`, 'layer', layer.id, { file: file.originalname, count: valid.length });
    res.status(201).json(summary);
  });

  /** Foto dikonversi ke WebP + AVIF, maks 1600px, metadata EXIF dibuang (privasi lokasi kamera). */
  router.post('/features/:id/media', editor, memory(10, /\.(jpe?g|png|webp|avif|heic)$/i), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const file = requireFile(req.file);
    const meta = mediaMeta.parse(req.body); // multer selalu mengisi req.body
    const [feature] = await sql`SELECT id FROM features WHERE id = ${id}`;
    if (!feature) throw notFound('Fitur');
    await mkdir(uploadDir, { recursive: true });
    const name = randomUUID();
    const base = sharp(file.buffer, { failOn: 'error' }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    const info = await base.clone().webp({ quality: 80 }).toFile(path.join(uploadDir, `${name}.webp`)).catch(() => {
      throw new HttpError(400, 'File bukan gambar yang valid');
    });
    await base.clone().avif({ quality: 50 }).toFile(path.join(uploadDir, `${name}.avif`));
    const [media] = await sql`
      INSERT INTO media (feature_id, webp, avif, width, height, caption, tanggal, urgensi)
      VALUES (${id}, ${name + '.webp'}, ${name + '.avif'}, ${info.width}, ${info.height}, ${meta.caption}, ${meta.tanggal ?? null}, ${meta.urgensi ?? null})
      RETURNING ${sql.unsafe(MEDIA_COLS)}`;
    await audit(sql, req, 'create', 'media', media!.id, { feature: id });
    res.status(201).json(media);
  });

  /** Ubah keterangan/tanggal/urgensi foto tanpa mengunggah ulang. */
  router.patch('/media/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const meta = mediaMeta.parse(req.body ?? {});
    const [media] = await sql`
      UPDATE media SET caption = ${meta.caption}, tanggal = ${meta.tanggal ?? null}, urgensi = ${meta.urgensi ?? null}
      WHERE id = ${id} RETURNING ${sql.unsafe(MEDIA_COLS)}`;
    if (!media) throw notFound('Media');
    await audit(sql, req, 'update', 'media', id, meta);
    res.json(media);
  });

  router.delete('/media/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [media] = await sql<{ webp: string; avif: string }[]>`DELETE FROM media WHERE id = ${id} RETURNING webp, avif`;
    if (!media) throw notFound('Media');
    await removeFiles(uploadDir, [media.webp, media.avif]);
    await audit(sql, req, 'delete', 'media', id);
    res.status(204).end();
  });

  return router;
};
