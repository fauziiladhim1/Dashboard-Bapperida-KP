import { describe, expect, it } from 'vitest';
import { conditionUrgency, hasDocs, urgencyOf } from '@/lib/urgency';
import { SETTINGS } from './utils';

const R = SETTINGS.urgensi;

const field = (key: string) => ({ key, label: key, type: 'select' as const });
const road = { fields: [field('nama_ruas'), field('kondisi')] };

describe('urgencyOf / hasDocs', () => {
  it('urgensi dari field kondisi; layer tanpa kondisi (statis) tidak berdokumentasi', () => {
    expect(urgencyOf(road, { kondisi: 'Rusak Berat' }, R)).toBe('tinggi');
    expect(urgencyOf(road, { kondisi: 'Rusak Ringan' }, R)).toBe('sedang');
    // "Rusak" polos = kondisi terburuk skala Baik|Rusak (Utilitas Umum), bukan rusak ringan.
    expect(urgencyOf(road, { kondisi: 'Rusak' }, R)).toBe('tinggi');
    expect(urgencyOf(road, { kondisi: 'Baik' }, R)).toBe('rendah');
    expect(urgencyOf(road, { kondisi: 'Mati' }, R)).toBe('tinggi');
    expect(urgencyOf(road, { kondisi: null }, R)).toBeNull();
    // Kesesuaian pola ruang: "Tidak Sesuai" bukan kondisi fisik, layer statis.
    const kesesuaian = { fields: [field('kesesuaian')] };
    expect(hasDocs(kesesuaian)).toBe(false);
    expect(urgencyOf(kesesuaian, { kesesuaian: 'Tidak Sesuai' }, R)).toBeNull();
    expect(conditionUrgency(kesesuaian, { kondisi: 'Rusak Berat' }, R)).toBeNull();
    expect(hasDocs(road)).toBe(true);
    // PJU tanpa field kondisi: lampu hilang = tinggi; jenis lampu lain bukan kondisi (tanpa urgensi).
    const pju = { fields: [field('nama'), field('jenis_lampu')] };
    expect(urgencyOf(pju, { jenis_lampu: 'Hilang' }, R)).toBe('tinggi');
    expect(urgencyOf(pju, { jenis_lampu: 'LED' }, R)).toBeNull();
  });

  it('urgensi manual (notulensi) mengalahkan kondisi; belum disurvei = belum dapat dinilai; nilai asing diabaikan', () => {
    expect(urgencyOf(road, { kondisi: 'Baik', urgensi: 'tinggi' }, R)).toBe('tinggi');
    expect(urgencyOf(road, { kondisi: 'Belum Disurvei' }, R)).toBeNull();
    expect(urgencyOf(road, { kondisi: 'Belum Disurvei', urgensi: 'sedang' }, R)).toBe('sedang');
    expect(urgencyOf(road, { kondisi: 'Baik', urgensi: 'darurat' }, R)).toBe('rendah');
  });
});
