import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { pageQuery } from '../lib/schemas.js';
import { EDITORS, requireRole } from '../middleware/auth.js';

export const audit = (sql: Sql, req: Request, action: string, entity: string, entityId: string | number | null, detail?: unknown) =>
  sql`INSERT INTO audit_logs (user_id, action, entity, entity_id, detail, ip)
      VALUES (${req.user?.id ?? null}, ${action}, ${entity}, ${entityId === null ? null : String(entityId)},
              ${detail === undefined ? null : sql.json(detail as never)}::jsonb, ${req.ip as string})`;

/** Rentang tanggal inklusif (YYYY-MM-DD, kalender WIB), keduanya opsional. */
const auditQuery = pageQuery.extend({ from: z.iso.date().optional(), to: z.iso.date().optional() });

export const auditRouter = (sql: Sql): Router =>
  Router().get('/', requireRole(...EDITORS), async (req, res) => {
    const { page, limit, from, to } = auditQuery.parse(req.query);
    const rows = await sql`
      SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.ip, a.created_at, u.name AS user_name,
             count(*) OVER () AS total
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE (${from ?? null}::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Jakarta')::date >= ${from ?? null}::date)
        AND (${to ?? null}::date IS NULL OR (a.created_at AT TIME ZONE 'Asia/Jakarta')::date <= ${to ?? null}::date)
      ORDER BY a.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    res.json({ total: Number(rows[0]?.total ?? 0), page, limit, data: rows.map(({ total: _t, ...r }) => r) });
  });
