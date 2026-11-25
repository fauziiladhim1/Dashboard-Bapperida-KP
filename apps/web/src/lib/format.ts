let locale = 'id-ID';
let num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
let compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
let dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** Dipanggil saat bahasa berganti; semua format angka/tanggal ikut. */
export const setLocale = (next: 'id-ID' | 'en-GB') => {
  locale = next;
  num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
};

export const getLocale = () => locale;
export const fmt = (n: number): string => num.format(n);
export const fmtCompact = (n: number): string => compact.format(n);
export const fmtDateTime = (iso: string): string => dateTime.format(new Date(iso));
/** Tanggal ISO (YYYY-MM-DD, atau timestamp ISO penuh dari API) -> '3 Nov 2026' sesuai bahasa aktif. */
export const fmtDate = (iso: string): string => new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtLongDate = (d: Date): string => d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Kunci salam sesuai jam; teksnya di kamus i18n. */
export const greetingKey = (date: Date) => {
  const h = date.getHours();
  return h < 11 ? 'greet.morning' : h < 15 ? 'greet.noon' : h < 18 ? 'greet.afternoon' : 'greet.evening';
};

/** "Data Pendukung Sekolah" -> "data-pendukung-sekolah" */
export const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
