import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { API, loginAs } from './helpers.js';

// Shapefile yang seluruh geometrinya kosong (null shape) — sulit dibuat dengan writer, jadi parser di-mock.
vi.mock('shpjs', () => ({ default: async () => ({ features: [{ type: 'Feature', geometry: null, properties: {} }] }) }));

describe('upload shapefile kosong', () => {
  it('ditolak bila tidak ada fitur bergeometri', async () => {
    const { agent } = await loginAs('editor');
    const zip = new JSZip();
    for (const ext of ['shp', 'shx', 'dbf']) zip.file(`a.${ext}`, 'x');
    const res = await agent.post(`${API}/layers/pju/upload`).attach('file', await zip.generateAsync({ type: 'nodebuffer' }), 'a.zip').expect(400);
    expect(res.body.error).toMatch(/tidak berisi fitur/);
  });
});
