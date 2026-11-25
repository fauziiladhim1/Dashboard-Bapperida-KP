import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS_3D, Buildings3D } from '@/components/map/Buildings3D';
import { fakeMap, mapState, resetFakeMap } from './map-mock';

describe('Buildings3D', () => {
  beforeEach(() => {
    resetFakeMap();
    (fakeMap as Record<string, unknown>).setLayerZoomRange = vi.fn();
  });

  it('menambah fill-extrusion dari bangunan basemap dan membatasi tapak datar ke zoom < 15', () => {
    fakeMap.getLayer.mockImplementation(((id: string) => (id === BUILDINGS_3D ? undefined : { minzoom: 13 })) as never);
    mapState.theme = 'dark';
    render(<Buildings3D />);
    const [layer] = fakeMap.addLayer.mock.calls.find(([l]) => (l as { id: string }).id === BUILDINGS_3D)! as [Record<string, unknown>];
    expect(layer).toMatchObject({ type: 'fill-extrusion', source: 'protomaps', 'source-layer': 'buildings', minzoom: 15 });
    expect((layer.paint as Record<string, unknown>)['fill-extrusion-color']).toBe('#2a2a2a');
    expect((fakeMap as unknown as { setLayerZoomRange: ReturnType<typeof vi.fn> }).setLayerZoomRange).toHaveBeenCalledWith('building', 13, 15);
    mapState.theme = 'light';
  });

  it('tidak dobel bila layer sudah ada', () => {
    render(<Buildings3D />);
    expect(fakeMap.addLayer).not.toHaveBeenCalled();
  });
});
