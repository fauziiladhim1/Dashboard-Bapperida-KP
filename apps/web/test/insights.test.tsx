import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/App';
import { HazardExposure } from '@/features/overview/insights';
import { PrefsProvider } from '@/lib/prefs';
import { mockApi } from './utils';

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter>{ui}</MemoryRouter></PrefsProvider></QueryClientProvider>);

describe('kartu keterpaparan bahaya', () => {
  it('keterpaparan: multi-bahaya jadi ringkasan, jenis lain jadi baris tabel', async () => {
    mockApi({ 'GET /stats/exposure': [
      { jenis: 'Multi-Bahaya', sekolah: 233, faskes: 35, wisata: 102, jalanKm: 555.6, permukimanHa: 7923.5 },
      { jenis: 'Banjir', sekolah: 53, faskes: 10, wisata: 16, jalanKm: 95.5, permukimanHa: 931.3 },
    ] });
    wrap(<HazardExposure />);
    // Angka ringkasan = AnimatedNumber (di jsdom tetap 0); ringkasan ada = 5 ukuran termasuk Wisata.
    expect(await screen.findByRole('rowheader', { name: 'Banjir' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Total di dalam zona multi-bahaya/ })).toBeInTheDocument();
    // Tabel (lebar) dan daftar (sempit) sama-sama dirender, CSS container query memilih salah satu.
    // Jenis bahaya -> peta dengan raster jenis itu menyala.
    for (const a of screen.getAllByRole('link', { name: 'Banjir' })) expect(a).toHaveAttribute('href', '/peta?layer=potensi-bencana&bahaya=Banjir');
    expect(screen.queryByRole('rowheader', { name: 'Multi-Bahaya' })).not.toBeInTheDocument();
  });
});
