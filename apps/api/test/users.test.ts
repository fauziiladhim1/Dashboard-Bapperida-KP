import { describe, expect, it } from 'vitest';
import { API, createUser, loginAs } from './helpers.js';

describe('users (superadmin)', () => {
  it('viewer/editor tidak boleh mengelola pengguna', async () => {
    const { agent } = await loginAs('editor');
    await agent.get(`${API}/users`).expect(403);
  });

  it('daftar, filter, approve, ubah role, hapus', async () => {
    const { agent, id: selfId } = await loginAs('superadmin');
    const pending = await createUser('viewer', 'pending');

    const all = await agent.get(`${API}/users`).expect(200);
    expect(all.body.length).toBeGreaterThan(1);
    const onlyPending = await agent.get(`${API}/users?status=pending`).expect(200);
    expect(onlyPending.body.every((u: { status: string }) => u.status === 'pending')).toBe(true);

    const approved = await agent.patch(`${API}/users/${pending.id}`).send({ status: 'active' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'active', role: 'viewer' });
    const promoted = await agent.patch(`${API}/users/${pending.id}`).send({ role: 'editor' }).expect(200);
    expect(promoted.body).toMatchObject({ status: 'active', role: 'editor' });

    await agent.patch(`${API}/users/${pending.id}`).send({}).expect(400);
    await agent.patch(`${API}/users/${selfId}`).send({ status: 'rejected' }).expect(400);
    await agent.patch(`${API}/users/999999`).send({ status: 'active' }).expect(404);

    await agent.delete(`${API}/users/${pending.id}`).expect(204);
    await agent.delete(`${API}/users/${pending.id}`).expect(404);
    await agent.delete(`${API}/users/abc`).expect(400);
  });
});
