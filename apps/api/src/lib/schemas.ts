import { z } from 'zod';

// Koordinat wajib WGS84 (EPSG:4326). Nilai di luar rentang biasanya berarti data UTM tanpa file .prj.
const position = z
  .array(z.number())
  .min(2)
  .max(4)
  .refine(([lon, lat]) => Math.abs(lon!) <= 180 && Math.abs(lat!) <= 90, 'Koordinat di luar rentang WGS84 (cek proyeksi / file .prj)');
const ring = z.array(position).min(4);

export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('MultiPoint'), coordinates: z.array(position).min(1) }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2)).min(1) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
export type Geometry = z.infer<typeof geometrySchema>;

export const propertiesSchema = z.record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]));

export const idParam = z.object({ id: z.coerce.number().int().positive() });

// ponytail: offset cukup untuk ribuan fitur per layer; keyset (?after=id) bila satu layer > 100 rb baris.
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** Maks. 50 baris per halaman: respons tetap kecil dan halaman cepat terbuka. */
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** "MultiPolygon" -> "Polygon" */
export const baseGeomType = (type: string): string => type.replace(/^Multi/, '');
