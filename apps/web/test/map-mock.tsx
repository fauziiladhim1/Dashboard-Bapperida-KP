import type { ReactNode } from 'react';
import { vi } from 'vitest';

type Handler = (e: unknown) => void;

export const fakeMap = {
  handlers: [] as { event: string; layer?: string; fn: Handler }[],
  canvas: { style: { cursor: '' } },
  rendered: [] as unknown[],
  on(event: string, a: string | Handler, b?: Handler) {
    this.handlers.push(typeof a === 'string' ? { event, layer: a, fn: b! } : { event, fn: a });
  },
  off(event: string, a: string | Handler, b?: Handler) {
    const fn = typeof a === 'string' ? b : a;
    this.handlers = this.handlers.filter((h) => !(h.event === event && h.fn === fn));
  },
  fire(event: string, payload: unknown = {}, layer?: string) {
    for (const h of this.handlers.filter((h) => h.event === event && (layer === undefined || h.layer === layer))) h.fn(payload);
  },
  getCanvas() {
    return this.canvas;
  },
  getContainer() {
    return { clientWidth: 800, clientHeight: 600 };
  },
  setFeatureState: vi.fn(),
  getStyle() {
    return { layers: fakeMap.addLayer.mock.calls.map(([l]) => l as { id: string; source: string }) };
  },
  // Proyeksi sederhana: 1 piksel = 0,0001 derajat (radius tempel 12 px = 0,0012 derajat).
  project: vi.fn((p: [number, number]) => ({ x: p[0] * 1e4, y: -p[1] * 1e4 })),
  queryRenderedFeatures: vi.fn(function (this: { rendered: unknown[] }) {
    return fakeMap.rendered;
  }),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  setPaintProperty: vi.fn(),
  setFilter: vi.fn(),
  getBounds: vi.fn(() => ({ contains: () => true })),
  easeTo: vi.fn(),
  fitBounds: vi.fn(),
  flyTo: vi.fn(),
  getZoom: vi.fn(() => 11),
  getBearing: vi.fn(() => 0),
  getLayer: vi.fn(() => true),
  getSource: vi.fn(() => true),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
};

export const mapState = { isLoaded: true, hasMap: true, theme: 'light', markerHidden: false };

export const resetFakeMap = () => {
  fakeMap.handlers = [];
  fakeMap.rendered = [];
  fakeMap.canvas.style.cursor = '';
  mapState.isLoaded = true;
  mapState.hasMap = true;
  mapState.theme = 'light';
  mapState.markerHidden = false;
  fakeMap.getLayer.mockReturnValue(true);
  for (const fn of [fakeMap.addSource, fakeMap.addLayer, fakeMap.setPaintProperty, fakeMap.removeLayer, fakeMap.removeSource]) fn.mockClear();
};

export const useMap = () => ({ map: mapState.hasMap ? fakeMap : null, isLoaded: mapState.isLoaded, resolvedTheme: mapState.theme });

type Children = { children?: ReactNode };
export const Map = ({ children, theme }: Children & { theme?: string }) => <div data-testid="map" data-theme={theme}>{children}</div>;
// Tombol "lokasi saya" tiruan: memanggil onLocate dengan posisi tetap.
export const MapControls = ({ onLocate }: { onLocate?: (p: { longitude: number; latitude: number; accuracy: number }) => void }) =>
  onLocate ? <button onClick={() => onLocate({ longitude: 110.16, latitude: -7.85, accuracy: 30 })}>locate</button> : null;
export const MapPopup = ({ children, onClose }: Children & { onClose?: () => void }) => (
  <div data-testid="popup">
    {children}
    <button onClick={onClose}>popup-close</button>
  </div>
);
// markerHidden: isi marker belum dipasang (mapcn memasangnya lewat portal setelah marker dibuat).
export const MapMarker = ({ children, longitude, latitude }: Children & { longitude: number; latitude: number }) => (
  <div data-testid="marker" data-lng={longitude} data-lat={latitude}>{mapState.markerHidden ? null : children}</div>
);
export const MarkerContent = ({ children }: Children) => <>{children}</>;
export const MapGeoJSON = () => <div data-testid="geojson" />;
