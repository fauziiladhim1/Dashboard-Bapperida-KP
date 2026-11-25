import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { endpoints } from '@/lib/api';

/** Fungsi coba-lagi bila query gagal, agar panel menampilkan galat, bukan "belum ada data". */
export const retryOf = (q: { isError: boolean; refetch: () => unknown }) => (q.isError ? () => void q.refetch() : undefined);

/**
 * Statistik satu layer (opsi `by`/`where`/`eq`/`sum` diteruskan ke API). `enabled: false` saat layer bukan versi tahun
 * global: data kosong, kartu menampilkan keadaan kosong.
 */
export const useStats = (slug: string, kecamatan: string | undefined, enabled: boolean, opts: { by?: string; where?: string; eq?: string; sum?: string; agg?: string; tahun?: number; nogroup?: string } = {}) => {
  const q = useQuery({ queryKey: ['stats', slug, kecamatan, opts], queryFn: () => endpoints.stats(slug, { kecamatan, ...opts }), placeholderData: keepPreviousData, enabled });
  // Layer ada tapi belum berisi fitur = belum ada data (KPI "—"), bukan "0 titik".
  return { data: enabled && q.data?.length ? q.data : undefined, loading: enabled && q.isPending, retry: retryOf(q) };
};
