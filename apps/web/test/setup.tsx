import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, vi } from 'vitest';
import Swal from 'sweetalert2';
import { resetFakeMap } from './map-mock';

// MapLibre butuh WebGL yang tidak ada di jsdom: komponen peta diganti tiruan yang mencatat pemanggilan.
vi.mock('@/components/ui/map', () => import('./map-mock'));

// Recharts butuh ukuran nyata; beri ukuran tetap.
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number }> }) => cloneElement(children, { width: 600, height: 300 } as never) };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as never;
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.getAnimations = () => [];
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = vi.fn();
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })) as never;

// Animasi dilewati di jsdom: state akhir langsung terpasang.
MotionGlobalConfig.skipAnimations = true;
// Suite penuh menjalankan banyak worker jsdom sekaligus; batas findBy/waitFor bawaan 1 detik terlalu ketat.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => resetFakeMap());
afterEach(() => {
  Swal.close(); // dialog Swal (modul-level) tidak boleh bocor ke tes berikut
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});
