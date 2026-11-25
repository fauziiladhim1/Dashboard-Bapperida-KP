import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HazardRaster, identify, inside, kelasOf, merc, polysOf, type Boundary } from '@/components/map/HazardRaster';
import { fakeMap } from './map-mock';
import { LAYERS, mockApi, reply, renderAt, user } from './utils';

// addProtocol asli mendaftarkan handler global MapLibre; di sini cukup ditangkap agar loader tile bisa diuji langsung.
// Fungsi biasa (bukan vi.fn): afterEach `restoreAllMocks` tidak boleh menghapus catatannya.
type Loader = (p: { url: string }, a: AbortController) => Promise<{ data: ArrayBuffer }>;
const proto = vi.hoisted(() => ({ loaders: [] as Loader[] }));
vi.mock('maplibre-gl', async (orig) => ({ ...(await orig<object>()), addProtocol: (_: string, fn: Loader) => proto.loaders.push(fn) }));

const kotak = [[110, -8], [110.3, -8], [110.3, -7.6], [110, -7.6], [110, -8]] as [number, number][];
const lubang = [[110.1, -7.9], [110.2, -7.9], [110.2, -7.7], [110.1, -7.7], [110.1, -7.9]] as [number, number][];
const batas: Boundary = { features: [{ geometry: { type: 'Polygon', coordinates: [kotak, lubang] } }] };

describe('HazardRaster: geometri & nilai', () => {
  it('polysOf: Polygon, MultiPolygon; geometri lain/null dilewati', () => {
    expect(polysOf({ features: [
      { geometry: null }, { geometry: { type: 'Point', coordinates: [0, 0] } },
      { geometry: { type: 'Polygon', coordinates: [kotak] } }, { geometry: { type: 'MultiPolygon', coordinates: [[kotak], [lubang]] } },
    ] })).toEqual([[kotak], [kotak], [lubang]]);
    expect(polysOf({} as Boundary)).toEqual([]);
  });

  it('inside menghormati lubang; merc sesuai EPSG:3857; kelas sepertiga', () => {
    const polys = [[kotak, lubang]];
    expect(inside([110.05, -7.8], polys)).toBe(true);
    expect(inside([110.15, -7.8], polys)).toBe(false); // di lubang
    expect(inside([111, -7.8], polys)).toBe(false);
    const [x, y] = merc([180, 0]);
    expect(x).toBeCloseTo(20037508.34, 1);
    expect(y).toBeCloseTo(0, 6);
    expect([0.1, 0.5, 0.9].map(kelasOf)).toEqual(['Rendah', 'Sedang', 'Tinggi']);
  });

  it('identify: nilai dibatasi 0–1, NoData/negatif = null, HTTP gagal = galat', async () => {
    const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(res({ value: '0.4' })).mockResolvedValueOnce(res({ value: '1.7' }))
      .mockResolvedValueOnce(res({ value: 'NoData' })).mockResolvedValueOnce(res({ value: '-1' }))
      .mockResolvedValueOnce(res({}, 500));
    expect(await identify('banjir', 110.1, -7.8)).toBe(0.4);
    expect(await identify('banjir', 110.1, -7.8)).toBe(1);
    expect(await identify('banjir', 110.1, -7.8)).toBeNull();
    expect(await identify('banjir', 110.1, -7.8)).toBeNull();
    await expect(identify('banjir', 110.1, -7.8)).rejects.toThrow('InaRISK 500');
    expect(String(f.mock.calls[0]![0])).toMatch(/\/banjir\/ImageServer\/identify\?geometry=/);
  });
});

describe('HazardRaster: komponen', () => {
  const draw = (props: Partial<Parameters<typeof HazardRaster>[0]> = {}) => {
    const onPick = vi.fn();
    const r = render(<HazardRaster service="banjir" opacity={0.6} boundary={batas} onPick={onPick} {...props} />);
    return { onPick, ...r };
  };

  it('tanpa batas atau batas tanpa poligon: tidak memasang apa pun', async () => {
    draw({ boundary: undefined }).unmount();
    draw({ boundary: { features: [{ geometry: null }] } }).unmount();
    await act(async () => { await import('maplibre-gl'); });
    expect(fakeMap.addSource).not.toHaveBeenCalled();
  });

  it('dilepas sebelum maplibre termuat: source tidak ditambahkan', async () => {
    draw().unmount();
    await act(async () => { await import('maplibre-gl'); });
    expect(fakeMap.addSource).not.toHaveBeenCalled();
  });

  it('raster di bawah layer data, protokol didaftarkan sekali, opasitas diubah di tempat, klik dipilah', async () => {
    fakeMap.addLayer({ id: 'line-jalan', source: 'src-jalan' });
    const { onPick, rerender, unmount } = draw();
    await waitFor(() => expect(fakeMap.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'hazard-raster' }), 'line-jalan'));
    expect(fakeMap.addSource).toHaveBeenCalledWith('hazard-raster', expect.objectContaining({ tiles: ['inarisk://banjir/{bbox-epsg-3857}'], bounds: [110, -8, 110.3, -7.6] }));

    rerender(<HazardRaster service="banjir" opacity={0.3} boundary={batas} onPick={onPick} />);
    expect(fakeMap.setPaintProperty).toHaveBeenCalledWith('hazard-raster', 'raster-opacity', 0.3);
    fakeMap.getLayer.mockReturnValue(false);
    fakeMap.setPaintProperty.mockClear();
    rerender(<HazardRaster service="banjir" opacity={0.2} boundary={batas} onPick={onPick} />);
    expect(fakeMap.setPaintProperty).not.toHaveBeenCalled();

    const click = (lng: number, lat: number) => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng, lat } });
    click(110.05, -7.8); // tanpa fitur di atasnya, di dalam batas
    click(111, -7.8); // di luar batas
    fakeMap.rendered = [{ source: 'src-batas-administrasi', layer: { id: 'fill-batas-administrasi' } }];
    click(110.25, -7.7); // hanya batas administrasi: tetap dihitung
    fakeMap.rendered = [{ source: 'src-jalan', layer: { id: 'line-jalan' } }];
    click(110.05, -7.8); // jalan di atas: biarkan popup fitur
    expect(onPick.mock.calls).toEqual([[{ lng: 110.05, lat: -7.8 }], [{ lng: 110.25, lat: -7.7 }]]);

    fakeMap.getSource.mockReturnValueOnce(false);
    unmount(); // layer & source sudah tidak ada: tidak dihapus dua kali
    expect(fakeMap.removeLayer).not.toHaveBeenCalled();
    expect(fakeMap.removeSource).not.toHaveBeenCalled();
    expect(fakeMap.handlers.filter((h) => h.event === 'click')).toHaveLength(0);

    fakeMap.getLayer.mockReturnValue(true);
    draw({ service: 'longsor' }).unmount();
    await act(async () => { await import('maplibre-gl'); });
    expect(proto.loaders).toHaveLength(1);
  });

  it('loader tile: exportImage BNPB, dipotong mask batas (evenodd), galat HTTP diteruskan', async () => {
    draw(); // memasang mask batas yang dipakai loader
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalled());
    const load = proto.loaders[0]!;
    const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => 'img'));
    vi.stubGlobal('OffscreenCanvas', class { getContext = () => ctx; convertToBlob = async () => ({ arrayBuffer: async () => new ArrayBuffer(3) }); });
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('png')).mockResolvedValueOnce(new Response(null, { status: 503 }));

    const [x0, y0] = merc([110, -8]), [x1, y1] = merc([110.3, -7.6]);
    const url = `inarisk://banjir/${x0},${y0},${x1},${y1}`;
    const out = await load({ url }, new AbortController());
    expect(out.data.byteLength).toBe(3);
    expect(String(f.mock.calls[0]![0])).toMatch(/\/banjir\/ImageServer\/exportImage\?bbox=.*&size=256%2C256/);
    expect(ctx.moveTo).toHaveBeenCalledTimes(2); // dua cincin: luar + lubang
    expect(ctx.moveTo.mock.calls[0]![0]).toBeCloseTo(0, 6);
    expect(ctx.clip).toHaveBeenCalledWith('evenodd');
    expect(ctx.drawImage).toHaveBeenCalledWith('img', 0, 0);
    await expect(load({ url }, new AbortController())).rejects.toThrow('InaRISK 503');
    vi.unstubAllGlobals();
  });
});

describe('Peta: popup nilai bahaya', () => {
  it('klik di dalam batas: indeks + kelas, tanpa data, galat; popup bisa ditutup', async () => {
    const zona = LAYERS.map((l) => (l.slug === 'potensi-bencana' ? { ...l, style: { color: '#DC2626', classField: 'kelas', classes: { Tinggi: '#FF0000' } } } : l));
    const values: Record<string, unknown> = { '110.05': { value: '0.8' }, '110.06': { value: 'NoData' }, '110.07': reply(500) };
    mockApi({
      'GET /auth/me': { user: user('viewer') }, 'GET /layers': zona, 'GET /stats/kecamatan': [],
      'GET /layers/batas-administrasi/export': { type: 'FeatureCollection', features: [{ geometry: { type: 'Polygon', coordinates: [kotak] } }] },
      'GET https://gis.bnpb.go.id/server/rest/services/inarisk/layer_bahaya_banjir/ImageServer/identify': ({ url }: { url: string }) =>
        values[JSON.parse(new URL(url).searchParams.get('geometry')!).x],
    });
    renderAt('/peta');
    await userEvent.click((await screen.findAllByRole('switch', { name: 'Tampilkan Potensi Bencana' }))[0]!);
    await waitFor(() => expect(fakeMap.addSource).toHaveBeenCalledWith('hazard-raster', expect.anything()));
    const click = (lng: number) => act(() => fakeMap.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng, lat: -7.8 } }));

    click(110.05);
    expect(await screen.findByText('Tinggi')).toBeInTheDocument();
    expect(screen.getByText('0,80')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'popup-close' }));
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();

    click(110.06);
    expect(await screen.findByText('Tidak ada data bahaya di titik ini.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument();

    click(110.07); // retry 2x (±3 detik) sebelum galat tampil
    expect(await screen.findByText('Gagal memuat nilai dari InaRISK. Coba klik lagi.', {}, { timeout: 10000 })).toBeInTheDocument();
  }, 30000);
});
