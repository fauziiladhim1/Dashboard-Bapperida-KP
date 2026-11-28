import { getLocale } from './format';
import type { Field } from './types';

/**
 * Tipe field atribut ala tabel atribut QGIS (sama dengan api/src/lib/field-types.ts). `number` = desimal (Real),
 * `bigint` = Integer64. Tanggal/waktu disimpan sebagai teks ISO, ya/tidak sebagai boolean JSON; URL/email/warna/UUID
 * = teks berformat.
 */
export const FIELD_TYPES = ['text', 'integer', 'bigint', 'number', 'date', 'datetime', 'time', 'boolean', 'select', 'url', 'email', 'color', 'uuid'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Bilangan (bulat/desimal): bisa jadi ukuran KPI (SUM/AVG/...) dan diinput sebagai angka. */
export const isNumeric = (t: string) => t === 'integer' || t === 'bigint' || t === 'number';

const PATTERN: Partial<Record<FieldType, RegExp>> = {
  integer: /^-?\d+$/,
  bigint: /^-?\d+$/,
  number: /^-?\d+(\.\d+)?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/,
  time: /^\d{2}:\d{2}(:\d{2})?$/,
  boolean: /^(true|false|ya|tidak|1|0)$/i,
  url: /^https?:\/\/\S+$/i,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  color: /^#[0-9a-f]{6}$/i,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

/** `type` input HTML per tipe field (keyboard ponsel, pemilih tanggal bawaan browser). */
export const INPUT_TYPE: Partial<Record<FieldType, string>> = {
  integer: 'number', bigint: 'number', number: 'number', date: 'date', datetime: 'datetime-local', time: 'time', url: 'url', email: 'email',
};

/** Nilai mentah (mis. sel berkas impor) sah untuk tipe field? Kosong selalu sah. */
export const validRaw = (f: Pick<Field, 'type' | 'options'>, v: unknown) => {
  if (v === null || v === undefined || v === '') return true;
  if (f.type === 'select') return !f.options?.length || f.options.includes(String(v));
  return PATTERN[f.type]?.test(String(v)) ?? true;
};

/** Teks isian form → nilai tersimpan sesuai tipe (kosong = null). */
export const parseRaw = (type: string, raw: string): string | number | boolean | null => {
  if (raw === '') return null;
  if (isNumeric(type)) return Number(raw);
  if (type === 'boolean') return /^(true|ya|1)$/i.test(raw);
  if (type === 'color') return raw.toUpperCase();
  return raw;
};

/** Nilai sel untuk dibaca orang: boolean jadi Ya/Tidak (mengikuti bahasa), selain itu teks apa adanya. */
export const showValue = (v: unknown) =>
  typeof v === 'boolean' ? (getLocale().startsWith('en') ? (v ? 'Yes' : 'No') : (v ? 'Ya' : 'Tidak')) : String(v);
