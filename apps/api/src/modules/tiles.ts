import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError } from '../lib/http.js';
import { kecamatanFilter } from './features.js';
import { getLayer, layerScope } from './layers.js';
import { featuresSrc } from './tabular.js';

const tileParams = z.object({
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  y: z.string().regex(/^\d+(\.pbf)?$/).transform((y) => Number.parseInt(y, 10)),
});

/**
 * Vector tile (MVT) langsung dari PostGIS. Jauh lebih ringan daripada mengirim GeoJSON penuh:
 * hanya fitur di dalam tile yang dikirim dan geometrinya disederhanakan sesuai zoom.
 * Klien menambahkan ?v=<updated_at layer> sehingga cache browser aman disimpan lama.
 */
export const tilesRouter = (sql: Sql): Router =>
  Router().get('/:slug/:z/:x/:y', async (req, res) => {
    const { z: zoom, x, y } = tileParams.parse(req.params);
    if (x >= 2 ** zoom || y >= 2 ** zoom) throw new HttpError(400, 'Koordinat tile tidak valid');
    const layer = await getLayer(sql, req.params.slug);
    const kecamatan = z.string().max(80).optional().parse(req.query.kecamatan);
    // Ruas SK: kelas kondisi dari survei terakhir <= tahun global (lihat ruas_props).
    const tahun = z.coerce.number().int().min(2000).max(2100).optional().parse(req.query.tahun);
    const [row] = await sql<{ tile: Buffer }[]>`
      WITH bounds AS (SELECT ST_TileEnvelope(${zoom}, ${x}, ${y}) AS env),
      mvt AS (
        SELECT f.id, f.properties, ST_AsMVTGeom(ST_Transform(f.geom, 3857), b.env, 4096, 64, true) AS geom
        FROM ${featuresSrc(sql, layer, tahun)} f, bounds b
        WHERE ${layerScope(sql, layer)} ${kecamatanFilter(sql, kecamatan)} AND f.geom && ST_Transform(b.env, 4326)
      )
      SELECT ST_AsMVT(mvt.*, 'features', 4096, 'geom', 'id') AS tile FROM mvt`;
    res.set('Cache-Control', 'private, max-age=86400').type('application/vnd.mapbox-vector-tile').send(row!.tile);
  });
