import { renderHook, screen, waitFor } from '@testing-library/react';
import { PrefsProvider, usePrefs } from '@/lib/prefs';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LAYERS, mockApi, renderAt, reply, user } from './utils';

const boom = vi.hoisted(() => ({ on: true }));
vi.mock('@/features/users/UsersPage', () => ({
  default: () => {
    if (boom.on) throw new Error('render gagal');
    return <p>halaman pengguna</p>;
  },
}));

const routes = { 'GET /auth/me': { user: user() }, 'GET /layers': LAYERS, 'GET /stats/kecamatan': [] };

describe('Halaman error', () => {
  it('route tidak dikenal -> 404 di dalam shell', async () => {
    mockApi(routes);
    renderAt('/tidak-ada');
    expect(await screen.findByRole('heading', { name: 'Titik ini tidak ada di peta' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigasi Utama' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/i })).not.toBeInTheDocument();
  });

  it('halaman crash -> 500, coba lagi merender ulang, pindah halaman mereset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockApi(routes);
    renderAt('/pengguna');
    expect(await screen.findByRole('heading', { name: 'Peta gagal dimuat' }, { timeout: 5000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    expect(await screen.findByRole('heading', { name: 'Peta gagal dimuat' })).toBeInTheDocument();

    boom.on = false;
    await userEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    expect(await screen.findByText('halaman pengguna')).toBeInTheDocument();

    boom.on = true;
    await userEvent.click(screen.getAllByRole('link', { name: 'Ringkasan' })[0]!);
    await userEvent.click(screen.getAllByRole('link', { name: 'Pengguna' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Peta gagal dimuat' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /Kembali ke ringkasan/i }));
    expect((await screen.findAllByText('Jumlah Penduduk Miskin', {}, { timeout: 12000 }))[0]).toBeInTheDocument();
  });
});

describe('Preferensi & mode login', () => {
  it('storage tak tersedia, ganti bahasa, register -> login', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('privat'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('privat'); });
    mockApi({ 'GET /auth/me': reply(401) });
    renderAt('/register');
    await userEvent.click(await screen.findByRole('radio', { name: 'EN' }, { timeout: 5000 }));
    expect(document.documentElement.lang).toBe('en');
    await userEvent.click(screen.getByRole('tab', { name: 'Sign in' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(get).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
  });
});

describe('PrefsProvider', () => {
  it('membaca bahasa & tema tersimpan; variabel hilang tetap tampil', () => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => usePrefs(), { wrapper: PrefsProvider });
    expect(result.current.lang).toBe('en');
    expect(result.current.theme).toBe('dark');
    expect(result.current.t('data.count')).toBe('{n} feature(s)');
    localStorage.setItem('theme', 'light');
    expect(renderHook(() => usePrefs(), { wrapper: PrefsProvider }).result.current.theme).toBe('light');
    // Tanpa pilihan tersimpan: ikut preferensi sistem.
    localStorage.removeItem('theme');
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(renderHook(() => usePrefs(), { wrapper: PrefsProvider }).result.current.theme).toBe('dark');
  });
});

describe('Pagination', () => {
  it('menyisipkan celah pada banyak halaman', async () => {
    const { Pagination } = await import('@/components/common/Pagination');
    const onChange = vi.fn();
    const { render } = await import('@testing-library/react');
    render(<PrefsProvider><Pagination page={5} pages={10} onChange={onChange} /></PrefsProvider>);
    expect(screen.getAllByText('…')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 10' }));
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
