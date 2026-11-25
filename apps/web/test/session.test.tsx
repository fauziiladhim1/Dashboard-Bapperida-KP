import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/App';
import { Pagination } from '@/components/common/Pagination';
import { VectorLayers } from '@/components/map/VectorLayers';
import { drawnWkt } from '@/features/data/FeatureDialog';
import { LayerDialog } from '@/features/data/LayerDialog';
import { MiniDonut, pickChart } from '@/features/overview/widgets';
import { symbolOf } from '@/features/peta/PetaPage';
import { PrefsProvider } from '@/lib/prefs';
import { fakeMap } from './map-mock';
import { choose, LAYERS } from './utils';

const bare = (ui: ReactNode) => render(<QueryClientProvider client={createQueryClient()}><PrefsProvider>{ui}</PrefsProvider></QueryClientProvider>);

describe('Pagination: lompat halaman & jumlah baris', () => {
  it('Enter/blur melompat (dijepit 1..pages), kosong/sama tidak memicu; pilihan baris per halaman', async () => {
    const onChange = vi.fn();
    const onSize = vi.fn();
    bare(<Pagination page={2} pages={5} onChange={onChange} size={20} onSize={onSize} />);
    const jump = screen.getByRole('spinbutton', { name: 'Lompat ke halaman (1–5)' });
    await userEvent.type(jump, '4{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.type(jump, '99');
    fireEvent.blur(jump);
    expect(onChange).toHaveBeenLastCalledWith(5);
    await userEvent.type(jump, '2{Enter}'); // halaman aktif: tidak memicu
    fireEvent.blur(jump); // kosong: tidak memicu
    expect(onChange).toHaveBeenCalledTimes(2);
    await choose('Baris', '50');
    expect(onSize).toHaveBeenCalledWith(50);
  });

  it('satu halaman: tanpa kolom lompat dan tanpa pilihan baris', () => {
    bare(<Pagination page={1} pages={1} onChange={vi.fn()} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Baris/ })).not.toBeInTheDocument();
  });
});

describe('Bentuk grafik dari data', () => {
  it('pickChart: tahun = garis, kategori sedikit = donut, banyak/non-aditif = batang, kosong = angka', () => {
    expect(pickChart([])).toBe('number');
    expect(pickChart(['2024', '2025'])).toBe('line');
    expect(pickChart(['2024'])).toBe('donut');
    expect(pickChart(['A', null])).toBe('donut');
    expect(pickChart(['A', 'B'], false)).toBe('bar');
    expect(pickChart(['1', '2', '3', '4', '5', '6', '7'])).toBe('bar');
  });

  it('MiniDonut: > 5 irisan digabung "Lainnya", arahkan = porsi di tengah; kosong = tidak dirender', () => {
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k, i) => ({ key: k, label: k, value: 70 - i * 10, color: '#123456' }));
    const total = items.reduce((n, i) => n + i.value, 0);
    const { unmount } = bare(<MiniDonut items={items} total={total} title="Komposisi" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((li) => li.textContent?.split(/\d/)[0])).toEqual(['A', 'B', 'C', 'D', 'E', 'Lainnya']);
    expect(screen.getAllByText('25%')).toHaveLength(1); // tengah kosong tanpa arahan
    fireEvent.mouseEnter(rows[0]!);
    expect(screen.getAllByText('25%')).toHaveLength(2); // tengah + legenda
    fireEvent.mouseEnter(document.querySelector('circle')!);
    fireEvent.mouseLeave(rows[0]!.closest('ul')!.parentElement!.parentElement!);
    expect(screen.getAllByText('25%')).toHaveLength(1);
    unmount();
    const { container } = bare(<MiniDonut items={[]} total={0} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Simbol layer di panel peta', () => {
  it('satu warna dasar layer; batas administrasi di tema gelap = abu terang', () => {
    const batas = { slug: 'batas-administrasi', style: { color: '#111827' } };
    expect(symbolOf(batas, true)).toBe('#E5E7EB');
    expect(symbolOf(batas, false)).toBe('#111827');
    expect(symbolOf({ slug: 'x', style: { color: '#000', classField: 'k', classes: { A: '#aaa', B: '#bbb' } } }, true)).toBe('#000');
  });
});

describe('VectorLayers: pemberitahuan memuat data', () => {
  it('muncul > 300 ms setelah tile layer data / raster bahaya dimuat, menyebut layernya, hilang saat idle; basemap diabaikan', () => {
    vi.useFakeTimers();
    try {
      const pola = { ...LAYERS[2]!, featureCount: 2879, opacity: 1 };
      const pju = { ...LAYERS[4]!, featureCount: 10, opacity: 1 };
      bare(<VectorLayers layers={[pola, pju]} />);
      act(() => { fakeMap.fire('dataloading', { sourceId: 'carto' }); fakeMap.fire('dataloading', { dataType: 'style' }); vi.advanceTimersByTime(400); });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      act(() => { fakeMap.fire('dataloading', { sourceId: 'src-pju' }); vi.advanceTimersByTime(400); });
      expect(screen.getByRole('status')).toHaveTextContent('Memuat data: PJU (10 fitur). Mohon tunggu…');
      // Layer yang menyusul langsung ikut disebut.
      act(() => { fakeMap.fire('dataloading', { sourceId: 'src-penggunaan-lahan' }); fakeMap.fire('dataloading', { sourceId: 'hazard-raster' }); });
      expect(screen.getByRole('status')).toHaveTextContent('Penggunaan Lahan (2.879 fitur), PJU (10 fitur), Potensi Bencana');
      act(() => fakeMap.fire('idle'));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LayerDialog: warna dasar tidak kembar', () => {
  const ALL = ['#DE533C', '#D97706', '#16A34A', '#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#475569'];
  const swatches = () => document.querySelectorAll('[data-slot="color-swatch-picker-item"], .color-swatch-picker__item').length;
  it('warna yang dipakai layer lain disembunyikan; semua terpakai = semua ditawarkan lagi', () => {
    const { unmount } = bare(<LayerDialog onClose={vi.fn()} onSaved={vi.fn()} used={['#de533c', '#2563EB']} />);
    expect(swatches()).toBe(6);
    unmount();
    bare(<LayerDialog onClose={vi.fn()} onSaved={vi.fn()} used={ALL} />);
    expect(swatches()).toBe(8);
  });
});

describe('drawnWkt', () => {
  it('poligon butuh 3 titik dan ditutup otomatis; garis butuh 2', () => {
    expect(drawnWkt([[1, 1], [2, 2]], 'Polygon')).toBe('');
    expect(drawnWkt([[1, 1], [2, 1], [2, 2]], 'Polygon')).toBe('POLYGON ((1 1, 2 1, 2 2, 1 1))');
    expect(drawnWkt([[1, 1]], 'LineString')).toBe('');
  });
});
