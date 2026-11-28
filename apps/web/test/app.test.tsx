import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LAYERS, mockApi, page, renderAt, reply, user } from './utils';

const dashboardRoutes = {
  'GET /layers': LAYERS,
  'GET /stats/layers/jalan-kabupaten': [],
  'GET /stats/layers/pju': [],
  'GET /stats/layers/kawasan-pertanian': [],
  'GET /stats/layers/potensi-bencana': [],
  'GET /stats/layers/penggunaan-lahan': [],
  'GET /stats/layers/jalan-kabupaten/kecamatan': [],
  'GET /audit': page([]),
  'GET /users': [],
};

describe('autentikasi & routing', () => {
  it('belum login diarahkan ke halaman masuk, login gagal lalu berhasil', async () => {
    let loggedIn = false;
    const calls = mockApi({
      ...dashboardRoutes,
      'GET /auth/me': () => (loggedIn ? { user: user() } : reply(401, { error: 'Silakan login' })),
      'POST /auth/login': ({ body }: { body: { password: string } }) => {
        if (body.password !== 'benar') return reply(401, { error: 'Email atau password salah' });
        loggedIn = true;
        return { user: user() };
      },
    });
    renderAt('/data');
    const email = await screen.findByLabelText('Email');
    await userEvent.type(email, 'rina@kp.go.id');
    await userEvent.type(screen.getByLabelText('Password'), 'salah');
    await userEvent.click(screen.getByRole('button', { name: 'Tampilkan Password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan Password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /Masuk/ }));
    // Pesan gagal tampil sebagai toast pojok kanan bawah, bukan di dalam formulir.
    expect(await screen.findByText('Email atau password salah')).toBeInTheDocument();
    expect(document.querySelector('form')).not.toHaveTextContent('Email atau password salah');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'benar');
    expect(calls.filter((c) => c.url === '/auth/login').at(-1)?.body).toEqual({ email: 'rina@kp.go.id', password: 'salah', remember: false });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ingat Saya' }));
    await userEvent.click(screen.getByRole('button', { name: /Masuk/ }));
    expect((await screen.findAllByText('Jumlah Penduduk Miskin', {}, { timeout: 12000 }))[0]).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/auth/login').at(-1)?.body).toEqual({ email: 'rina@kp.go.id', password: 'benar', remember: true });
  });

  it('pendaftaran menampilkan pesan menunggu persetujuan', async () => {
    const calls = mockApi({
      'GET /auth/me': reply(401),
      'POST /auth/register': { message: 'Akun menunggu persetujuan superadmin.' },
    });
    renderAt('/login');
    await userEvent.click(await screen.findByRole('tab', { name: 'Daftar' }));
    await userEvent.type(screen.getByLabelText('Nama Lengkap'), 'Budi');
    await userEvent.type(screen.getByLabelText('Email'), 'budi@kp.go.id');
    await userEvent.type(screen.getByLabelText('Password'), 'Kunci-Rahasia-2026');
    await userEvent.type(screen.getByLabelText('Ulangi Password'), 'Kunci-Rahasia-2027');
    await userEvent.click(screen.getByRole('button', { name: 'Buat Akun' }));
    expect(await screen.findByText('Password tidak sama.')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/auth/register')).toBe(false);
    await userEvent.clear(screen.getByLabelText('Ulangi Password'));
    await userEvent.type(screen.getByLabelText('Ulangi Password'), 'Kunci-Rahasia-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Buat Akun' }));
    expect(await screen.findByText('Pendaftaran terkirim')).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ name: 'Budi', email: 'budi@kp.go.id', password: 'Kunci-Rahasia-2026' });
    expect(await screen.findByRole('heading', { name: 'Selamat Datang' })).toBeInTheDocument();
  });

  it('user yang sudah login tidak bisa membuka halaman login', async () => {
    mockApi({ ...dashboardRoutes, 'GET /auth/me': { user: user() } });
    renderAt('/login');
    expect((await screen.findAllByText('Jumlah Penduduk Miskin', {}, { timeout: 12000 }))[0]).toBeInTheDocument();
  });

  it('error server saat cek sesi -> dianggap belum login', async () => {
    mockApi({ 'GET /auth/me': reply(500) });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Selamat Datang' })).toBeInTheDocument();
  });

  it('role guard 403 dan sesi kedaluwarsa', async () => {
    let expired = false;
    mockApi({ ...dashboardRoutes, 'GET /auth/me': () => (expired ? reply(401) : { user: user('viewer') }), 'GET /layers': () => (expired ? reply(401) : LAYERS) });
    const { client } = renderAt('/pengguna');
    expect(await screen.findByRole('heading', { name: 'Wilayah ini terbatas' }, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Navigasi Utama' })).queryByRole('link', { name: /Pengguna/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('link', { name: 'Peta' })[0]!);
    await waitFor(() => expect(window.location.pathname).toBe('/peta'));
    expired = true;
    await client.invalidateQueries({ queryKey: ['layers'] });
    expect(await screen.findByRole('heading', { name: 'Selamat Datang' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('mutasi 401 juga mengakhiri sesi', async () => {
    mockApi({ ...dashboardRoutes, 'GET /auth/me': { user: user() }, 'POST /layers': reply(401) });
    const { client } = renderAt('/');
    await screen.findAllByText('Jumlah Penduduk Miskin', {}, { timeout: 5000 });
    await client.getMutationCache().build(client, { mutationFn: () => import('@/lib/api').then((m) => m.endpoints.createLayer({})) }).execute(undefined).catch(() => undefined);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Selamat Datang' })).toBeInTheDocument());
    client.getMutationCache().build(client, { mutationFn: () => Promise.reject(new Error('lain')) }).execute(undefined).catch(() => undefined);
  });

  it('menu mobile dan logout', async () => {
    const calls = mockApi({ ...dashboardRoutes, 'GET /auth/me': { user: user() }, 'POST /auth/logout': reply(204), 'GET /stats/kecamatan': [] });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Buka Menu' }, { timeout: 5000 }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('link', { name: 'Peta' }));
    await waitFor(() => expect(window.location.pathname).toBe('/peta'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Keluar' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Selamat Datang' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/auth/logout')).toBe(true);
  });
});
