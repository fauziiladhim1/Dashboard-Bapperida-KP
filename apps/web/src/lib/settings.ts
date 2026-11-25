import { useQuery } from '@tanstack/react-query';
import { endpoints } from './api';
import type { UrgencyRules } from './urgency';

/** Opsi keputusan dari DB (pengaturan `keputusan`): urutan form, warna chip, keterangan per bahasa. */
export type DecisionSettings = {
  opsi: { nilai: string; warna: 'success' | 'warning' | 'danger' | 'default'; keterangan: { id: string; en: string } }[];
  /** Keputusan yang menghilangkan peringatan lonceng. */
  tuntas: string[];
  /** Keputusan yang menampilkan isian pelaksanaan (anggaran, sumber dana, tahun target). */
  pelaksanaan: string[];
  /** Keputusan yang menandai pekerjaan terealisasi (mengisi `tanggal_selesai`). */
  selesai: string | null;
};
type Obj = { layer: string; field?: string; nilai?: string };
export type ExposureSettings = { zona: { layer: string; field: string; nilai: string; jenis: string; gabungan: string }; sekolah: Obj; faskes: Obj; wisata: Obj; jalan: Obj; permukiman: Obj };
export type Settings = { urgensi: UrgencyRules; keputusan: DecisionSettings; keterpaparan: ExposureSettings };

/** Pengaturan aplikasi dari tabel `pengaturan` (bisa diubah setelah deploy tanpa ubah kode). */
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: endpoints.settings, staleTime: 5 * 60_000 });
