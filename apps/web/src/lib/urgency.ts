import type { Layer, Props } from './types';

export type Urgency = 'tinggi' | 'sedang' | 'rendah';
export const URGENCIES: Urgency[] = ['tinggi', 'sedang', 'rendah'];

/** Layer berkondisi (punya field `kondisi`): hanya ini yang memakai dokumentasi foto & urgensi; data statis tidak. */
export const hasDocs = (layer: Pick<Layer, 'fields'>) => layer.fields.some((f) => f.key === 'kondisi');

/**
 * Layer yang butuh keputusan tindak lanjut: datanya berubah dan bisa memicu tindakan, yaitu punya field aturan urgensi
 * (kondisi, jenis lampu; dari pengaturan), field `kesesuaian` tata ruang, atau layer Catatan Rencana. Data rujukan statis
 * (batas administrasi, bahaya InaRISK, jalan nasional/provinsi, tutupan lahan, ...) tidak.
 */
export const needsDecision = (layer: Pick<Layer, 'fields' | 'category'>, rules: UrgencyRules | undefined) =>
  layer.category === 'Catatan Rencana'
  || layer.fields.some((f) => f.key === 'kesesuaian' || (rules?.aturan ?? []).some((r) => r.field === f.key));

/** Aturan urgensi dari tabel `pengaturan` (key `urgensi`, `GET /settings`). Sama persis dengan SQL `GET /alerts`. */
export type UrgencyRules = {
  abaikan: string;
  aturan: { field: string; tinggi: string; sedang: string | null; lainnya: Urgency | null }[];
};

/**
 * Urgensi otomatis dari atribut fitur menurut aturan DB: aturan pertama yang field-nya ada di layer dan nilainya terisi
 * yang dipakai (mis. kondisi "Rusak Berat" = tinggi, jenis lampu "Hilang" = tinggi). `null` bila tidak ada aturan yang
 * berlaku, nilainya belum dapat dinilai (`abaikan`, mis. "Belum Disurvei"), atau aturan belum termuat: kondisi yang
 * belum dinilai tidak boleh tampil sebagai urgensi rendah.
 */
export function conditionUrgency(layer: Pick<Layer, 'fields'>, props: Props, rules: UrgencyRules | undefined): Urgency | null {
  for (const r of rules?.aturan ?? []) {
    if (!layer.fields.some((f) => f.key === r.field)) continue;
    const v = String(props[r.field] ?? '').trim();
    if (!v) continue;
    const re = (p: string) => new RegExp(p, 'i').test(v);
    if (re(rules!.abaikan)) return null;
    if (re(r.tinggi)) return 'tinggi';
    if (r.sedang && re(r.sedang)) return 'sedang';
    return r.lainnya;
  }
  return null;
}

/**
 * Urgensi efektif fitur: penetapan manual dari form notulensi (`properties.urgensi`) bila ada, selain itu dari aturan.
 * Satu fungsi untuk tabel Data, popup Peta, dan form, jadi semua tampilan selalu sama.
 */
export function urgencyOf(layer: Pick<Layer, 'fields'>, props: Props, rules: UrgencyRules | undefined): Urgency | null {
  // Penetapan manual berlaku untuk semua layer (catatan keputusan universal).
  return URGENCIES.includes(props.urgensi as Urgency) ? (props.urgensi as Urgency) : conditionUrgency(layer, props, rules);
}
