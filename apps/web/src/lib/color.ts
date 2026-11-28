/**
 * Konversi warna untuk pemilih warna: Hex, RGB, HSL, dan OKLCH (CSS Color 4). Penyimpanan tetap hex #RRGGBB (API);
 * format lain hanya cara mengetik/menyalin. OKLCH lewat OKLab (Björn Ottosson), sRGB D65.
 */
type RGB = [number, number, number];

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 0) => Number(n.toFixed(d));

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
};
export const rgbToHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const rgbToHsl = ([r, g, b]: RGB): RGB => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
};
const hslToRgb = ([h, s, l]: RGB): RGB => {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const rgbToOklch = ([r, g, b]: RGB): RGB => {
  const [R, G, B] = [r, g, b].map((v) => toLinear(v / 255)) as RGB;
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  return [L, C, C < 1e-4 ? 0 : ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360];
};
const oklchToRgb = ([L, C, H]: RGB): RGB => {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(toGamma(c)) * 255) as RGB;
};

/** Kode warna dalam empat format, dari hex tersimpan. */
export const colorCodes = (hex: string) => {
  const rgb = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(rgb);
  const [L, C, H] = rgbToOklch(rgb);
  return {
    hex: hex.toUpperCase(),
    rgb: `rgb(${rgb.join(', ')})`,
    hsl: `hsl(${round(h)}, ${round(s)}%, ${round(l)}%)`,
    oklch: `oklch(${round(L * 100, 1)}% ${round(C, 3)} ${round(H, 1)})`,
  };
};

const NUM = '(-?\\d*\\.?\\d+)';
/**
 * Teks yang diketik (Hex `#2563eb`/`#26e`, `rgb(37, 99, 235)`, `hsl(221, 83%, 53%)`, `oklch(54.6% 0.215 262.9)` atau
 * `oklch(0.546 0.215 262.9)`) → hex #RRGGBB, atau null bila tak dikenali. Spasi/koma sebagai pemisah sama-sama boleh.
 */
export const parseColor = (input: string): string | null => {
  const s = input.trim().toLowerCase();
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return rgbToHex(hexToRgb(s.startsWith('#') ? s : `#${s}`));
  const m = s.match(new RegExp(`^(rgb|hsl|oklch)a?\\(\\s*${NUM}(%?)[\\s,]+${NUM}(%?)[\\s,]+${NUM}(%?)\\s*(?:[,/][^)]*)?\\)$`));
  if (!m) return null;
  const [, fn, a, aPct, b, , c] = m;
  const [x, y, z] = [Number(a), Number(b), Number(c)];
  if (fn === 'rgb') return [x, y, z].every((v) => v >= 0 && v <= 255) ? rgbToHex([x, y, z]) : null;
  if (fn === 'hsl') return y <= 100 && z <= 100 ? rgbToHex(hslToRgb([x, y, z])) : null;
  const L = aPct ? x / 100 : x;
  return L >= 0 && L <= 1 ? rgbToHex(oklchToRgb([L, y, z])) : null;
};
