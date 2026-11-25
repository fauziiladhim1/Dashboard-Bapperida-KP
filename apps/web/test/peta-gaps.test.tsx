import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/App';
import { FeaturePopup } from '@/features/peta/PetaPage';
import { PrefsProvider } from '@/lib/prefs';
import type { Layer } from '@/lib/types';
import { fakeMap } from './map-mock';
import { LAYERS, mockApi, renderAt, user } from './utils';

const zona = LAYERS.map((l) => (l.slug === 'potensi-bencana' ? { ...l, featureCount: 3, style: { color: '#DC2626', classField: 'kelas', ordinal: ['Rendah', 'Tinggi'], classes: { Rendah: '#A3D02C', Tinggi: '#FF0000' } } } : l));

describe('Peta: lokasi saya & potensi bencana', () => {
  it('tombol lokasi menampilkan titik pengguna; bahaya dinyalakan = raster InaRISK live, zona DB tidak digambar', async () => {
    const kotak = [[[110, -8], [110.3, -8], [110.3, -7.6], [110, -7.6], [110, -8]]];
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /layers': zona, 'GET /stats/kecamatan': [],
      'GET /layers/batas-administrasi/export': { type: 'FeatureCollection', features: [{ geometry: { type: 'Polygon', coordinates: kotak } }] } });
    renderAt('/peta');
    await userEvent.click(await screen.findByRole('button', { name: 'locate' }, { timeout: 5000 }));
    expect(screen.getByRole('img', { name: /Lokasi Anda/ })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('switch', { name: 'Tampilkan Potensi Bencana' })[0]!);
    // Raster per tile dari ImageServer BNPB (default Banjir), dipotong ke batas; zona vektor DB tidak ditambahkan.
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('hazard-raster', expect.objectContaining({ type: 'raster', tiles: ['inarisk://layer_bahaya_banjir/{bbox-epsg-3857}'], bounds: [110, -8, 110.3, -7.6] })));
    expect(fakeMap.addSource).not.toHaveBeenCalledWith('src-potensi-bencana', expect.anything());
    expect(screen.getAllByText('Indeks bahaya InaRISK BNPB').length).toBeGreaterThan(0); // judul legenda kelas
  });
});

describe('Peta: legenda (checkbox kelas & kelompok, ruas SK, titik)', () => {
  const grouped = { ...LAYERS[2]!, visibleDefault: true, style: { color: '#7CB342', classField: 'kelas', classes: { Sawah: '#7CB342', Kebun: '#888888', Hutan: '#1B5E20' }, groups: { Pertanian: ['Sawah', 'Kebun'], Hutan: ['Hutan'] } } };
  const ruasSk = { ...LAYERS[1]!, fields: [...LAYERS[1]!.fields, { key: 'panjang_km', label: 'Panjang (km)', type: 'number' as const }] };
  const pju = { ...LAYERS[4]!, visibleDefault: true };
  // Kelas tanpa classField (warna dari `classes` saja): legenda tanpa judul.
  const tanpaJudul = { ...LAYERS[6]!, slug: 'kawasan', name: 'Kawasan', visibleDefault: true, geomType: 'Polygon' as const, style: { color: '#000', classes: { A: '#111111', B: '#222222' } } };

  it('kelas dimatikan lalu dinyalakan lagi lewat checkbox; checkbox kelompok; ruas SK "N ruas, km"; titik per jumlah', async () => {
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': [LAYERS[0]!, ruasSk, grouped, pju, tanpaJudul], 'GET /stats/kecamatan': [],
      'GET /stats/layers/penggunaan-lahan': [{ key: 'Sawah', count: 2, lengthKm: 0, areaHa: 40 }, { key: 'Kebun', count: 1, lengthKm: 0, areaHa: 40 }, { key: 'Hutan', count: 1, lengthKm: 0, areaHa: 50 }],
      'GET /stats/layers/jalan-kabupaten': [{ key: 'Baik', count: 2, lengthKm: 3, areaHa: 0, value: 7.25 }],
      'GET /stats/layers/pju': [{ key: 'Menyala', count: 4, lengthKm: 0, areaHa: 0 }, { key: 'Mati', count: 1, lengthKm: 0, areaHa: 0 }],
      'GET /stats/layers/kawasan': [{ key: 'A', count: 1, lengthKm: 0, areaHa: 5 }, { key: 'B', count: 1, lengthKm: 0, areaHa: 3 }],
    });
    renderAt('/peta');
    expect((await screen.findAllByText('2 ruas, 7,3 km', {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0); // titik: jumlah, bukan luas/panjang

    const group = screen.getAllByRole('checkbox', { name: 'Tampilkan semua kelas Pertanian' })[0]!;
    await userEvent.click(group);
    expect(group).not.toBeChecked();
    await userEvent.click(group);
    expect(group).toBeChecked();

    const mati = screen.getAllByRole('checkbox', { name: /^Mati/ })[0]!;
    await userEvent.click(mati);
    expect(mati).not.toBeChecked();
    await userEvent.click(mati);
    expect(mati).toBeChecked();

    // Legenda tanpa judul tetap memunculkan "Tampilkan semua" saat ada kelas yang dimatikan.
    await userEvent.click(screen.getAllByRole('checkbox', { name: /^A/ })[0]!);
    expect(screen.getAllByRole('button', { name: 'Tampilkan semua' }).length).toBeGreaterThan(0);
  });
});

describe('Peta: popup ruas & layer bertingkat', () => {
  const show = (layer: Layer, properties: Record<string, unknown>) => {
    mockApi({ 'GET /auth/me': { user: user('viewer') }, 'GET /features/9': { type: 'Feature', id: '9', media: [], properties, updatedAt: '2026-11-11T06:46:15.056Z' } });
    return render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter>
      <FeaturePopup selected={{ id: '9', layer, lng: 110.5, lat: -7.5 }} onClose={vi.fn()} />
    </MemoryRouter></PrefsProvider></QueryClientProvider>);
  };
  const ruas = { ...LAYERS[1]!, sumber: 'DPUPKP', fields: [
    { key: 'nama_ruas', label: 'Nama Ruas', type: 'text' as const }, { key: 'kapanewon', label: 'Kapanewon', type: 'text' as const },
    { key: 'panjang_km', label: 'Panjang (km)', type: 'number' as const }, { key: 'lebar_km', label: 'Lebar', type: 'number' as const },
    { key: 'kondisi', label: 'Kondisi', type: 'select' as const, options: ['Baik', 'Rusak Berat'] },
  ] };

  it('ruas SK: tanpa grafik kondisi; Panjang resmi di baris pertama, tahun survei, kapanewon paling bawah; sumber data', async () => {
    show(ruas, { nama_ruas: 'Bendo - Bolon', kapanewon: 'Kalibawang', kecamatan: 'Kalibawang', panjang_km: 1.234, lebar_km: 0.005, kondisi: 'Rusak Berat', rusak_berat_km: 1.25, baik_km: 0.5, tahun_survei: 2025 });
    expect(await screen.findByText('1,23 km')).toBeInTheDocument();
    const labels = screen.getAllByRole('term').map((d) => d.textContent);
    expect(labels).toEqual(['Kondisi', 'Panjang', 'Tahun data', 'Tahun survei', 'Lebar', 'Kapanewon']);
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('0,01 km')).toBeInTheDocument();
    expect(screen.queryByText(/km disurvei|Kondisi survei/)).not.toBeInTheDocument();
    expect(screen.queryByText('1,25 km')).not.toBeInTheDocument(); // km per kondisi tidak di popup
    expect(screen.queryByText('Kalurahan')).not.toBeInTheDocument();
    expect(screen.getByText('DPUPKP')).toBeInTheDocument();
    // Hasil impor (tanpa penyunting): cukup tanggal, tanpa "· impor sistem".
    expect(screen.getByText(/^Diperbarui /).textContent).not.toContain('·');
  });

  it('ruas belum disurvei: cukup badge kelas, tanpa kalimat tambahan atau baris tahun survei', async () => {
    show(ruas, { nama_ruas: 'B', kondisi: 'Belum Disurvei' });
    expect(await screen.findByText('Belum Disurvei')).toBeInTheDocument();
    expect(screen.queryByText('Tahun survei')).not.toBeInTheDocument();
  });

  it('layer bertingkat: nilai + nama kelas; tahun tanpa pemisah ribuan', async () => {
    const steps = { field: 'jumlah', stops: [{ min: 0, label: 'Rendah', color: '#fee' }, { min: 1000, label: 'Sangat tinggi (≥ 1.000)', color: '#700' }] };
    const miskin = { ...LAYERS[0]!, slug: 'penduduk-miskin', style: { color: '#DC2626', steps },
      fields: [{ key: 'kalurahan', label: 'Kalurahan', type: 'text' as const }, { key: 'jumlah', label: 'Jumlah', type: 'number' as const }, { key: 'tahun', label: 'Tahun', type: 'number' as const }] };
    show(miskin, { kalurahan: 'Banjararum', jumlah: 1633, tahun: 2024 });
    expect(await screen.findByText('1.633 (Sangat tinggi)')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
  });
});
