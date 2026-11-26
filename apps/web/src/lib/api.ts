import type { QueryClient } from '@tanstack/react-query';
import type { Settings } from './settings';
import type { AlertItem, CustomKpi, Exposure, CustomKpiInput, Feature, LayoutCard, Layer, MediaItem, MediaMeta, Page, RuasJalan, SearchResult, StatRow, TimePoint, TrashedFeature, User } from './types';

/**
 * Data berubah (fitur, unggah SHP, tabel survei ruas, pengaturan layer): semua turunan ikut basi, termasuk
 * statistik & deret waktu Ringkasan, status cocok ruas, daftar kecamatan, pencarian, dan log. Hanya query yang sedang
 * tampil yang langsung diambil ulang; sisanya diambil saat dibuka. Sesi (`me`) tidak disentuh.
 */
// ponytail: invalidasi menyeluruh, bukan per kunci: daftar kunci per halaman pasti tertinggal saat ada query baru.
export const refreshData = (qc: QueryClient, own: string[] = []) => {
  // Yang lain diambil ulang di latar: dialog tidak menunggu query halaman lain (mis. statistik berat) selesai.
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && !own.includes(q.queryKey[0] as string) });
  /** Query halaman ini ditunggu, agar tabel sudah baru saat dialog tertutup. */
  return Promise.all(own.map((k) => qc.invalidateQueries({ queryKey: [k] })));
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

export async function api<T>(path: string, { json, headers, ...init }: Options = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: json === undefined ? init.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = (data.issues as { path: string; message: string }[] | undefined)?.map((i) => `${i.path}: ${i.message}`).join(', ');
    throw new ApiError(res.status, [data.error ?? `Permintaan gagal (${res.status})`, issues].filter(Boolean).join(' — '));
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  return s ? `?${s}` : '';
};

export const endpoints = {
  me: () => api<{ user: User }>('/auth/me').then((r) => r.user),
  updateMe: (body: { name?: string; currentPassword?: string; newPassword?: string }) =>
    api<{ user: User }>('/auth/me', { method: 'PATCH', json: body }).then((r) => r.user),
  login: (body: { email: string; password: string; remember?: boolean }) => api<{ user: User }>('/auth/login', { method: 'POST', json: body }),
  register: (body: { name: string; email: string; password: string }) =>
    api<{ message: string }>('/auth/register', { method: 'POST', json: body }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),

  layers: () => api<Layer[]>('/layers'),
  createLayer: (body: unknown) => api<Layer>('/layers', { method: 'POST', json: body }),
  updateLayer: (id: number, body: unknown) => api<Layer>(`/layers/${id}`, { method: 'PATCH', json: body }),
  deleteLayer: (id: number) => api<void>(`/layers/${id}`, { method: 'DELETE' }),

  features: (slug: string, p: { page?: number; limit?: number; q?: string; kecamatan?: string; sort?: string; order?: 'asc' | 'desc' }) =>
    api<Page<Feature>>(`/layers/${slug}/features${qs(p)}`),
  search: (q: string, layer?: string) => api<SearchResult>(`/search${qs({ q, layer })}`),
  alerts: () => api<{ count: number; items: AlertItem[] }>('/alerts'),
  decisionFunds: () => api<string[]>('/decision-funds'),
  settings: () => api<Settings>('/settings'),
  feature: (id: number | string, tahun?: number) => api<Feature & { media: MediaItem[] }>(`/features/${id}${qs({ tahun })}`),
  createFeature: (slug: string, body: unknown) => api<Feature>(`/layers/${slug}/features`, { method: 'POST', json: body }),
  updateFeature: (id: number | string, body: unknown) => api<Feature>(`/features/${id}`, { method: 'PATCH', json: body }),
  deleteFeature: (id: number | string) => api<void>(`/features/${id}`, { method: 'DELETE' }),
  bulkDelete: (slug: string, ids: number[]) => api<{ deleted: number }>(`/layers/${slug}/features/bulk-delete`, { method: 'POST', json: { ids } }),
  /** Tempat sampah (soft delete): daftar fitur terhapus per layer, pulihkan, dan hapus permanen (superadmin). */
  trash: (slug: string, p: { page?: number; limit?: number; q?: string; kecamatan?: string; sort?: string; order?: 'asc' | 'desc' }) => api<Page<TrashedFeature>>(`/layers/${slug}/features/trash${qs(p)}`),
  bulkRestore: (slug: string, ids: number[]) => api<{ restored: number }>(`/layers/${slug}/features/bulk-restore`, { method: 'POST', json: { ids } }),
  restoreFeature: (id: number | string) => api<Feature>(`/features/${id}/restore`, { method: 'POST' }),
  purgeFeature: (id: number | string) => api<void>(`/features/${id}/purge`, { method: 'DELETE' }),
  exportUrl: (slug: string, format: 'geojson' | 'csv' | 'shp', kecamatan?: string) => `/api/v1/layers/${slug}/export${qs({ format, kecamatan })}`,

  uploadShp: (slug: string, file: File, mode: 'append' | 'replace', dryRun: boolean, tahun?: number, map?: Record<string, string>) => {
    const body = new FormData();
    body.append('file', file);
    return api<UploadSummary>(`/layers/${slug}/upload${qs({ mode, dryRun: String(dryRun), tahun: tahun ? String(tahun) : undefined, map: map && JSON.stringify(map) })}`, { method: 'POST', body });
  },
  uploadMedia: (featureId: number | string, file: File, meta: Partial<MediaMeta> = {}) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(meta)) if (v) body.append(k, v);
    body.append('file', file);
    return api<MediaItem>(`/features/${featureId}/media`, { method: 'POST', body });
  },
  updateMedia: (id: number, meta: MediaMeta) => api<MediaItem>(`/media/${id}`, { method: 'PATCH', json: meta }),
  deleteMedia: (id: number) => api<void>(`/media/${id}`, { method: 'DELETE' }),

  stats: (slug: string, p: { by?: string; kecamatan?: string; where?: string; eq?: string; sum?: string; agg?: string; tahun?: number; nogroup?: string } = {}) => api<StatRow[]>(`/stats/layers/${slug}${qs(p)}`),
  kecamatan: () => api<string[]>('/stats/kecamatan'),
  exposure: (kecamatan?: string) => api<Exposure[]>(`/stats/exposure${qs({ kecamatan })}`),
  ruasJalan: (kecamatan?: string, dari?: number, sampai?: number) => api<RuasJalan[]>(`/stats/ruas-jalan${qs({ kecamatan, dari, sampai })}`),
  // Menu Data > Tabel: rekap ruas jalan (tanpa koordinat).
  ruasTable: (kecamatan?: string) => api<(RuasJalan & { id: number })[]>(`/tables/ruas-jalan${qs({ kecamatan })}`),
  ruasExportUrl: (kecamatan?: string) => `/api/v1/tables/ruas-jalan/export${qs({ kecamatan })}`,
  createRuas: (body: RuasJalan) => api<RuasJalan & { id: number }>('/tables/ruas-jalan', { method: 'POST', json: body }),
  updateRuas: (id: number, body: Partial<RuasJalan>) => api<{ id: number }>(`/tables/ruas-jalan/${id}`, { method: 'PATCH', json: body }),
  deleteRuas: (id: number) => api<void>(`/tables/ruas-jalan/${id}`, { method: 'DELETE' }),
  kpis: () => api<CustomKpi[]>('/kpi'),
  createKpi: (body: CustomKpiInput) => api<CustomKpi>('/kpi', { method: 'POST', json: body }),
  updateKpi: (id: number, body: CustomKpiInput) => api<CustomKpi>(`/kpi/${id}`, { method: 'PATCH', json: body }),
  deleteKpi: (id: number) => api<void>(`/kpi/${id}`, { method: 'DELETE' }),
  layout: () => api<{ cards: LayoutCard[] }>('/kpi/layout'),
  saveLayout: (cards: LayoutCard[]) => api<{ cards: LayoutCard[] }>('/kpi/layout', { method: 'PUT', json: { cards } }),
  timeseries: (kecamatan?: string) => api<TimePoint[]>(`/stats/timeseries${qs({ kecamatan })}`),

  users: (status?: string) => api<User[]>(`/users${qs({ status })}`),
  updateUser: (id: number, body: { status?: string; role?: string }) => api<User>(`/users/${id}`, { method: 'PATCH', json: body }),
  deleteUser: (id: number) => api<void>(`/users/${id}`, { method: 'DELETE' }),

  audit: (page: number, from?: string, to?: string) => api<Page<AuditRow>>(`/audit${qs({ page, limit: 20, from, to })}`),
};

export type UploadSummary = {
  count: number;
  skipped: number;
  hasPrj: boolean;
  columns: string[];
  missingFields: string[];
  sample?: GeoJSON.FeatureCollection;
};

export type AuditRow = { id: string; action: string; entity: string; entityId: string | null; userName: string | null; ip: string; createdAt: string };
