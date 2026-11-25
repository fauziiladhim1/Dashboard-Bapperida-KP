import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { idParam } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { removeFiles, takeMedia } from '../lib/media.js';
import { audit } from './audit.js';

export type Layer = {
  id: number;
  slug: string;
  name: string;
  year: number | null;
  geomType: 'Point' | 'LineString' | 'Polygon';
  style: { color: string; classField?: string; classes?: Record<string, string>; labels?: Record<string, string>; groups?: Record<string, string[]>; outline?: boolean; ordinal?: string[] };
  fields: { key: string; type: string; required?: boolean; options?: string[] }[];
  sourceLayerId: number | null;
  filter: { field: string; values: string[] } | null;
};

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus hex #RRGGBB');
const fieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Key atribut hanya huruf, angka, _'),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'number', 'select']),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  required: z.boolean().optional(),
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
    await audit(sql, req, 'update', 'layer', id, b);
    res.json(await getLayer(sql, layer.slug));
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
