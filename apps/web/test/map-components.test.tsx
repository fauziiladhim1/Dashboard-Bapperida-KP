import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserLocation } from '@/components/map/UserLocation';
import { PrefsProvider } from '@/lib/prefs';
import { fakeMap, mapState } from './map-mock';

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PrefsProvider>{ui}</PrefsProvider></QueryClientProvider>
);
const show = (ui: ReactNode) => render(wrap(ui));

describe('UserLocation', () => {
  type Watch = { ok: (p: { coords: Partial<GeolocationCoordinates> }) => void; fail: () => void };
  let watch: Watch;
  const geo = { watchPosition: vi.fn((ok: Watch['ok'], fail: Watch['fail']) => { watch = { ok, fail }; return 7; }), clearWatch: vi.fn() };
  const withGeo = () => Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
    Reflect.deleteProperty(window, 'ondeviceorientationabsolute');
    Reflect.deleteProperty(window.screen, 'orientation');
  });
  const acc = () => document.querySelector<HTMLElement>('.gloc__acc')!;
  const beam = () => document.querySelector<HTMLElement>('.gloc__beam')!;

  it('tanpa geolocation: titik awal tanpa akurasi, sorot arah disembunyikan', () => {
    show(<UserLocation initial={{ longitude: 110, latitude: -7.8 }} />);
    expect(screen.getByRole('img', { name: /Lokasi Anda/ })).toBeInTheDocument();
    expect(acc().style.opacity).toBe('0');
    expect(beam()).not.toBeVisible();
  });

  it('posisi diperbarui watchPosition; lingkaran akurasi ikut zoom; arah dari GPS lalu kompas', () => {
    withGeo();
    const { unmount } = show(<UserLocation initial={{ longitude: 110, latitude: -7.8, accuracy: 5 }} />);
    expect(acc().style.opacity).toBe('0'); // 5 m pada zoom 11 lebih kecil dari titik
    act(() => watch.ok({ coords: { longitude: 110.2, latitude: -7.9, accuracy: 900, heading: 45 } }));
    watch.fail(); // gagal: titik terakhir tetap
    expect(screen.getByTestId('marker')).toHaveAttribute('data-lng', '110.2');
    expect(acc().style.opacity).toBe('1');
    expect(beam().style.transform).toContain('rotate(45deg)');
    expect(beam()).toBeVisible();

    fakeMap.getBearing.mockReturnValue(10);
    act(() => fakeMap.fire('rotate'));
    expect(beam().style.transform).toContain('rotate(35deg)');
    // Sensor tanpa arah absolut diabaikan; kompas iOS menang atas GPS.
    act(() => { window.dispatchEvent(Object.assign(new Event('deviceorientation'), { absolute: false, alpha: 10 })); });
    expect(beam().style.transform).toContain('rotate(35deg)');
    act(() => { window.dispatchEvent(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 100 })); });
    expect(beam().style.transform).toContain('rotate(90deg)');
    act(() => fakeMap.fire('zoom'));
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(fakeMap.handlers).toHaveLength(0);
    fakeMap.getBearing.mockReturnValue(0);
  });

  it('heading GPS NaN = tanpa arah; Android memakai deviceorientationabsolute + sudut layar', () => {
    Object.defineProperty(window, 'ondeviceorientationabsolute', { value: null, configurable: true });
    Object.defineProperty(window.screen, 'orientation', { value: { angle: 90 }, configurable: true });
    show(<UserLocation initial={{ longitude: 110, latitude: -7.8, heading: Number.NaN }} />);
    expect(beam()).not.toBeVisible();
    act(() => { window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { absolute: true, alpha: 0 })); });
    expect(beam().style.transform).toContain('rotate(90deg)');
  });

  it('tanpa peta / isi marker belum terpasang: tidak menulis ke DOM', () => {
    mapState.hasMap = false;
    const { unmount } = show(<UserLocation initial={{ longitude: 110, latitude: -7.8 }} />);
    expect(acc().style.width).toBe('');
    unmount();
    mapState.hasMap = true;
    mapState.markerHidden = true;
    show(<UserLocation initial={{ longitude: 110, latitude: -7.8, heading: 30 }} />);
    expect(document.querySelector('.gloc')).toBeNull();
  });
});
