import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { parseFields } from '@/features/data/LayerDialog';
import { can, canEdit } from '@/hooks/use-auth';
import { api, ApiError, endpoints, refreshData } from '@/lib/api';
import { QueryClient } from '@tanstack/react-query';
import { fmt, fmtCompact, fmtDateTime, fmtLongDate, getLocale, greetingKey, pct, setLocale, slugify } from '@/lib/format';
import { auditText, DICT } from '@/lib/i18n';
import { colorExpression, colorField, colorOf, legendOf, tileUrl, classFilter } from '@/lib/layer-style';
import { mockApi, reply, user } from './utils';
import { sentenceCase } from '@/lib/utils';

describe('api', () => {
  it('mengirim JSON, menangani 204 dan error dengan issues', async () => {
    const calls = mockApi({
      'POST /x': (r: { body: unknown }) => r.body,
      'DELETE /x': reply(204),
      'GET /bad': reply(400, { error: 'Input tidak valid', issues: [{ path: 'email', message: 'salah' }] }),
      'GET /plain': reply(500),
    });
    expect(await api('/x', { method: 'POST', json: { a: 1 } })).toEqual({ a: 1 });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { a: 1 } });
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
    await expect(api('/bad')).rejects.toThrow('Input tidak valid — email: salah');
    await expect(api('/plain')).rejects.toMatchObject({ status: 500, message: 'Permintaan gagal (500)' });
    const err = await api('/bad').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('respons non-JSON tetap menjadi error', async () => {
    globalThis.fetch = (async () => new Response('<html>', { status: 502 })) as typeof fetch;
    await expect(api('/x')).rejects.toThrow('Permintaan gagal (502)');
  });

  it('semua endpoint memanggil URL dan method yang benar', async () => {
    // Semua rute tidak dimock (599): yang diperiksa hanya URL + method.
    const calls = mockApi({});
    const file = new File(['x'], 'a.zip');
    const run = [
      endpoints.me(), endpoints.login({ email: 'a', password: 'b' }), endpoints.register({ name: 'a', email: 'b', password: 'c' }), endpoints.logout(),
      endpoints.layers(), endpoints.createLayer({}), endpoints.updateLayer(1, {}), endpoints.deleteLayer(1),
      endpoints.features('pju', { page: 2, q: '' }), endpoints.feature(5), endpoints.createFeature('pju', {}), endpoints.updateFeature(5, {}),
      endpoints.deleteFeature(5), endpoints.bulkDelete('pju', [1]), endpoints.uploadShp('pju', file, 'replace', true), endpoints.uploadMedia(5, file),
      endpoints.deleteMedia(9), endpoints.stats('pju'), endpoints.stats('pju', { by: 'kondisi' }), endpoints.kecamatan(),
      endpoints.users(), endpoints.users('pending'), endpoints.updateUser(2, { status: 'active' }), endpoints.deleteUser(2), endpoints.audit(3),
    ];
    await Promise.allSettled(run);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /auth/me', 'POST /auth/login', 'POST /auth/register', 'POST /auth/logout',
      'GET /layers', 'POST /layers', 'PATCH /layers/1', 'DELETE /layers/1',
      'GET /layers/pju/features?page=2', 'GET /features/5', 'POST /layers/pju/features', 'PATCH /features/5',
      'DELETE /features/5', 'POST /layers/pju/features/bulk-delete', 'POST /layers/pju/upload?mode=replace&dryRun=true', 'POST /features/5/media',
      'DELETE /media/9', 'GET /stats/layers/pju', 'GET /stats/layers/pju?by=kondisi', 'GET /stats/kecamatan',
      'GET /users', 'GET /users?status=pending', 'PATCH /users/2', 'DELETE /users/2', 'GET /audit?page=3&limit=20',
    ]);
    expect(endpoints.exportUrl('pju', 'csv', 'Wates')).toBe('/api/v1/layers/pju/export?format=csv&kecamatan=Wates');
  });
});

describe('format', () => {
  it('angka, persen, tanggal, salam, slug, audit', () => {
    expect(fmt(1234.56)).toBe('1.234,6');
    expect(fmtCompact(15400)).toMatch(/15,4/);
    expect(fmtDateTime('2026-11-01T03:00:00Z')).toMatch(/2026/);
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 0)).toBe(0);
    expect([8, 12, 16, 20].map((h) => greetingKey(new Date(2026, 0, 1, h)))).toEqual(['greet.morning', 'greet.noon', 'greet.afternoon', 'greet.evening']);
    setLocale('en-GB');
    expect(getLocale()).toBe('en-GB');
    expect(fmt(1234.56)).toBe('1,234.6');
    expect(fmtLongDate(new Date(2026, 10, 1))).toMatch(/November 2026/);
    setLocale('id-ID');
    expect(slugify('  Data Pendukung: Sekolah!  ')).toBe('data-pendukung-sekolah');
    const t = (k: keyof typeof DICT.id) => DICT.id[k];
    expect(auditText(t, { action: 'create', entity: 'feature', entityId: '5' })).toBe('menambah fitur #5');
    expect(auditText(t, { action: 'aneh', entity: 'lain', entityId: null })).toBe('aneh lain');
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.id).sort());
  });
});

describe('layer-style', () => {
  it('ekspresi warna, legenda, warna kelas, URL tile', () => {
    expect(colorExpression({ color: '#111' })).toBe('#111');
    expect(colorExpression({ color: '#111', classField: 'k', classes: {} })).toBe('#111');
    expect(colorExpression({ color: '#111', classField: 'k', classes: { A: '#a' } })).toEqual(['match', ['to-string', ['get', 'k']], 'A', '#a', '#111']);
    expect(legendOf({ color: '#111' })).toEqual([{ key: '', label: 'Fitur', color: '#111' }]);
    expect(legendOf({ color: '#111', classes: { A: '#a' }, labels: { A: 'Kelas A' } })).toEqual([{ key: 'A', label: 'Kelas A', color: '#a' }]);
    // Urutan kunci jsonb acak: kelas abjad dengan angka wajar; ordinal mengikuti skalanya.
    expect(legendOf({ color: '#1', classes: { 'KSPD 2': '#a', 'KPPD 10': '#a', 'KPPD 2': '#a', 'KSPD 1': '#a' } }).map((c) => c.key)).toEqual(['KPPD 2', 'KPPD 10', 'KSPD 1', 'KSPD 2']);
    expect(legendOf({ color: '#1', ordinal: ['Rendah', 'Tinggi'], classes: { Tinggi: '#a', Rendah: '#b' } }).map((c) => c.key)).toEqual(['Rendah', 'Tinggi']);
    expect(colorOf({ color: '#111', classes: { A: '#a' } }, 'A')).toBe('#a');
    expect(colorOf({ color: '#111' }, null)).toBe('#111');
    expect(colorOf({ color: '#111' }, 'B')).toBe('#111');
    // Bertingkat: ekspresi step dari atribut angka, legenda dari stop, warna nilai = stop terakhir yang dilampaui.
    const steps = { color: '#111', steps: { field: 'n', stops: [{ min: 0, label: '< 10', color: '#a' }, { min: 10, label: '≥ 10', color: '#b' }] } };
    expect(colorExpression(steps)).toEqual(['step', ['to-number', ['get', 'n'], -1], '#a', 10, '#b']);
    expect(legendOf(steps)).toEqual([{ key: '0', label: '< 10', color: '#a' }, { key: '1', label: '≥ 10', color: '#b' }]);
    // Kelas dimatikan: kategori -> nilai di luar daftar; bertingkat -> rentang stop dibuang (stop terakhir terbuka ke atas).
    expect(classFilter(steps, [])).toBeNull();
    expect(classFilter({ color: '#1' }, ['A'])).toBeNull();
    expect(classFilter({ color: '#1', classField: 'k' }, ['A'])).toEqual(['!', ['in', ['coalesce', ['to-string', ['get', 'k']], ''], ['literal', ['A']]]]);
    const v = ['to-number', ['get', 'n'], -1];
    expect(classFilter(steps, ['0', '1'])).toEqual(['all', ['!', ['all', ['>=', v, 0], ['<', v, 10]]], ['!', ['>=', v, 10]]]);
    expect([colorOf(steps, '3'), colorOf(steps, '10'), colorOf(steps, '-5'), colorOf(steps, null), colorOf(steps, 'x')]).toEqual(['#a', '#b', '#a', '#111', '#111']);
    expect([colorField(steps), colorField({ color: '#1', classField: 'k' })]).toEqual(['n', 'k']);
    expect(tileUrl({ slug: 'pju', updatedAt: '2026-01-01T00:00:00Z' })).toBe(`${location.origin}/api/v1/tiles/pju/{z}/{x}/{y}?v=1767225600000`);
    expect(tileUrl({ slug: 'pju', updatedAt: '2026-01-01T00:00:00Z' }, 'Wates')).toMatch(/&kecamatan=Wates$/);
  });
});

describe('parsers & auth helpers', () => {
  it('parseFields', () => {
    expect(parseFields('nama | Nama\n\njenis | Jenis | select | SD, SMP,\nluas||number\nx | X | aneh')).toEqual([
      { key: 'nama', label: 'Nama', type: 'text' },
      { key: 'jenis', label: 'Jenis', type: 'select', options: ['SD', 'SMP'] },
      { key: 'luas', label: '', type: 'number' },
      { key: 'x', label: 'X', type: 'text' },
    ]);
    expect(parseFields('kode')).toEqual([{ key: 'kode', label: 'kode', type: 'text' }]);
  });

  it('can / canEdit', () => {
    expect(can(null, 'viewer')).toBe(false);
    expect(canEdit(user('editor'))).toBe(true);
    expect(canEdit(user('viewer'))).toBe(false);
  });
});

describe('pageList', () => {
  it('menampilkan ujung, sekitar halaman aktif, dan celah', async () => {
    const { pageList } = await import('@/components/common/Pagination');
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
    expect(pageList(10, 10)).toEqual([1, '…', 9, 10]);
  });
});

describe('sentenceCase', () => {
  it('kapital huruf pertama, singkatan dibiarkan', () => {
    expect(sentenceCase('Kawasan Strategis SRS 2')).toBe('Kawasan strategis SRS 2');
  });
});

describe('notify', () => {
  it('konfirmasi Ya/Tidak: nama data tampil sebagai teks, "Tidak" = false, hapus pakai tombol merah', async () => {
    const { confirmDanger, confirmEdit } = await import('@/lib/notify');
    const edit = confirmEdit({ title: 'Simpan?', text: 'Teks', confirm: 'Ya, simpan', cancel: 'Tidak', subject: '<b>Pantai Glagah</b>' });
    await waitFor(() => expect(document.querySelector('.swal-subject')?.textContent).toBe('<b>Pantai Glagah</b>'));
    expect(document.querySelector('.swal2-confirm')).not.toHaveClass('swal-danger');
    (document.querySelector('.swal2-cancel') as HTMLButtonElement).click();
    expect(await edit).toBe(false);
    const del = confirmDanger({ title: 'Hapus?', text: 'Teks', confirm: 'Ya, hapus', cancel: 'Tidak' });
    await waitFor(() => expect(document.querySelector('.swal2-confirm')).toHaveClass('swal-danger'));
    (document.querySelector('.swal2-confirm') as HTMLButtonElement).click();
    expect(await del).toBe(true);
  });
});

describe('popupRows', () => {
  it('kolom terisi + wajib + wilayah tampil, kolom opsional kosong disembunyikan, judul & kelas & km kondisi tidak diulang', async () => {
    const { popupRows } = await import('@/features/peta/PetaPage');
    const layer = { style: { color: '#1', classField: 'kawasan' }, fields: [{ key: 'nama' }, { key: 'kode', required: true }, { key: 'kawasan' }, { key: 'tema' }] } as never;
    const keys = (p: Record<string, unknown>) => popupRows(layer, p).map(([k]) => k);
    expect(keys({ nama: 'Pantai Bugel', kode: 'A1', kawasan: 'KSPD 1', tema: 'Pansela', kalurahan: 'Bugel', kecamatan: 'Panjatan', baik_km: 2 }))
      .toEqual(['kode', 'tema', 'kalurahan', 'kecamatan']);
    // Kosong: wajib & wilayah tetap ("—"), opsional dan ekstra kosong hilang.
    const b = popupRows(layer, { nama: 'Rajendra Farm', kawasan: 'KSPD 3', tema: '', catatan: null });
    expect(b).toEqual([['kode', null], ['kalurahan', null], ['kecamatan', null]]);
  });

  it('urutan seragam: tahun survei, atribut, ekstra, wilayah paling bawah; ukuran resmi & km kondisi tidak di tabel', async () => {
    const { popupRows } = await import('@/features/peta/PetaPage');
    const road = { style: { color: '#1', classField: 'kondisi' }, fields: [{ key: 'nama_ruas' }, { key: 'nomor_ruas' }, { key: 'kapanewon' }, { key: 'panjang_km' }, { key: 'kondisi' }] } as never;
    const keys = popupRows(road, { nama_ruas: 'Bendo - Bolon', nomor_ruas: '12', kapanewon: 'Wates', kecamatan: 'Wates', panjang_km: 1.7, kondisi: 'Baik', baik_km: 1, tahun_survei: 2025 }).map(([k]) => k);
    expect(keys).toEqual(['tahun_survei', 'nomor_ruas', 'kapanewon']);
    const poly = { style: { color: '#1', classField: 'pola_ruang' }, fields: [{ key: 'kelas' }, { key: 'pola_ruang' }] } as never;
    expect(popupRows(poly, { kelas: 'Sawah', pola_ruang: 'X', luas_ha: 3, keterangan: 'Y', kecamatan: 'Galur', kalurahan: 'Banaran' }).map(([k]) => k))
      .toEqual(['kelas', 'keterangan', 'kalurahan', 'kecamatan']);
  });
});

describe('refreshData', () => {
  it('semua query data basi (Ringkasan ikut berubah setelah edit), sesi tidak', async () => {
    const qc = new QueryClient();
    for (const k of ['stats', 'timeseries', 'ruas-jalan', 'layers', 'kecamatan', 'me']) qc.setQueryData([k], 1);
    await refreshData(qc);
    const stale = (k: string) => qc.getQueryState([k])!.isInvalidated;
    expect(['stats', 'timeseries', 'ruas-jalan', 'layers', 'kecamatan'].every(stale)).toBe(true);
    expect(stale('me')).toBe(false);
  });
});
