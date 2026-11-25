import { Router } from 'express';
import { z } from 'zod';
import type { Sql } from '../db/client.js';
import { HttpError, notFound } from '../lib/http.js';
import { idParam } from '../lib/schemas.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from './audit.js';

const listQuery = z.object({ status: z.enum(['pending', 'active', 'rejected']).optional() });
const patchSchema = z
  .object({ status: z.enum(['pending', 'active', 'rejected']), role: z.enum(['superadmin', 'editor', 'viewer']) })
  .partial()
  .refine((b) => b.status || b.role, 'Isi status atau role');

export const usersRouter = (sql: Sql): Router => {
  const router = Router().use(requireRole('superadmin'));

  router.get('/', async (req, res) => {
    const { status } = listQuery.parse(req.query);
    res.json(await sql`
      SELECT id, name, email, role, status, created_at FROM users
      ${status ? sql`WHERE status = ${status}` : sql``} ORDER BY created_at DESC`);
  });

  const target = (req: { params: unknown; user?: { id: number } }) => {
    const { id } = idParam.parse(req.params);
    if (id === req.user!.id) throw new HttpError(400, 'Tidak dapat mengubah akun sendiri');
    return id;
  };

  router.patch('/:id', async (req, res) => {
    const id = target(req);
    const body = patchSchema.parse(req.body);
    const [user] = await sql`
      UPDATE users SET status = coalesce(${body.status ?? null}::user_status, status), role = coalesce(${body.role ?? null}::user_role, role)
      WHERE id = ${id} RETURNING id, name, email, role, status, created_at`;
    if (!user) throw notFound('Pengguna');
    await audit(sql, req, 'update', 'user', id, body);
    res.json(user);
  });

  router.delete('/:id', async (req, res) => {
    const id = target(req);
    const { count } = await sql`DELETE FROM users WHERE id = ${id}`;
    if (!count) throw notFound('Pengguna');
    await audit(sql, req, 'delete', 'user', id);
    res.status(204).end();
  });

  return router;
};
