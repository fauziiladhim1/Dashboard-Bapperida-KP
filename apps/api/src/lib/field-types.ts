/**
 * Tipe field atribut ala tabel atribut QGIS. `number` = desimal (Real), nama lama dipertahankan agar skema lama sah.
 * `bigint` = Integer64. Tanggal/waktu disimpan sebagai teks ISO (2026-11-27, 2026-11-27T08:30, 08:30); boolean sebagai
 * true/false JSON. URL, email, warna, dan UUID = teks berformat (widget QGIS: tautan, warna, UUID generator).
 */
export const FIELD_TYPES = [
  'text', 'integer', 'bigint', 'number', 'date', 'datetime', 'time', 'boolean', 'select', 'url', 'email', 'color', 'uuid',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Bilangan: disimpan sebagai angka JSON, bisa jadi ukuran KPI. */
export const NUMERIC: readonly string[] = ['integer', 'bigint', 'number'];

/** Bentuk teks yang sah per tipe (dipakai juga di SQL untuk mengecek data lama saat tipe diganti; dicocokkan tanpa beda huruf). */
export const TEXT_PATTERN: Partial<Record<FieldType, string>> = {
  integer: '^-?[0-9]+$',
  bigint: '^-?[0-9]+$',
  number: '^-?[0-9]+([.][0-9]+)?$',
  date: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  datetime: '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2})?$',
  time: '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$',
  boolean: '^(true|false|ya|tidak|1|0)$',
  url: '^https?://[^[:space:]]+$',
  email: '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$',
  color: '^#[0-9a-f]{6}$',
  uuid: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
};

const LABEL: Record<FieldType, string> = {
  text: 'teks', integer: 'bilangan bulat', bigint: 'bilangan bulat besar', number: 'angka', date: 'tanggal (YYYY-MM-DD)',
  datetime: 'tanggal & waktu', time: 'waktu (JJ:MM)', boolean: 'ya/tidak', select: 'pilihan', url: 'URL http(s)://…',
  email: 'alamat email', color: 'warna hex #RRGGBB', uuid: 'UUID',
};

// Regex SQL di atas memakai kelas POSIX; versi JS-nya sama artinya.
const jsPattern = (t: FieldType) => new RegExp(TEXT_PATTERN[t]!.replaceAll('[:space:]', '\\s'), 'i');

/** Galat untuk satu nilai terisi, atau null bila sah. */
export const valueError = (f: { key: string; type: string; options?: string[] }, v: unknown): string | null => {
  const t = f.type as FieldType;
  const ok =
    // ponytail: JSONB tak membedakan 32/64 bit; bigint = bilangan bulat dengan label QGIS Integer64.
    t === 'integer' || t === 'bigint' ? typeof v === 'number' && Number.isSafeInteger(v)
    : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
    : t === 'boolean' ? typeof v === 'boolean'
    : t === 'select' ? !f.options?.length || f.options.includes(String(v))
    : TEXT_PATTERN[t] ? typeof v === 'string' && jsPattern(t).test(v) && (!['date', 'datetime'].includes(t) || !Number.isNaN(Date.parse(v)))
    : true;
  if (ok) return null;
  return t === 'select' ? `${f.key} harus salah satu: ${f.options!.join(', ')}` : `${f.key} harus ${LABEL[t]}`;
};
