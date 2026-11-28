import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { idParam } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';
import { audit } from './audit.js';
import { getLayer } from './layers.js';

const key = z.string().max(64);
/** Ukuran yang mengagregasi satu atribut angka (sum_field). */
const AGG: string[] = ['sum', 'avg', 'min', 'max'];
const kpiSchema = z.object({
  label: z.string().trim().min(2).max(80),
  layerSlug: z.string().max(60),
  measure: z.enum(['count', 'length_km', 'area_ha', 'sum', 'avg', 'min', 'max']),
  sumField: key.nullish(),
  byField: key.nullish(),
  // Grafik kedua (format dua grafik): rincian lain, mis. per tahun, sebagai garis atau batang.
  by2Field: key.nullish(),
  chart2: z.enum(['line', 'bar']).default('line'),
  whereField: key.nullish(),
  whereEq: z.string().max(120).nullish(),
  unit: z.string().trim().max(30).nullish(),
  warn: z.boolean().default(false),
  chart: z.enum(['auto', 'number', 'bar', 'column', 'line', 'donut', 'treemap', 'table']).default('auto'),
  sort: z.enum(['desc', 'asc', 'label']).default('desc'),
  topN: z.number().int().min(1).max(50).nullish(),
  sortOrder: z.number().int().default(100),
}).transform((k) => ({
  ...k,
  // Atribut yang tak relevan dikosongkan, agar CHECK di tabel tidak gagal oleh sisa isian form.
  sumField: AGG.includes(k.measure) ? k.sumField || null : null,
  topN: k.topN ?? null,
  byField: k.byField || null,
  by2Field: k.by2Field || null,
  whereField: k.whereField && k.whereEq ? k.whereField : null,
  whereEq: k.whereField && k.whereEq ? k.whereEq : null,
  unit: k.unit || null,
})).refine((k) => !AGG.includes(k.measure) || k.sumField, { message: 'Atribut angka wajib dipilih untuk agregasi SUM/AVG/MIN/MAX', path: ['sumField'] });
type KpiInput = z.output<typeof kpiSchema>;

/** Kartu Ringkasan: kunci bawaan atau `kpi:<id>`, lebar 4–12 kolom (grid 12), tersembunyi atau tidak. Kunci unik. */
const layoutSchema = z.object({
  cards: z.array(z.object({
    key: z.string().regex(/^(hero|road|pju|util|tutupan|minimap|hazard|exposure|trend|pola|kpi:[0-9]+)$/),
    span: z.union([z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(12)]),
    hidden: z.boolean().default(false),
    // Tampilan kartu dari "Edit ringkasan": judul & catatan pengganti, ikon (`g:<nama ikon>` atau PNG unggahan yang sudah
    // diperkecil 64 px di browser), warna chip ikon. Hanya data:image/png: SVG/HTML tidak pernah disimpan atau dirender.
    title: z.string().trim().max(80).optional(),
    note: z.string().trim().max(240).optional(),
    icon: z.string().max(30_000).regex(/^(g:[A-Za-z]{1,40}|data:image\/png;base64,[A-Za-z0-9+/]+=*)$/).optional(),
    // Warna tema, atau warna bebas hex #RRGGBB dari pemilih warna (Hex/RGB/HSL/OKLCH dikonversi ke hex di browser).
    tone: z.union([z.enum(['accent', 'success', 'warning', 'danger', 'muted']), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]).optional(),
    // Keterangan bawah kartu: teks pengganti, atau disembunyikan.
    foot: z.string().trim().max(400).optional(),
    footOff: z.boolean().optional(),
    // Template baris angka (`{field}` diisi angka terkini di browser; teks biasa, dirender sebagai teks, bukan HTML).
    sub: z.string().trim().max(300).optional(),
    delta: z.string().trim().max(300).optional(),
    legend: z.string().trim().max(300).optional(),
    // Penempatan isi kartu: angka & grafik berdampingan, bertumpuk, atau grafik di atas (auto = ikut lebar kartu).
    arrange: z.enum(['auto', 'side', 'stack', 'chartFirst']).optional(),
    caption: z.string().trim().max(300).optional(),
  })).max(100).refine((c) => new Set(c.map((x) => x.key)).size === c.length, { message: 'Kartu ganda di tata letak' }),
});

const COLS = (sql: Sql) => sql`id, label, layer_slug, measure, sum_field, by_field, by2_field, chart2, where_field, where_eq, unit, warn, chart, sort, top_n, sort_order`;

/**
 * Tolak resep yang tak bisa dihitung: layer harus ada dan atribut harus dikenal layer (isian form, field kelas, atau
 * kunci yang memang ada di data). Kunci tetap dikirim berparameter ke /stats, jadi ini soal kebenaran, bukan keamanan.
 */
const assertComputable = async (sql: Sql, k: KpiInput) => {
  const layer = await getLayer(sql, k.layerSlug);
  if (AGG.includes(k.measure) && layer.fields.find((f) => f.key === k.sumField)?.type === 'text') throw new HttpError(400, `${k.sumField} bukan atribut angka`);
  const known = new Set([...layer.fields.map((f) => f.key), ...(layer.style.classField ? [layer.style.classField] : [])]);
  const keys = [k.sumField, k.byField, k.by2Field, k.whereField].filter((x): x is string => !!x && !known.has(x));
  if (!keys.length) return;
  const found = await sql<{ k: string }[]>`
    SELECT DISTINCT k FROM (SELECT properties FROM features WHERE layer_id = ${layer.id} LIMIT 500) f, jsonb_object_keys(f.properties) k
    WHERE k IN ${sql(keys)}`;
  const missing = keys.filter((x) => !found.some((r) => r.k === x));
  if (missing.length) throw new HttpError(400, `Atribut tidak dikenal di layer ${layer.name}: ${missing.join(', ')}`);
};

/** KPI kustom Ringkasan: semua user login membaca, editor mengelola. */
export const kpiRouter = (sql: Sql): Router => {
  const router = Router();
  const editor = requireRole(...EDITORS);

  router.get('/', async (_req, res) => {
    res.json(await sql`SELECT ${COLS(sql)} FROM kpi ORDER BY sort_order, id`);
  });

  // Tata letak kartu Ringkasan: dibaca semua user login, diubah editor. `cards: []` = kembali ke bawaan.
  router.get('/layout', async (_req, res) => {
    const [row] = await sql<{ cards: unknown }[]>`SELECT cards FROM ringkasan_layout WHERE id = 1`;
    res.json({ cards: row?.cards ?? [] });
  });

  router.put('/layout', editor, async (req, res) => {
    const { cards } = layoutSchema.parse(req.body);
    await sql`
      INSERT INTO ringkasan_layout (id, cards, updated_by) VALUES (1, ${sql.json(cards)}, ${req.user!.id})
      ON CONFLICT (id) DO UPDATE SET cards = EXCLUDED.cards, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(sql, req, 'update', 'layout', 1, { cards: cards.length });
    res.json({ cards });
  });

  router.post('/', editor, async (req, res) => {
    const k = kpiSchema.parse(req.body);
    await assertComputable(sql, k);
    const [row] = await sql`
      INSERT INTO kpi (label, layer_slug, measure, sum_field, by_field, by2_field, chart2, where_field, where_eq, unit, warn, chart, sort, top_n, sort_order, created_by)
      VALUES (${k.label}, ${k.layerSlug}, ${k.measure}, ${k.sumField}, ${k.byField}, ${k.by2Field}, ${k.chart2}, ${k.whereField}, ${k.whereEq}, ${k.unit}, ${k.warn}, ${k.chart}, ${k.sort}, ${k.topN}, ${k.sortOrder}, ${req.user!.id})
      RETURNING ${COLS(sql)}`;
    await audit(sql, req, 'create', 'kpi', row!.id, { label: k.label, layer: k.layerSlug });
    res.status(201).json(row);
  });

  // PATCH = ganti seluruh resep (form selalu mengirim semua isian), sehingga validasi silang tetap utuh.
  router.patch('/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const k = kpiSchema.parse(req.body);
    await assertComputable(sql, k);
    const [row] = await sql`
      UPDATE kpi SET label = ${k.label}, layer_slug = ${k.layerSlug}, measure = ${k.measure}, sum_field = ${k.sumField}, by_field = ${k.byField}, by2_field = ${k.by2Field}, chart2 = ${k.chart2},
        where_field = ${k.whereField}, where_eq = ${k.whereEq}, unit = ${k.unit}, warn = ${k.warn}, chart = ${k.chart}, sort = ${k.sort}, top_n = ${k.topN}, sort_order = ${k.sortOrder}
      WHERE id = ${id} RETURNING ${COLS(sql)}`;
    if (!row) throw notFound('KPI');
    await audit(sql, req, 'update', 'kpi', id, { label: k.label, layer: k.layerSlug });
    res.json(row);
  });

  router.delete('/:id', editor, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [row] = await sql<{ label: string }[]>`DELETE FROM kpi WHERE id = ${id} RETURNING label`;
    if (!row) throw notFound('KPI');
    await audit(sql, req, 'delete', 'kpi', id, { label: row.label });
    res.status(204).end();
  });

  return router;
};
