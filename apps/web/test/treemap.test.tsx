import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/App';
import { PolaRuang, squarify } from '@/features/overview/widgets';
import { PrefsProvider } from '@/lib/prefs';
import { LAYERS } from './utils';

describe('squarify', () => {
  it('kotak mengisi wadah tanpa sisa, luas sebanding nilai', () => {
    const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ k: i, v }));
    const r = squarify(items, 100, 56);
    expect(r.reduce((s, b) => s + b.w * b.h, 0)).toBeCloseTo(5600, 6);
    for (const b of r) expect(b.w * b.h).toBeCloseTo((b.v / 24) * 5600, 6);
    for (const b of r) expect(b.x + b.w).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe('PolaRuang', () => {
  it('7 kelas terluas + Lainnya, porsi persen, kunci kosong dibuang', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((key, i) => ({ key, count: 1, lengthKm: 0, areaHa: 100 - i * 10 }));
    render(<QueryClientProvider client={createQueryClient()}><PrefsProvider><MemoryRouter>
      <PolaRuang rows={[...rows, { key: null, count: 1, lengthKm: 0, areaHa: 50 }]} layer={LAYERS.find((l) => l.slug === 'penggunaan-lahan')} />
    </MemoryRouter></PrefsProvider></QueryClientProvider>);
    const list = screen.getByRole('list', { name: 'Rencana pola ruang' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent('A');
    expect(items.at(-1)).toHaveTextContent('Lainnya');
    expect(screen.getByRole('link', { name: /Rencana pola ruang/ })).toHaveAttribute('href', '/peta?layer=penggunaan-lahan');
  });
});
