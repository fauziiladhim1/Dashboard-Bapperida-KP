import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { idParam } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { removeFiles, takeMedia } from '../lib/media.js';
import { FIELD_TYPES, NUMERIC, TEXT_PATTERN, valueError, type FieldType } from '../lib/field-types.js';
import { audit } from './audit.js';

export type Layer = {
  id: number;
  slug: string;
  name: string;
  year: number | null;
  geomType: 'Point' | 'LineString' | 'Polygon';
  style: { color: string; classField?: string; classes?: Record<string, string>; labels?: Record<string, string>; groups?: Record<string, string[]>; outline?: boolean; ordinal?: string[] };
  fields: { key: string; type: string; required?: boolean; options?: string[]; hidden?: boolean; popup?: boolean }[];
  sourceLayerId: number | null;
  filter: { field: string; values: string[] } | null;
};

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus hex #RRGGBB');
const fieldKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Key atribut hanya huruf, angka, _');
const fieldSchema = z.object({
  key: fieldKey,
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
  // "Hapus field" ala QGIS tanpa kehilangan data: field disembunyikan dari tabel/form/popup, nilainya tetap di properties.
  hidden: z.boolean().optional(),
  // false = tidak tampil di popup peta (urutan popup = urutan array fields).
  popup: z.boolean().optional(),
});

const layerBase = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'Slug hanya huruf kecil, angka, tanda -'),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  geomType: z.enum(['Point', 'LineString', 'Polygon']),
  style: z.object({
    color, classField: z.string().max(64).optional(), classes: z.record(z.string(), color).optional(),
    groups: z.record(z.string(), z.array(z.string())).optional(), outline: z.boolean().optional(), ordinal: z.array(z.string().max(80)).max(50).optional(),
    // Label tampilan per kunci kelas (mis. "KSPD 2" -> "KSPD 2 Menoreh Selatan"); kunci data tetap.
    labels: z.record(z.string(), z.string().max(80)).optional(),
    // Baris teks tambahan popup; `{field}` diisi atribut fitur di browser (dirender sebagai teks, bukan HTML).
    popupLines: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    // Warna bertingkat dari atribut angka (mis. jumlah penduduk miskin): stop urut naik, `min` inklusif.
    steps: z.object({
      field: z.string().max(64),
      stops: z.array(z.object({ min: z.number(), label: z.string().max(40), color })).min(1).max(12),
    }).optional(),
  }),
  fields: z.array(fieldSchema).max(40),
  sumber: z.string().trim().max(200).nullable().optional(),
  visibleDefault: z.boolean(),
  sortOrder: z.number().int(),
});

// Default hanya untuk create; PATCH memakai layerBase agar field yang tidak dikirim tidak ter-reset.
export const layerSchema = layerBase.extend({
  fields: layerBase.shape.fields.default([]),
  visibleDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(100),
});

const LAYER_COLUMNS = (sql: Sql) => sql`
  l.id, l.slug, l.name, l.category, l.year, l.geom_type, l.style, l.fields, l.source_layer_id, l.filter,
  l.visible_default, l.sort_order, l.sumber,
  -- Layer turunan memakai versi layer sumber: trigger touch_layer hanya menaikkan updated_at layer pemilik fitur,
  -- tanpa ini tile turunan (?v=updated_at) tetap memakai cache lama s.d. 24 jam.
  GREATEST(l.updated_at, (SELECT s.updated_at FROM layers s WHERE s.id = l.source_layer_id)) AS updated_at`;

export const getLayer = async (sql: Sql, slug: unknown): Promise<Layer> => {
  const [layer] = await sql<Layer[]>`SELECT ${LAYER_COLUMNS(sql)} FROM layers l WHERE l.slug = ${String(slug)}`;
  if (!layer) throw notFound('Layer');
  return layer;
};

/** Layer turunan (mis. Kawasan Pertanian dari Penggunaan Lahan) hanya bisa dibaca; datanya diedit di layer sumber. */
export const assertWritable = (layer: Layer): void => {
  if (layer.sourceLayerId) throw new HttpError(409, 'Layer turunan bersifat baca-saja; ubah data di layer sumbernya');
};

/** Kondisi WHERE untuk fitur milik layer, termasuk layer turunan + filternya. Alias tabel fitur: f. */
export const layerScope = (sql: Sql, layer: Layer) =>
  layer.filter
    ? sql`f.layer_id = ${layer.sourceLayerId} AND f.properties->>${layer.filter.field} = ANY(${layer.filter.values}::text[])`
    : sql`f.layer_id = ${layer.id}`;

const layerById = async (sql: Sql, id: number): Promise<Layer> => {
  const [layer] = await sql<Layer[]>`SELECT ${LAYER_COLUMNS(sql)} FROM layers l WHERE l.id = ${id}`;
  if (!layer) throw notFound('Layer');
  return layer;
};

/**
 * Field yang disembunyikan/dibuang dari skema tidak boleh masih dipakai simbologi, layer turunan, atau resep KPI:
 * peta & kartu akan diam-diam kosong. Pesan menyebut pemakainya agar editor tahu apa yang harus diubah dulu.
 */
const assertFieldsFree = async (sql: Sql, cur: Layer, fields: { key: string; hidden?: boolean }[], style: Record<string, unknown> | undefined) => {
  const visible = new Set(fields.filter((f) => !f.hidden).map((f) => f.key));
  const gone = cur.fields.filter((f) => !f.hidden && !visible.has(f.key)).map((f) => f.key);
  if (!gone.length) return;
  const st = (style ?? cur.style) as { classField?: string; steps?: { field: string } };
  const uses: string[] = [];
  for (const k of gone) {
    if (st.classField === k) uses.push(`${k}: warna kelas layer`);
    if (st.steps?.field === k) uses.push(`${k}: warna bertingkat layer`);
  }
  const views = await sql<{ name: string; k: string }[]>`
    SELECT name, filter->>'field' AS k FROM layers WHERE source_layer_id = ${cur.id} AND filter->>'field' = ANY(${gone}::text[])`;
  for (const v of views) uses.push(`${v.k}: filter layer ${v.name}`);
  const kpis = await sql<{ label: string; k: string }[]>`
    SELECT label, k FROM kpi, unnest(ARRAY[by_field, by2_field, sum_field, where_field]) k WHERE layer_slug = ${cur.slug} AND k = ANY(${gone}::text[])`;
  for (const r of kpis) uses.push(`${r.k}: KPI "${r.label}"`);
  if (uses.length) throw new HttpError(400, `Field masih dipakai, ubah pemakainya dulu (${uses.join('; ')})`);
};

/** Konversi nilai teks lama saat tipe diganti: angka ("12" → 12), ya/tidak ("ya", "1" → true). */
type Convert = { key: string; to: 'numeric' | 'boolean' };

/**
 * Ganti tipe/opsi field lama hanya bila data yang ada masih sah: setiap nilai terisi harus cocok dengan bentuk tipe
 * barunya (angka, tanggal, ya/tidak, ...), dan untuk Pilihan harus ada di opsi. Ke Teks selalu boleh. Mengembalikan
 * field yang nilai teksnya perlu dikonversi setelah skema disimpan.
 */
const assertTypeChange = async (sql: Sql, cur: Layer, fields: { key: string; type: string; options?: string[]; hidden?: boolean }[]) => {
  const convert: Convert[] = [];
  const errors: string[] = [];
  for (const f of fields) {
    const old = cur.fields.find((x) => x.key === f.key);
    if (!old || f.hidden) continue;
    const scope = sql`layer_id = ${cur.id} AND coalesce(properties->>${f.key}, '') <> ''`;
    const pattern = TEXT_PATTERN[f.type as FieldType];
    if (pattern && f.type !== old.type) {
      const bad = await sql<{ v: string }[]>`SELECT DISTINCT properties->>${f.key} AS v FROM features WHERE ${scope} AND properties->>${f.key} !~* ${pattern} LIMIT 5`;
      if (bad.length) errors.push(`${f.key} tidak bisa diganti tipenya, ada nilai yang tidak cocok: ${bad.map((r) => r.v).join(', ')}`);
      else if (NUMERIC.includes(f.type)) convert.push({ key: f.key, to: 'numeric' });
      else if (f.type === 'boolean') convert.push({ key: f.key, to: 'boolean' });
    }
    const optsChanged = f.type === 'select' && (old.type !== 'select' || JSON.stringify(old.options ?? []) !== JSON.stringify(f.options ?? []));
    if (optsChanged) {
      const bad = await sql<{ v: string }[]>`
        SELECT DISTINCT properties->>${f.key} AS v FROM features WHERE ${scope} AND NOT (properties->>${f.key} = ANY(${f.options ?? []}::text[])) LIMIT 5`;
      if (bad.length) errors.push(`${f.key}: nilai di data belum ada di opsi (${bad.map((r) => r.v).join(', ')})`);
    }
  }
  if (errors.length) throw new HttpError(400, errors.join('; '));
  return convert;
};

const fillSchema = z.object({ key: fieldKey, value: z.union([z.string().trim().min(1).max(500), z.number(), z.boolean()]) });

export const layersRouter = (sql: Sql, uploadDir: string): Router => {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await sql`
      SELECT ${LAYER_COLUMNS(sql)}, (
        SELECT count(*)::int FROM features f
        WHERE f.layer_id = coalesce(l.source_layer_id, l.id)
          AND (l.filter IS NULL OR f.properties->>(l.filter->>'field') IN (SELECT jsonb_array_elements_text(l.filter->'values')))
      ) AS feature_count
      FROM layers l ORDER BY l.sort_order, l.id`);
  });

  router.get('/:slug', async (req, res) => {
    res.json(await getLayer(sql, req.params.slug));
  });

  router.post('/', requireRole(...EDITORS), async (req, res) => {
    const b = layerSchema.parse(req.body);
    const [layer] = await sql`
      INSERT INTO layers (slug, name, category, year, geom_type, style, fields, sumber, visible_default, sort_order)
      VALUES (${b.slug}, ${b.name}, ${b.category}, ${b.year ?? null}, ${b.geomType}, ${sql.json(b.style)}::jsonb,
              ${sql.json(b.fields)}::jsonb, ${b.sumber || null}, ${b.visibleDefault}, ${b.sortOrder})
      RETURNING id, slug`;
    await audit(sql, req, 'create', 'layer', layer!.id, { slug: b.slug });
    res.status(201).json(await getLayer(sql, b.slug));
  });

  router.patch('/:id', requireRole(...EDITORS), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const b = layerBase.omit({ slug: true, geomType: true }).partial().parse(req.body);
    let convert: Convert[] = [];
    if (b.fields) {
      const cur = await layerById(sql, id);
      await assertFieldsFree(sql, cur, b.fields, b.style);
      convert = await assertTypeChange(sql, cur, b.fields);
    }
    const json = (v: unknown) => (v === undefined ? null : sql.json(v as never));
    const [layer] = await sql<{ slug: string }[]>`
      UPDATE layers SET
        name = coalesce(${b.name ?? null}, name), category = coalesce(${b.category ?? null}, category),
        year = CASE WHEN ${b.year !== undefined} THEN ${b.year ?? null}::int ELSE year END,
        style = coalesce(${json(b.style)}::jsonb, style), fields = coalesce(${json(b.fields)}::jsonb, fields),
        sumber = CASE WHEN ${b.sumber !== undefined} THEN ${b.sumber || null} ELSE sumber END,
        visible_default = coalesce(${b.visibleDefault ?? null}::boolean, visible_default),
        sort_order = coalesce(${b.sortOrder ?? null}::int, sort_order), updated_at = now()
      WHERE id = ${id} RETURNING slug`;
    if (!layer) throw notFound('Layer');
    // Field yang tipenya baru diganti: teks "12" / "ya" disimpan sebagai angka / boolean agar statistik & validasi konsisten.
    for (const { key: k, to } of convert) {
      await sql`
        UPDATE features SET properties = jsonb_set(properties, ARRAY[${k}],
          ${to === 'numeric' ? sql`to_jsonb((properties->>${k})::numeric)` : sql`to_jsonb(lower(properties->>${k}) IN ('true', 'ya', '1'))`})
        WHERE layer_id = ${id} AND coalesce(properties->>${k}, '') <> ''
          AND jsonb_typeof(properties->${k}) <> ${to === 'numeric' ? 'number' : 'boolean'}`;
    }
    await audit(sql, req, 'update', 'layer', id, b);
    res.json(await getLayer(sql, layer.slug));
  });

  // Key atribut yang benar-benar ada di data (termasuk kolom impor SHP/CSV yang belum masuk skema field).
  router.get('/:id/keys', requireRole(...EDITORS), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const rows = await sql<{ k: string }[]>`SELECT DISTINCT jsonb_object_keys(properties) AS k FROM features WHERE layer_id = ${id} ORDER BY 1`;
    res.json(rows.map((r) => r.k));
  });

  // Nilai awal field baru: hanya fitur yang field-nya masih kosong, nilai yang sudah ada tidak ditimpa.
  router.post('/:id/fill', requireRole(...EDITORS), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { key, value } = fillSchema.parse(req.body);
    const layer = await layerById(sql, id);
    assertWritable(layer);
    const field = layer.fields.find((f) => f.key === key && !f.hidden);
    if (!field) throw new HttpError(400, `${key} bukan field aktif layer ini`);
    const err = valueError(field, value);
    if (err) throw new HttpError(400, err);
    const r = await sql`
      UPDATE features SET properties = properties || ${sql.json({ [key]: value })}::jsonb
      WHERE layer_id = ${id} AND coalesce(properties->>${key}, '') = ''`;
    await audit(sql, req, 'update', 'layer', id, { fill: key, n: r.count });
    res.json({ updated: r.count });
  });

  // Hapus field permanen ala QGIS "Delete field": key dibuang dari skema DAN dari properties semua fitur layer.
  // Beda dengan sembunyikan (hidden), ini tidak bisa diurungkan; pemakai (simbologi, layer turunan, KPI) dicek dulu.
  router.delete('/:id/fields/:key', requireRole(...EDITORS), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const key = fieldKey.parse(req.params.key);
    const layer = await layerById(sql, id);
    assertWritable(layer);
    const fields = layer.fields.filter((f) => f.key !== key);
    await assertFieldsFree(sql, layer, fields, undefined);
    const r = await sql.begin(async (tx) => {
      await tx`UPDATE layers SET fields = ${sql.json(fields as never)}::jsonb, updated_at = now() WHERE id = ${id}`;
      return tx`UPDATE features SET properties = properties - ${key}::text WHERE layer_id = ${id} AND properties ? ${key}`;
    });
    await audit(sql, req, 'update', 'layer', id, { dropField: key, n: r.count });
    res.json({ ...(await getLayer(sql, layer.slug)), cleared: r.count });
  });

  router.delete('/:id', requireRole('superadmin'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [files, count] = await sql.begin(async (tx) => {
      const taken = await takeMedia(tx as unknown as Sql, tx`f.layer_id = ${id}`);
      return [taken, (await tx`DELETE FROM layers WHERE id = ${id}`).count] as const;
    });
    if (!count) throw notFound('Layer');
    await removeFiles(uploadDir, files);
    await audit(sql, req, 'delete', 'layer', id);
    res.status(204).end();
  });

  return router;
};
